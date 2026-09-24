import { useState, type ReactNode } from 'react'
import {
  BookOpen, CaretRight, ChartBar, CheckSquare, Database, FolderOpen, GearSix, Plugs, Pulse,
  Robot, Stack, Tray, UsersThree, UserCircleGear,
} from '@phosphor-icons/react'
import SidebarItem, { type SidebarItemProps } from './SidebarItem'
import { SectionCount } from './SectionCount'
import type { NavIcon, NavLink } from '../../roleNavigation'

const ICONS: Record<NavIcon, ReactNode> = {
  inbox: <Tray size={14} />,
  projects: <FolderOpen size={14} />,
  documents: <BookOpen size={14} />,
  approvals: <CheckSquare size={14} />,
  team: <UsersThree size={14} />,
  people: <UserCircleGear size={14} />,
  data: <Database size={14} />,
  agents: <Robot size={14} />,
  organization: <Pulse size={14} />,
  sources: <Plugs size={14} />,
  templates: <Stack size={14} />,
  analytics: <ChartBar size={14} />,
  platform: <GearSix size={14} />,
}

// Один пункт меню: раздел приложения или страница оболочки.
export function NavLinkItem({ link, collapsed }: { link: NavLink; collapsed: boolean }) {
  if (link.to) {
    return <SidebarItem to={link.to as SidebarItemProps['to']} label={link.label} icon={ICONS[link.icon]} collapsed={collapsed} />
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
      icon={ICONS[link.icon]}
      trailing={<SectionCount count={link.count} />}
      collapsed={collapsed}
    />
  )
}

// «Управление» администратора внизу меню. Раскрывается по щелчку; «Тонкие настройки» внутри
// свёрнуты отдельно, чтобы редкие разделы не мешали основным.
export function SidebarManagement({ management, fine, collapsed }: {
  management: NavLink[]
  fine: NavLink[]
  collapsed: boolean
}) {
  const [open, setOpen] = useState(false)
  const [fineOpen, setFineOpen] = useState(false)
  const toggleClass = 'flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] leading-[18px] tracking-[-0.25px] text-kumo-default transition-colors hover:bg-kumo-tint focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-kumo-ring'

  if (collapsed) {
    // В узкой панели подписей нет: основные пункты управления — иконками, тонкие — в настройках.
    return (
      <nav aria-label="Управление" className="flex shrink-0 flex-col gap-0.5 border-t border-kumo-line px-2 py-2">
        {management.map(link => <NavLinkItem key={link.key} link={link} collapsed />)}
      </nav>
    )
  }

  return (
    <nav aria-label="Управление" className="max-h-[50vh] shrink-0 overflow-y-auto border-t border-kumo-line px-2 py-2">
      <button type="button" aria-expanded={open} onClick={() => setOpen(v => !v)} className={toggleClass}>
        <span className="flex h-5 w-5 shrink-0 items-center justify-center text-kumo-subtle">
          <CaretRight size={12} weight="bold" className={`transition-transform duration-150 ${open ? 'rotate-90' : ''}`} />
        </span>
        <span className="min-w-0 flex-1 truncate font-medium">Управление</span>
      </button>
      {open && (
        <div className="flex flex-col gap-0.5">
          {management.map(link => <NavLinkItem key={link.key} link={link} collapsed={false} />)}
          {fine.length > 0 && (
            <>
              <button type="button" aria-expanded={fineOpen} onClick={() => setFineOpen(v => !v)} className={`${toggleClass} text-kumo-subtle`}>
                <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                  <CaretRight size={12} weight="bold" className={`transition-transform duration-150 ${fineOpen ? 'rotate-90' : ''}`} />
                </span>
                <span className="min-w-0 flex-1 truncate">Тонкие настройки</span>
              </button>
              {fineOpen && (
                <div className="flex flex-col gap-0.5 pl-3">
                  {fine.map(link => <NavLinkItem key={link.key} link={link} collapsed={false} />)}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </nav>
  )
}
