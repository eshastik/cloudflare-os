import { Link, useRouterState } from '@tanstack/react-router'
import { Desktop, GearSix, Moon, Sun } from '@phosphor-icons/react'
import { Tooltip } from '@cloudflare/kumo'
import UserMenu from '../UserMenu'
import { useTheme } from '../../ThemeContext'
import type { ThemeMode } from '../../theme'

const THEME_SEQUENCE: ThemeMode[] = ['system', 'light', 'dark']

function nextThemeMode(mode: ThemeMode): ThemeMode {
  return THEME_SEQUENCE[(THEME_SEQUENCE.indexOf(mode) + 1) % THEME_SEQUENCE.length]
}

function ThemeModeButton() {
  const { themeMode, resolvedThemeMode, setThemeMode } = useTheme()
  const names: Record<ThemeMode, string> = { system: 'как в системе', light: 'светлая', dark: 'тёмная' }
  const label = themeMode === 'system'
    ? `Тема: ${names.system} (${names[resolvedThemeMode]})`
    : `Тема: ${names[themeMode]}`
  const nextMode = nextThemeMode(themeMode)

  return (
    <Tooltip
      content={`${label}. Переключить: ${names[nextMode]}.`}
      render={(
        <button
          type="button"
          aria-label={`${label}. Переключить: ${names[nextMode]}.`}
          onClick={() => setThemeMode(nextMode)}
          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-kumo-inactive transition-colors hover:bg-kumo-tint hover:text-kumo-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kumo-ring focus-visible:ring-offset-2 focus-visible:ring-offset-kumo-elevated"
        >
          {themeMode === 'system' ? (
            <Desktop size={15} />
          ) : themeMode === 'dark' ? (
            <Moon size={15} />
          ) : (
            <Sun size={15} />
          )}
        </button>
      )}
    />
  )
}

// Settings is a labelled row, not a bare icon: it is where every service section now lives.
function SettingsLink({ collapsed }: { collapsed: boolean }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const active = pathname === '/settings' || pathname.startsWith('/settings/')
  return (
    <Link
      to="/settings"
      aria-current={active ? 'page' : undefined}
      aria-label={collapsed ? 'Настройки' : undefined}
      title={collapsed ? 'Настройки' : undefined}
      className={[
        'group flex h-8 items-center gap-2 rounded-lg px-2 text-[13px] leading-[18px] tracking-[-0.25px] transition-colors',
        active ? 'bg-kumo-fill font-medium text-kumo-strong' : 'text-kumo-default hover:bg-kumo-tint',
      ].join(' ')}
    >
      <GearSix size={15} className={active ? 'text-kumo-brand' : 'text-kumo-subtle group-hover:text-kumo-default'} />
      {!collapsed && <span>Настройки</span>}
    </Link>
  )
}

export default function SidebarUtilityStrip({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <div
      className={[
        // shrink-0 + solid base so the strip is visually pinned above the scrolling rail body
        // and content can't bleed through it. Flat treatment — no top shadow.
        'shrink-0 flex items-center gap-1 border-t border-kumo-line bg-kumo-elevated px-2 py-2',
        collapsed ? 'flex-col justify-center gap-2 px-1.5' : '',
      ].join(' ')}
    >
      <SettingsLink collapsed={collapsed} />
      <div className={collapsed ? 'flex flex-col items-center gap-2' : 'ml-auto flex items-center gap-1'}>
        <ThemeModeButton />
        <UserMenu />
      </div>
    </div>
  )
}
