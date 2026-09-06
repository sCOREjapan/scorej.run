// context/ThemeContext.tsx — アプリ表示テーマ（ライト/ダーク）のグローバル管理
import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'

export type ColorScheme = 'light' | 'dark'

export interface ThemeColors {
  bg:       string
  surface:  string
  surface2: string
  border:   string
  text:     string
  textSec:  string
  textHint: string
  card:     string
  inputBg:  string
  switchTrack: string
}

export const LIGHT: ThemeColors = {
  bg:       '#f6f6f8',
  surface:  '#ffffff',
  surface2: '#f0f2f5',
  border:   'rgba(0,0,0,0.08)',
  text:     '#111827',
  textSec:  '#6b7280',
  textHint: '#9ca3af',
  card:     '#ffffff',
  inputBg:  '#f8f8fa',
  switchTrack: '#e5e7eb',
}

export const DARK: ThemeColors = {
  bg:       '#13111c',
  surface:  '#1e1b2e',
  surface2: '#252140',
  border:   'rgba(255,255,255,0.08)',
  text:     '#ffffff',
  textSec:  '#b5aed0',
  textHint: '#8b85a8',
  card:     '#1e1b2e',
  inputBg:  '#231d38',
  switchTrack: 'rgba(255,255,255,0.16)',
}

const SCHEME_KEY = 'score_color_scheme_v1'

interface ThemeCtx {
  scheme: ColorScheme
  colors: ThemeColors
  schemeLoaded: boolean
  setScheme: (s: ColorScheme) => void
  toggle: () => void
}

const ThemeContext = createContext<ThemeCtx>({
  scheme: 'light',
  colors: LIGHT,
  schemeLoaded: false,
  setScheme: () => {},
  toggle: () => {},
})

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [scheme, setSchemeState] = useState<ColorScheme>('light')
  const [schemeLoaded, setSchemeLoaded] = useState(false)

  useEffect(() => {
    AsyncStorage.getItem(SCHEME_KEY).then(saved => {
      if (saved === 'light' || saved === 'dark') setSchemeState(saved)
      setSchemeLoaded(true)
    }).catch(() => setSchemeLoaded(true))
  }, [])

  const colors = scheme === 'dark' ? DARK : LIGHT

  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.body.style.backgroundColor = colors.bg
    }
  }, [colors.bg])

  const setScheme = useCallback((s: ColorScheme) => {
    setSchemeState(s)
    AsyncStorage.setItem(SCHEME_KEY, s).catch(() => {})
  }, [])

  const toggle = useCallback(() => {
    setSchemeState(prev => {
      const next: ColorScheme = prev === 'dark' ? 'light' : 'dark'
      AsyncStorage.setItem(SCHEME_KEY, next).catch(() => {})
      return next
    })
  }, [])

  return (
    <ThemeContext.Provider value={{ scheme, colors, schemeLoaded, setScheme, toggle }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
