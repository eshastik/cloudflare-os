import { createFileRoute, Link } from '@tanstack/react-router'
import type { GadgetMetadataWithTimestamps } from '@gadgets/workshop-shared/api'
import PendingActions from '../PendingActions'
import { SidebarWorkspacesProvider, useWorkspacesContext } from '../components/AppShell/SidebarWorkspaces'
import SidebarGadgetRow from '../components/AppShell/SidebarGadgetRow'
import { groupByDate } from '../components/AppShell/dateGroups'
import { GROUP_CARD, GROUP_LABEL, PAGE, PAGE_TITLE, PRIMARY_PILL, SEARCH_FIELD } from '../components/AppShell/pageStyles'
import { useDocumentTitle } from '../useDocumentTitle'

// «Все беседы» (макет Chats): заголовок с кнопкой «Новая беседа», поле поиска и простой список
// бесед по датам. Меню строки — то же, что в левой панели.
export const Route = createFileRoute('/workspaces')({
  validateSearch: (search: Record<string, unknown>): { approvals?: boolean } => ({ approvals: search.approvals === true || search.approvals === 'true' }),
  component: WorkspacesPage,
})

function WorkspacesPage() {
  const { approvals } = Route.useSearch()
  useDocumentTitle(approvals ? 'Действия на согласовании' : 'Беседы')
  if (approvals) {
    return (
      <div className={PAGE}>
        <header>
          <h1 className={PAGE_TITLE}>Действия на согласовании</h1>
          <p className="mt-2 mb-0 text-[15px] text-kumo-subtle">Проверьте действия, которым требуется ваше разрешение.</p>
        </header>
        <PendingActions />
      </div>
    )
  }
  return (
    <SidebarWorkspacesProvider>
      <ChatsList />
    </SidebarWorkspacesProvider>
  )
}

function subtitle(gadget: GadgetMetadataWithTimestamps): string | undefined {
  if (gadget.owner) return `Поделился: ${gadget.owner.name}`
  if (gadget.pinned) return 'В избранном'
  return undefined
}

function ChatsList() {
  const { search, setSearch, favorites, recent, gadgetsLoading, gadgetsFailed, onTogglePin, onRename, onShare, onDelete } = useWorkspacesContext()
  const all = [...favorites, ...recent].toSorted((a, b) => b.lastActive.getTime() - a.lastActive.getTime())
  const groups = groupByDate(all, g => g.lastActive)

  return (
    <div className={PAGE}>
      <div className="flex items-center gap-3">
        <h1 className={PAGE_TITLE}>Беседы</h1>
        <Link to="/" className={PRIMARY_PILL}>Новая беседа</Link>
      </div>
      <label htmlFor="chat-find" className="sr-only">Найти беседу</label>
      <input
        id="chat-find"
        type="search"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Найти беседу по названию"
        className={SEARCH_FIELD}
      />
      {gadgetsLoading ? (
        <div className={GROUP_CARD} aria-hidden="true">
          {[0, 1, 2].map(i => <div key={i} className="h-[70px] animate-pulse border-b border-kumo-tint last:border-b-0" />)}
        </div>
      ) : gadgetsFailed ? (
        <p className="py-10 text-center text-[15px] text-kumo-danger">Не удалось загрузить беседы. Обновите страницу.</p>
      ) : groups.length === 0 ? (
        <p className="py-10 text-center text-[15px] text-kumo-subtle">
          {search ? 'Ничего не найдено.' : 'Бесед пока нет. Начните новую — она появится здесь.'}
        </p>
      ) : groups.map(group => (
        <section key={group.label} aria-label={group.label} className="flex flex-col gap-2.5">
          <h2 className={GROUP_LABEL}>{group.label}</h2>
          <div className={GROUP_CARD}>
            {group.items.map(g => (
              <SidebarGadgetRow
                key={g.id}
                gadget={g}
                variant="list"
                subtitle={subtitle(g)}
                onTogglePin={onTogglePin}
                onRename={onRename}
                onShare={onShare}
                onDelete={onDelete}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
