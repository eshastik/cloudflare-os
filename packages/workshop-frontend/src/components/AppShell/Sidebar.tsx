import { useAuthenticatedApi } from '../../AuthContext'
import { Link } from '@tanstack/react-router'
import {
  Blueprint,
  BookOpen,
  Compass,
  Hexagon,
  House,
  MagnifyingGlass,
  SidebarSimple,
  SquaresFour,
  Stack,
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
  const { isAdmin } = useAuthenticatedApi()
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
          {/* Primary nav */}
          <nav className="flex flex-col gap-0.5 px-2">
            <SidebarItem
              to="/"
              label="Новый чат"
              icon={<House size={14} weight="regular" />}
              collapsed={collapsed}
            />
            <SidebarItem
              to="/workspaces"
              label="Беседы"
              icon={<SquaresFour size={14} weight="regular" />}
              collapsed={collapsed}
            />
            {gatekeeperApps.filter(app => !app.sections?.length).map(app => (
              <SidebarItem key={`${app.id}:${app.accountId}`} to="/gatekeepers/$appId" params={{ appId: app.id }} search={{account:app.accountId}} account={app.accountId}
                label={app.title} icon={<BookOpen size={14} />} collapsed={collapsed} />
            ))}
            {gatekeeperApps.map(app => {
              const sections = app.sections ?? []
              const managesOrganization = sections.some(section => section.id === 'people' || section.id === 'intake')
              const renderSection = (section: typeof sections[number]) => <SidebarItem key={`${app.id}:${app.accountId}:${section.id}`}
                to="/gatekeepers/$appId" params={{ appId: app.id }} search={{ section: section.id, account:app.accountId }} section={section.id} account={app.accountId} matchDefaultAccount={gatekeeperApps.filter(other=>other.id===app.id).length===1}
                label={section.title} icon={<BookOpen size={14} />} collapsed={collapsed} />
              const core = sections.filter(section => ['my-work', 'documents'].includes(section.id))
              const administration = sections.filter(section => section.group === 'manage' || managesOrganization && ['projects', 'sources'].includes(section.id))
              const extra = sections.filter(section => !core.includes(section) && !administration.includes(section))
              return <div key={`${app.id}:${app.accountId}`} className="space-y-0.5">
                {!collapsed&&gatekeeperApps.filter(other=>other.id===app.id).length>1&&<p className="px-2.5 pt-3 text-xs font-semibold">{app.accountName||app.title}</p>}
                {core.map(renderSection)}
                {administration.length > 0 && <div className="mt-3 space-y-0.5">
                  {!collapsed && <p className="px-2.5 py-1 text-[11px] font-medium text-kumo-subtle">Управление организацией</p>}
                  {administration.map(renderSection)}
                </div>}
                {extra.length > 0 && <details className="mt-2" open={collapsed || undefined}>
                  <summary className="cursor-pointer rounded-lg px-2.5 py-2 text-[12px] text-kumo-subtle hover:bg-kumo-tint" aria-label="Рабочие инструменты">{collapsed ? '•••' : 'Рабочие инструменты'}</summary>
                  {extra.map(renderSection)}
                </details>}
              </div>
            })}
            <SidebarItem to="/outputs" label="Результаты бесед" icon={<Stack size={14} />} collapsed={collapsed} />
            <details className="mt-2" open={collapsed || undefined}>
              <summary className="cursor-pointer rounded-lg px-2.5 py-2 text-[12px] text-kumo-subtle hover:bg-kumo-tint" aria-label="Приложения">{collapsed ? '◇' : 'Приложения'}</summary>
              <SidebarItem to="/blueprints" label="Сохранённые приложения" icon={<Blueprint size={14} />} collapsed={collapsed} />
              <SidebarItem to="/explore" label="Каталог приложений" icon={<Compass size={14} />} collapsed={collapsed} />
            </details>
            {isAdmin && <SidebarItem to="/admin" label="Настройки платформы" icon={<SquaresFour size={14} />} collapsed={collapsed} />}
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
