// app/privacy.tsx — プライバシーポリシー（詳細版）
import React from 'react'
import { View, Text, ScrollView, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { LinearGradient } from 'expo-linear-gradient'
import { BG_GRADIENT, TEXT } from '../lib/theme'

const LAST_UPDATED = '2026年4月15日'
const APP_NAME     = 'sCORE'
const CONTACT      = 'fojpl.office@gmail.com'
const OPERATOR     = '合同会社sCORE（以下「当社」）'

function Section({ num, title, children }: { num: string; title: string; children: React.ReactNode }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{num}　{title}</Text>
      {children}
    </View>
  )
}
function P({ children }: { children: React.ReactNode }) {
  return <Text style={s.body}>{children}</Text>
}
function Li({ n, children }: { n?: string | number; children: React.ReactNode }) {
  return (
    <View style={s.liRow}>
      <Text style={s.bullet}>{n ? `（${n}）` : '・'}</Text>
      <Text style={[s.body, { flex: 1 }]}>{children}</Text>
    </View>
  )
}
function Table({ rows }: { rows: [string, string, string][] }) {
  return (
    <View style={s.table}>
      <View style={[s.tableRow, s.tableHead]}>
        <Text style={[s.tableCell, s.tableCellHead, { flex: 2 }]}>情報の種類</Text>
        <Text style={[s.tableCell, s.tableCellHead, { flex: 3 }]}>内容</Text>
        <Text style={[s.tableCell, s.tableCellHead, { flex: 2 }]}>保存場所</Text>
      </View>
      {rows.map(([type, content, storage], i) => (
        <View key={i} style={[s.tableRow, i % 2 === 0 && s.tableRowAlt]}>
          <Text style={[s.tableCell, { flex: 2 }]}>{type}</Text>
          <Text style={[s.tableCell, { flex: 3 }]}>{content}</Text>
          <Text style={[s.tableCell, { flex: 2 }]}>{storage}</Text>
        </View>
      ))}
    </View>
  )
}

export default function PrivacyScreen() {
  return (
    <View style={{ flex: 1 }}>
      <LinearGradient colors={BG_GRADIENT} style={StyleSheet.absoluteFill} />
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
          <Text style={s.title}>プライバシーポリシー</Text>
          <Text style={s.meta}>{APP_NAME}　最終改訂：{LAST_UPDATED}</Text>
          <P>
            {OPERATOR}は、スマートフォンアプリケーション「{APP_NAME}」（以下「本サービス」）の運営において、ユーザーの個人情報の保護を最重要事項のひとつと位置付けています。本プライバシーポリシー（以下「本ポリシー」）は、当社が本サービスを通じて取得・利用・管理する個人情報の取り扱いについて、個人情報の保護に関する法律（以下「個人情報保護法」）その他関連法令に基づき定めるものです。本サービスをご利用いただく前に、本ポリシーを十分にご確認ください。
          </P>

          <Section num="第1条" title="定義">
            <P>本ポリシーにおいて用いる用語の定義は以下のとおりとします。</P>
            <Li n={1}>「個人情報」とは、生存する個人に関する情報であって、当該情報に含まれる氏名、生年月日その他の記述等により特定の個人を識別することができるもの（他の情報と容易に照合することができ、それにより特定の個人を識別することができることとなるものを含む）をいいます。</Li>
            <Li n={2}>「利用者情報」とは、個人情報のほか、ユーザーが本サービスに入力・記録したすべてのデータ（練習記録、身体データ、睡眠記録、食事データ等を含む）をいいます。</Li>
            <Li n={3}>「端末情報」とは、ユーザーが使用するスマートフォン等の端末に関する情報（OS種別、端末識別子、言語設定等）をいいます。</Li>
          </Section>

          <Section num="第2条" title="収集する情報の種類と保存場所">
            <P>当社は、本サービスの提供にあたり、以下の情報を収集・管理します。</P>
            <Table rows={[
              ['プロフィール', '氏名・競技種目・学年・所属（任意）', '端末内のみ'],
              ['練習記録', '種別・距離・疲労度・体調スコア', '端末内のみ'],
              ['タイム記録', '種目・記録・日付', '端末内のみ'],
              ['睡眠データ', '就寝/起床時刻・品質スコア', '端末内のみ'],
              ['食事データ', 'テキスト記録・写真（分析のみ）', '端末内（写真はAPI送信後破棄）'],
              ['痛み報告', '部位・違和感の記録', '端末内 + Supabase（チーム利用時）'],
              ['チームデータ', 'メッセージ・動画URL・体調申告', 'Supabase（クラウド）'],
              ['端末情報', 'OS・アプリバージョン（匿名）', '分析ツールのみ'],
            ]} />
          </Section>

          <Section num="第3条" title="情報の利用目的">
            <P>当社は、収集した利用者情報を以下の目的で利用します。</P>
            <Li n={1}>本サービスの基本機能（練習記録の表示・管理、タイム記録管理、カレンダー表示等）の提供</Li>
            <Li n={2}>怪我リスクスコアの算出（10%ルール、ATL/CTL/TSBアルゴリズムによる統計処理）</Li>
            <Li n={3}>AIによる食事・栄養分析、リカバリーアドバイスの生成（外部APIへの送信を含む）</Li>
            <Li n={4}>チーム機能における、コーチと選手間の情報共有・コミュニケーション支援</Li>
            <Li n={5}>本サービスの品質向上・新機能開発・不具合修正のための統計的分析（個人を特定しない形式での利用）</Li>
            <Li n={6}>プッシュ通知（練習リマインダー、怪我リスク警告等）の配信</Li>
            <Li n={7}>ユーザーサポートへの対応</Li>
            <Li n={8}>法令に基づく対応</Li>
            <P style={{ marginTop: 8 }}>
              当社は、上記の目的の範囲を超えて利用者情報を利用しません。利用目的を変更する場合は、変更後の利用目的について本ポリシーを改訂のうえ告知します。
            </P>
          </Section>

          <Section num="第4条" title="データの保存および管理">
            <Li n={1}>ユーザーが入力した練習記録、タイム、睡眠データ、食事記録等は、原則としてユーザーの端末内（AsyncStorage）にのみ保存されます。当社のサーバーへの自動同期は行いません。</Li>
            <Li n={2}>チーム機能を利用する場合、チームメッセージ、体調申告、動画URLおよびメンバー情報は、クラウドデータベース（Supabase、米国）に保存されます。Supabaseのデータ管理についてはSupabaseのプライバシーポリシーが適用されます。</Li>
            <Li n={3}>当社は、収集した情報の漏洩、滅失、毀損を防止するため、合理的なセキュリティ対策を講じます。ただし、インターネット上での完全なセキュリティを保証するものではありません。</Li>
            <Li n={4}>当社は、利用者情報を正確かつ最新の状態に保つよう努めます。</Li>
          </Section>

          <Section num="第5条" title="第三者提供・外部サービスの利用">
            <P>当社は、以下の場合を除き、ユーザーの同意なく利用者情報を第三者に提供しません。</P>
            <Li>法令に基づく場合</Li>
            <Li>人の生命、身体または財産の保護のために必要がある場合であって、本人の同意を得ることが困難なとき</Li>
            <Li>公衆衛生の向上または児童の健全な育成の推進のために必要がある場合であって、本人の同意を得ることが困難なとき</Li>
            <Li>国の機関若しくは地方公共団体またはその委託を受けた者が法令の定める事務を遂行することに対して協力する必要がある場合</Li>
            <P style={{ marginTop: 12, marginBottom: 8 }}>
              本サービスは、以下の外部サービスを利用します。各サービスへのデータ送信は、本サービスの機能提供に必要な範囲に限定されます。
            </P>
            <View style={s.table}>
              {[
                ['Anthropic Claude API', 'AI分析機能（食事・栄養・リカバリーアドバイス）', 'テキスト・画像（食事写真）', 'anthropic.com/privacy'],
                ['Supabase Inc.', 'チームデータのクラウド保存・同期', 'チームメッセージ・メンバー情報・体調データ', 'supabase.com/privacy'],
                ['OneSignal Inc.', 'プッシュ通知の配信', '端末トークン（匿名）', 'onesignal.com/privacy'],
              ].map(([svc, purpose, data, policy], i) => (
                <View key={i} style={[s.tableRow, { flexDirection: 'column', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' }]}>
                  <Text style={[s.body, { color: '#fff', fontWeight: '700', marginBottom: 3 }]}>{svc}</Text>
                  <Text style={[s.body, { fontSize: 12 }]}>目的：{purpose}</Text>
                  <Text style={[s.body, { fontSize: 12 }]}>送信データ：{data}</Text>
                  <Text style={[s.body, { fontSize: 11, color: TEXT.hint }]}>プライバシーポリシー：{policy}</Text>
                </View>
              ))}
            </View>
          </Section>

          <Section num="第6条" title="AI機能におけるデータの取り扱い">
            <Li n={1}>食事写真をAI分析機能に送信した場合、その画像データはAnthropicのサーバーへ転送されます。分析完了後、当社のサーバー上に画像は保存されません。</Li>
            <Li n={2}>チームメンバーの体調・練習データをもとにAIが生成する分析レポートは、個別の選手を識別できる情報を含む場合があります。コーチはこれらの情報を選手のパフォーマンス管理の目的のみに使用し、第三者への開示は行わないでください。</Li>
            <Li n={3}>AI機能に入力されたテキスト・画像は、Anthropicによりサービス改善目的に使用される場合があります。機微な個人情報（氏名、住所、医療記録等）をAI機能に入力することはお控えください。</Li>
          </Section>

          <Section num="第7条" title="プッシュ通知">
            <Li n={1}>本サービスは、OneSignalを使用してプッシュ通知を配信します。通知の受信には、ユーザーの許可が必要です。</Li>
            <Li n={2}>プッシュ通知の配信にあたり、端末の通知トークンがOneSignalのサーバーに登録されます。この情報により個人を特定することはできません。</Li>
            <Li n={3}>プッシュ通知は、設定画面またはお使いの端末のOS設定からいつでも無効にすることができます。</Li>
          </Section>

          <Section num="第8条" title="Cookieおよびトラッキング技術">
            <Li n={1}>本サービスの無料プランでは、広告配信のためにAdsterra等の広告ネットワークを使用する場合があります。これらのサービスは、Cookie、端末識別子その他のトラッキング技術を使用して、ユーザーに適切な広告を表示することがあります。</Li>
            <Li n={2}>広告によるトラッキングを無効にするには、お使いの端末の「設定」→「プライバシー」→「広告」から「広告トラッキングを制限」を有効にしてください。</Li>
            <Li n={3}>プレミアムプランでは広告表示および広告目的のトラッキングは行いません。</Li>
          </Section>

          <Section num="第9条" title="未成年者の個人情報">
            <Li n={1}>本サービスは、中学生・高校生を含む未成年者の利用を想定しています。13歳未満の方が本サービスを利用する場合は、保護者の同意が必要です。</Li>
            <Li n={2}>保護者の方は、お子様が本サービスに登録した情報について、当社に対して開示・訂正・削除を求めることができます。</Li>
            <Li n={3}>当社が13歳未満の児童の個人情報を収集していることが判明した場合、当社は速やかに当該情報を削除します。</Li>
          </Section>

          <Section num="第10条" title="ユーザーの権利">
            <P>ユーザーは、自己の利用者情報について以下の権利を有します。</P>
            <Li n={1}>開示請求権：当社が保有する個人情報の開示を求めることができます。</Li>
            <Li n={2}>訂正・追加・削除請求権：登録された個人情報が事実と異なる場合、訂正・追加・削除を求めることができます。</Li>
            <Li n={3}>利用停止・消去請求権：当社が個人情報を利用目的の範囲を超えて取り扱っている場合、または不正な手段により取得した場合、利用の停止・消去を求めることができます。</Li>
            <Li n={4}>端末内のデータ削除：本サービスの「設定」→「データを削除」から、端末内に保存されたすべてのデータを削除することができます。</Li>
            <Li n={5}>Supabase保存データの削除：チーム機能を通じてクラウドに保存されたデータの削除を希望する場合は、下記お問い合わせ先までご連絡ください。</Li>
            <P style={{ marginTop: 8 }}>
              上記の請求を行う場合は、本人確認のうえ合理的な期間内に対応します。ただし、法令に基づく保存義務がある場合はこの限りではありません。
            </P>
          </Section>

          <Section num="第11条" title="データ保持期間">
            <Li n={1}>端末内のデータ：ユーザーが削除するか、アプリをアンインストールするまで保持されます。</Li>
            <Li n={2}>チーム機能（Supabase）に保存されたデータ：チームの解散、または削除申請があるまで保持されます。チームに投稿された動画URLは投稿から7日後に自動削除されます。</Li>
            <Li n={3}>プッシュ通知のトークン情報：通知を無効にした時点から30日以内に削除されます。</Li>
          </Section>

          <Section num="第12条" title="越境データ移転">
            <P>
              本サービスは、Supabase（米国）、Anthropic（米国）、OneSignal（米国）等の外部サービスを利用しています。これらのサービスへのデータ送信にあたり、日本国外へのデータ移転が発生します。当社は、適切な契約上の保護措置（データ処理契約等）を通じて、移転先においても適切な個人情報保護水準が維持されるよう努めます。
            </P>
          </Section>

          <Section num="第13条" title="セキュリティ">
            <Li n={1}>当社は、利用者情報への不正アクセス、紛失、破壊、改ざんおよび漏洩を防止するため、合理的な技術的・組織的セキュリティ対策を実施します。</Li>
            <Li n={2}>Supabaseに保存されたチームデータは、行レベルセキュリティ（RLS）により、チームコードを知る者のみがアクセスできる設計とします。</Li>
            <Li n={3}>セキュリティ上の脆弱性を発見した場合は、下記お問い合わせ先までご報告ください。</Li>
          </Section>

          <Section num="第14条" title="本ポリシーの変更">
            <Li n={1}>当社は、本ポリシーを随時改訂することがあります。重要な変更を行う場合は、本サービス内のお知らせ機能またはプッシュ通知等により事前に告知します。</Li>
            <Li n={2}>変更後のポリシーは、告知後に本サービスを継続利用した時点でユーザーが同意したものとみなします。</Li>
            <Li n={3}>常に最新のポリシーは、設定画面の「プライバシーポリシー」からご確認いただけます。</Li>
          </Section>

          <Section num="第15条" title="個人情報保護管理者および苦情・相談窓口">
            <P>個人情報の取り扱いに関するご質問、開示等の請求、苦情・ご相談は、以下の窓口までお問い合わせください。</P>
            <P>個人情報保護管理者：{OPERATOR} 代表</P>
            <P>メールアドレス：{CONTACT}</P>
            <P>受付時間：平日10:00〜18:00（土日祝・年末年始を除く）</P>
            <P style={{ marginTop: 8 }}>
              なお、個人情報の取り扱いについてご不満がある場合、個人情報保護委員会（https://www.ppc.go.jp）に苦情を申し立てることができます。
            </P>
          </Section>

          <View style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.06)', marginVertical: 24 }} />
          <Text style={[s.body, { textAlign: 'center', fontSize: 11 }]}>
            {APP_NAME}　プライバシーポリシー　{LAST_UPDATED} 施行{'\n'}
            本ポリシーは日本語を正文とします。
          </Text>

        </ScrollView>
      </SafeAreaView>
    </View>
  )
}

const s = StyleSheet.create({
  scroll:       { padding: 20, paddingBottom: 60, gap: 4 },
  title:        { color: '#fff', fontSize: 22, fontWeight: '800', marginBottom: 4 },
  meta:         { color: TEXT.hint, fontSize: 12, marginBottom: 16 },
  section:      { marginBottom: 28 },
  sectionTitle: { color: '#fff', fontSize: 14, fontWeight: '800', marginBottom: 10,
                  borderLeftWidth: 3, borderLeftColor: '#E53935', paddingLeft: 10 },
  body:         { color: TEXT.secondary, fontSize: 13, lineHeight: 22 },
  bold:         { color: '#fff', fontWeight: '700' },
  liRow:        { flexDirection: 'row', marginTop: 5, alignItems: 'flex-start' },
  bullet:       { color: '#E53935', fontSize: 12, fontWeight: '700', marginRight: 4, marginTop: 1, minWidth: 28 },
  table:        { borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', borderRadius: 10, overflow: 'hidden', marginTop: 10 },
  tableRow:     { flexDirection: 'row', paddingVertical: 8, paddingHorizontal: 10 },
  tableRowAlt:  { backgroundColor: 'rgba(255,255,255,0.03)' },
  tableHead:    { backgroundColor: 'rgba(229,57,53,0.12)' },
  tableCell:    { color: TEXT.secondary, fontSize: 11, lineHeight: 17 },
  tableCellHead:{ color: '#fff', fontWeight: '700', fontSize: 11 },
})
