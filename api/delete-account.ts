// api/delete-account.ts — アカウント完全削除 (Vercel Node.js Serverless Function)
//
// 【背景・修正した不具合】
// これまで app/settings.tsx の「アカウント削除」は以下の3つしか行っておらず、
// 実質的にサーバー側データを何も消せていなかった:
//   1. training_sessions.delete().eq('user_id', authId) … training_sessions.user_id は
//      実際には内部 users.id を参照しており authId とは別値のため、常に0件ヒット。
//   2. meal_records.delete()... … このテーブル名はどこにも書き込まれておらず、
//      実際に使われているテーブルは 'meals'。存在しないか無関係なテーブルを叩いていた。
//   3. profiles.delete().eq('id', authId) … profiles の一意キーは 'id' ではなく
//      'user_id'（他画面のupsert/updateは全て user_id で一致させている）のため、
//      これも常に0件ヒット。
// さらに、Supabase Authのユーザー本体を削除するAPIはクライアントの匿名キーでは
// 呼べない（service_role権限が必要）ため一切削除されておらず、同じGoogle/Appleアカウントで
// 再ログインするとチケット残高・課金状態を含め全データが復元されてしまっていた。
//
// 【方針】
// クライアントは自分の access_token を渡すだけにし、実際の削除は全てここ
// (service_role権限を持つサーバー)で行う。テーブルごとに実際のキー列が
// authId(auth.usersのid)か内部users.idかを1つずつ実コードを確認して確定済み
// （コメントに根拠を残す）。最後にAuthユーザー本体を削除することで、
// users.auth_id の on delete cascade（supabase/schema.sql）により
// users/training_sessions/meals/competition_plans/sleep_records は二重に保護される。
//
// 【意図的にここで削除しないもの】
//   - analytics_events: user_id_hash は端末生成の匿名ハッシュ(lib/analytics.ts の
//     getAnonId())で、サーバー側からこのユーザーのものだと特定する手段が無いため対象外。
//   - team_* テーブル群（teams/team_members/team_messages/team_videos/
//     team_body_reports/team_player_stats/team_sessions/team_events）: team_code + 選手名で
//     管理されるチーム共有データで、コーチや他メンバーのデータと不可分のため、
//     個人アカウント削除の一部として自動削除するのは危険（要・別途プロダクト判断）。
//   - videos / meal-photos ストレージバケット: lib/storage.ts の uploadVideo/uploadMealPhoto
//     はコードベースのどこからも呼ばれていない（未使用）ことを確認済みのため、
//     削除すべき実ファイルは基本的に存在しない。
//
// 【設定が必要】(他のapi/*.tsと共通のVercel環境変数。未設定なら500を返す)
//   EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
export const config = { runtime: 'nodejs' }

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const authHeader = req.headers?.['authorization'] ?? ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : ''
  if (!token) {
    res.status(401).json({ error: 'Authorization: Bearer <access_token> が必要です' })
    return
  }

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
  const anonKey     = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !anonKey || !serviceKey) {
    res.status(500).json({ error: 'Supabaseの環境変数が未設定です' })
    return
  }

  try {
    const { createClient } = await import('@supabase/supabase-js')

    // ① 渡されたaccess_tokenが本物か検証し、"本人の"authIdだけを信用する
    //    （bodyでuserIdを受け取って信用する実装は、他人のIDを指定して消せてしまうため厳禁）
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
    const { data: userData, error: userErr } = await userClient.auth.getUser(token)
    const authId = userData?.user?.id
    if (userErr || !authId) {
      res.status(401).json({ error: 'セッションが無効です。再ログインしてからお試しください。' })
      return
    }

    // ② service_role権限のクライアント（RLSを迂回し、Authユーザー本体も削除できる）
    const admin = createClient(supabaseUrl, serviceKey)

    // ③ 内部 users.id を解決（lib/cloudSync.ts の resolveAppUserId と同じ対応関係）。
    //    行が無いこと自体はエラーではない(maybeSingleがdata:nullで返すだけ)ので、その場合は
    //    内部users.id配下のテーブルは対象0件として処理を続行する。一方、通信断など"本当の"
    //    エラーをここで無視すると、training_sessions等が消せていないのにAuthユーザーだけ
    //    削除してしまい、削除失敗に気づけないまま個人データだけ孤児化して残ってしまうため、
    //    ここは握りつぶさず失敗として返す（再試行させる）。
    const { data: userRow, error: userRowErr } = await admin.from('users').select('id').eq('auth_id', authId).maybeSingle()
    if (userRowErr) {
      res.status(500).json({ error: `内部ユーザー情報の取得に失敗しました: ${userRowErr.message}` })
      return
    }
    const appUserId: string | null = userRow?.id ?? null

    const deleted: string[] = []
    const failed: { table: string; error: string }[] = []

    const del = async (table: string, column: string, value: string) => {
      const { error } = await admin.from(table).delete().eq(column, value)
      if (error) failed.push({ table, error: error.message })
      else deleted.push(table)
    }

    // ── グループA: authId(auth.users.id)がそのまま user_id 列に入っているテーブル ──
    // profiles.user_id: app/onboarding.tsx の upsert({user_id: user.id}, {onConflict:'user_id'})、
    //   context/PurchaseContext.tsx の .update(...).eq('user_id', userId)（userId=user?.id）で確認済み
    await del('profiles', 'user_id', authId)
    // ticket_wallets.user_id: lib/ticketWallet.ts getCurrentUserId()(=auth.getSession().user.id)で確認済み
    await del('ticket_wallets', 'user_id', authId)
    // subscription_status.user_id: api/revenuecat-webhook.ts / api/analyze.ts で確認済み
    await del('subscription_status', 'user_id', authId)
    // feature_usage_counts.user_id: lib/adGate.ts getCurrentUserId()で確認済み
    await del('feature_usage_counts', 'user_id', authId)

    // ── グループB: 内部 users.id が user_id 列に入っているテーブル（lib/cloudSync.ts参照） ──
    if (appUserId) {
      await del('training_sessions', 'user_id', appUserId)
      await del('meals', 'user_id', appUserId)
      await del('competition_plans', 'user_id', appUserId)
      await del('sleep_records', 'user_id', appUserId)
      await del('condition_records', 'user_id', appUserId)
      await del('race_records', 'user_id', appUserId)
      // schema.sqlに定義が無く実DBの存在有無が未確認だが、cloudSync.tsのSYNC_MAPに
      // 含まれておりuser_id列を内部idで使う前提のため、存在すれば削除・無ければ
      // エラーがfailedに記録されるだけで後続処理は止めない
      await del('calendar_events', 'user_id', appUserId)
      await del('workout_menus', 'user_id', appUserId)
      await del('weights', 'user_id', appUserId)
      // lib/referral.ts getMyUserId()(=resolveAppUserId)で確認済み
      await del('referral_codes', 'referrer_user_id', appUserId)
      await del('referral_redemptions', 'referrer_user_id', appUserId)
      await del('referral_redemptions', 'redeemer_user_id', appUserId)
      await del('users', 'id', appUserId)
    }

    // ④ 最後にAuthユーザー本体を削除する。これが無いと、同じGoogle/Appleアカウントで
    //    再ログインした瞬間に(auth_idが同じ)全データが実質的に復元されてしまう。
    const { error: authDelErr } = await admin.auth.admin.deleteUser(authId)
    if (authDelErr) {
      // ここまでの個人データは消えているが、Authアカウント自体は残ってしまった状態。
      // クライアント側は「再試行してください」を表示できるよう失敗として返す。
      res.status(500).json({ error: `Authユーザー削除に失敗: ${authDelErr.message}`, deleted, failed })
      return
    }

    res.status(200).json({ status: 'ok', deleted, failed })
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? 'Unknown error' })
  }
}
