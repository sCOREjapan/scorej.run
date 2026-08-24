// lib/adLock.ts — 全画面プレゼンテーションの排他制御
//
// インタースティシャル/リワード/App Open 広告がそれぞれ独立したロード〜表示フローを持っており、
// 何かのはずみで2つ以上が同時に走ると、ネイティブ側で全画面広告が重なって表示され、
// 画面が反応しなくなる（固まる）不具合があった。lib/admob.ts と lib/rewardedAd.ts の
// 両方から共有できる単一のロックとして切り出し、どちらの広告呼び出しも
// 「今どれか1本でも表示中なら新たに広告を出さない」を守るようにする。
//
// 同じ衝突は「広告」同士に限らない。app/_layout.tsx の告知バナー（LineCommunityBanner等、
// すべて<Modal>でネイティブpresentationを伴う）とApp Open広告が重なっても同様に画面が
// 固まるため、このロックは「広告」に限らず「今何かフルスクリーンのネイティブ
// presentationが出ているか」を表す共有フラグとして使う。
// 参照カウント方式にしている理由: 呼び出し元が複数(admob.tsの3関数・rewardedAd.ts・
// バナー表示中フラグ)あり、単純なbooleanだと「Aが true にした直後にBが false で
// 上書きしてしまい、Aがまだ表示中なのにロックが外れる」という取り違えが起きるため。
// 各呼び出し元は setAnyAdShowing(true) と setAnyAdShowing(false) を必ず1対1で
// 呼ぶ（true→false の実際の遷移が起きた時だけ呼ぶ）ことを前提にしている。
let _count = 0

export function isAnyAdShowing(): boolean {
  return _count > 0
}

export function setAnyAdShowing(value: boolean): void {
  _count = Math.max(0, _count + (value ? 1 : -1))
}
