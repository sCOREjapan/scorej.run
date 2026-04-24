// lib/quickLogEvent.ts — グローバルFABからQuickLogModalを起動するためのブリッジ
type Listener = () => void
let _listener: Listener | null = null

export function setQuickLogListener(fn: Listener) { _listener = fn }
export function clearQuickLogListener()           { _listener = null }
export function triggerQuickLog()                 { _listener?.() }
