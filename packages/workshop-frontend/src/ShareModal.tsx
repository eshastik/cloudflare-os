import { useState, useEffect, useCallback, useMemo, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { Checkbox, Dialog, useKumoToastManager } from '@cloudflare/kumo'
import { CaretLeft, Check, Copy, Link, PencilSimple, ShieldCheck, ShieldWarning, X } from '@phosphor-icons/react'
import { RpcStub } from 'capnweb'
import {
  Overseer,
  AuthenticatedApi,
  CollaboratorInfo,
  AffectedCollaborator,
  ShareLinkInfo,
  GadgetMetadata,
  AiChatAuthorInfo,
  CollaboratorRole,
  ObserverBindingNeed,
} from '@gadgets/workshop-shared/api'
import { PersonAvatar } from './components/PersonAvatar'
import { copyToClipboard } from './clipboard'

type CollaboratorRow =
  | { kind: 'owner'; profile: AiChatAuthorInfo }
  | { kind: 'collaborator'; info: CollaboratorInfo }

type ConfirmationTarget =
  | { kind: 'remove'; profileId: string; dependents: AffectedCollaborator[]; previewing: boolean; keepSet: Set<string> }
  | { kind: 'revoke'; linkId: string; dependents: AffectedCollaborator[]; previewing: boolean; keepSet: Set<string> }

type Props = {
  open: boolean
  onClose: () => void
  overseer: RpcStub<Overseer>
  metadata: GadgetMetadata
  currentUser: AiChatAuthorInfo | null
  authenticatedApi: RpcStub<AuthenticatedApi>
}

function formatRelativeTime(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSeconds = Math.floor(diffMs / 1000)
  const diffMinutes = Math.floor(diffSeconds / 60)
  const diffHours = Math.floor(diffMinutes / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffSeconds < 60) return 'только что'
  if (diffMinutes < 60) return `${diffMinutes} мин назад`
  if (diffHours < 24) return `${diffHours} ч назад`
  if (diffDays < 7) return `${diffDays} дн назад`
  return date.toLocaleDateString()
}

// Что может получатель. «use» — пользоваться гаджетами; «build» — ещё и менять их, писать агенту в
// беседе и приглашать других. Слова — о действиях человека, а не о внутренних ролях.
const ROLE_LABELS: Record<CollaboratorRole, string> = {
  use: 'может пользоваться',
  build: 'может менять',
}

const ROLE_DESCRIPTIONS: Record<CollaboratorRole, string> = {
  use: 'Открывает гаджеты и работает в них. Беседу с агентом и код не видит.',
  build: 'Меняет гаджеты, пишет агенту в беседе и приглашает других.',
}

function roleLabel(role: CollaboratorRole | undefined): string {
  return ROLE_LABELS[role ?? 'build']
}

const ROLE_OPTIONS: CollaboratorRole[] = ['use', 'build']

/** Пауза после ввода перед поиском подсказок, мс. */
const SUGGEST_DELAY_MS = 150
type Invitee = { id: string; name: string; email?: string }

/** Право получателя — переключатель из двух слов; подсказка к выбранному — строкой под ним у вызывающего. */
function RoleSwitch({ value, onValueChange, disabled, ariaLabel }: {
  value: CollaboratorRole
  onValueChange: (role: CollaboratorRole) => void
  disabled?: boolean
  ariaLabel: string
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex shrink-0 rounded-full bg-kumo-tint p-0.5">
      {ROLE_OPTIONS.map(role => (
        <button
          key={role}
          type="button"
          role="radio"
          aria-checked={value === role}
          title={ROLE_DESCRIPTIONS[role]}
          disabled={disabled}
          onClick={() => onValueChange(role)}
          className={`h-8 cursor-pointer whitespace-nowrap rounded-full border-0 px-3 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kumo-ring disabled:cursor-not-allowed ${
            value === role
              ? 'bg-kumo-overlay font-medium text-kumo-default shadow-[0_1px_3px_rgba(24,32,28,0.12)]'
              : 'bg-transparent text-kumo-subtle hover:text-kumo-default'
          }`}
        >
          {roleLabel(role)}
        </button>
      ))}
    </div>
  )
}

/** Недавно приглашённые в этом браузере — подсказки для поля, не источник прав. */
const RECENT_KEY = 'workshop-share-recent-people'
type RecentPerson = { id: string; name: string }
function readRecentPeople(): RecentPerson[] {
  try {
    const value = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
    return Array.isArray(value) ? value.filter((p): p is RecentPerson => typeof p?.id === 'string' && typeof p?.name === 'string').slice(0, 12) : []
  } catch { return [] }
}
function rememberRecentPerson(person: RecentPerson) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([person, ...readRecentPeople().filter(p => p.id !== person.id)].slice(0, 12))) } catch { /* без памяти браузера подсказок просто нет */ }
}

function InlineConfirm({
  label,
  busy,
  busyLabel,
  tone = 'danger',
  onConfirm,
  onCancel,
}: {
  label: string
  busy: boolean
  busyLabel?: string
  tone?: 'danger' | 'brand'
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="flex items-center gap-1 share-confirm-in">
      <button
        type="button"
        onClick={onConfirm}
        disabled={busy}
        className={`inline-flex h-7 cursor-pointer items-center rounded-lg px-2.5 text-[12px] leading-4 font-medium tracking-[-0.1px] transition-[background-color,transform] duration-150 ease-out active:scale-[0.97] disabled:opacity-60 ${
          tone === 'danger'
            ? 'text-kumo-danger hover:bg-kumo-danger-tint'
            : 'text-kumo-brand hover:bg-kumo-tint'
        }`}
      >
        {busy ? (busyLabel ?? `${label}…`) : label}
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        aria-label="Отмена"
        className="grid h-7 w-7 cursor-pointer place-items-center rounded-lg text-kumo-inactive transition-[background-color,color,transform] duration-150 ease-out hover:bg-kumo-tint hover:text-kumo-default active:scale-[0.96] disabled:opacity-60"
      >
        <X size={14} />
      </button>
    </div>
  )
}

function DependentKeepList({
  dependents,
  keepSet,
  onKeepSetChange,
}: {
  dependents: AffectedCollaborator[]
  keepSet: Set<string>
  onKeepSetChange: (next: Set<string>) => void
}) {
  if (dependents.length === 0) return null

  return (
    <div className="space-y-1.5">
      {dependents.map(dep => (
        <div
          key={dep.profile.id}
          className={`rounded-xl px-3 py-2 transition-colors ${
            keepSet.has(dep.profile.id) ? 'bg-kumo-tint' : 'bg-kumo-elevated/50 hover:bg-kumo-elevated'
          }`}
        >
          <Checkbox
            label={(
              <span className="flex min-w-0 items-baseline gap-1.5">
                <span className="truncate text-[12px] font-medium text-kumo-default">{dep.profile.name}</span>
                <span className="truncate text-[11px] text-kumo-subtle">{dep.profile.id}</span>
              </span>
            )}
            checked={keepSet.has(dep.profile.id)}
            onCheckedChange={(checked) => {
              const next = new Set(keepSet)
              if (checked) next.add(dep.profile.id)
              else next.delete(dep.profile.id)
              onKeepSetChange(next)
            }}
          />
        </div>
      ))}
    </div>
  )
}

// What a recipient is asked to do before the workspace will open for them. Recipients don't
// inherit the owner's connections: they must point their own account at each connection in scope
// for the selected access level, so sharers should know that cost before they invite anyone.
function RecipientVerification({
  requirements,
  failed,
  role,
  headingId,
  heading,
}: {
  requirements: ObserverBindingNeed[] | null
  failed: boolean
  role?: CollaboratorRole
  headingId: string
  heading: string
}) {
  let body: ReactNode
  if (failed) {
    body = (
      <p className="px-1 text-[12px] leading-[16px] tracking-[-0.15px] text-kumo-subtle">
        Не удалось проверить, какие подключения потребуются получателям.
      </p>
    )
  } else if (requirements === null || requirements.length === 0) {
    // Still loading: stay silent rather than reserving space for an answer we don't have yet.
    return null
  } else {
    body = (
      <div className="rounded-2xl border border-kumo-line/80 bg-kumo-base px-3 py-2.5">
        <p className="text-[12px] leading-[16px] tracking-[-0.15px] text-kumo-subtle">
          {role ? (
            <>Тем, кто <span className="font-medium text-kumo-default">{roleLabel(role)}</span>, нужно</>
          ) : 'Получателям нужно'} подтвердить своей учётной записью доступ к ресурсам:
        </p>
        <ul className="mt-1.5 max-h-32 space-y-1 overflow-y-auto">
          {requirements.map(requirement => (
            <li key={requirement.gatekeeperId} className="min-w-0">
              <p className="truncate text-[12px] leading-4 font-medium tracking-[-0.15px] text-kumo-default">
                {requirement.resourceTitle}
              </p>
              {requirement.resourceUrl && (
                <p className="truncate font-mono text-[11px] leading-4 text-kumo-inactive">
                  {requirement.resourceUrl}
                </p>
              )}
            </li>
          ))}
        </ul>
      </div>
    )
  }

  return (
    <section aria-labelledby={headingId} className="mt-4">
      <div className="mb-2 flex items-center gap-1.5 px-1">
        <ShieldCheck size={13} className="text-kumo-inactive" />
        <h3 id={headingId} className="text-[12px] leading-4 font-medium tracking-[-0.15px] text-kumo-subtle">
          {heading}
        </h3>
      </div>
      {body}
    </section>
  )
}

function sameRequirements(
  left: ObserverBindingNeed[],
  right: ObserverBindingNeed[],
): boolean {
  return left.length === right.length &&
    left.every((requirement, index) => requirement.gatekeeperId === right[index].gatekeeperId)
}

export default function ShareModal({ open, onClose, overseer, metadata, currentUser, authenticatedApi }: Props) {
  const toasts = useKumoToastManager()
  const [collaborators, setCollaborators] = useState<CollaboratorInfo[]>([])
  const [shareLinks, setShareLinks] = useState<ShareLinkInfo[]>([])
  const [addUsername, setAddUsername] = useState('')
  const [addRole, setAddRole] = useState<CollaboratorRole>('use')
  const [adding, setAdding] = useState(false)
  const [newLinkRole, setNewLinkRole] = useState<CollaboratorRole>('use')
  const [newLinkNote, setNewLinkNote] = useState('')
  const [newShareLink, setNewShareLink] = useState<string | null>(null)
  const [newShareLinkId, setNewShareLinkId] = useState<string | null>(null)
  const [newShareLinkCopied, setNewShareLinkCopied] = useState(false)
  const [invitedName, setInvitedName] = useState<string | null>(null)
  const [invitedLinkCopied, setInvitedLinkCopied] = useState(false)
  const [requirements, setRequirements] =
    useState<Record<CollaboratorRole, ObserverBindingNeed[]> | null>(null)
  const [requirementsFailed, setRequirementsFailed] = useState(false)
  const [creatingLink, setCreatingLink] = useState(false)
  const [showLinkComposer, setShowLinkComposer] = useState(false)
  const [confirmationTarget, setConfirmationTarget] = useState<ConfirmationTarget | null>(null)
  const [confirmationBusy, setConfirmationBusy] = useState(false)
  const wasOpenRef = useRef(false)
  const creatingLinkRef = useRef(false)
  const addingRef = useRef(false)
  const landedTimerRef = useRef<number | null>(null)
  const [recentPeople, setRecentPeople] = useState<RecentPerson[]>(() => readRecentPeople())
  // Подсказки по мере ввода: люди установки, у которых имя, имя входа или почта начинаются с введённого.
  const [matches, setMatches] = useState<Invitee[]>([])
  const [matchesOpen, setMatchesOpen] = useState(false)
  const [activeMatch, setActiveMatch] = useState(0)
  const matchRequestRef = useRef(0)
  // Имя входа, подставленное из подсказки: по нему повторно не ищем.
  const chosenRef = useRef<string | null>(null)
  const [landedPersonId, setLandedPersonId] = useState<string | null>(null)
  const [landedShareLinkId, setLandedShareLinkId] = useState<string | null>(null)
  const [editingShareLinkId, setEditingShareLinkId] = useState<string | null>(null)
  const [editingShareLinkNote, setEditingShareLinkNote] = useState('')
  const [savingShareLinkNote, setSavingShareLinkNote] = useState(false)
  const [copyingLinkId, setCopyingLinkId] = useState<string | null>(null)
  const [copiedLinkId, setCopiedLinkId] = useState<string | null>(null)
  const linkNameRef = useRef<HTMLInputElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const savingShareLinkNoteRef = useRef(false)
  const copyingLinkRef = useRef(false)
  const copiedTimerRef = useRef<number | null>(null)
  // Freshly-minted share URLs, kept only in memory for the life of this modal session so repeat
  // Copy clicks on the same link re-use the URL.
  const copiedUrlsRef = useRef<Map<string, string>>(new Map())

  // Focus the link-name field when the composer opens, without scrolling the sticky region
  // (autoFocus would jump the scroll position and shift layout).
  useEffect(() => {
    if (showLinkComposer && !newShareLink) {
      linkNameRef.current?.focus({ preventScroll: true })
    }
  }, [showLinkComposer, newShareLink])

  useEffect(() => {
    if (editingShareLinkId) {
      renameInputRef.current?.focus({ preventScroll: true })
      renameInputRef.current?.select()
    }
  }, [editingShareLinkId])

  useEffect(() => {
    return () => {
      if (landedTimerRef.current !== null) window.clearTimeout(landedTimerRef.current)
      if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current)
    }
  }, [])

  const isOwner = !metadata.owner
  const sharingProhibited = metadata.sharingProhibited === true

  useEffect(() => {
    const query = addUsername.trim()
    const request = ++matchRequestRef.current
    if (!open || !query || query === chosenRef.current || sharingProhibited) { setMatches([]); return }
    const timer = window.setTimeout(() => {
      Promise.resolve().then(() => overseer.findInvitees(query))
        .then(found => {
          if (request !== matchRequestRef.current) return
          const taken = new Set([...collaborators.map(c => c.profile.id), currentUser?.id, metadata.owner?.id])
          setMatches(found.filter(p => !taken.has(p.id)).slice(0, 8))
          setActiveMatch(0)
          setMatchesOpen(true)
        })
        // Без подсказок поле работает как раньше: приглашение по введённому имени входа.
        .catch(() => { if (request === matchRequestRef.current) setMatches([]) })
    }, SUGGEST_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [addUsername, open, overseer, collaborators, sharingProhibited])

  const chooseMatch = (person: Invitee) => {
    chosenRef.current = person.id
    setAddUsername(person.id)
    setMatches([])
    setMatchesOpen(false)
  }
  const showMatches = matchesOpen && matches.length > 0
  const onPeopleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!matches.length) return
      e.preventDefault()
      if (!matchesOpen) { setMatchesOpen(true); return }
      setActiveMatch(i => (i + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (showMatches && matches[activeMatch]) chooseMatch(matches[activeMatch]!)
      else void handleAddCollaborator()
    } else if (e.key === 'Escape' && showMatches) {
      // Esc закрывает подсказки, а не всё окно.
      e.preventDefault(); e.stopPropagation(); e.nativeEvent.stopImmediatePropagation()
      setMatchesOpen(false)
    }
  }


  const loadData = useCallback(async () => {
    try {
      const [collabs, keys] = await Promise.all([
        overseer.listCollaborators(),
        overseer.listShareLinks(),
      ])
      setCollaborators(collabs)
      setShareLinks(keys)
      return { collaborators: collabs, shareLinks: keys }
    } catch (err) {
      console.error('Failed to load share data:', err)
      toasts.add({ title: 'Не удалось загрузить сведения о доступе', variant: 'error' })
      return null
    }
  }, [overseer])

  // Refresh on focus as well as open: bindings cannot change in this modal, but they can change in
  // another tab while it remains open. A failed refresh is informational and never blocks sharing.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    let requestId = 0
    setRequirements(null)
    const refresh = () => {
      const thisRequest = ++requestId
      setRequirementsFailed(false)
      Promise.all([
        overseer.listObserverRequirements('use'),
        overseer.listObserverRequirements('build'),
      ])
        .then(([use, build]) => {
          if (!cancelled && thisRequest === requestId) setRequirements({ use, build })
        })
        .catch(err => {
          console.error('Failed to load observer requirements:', err)
          if (!cancelled && thisRequest === requestId) setRequirementsFailed(true)
        })
    }
    refresh()
    window.addEventListener('focus', refresh)
    return () => {
      cancelled = true
      window.removeEventListener('focus', refresh)
    }
  }, [open, overseer])

  useEffect(() => {
    if (open) {
      loadData()
      if (!wasOpenRef.current) {
        setAddUsername('')
        setNewShareLink(null)
        setNewShareLinkId(null)
        setNewShareLinkCopied(false)
        setInvitedName(null)
        setInvitedLinkCopied(false)
        setNewLinkNote('')
        setShowLinkComposer(false)
        setConfirmationTarget(null)
        setEditingShareLinkId(null)
        setEditingShareLinkNote('')
        setCopiedLinkId(null)
        setCopyingLinkId(null)
        if (copiedTimerRef.current !== null) {
          window.clearTimeout(copiedTimerRef.current)
          copiedTimerRef.current = null
        }
        copiedUrlsRef.current.clear()
      }
    }
    wasOpenRef.current = open
  }, [open, loadData])

  const ownerProfile: AiChatAuthorInfo | null = isOwner ? currentUser : (metadata.owner ?? null)
  const collaboratorRows: CollaboratorRow[] = [
    ...(ownerProfile ? [{ kind: 'owner' as const, profile: ownerProfile }] : []),
    ...collaborators.map(info => ({ kind: 'collaborator' as const, info })),
  ]
  const sortedShareLinks = useMemo(
    () => [...shareLinks].toSorted((a, b) => b.created.getTime() - a.created.getTime()),
    [shareLinks],
  )
  let recipientVerification: ReactNode = null
  if (requirementsFailed) {
    recipientVerification = (
      <RecipientVerification
        requirements={null}
        failed
        headingId="recipient-verification-heading"
        heading="Проверка доступа получателей"
      />
    )
  } else if (requirements !== null) {
    const inviteRequirements = requirements[addRole]
    if (!showLinkComposer && !newShareLink) {
      recipientVerification = (
        <RecipientVerification
          requirements={inviteRequirements}
          failed={false}
          role={addRole}
          headingId="recipient-verification-heading"
          heading="Проверка доступа получателей"
        />
      )
    } else {
      const linkRequirements = requirements[newLinkRole]
      if (sameRequirements(inviteRequirements, linkRequirements)) {
        recipientVerification = (
          <RecipientVerification
            requirements={inviteRequirements}
            failed={false}
            role={addRole === newLinkRole ? addRole : undefined}
            headingId="recipient-verification-heading"
            heading="Проверка доступа получателей"
          />
        )
      } else {
        recipientVerification = (
          <>
            <RecipientVerification
              requirements={inviteRequirements}
              failed={false}
              role={addRole}
              headingId="invite-verification-heading"
              heading="Проверка приглашения"
            />
            <RecipientVerification
              requirements={linkRequirements}
              failed={false}
              role={newLinkRole}
              headingId="link-verification-heading"
              heading="Проверка доступа по ссылке"
            />
          </>
        )
      }
    }
  }
  const removeTarget = confirmationTarget?.kind === 'remove' ? confirmationTarget : null
  const revokeTarget = confirmationTarget?.kind === 'revoke' ? confirmationTarget : null

  const describeAccess = (info: CollaboratorInfo): string => {
    if (info.addedBy.length > 1) return `Источников доступа: ${info.addedBy.length}`
    const edge = info.addedBy[0]
    if (!edge) return 'Участник'
    if (edge.type === 'user') return `Пригласил: ${edge.sharer}`
    const key = shareLinks.find(item => item.linkId === edge.keyId)
    return key?.note ? `По ссылке «${key.note}»` : 'По ссылке доступа'
  }

  const copyNewLink = async () => {
    if (!newShareLink) return
    const copied = await copyToClipboard(newShareLink)
    if (copied) {
      setNewShareLinkCopied(true)
    } else {
      toasts.add({ title: 'Не удалось скопировать ссылку.', variant: 'error' })
    }
  }

  // Where an invited collaborator opens the workspace. Adding them already granted access, so this
  // carries no secret and is safe to show and re-show — unlike a share link, whose URL embeds a key.
  const workspaceUrl = `${window.location.origin}/workspace/${metadata.id}`

  const copyWorkspaceUrl = async () => {
    if (await copyToClipboard(workspaceUrl)) {
      setInvitedLinkCopied(true)
    } else {
      toasts.add({ title: 'Не удалось скопировать ссылку на беседу.', variant: 'error' })
    }
  }

  const showLandedRow = (kind: 'person' | 'shareLink', id: string) => {
    if (landedTimerRef.current !== null) window.clearTimeout(landedTimerRef.current)
    setLandedPersonId(kind === 'person' ? id : null)
    setLandedShareLinkId(kind === 'shareLink' ? id : null)
    landedTimerRef.current = window.setTimeout(() => {
      setLandedPersonId(null)
      setLandedShareLinkId(null)
      landedTimerRef.current = null
    }, 2200)
  }

  const handleAddCollaborator = async () => {
    const username = addUsername.trim()
    if (!username || sharingProhibited || addingRef.current) return

    addingRef.current = true
    setAdding(true)
    try {
      const result = await overseer.addCollaborator(username, addRole, undefined)
      if (result === null) {
        toasts.add({ title: 'Пользователь с таким именем не найден.', variant: 'error' })
      } else {
        const landedId = result.profile.id
        rememberRecentPerson({ id: result.profile.id, name: result.profile.name })
        setRecentPeople(readRecentPeople())
        setAddUsername('')
        setInvitedName(result.profile.name)
        setInvitedLinkCopied(false)
        await loadData()
        showLandedRow('person', landedId)
        toasts.add({ title: `Добавлен участник: ${result.profile.name}.`, variant: 'success' })
      }
    } catch (err: any) {
      toasts.add({ title: err.message || 'Не удалось добавить участника.', variant: 'error' })
    } finally {
      addingRef.current = false
      setAdding(false)
    }
  }

  const handleCreateShareLink = async () => {
    if (sharingProhibited || creatingLinkRef.current) return
    creatingLinkRef.current = true
    setCreatingLink(true)
    try {
      const { key, linkId } = await overseer.createShareLink(
        newLinkRole, newLinkNote.trim() || undefined)
      const url = `${window.location.origin}/workspace/${metadata.id}#share=${key}`
      setNewShareLink(url)
      setNewShareLinkCopied(false)
      setNewLinkNote('')
      setNewShareLinkId(linkId)
      copiedUrlsRef.current.set(linkId, url)
      await loadData()
      showLandedRow('shareLink', linkId)
    } catch (err: any) {
      // Keep the composer and its values open so the user can retry without re-entering them.
      toasts.add({ title: err.message || 'Не удалось создать ссылку.', variant: 'error' })
    } finally {
      creatingLinkRef.current = false
      setCreatingLink(false)
    }
  }

  // Copy a share link again. Secrets are never stored, so the previously-shown URL can't be
  // re-displayed. We mint a new secret for the same logical link and copy that.
  const handleCopyShareLink = async (linkId: string) => {
    if (sharingProhibited || copyingLinkRef.current) return
    copyingLinkRef.current = true
    setCopyingLinkId(linkId)
    try {
      // Re-use a URL already minted for this link during this session.
      let url = copiedUrlsRef.current.get(linkId)
      if (!url) {
        const { key } = await overseer.newShareLinkKey(linkId)
        url = `${window.location.origin}/workspace/${metadata.id}#share=${key}`
        copiedUrlsRef.current.set(linkId, url)
      }
      const copied = await copyToClipboard(url)
      if (!copied) {
        toasts.add({ title: 'Не удалось скопировать ссылку.', variant: 'error' })
        return
      }
      setCopiedLinkId(linkId)
      showLandedRow('shareLink', linkId)
      if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current)
      copiedTimerRef.current = window.setTimeout(() => {
        setCopiedLinkId(current => (current === linkId ? null : current))
        copiedTimerRef.current = null
      }, 2000)
      toasts.add({ title: 'Ссылка скопирована.', variant: 'success' })
    } catch (err: any) {
      toasts.add({ title: err.message || 'Не удалось скопировать ссылку.', variant: 'error' })
    } finally {
      copyingLinkRef.current = false
      setCopyingLinkId(null)
    }
  }

  const handleStartRemoveCollaborator = async (profileId: string) => {
    setConfirmationTarget({ kind: 'remove', profileId, dependents: [], previewing: true, keepSet: new Set() })
    try {
      const dependents = await overseer.previewRemoveCollaborator(profileId)
      setConfirmationTarget(current => current?.kind === 'remove' && current.profileId === profileId
        ? { ...current, dependents, previewing: false }
        : current)
    } catch (err: any) {
      setConfirmationTarget(current => current?.kind === 'remove' && current.profileId === profileId ? null : current)
      toasts.add({ title: err.message || 'Не удалось проверить последствия удаления участника.', variant: 'error' })
    }
  }

  const handleConfirmRemoveCollaborator = async () => {
    if (!removeTarget || removeTarget.previewing || confirmationBusy) return
    setConfirmationBusy(true)
    try {
      const removed = await overseer.removeCollaborator(removeTarget.profileId, [...removeTarget.keepSet])
      setConfirmationTarget(null)
      toasts.add({
        title: removed.length > 0
          ? 'Участник удалён.'
          : 'Выданный вами доступ отозван. У участника остался доступ из другого источника.',
        variant: 'success',
      })
      await loadData()
    } catch (err: any) {
      toasts.add({ title: err.message || 'Не удалось удалить участника.', variant: 'error' })
    } finally {
      setConfirmationBusy(false)
    }
  }

  const startRenameShareLink = (link: ShareLinkInfo) => {
    // Renaming and the destructive confirm are mutually exclusive in-place editors on the same row.
    setConfirmationTarget(null)
    setEditingShareLinkId(link.linkId)
    setEditingShareLinkNote(link.note ?? '')
  }

  const cancelRenameShareLink = () => {
    setEditingShareLinkId(null)
    setEditingShareLinkNote('')
  }

  const handleSaveShareLinkNote = async () => {
    if (!editingShareLinkId || savingShareLinkNoteRef.current) return
    const linkId = editingShareLinkId
    const note = editingShareLinkNote.trim()
    if (note === (shareLinks.find(link => link.linkId === linkId)?.note ?? '')) {
      cancelRenameShareLink()
      return
    }
    savingShareLinkNoteRef.current = true
    setSavingShareLinkNote(true)
    try {
      await overseer.updateShareLink(linkId, note || undefined)
      cancelRenameShareLink()
      await loadData()
      showLandedRow('shareLink', linkId)
      toasts.add({ title: 'Ссылка переименована.', variant: 'success' })
    } catch (err: any) {
      toasts.add({ title: err.message || 'Не удалось переименовать ссылку.', variant: 'error' })
    } finally {
      savingShareLinkNoteRef.current = false
      setSavingShareLinkNote(false)
    }
  }

  const handleStartRevokeShareLink = async (linkId: string) => {
    cancelRenameShareLink()
    setConfirmationTarget({ kind: 'revoke', linkId, dependents: [], previewing: true, keepSet: new Set() })
    try {
      const dependents = await overseer.previewRevokeShareLink(linkId)
      setConfirmationTarget(current => current?.kind === 'revoke' && current.linkId === linkId
        ? { ...current, dependents, previewing: false }
        : current)
    } catch (err: any) {
      setConfirmationTarget(current => current?.kind === 'revoke' && current.linkId === linkId ? null : current)
      toasts.add({ title: err.message || 'Не удалось проверить последствия отзыва ссылки.', variant: 'error' })
    }
  }

  const handleConfirmRevokeShareLink = async () => {
    if (!revokeTarget || revokeTarget.previewing || confirmationBusy) return
    setConfirmationBusy(true)
    try {
      await overseer.revokeShareLink(revokeTarget.linkId, [...revokeTarget.keepSet])
      setConfirmationTarget(null)
      if (revokeTarget.linkId === newShareLinkId) {
        setNewShareLink(null)
        setNewShareLinkId(null)
        setNewShareLinkCopied(false)
        setShowLinkComposer(false)
      }
      toasts.add({ title: 'Ссылка отозвана.', variant: 'success' })
      await loadData()
    } catch (err: any) {
      toasts.add({ title: err.message || 'Не удалось отозвать ссылку.', variant: 'error' })
    } finally {
      setConfirmationBusy(false)
    }
  }

  const collaboratorIds = new Set(collaborators.map(info => info.profile.id))
  const suggestions = recentPeople.filter(p => !collaboratorIds.has(p.id) && p.id !== currentUser?.id).slice(0, 5)
  const canInvite = !!addUsername.trim() && !adding && !sharingProhibited
  const rowClass = (landed: boolean, first: boolean) =>
    `group ${first ? '' : 'border-t border-kumo-fill'} ${landed ? 'share-row-land' : ''} py-2.5`
  const quietAction = 'h-8 cursor-pointer rounded-full border-0 bg-transparent px-2.5 text-[13px] text-kumo-subtle transition-colors hover:text-kumo-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kumo-ring disabled:cursor-not-allowed'
  const hiddenAction = 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100'
  // В строке ссылки действия не занимают место, пока строку не навели или не выбрали с клавиатуры (кнопка копирования видна всегда).
  const collapsedAction = 'hidden group-hover:inline-flex group-focus-within:inline-flex items-center'
  const pill = 'inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-kumo-fill-hover bg-transparent px-3 text-[13px] text-kumo-default transition-colors hover:bg-kumo-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kumo-ring disabled:cursor-not-allowed disabled:opacity-50'
  const primary = (enabled: boolean) => `inline-flex h-[38px] shrink-0 items-center justify-center rounded-full border-0 px-5 text-[14px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kumo-ring ${
    enabled ? 'cursor-pointer bg-kumo-brand text-white hover:bg-kumo-brand-hover' : 'cursor-not-allowed bg-kumo-tint text-kumo-inactive'}`

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <Dialog
        // Панель справа по макету «Поделиться»: высота по содержимому, не выше окна; радиус 20, тень гаджета.
        className="!z-[1000] !top-3 !bottom-auto !right-3 !left-auto !flex !max-h-[calc(100dvh-24px)] !w-[min(616px,calc(100vw-24px))] !min-w-0 !max-w-none !translate-x-0 !translate-y-0 flex-col overflow-hidden !rounded-[20px] bg-kumo-overlay p-0 !shadow-[0_1px_2px_rgba(24,32,28,0.05),0_16px_40px_rgba(24,32,28,0.08)] !ring-0 !outline-none"
        size="lg"
      >
        <header className="flex shrink-0 items-center gap-3 px-5 pt-[26px] pb-5 sm:px-7">
          <Dialog.Close
            render={(props) => (
              <button
                {...props}
                type="button"
                aria-label="Закрыть"
                className="inline-flex h-[34px] w-[34px] shrink-0 cursor-pointer items-center justify-center rounded-full border border-kumo-fill-hover bg-transparent text-kumo-default transition-colors hover:bg-kumo-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kumo-ring"
              >
                <CaretLeft size={16} />
              </button>
            )}
          />
          <div className="min-w-0 flex-1">
            <Dialog.Title className="m-0 text-[20px] leading-7 font-semibold tracking-[-0.3px] text-kumo-default">
              Поделиться
            </Dialog.Title>
            <Dialog.Description title={metadata.title} className="m-0 truncate text-[14px] leading-5 text-kumo-subtle">
              {metadata.title}
            </Dialog.Description>
          </div>
        </header>

        <div className="chat-panel flex min-h-0 flex-col gap-6 overflow-y-auto overscroll-contain px-5 pb-[26px] text-[14px] text-kumo-default sm:px-7">
          {sharingProhibited ? (
            <div className="flex items-start gap-3 rounded-2xl bg-kumo-warning-tint px-4 py-3.5">
              <ShieldWarning size={20} className="mt-px shrink-0 text-kumo-warning" />
              <div className="min-w-0">
                <p className="m-0 text-[15px] leading-5 font-medium">Эту беседу нельзя открыть другим</p>
                <p className="m-0 mt-1 text-[13px] leading-[18px] text-kumo-subtle">
                  В беседе использованы личные данные, доступные только вам. Для совместной работы создайте шаблон из гаджета и начните с него новую беседу.
                </p>
              </div>
            </div>
          ) : (
          <>
          <section aria-label="Пригласить" className="flex flex-col gap-2.5">
            <div className="flex flex-wrap items-center gap-2" data-keeper-ignore="true" data-1p-ignore="true" data-lpignore="true" data-bwignore="true">
              <div className="relative min-w-[200px] flex-1">
                <input
                  type="search"
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={showMatches}
                  aria-controls="share-people-matches"
                  aria-activedescendant={showMatches ? `share-match-${activeMatch}` : undefined}
                  placeholder="Имя пользователя или почта"
                  aria-label="Имя пользователя или почта"
                  value={addUsername}
                  onChange={(e) => { chosenRef.current = null; setAddUsername(e.target.value); setMatchesOpen(true) }}
                  onKeyDown={onPeopleKey}
                  onBlur={() => setMatchesOpen(false)}
                  onFocus={() => setMatchesOpen(true)}
                  name="gadget-share-people-search"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  data-keeper-ignore="true"
                  data-1p-ignore="true"
                  data-lpignore="true"
                  data-bwignore="true"
                  data-form-type="other"
                  className="h-10 w-full appearance-none rounded-full border border-kumo-fill-hover bg-kumo-overlay px-4 text-[15px] text-kumo-default outline-none placeholder:text-kumo-inactive focus:border-kumo-brand focus:ring-2 focus:ring-kumo-ring/30 [&::-webkit-search-cancel-button]:hidden"
                />
                {showMatches && (
                  <ul id="share-people-matches" role="listbox" aria-label="Подсказки"
                    className="absolute top-[calc(100%+6px)] right-0 left-0 z-20 m-0 flex max-h-[320px] list-none flex-col overflow-y-auto rounded-2xl border border-kumo-fill bg-kumo-overlay p-1 shadow-[0_8px_24px_rgba(24,32,28,0.12)]">
                    {matches.map((person, index) => (
                      <li key={person.id} id={`share-match-${index}`} role="option" aria-selected={index === activeMatch}
                        onMouseDown={(e) => e.preventDefault()}
                        onMouseEnter={() => setActiveMatch(index)}
                        onClick={() => chooseMatch(person)}
                        className={`flex cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 ${index === activeMatch ? 'bg-kumo-tint' : ''}`}>
                        <PersonAvatar api={authenticatedApi} userId={person.id} name={person.name} size={32} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[15px] leading-5 text-kumo-default">{person.name}</span>
                          <span className="block truncate text-[13px] leading-[18px] text-kumo-subtle">{person.email ?? person.id}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <button type="button" className={primary(canInvite)} onClick={handleAddCollaborator} disabled={!canInvite}>
                {adding ? 'Приглашаю…' : 'Пригласить'}
              </button>
            </div>
            {suggestions.length > 0 && !addUsername.trim() && (
              <div className="flex flex-wrap items-center gap-1.5" aria-label="Недавние">
                <span className="px-1 text-[13px] text-kumo-subtle">Недавние</span>
                {suggestions.map(p => (
                  <button key={p.id} type="button" className="h-7 cursor-pointer rounded-full border-0 bg-kumo-tint px-3 text-[13px] text-kumo-default transition-colors hover:bg-kumo-fill-hover" title={p.id}
                    onClick={() => { chosenRef.current = p.id; setAddUsername(p.id) }}>{p.name}</button>
                ))}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <RoleSwitch ariaLabel="Право приглашённого" value={addRole} onValueChange={setAddRole} />
              <p className="m-0 min-w-0 flex-1 text-[13px] leading-[18px] text-kumo-subtle">{ROLE_DESCRIPTIONS[addRole]}</p>
            </div>

            {invitedName && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl bg-kumo-tint px-4 py-2.5 share-fade-in">
                <p className="m-0 min-w-0 flex-1 text-[14px] leading-5">
                  Добавлен участник: {invitedName}.{' '}
                  <span className="text-kumo-subtle">{invitedLinkCopied ? 'Ссылка скопирована' : 'Отправьте ему ссылку на беседу'}</span>
                  <span className="block truncate text-[12px] leading-4 text-kumo-subtle">{workspaceUrl}</span>
                </p>
                <button type="button" className={pill} onClick={copyWorkspaceUrl}>
                  {invitedLinkCopied ? <Check size={13} weight="bold" /> : <Copy size={13} />}
                  {invitedLinkCopied ? 'Скопировано' : 'Скопировать ссылку'}
                </button>
                <button type="button" aria-label="Закрыть сообщение о приглашении" className={`${quietAction} !px-2`}
                  onClick={() => { setInvitedName(null); setInvitedLinkCopied(false) }}>
                  <X size={14} />
                </button>
              </div>
            )}
          </section>

          <section aria-label="Ссылка доступа" className="flex flex-col gap-2.5">
            {newShareLink ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl bg-kumo-tint px-4 py-2.5 share-fade-in">
                <p className="m-0 min-w-0 flex-1 text-[14px] leading-5">
                  {newShareLinkCopied ? 'Ссылка скопирована.' : 'Ссылка готова.'}{' '}
                  <span className="text-kumo-subtle">Скопировать её снова можно в списке ссылок ниже.</span>
                  <span className="block truncate text-[12px] leading-4 text-kumo-subtle">{newShareLink}</span>
                </p>
                <button type="button" className={pill} onClick={copyNewLink}>
                  {newShareLinkCopied ? <Check size={13} weight="bold" /> : <Copy size={13} />}
                  {newShareLinkCopied ? 'Скопировано' : 'Скопировать'}
                </button>
                <button type="button" aria-label="Закрыть сообщение о ссылке" className={`${quietAction} !px-2`}
                  onClick={() => { setNewShareLink(null); setNewShareLinkId(null); setNewShareLinkCopied(false); setShowLinkComposer(false) }}>
                  <X size={14} />
                </button>
              </div>
            ) : showLinkComposer ? (
              <div className="flex flex-col gap-2.5 rounded-2xl border border-kumo-fill px-4 py-3 share-fade-in">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={linkNameRef}
                    value={newLinkNote}
                    onChange={(e) => setNewLinkNote(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleCreateShareLink() }}
                    placeholder="Название ссылки, например «Для отдела продаж»"
                    aria-label="Название ссылки (необязательно)"
                    className="h-9 min-w-[200px] flex-1 rounded-full border border-kumo-fill-hover bg-kumo-overlay px-4 text-[14px] text-kumo-default outline-none placeholder:text-kumo-inactive focus:border-kumo-brand focus:ring-2 focus:ring-kumo-ring/30"
                    disabled={creatingLink}
                  />
                  <button type="button" className={`${primary(!creatingLink)} !h-9`} onClick={handleCreateShareLink} disabled={creatingLink}>
                    {creatingLink ? 'Создаю…' : 'Создать ссылку'}
                  </button>
                  <button type="button" aria-label="Отменить создание ссылки" className={`${quietAction} !px-2`} onClick={() => setShowLinkComposer(false)}>
                    <X size={14} />
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <RoleSwitch ariaLabel="Право по ссылке" value={newLinkRole} onValueChange={setNewLinkRole} disabled={creatingLink} />
                  <p className="m-0 min-w-0 flex-1 text-[13px] leading-[18px] text-kumo-subtle">Кто откроет ссылку, {roleLabel(newLinkRole)}.</p>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <button type="button" className={pill} onClick={() => setShowLinkComposer(true)}>
                  <Link size={14} /> Создать ссылку доступа
                </button>
                <span className="text-[13px] text-kumo-subtle">для тех, кого нет в списке</span>
              </div>
            )}
          </section>

          {recipientVerification}

          <section aria-labelledby="people-heading" className="flex flex-col">
            <h3 id="people-heading" className="m-0 pb-1 text-[15px] leading-5 font-semibold">Имеют доступ</h3>
            {collaboratorRows.map((row, index) => {
              const profile = row.kind === 'owner' ? row.profile : row.info.profile
              const key = row.kind === 'owner' ? '__owner__' : row.info.profile.id
              const me = profile.id === currentUser?.id
              const isRemoving = row.kind === 'collaborator' && removeTarget?.profileId === row.info.profile.id
              const downstreamDependents = isRemoving && removeTarget
                ? removeTarget.dependents.filter(dep => dep.profile.id !== profile.id)
                : []
              return (
                <div key={key} data-share-person="" className={rowClass(landedPersonId === profile.id, index === 0)}>
                  <div className="flex items-center gap-3">
                    <PersonAvatar api={authenticatedApi} userId={profile.id} name={profile.name} size={36} />
                    <div className="min-w-0 flex-1">
                      <p className="m-0 truncate text-[15px] leading-5">{me ? 'Вы' : profile.name}</p>
                      {row.kind === 'collaborator' && <p className="m-0 truncate text-[13px] leading-[18px] text-kumo-subtle">{describeAccess(row.info)}</p>}
                    </div>
                    {row.kind === 'owner' ? (
                      <span className="px-2.5 text-[14px] text-kumo-subtle">владелец</span>
                    ) : isRemoving ? (
                      <InlineConfirm
                        label="Убрать"
                        busy={removeTarget.previewing || confirmationBusy}
                        busyLabel={removeTarget.previewing ? 'Проверяю…' : undefined}
                        onConfirm={handleConfirmRemoveCollaborator}
                        onCancel={() => setConfirmationTarget(null)}
                      />
                    ) : (
                      <>
                        <button
                          type="button"
                          className={`${quietAction} ${hiddenAction} hover:!text-kumo-danger`}
                          onClick={() => handleStartRemoveCollaborator(row.info.profile.id)}
                          aria-label={`Убрать участника: ${profile.name}`}
                          disabled={confirmationBusy}
                        >
                          Убрать
                        </button>
                        <span className="px-2.5 text-[14px] text-kumo-subtle" title={ROLE_DESCRIPTIONS[row.info.role ?? 'build']}>{roleLabel(row.info.role)}</span>
                      </>
                    )}
                  </div>
                  {isRemoving && downstreamDependents.length > 0 && (
                    <div className="mt-2.5 share-expand-in">
                      <p className="m-0 mb-1.5 text-[13px] leading-[18px] text-kumo-subtle">
                        Доступ через {profile.name} потеряют ещё {downstreamDependents.length} чел. Отметьте тех, кому нужно сохранить доступ.
                      </p>
                      <DependentKeepList
                        dependents={downstreamDependents}
                        keepSet={removeTarget.keepSet}
                        onKeepSetChange={(keepSet) => setConfirmationTarget(current =>
                          current?.kind === 'remove' && current.profileId === removeTarget.profileId
                            ? { ...current, keepSet }
                            : current
                        )}
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </section>

          {shareLinks.length > 0 && (
          <section aria-labelledby="links-heading" className="flex flex-col">
            <h3 id="links-heading" className="m-0 pb-1 text-[15px] leading-5 font-semibold">Ссылки доступа</h3>
            {sortedShareLinks.map((sk, index) => {
              const isRevoking = revokeTarget?.linkId === sk.linkId
              const isRenaming = editingShareLinkId === sk.linkId
              return (
                <div key={sk.linkId} className={rowClass(landedShareLinkId === sk.linkId, index === 0)}>
                  <div className="flex items-center gap-3">
                    <span aria-hidden="true" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-kumo-tint text-kumo-subtle">
                      <Link size={15} />
                    </span>
                    <div className="min-w-0 flex-1">
                      {isRenaming ? (
                        <input
                          ref={renameInputRef}
                          value={editingShareLinkNote}
                          onChange={(e) => setEditingShareLinkNote(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveShareLinkNote()
                            if (e.key === 'Escape') cancelRenameShareLink()
                          }}
                          placeholder="Название ссылки…"
                          aria-label="Название ссылки"
                          className="block w-full border-0 bg-transparent p-0 text-[15px] leading-5 text-kumo-default outline-none shadow-[inset_0_-1px_0_0_var(--color-kumo-line)] placeholder:text-kumo-inactive focus:shadow-[inset_0_-1px_0_0_var(--color-kumo-brand)]"
                          disabled={savingShareLinkNote}
                        />
                      ) : (
                        <p className="m-0 truncate text-[15px] leading-5">{sk.note || 'Ссылка без названия'}</p>
                      )}
                      <p className="m-0 truncate text-[13px] leading-[18px] text-kumo-subtle">{sk.createdBy.id === currentUser?.id ? 'Вы создали' : `Создал ${sk.createdBy.name}`} {formatRelativeTime(sk.created)}</p>
                    </div>
                    {isRenaming ? (
                      <InlineConfirm label="Сохранить" tone="brand" busy={savingShareLinkNote} onConfirm={handleSaveShareLinkNote} onCancel={cancelRenameShareLink} />
                    ) : isRevoking ? (
                      <InlineConfirm
                        label="Отозвать"
                        busy={revokeTarget.previewing || confirmationBusy}
                        busyLabel={revokeTarget.previewing ? 'Проверяю…' : undefined}
                        onConfirm={handleConfirmRevokeShareLink}
                        onCancel={() => setConfirmationTarget(null)}
                      />
                    ) : (
                      <>
                        <button type="button" className={`${quietAction} ${collapsedAction}`} onClick={() => startRenameShareLink(sk)}
                          aria-label={`Переименовать ${sk.note || 'ссылку'}`} disabled={confirmationBusy}>
                          <PencilSimple size={14} />
                        </button>
                        <button type="button" className={`${quietAction} ${collapsedAction} hover:!text-kumo-danger`} onClick={() => handleStartRevokeShareLink(sk.linkId)}
                          aria-label={`Отозвать ${sk.note || 'ссылку'}`} disabled={confirmationBusy}>
                          Отозвать
                        </button>
                        <span className="px-1 text-[14px] text-kumo-subtle">{roleLabel(sk.role)}</span>
                        <button type="button" className={`${quietAction} !px-2`} onClick={() => handleCopyShareLink(sk.linkId)}
                          aria-label={`Скопировать ${sk.note || 'ссылку'}`} disabled={confirmationBusy || copyingLinkId === sk.linkId}>
                          {copiedLinkId === sk.linkId ? <Check size={14} weight="bold" /> : <Copy size={14} />}
                        </button>
                      </>
                    )}
                  </div>
                  {isRevoking && revokeTarget.dependents.length > 0 && (
                    <div className="mt-2.5 share-expand-in">
                      <p className="m-0 mb-1.5 text-[13px] leading-[18px] text-kumo-subtle">
                        Доступ по этой ссылке потеряют {revokeTarget.dependents.length} чел. Отметьте тех, кому нужно сохранить доступ.
                      </p>
                      <DependentKeepList
                        dependents={revokeTarget.dependents}
                        keepSet={revokeTarget.keepSet}
                        onKeepSetChange={(keepSet) => setConfirmationTarget(current =>
                          current?.kind === 'revoke' && current.linkId === revokeTarget.linkId
                            ? { ...current, keepSet }
                            : current
                        )}
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </section>
          )}
          </>
          )}
        </div>
      </Dialog>
    </Dialog.Root>
  )
}
