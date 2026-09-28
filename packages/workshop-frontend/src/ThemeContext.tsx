import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  applyThemeMode,
  applyAccentColor, readAccentChoice, DEFAULT_ACCENT_COLOR, writeAccentChoice, resolveAccentColor, type AccentChoice,
  readThemeMode,
  resolveThemeMode,
  writeThemeMode,
  type ResolvedThemeMode,
  type ThemeMode,
} from './theme'
import { isAccentHex } from '@gadgets/workshop-shared/accent-theme'

interface ThemeContextValue {
  accentColor: string
  accentChoice: AccentChoice | null
  accentSaved: boolean
  setAccentChoice: (choice: AccentChoice) => void
  /** Временный показ цвета (предпросмотр в настройках платформы); null возвращает действующий цвет. */
  previewAccentColor: (color: string | null) => void
  /** Общий цвет установки после сохранения администратором: действует, пока нет личного выбора. */
  setDeploymentAccentColor: (color: string) => void
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
  const [savedDeploymentAccent, setSavedDeploymentAccent] = useState<string | null>(null)
  const [accentPreview, setAccentPreview] = useState<string | null>(null)
  const accentColor = resolveAccentColor(accentChoice, savedDeploymentAccent ?? deploymentAccentColor)
  // Корень документа меняет только провайдер: прямой вызов applyAccentColor из экрана расходился
  // с состоянием, и после ухода из настроек платформы личный цвет пропадал до перезагрузки.
  const appliedAccent = accentPreview ?? accentColor
  useEffect(() => {applyAccentColor(appliedAccent)}, [appliedAccent])
  const previewAccentColor = useCallback((color: string | null) => setAccentPreview(color && isAccentHex(color) ? color : null), [])
  const setDeploymentAccentColor = useCallback((color: string) => setSavedDeploymentAccent(isAccentHex(color) ? color : DEFAULT_ACCENT_COLOR), [])
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
    setAccentChoice: choice => {setAccentSaved(writeAccentChoice(choice));setAccentChoiceState(choice);},
    previewAccentColor, setDeploymentAccentColor,
    themeMode,
    resolvedThemeMode,
    setThemeMode: (mode) => {
      writeThemeMode(mode)
      setThemeState({ themeMode: mode, resolvedThemeMode: applyThemeMode(mode) })
    },
  }), [themeMode, resolvedThemeMode, accentColor, accentChoice, accentSaved, previewAccentColor, setDeploymentAccentColor])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used within ThemeProvider')
  return context
}
