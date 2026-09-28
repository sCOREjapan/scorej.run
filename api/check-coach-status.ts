// api/check-coach-status.ts — Web版でRevenueCatの「coach」権限を確認する
//
// 2026-09-21実バグ対応: lib/purchaseService.ts(Webスタブ)のgetPremiumStatus()は
// 常にtier:'free'を返しており、api/redeem-team-code.tsでRevenueCat側の権限付与に
// 成功していても、Web版アプリはそれを一切知る術がなかった。そのため実際のユーザーが
// コードを引き換えても「コーチプランを有効化しました」の直後にコーチ設定画面へ
// 弾き返される（isCoachがfalseのまま）という不具合が起きていた。
//
// このエンドポイントはSupabaseログイン中のユーザーについて、RevenueCat側の実際の
// entitlements（coach）を都度サーバーサイドで確認して返す。REVENUECAT_SECRET_API_KEYは
// クライアントに絶対渡さないため、この確認処理は必ずサーバー経由にする必要がある。
export const config = { runtime: 'nodejs' }

const COACH_ENTITLEMENT_ID = 'coach'

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') { res.status(204).end(); return }
  if (req.method !== 'GET') { res.status(405).send('Method not allowed'); return }

  try {
    // 未ログイン(ゲスト)はコーチになり得ないため、素直にfalseを返す(エラーにしない。
    // PurchaseContextの通常の初期化パスで毎回呼ばれるため、ここで401を返すと
    // ゲスト利用時に常時コンソールエラーが出てしまう)。
    const authHeader: string = req.headers?.['authorization'] ?? ''
    if (!authHeader.startsWith('Bearer ')) { res.status(200).json({ isCoach: false }); return }
    const token = authHeader.slice('Bearer '.length)

    const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
    const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
    const revenueCatSecret = process.env.REVENUECAT_SECRET_API_KEY
    if (!supabaseUrl || !anonKey || !revenueCatSecret) {
      res.status(500).json({ error: 'サーバー設定が不足しています' }); return
    }

    const { createClient } = await import('@supabase/supabase-js')
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } } })
    const { data: userData, error: userErr } = await userClient.auth.getUser(token)
    const userId = userData?.user?.id
    if (userErr || !userId) { res.status(200).json({ isCoach: false }); return }

    const rcRes = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`, {
      headers: { Authorization: `Bearer ${revenueCatSecret}` },
    })
    if (!rcRes.ok) { res.status(200).json({ isCoach: false }); return }
    const rcJson = await rcRes.json()
    const ent = rcJson?.subscriber?.entitlements?.[COACH_ENTITLEMENT_ID]
    const isCoach = !!ent && (!ent.expires_date || new Date(ent.expires_date).getTime() > Date.now())

    res.status(200).json({ isCoach, expiresAt: ent?.expires_date ?? undefined })
  } catch (e: any) {
    res.status(200).json({ isCoach: false })
  }
}
