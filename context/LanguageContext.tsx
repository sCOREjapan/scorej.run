// context/LanguageContext.tsx — アプリ表示言語（日本語/英語）のグローバル管理
import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import i18n from '../lib/i18n'
import { getDeviceLocale } from '../lib/deviceLocale'
import { trackOnboardingStep } from '../lib/analytics'

export type Language = 'ja' | 'en'

const LANGUAGE_KEY = 'score_language_v1'

interface LanguageContextType {
  language: Language
  languageLoaded: boolean       // AsyncStorage読み込みが完了したか
  hasSelectedLanguage: boolean  // 初回言語選択画面を通過済みか
  setLanguage: (lang: Language) => Promise<void>
}

const LanguageContext = createContext<LanguageContextType>({
  language: 'ja',
  languageLoaded: false,
  hasSelectedLanguage: false,
  setLanguage: async () => {},
})

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>('ja')
  const [languageLoaded, setLanguageLoaded] = useState(false)
  const [hasSelectedLanguage, setHasSelectedLanguage] = useState(false)

  useEffect(() => {
    AsyncStorage.getItem(LANGUAGE_KEY).then(saved => {
      if (saved === 'ja' || saved === 'en') {
        setLanguageState(saved)
        i18n.changeLanguage(saved)
        setHasSelectedLanguage(true)
        setLanguageLoaded(true)
        return
      }
      // 2026-09-07: 端末言語が日本語なら選択画面を出さず自動でjaにする。
      // 2026-09-07 追記: 当初は端末が英語ならenも自動選択していたが、
      // 「起動したら英語になっていた」という報告を受けて撤回した。
      // このアプリの既定言語は常に日本語であるべきで、英語への自動切り替えは
      // 危険（端末のロケール判定を誤ると、日本語ユーザーが英語で使うことになる）。
      // 日本語以外の端末は、これまで通り選択画面で本人に選んでもらう。
      const deviceLocale = getDeviceLocale().toLowerCase()
      const detected: Language | null = deviceLocale.startsWith('ja') ? 'ja' : null
      if (detected) {
        setLanguageState(detected)
        i18n.changeLanguage(detected)
        setHasSelectedLanguage(true)
        AsyncStorage.setItem(LANGUAGE_KEY, detected).catch(() => {})
        trackOnboardingStep('language_selected', { lang: detected, auto: true })
      }
      setLanguageLoaded(true)
    }).catch(() => setLanguageLoaded(true))
  }, [])

  const setLanguage = useCallback(async (lang: Language) => {
    setLanguageState(lang)
    setHasSelectedLanguage(true)
    await i18n.changeLanguage(lang)
    await AsyncStorage.setItem(LANGUAGE_KEY, lang).catch(() => {})
  }, [])

  return (
    <LanguageContext.Provider value={{ language, languageLoaded, hasSelectedLanguage, setLanguage }}>
      {children}
    </LanguageContext.Provider>
  )
}

export const useLanguage = () => useContext(LanguageContext)
