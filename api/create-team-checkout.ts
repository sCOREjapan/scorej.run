// api/create-team-checkout.ts — チームプラン(コーチプラン)の外部決済セッション作成
//
// 2026-09-14: 「コーチ/チームプランだけApp内課金から外部決済(Stripe)に切り替える」との
// 方針決定を受けて新規作成。個人向けプラン(広告なし/チケット月額)は従来通りApp内課金の
// ままとし、単価が一番高く・学校側が銀行振込/請求書を必要とすることが多いチームプランだけ
// この経路に移す。
//
// 【なぜ外部決済か】
//   1. Apple/Googleの手数料(15〜30%)を回避できる（チームプランは単価が一番高いため効果が大きい）
//   2. 銀行振込・請求書払い(学校の公費払い)にStripe側で対応できる
//      （App内課金は個人のApple ID/クレカに紐づくため、学校の公費契約には原理的に使えない）
//
// 【設定が必要】(Vercel環境変数)
//   STRIPE_SECRET_KEY: Stripeダッシュボード → 開発者 → APIキー → シークレットキー(sk_live_...)
//
// 【決済モード】
//   年払い一括(mode:'payment')。学校の予算は年度(4月始まり)単位が基本で、Ricloud/
//   クラブマネージャー等の競合も年一括払いが標準だったため合わせた。サブスク自動更新
//   (mode:'subscription')にすると来年度の予算執行タイミングと噛み合わない懸念があるため、
//   「毎年このURLからもう一度購入し直す」運用をMVPとする。継続率が見えてきたら
//   自動更新への切替を検討する。
export const config = { runtime: 'nodejs' }

import Stripe from 'stripe'

// lib/purchaseService.ts の PRODUCT_IDS キー名と揃える。
// 価格は現行のコーチプラン月額(app/paywall.tsx)と同額×12ヶ月分。
const TEAM_PLANS: Record<string, { monthly: number; label: string }> = {
  coach_monthly:           { monthly: 1980, label: 'コーチプラン（〜15人）' },
  coach_monthly_30:        { monthly: 2980, label: 'コーチプラン（〜30人）' },
  coach_monthly_unlimited: { monthly: 4980, label: 'コーチプラン（無制限）' },
}

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') { res.status(204).end(); return }
  if (req.method !== 'POST') { res.status(405).send('Method not allowed'); return }

  try {
    const secretKey = process.env.STRIPE_SECRET_KEY
    if (!secretKey) { res.status(500).json({ error: 'STRIPE_SECRET_KEY が未設定です' }); return }

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
    const tier = body?.tier as string
    const plan = TEAM_PLANS[tier]
    if (!plan) { res.status(400).json({ error: '不正なプランです' }); return }

    const stripe = new Stripe(secretKey)
    const origin = (process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://scorej-run.vercel.app').replace(/\/$/, '')

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      // 請求書/銀行振込に対応したい場合は customer_creation:'always' +
      // Stripe Invoicing側の別フロー(見積送付→請求書発行)を使う。最初の数校は
      // 手動(銀行振込確認→api/team-checkout-verify.tsを手動相当で叩く)でも十分。
      line_items: [{
        price_data: {
          currency: 'jpy',
          unit_amount: plan.monthly * 12,
          product_data: {
            name: `sCORE ${plan.label}（年払い・12ヶ月分）`,
            description: 'AIフォーム分析・怪我予防データを扱う陸上競技チーム管理アプリ sCORE のチームプラン',
          },
        },
        quantity: 1,
      }],
      metadata: { tier },
      success_url: `${origin}/team-plan-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/team-plan`,
    })

    res.status(200).json({ url: session.url })
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? 'Unknown error' })
  }
}
