// lib/i18n.ts — i18next 初期化（言語は端末検出ではなく LanguagePickerModal での明示選択のみで決まる）
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import ja from '../locales/ja.json'
import en from '../locales/en.json'

i18n.use(initReactI18next).init({
  resources: { ja: { translation: ja }, en: { translation: en } },
  lng: 'ja',
  fallbackLng: 'ja',
  interpolation: { escapeValue: false }, // HTMLではないのでエスケープ不要
  returnNull: false,
})

export default i18n
