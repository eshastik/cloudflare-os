import { Link } from '@tanstack/react-router'
import {
  BookOpen,
  FolderOpen,
  Hexagon,
  House,
  MagnifyingGlass,
  Robot,
  SidebarSimple,
  Tray,
} from '@phosphor-icons/react'
import { useSiteName } from '../../ServerConfigContext'
import SiteLogo from '../SiteLogo'
import { useGatekeeperApps } from '../../useGatekeeperApps'
import { openCommandPalette } from './commandPaletteBus'
import SidebarItem from './SidebarItem'
import {
  SidebarWorkspacesProvider,
  SidebarWorkspacesTools,
  SidebarWorkspacesLists,
} from './SidebarWorkspaces'
import SidebarUtilityStrip from './SidebarUtilityStrip'
import { SectionCount } from './SectionCount'

// Daily work sections of a gatekeeper app, in rail order. Labels are fixed here so the rail reads
// the same whatever an app calls its sections internally.
const PRIMARY_SECTIONS = [
  { id: 'my-work', label: 'Входящие', icon: <Tray size={14} /> },
  { id: 'projects', label: 'Проекты', icon: <FolderOpen size={14} /> },
  { id: 'documents', label: 'Материалы', icon: <BookOpen size={14} /> },
  { id: 'agents', label: 'Агенты', icon: <Robot size={14} /> },
] as const

// The persistent left rail. Three pinned regions sandwich a single scrolling region of lists, so
// the user can always reach Search, primary nav, and the bottom utility strip no matter how many
// workspaces they have.
//
// Layout (top → bottom):
//   • brand row                            pinned
//   • primary nav (Home, Workspaces, …)    pinned
//   • workspace tools (⌘K search)          pinned
//   • Favorites / Recent workspaces        SCROLLS
//   • utility strip (plug, avatar)         pinned
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

  return (
    <aside
      aria-label="Основная навигация"
      className={[
        // Sidebar is the app chrome: a hair greyer than the (lighter) content canvas so the two
        // surfaces read as distinct without a heavy divider.
        'flex h-screen flex-col border-r border-kumo-line bg-kumo-elevated',
        collapsed ? 'w-[56px]' : 'w-[260px]',
        'shrink-0 transition-[width] duration-200 ease-out',
      ].join(' ')}
    >
      {/* Brand row */}
      <div
        className={[
          'flex h-14 shrink-0 items-center border-b border-kumo-line',
          collapsed ? 'justify-center px-1.5' : 'justify-between gap-2 px-3',
        ].join(' ')}
      >
        <Link to="/" aria-label={siteName} className="flex min-w-0 items-center gap-2">
          <SiteLogo size={20} className="shrink-0">
            <Hexagon size={20} weight="bold" className="text-kumo-brand shrink-0" />
          </SiteLogo>
          {!collapsed && (
            <span className="truncate text-[14px] leading-5 font-semibold tracking-[-0.25px] text-kumo-default">
              {siteName}
            </span>
          )}
        </Link>
        {!collapsed && (
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => openCommandPalette()}
              aria-label="Поиск"
              title="Поиск (⌘K)"
              className="press flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-kumo-inactive transition-colors hover:bg-kumo-tint hover:text-kumo-default"
            >
              <MagnifyingGlass size={15} />
            </button>
            <button
              type="button"
              onClick={onToggleCollapsed}
              aria-label="Свернуть панель"
              title="Свернуть панель"
              className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-kumo-inactive transition-colors hover:bg-kumo-tint hover:text-kumo-default"
            >
              <SidebarSimple size={15} />
            </button>
          </div>
        )}
      </div>

      {/* Expand affordance when collapsed — placed just under the logo for discoverability. */}
      {collapsed && (
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label="Развернуть панель"
          title="Развернуть панель"
          className="mx-auto mt-2 flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-kumo-inactive transition-colors hover:bg-kumo-tint hover:text-kumo-default"
        >
          <SidebarSimple size={15} className="rotate-180" />
        </button>
      )}

      <SidebarWorkspacesProvider>
        {/* Pinned top stack. shrink-0 keeps it from squishing when the lists below grow. */}
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pt-3">
          {/* Primary nav: the few places people work every day. Service sections live in Settings. */}
          <nav className="flex flex-col gap-0.5 px-2">
            <SidebarItem
              to="/"
              label="Новая беседа"
              icon={<House size={14} weight="regular" />}
              collapsed={collapsed}
            />
            {gatekeeperApps.flatMap(app => {
              const multiple = gatekeeperApps.filter(other => other.id === app.id).length > 1
              return PRIMARY_SECTIONS.flatMap(({ id, label, icon }) => {
                const section = (app.sections ?? []).find(item => item.id === id)
                if (!section) return []
                return [
                  <SidebarItem
                    key={`${app.id}:${app.accountId}:${id}`}
                    to="/gatekeepers/$appId"
                    params={{ appId: app.id }}
                    search={{ section: id, account: app.accountId }}
                    section={id}
                    account={app.accountId}
                    matchDefaultAccount={!multiple}
                    label={multiple ? `${label} — ${app.accountName || app.title}` : label}
                    icon={icon}
                    trailing={<SectionCount count={section.count} />}
                    collapsed={collapsed}
                  />,
                ]
              })
            })}
          </nav>

          {/* Workspace tools: search. Pinned so it's always reachable. */}
          <SidebarWorkspacesTools collapsed={collapsed} />
        </div>

        {/* Scrolling middle: only the Favorites / Recent workspaces / Recent blueprints lists.
            min-h-0 lets flex children compute scroll height correctly. */}
        <div className="sidebar-scroll mt-1 min-h-0 flex-1 overflow-y-auto">
          <SidebarWorkspacesLists collapsed={collapsed} />
        </div>
      </SidebarWorkspacesProvider>

      <SidebarUtilityStrip collapsed={collapsed} />
    </aside>
  )
}

