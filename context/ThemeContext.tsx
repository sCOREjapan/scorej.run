// context/ThemeContext.tsx — ダークモード固定版
import React, { createContext, useContext, useEffect } from 'react'
import { Platform } from 'react-native'

export type ColorScheme = 'dark'

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

export const DARK: ThemeColors = {
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

// 後方互換のため LIGHT も同じ値でエクスポート
export const LIGHT = DARK

interface ThemeCtx {
  scheme: ColorScheme
  colors: ThemeColors
  toggle: () => void
}

const ThemeContext = createContext<ThemeCtx>({
  scheme: 'dark',
  colors: DARK,
  toggle: () => {},
})

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.body.style.backgroundColor = '#f6f6f8'
    }
  }, [])

  return (
    <ThemeContext.Provider value={{ scheme: 'dark', colors: DARK, toggle: () => {} }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
