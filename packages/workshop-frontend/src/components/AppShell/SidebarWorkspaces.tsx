import { reportShellStage } from "../../shellReadiness"
import { logRpcFailure } from '../../rpcErrors'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import { useKumoToastManager } from '@cloudflare/kumo'
import type { RpcStub } from 'capnweb'
import {
  GadgetMetadataWithTimestamps,
  Overseer,
  AiChatAuthorInfo,
} from '@gadgets/workshop-shared/api'
import { useAuthenticatedApi } from '../../AuthContext'
import ShareModal from '../../ShareModal'
import DeleteConfirmationDialog from '../DeleteConfirmationDialog'
import SidebarGadgetRow from './SidebarGadgetRow'

// Cap on items shown in the Recent list before the user clicks through to /workspaces.
const RECENT_INITIAL_LIMIT = 5

// ─────────────────────────────────────────────────────────────────────────────
// Shape of the workspaces state shared by the rail's scrolling lists (Favorites / Recent chats). Centralized here so both sibling components subscribe to
// the same data and the dialog state has a single owner.
// ─────────────────────────────────────────────────────────────────────────────
type WorkspacesContextValue = {
  // Search query, lifted up so the input lives in the pinned area but filters the scrolling lists.
  search: string
  setSearch: (v: string) => void

  gadgets: GadgetMetadataWithTimestamps[]
  gadgetsLoading: boolean
  gadgetsFailed: boolean
  favorites: GadgetMetadataWithTimestamps[]
  recent: GadgetMetadataWithTimestamps[]
  // Беседы в архиве: в боковой панели их нет, «Все беседы» показывает их отдельной группой.
  archived: GadgetMetadataWithTimestamps[]

  onTogglePin: (g: GadgetMetadataWithTimestamps) => void
  onRename: (g: GadgetMetadataWithTimestamps, newTitle: string) => void
  onShare: (g: GadgetMetadataWithTimestamps) => void
  onDelete: (g: GadgetMetadataWithTimestamps) => void
  onToggleArchive: (g: GadgetMetadataWithTimestamps) => void
}

const WorkspacesContext = createContext<WorkspacesContextValue | null>(null)

// Тот же список бесед с действиями (избранное, переименовать, поделиться, удалить) нужен странице
// «Все беседы»; она ставит свой SidebarWorkspacesProvider и читает его через этот хук.
export function useWorkspacesContext(): WorkspacesContextValue {
  const ctx = useContext(WorkspacesContext)
  if (!ctx) throw new Error('Sidebar workspaces components must be rendered inside SidebarWorkspacesProvider')
  return ctx
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider: owns all the data + mutation handlers, plus the share / delete dialogs. Renders its
// children inside its context so SidebarWorkspacesTools and SidebarWorkspacesLists can be placed
// independently in the parent layout (pinned vs. scrolling areas).
// ─────────────────────────────────────────────────────────────────────────────
export function SidebarWorkspacesProvider({ children }: { children: ReactNode }) {
  const { authenticatedApi } = useAuthenticatedApi()
  const toasts = useKumoToastManager()
  const pathname = useRouterState({ select: state => state.location.pathname })
  const refreshRef = useRef<() => void>(() => {})

  const [gadgets, setGadgets] = useState<GadgetMetadataWithTimestamps[]>([])
  const [gadgetsLoading, setGadgetsLoading] = useState(true)
  const [initialization, setInitialization] = useState<{api: object; state: "ready" | "error"} | null>(null)

  const [search, setSearch] = useState('')

  // Delete / share dialog state (workspaces).
  const [deleteTarget, setDeleteTarget] = useState<GadgetMetadataWithTimestamps | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [shareTarget, setShareTarget] = useState<GadgetMetadataWithTimestamps | null>(null)
  const [shareOverseer, setShareOverseer] = useState<{ stub: RpcStub<Overseer> } | null>(null)
  const [currentUser, setCurrentUser] = useState<AiChatAuthorInfo | null>(null)

  useEffect(() => {
    authenticatedApi.whoami().then(setCurrentUser).catch(() => {})
  }, [authenticatedApi])

  useEffect(() => {
    let cancelled = false
    let pending = false
    let again = false
    let loaded = false
    setGadgetsLoading(true)
    const refresh = async () => {
      if (cancelled || document.visibilityState === 'hidden') return
      if (pending) { again = true; return }
      pending = true
      try {
        const list = await authenticatedApi.listGadgets()
        if (cancelled) return
        setGadgets(list)
        loaded = true
        setInitialization({api: authenticatedApi, state: 'ready'})
      } catch (err) {
        if (!cancelled && !loaded) {
          logRpcFailure('Failed to load workspaces for sidebar:', err)
          setInitialization({api: authenticatedApi, state: 'error'})
        }
      } finally {
        pending = false
        if (!cancelled) {
          setGadgetsLoading(false)
          if (again) { again = false; void refresh() }
        }
      }
    }
    const request = () => { void refresh() }
    refreshRef.current = request
    request()
    // Название может измениться агентом или в Telegram, без перехода на другую страницу.
    const timer = window.setInterval(request, 5000)
    window.addEventListener('focus', request)
    document.addEventListener('visibilitychange', request)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      window.removeEventListener('focus', request)
      document.removeEventListener('visibilitychange', request)
    }
  }, [authenticatedApi])

  useEffect(() => { refreshRef.current() }, [pathname])

  useEffect(() => {
    reportShellStage("workspaces", initialization?.api === authenticatedApi ? initialization.state : "loading", authenticatedApi)
  }, [authenticatedApi, initialization])

  // Dispose share overseer on close / unmount.
  useEffect(() => {
    if (!shareTarget && shareOverseer) {
      shareOverseer.stub[Symbol.dispose]()
      setShareOverseer(null)
    }
  }, [shareTarget, shareOverseer])
  const shareOverseerRef = useRef(shareOverseer)
  shareOverseerRef.current = shareOverseer
  useEffect(() => () => { shareOverseerRef.current?.stub[Symbol.dispose]() }, [])

  const needle = search.trim().toLowerCase()
  const matchText = useCallback(
    (s: string | undefined) => !needle || (s || '').toLowerCase().includes(needle),
    [needle],
  )

  const { favorites, recent, archived } = useMemo(() => {
    const favs: GadgetMetadataWithTimestamps[] = []
    const rest: GadgetMetadataWithTimestamps[] = []
    const old: GadgetMetadataWithTimestamps[] = []
    for (const g of gadgets) {
      if (!matchText(g.title)) continue
      if (g.archived) old.push(g)
      else if (g.pinned) favs.push(g)
      else rest.push(g)
    }
    const byActive = (a: GadgetMetadataWithTimestamps, b: GadgetMetadataWithTimestamps) =>
      b.lastActive.getTime() - a.lastActive.getTime()
    favs.sort(byActive)
    rest.sort(byActive)
    old.sort(byActive)
    return { favorites: favs, recent: rest, archived: old }
  }, [gadgets, matchText])

  // --- Workspace actions ---------------------------------------------------

  const onTogglePin = useCallback(async (g: GadgetMetadataWithTimestamps) => {
    const newPinned = !g.pinned
    setGadgets((prev) => prev.map((x) => (x.id === g.id ? { ...x, pinned: newPinned } : x)))
    const overseer = authenticatedApi.openGadget(g.id) // pipelining
    try {
      await overseer.setPinned(newPinned)
    } catch (err) {
      console.error('Failed to toggle pin:', err)
      setGadgets((prev) => prev.map((x) => (x.id === g.id ? { ...x, pinned: g.pinned } : x)))
      toasts.add({ title: 'Не удалось изменить избранное. Попробуйте ещё раз.', variant: 'error' })
    } finally {
      overseer[Symbol.dispose]()
    }
  }, [authenticatedApi, toasts])

  const onRename = useCallback(async (g: GadgetMetadataWithTimestamps, newTitle: string) => {
    setGadgets((prev) => prev.map((x) => (x.id === g.id ? { ...x, title: newTitle } : x)))
    const overseer = authenticatedApi.openGadget(g.id)
    try {
      await overseer.setTitle(newTitle)
    } catch (err) {
      console.error('Failed to rename:', err)
      setGadgets((prev) => prev.map((x) => (x.id === g.id ? { ...x, title: g.title } : x)))
      toasts.add({ title: 'Не удалось переименовать беседу. Попробуйте ещё раз.', variant: 'error' })
    } finally {
      overseer[Symbol.dispose]()
    }
  }, [authenticatedApi, toasts])

  const onToggleArchive = useCallback(async (g: GadgetMetadataWithTimestamps) => {
    const archived = !g.archived
    setGadgets((prev) => prev.map((x) => (x.id === g.id ? { ...x, archived } : x)))
    const overseer = authenticatedApi.openGadget(g.id)
    try {
      await overseer.setArchived(archived)
      toasts.add({ title: archived ? 'Беседа в архиве' : 'Беседа возвращена из архива', variant: 'success' })
    } catch (err) {
      console.error('Failed to archive:', err)
      setGadgets((prev) => prev.map((x) => (x.id === g.id ? { ...x, archived: g.archived } : x)))
      toasts.add({ title: archived ? 'Не удалось убрать беседу в архив. Попробуйте ещё раз.' : 'Не удалось вернуть беседу из архива. Попробуйте ещё раз.', variant: 'error' })
    } finally {
      overseer[Symbol.dispose]()
    }
  }, [authenticatedApi, toasts])

  const onShare = useCallback(async (g: GadgetMetadataWithTimestamps) => {
    let overseer: RpcStub<Overseer> | null = null
    try {
      overseer = authenticatedApi.openGadget(g.id)
      const metadata = await overseer.getMetadata()
      setShareOverseer({ stub: overseer })
      setShareTarget({ ...g, ...metadata })
      overseer = null
    } catch (err) {
      overseer?.[Symbol.dispose]()
      console.error('Failed to open workspace for sharing:', err)
      toasts.add({ title: 'Не удалось открыть настройки доступа. Попробуйте ещё раз.', variant: 'error' })
    }
  }, [authenticatedApi, toasts])

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return
    setIsDeleting(true)
    try {
      if (deleteTarget.owner) {
        await authenticatedApi.dismissSharedGadget(deleteTarget.id)
      } else {
        const overseer = authenticatedApi.openGadget(deleteTarget.id) // pipelining
        try {
          await overseer.deleteSelf()
        } finally {
          overseer[Symbol.dispose]()
        }
      }
      setGadgets((prev) => prev.filter((x) => x.id !== deleteTarget.id))
      toasts.add({
        title: deleteTarget.owner ? 'Беседа убрана из списка' : 'Беседа удалена',
        variant: 'success',
      })
    } catch (err) {
      console.error('Failed to delete workspace:', err)
      toasts.add({ title: 'Не удалось удалить беседу. Попробуйте ещё раз.', variant: 'error' })
    } finally {
      setIsDeleting(false)
      setDeleteTarget(null)
    }
  }, [authenticatedApi, deleteTarget, toasts])

  const value: WorkspacesContextValue = {
    search,
    setSearch,
    gadgets,
    gadgetsLoading,
    gadgetsFailed: initialization?.api === authenticatedApi && initialization.state === 'error',
    favorites,
    recent,
    archived,
    onTogglePin,
    onRename,
    onShare,
    onDelete: setDeleteTarget,
    onToggleArchive,
  }

  return (
    <WorkspacesContext.Provider value={value}>
      {children}

      {/* Delete confirm */}
      <DeleteConfirmationDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}
        isDeleting={isDeleting}
        title={deleteTarget?.owner ? 'Убрать беседу' : 'Удалить беседу'}
        description={
          deleteTarget?.owner
            ? `Убрать «${deleteTarget?.title || 'Беседа без названия'}» из списка? Она останется доступной по ссылке.`
            : `Удалить «${deleteTarget?.title || 'Беседа без названия'}»? Отменить это нельзя.`
        }
        confirmLabel={deleteTarget?.owner ? 'Убрать' : 'Удалить'}
        confirmingLabel={deleteTarget?.owner ? 'Убираем…' : 'Удаляем…'}
        onConfirm={handleDeleteConfirm}
      />

      {/* Share modal */}
      {shareOverseer && shareTarget && (
        <ShareModal
          open
          onClose={() => setShareTarget(null)}
          overseer={shareOverseer.stub}
          metadata={shareTarget}
          currentUser={currentUser}
          authenticatedApi={authenticatedApi}
        />
      )}
    </WorkspacesContext.Provider>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Lists (Favorites / Recent workspaces). Lives in the rail's scrolling middle
// region. In collapsed mode shows a compact avatar stack.
// ─────────────────────────────────────────────────────────────────────────────
export function SidebarWorkspacesLists({ collapsed = false }: { collapsed?: boolean }) {
  const {
    search,
    favorites,
    recent,
    gadgetsLoading,
    onTogglePin,
    onRename,
    onShare,
    onDelete,
    onToggleArchive,
  } = useWorkspacesContext()

  if (collapsed) {
    const compact = [...favorites, ...recent].slice(0, 8)
    return (
      <div className="flex flex-col items-center gap-1.5 px-2">
        {compact.map((g) => (
          <SidebarGadgetRow
            key={g.id}
            gadget={g}
            collapsed
            onTogglePin={onTogglePin}
            onRename={onRename}
            onShare={onShare}
            onDelete={onDelete}
          />
        ))}
      </div>
    )
  }

  const recentShown = recent.slice(0, RECENT_INITIAL_LIMIT)
  const recentHidden = Math.max(0, recent.length - RECENT_INITIAL_LIMIT)
  const row = (g: GadgetMetadataWithTimestamps) => (
    <SidebarGadgetRow
      key={g.id}
      gadget={g}
      onTogglePin={onTogglePin}
      onRename={onRename}
      onShare={onShare}
      onDelete={onDelete}
      onToggleArchive={onToggleArchive}
    />
  )

  return (
    <div className="flex flex-col gap-4 px-3.5 pb-3">
      {/* Избранное появляется, только когда что-то закреплено: пустая группа — лишний шум. */}
      {favorites.length > 0 && (
        <SidebarSection label="Избранное">{favorites.map(row)}</SidebarSection>
      )}

      <SidebarSection label="Беседы">
        {gadgetsLoading ? (
          <div className="flex flex-col gap-1">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-8 animate-pulse rounded-[10px] bg-kumo-tint" />
            ))}
          </div>
        ) : recent.length === 0 ? (
          <p className="m-0 px-3 py-1.5 text-[13px] leading-5 text-kumo-inactive">
            {search ? 'Ничего не найдено.' : 'Бесед пока нет.'}
          </p>
        ) : (
          <>
            {recentShown.map(row)}
            <Link
              to="/workspaces"
              className="flex h-8 touch:h-10 items-center rounded-[10px] px-3 text-[14px] text-kumo-subtle transition-colors hover:bg-kumo-tint hover:text-kumo-default"
            >
              {recentHidden > 0 ? `Все беседы (${recent.length})` : 'Все беседы'}
            </Link>
          </>
        )}
      </SidebarSection>
    </div>
  )
}

// Подпись группы в списке бесед — без сворачивания: один уровень, как в макете.
function SidebarSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label} className="flex flex-col gap-0.5">
      <h2 className="m-0 px-3 pb-1.5 text-[13px] leading-4 font-normal text-kumo-subtle">{label}</h2>
      {children}
    </section>
  )
}
