import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  APPEARANCE_CACHE_KEY,
  applyThemeMode,
  applyAccentColor, DEFAULT_ACCENT_COLOR, resolveAccentColor, type AccentChoice,
  clearCachedAppearance,
  EMPTY_APPEARANCE,
  readCachedAppearance,
  resolveThemeMode,
  writeCachedAppearance,
  type ResolvedThemeMode,
  type ThemeMode,
} from './theme'
import { isAccentHex, parseAppearancePreference, type AppearancePreference } from '@gadgets/workshop-shared/accent-theme'
import { LOGOUT_EVENT } from './authNavigation'

/** Часть API аккаунта, через которую оформление читается и сохраняется. */
export interface AppearanceAccount {
  getAppearance(): Promise<AppearancePreference | null>
  setAppearance(appearance: AppearancePreference): Promise<void>
}

interface ThemeContextValue {
  accentColor: string
  accentChoice: AccentChoice | null
  /** false, если последний выбор не удалось сохранить в аккаунт. */
  accentSaved: boolean
  setAccentChoice: (choice: AccentChoice) => void
  /** Временный показ цвета (предпросмотр в настройках платформы); null возвращает действующий цвет. */
  previewAccentColor: (color: string | null) => void
  /** Общий цвет установки после сохранения администратором: действует, пока нет личного выбора. */
  setDeploymentAccentColor: (color: string) => void
  themeMode: ThemeMode
  resolvedThemeMode: ResolvedThemeMode
  setThemeMode: (mode: ThemeMode) => void
  /** Связывает оформление с аккаунтом вошедшего человека; возвращает отвязку. */
  attachAccount: (userId: string, account: AppearanceAccount) => () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

const hasChoice = (value: AppearancePreference) => value.accent !== null || value.themeMode !== null

export function ThemeProvider({ children, deploymentAccentColor }: { children: ReactNode; deploymentAccentColor?: string | null }) {
  // Кэш применяется сразу, до ответа сервера, чтобы оформление не мигало при загрузке.
  const [appearance, setAppearanceState] = useState<AppearancePreference>(() => readCachedAppearance().appearance)
  const appearanceRef = useRef(appearance)
  const accountRef = useRef<{ userId: string; account: AppearanceAccount; touched: boolean } | null>(null)
  const [accentSaved, setAccentSaved] = useState(true)
  const [savedDeploymentAccent, setSavedDeploymentAccent] = useState<string | null>(null)
  const [accentPreview, setAccentPreview] = useState<string | null>(null)

  const show = useCallback((next: AppearancePreference) => {
    appearanceRef.current = next
    setAppearanceState(next)
  }, [])

  const accentChoice = appearance.accent
  const themeMode: ThemeMode = appearance.themeMode ?? 'system'
  const accentColor = resolveAccentColor(accentChoice, savedDeploymentAccent ?? deploymentAccentColor)
  // Корень документа меняет только провайдер: прямой вызов applyAccentColor из экрана расходился
  // с состоянием, и после ухода из настроек платформы личный цвет пропадал до перезагрузки.
  const appliedAccent = accentPreview ?? accentColor
  useEffect(() => {applyAccentColor(appliedAccent)}, [appliedAccent])
  const previewAccentColor = useCallback((color: string | null) => setAccentPreview(color && isAccentHex(color) ? color : null), [])
  const setDeploymentAccentColor = useCallback((color: string) => setSavedDeploymentAccent(isAccentHex(color) ? color : DEFAULT_ACCENT_COLOR), [])
  const [systemMode, setSystemMode] = useState<ResolvedThemeMode>(() => resolveThemeMode('system'))
  const resolvedThemeMode: ResolvedThemeMode = themeMode === 'system' ? systemMode : themeMode

  useEffect(() => {
    applyThemeMode(themeMode)
    if (themeMode !== 'system') return
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = () => setSystemMode(applyThemeMode('system'))
    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [themeMode])

  const choose = useCallback((patch: Partial<AppearancePreference>) => {
    const next = { ...appearanceRef.current, ...patch }
    show(next)
    const bound = accountRef.current
    if (!bound) { writeCachedAppearance(null, next); return }
    bound.touched = true
    writeCachedAppearance(bound.userId, next)
    bound.account.setAppearance(next).then(
      () => { if (accountRef.current === bound) setAccentSaved(true) },
      () => { if (accountRef.current === bound) setAccentSaved(false) },
    )
  }, [show])

  const attachAccount = useCallback((userId: string, account: AppearanceAccount) => {
    const bound = { userId, account, touched: false }
    accountRef.current = bound
    setAccentSaved(true)
    const cached = readCachedAppearance()
    // Свой кэш или выбор прежней версии можно перенести в пустой аккаунт; чужой — нельзя и показывать.
    const local = cached.user === null || cached.user === userId ? cached.appearance : EMPTY_APPEARANCE
    if (cached.user !== null && cached.user !== userId) show(EMPTY_APPEARANCE)
    account.getAppearance().then(answer => {
      const stored = parseAppearancePreference(answer)
      // Выбор, сделанный до ответа сервера, уже ушёл в аккаунт и новее ответа.
      if (accountRef.current !== bound || bound.touched) return
      if (stored) {
        show(stored)
        writeCachedAppearance(userId, stored)
        return
      }
      writeCachedAppearance(userId, local)
      if (hasChoice(local)) {
        show(local)
        account.setAppearance(local).catch(() => { if (accountRef.current === bound) setAccentSaved(false) })
      }
    }, () => { /* сервер недоступен: остаётся кэш, сверка при следующей загрузке */ })
    return () => { if (accountRef.current === bound) accountRef.current = null }
  }, [show])

  useEffect(() => {
    const onLogout = () => {
      accountRef.current = null
      clearCachedAppearance()
      show(EMPTY_APPEARANCE)
    }
    // Другая вкладка того же браузера сменила выбор того же человека: применяем без перезагрузки.
    const onStorage = (event: StorageEvent) => {
      if (event.key !== APPEARANCE_CACHE_KEY) return
      const cached = readCachedAppearance()
      if (accountRef.current && cached.user === accountRef.current.userId) show(cached.appearance)
    }
    window.addEventListener(LOGOUT_EVENT, onLogout)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(LOGOUT_EVENT, onLogout)
      window.removeEventListener('storage', onStorage)
    }
  }, [show])

  const value = useMemo<ThemeContextValue>(() => ({
    accentColor, accentChoice, accentSaved,
    setAccentChoice: choice => choose({ accent: choice }),
    previewAccentColor, setDeploymentAccentColor,
    themeMode,
    resolvedThemeMode,
    setThemeMode: mode => choose({ themeMode: mode }),
    attachAccount,
  }), [themeMode, resolvedThemeMode, accentColor, accentChoice, accentSaved, previewAccentColor, setDeploymentAccentColor, choose, attachAccount])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used within ThemeProvider')
  return context
}

/** Сверяет оформление с аккаунтом после входа. Вне ThemeProvider ничего не делает. */
export function useAccountAppearance(account: AppearanceAccount, userId: string | null | undefined): void {
  const attach = useContext(ThemeContext)?.attachAccount
  useEffect(() => {
    if (!attach || !userId) return
    return attach(userId, account)
  }, [attach, account, userId])
}
