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
  bg:       '#0a0a0a',
  surface:  '#111111',
  surface2: '#1a1a1a',
  border:   'rgba(255,255,255,0.08)',
  text:     '#ffffff',
  textSec:  '#888888',
  textHint: '#555555',
  card:     '#111111',
  inputBg:  'rgba(255,255,255,0.06)',
  switchTrack: '#333',
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
      document.body.style.backgroundColor = '#0a0a0a'
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
