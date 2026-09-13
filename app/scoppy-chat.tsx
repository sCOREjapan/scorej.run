// app/scoppy-chat.tsx — スコッピー(マスコット)とのAIチャット画面
//
// 2026-09-13: 「AIスコッピー(メインキャラ)と会話ができる機能、わからないことを聞ける機能」の
// 要望で新規作成。ユーザーとの合意事項:
//   ①ホーム画面のスコッピーをタップして開く（app/(tabs)/index.tsxから遷移）
//   ②回答範囲は陸上競技の一般知識のみ（本人の記録データは今回は使わない。将来拡張候補）
//   ③他のAI機能と同じくチケット消費(1枚/メッセージ)。lib/ticketWallet.ts・lib/adGate.ts・
//     api/analyze.tsのTICKET_COST_SERVERにscoppy_chatとして登録済み。
// AI呼び出し本体はlib/claude.tsのaskScoppy()、会話履歴の永続化はlib/scoppyChatStore.ts。
import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Image,
  ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useTheme, type ThemeColors } from '../context/ThemeContext'
import { useLanguage } from '../context/LanguageContext'
import { useAuth } from '../context/AuthContext'
import { checkAdGate, recordUsage } from '../lib/adGate'
import { trackFeatureUse } from '../lib/analytics'
import { askScoppy } from '../lib/claude'
import {
  getScoppyChatHistory, addScoppyChatMessage, clearScoppyChatHistory,
  getScoppyChatCredits, consumeScoppyChatCredit, rechargeScoppyChatCredits,
  type ScoppyChatEntry,
} from '../lib/scoppyChatStore'
import TicketGateModal from '../components/TicketGateModal'

const BRAND = '#166534'
const MASCOT_READY    = require('../assets/illustrations/mascot/mascot_onboarding_ready.png')
const MASCOT_THINKING = require('../assets/illustrations/mascot/mascot_onboarding_thinking.png')

export default function ScoppyChatScreen() {
  const { t } = useTranslation()
  const router = useRouter()
  const { colors } = useTheme()
  const { language } = useLanguage()
  const { isGuest } = useAuth()
  const s = makeStyles(colors)

  const [messages, setMessages] = useState<ScoppyChatEntry[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [ticketGateVisible, setTicketGateVisible] = useState(false)
  const [ticketGateCost, setTicketGateCost] = useState(0)
  const [ticketGateBalance, setTicketGateBalance] = useState(0)
  const [remainingCredits, setRemainingCredits] = useState(0)
  const sendingRef = useRef(false)
  const scrollRef = useRef<ScrollView>(null)

  const refreshCredits = useCallback(() => {
    getScoppyChatCredits().then(setRemainingCredits).catch(() => {})
  }, [])

  useEffect(() => {
    getScoppyChatHistory().then(h => { setMessages(h); setLoadingHistory(false) }).catch(() => setLoadingHistory(false))
    refreshCredits()
  }, [refreshCredits])

  const scrollToEnd = useCallback(() => {
    // レイアウト確定前にscrollToEndを呼ぶと反映されないことがあるため1フレーム遅らせる
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }))
  }, [])

  useEffect(() => { if (!loadingHistory) scrollToEnd() }, [messages.length, loadingHistory, scrollToEnd])

  const handleSend = useCallback(async (textOverride?: string) => {
    const text = (textOverride ?? input).trim()
    if (!text || sendingRef.current) return

    // 2026-09-13: 「チケット制の設定、1チケット5質問とか」との指示で、
    // 通常のAI機能(1回=1チケット)とは別に、ここだけローカルの残数バンクを先にチェックする。
    // 残数があればチケットには一切触れず、無くなった時だけ通常のチケット消費フローを
    // 1回走らせて5回分をチャージし直す(lib/scoppyChatStore.ts参照)。
    const creditsBefore = await getScoppyChatCredits()
    const usingBankedCredit = creditsBefore > 0
    if (!usingBankedCredit) {
      // ゲストもローカルのチケット残高を持っているため利用可(lib/ticketWallet.ts参照)。
      // notebook_ai等の既存の低コストAI機能と同じくゲストを一律ブロックしない方針
      const gate = await checkAdGate('scoppy_chat')
      if (!gate.allowed) {
        if (gate.hardLimited) {
          Alert.alert(t('scoppyChat.dailyLimitTitle'), t('scoppyChat.dailyLimitMessage'))
        } else {
          setTicketGateCost(gate.ticketCost)
          setTicketGateBalance(gate.ticketBalance)
          setTicketGateVisible(true)
        }
        return
      }
    }

    sendingRef.current = true
    setSending(true)
    setInput('')
    const historyBeforeSend = await addScoppyChatMessage({ role: 'user', content: text })
    setMessages(historyBeforeSend)

    try {
      // 2026-09-13バグ修正: 「Too many messages」で毎回失敗する原因の1つが、過去の
      // 失敗時に追加した「うまく答えられなかった」というassistant発言も含めて毎回
      // APIに送っていたため、失敗するたびに履歴が積み上がっていたこと(api/analyze.ts側の
      // メッセージ数上限にも影響)。isErrorが付いた行はAIへの文脈からは除外する
      const reply = await askScoppy(
        historyBeforeSend.filter(m => !m.isError).map(m => ({ role: m.role, content: m.content })),
        language,
      )
      const historyAfterReply = await addScoppyChatMessage({ role: 'assistant', content: reply })
      setMessages(historyAfterReply)
      // 返答に成功した場合のみ消費を確定する(失敗時に損をさせないため。
      // 他のAI機能(video-analysis.tsx等)と同じ方針)。
      if (usingBankedCredit) {
        await consumeScoppyChatCredit()
      } else {
        await recordUsage('scoppy_chat')
        await rechargeScoppyChatCredits() // チケット1枚消費→今回分を引いた残り4回をチャージ
      }
      trackFeatureUse('scoppy_chat')
    } catch (e: any) {
      // 2026-09-13(暫定・削除予定): 「毎回失敗する」という報告の原因を実機で特定するため、
      // 一時的に実際のエラー内容をチャット上に出す。原因判明後は
      // t('scoppyChat.errorMessage') だけに戻すこと。
      console.error('[scoppy-chat] askScoppy failed:', e)
      // isError:true を付け、次回送信時にAIへの文脈からは除外されるようにする
      // (上のfilter参照。付けないと「answerできなかった」という発言が会話の一部として
      // 送られ続け、文脈を汚染するだけでなくメッセージ数上限にも余計に貢献してしまう)
      const historyWithError = await addScoppyChatMessage({
        role: 'assistant',
        content: `${t('scoppyChat.errorMessage')}\n[debug] ${e?.message ?? String(e)}`,
        isError: true,
      })
      setMessages(historyWithError)
    } finally {
      setSending(false)
      sendingRef.current = false
      refreshCredits()
    }
  }, [input, language, t, refreshCredits])

  const handleClear = () => {
    Alert.alert(t('scoppyChat.clearTitle'), t('scoppyChat.clearMessage'), [
      { text: t('scoppyChat.cancel'), style: 'cancel' },
      { text: t('scoppyChat.clearConfirm'), style: 'destructive', onPress: async () => setMessages(await clearScoppyChatHistory()) },
    ])
  }

  const suggestions = t('scoppyChat.suggestions', { returnObjects: true }) as unknown as string[]

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <View style={s.topBar}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 }}>
          {/* 2026-09-13バグ修正: 「ホーム画面に戻るボタンがわかりにくい」との報告。
              headerShown:falseの独自ヘッダーなのに戻る手段が無く、iOSの端スワイプ
              ジェスチャーだけが頼りだった(気づきにくい)。明示的な戻るボタンを追加する */}
          <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={{ marginRight: 2 }}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Image source={MASCOT_READY} style={s.topBarMascot} resizeMode="contain" />
          <Text style={s.topBarTitle}>{t('scoppyChat.title')}</Text>
          {/* 2026-09-13: 「1チケット5質問」の残数を可視化(lib/scoppyChatStore.ts参照)。
              0の時は次の送信で通常のチケット消費フローに入るだけなので何も表示しない */}
          {remainingCredits > 0 && (
            <View style={s.creditsPill}>
              <Text style={s.creditsPillText}>{t('scoppyChat.creditsRemaining', { n: remainingCredits })}</Text>
            </View>
          )}
        </View>
        {messages.length > 0 && (
          <TouchableOpacity onPress={handleClear} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="trash-outline" size={19} color={colors.textHint} />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={s.scrollContent} keyboardShouldPersistTaps="handled">
        {!loadingHistory && messages.length === 0 && (
          <View style={s.emptyWrap}>
            <Image source={MASCOT_READY} style={s.emptyMascot} resizeMode="contain" />
            <Text style={s.emptyTitle}>{t('scoppyChat.emptyTitle')}</Text>
            <Text style={s.emptySub}>{t('scoppyChat.emptySub')}</Text>
            {/* 2026-09-13バグ修正: 「チケット消費することが何も記載がない」との報告。
                料金体系(5回で1枚)を最初に明示する */}
            <View style={s.costNote}>
              <Ionicons name="pricetag-outline" size={13} color={colors.textHint} />
              <Text style={s.costNoteText}>{t('scoppyChat.costNote')}</Text>
            </View>
            <View style={s.suggestWrap}>
              {suggestions.map((q, i) => (
                <TouchableOpacity key={i} style={s.suggestChip} onPress={() => handleSend(q)} activeOpacity={0.75}>
                  <Text style={s.suggestChipText}>{q}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {messages.map(m => (
          <View key={m.id} style={[s.bubbleRow, m.role === 'user' ? s.bubbleRowUser : s.bubbleRowAssistant]}>
            {m.role === 'assistant' && <Image source={MASCOT_READY} style={s.bubbleAvatar} resizeMode="contain" />}
            <View style={[s.bubble, m.role === 'user' ? s.bubbleUser : s.bubbleAssistant]}>
              <Text style={[s.bubbleText, m.role === 'user' && s.bubbleTextUser]}>{m.content}</Text>
            </View>
          </View>
        ))}

        {sending && (
          <View style={[s.bubbleRow, s.bubbleRowAssistant]}>
            <Image source={MASCOT_THINKING} style={s.bubbleAvatar} resizeMode="contain" />
            <View style={[s.bubble, s.bubbleAssistant, { flexDirection: 'row', alignItems: 'center', gap: 6 }]}>
              <ActivityIndicator size="small" color={colors.textHint} />
              <Text style={[s.bubbleText, { color: colors.textHint }]}>{t('scoppyChat.thinking')}</Text>
            </View>
          </View>
        )}
      </ScrollView>

      <View style={s.inputBar}>
        <TextInput
          style={s.input}
          placeholder={t('scoppyChat.placeholder')}
          placeholderTextColor={colors.textHint}
          value={input}
          onChangeText={setInput}
          multiline
          maxLength={300}
          editable={!sending}
        />
        <TouchableOpacity
          style={[s.sendBtn, (!input.trim() || sending) && { opacity: 0.4 }]}
          onPress={() => handleSend()}
          disabled={!input.trim() || sending}
          activeOpacity={0.8}
        >
          <Ionicons name="send" size={18} color="#fff" />
        </TouchableOpacity>
      </View>

      <TicketGateModal
        visible={ticketGateVisible}
        feature="scoppy_chat"
        ticketCost={ticketGateCost}
        ticketBalance={ticketGateBalance}
        onClose={() => setTicketGateVisible(false)}
      />
    </KeyboardAvoidingView>
  )
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  topBarMascot: { width: 30, height: 30 },
  topBarTitle: { fontSize: 15, fontWeight: '800', color: colors.text },
  creditsPill: {
    backgroundColor: '#166534' + '18', borderRadius: 10,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  creditsPillText: { fontSize: 11, fontWeight: '700', color: '#166534' },
  scrollContent: { padding: 16, paddingBottom: 24, flexGrow: 1 },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 30 },
  emptyMascot: { width: 96, height: 96, marginBottom: 12 },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: colors.text, marginBottom: 4 },
  emptySub: { fontSize: 13, color: colors.textSec, textAlign: 'center', lineHeight: 19, marginBottom: 12, paddingHorizontal: 16 },
  costNote: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 20 },
  costNoteText: { fontSize: 11.5, color: colors.textHint },
  suggestWrap: { width: '100%', gap: 8 },
  suggestChip: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: 14, paddingVertical: 11, paddingHorizontal: 14,
  },
  suggestChipText: { fontSize: 13, color: colors.text, fontWeight: '600' },
  bubbleRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, marginBottom: 12, maxWidth: '100%' },
  bubbleRowUser: { justifyContent: 'flex-end' },
  bubbleRowAssistant: { justifyContent: 'flex-start' },
  bubbleAvatar: { width: 26, height: 26, marginBottom: 2 },
  bubble: { maxWidth: '78%', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleUser: { backgroundColor: BRAND, borderBottomRightRadius: 4 },
  bubbleAssistant: { backgroundColor: colors.surface2, borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 14, lineHeight: 20, color: colors.text },
  bubbleTextUser: { color: '#fff' },
  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border,
  },
  input: {
    flex: 1, backgroundColor: colors.inputBg, borderRadius: 18,
    paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: colors.text,
    maxHeight: 100,
  },
  sendBtn: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: BRAND,
    alignItems: 'center', justifyContent: 'center',
  },
})
