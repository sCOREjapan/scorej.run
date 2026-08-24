// context/LanguageContext.tsx — アプリ表示言語（日本語/英語）のグローバル管理
import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import i18n from '../lib/i18n'

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
