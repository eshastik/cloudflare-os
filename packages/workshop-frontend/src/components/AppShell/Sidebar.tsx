import { Link } from '@tanstack/react-router'
import {
  Hexagon,
  MagnifyingGlass,
  Plus,
  SidebarSimple,
} from '@phosphor-icons/react'
import { useSiteName } from '../../ServerConfigContext'
import SiteLogo from '../SiteLogo'
import { useGatekeeperApps } from '../../useGatekeeperApps'
import { buildRoleNavigation } from '../../roleNavigation'
import { NavLinkItem, SidebarManagement } from './SidebarRoleNav'
import { openCommandPalette } from './commandPaletteBus'
import SidebarItem from './SidebarItem'
import {
  SidebarWorkspacesProvider,
  SidebarWorkspacesLists,
} from './SidebarWorkspaces'
import SidebarUtilityStrip from './SidebarUtilityStrip'


// Левая панель по макету Sidebar (редизайн 24.09.2026). Сверху вниз:
//   • логотип и название, кнопка сворачивания        закреплено
//   • строка «Поиск ⌘K» — открывает палитру поиска    закреплено
//   • Новая беседа, Входящие, Проекты, Мой отдел       закреплено
//   • недавние беседы                                  ПРОКРУЧИВАЕТСЯ
//   • разделы администратора плоским списком            закреплено
//   • «Настройки» с аватаром                            закреплено
export default function Sidebar({
  collapsed,
  onToggleCollapsed,
}: {
  collapsed: boolean
  onToggleCollapsed: () => void
}) {
  const siteName = useSiteName()
  // Gatekeeper-served management apps the user can reach now (one per gatekeeper that provides a UI
  // and is connected / enabled for everyone). Disabled or not-yet-connected ones aren't returned, so
  // they simply don't appear. The set is fully dynamic — no gatekeeper is hardcoded.
  const gatekeeperApps = useGatekeeperApps()
  // Пункты меню по роли: сотрудник, руководитель, администратор (см. roleNavigation.ts).
  const navigation = buildRoleNavigation(gatekeeperApps)

  return (
    <aside
      aria-label="Основная навигация"
      className={[
        'flex h-screen flex-col border-r border-kumo-fill bg-kumo-base pt-5',
        collapsed ? 'w-[56px]' : 'w-[248px]',
        'shrink-0 transition-[width] duration-200 ease-out',
      ].join(' ')}
    >
      {/* Логотип и название */}
      <div
        className={[
          'flex shrink-0 items-center',
          collapsed ? 'flex-col gap-2 px-2 pb-3' : 'gap-2.5 pr-3.5 pb-[18px] pl-6 pt-1',
        ].join(' ')}
      >
        <Link to="/" aria-label={siteName} className="flex min-w-0 flex-1 items-center gap-2.5">
          <SiteLogo size={22} className="shrink-0">
            <Hexagon size={22} className="shrink-0 text-kumo-brand" />
          </SiteLogo>
          {!collapsed && (
            <span className="truncate text-[17px] leading-6 font-bold tracking-[-0.3px] text-kumo-default">
              {siteName}
            </span>
          )}
        </Link>
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? 'Развернуть панель' : 'Свернуть панель'}
          title={collapsed ? 'Развернуть панель' : 'Свернуть панель'}
          className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-kumo-inactive transition-colors hover:bg-kumo-tint hover:text-kumo-default"
        >
          <SidebarSimple size={16} className={collapsed ? 'rotate-180' : ''} />
        </button>
      </div>

      {/* Поиск ⌘K: одна строка вместо раздела «Материалы» — найти беседу, проект или файл. */}
      <div className={collapsed ? 'flex shrink-0 justify-center px-2 pb-2' : 'shrink-0 px-3.5 pb-2'}>
        <button
          type="button"
          onClick={() => openCommandPalette()}
          aria-label="Поиск"
          title="Поиск (⌘K)"
          className={[
            'flex cursor-pointer items-center rounded-[10px] border border-kumo-fill bg-kumo-overlay text-kumo-subtle transition-colors hover:border-kumo-fill-hover hover:text-kumo-default focus-visible:outline-2 focus-visible:outline-kumo-ring',
            collapsed ? 'h-9 w-9 justify-center' : 'h-[38px] w-full gap-2.5 px-3 text-[14px]',
          ].join(' ')}
        >
          <MagnifyingGlass size={16} className="shrink-0" />
          {!collapsed && (
            <>
              <span className="flex-1 text-left">Поиск</span>
              <span className="text-[12px]">⌘K</span>
            </>
          )}
        </button>
      </div>

      <SidebarWorkspacesProvider>
        <nav aria-label="Разделы" className={`flex shrink-0 flex-col gap-1 ${collapsed ? 'px-2' : 'px-3.5'}`}>
          <SidebarItem
            to="/"
            label="Новая беседа"
            icon={<Plus size={18} />}
            collapsed={collapsed}
          />
          {navigation.primary.map(link => <NavLinkItem key={link.key} link={link} collapsed={collapsed} />)}
          {navigation.manager.map(link => <NavLinkItem key={link.key} link={link} collapsed={collapsed} />)}
        </nav>

        {/* Недавние беседы. min-h-0 даёт списку прокручиваться внутри колонки. */}
        <div className="sidebar-scroll mt-5 min-h-0 flex-1 overflow-y-auto">
          <SidebarWorkspacesLists collapsed={collapsed} />
        </div>
      </SidebarWorkspacesProvider>

      {navigation.management.length > 0 && (
        <SidebarManagement management={navigation.management} collapsed={collapsed} />
      )}

      <SidebarUtilityStrip collapsed={collapsed} />
    </aside>
  )
}
