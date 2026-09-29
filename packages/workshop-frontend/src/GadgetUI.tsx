import { startWorkspaceUIReadiness } from "./uiReadiness"
import type { UIReadinessSample } from "@gadgets/workshop-shared/ui-readiness"
import { reportEmbeddedWorkspaceActivity } from "./workspaceActivity"
import { useState, useEffect, useRef } from 'react'
import { useRouter } from '@tanstack/react-router'
import { Text, Loader, Banner } from '@cloudflare/kumo'
import { Sparkle } from '@phosphor-icons/react'
import { RpcStub, RpcTarget, newMessagePortRpcSession } from 'capnweb'
import { GadgetClient, ConsoleLogEvent } from '@gadgets/workshop-shared/api'
import { queueNativeSnapshots, requestNativeSnapshot, type NativeSnapshotSourceRef } from './nativeSnapshotSource'
import { createSandboxedHtml } from './gadgetSandbox'
import { hostThemeMessage, useHostThemeMode, type HostTheme } from './gadgetHostTheme'
import { useOptionalAccentColor } from './ThemeContext'

/** Путь оболочки из сообщения гаджета; null — не путь этого сайта или служебный адрес. */
export function gadgetInternalPath(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048 || !value.startsWith('/') || value.startsWith('//')) return null
  let url: URL
  try { url = new URL(value, window.location.origin) } catch { return null }
  if (url.origin !== window.location.origin || /^\/(api|gatekeeper)(\/|$)/.test(url.pathname)) return null
  return url.pathname + url.search + url.hash
}

interface GadgetUIProps {
  gadget: RpcStub<GadgetClient>
  height: string
  reloadTrigger?: number
  isVisible?: boolean
  chatId?: number
  onConsoleLog?: (log: ConsoleLogEvent) => void
  // Fires when the user presses Escape while the gadget iframe has focus. Sandboxed iframes
  // capture keydown events, so we forward Escape explicitly from inside the iframe.
  onIframeEscape?: () => void
  nativeSnapshotSource?: NativeSnapshotSourceRef
  readinessApi?: Parameters<typeof startWorkspaceUIReadiness>[0]
  readinessSurface?: UIReadinessSample["surface"]
}

// How long to wait for a UI bundle before offering a retry instead of a spinner. Not a latency
// budget: the point at which we conclude the reply is never coming.
const UI_BUNDLE_LOAD_TIMEOUT_MS = 20_000
const RECONNECT_TIMEOUT_MS = 5_000

export default function GadgetUI(props: GadgetUIProps) {
  return <GadgetUISession key={props.chatId} {...props} />
}

function GadgetUISession({ gadget, height, reloadTrigger, isVisible = true, chatId, onConsoleLog, onIframeEscape, nativeSnapshotSource, readinessApi, readinessSurface }: GadgetUIProps) {
  const [sandboxedHtml, setSandboxedHtml] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [isInvalidated, setIsInvalidated] = useState(false)
  const [iframeGeneration, setIframeGeneration] = useState(0)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const accent = useOptionalAccentColor()
  const mode = useHostThemeMode()
  const themeRef = useRef<HostTheme>({ mode, accent })
  themeRef.current = { mode, accent }
  // Смена темы и акцента доходит до открытого гаджета без перезагрузки фрейма (docs/gadget-apps.md).
  const sendTheme = () => {
    iframeRef.current?.contentWindow?.postMessage(hostThemeMessage(themeRef.current), '*')
  }
  useEffect(sendTheme, [accent, mode])
  const activityVisibleRef = useRef(isVisible)
  activityVisibleRef.current = isVisible
  useEffect(() => {
    const target = iframeRef.current?.contentWindow
    if (!nativeSnapshotSource || !target || !isVisible || isInvalidated || loading || error || !sandboxedHtml) return
    const lifetime = new AbortController()
    const read = queueNativeSnapshots((format, signal) =>
      requestNativeSnapshot(target, format, AbortSignal.any([signal, lifetime.signal])))
    nativeSnapshotSource.current = read
    return () => {
      lifetime.abort()
      if (nativeSnapshotSource.current === read) nativeSnapshotSource.current = null
    }
  }, [nativeSnapshotSource, gadget, chatId, isVisible, loading, error, sandboxedHtml, hasLoaded, isInvalidated, iframeGeneration, reloadTrigger])
  const readinessRef = useRef<ReturnType<typeof startWorkspaceUIReadiness> | null>(null)
  useEffect(() => () => { readinessRef.current?.finish("abandoned") }, [])
  useEffect(() => { if (!isVisible) readinessRef.current?.finish("abandoned") }, [isVisible])
  const prevReloadTriggerRef = useRef(reloadTrigger)
  // Identifies the newest bundle load, so an older one can't write state after being superseded.
  const loadGenerationRef = useRef(0)
  // Bumped by the retry button to ask for a fresh load.
  const [retryNonce, setRetryNonce] = useState(0)
  const connectionGenerationRef = useRef(0)
  const handshakePendingRef = useRef<number | null>(null)
  const gadgetRef = useRef(gadget)
  gadgetRef.current = gadget
  // TODO: Remove `any` when Cap'n Web fixes cyclic type issues (RpcStub<any> triggers deep instantiation)
  const gadgetStubRef = useRef<any>(null)
  const pendingGadgetStubRef = useRef<{
    promise: Promise<any>
    resolve: (stub: any) => void
    reject: (reason: unknown) => void
  } | null>(null)
  const rpcSessionRef = useRef<any>(null)
  // Keep latest callbacks in refs so the message-handler effect never tears down the RPC session.
  const onIframeEscapeRef = useRef(onIframeEscape)
  // Переход на свой адрес по ссылке из гаджета; вне маршрутизатора — обычный переход в этой вкладке.
  const router = useRouter({ warn: false }) as { history: { push(path: string): void } } | undefined
  const openInternalRef = useRef((path: string) => { if (router) router.history.push(path); else window.location.assign(path) })
  openInternalRef.current = (path: string) => { if (router) router.history.push(path); else window.location.assign(path) }
  const onConsoleLogRef = useRef(onConsoleLog)
  onIframeEscapeRef.current = onIframeEscape
  onConsoleLogRef.current = onConsoleLog

  const suspendGadgetCalls = () => {
    if (!pendingGadgetStubRef.current) {
      let resolve!: (stub: any) => void
      let reject!: (reason: unknown) => void
      const promise = new Promise<any>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise
        reject = rejectPromise
      })
      void promise.catch(() => {})
      pendingGadgetStubRef.current = { promise, resolve, reject }
    }
    return pendingGadgetStubRef.current
  }

  const installGadgetStub = (stub: any) => {
    gadgetStubRef.current = stub
    stub.onRpcBroken?.(() => {
      if (gadgetStubRef.current === stub) suspendGadgetCalls()
    })
  }

  const resetConnection = (reason: unknown) => {
    ++connectionGenerationRef.current
    handshakePendingRef.current = null
    pendingGadgetStubRef.current?.reject(reason)
    pendingGadgetStubRef.current = null
    gadgetStubRef.current?.[Symbol.dispose]?.()
    gadgetStubRef.current = null
    rpcSessionRef.current?.[Symbol.dispose]?.()
    rpcSessionRef.current = null
  }

  const reloadIframe = (reason: unknown) => {
    resetConnection(reason)
    setIframeGeneration(generation => generation + 1)
  }

  useEffect(() => {
    if (!rpcSessionRef.current) {
      if (handshakePendingRef.current !== null) {
        reloadIframe(new Error('Gadget changed during RPC handshake.'))
      }
      return
    }

    const generation = ++connectionGenerationRef.current
    const isCurrent = () => generation === connectionGenerationRef.current
    const pendingStub = suspendGadgetCalls()
    const replacementPromise = Promise.resolve().then(() => gadget.connectToGadget(chatId))
    void replacementPromise.then(stub => {
      if (!isCurrent()) stub[Symbol.dispose]?.()
    }, () => {})

    const reconnect = async () => {
      let timeout: ReturnType<typeof setTimeout> | undefined
      try {
        const replacementStub = await Promise.race([
          replacementPromise,
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => reject(new Error('Timed out reconnecting gadget UI.')), RECONNECT_TIMEOUT_MS)
          }),
        ])
        if (!isCurrent()) return
        const oldStub = gadgetStubRef.current
        installGadgetStub(replacementStub)
        pendingStub.resolve(replacementStub)
        if (pendingGadgetStubRef.current === pendingStub) pendingGadgetStubRef.current = null
        oldStub?.[Symbol.dispose]?.()
      } catch (caught) {
        if (isCurrent()) reloadIframe(caught)
      } finally {
        if (timeout !== undefined) clearTimeout(timeout)
      }
    }
    void reconnect()
  }, [gadget, chatId])

  // Effect to handle reloadTrigger changes (code changes)
  useEffect(() => {
    // Only react if reloadTrigger has actually changed from the previous value
    if (reloadTrigger !== undefined && reloadTrigger !== prevReloadTriggerRef.current && reloadTrigger > 0) {
      // Mark as invalidated but don't reload unless visible
      setIsInvalidated(true)
      if (!isVisible) {
        // If not visible, just clear the current state
        setSandboxedHtml(null)
        setHasLoaded(false)
        setError(null)
      }
      // Update the ref to the current value
      prevReloadTriggerRef.current = reloadTrigger
    }
  }, [reloadTrigger, isVisible])

  // Effect to load UI bundle when component becomes visible for the first time or when invalidated
  useEffect(() => {
    // Only load if:
    // 1. Component is visible AND
    // 2. Either never loaded before OR invalidated due to code changes
    if (!isVisible || (hasLoaded && !isInvalidated)) {
      return
    }

    // Superseded loads are ignored by generation rather than by a per-run `cancelled` flag: a run
    // cancelled mid-call would skip its own `setLoading(false)`, leaving the spinner up with
    // nothing to clear it. Comparing generations means the newest run always owns the flag.
    const generation = ++loadGenerationRef.current
    const isCurrent = () => loadGenerationRef.current === generation
    readinessRef.current?.finish("abandoned")
    let resolveSupport!: (value: boolean) => void
    const supported = new Promise<boolean>(resolve => { resolveSupport = resolve })
    const attempt = readinessApi && readinessSurface ? startWorkspaceUIReadiness(readinessApi, readinessSurface, supported) : null
    readinessRef.current = attempt


    // A dropped RPC never settles -- e.g. the stub was disposed under us by a reconnect -- and there
    // is nothing to catch. Rather than spin indefinitely, stop owning the load and offer a retry: the
    // call is idempotent, and a button is a far better answer than a spinner that never resolves.
    const giveUp = setTimeout(() => {
      if (!isCurrent()) return
      loadGenerationRef.current++      // so a late reply can no longer write state
      setLoading(false)
      setError('Экран не загрузился вовремя.')
      resolveSupport(true)
      attempt?.finish("timeout")
    }, UI_BUNDLE_LOAD_TIMEOUT_MS)

    const loadUiBundle = async () => {
      try {
        setLoading(true)
        setError(null)

        const bundle = await gadget.getUiBundle(chatId)
        if (!isCurrent()) return
        if (bundle) {
          // Older editable blueprints do not implement the readiness protocol. Missing support
          // is missing coverage, not a measured failure of an otherwise working editor.
          const supportsReadiness = /type:\s*["']native-ui-readiness["']/.test(bundle.jsCode)
          resolveSupport(supportsReadiness)
          if (!supportsReadiness) attempt?.finish("abandoned")
          const html = createSandboxedHtml(bundle.jsCode, attempt?.observationId, themeRef.current)
          setSandboxedHtml(html)
        } else {
          resolveSupport(true)
          attempt?.finish("error")
          setSandboxedHtml(null)
        }
        setHasLoaded(true)
        setIsInvalidated(false)
      } catch (err) {
        if (!isCurrent()) return
        console.error('Failed to load UI bundle:', err)
        setError('Не удалось загрузить экран')
        resolveSupport(true)
        attempt?.finish("error")
      } finally {
        if (isCurrent()) setLoading(false)
        clearTimeout(giveUp)
      }
    }

    loadUiBundle()
    return () => {
      clearTimeout(giveUp)
      // Dependencies can change without starting a replacement load (most importantly when the
      // view becomes hidden). Revoke this run explicitly so its late reply cannot populate state
      // for a different gadget, chat, or visibility lifecycle.
      if (isCurrent()) loadGenerationRef.current++
      resolveSupport(false)
    }
  // LSP reports an error here, but tsc does not.
  // The LSP error is due to bugs that need to be fixed in Cap'n Web.
  }, [gadget, isVisible, hasLoaded, isInvalidated, chatId, retryNonce, readinessApi, readinessSurface])

  // Effect to handle iframe RPC handshake
  useEffect(() => {
    let cancelled = false

    const handleMessage = async (event: MessageEvent) => {
      // Only handle messages from our iframe. As an extra level of paranoia, also make sure it's
      // from the null origin, just in case somehow the frame managed to browse away (though that
      // should be blocked). Yes, the null origin is identified by the string value "null", not the
      // JS `null`.
      if (event.source !== iframeRef.current?.contentWindow ||
          event.origin !== "null") {
        return
      }

      if (event.data === 'handshake' && event.ports && event.ports[0]) {
        const port = event.ports[0]
        // Фрейм мог перезагрузиться со старой разметкой: тема и акцент отправляются заново.
        sendTheme()
        let gadgetStub: any = null
        resetConnection(new Error('Gadget iframe reloaded.'))
        const generation = connectionGenerationRef.current
        handshakePendingRef.current = generation
        const isCurrent = () => !cancelled &&
          generation === connectionGenerationRef.current &&
          event.source === iframeRef.current?.contentWindow
        try {
          // Open the RPC connection to the gadget's server side
          gadgetStub = await gadgetRef.current.connectToGadget(chatId)
          if (!isCurrent()) {
            gadgetStub[Symbol.dispose]?.()
            port.close()
            return
          }
          installGadgetStub(gadgetStub)
          // Redirectable target: swapping gadgetStubRef reconnects top-level calls without reloading.
          const forwardingTarget = new Proxy(new RpcTarget() as any, {
            get: (target, property, receiver) => {
              if (typeof property === 'symbol' || property in target) {
                return Reflect.get(target, property, receiver)
              }
              const pending = pendingGadgetStubRef.current
              return pending
                ? (...args: any[]) => pending.promise.then(stub => stub[property](...args))
                : gadgetStubRef.current[property]
            },
          })
          rpcSessionRef.current = newMessagePortRpcSession(port, forwardingTarget)
        } catch (caught) {
          gadgetStub?.[Symbol.dispose]?.()
          port.close()
          if (!isCurrent()) return
          console.error('Failed to establish RPC connection:', caught)
          setError('Не удалось связаться с приложением')
          readinessRef.current?.finish("error")
        } finally {
          if (handshakePendingRef.current === generation) handshakePendingRef.current = null
        }
      } else if (event.data?.type === 'console' && onConsoleLogRef.current) {
        onConsoleLogRef.current({
          timestamp: new Date(),
          level: event.data.level,
          message: event.data.message,
        })
      } else if (event.data?.type === 'native-ui-readiness') {
        const attempt = readinessRef.current
        if (attempt && event.data.attempt === attempt.observationId) {
          if (!activityVisibleRef.current || document.visibilityState !== "visible") attempt.finish("abandoned")
          else if (event.data.outcome === "ready") void attempt.afterPaint()
          else if (event.data.outcome === "error") attempt.finish("error")
        }
      } else if (event.data?.type === 'workspace-activity') {
        reportEmbeddedWorkspaceActivity(event, iframeRef.current, activityVisibleRef.current)
      } else if (event.data?.type === 'escape') {
        onIframeEscapeRef.current?.()
      } else if (event.data?.type === 'open-internal') {
        // Своя ссылка гаджета: на той же странице, только по нажатию человека (активация из фрейма
        // переходит к родителю) и не на служебные адреса входа и подключений.
        const path = gadgetInternalPath(event.data.path)
        if (path && navigator.userActivation?.isActive !== false) openInternalRef.current(path)
      }
    }

    window.addEventListener('message', handleMessage)
    return () => {
      cancelled = true
      window.removeEventListener('message', handleMessage)
      resetConnection(new Error('Gadget RPC session was closed.'))
    }
  }, [])

  if (!isVisible && !hasLoaded) {
    // Don't render anything if not visible and never loaded
    return (
      <div
        className="flex items-center justify-center text-kumo-subtle"
        style={{ height }}
      >
        <Text variant="secondary">
          Откройте эту вкладку, чтобы загрузить гаджет
        </Text>
      </div>
    )
  }

  if (loading) {
    return (
      <div style={{
        height,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center'
      }}>
        <Loader size="lg" />
      </div>
    )
  }

  if (error) {
    return (
      <div style={{
        height,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '20px'
      }}>
        <Banner
          variant="error"
          title="Ошибка"
          description={error}
          action={
            <Banner.Action
              onClick={() => {
                setError(null)
                setHasLoaded(false)
                setIsInvalidated(false)
                setRetryNonce(n => n + 1)
              }}
            >
              Попробовать ещё раз
            </Banner.Action>
          }
        />
      </div>
    )
  }

  if (!sandboxedHtml) {
    return (
      <div
        className="relative overflow-hidden bg-kumo-overlay"
        style={{
          height,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <div
          className="themed-accent-glow absolute left-1/2 top-1/2 h-80 w-80 -translate-x-1/2 -translate-y-1/2 rounded-full pointer-events-none"
          style={{
            filter: 'blur(18px)',
          }}
        />

        <div className="relative flex max-w-sm flex-col items-center gap-3 px-6 text-center">
          <div className="themed-user-bubble-shadow flex h-12 w-12 items-center justify-center rounded-xl border border-kumo-line bg-kumo-elevated text-kumo-subtle">
            <Sparkle size={22} weight="regular" />
          </div>
          <div className="space-y-1">
            <h2 className="text-[20px] leading-7 font-normal tracking-[-0.45px] text-kumo-default">
              Интерфейса пока нет
            </h2>
            <p className="text-[15px] leading-5 font-normal tracking-[-0.3px] text-kumo-subtle">
              Когда агент соберёт гаджет, он появится здесь.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ height, width: '100%' }}>
      <iframe
        key={`${reloadTrigger}:${iframeGeneration}`}
        ref={iframeRef}
        srcDoc={sandboxedHtml}
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
          border: 'none'
        }}
        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
        title="Гаджет"
      />
    </div>
  )
}
