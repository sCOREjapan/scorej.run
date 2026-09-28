// api/start-coach-trial.ts — コーチプラン15日間無料体験の開始 (Vercel Node.js Serverless Function)
//
// 【背景】
//   コーチ/チームプランはこれまで無料体験が無く、BASEショップでの外部課金が唯一の入口
//   だった。¥0・15日間・1アカウント1回のみの体験を追加する。1アカウント1回の強制は
//   supabase/coach_trial_migration.sqlのcoach_trialsテーブル(user_id主キー)で担保する。
//   RevenueCatは一切経由しない(実際の課金が発生しないため)。
//
// 【設計】
//   同時に「チームをauthアカウントに紐付ける」(teams.owner_user_id)ことも行う。
//   これにより、体験終了後にapi/redeem-team-code.tsでコードを引き換えて課金コーチに
//   転換した場合も、同じteamsレコード(同じチームコード)がそのまま使われ続けるため、
//   チームの作り直しが一切不要になる（api/redeem-team-code.ts自体の変更は不要）。
//
// 【設定が必要】(他のapi/*.tsと共通のVercel環境変数)
//   EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
export const config = { runtime: 'nodejs' }

const TRIAL_DAYS = 15

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') { res.status(204).end(); return }
  if (req.method !== 'POST') { res.status(405).send('Method not allowed'); return }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
    const code = (body?.code ?? '').toString().trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
    const teamName = (body?.teamName ?? '').toString().trim().slice(0, 100)
    const coachName = (body?.coachName ?? '').toString().trim().slice(0, 100)
    if (!code || code.length !== 6) { res.status(400).json({ error: 'コードの形式が不正です' }); return }
    if (!teamName || !coachName) { res.status(400).json({ error: 'チーム名・コーチ名を入力してください' }); return }

    // ── ログイン必須（1アカウント1回の強制にauthIdが必要） ──
    const authHeader: string = req.headers?.['authorization'] ?? ''
    if (!authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: '体験を始めるにはログインが必要です' }); return
    }
    const token = authHeader.slice('Bearer '.length)

    const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
    const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !anonKey || !serviceKey) {
      res.status(500).json({ error: 'サーバー設定が不足しています' }); return
    }

    const { createClient } = await import('@supabase/supabase-js')
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } } })
    const { data: userData, error: userErr } = await userClient.auth.getUser(token)
    const authId = userData?.user?.id
    if (userErr || !authId) { res.status(401).json({ error: 'ログイン情報を確認できませんでした' }); return }

    const svcHeaders = { 'Content-Type': 'application/json', apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }

    // ── 既に体験済みでないか確認 ──
    // 2026-09-25バグ修正: レスポンスの.okを確認せず「配列でなければ0件扱い」にしていたため、
    // もしservice_roleにcoach_trialsへのSELECT権限が無い等でこのリクエスト自体が失敗した場合、
    // エラーレスポンス({code, message}等のオブジェクト)がArray.isArray()でfalseになり、
    // 「体験済みでない」と誤判定してしまう＝1アカウント1回の制限が無効化される致命的な穴
    // だった。.okを明示チェックし、失敗時は500を返してフェイルクローズする。
    const existingRes = await fetch(
      `${supabaseUrl}/rest/v1/coach_trials?user_id=eq.${encodeURIComponent(authId)}&select=user_id`,
      { headers: svcHeaders },
    )
    if (!existingRes.ok) {
      const errText = await existingRes.text().catch(() => '')
      console.error('[start-coach-trial] coach_trials existing-check failed:', errText)
      res.status(500).json({ error: `体験状況の確認に失敗しました: ${errText}` }); return
    }
    const existingRows = await existingRes.json()
    if (Array.isArray(existingRows) && existingRows.length > 0) {
      res.status(409).json({ error: '既に無料体験を利用済みです', code: 'ALREADY_USED' }); return
    }

    // ── コードの衝突確認（クライアント生成のためサーバー側でも一応確認する） ──
    // 上と同じ理由で.okを明示チェックする（失敗時に「衝突なし」と誤判定してteams.code
    // の一意性チェックをすり抜けさせない）。
    const codeCheckRes = await fetch(
      `${supabaseUrl}/rest/v1/teams?code=eq.${encodeURIComponent(code)}&select=code`,
      { headers: svcHeaders },
    )
    if (!codeCheckRes.ok) {
      const errText = await codeCheckRes.text().catch(() => '')
      console.error('[start-coach-trial] teams code-check failed:', errText)
      res.status(500).json({ error: `コードの確認に失敗しました: ${errText}` }); return
    }
    const codeCheckRows = await codeCheckRes.json()
    if (Array.isArray(codeCheckRows) && codeCheckRows.length > 0) {
      res.status(409).json({ error: 'このコードは既に使用されています。もう一度お試しください', code: 'CODE_TAKEN' }); return
    }

    // ── teamsを作成（owner_user_idで本人アカウントに紐付ける） ──
    const createTeamRes = await fetch(`${supabaseUrl}/rest/v1/teams`, {
      method: 'POST',
      headers: { ...svcHeaders, Prefer: 'return=minimal' },
      body: JSON.stringify({ code, team_name: teamName, coach_name: coachName, owner_user_id: authId }),
    })
    if (!createTeamRes.ok) {
      const errText = await createTeamRes.text().catch(() => '')
      console.error('[start-coach-trial] teams insert failed:', errText)
      res.status(500).json({ error: `チームの作成に失敗しました: ${errText}` }); return
    }

    // ── coach_trialsに記録（この行の存在自体が「体験利用済み」の唯一の真実） ──
    const expiresAt = new Date(Date.now() + TRIAL_DAYS * 86400000).toISOString()
    const createTrialRes = await fetch(`${supabaseUrl}/rest/v1/coach_trials`, {
      method: 'POST',
      headers: { ...svcHeaders, Prefer: 'return=minimal' },
      body: JSON.stringify({ user_id: authId, team_code: code, expires_at: expiresAt }),
    })
    if (!createTrialRes.ok) {
      const errText = await createTrialRes.text().catch(() => '')
      // teamsは既に作成済みだが、coach_trialsの記録に失敗した状態。
      // 「体験利用済み」の記録が無いまま放置すると同じユーザーが何度も無料体験を
      // 開始できてしまうため、失敗として返しクライアントに再試行させる
      // （teams行が孤児化するが、コードが衝突しない限り実害は小さい）。
      console.error('[start-coach-trial] coach_trials insert failed:', errText)
      res.status(500).json({ error: `体験の記録に失敗しました: ${errText}` }); return
    }

    res.status(200).json({ status: 'ok', code, teamName, coachName, trialExpiresAt: expiresAt })
  } catch (e: any) {
    console.error('[start-coach-trial] unhandled exception:', e)
    res.status(500).json({ error: e?.message ?? 'Unknown error' })
  }
}
