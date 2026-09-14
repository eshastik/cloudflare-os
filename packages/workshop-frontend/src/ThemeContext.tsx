import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  applyThemeMode,
  applyAccentColor, readAccentChoice, writeAccentChoice, resolveAccentColor, type AccentChoice,
  readThemeMode,
  resolveThemeMode,
  writeThemeMode,
  type ResolvedThemeMode,
  type ThemeMode,
} from './theme'

interface ThemeContextValue {
  accentColor: string
  accentChoice: AccentChoice | null
  accentSaved: boolean
  setAccentChoice: (choice: AccentChoice) => void
  themeMode: ThemeMode
  resolvedThemeMode: ResolvedThemeMode
  setThemeMode: (mode: ThemeMode) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function getInitialThemeState() {
  const themeMode = readThemeMode()
  return { themeMode, resolvedThemeMode: resolveThemeMode(themeMode) }
}

export function ThemeProvider({ children, deploymentAccentColor }: { children: ReactNode; deploymentAccentColor?: string | null }) {
  const [accentChoice, setAccentChoiceState] = useState(readAccentChoice)
  const [accentSaved, setAccentSaved] = useState(true)
  const accentColor = resolveAccentColor(accentChoice, deploymentAccentColor)
  useEffect(() => {applyAccentColor(accentColor)}, [accentColor])
  const [themeState, setThemeState] = useState(getInitialThemeState)
  const { themeMode, resolvedThemeMode } = themeState

  useEffect(() => {
    if (themeMode !== 'system') {
      applyThemeMode(themeMode)
      return
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = () => {
      const nextResolved = applyThemeMode('system')
      setThemeState((prev) => prev.resolvedThemeMode === nextResolved
        ? prev
        : { ...prev, resolvedThemeMode: nextResolved })
    }
    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [themeMode])

  const value = useMemo<ThemeContextValue>(() => ({
    accentColor, accentChoice, accentSaved,
    setAccentChoice: choice => {setAccentSaved(writeAccentChoice(choice));setAccentChoiceState(choice);applyAccentColor(resolveAccentColor(choice));},
    themeMode,
    resolvedThemeMode,
    setThemeMode: (mode) => {
      writeThemeMode(mode)
      setThemeState({ themeMode: mode, resolvedThemeMode: applyThemeMode(mode) })
    },
  }), [themeMode, resolvedThemeMode, accentColor, accentChoice, accentSaved])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used within ThemeProvider')
  return context
}
