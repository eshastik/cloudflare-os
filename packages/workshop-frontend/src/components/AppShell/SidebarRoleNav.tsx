import type { ReactNode } from 'react'
import {
  FolderSimple, Plugs, Pulse, Robot, Scales, Tray, UsersThree, UserCircleGear,
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

// Разделы администратора внизу меню: под тонкой линией, плоским списком, без раскрывающегося
// пункта. Один пункт — одна страница.
export function SidebarManagement({ management, collapsed }: {
  management: NavLink[]
  collapsed: boolean
}) {
  return (
    <nav aria-label="Управление" className={`flex shrink-0 flex-col gap-0.5 border-t border-kumo-fill py-2 ${collapsed ? 'px-2' : 'px-3.5'}`}>
      {!collapsed && <p className="m-0 px-3 pt-1 pb-1.5 text-[13px] leading-4 text-kumo-subtle">Управление</p>}
      {management.map(link => <NavLinkItem key={link.key} link={link} collapsed={collapsed} compact />)}
    </nav>
  )
}
