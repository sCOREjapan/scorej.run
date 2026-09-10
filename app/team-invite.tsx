// app/team-invite.tsx — 旧チーム招待プロトタイプ(廃止)
//
// 2026-09-09: このファイルはSupabaseに一切接続していないローカルストレージのみの
// プロトタイプだった（招待コードはAsyncStorageに保存するだけ、参加ボタンも実在
// 確認なしで常に成功トーストを出すだけ）。新規コーチ全員がこの偽画面に着地して
// いたバグを、app/onboarding.tsxのリダイレクト先を本物のチーム機能
// (app/(tabs)/team.tsx)に変更することで修正済み。
//
// このファイル自体は、古いDeep Link・ブックマーク・キャッシュされたリンク経由で
// まだ到達され得るため、404にせず本物のチーム画面へ即リダイレクトするだけの
// 薄いラッパーとして残す（設計書 §2-3 の指示通り）。
import { useEffect } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'

export default function TeamInviteRedirect() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/(tabs)/team' as any)
  }, [])
  return <View style={{ flex: 1, backgroundColor: '#0a0a0a' }} />
}
