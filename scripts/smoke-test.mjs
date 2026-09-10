#!/usr/bin/env node
// scripts/smoke-test.mjs — 主要APIエンドポイントの軽量スモークテスト
//
// 2026-09-09: 設計書§2-3が求める「主要導線のE2Eテスト」の代替。Detox/Maestro等の
// 本格的なネイティブUI自動化フレームワークは、このプロジェクトに一切導入されて
// おらず、シミュレータ設定・CI組み込みを含む本格導入は別途の意思決定が必要な
// 規模の投資のため今回は見送った（実UIを操作する新規ユーザー登録〜記録保存等の
// フローはこのスクリプトではカバーできない）。
// 代わりに、認証済みユーザーセッションを必要としない範囲で「本番のAPIエンドポイント
// が壊れていないか」を実際にHTTPで叩いて確認する。team-invite.tsx事故のように
// 「画面は表示されるが実際にはDBに書けていない」系の不具合を早期発見する目的。
//
// 使い方: node scripts/smoke-test.mjs
// 終了コード: 全テスト成功なら0、1件でも失敗なら1（CI組み込み可能）

const BASE = process.env.SMOKE_TEST_BASE_URL ?? 'https://scorej-run.vercel.app'

let pass = 0, fail = 0
function ok(name, cond, detail = '') {
  if (cond) { console.log(`✅ ${name}`); pass++ }
  else { console.log(`❌ ${name}${detail ? ` — ${detail}` : ''}`); fail++ }
}

async function run() {
  console.log(`スモークテスト開始: ${BASE}\n`)

  // ── /api/analyze: 認証なし・不正ペイロードは弾かれるか ──
  {
    const res = await fetch(`${BASE}/api/analyze`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: Array.from({ length: 10 }, () => ({ role: 'user', content: 'x' })) }),
    })
    const data = await res.json().catch(() => ({}))
    ok('analyze: メッセージ数上限(4件)を超えると400', res.status === 400 && /Too many messages/.test(data?.error ?? ''), `status=${res.status} body=${JSON.stringify(data)}`)
  }

  // ── /api/analyze: 連続リクエストが429で誤ブロックされないこと ──
  // 2026-09-10: IP単位レート制限・同一内容dedupは、モバイル回線のキャリアNATで
  // 多数ユーザーが同一IPを共有するため正規ユーザーを誤ブロックし「AI機能が全て
  // 使えない」障害を起こした。現在は無効化済み。連打しても429にならないことを確認する。
  {
    const payload = {
      feature: 'workout', model: 'claude-haiku-4-5-20251001', max_tokens: 30,
      messages: [{ role: 'user', content: 'smoke-test burst same content' }],
    }
    let blocked = 0
    for (let i = 0; i < 5; i++) {
      const r = await fetch(`${BASE}/api/analyze`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      if (r.status === 429) blocked++
    }
    ok('analyze: 同一内容5連打が429で誤ブロックされない', blocked === 0, `${blocked}/5 が429`)
  }

  // ── /api/notify: teamCode必須チェック ──
  {
    const res = await fetch(`${BASE}/api/notify`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 't', message: 'm', target: 'all' }),
    })
    const data = await res.json().catch(() => ({}))
    ok('notify: teamCode省略で400 or skipped', res.status === 400 || data?.skipped === true, `status=${res.status} body=${JSON.stringify(data)}`)
  }

  // ── /api/ai-health-check: 正常応答するか ──
  {
    const res = await fetch(`${BASE}/api/ai-health-check`)
    const data = await res.json().catch(() => ({}))
    ok('ai-health-check: レスポンスにchecksが含まれる', !!data?.checks, `status=${res.status} body=${JSON.stringify(data).slice(0, 300)}`)
  }

  // ── Supabase REST: referral_codesが匿名で全件取得できないこと（漏洩再発防止） ──
  {
    const supaUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
    const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
    if (supaUrl && anonKey) {
      const res = await fetch(`${supaUrl}/rest/v1/referral_codes?select=*&limit=5`, {
        headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
      })
      const data = await res.json().catch(() => [])
      ok('referral_codes: 匿名キーで空配列(全件ダンプ不可)', Array.isArray(data) && data.length === 0, `got ${Array.isArray(data) ? data.length : '?'} rows`)

      // ── team_body_reports: 未知のteam_codeでは空配列(RLS by X-Team-Codeが効いている) ──
      const res2 = await fetch(`${supaUrl}/rest/v1/team_body_reports?select=*&limit=5`, {
        headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
      })
      const data2 = await res2.json().catch(() => [])
      ok('team_body_reports: X-Team-Codeヘッダー無しで空配列', Array.isArray(data2) && data2.length === 0, `got ${Array.isArray(data2) ? data2.length : '?'} rows`)
    } else {
      console.log('⚠️  EXPO_PUBLIC_SUPABASE_URL/ANON_KEY未設定のためSupabase系テストをスキップ')
    }
  }

  console.log(`\n${pass}件成功 / ${fail}件失敗`)
  process.exit(fail > 0 ? 1 : 0)
}

run().catch(e => { console.error('スモークテスト自体が例外で停止:', e); process.exit(1) })
