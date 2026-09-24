import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { CaretRight } from '@phosphor-icons/react'
import AppearanceSettings from './components/AppearanceSettings'
import { useAuthenticatedApi } from './AuthContext'
import { useAvatar } from './useAvatar'
import { useTheme } from './ThemeContext'
import type { ThemeMode } from './theme'
import { useDocumentTitle } from './useDocumentTitle'
import { personInitials } from './components/AppShell/initials'
import { GROUP_CARD, SECONDARY_PILL, SECTION_TITLE } from './components/AppShell/pageStyles'

// Настройки (макет Settings): одна страница, секции друг под другом, без вложенных вкладок.
// Личное — профиль, оформление, свои результаты. Организационное (люди, правила, подключения,
// агенты, журнал) живёт в разделах администратора в меню; здесь у администратора только служебные
// страницы оболочки, которых нет в разделах приложения, — модели и подключения сервисов.

const THEMES: [ThemeMode, string][] = [['light', 'Светлая'], ['dark', 'Тёмная'], ['system', 'Как в системе']]

export default function SettingsHub() {
  useDocumentTitle('Настройки')
  const { authenticatedApi, currentUser, isAdmin, logout } = useAuthenticatedApi()
  const avatarUrl = useAvatar(authenticatedApi, currentUser?.id)
  const { themeMode, setThemeMode } = useTheme()
  const [accentOpen, setAccentOpen] = useState(false)

  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-[26px] px-4 py-11 sm:px-0">
      <h1 className="m-0 text-[34px] leading-10 font-semibold tracking-[-1px] text-kumo-default">Настройки</h1>

      <section aria-label="Профиль" className="flex items-center gap-4 rounded-[18px] border border-kumo-fill bg-kumo-overlay px-[22px] py-5">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-selection-bg text-[20px] font-semibold text-selection-text">
          {avatarUrl ? <img src={avatarUrl} alt="" className="h-full w-full object-cover" /> : personInitials(currentUser?.name)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[17px] leading-6 font-semibold text-kumo-default">{currentUser?.name || 'Профиль'}</div>
          <div className="mt-[3px] text-[14px] text-kumo-subtle">{isAdmin ? 'Администратор' : 'Имя, фотография и пароль'}</div>
        </div>
        <Link to="/profile" className={SECONDARY_PILL}>Изменить</Link>
      </section>

      <section aria-label="Оформление" className="flex flex-col gap-2.5">
        <h2 className={SECTION_TITLE}>Оформление</h2>
        <div role="radiogroup" aria-label="Тема" className="grid grid-cols-3 rounded-[14px] bg-kumo-tint p-1">
          {THEMES.map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={themeMode === mode}
              onClick={() => setThemeMode(mode)}
              className={[
                'h-10 cursor-pointer rounded-[10px] text-[14px] transition-colors focus-visible:outline-2 focus-visible:outline-kumo-ring',
                themeMode === mode ? 'bg-kumo-overlay font-semibold text-kumo-default shadow-[0_1px_3px_rgba(24,32,28,0.12)]' : 'text-kumo-default hover:text-kumo-strong',
              ].join(' ')}
            >
              {label}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => setAccentOpen(true)} className="self-start cursor-pointer text-[14px] text-kumo-link hover:underline">
          Цвет акцента
        </button>
      </section>

      <section aria-label="Работа" className="flex flex-col gap-2.5">
        <h2 className={SECTION_TITLE}>Работа</h2>
        <div className={GROUP_CARD}>
          <RowLink to="/outputs" title="Результаты бесед" note="Документы и файлы, которые получились в ваших беседах." />
        </div>
      </section>

      {isAdmin && (
        <section aria-label="Для администратора" className="flex flex-col gap-2.5">
          <h2 className={SECTION_TITLE}>Для администратора</h2>
          <div className={GROUP_CARD}>
            <RowLink to="/providers" title="Модели" note="Какие модели доступны агентам и сколько они стоят." />
            <RowLink to="/gatekeepers" title="Подключения сервисов" note="Сервисы, к которым подключена установка." />
            <RowLink to="/admin" title="Настройки платформы" note="Служебные настройки всей установки." />
          </div>
        </section>
      )}

      <button type="button" onClick={logout} className="mt-2 self-start cursor-pointer py-2 text-[14px] text-kumo-danger hover:underline">
        Выйти
      </button>

      {accentOpen && <AppearanceSettings open={accentOpen} onOpenChange={setAccentOpen} />}
    </div>
  )
}

function RowLink({ to, title, note }: { to: '/outputs' | '/providers' | '/gatekeepers' | '/admin'; title: string; note: string }) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 border-b border-kumo-tint px-[18px] py-3.5 transition-colors last:border-b-0 hover:bg-kumo-tint focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-kumo-ring"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] leading-5 text-kumo-default">{title}</span>
        <span className="block text-[13px] leading-5 text-kumo-subtle">{note}</span>
      </span>
      <CaretRight size={14} className="shrink-0 text-kumo-subtle" aria-hidden="true" />
    </Link>
  )
}
