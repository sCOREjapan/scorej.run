// lib/useOverlayDismiss.ts — <Modal> をアンマウントで閉じることによるフリーズ対策
//
// 【背景】
//   transparent な <Modal> は iOS では presentationStyle="overFullScreen" の
//   ネイティブ ViewController として present される。これを visible=false で
//   フェードアウトさせずに、親の条件レンダリング（{cond && <Banner/>}）を
//   false にして即アンマウントすると、VC の破棄処理が直後の画面遷移や次の
//   モーダル present と競合し、下の画面がタップに一切反応しなくなる
//   （フリーズする）不具合が出ていた。特にコーチプラン値下げバナーの
//   「詳細」→ router.push('/paywall') のように、閉じると同時に遷移する導線で
//   再現しやすい。
//
// 【対策】
//   Modal を必ず visible=false でいったんフェードアウトさせ、完全に閉じ切って
//   から（iOS は <Modal onDismiss>、Android は onDismiss 非対応なのでフェード
//   相当の遅延後）に、キュー送りや画面遷移などの後処理を実行する。
//
// 【使い方】
//   const { modalProps, close } = useOverlayDismiss(onDismiss)
//   <Modal transparent animationType="fade" {...modalProps}> ... </Modal>
//   <TouchableOpacity onPress={() => close()} />                       // 閉じるだけ
//   <TouchableOpacity onPress={() => close(() => router.push('/x'))} />// 閉じてから遷移
import { useRef, useState } from 'react'
import { Platform } from 'react-native'

// Android の <Modal animationType="fade"> のフェード時間（RN 既定）にあわせた繰り上げ遅延
const ANDROID_FADE_MS = 300

export function useOverlayDismiss(onClosed: () => void) {
  const [visible, setVisible] = useState(true)
  const afterRef = useRef<null | (() => void)>(null)
  const doneRef = useRef(false)

  // Modal が実際に閉じ切ったあとの後処理（1 回だけ）
  const finish = () => {
    if (doneRef.current) return
    doneRef.current = true
    const after = afterRef.current
    afterRef.current = null
    onClosed()      // 親: 既読保存＋キューを次へ／条件を false にしてアンマウント
    after?.()       // 例: router.push('/paywall?plan=coach')
  }

  // フェードアウト開始。afterClose があれば閉じ切ってから実行する
  const close = (afterClose?: () => void) => {
    if (doneRef.current) return
    afterRef.current = afterClose ?? null
    setVisible(false)
    // iOS は modalProps.onDismiss で finish() が呼ばれる。
    // Android は onDismiss が発火しないためフェード相当の時間で繰り上げる。
    if (Platform.OS !== 'ios') setTimeout(finish, ANDROID_FADE_MS)
  }

  const modalProps = {
    visible,
    onRequestClose: () => close(),
    onDismiss: Platform.OS === 'ios' ? finish : undefined,
  }

  return { visible, modalProps, close }
}
