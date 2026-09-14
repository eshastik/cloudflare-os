import {saveMailAttachment} from './saveMailAttachment'
import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { RpcStub, RpcTarget, newMessagePortRpcSession } from 'capnweb'
import { useNavigate } from '@tanstack/react-router'
import type { GatekeeperUiFrame } from '@gadgets/workshop-shared/gatekeeper'
import { createRateLimitedCapability } from './rateLimitedCapability'
import { useTheme } from './ThemeContext'
import type { ResolvedThemeMode } from './theme'
import { forwardTrustedFrameError } from './errorReporting'
import { uploadGatekeeperText } from './gatekeeperAppUpload'
import { openGatekeeperAudioRecording } from './gatekeeperAudioRecording'
import { downloadGatekeeperNativeDocument, downloadGatekeeperText } from './gatekeeperAppDownload'
import type { NativeDocumentFormat, NativeDocumentSnapshot } from '@gadgets/workshop-shared/native-document'
import { useAuthenticatedApi } from './AuthContext'
import {
  normalizeGatekeeperAppPrompt,
  parseGatekeeperAppWorkspaceTarget,
  type GatekeeperAppWorkspaceTarget,
} from './gatekeeperAppNavigation'

// A receiver, defined by the sandboxed app, that the host calls to push theme changes into the frame.
interface ThemeReceiver extends RpcTarget {
  setThemeMode(mode: ResolvedThemeMode): void
}

// The content-pane rect, in viewport coordinates, that the app pins its page to while the iframe
// is full-viewport.
type OverlayRect = { left: number; top: number; width: number; height: number }

// The host's reply to a present/dismiss. On open, `rect` is where the app holds its page fixed while
// the iframe expands to full-viewport (null on restore); `willResize` is whether switching the iframe
// to/from full-viewport actually changes its pixel size (it won't if the pane already fills the window).
type PresentAck = { rect: OverlayRect | null; willResize: boolean }

// Grows the app's iframe to a full-viewport overlay for app-level modals (true) or restores it (false).
type PresentController = (active: boolean) => PresentAck
type OpenTarget = (target: GatekeeperAppWorkspaceTarget) => void
// Resolves workspace IDs the app already holds to their live titles; null for a workspace the user
// can no longer see. Deliberately a lookup, not an enumeration: the app learns nothing new.
type ResolveWorkspaceTitles = (ids: string[]) => Promise<(string | null)[]>
type OpenPrompt = (prompt: string) => void

type OverlayState = 'full' | null

// Upper bound on one workspace-title lookup, matching the app's page size.
const MAX_RESOLVED_WORKSPACES = 100

// How long one gadget listing is reused across title lookups. The untrusted frame calls this once
// per page of rows (and could call it in a loop), so the listing is shared rather than repeated.
const WORKSPACE_TITLES_TTL_MS = 10_000

// Near the max int, so the full-viewport iframe sits above all Workshop chrome.
const overlayZIndex = 2147483000

const baseIframeStyle: CSSProperties = {
  border: 0,
  background: 'transparent',
}

function iframeStyleForOverlay(overlay: OverlayState): CSSProperties {
  if (overlay === 'full') {
    return {
      ...baseIframeStyle,
      position: 'fixed',
      inset: 0,
      width: '100vw',
      height: '100vh',
      zIndex: overlayZIndex,
    }
  }
  return {
    ...baseIframeStyle,
    display: 'block',
    width: '100%',
    height: '100%',
  }
}

// The host capability exposed to the sandboxed app (the gatekeeper's iframe UI) over the MessagePort
// RPC session. The app uses `ui` to reach the gatekeeper's own capability, which Workshop relays and
// rate-limits. `setPresenting` stays in Workshop and only grows/restores the iframe's layout.
class GatekeeperAppHostImpl extends RpcTarget {
  readonly #calendarDraftCreator:RpcStub<NonNullable<GatekeeperUiFrame['calendarDraftCreator']>>|undefined
  readonly #mailDraftSender:RpcStub<NonNullable<GatekeeperUiFrame['mailDraftSender']>>|undefined
  readonly #ui: RpcStub<RpcTarget>
  readonly #disposeRateLimiter: () => void
  readonly #present: PresentController
  readonly #openTarget: OpenTarget
  readonly #openPrompt: OpenPrompt
  readonly #resolveWorkspaceTitles: ResolveWorkspaceTitles
  readonly #uploads: { storageOrigin: string; issuer: RpcStub<NonNullable<GatekeeperUiFrame['textUploads']>['issuer']> } | undefined
  readonly #uploadLifetime = new AbortController()
  readonly #downloads: { storageOrigin: string; issuer: RpcStub<NonNullable<GatekeeperUiFrame['textDownloads']>['issuer']> } | undefined
  readonly #reviewDownloads: { storageOrigin: string; issuer: RpcStub<NonNullable<GatekeeperUiFrame['reviewDownloads']>['issuer']> } | undefined
  readonly #nativeDownloads: { storageOrigin: string; selector: RpcStub<NonNullable<GatekeeperUiFrame['nativeDownloads']>['selector']> } | undefined
  #downloadBusy = false
  #uploadBusy = false
  #presenting = false
  #themeMode: ResolvedThemeMode
  #themeReceiver: RpcStub<ThemeReceiver> | null = null
  // Presentation changes are coalesced to a single apply per animation frame (see #applyPending).
  #pendingActive: boolean | null = null
  #pendingResolvers: ((ack: PresentAck) => void)[] = []
  #frameId: number | null = null

  constructor(
    capability: any,
    present: PresentController,
    themeMode: ResolvedThemeMode,
    openTarget: OpenTarget,
    openPrompt: OpenPrompt,
    resolveWorkspaceTitles: ResolveWorkspaceTitles,
    uploads?: GatekeeperUiFrame['textUploads'],
    downloads?: GatekeeperUiFrame['textDownloads'],
    reviewDownloads?: GatekeeperUiFrame['reviewDownloads'],
    nativeDownloads?: GatekeeperUiFrame['nativeDownloads'],
    mailDraftSender?:GatekeeperUiFrame['mailDraftSender'],
    calendarDraftCreator?:GatekeeperUiFrame['calendarDraftCreator'],
    private readonly navigateApprovals: () => void = () => {},
  ) {
    super()
    this.#calendarDraftCreator=calendarDraftCreator?(calendarDraftCreator as RpcStub<typeof calendarDraftCreator>).dup():undefined
    this.#mailDraftSender=mailDraftSender?(mailDraftSender as RpcStub<typeof mailDraftSender>).dup():undefined
    this.#nativeDownloads = nativeDownloads ? { storageOrigin: nativeDownloads.storageOrigin, selector: (nativeDownloads.selector as RpcStub<typeof nativeDownloads.selector>).dup() } : undefined
    this.#uploads = uploads ? { storageOrigin: uploads.storageOrigin, issuer: (uploads.issuer as RpcStub<typeof uploads.issuer>).dup() } : undefined
    this.#downloads = downloads ? { storageOrigin: downloads.storageOrigin, issuer: (downloads.issuer as RpcStub<typeof downloads.issuer>).dup() } : undefined
    this.#reviewDownloads = reviewDownloads ? { storageOrigin: reviewDownloads.storageOrigin, issuer: (reviewDownloads.issuer as RpcStub<typeof reviewDownloads.issuer>).dup() } : undefined
    this.#themeMode = themeMode
    const { capability: ui, dispose } = createRateLimitedCapability(capability, {
      maxConcurrency: 8,
      maxCallsPerMinute: 600,
      maxPendingCalls: 128,
      onRateLimit: 'throttle',
      label: 'Gatekeeper app',
    })
    this.#ui = ui
    this.#disposeRateLimiter = dispose
    this.#present = present
    this.#openTarget = openTarget
    this.#openPrompt = openPrompt
    this.#resolveWorkspaceTitles = resolveWorkspaceTitles
  }

  /** Selected resource scope from the host URL; never an authorization grant. */
  getSelectedProject(): string {
    const value = new URLSearchParams(window.location.search).get('project') ?? ''
    return value.length <= 255 ? value : ''
  }

  /** Opens the human inbox without granting approval authority to the frame. */
  openApprovals(): void {
    this.#uploadLifetime.signal.throwIfAborted()
    this.navigateApprovals()
  }

  async createCalendarDraft(id:string,sha256:string){
    if(!this.#calendarDraftCreator||this.#uploadLifetime.signal.aborted)throw Error('Calendar creation unavailable.');
    return this.#calendarDraftCreator.create(id,sha256);
  }

  async sendMailDraft(id:string,sha256:string){
    if(!this.#mailDraftSender||this.#uploadLifetime.signal.aborted)throw Error('Mail sending unavailable.');
    return this.#mailDraftSender.send(id,sha256);
  }

  /** Save bounded bytes already read by the app, without enabling iframe downloads or navigation. */
  async saveMailAttachment(bytes:Uint8Array,filename:string){
    this.#uploadLifetime.signal.throwIfAborted()
    saveMailAttachment(bytes,filename)
  }

  get ui(): RpcStub<RpcTarget> {
    return this.#ui
  }

  // Only text and an opaque service scope come from the frame. The signed URL
  // comes from the server-issued capability retained by this host.
  async uploadText(scope: string, text: string): Promise<string> {
    if (!this.#uploads || this.#uploadBusy || this.#uploadLifetime.signal.aborted ||
        typeof scope !== 'string' || !scope || scope.length > 255) {
      throw new Error('Document upload unavailable.')
    }
    this.#uploadBusy = true
    try {
      const uploads = this.#uploads
      return await uploadGatekeeperText(text, uploads.storageOrigin,
        (size, checksum) => uploads.issuer.issue(scope, size, checksum),
        this.#uploadLifetime.signal)
    } finally { this.#uploadBusy = false }
  }

  // Revalidate access after S3 returns: a still-valid signed URL must not let an
  // invalidated account reveal a late result through the host.
  async downloadText(scope: string, resource: string, version: string, side: number): Promise<string> {
    if (!this.#downloads || this.#downloadBusy || this.#uploadLifetime.signal.aborted ||
        [scope, resource, version].some(value => typeof value !== 'string' || !value || value.length > 255) ||
        !Number.isSafeInteger(side) || side < 0) throw new Error('Document download unavailable.')
    this.#downloadBusy = true
    try {
      const downloads = this.#downloads
      const ticket = await downloads.issuer.issue(scope, resource, version, side)
      const text = await downloadGatekeeperText(downloads.storageOrigin, ticket, this.#uploadLifetime.signal)
      await downloads.issuer.validate(scope, resource, version)
      this.#uploadLifetime.signal.throwIfAborted()
      return text
    } catch { throw new Error('Document download failed.') }
    finally { this.#downloadBusy = false }
  }

  // The selected capability and signed URL stay in the trusted host. This returns
  // data only; it does not authorize storing it in a shared gadget.
  async downloadNativeDocument(scope: string, resource: string, publication: string, format: NativeDocumentFormat): Promise<NativeDocumentSnapshot> {
    if (!this.#nativeDownloads || this.#downloadBusy || this.#uploadLifetime.signal.aborted ||
        [scope, resource, publication].some(value => typeof value !== 'string' || !value || value.length > 255) ||
        (format !== 'cloudflareos.document' && format !== 'cloudflareos.spreadsheet')) throw new Error('Document download unavailable.')
    this.#downloadBusy = true
    try {
      const downloads = this.#nativeDownloads
      const selected = await downloads.selector.select(scope, resource, publication)
      try {
        return await downloadGatekeeperNativeDocument(downloads.storageOrigin, await selected.issue(),
          format, this.#uploadLifetime.signal, () => selected.validate())
      } finally { selected[Symbol.dispose]() }
    } catch { throw new Error('Native document download failed.') }
    finally { this.#downloadBusy = false }
  }

  async downloadReviewText(review: string, node: string, version: number, side: "before" | "after"): Promise<string | null> {
    if (!this.#reviewDownloads || this.#downloadBusy || this.#uploadLifetime.signal.aborted ||
        [review, node].some(value => typeof value !== 'string' || !value || value.length > 255) ||
        !Number.isSafeInteger(version) || version < 0 || (side !== 'before' && side !== 'after')) throw new Error('Document download unavailable.')
    this.#downloadBusy = true
    try {
      const downloads = this.#reviewDownloads
      const ticket = await downloads.issuer.issue(review, node, version, side)
      const text = ticket === null ? null : await downloadGatekeeperText(downloads.storageOrigin, ticket, this.#uploadLifetime.signal)
      await downloads.issuer.validate(review, node, version)
      this.#uploadLifetime.signal.throwIfAborted()
      return text
    } catch { throw new Error('Document download failed.') }
    finally { this.#downloadBusy = false }
  }

  // Navigate to a workspace the app knows about. The IDs are validated here because the app is
  // untrusted; navigation stays in-app rather than handing the frame a URL to follow.
  openWorkspace(workspaceId: string, gadgetId?: number): void {
    this.#openTarget(parseGatekeeperAppWorkspaceTarget(workspaceId, gadgetId))
  }

  // Resolve live titles for workspaces the app already references, so it never renders a stale
  // snapshot. Bounded per call; unknown or no-longer-visible workspaces come back as null.
  resolveWorkspaceTitles(ids: string[]): Promise<(string | null)[]> {
    if (!Array.isArray(ids) || ids.length > MAX_RESOLVED_WORKSPACES) {
      throw new TypeError('Invalid workspace title lookup.')
    }
    return this.#resolveWorkspaceTitles(ids)
  }

  openPrompt(prompt: string): void {
    this.#openPrompt(normalizeGatekeeperAppPrompt(prompt))
  }

  // The app calls this once to learn the current mode and register a receiver for later changes.
  // Apps that don't theme themselves never call it.
  subscribeTheme(receiver: RpcStub<ThemeReceiver>): ResolvedThemeMode {
    this.#themeReceiver?.[Symbol.dispose]?.()
    // The argument stub is disposed when this call returns, so keep our own dup (released in dispose).
    this.#themeReceiver = receiver.dup()
    return this.#themeMode
  }

  #dropThemeReceiver(receiver: RpcStub<ThemeReceiver>) {
    if (this.#themeReceiver !== receiver) return
    receiver[Symbol.dispose]?.()
    this.#themeReceiver = null
  }

  // Push a new mode to a subscribed app; a no-op until (and unless) the app subscribes.
  updateTheme(mode: ResolvedThemeMode) {
    this.#themeMode = mode
    const receiver = this.#themeReceiver
    if (!receiver) return

    try {
      Promise.resolve(receiver.setThemeMode(mode)).catch(() => this.#dropThemeReceiver(receiver))
    } catch {
      this.#dropThemeReceiver(receiver)
    }
  }

  // Queue a presentation change; the latest requested state is applied on the next frame.
  setPresenting(active: boolean): Promise<PresentAck> {
    return new Promise((resolve) => {
      this.#pendingActive = active
      this.#pendingResolvers.push(resolve)
      this.#frameId ??= requestAnimationFrame(() => this.#applyPending())
    })
  }

  // Apply the last-requested state once, resolving every caller queued this frame with the result.
  #applyPending() {
    this.#frameId = null
    const active = this.#pendingActive!
    const resolvers = this.#pendingResolvers
    this.#pendingActive = null
    this.#pendingResolvers = []
    // No-op toggles skip the layout apply.
    const ack: PresentAck =
      active === this.#presenting ? { rect: null, willResize: false } : this.#present(active)
    this.#presenting = active
    for (const resolve of resolvers) resolve(ack)
  }

  // Cancel the rate limiter's pending resume timer once this host is no longer in use.
  dispose() {
    this.#uploadLifetime.abort()
    this.#uploads?.issuer[Symbol.dispose]?.()
    this.#downloads?.issuer[Symbol.dispose]?.()
    this.#reviewDownloads?.issuer[Symbol.dispose]?.()
    this.#nativeDownloads?.selector[Symbol.dispose]?.()
    this.#calendarDraftCreator?.[Symbol.dispose]()
    this.#mailDraftSender?.[Symbol.dispose]()
    this.#disposeRateLimiter()
    this.#themeReceiver?.[Symbol.dispose]?.()
    this.#themeReceiver = null
    if (this.#frameId !== null) {
      cancelAnimationFrame(this.#frameId)
      this.#frameId = null
    }
    for (const resolve of this.#pendingResolvers) resolve({ rect: null, willResize: false })
    this.#pendingResolvers = []
    this.#pendingActive = null
    if (this.#presenting) {
      this.#presenting = false
      this.#present(false)
    }
  }
}

// Hosts a gatekeeper's full-page management SPA in a sandboxed, network-isolated iframe. The app
// talks to the gatekeeper only through the `ui` capability carried over the MessagePort RPC session.
// The iframe fills its parent container.
export default function SandboxedGatekeeperApp({ frame, gatekeeperVendorId }: {
  frame: GatekeeperUiFrame,
  gatekeeperVendorId: string,
}) {
  const navigate = useNavigate()
  const { authenticatedApi } = useAuthenticatedApi()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const sessionRef = useRef<{ [Symbol.dispose]?(): void } | null>(null)
  const hostRef = useRef<GatekeeperAppHostImpl | null>(null)
  const connectedRef = useRef(false)
  const invalidatedRef = useRef(false)
  const [overlay, setOverlay] = useState<OverlayState>(null)
  const overlayRef = useRef<OverlayState>(null)
  // Push the Workshop's resolved light/dark mode to the app whenever it changes.
  const { resolvedThemeMode } = useTheme()
  const themeModeRef = useRef(resolvedThemeMode)
  themeModeRef.current = resolvedThemeMode
  useEffect(() => {
    hostRef.current?.updateTheme(resolvedThemeMode)
  }, [resolvedThemeMode])

  const setOverlayPhase = useCallback((next: OverlayState) => {
    if (overlayRef.current === next) return
    overlayRef.current = next
    setOverlay(next)
  }, [])

  // Grow the iframe to full-viewport (or restore it), then report back the pane rect and whether the
  // size actually changed.
  const present = useCallback<PresentController>((active) => {
    const el = iframeRef.current
    const before = el?.getBoundingClientRect()
    // Duplicate restores are common during cleanup; avoid forcing layout when already restored.
    if (!active && overlayRef.current === null) return { rect: null, willResize: false }
    flushSync(() => setOverlayPhase(active ? 'full' : null))
    const after = el?.getBoundingClientRect()
    const willResize =
      !!before && !!after && (before.width !== after.width || before.height !== after.height)
    // On open, `before` is the pane rect the app pins to.
    const rect =
      active && before
        ? { left: before.left, top: before.top, width: before.width, height: before.height }
        : null
    return { rect, willResize }
  }, [setOverlayPhase])
  const openTarget = useCallback<OpenTarget>(({ workspaceId, gadgetId }) => {
    navigate({
      to: '/workspace/$id',
      params: { id: workspaceId },
      search: gadgetId === undefined ? {} : { w: gadgetId },
    })
  }, [navigate])
  const titlesRef = useRef<{ at: number, titles: Promise<Map<string, string>> } | null>(null)
  const resolveWorkspaceTitles = useCallback<ResolveWorkspaceTitles>(async (ids) => {
    let entry = titlesRef.current
    if (!entry || Date.now() - entry.at >= WORKSPACE_TITLES_TTL_MS) {
      entry = {
        at: Date.now(),
        titles: authenticatedApi.listGadgets()
          .then((gadgets) => new Map(gadgets.map((gadget) => [gadget.id, gadget.title]))),
      }
      titlesRef.current = entry
      // Don't cache a failure: drop it so the next lookup retries.
      const failed = entry
      entry.titles.catch(() => {
        if (titlesRef.current === failed) titlesRef.current = null
      })
    }
    const titles = await entry.titles
    return ids.map((id) => titles.get(id) ?? null)
  }, [authenticatedApi])
  const openPrompt = useCallback<OpenPrompt>((prompt) => {
    navigate({ to: '/', search: { prompt } })
  }, [navigate])
  // The gatekeeper capability is `any`: its method shape is gatekeeper-defined and opaque to us.
  const capabilityRef = useRef<any>(null)
  capabilityRef.current = frame.ui

  useEffect(() => {
    connectedRef.current = false
    invalidatedRef.current = false
    let closeRecording: (() => void) | undefined

    const connect = (port: MessagePort) => {
      if (connectedRef.current) {
        closeRecording?.()
        // A second handshake (e.g. iframe reloaded) invalidates the session.
        invalidatedRef.current = true
        port.close()
        sessionRef.current?.[Symbol.dispose]?.()
        sessionRef.current = null
        hostRef.current?.dispose()
        hostRef.current = null
        setOverlayPhase(null)
        return
      }
      if (invalidatedRef.current || !capabilityRef.current) {
        port.close()
        return
      }
      const host = new GatekeeperAppHostImpl(
        capabilityRef.current,
        present,
        themeModeRef.current,
        openTarget,
        openPrompt,
        resolveWorkspaceTitles,
        frame.textUploads,
        frame.textDownloads,
        frame.reviewDownloads,
        frame.nativeDownloads,
        frame.mailDraftSender,
        frame.calendarDraftCreator,
        () => { void navigate({ to: '/workspaces', search: { approvals: true } }) },
      )
      hostRef.current = host
      sessionRef.current = newMessagePortRpcSession(port, host)
      connectedRef.current = true
    }

    const handleMessage = (event: MessageEvent) => {
      // Only accept the handshake from our own sandboxed iframe (which posts from a null origin).
      // Capture contentWindow first: if the frame isn't mounted there's no legitimate sender, so
      // reject — comparing against a concrete window avoids a `source === undefined` edge.
      const frameWindow = iframeRef.current?.contentWindow
      if (!frameWindow || event.source !== frameWindow || event.origin !== 'null') return
      if (invalidatedRef.current) return
      if (event.data?.type === 'gatekeeper-audio-cancel') {
        closeRecording?.()
        closeRecording = undefined
        return
      }
      if (event.data?.type === 'gatekeeper-audio-request' && connectedRef.current &&
          typeof event.data.requestId === 'string' && /^[a-f0-9-]{36}$/.test(event.data.requestId)) {
        closeRecording?.()
        closeRecording = openGatekeeperAudioRecording(frameWindow, event.data.requestId)
        return
      }
      if (forwardTrustedFrameError(
        event, frameWindow, { surface: 'gatekeeper-app', gatekeeperVendorId },
      )) return
      if (event.data?.type === 'handshake' && event.ports?.[0]) {
        connect(event.ports[0])
      }
    }

    window.addEventListener('message', handleMessage)
    return () => {
      closeRecording?.()
      window.removeEventListener('message', handleMessage)
      sessionRef.current?.[Symbol.dispose]?.()
      sessionRef.current = null
      hostRef.current?.dispose()
      hostRef.current = null
      setOverlayPhase(null)
    }
    // Re-establish the session if either the HTML or the `ui` capability changes, so a new frame
    // carrying a fresh stub (even with identical HTML) never keeps talking through the stale one.
  }, [frame.iframeHtml, frame.ui, frame.mailDraftSender, frame.calendarDraftCreator, frame.textUploads, frame.textDownloads, frame.reviewDownloads, frame.nativeDownloads, gatekeeperVendorId, openPrompt, openTarget,
      present, resolveWorkspaceTitles, setOverlayPhase, navigate])

  return (
    <iframe
      ref={iframeRef}
      srcDoc={frame.iframeHtml}
      // allow-scripts: run the app's JS. allow-modals: its beforeunload unsaved-changes guard. Not
      // allow-same-origin (the frame stays an opaque origin), and the app's CSP keeps connect-src 'none'.
      sandbox="allow-scripts allow-modals"
      allow="clipboard-write"
      title="Gatekeeper app"
      style={iframeStyleForOverlay(overlay)}
    />
  )
}
