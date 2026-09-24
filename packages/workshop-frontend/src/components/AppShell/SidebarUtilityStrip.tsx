import { Link, useRouterState } from '@tanstack/react-router'
import { GearSix } from '@phosphor-icons/react'
import { useAuthenticatedApi } from '../../AuthContext'
import { useAvatar } from '../../useAvatar'
import { personInitials } from './initials'


// Низ панели по макету: одна строка «Настройки» — аватар, имя и шестерёнка. Тема, профиль и выход
// живут на странице настроек, отдельного меню профиля здесь нет.
export default function SidebarUtilityStrip({ collapsed = false }: { collapsed?: boolean }) {
  const { authenticatedApi, currentUser } = useAuthenticatedApi()
  const avatarUrl = useAvatar(authenticatedApi, currentUser?.id)
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const active = pathname === '/settings' || pathname.startsWith('/settings/') || pathname === '/profile'
  const name = currentUser?.name?.trim() || 'Настройки'

  return (
    <div className={`shrink-0 border-t border-kumo-fill bg-kumo-base py-2 ${collapsed ? 'px-2' : 'px-3.5'}`}>
      <Link
        to="/settings"
        aria-current={active ? 'page' : undefined}
        aria-label={`Настройки — ${name}`}
        title={collapsed ? 'Настройки' : undefined}
        className={[
          'group flex items-center rounded-[10px] transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-kumo-ring',
          collapsed ? 'h-10 justify-center' : 'gap-2.5 px-3 py-2',
          active ? 'bg-kumo-fill' : 'hover:bg-kumo-tint',
        ].join(' ')}
      >
        <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center overflow-hidden rounded-full bg-selection-bg text-[13px] font-semibold text-selection-text">
          {avatarUrl ? <img src={avatarUrl} alt="" className="h-full w-full object-cover" /> : personInitials(currentUser?.name)}
        </span>
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1 truncate text-[14px] text-kumo-default">{name}</span>
            <GearSix size={16} className="shrink-0 text-kumo-subtle" aria-hidden="true" />
          </>
        )}
      </Link>
    </div>
  )
}
