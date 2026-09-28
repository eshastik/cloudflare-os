import { useId, useState, type ReactNode } from 'react'
import { useRouterState } from '@tanstack/react-router'
import {
  CaretDown, FolderSimple, Plugs, Pulse, Robot, Scales, Tray, UsersThree, UserCircleGear,
} from '@phosphor-icons/react'
import SidebarItem, { type SidebarItemProps } from './SidebarItem'
import { SectionCount } from './SectionCount'
import type { NavIcon, NavLink } from '../../roleNavigation'

const ICONS: Record<NavIcon, ReactNode> = {
  inbox: <Tray size={18} />,
  projects: <FolderSimple size={18} />,
  team: <UsersThree size={18} />,
  people: <UserCircleGear size={16} />,
  rules: <Scales size={16} />,
  connections: <Plugs size={16} />,
  agents: <Robot size={16} />,
  journal: <Pulse size={16} />,
}

// Один пункт меню: раздел приложения или страница оболочки. compact — малый пункт без иконки
// (разделы администратора в развёрнутой панели).
export function NavLinkItem({ link, collapsed, compact = false }: { link: NavLink; collapsed: boolean; compact?: boolean }) {
  const icon = compact && !collapsed ? null : ICONS[link.icon]
  if (link.to) {
    return <SidebarItem to={link.to as SidebarItemProps['to']} label={link.label} icon={icon} collapsed={collapsed} compact={compact} />
  }
  return (
    <SidebarItem
      to="/gatekeepers/$appId"
      params={{ appId: link.appId! }}
      search={{ section: link.section, account: link.accountId }}
      section={link.section}
      account={link.accountId}
      matchDefaultAccount={link.matchDefaultAccount}
      label={link.label}
      icon={icon}
      trailing={<SectionCount count={link.count} />}
      collapsed={collapsed}
      compact={compact}
    />
  )
}

// Открыт ли сейчас один из разделов списка (тот же признак, что подсветка пункта в SidebarItem).
function useActiveIn(links: NavLink[]): boolean {
  const pathname = useRouterState({ select: s => s.location.pathname })
  const search = useRouterState({ select: s => s.location.search as { section?: string; account?: number } })
  return links.some(link => link.to
    ? pathname === link.to
    : pathname === `/gatekeepers/${link.appId}` && search.section === link.section
      && (search.account === link.accountId || (!!link.matchDefaultAccount && search.account === undefined)))
}

// Разделы администратора внизу меню: под тонкой линией, плоским списком. Один пункт — одна страница.
// foldable — телефон: группа свёрнута в одну строку, пока открытый раздел не из неё, чтобы беседам
// хватило высоты.
export function SidebarManagement({ management, collapsed, foldable = false }: {
  management: NavLink[]
  collapsed: boolean
  foldable?: boolean
}) {
  if (foldable) return <FoldableManagement management={management} />
  return (
    <nav aria-label="Управление" className={`flex shrink-0 flex-col gap-0.5 border-t border-kumo-fill py-2 ${collapsed ? 'px-2' : 'px-3.5'}`}>
      {!collapsed && <p className="m-0 px-3 pt-1 pb-1.5 text-[13px] leading-4 text-kumo-subtle">Управление</p>}
      {management.map(link => <NavLinkItem key={link.key} link={link} collapsed={collapsed} compact />)}
    </nav>
  )
}

function FoldableManagement({ management }: { management: NavLink[] }) {
  // Ящик монтируется заново при каждом открытии, поэтому начального состояния достаточно.
  const active = useActiveIn(management)
  const [expanded, setExpanded] = useState(active)
  const listId = useId()
  return (
    <nav aria-label="Управление" className="flex flex-col gap-0.5 border-t border-kumo-fill px-3.5 py-2">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={listId}
        onClick={() => setExpanded(o => !o)}
        className="flex h-10 cursor-pointer items-center gap-2 rounded-[10px] px-3 text-left text-[14px] text-kumo-subtle transition-colors hover:bg-kumo-tint hover:text-kumo-default focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-kumo-ring"
      >
        <span className="flex-1">Управление</span>
        <CaretDown size={14} aria-hidden="true" className={`shrink-0 transition-transform duration-150 motion-reduce:transition-none ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && (
        <div id={listId} className="flex flex-col gap-0.5">
          {management.map(link => <NavLinkItem key={link.key} link={link} collapsed={false} compact />)}
        </div>
      )}
    </nav>
  )
}
