import { useEffect, useRef, useState } from 'react'
import { RpcTarget, newMessagePortRpcSession, type RpcStub } from 'capnweb'
import { gadgetAccentVariables, isAccentHex } from '@gadgets/workshop-shared/accent-theme'
import { createSandboxedHtml } from '../gadgetSandbox'
import { queueNativeSnapshots, requestNativeSnapshot, type NativeSnapshotSource } from '../nativeSnapshotSource'
import { MINI_APP_EDITOR_FRAME_PATH } from '@gadgets/workshop-shared/telegram-mini-app'
import type { DocumentApi } from './miniAppDocument'

// Фрейм настоящего редактора (тот же код, что на сайте) в Mini App. Хост урезан: фрейм получает
// только связь с сервером своего документа (через сервер Mini App, перечень методов ограничен там).
// Переходы по ссылкам, всплывающие окна и прочие просьбы фрейма к хосту не исполняются: принимается
// лишь рукопожатие RPC; снимок документа хост просит сам.

type Props = {
  api: DocumentApi
  accent: string
  /** Появился (или пропал) источник снимка — фрейм готов отдавать документ. */
  onSnapshotSource(read: NativeSnapshotSource | null): void
  onFailed(): void
}

export default function EditorFrame({ api, accent, onSnapshotSource, onFailed }: Props) {
  const [html, setHtml] = useState<string | null>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const accentRef = useRef(accent)
  accentRef.current = accent
  const callbacks = useRef({ onSnapshotSource, onFailed })
  callbacks.current = { onSnapshotSource, onFailed }

  useEffect(() => {
    let cancelled = false
    api.getUiBundle().then(bundle => {
      if (cancelled) return
      if (!bundle) { callbacks.current.onFailed(); return }
      setHtml(createSandboxedHtml(bundle.jsCode, undefined, accentRef.current))
    }, () => { if (!cancelled) callbacks.current.onFailed() })
    return () => { cancelled = true }
  }, [api])

  useEffect(() => {
    const target = frame.current?.contentWindow
    if (!target || !isAccentHex(accent)) return
    target.postMessage({ type: 'host-accent', vars: gadgetAccentVariables(accent) }, '*')
  }, [accent, html])

  useEffect(() => {
    if (!html) return
    let session: { [Symbol.dispose](): void } | null = null
    let editor: RpcStub<RpcTarget> | null = null
    let alive = true
    const onMessage = async (event: MessageEvent) => {
      const window = frame.current?.contentWindow
      // Только наш фрейм и только непрозрачный источник: фрейм не мог уйти на другой адрес.
      if (!window || event.source !== window || event.origin !== 'null') return
      // Фрейм загружен отдельным адресом со своим CSP; разметку редактора он получает отсюда.
      if (event.data?.type === 'editor-frame-ready') { window.postMessage({ type: 'editor-frame-html', html }, '*'); return }
      if (event.data !== 'handshake' || !event.ports?.[0]) return
      const port = event.ports[0]
      session?.[Symbol.dispose](); editor?.[Symbol.dispose]()
      try {
        const next = await api.connectEditor()
        if (!alive || frame.current?.contentWindow !== window) { next[Symbol.dispose](); port.close(); return }
        editor = next
        const stub = next as unknown as Record<string, (...args: unknown[]) => unknown>
        // Вызовы фрейма уходят заглушке редактора; своих методов у цели нет.
        const forward = new Proxy(new RpcTarget() as unknown as Record<string | symbol, unknown>, {
          get: (base, property, receiver) => typeof property === 'symbol' || property in base ? Reflect.get(base, property, receiver) : stub[property],
        })
        session = newMessagePortRpcSession(port, forward as unknown as RpcTarget) as unknown as { [Symbol.dispose](): void }
        if (isAccentHex(accentRef.current)) window.postMessage({ type: 'host-accent', vars: gadgetAccentVariables(accentRef.current) }, '*')
        callbacks.current.onSnapshotSource(queueNativeSnapshots((format, signal) => requestNativeSnapshot(window, format, signal)))
      } catch {
        port.close()
        if (alive) callbacks.current.onFailed()
      }
    }
    addEventListener('message', onMessage)
    return () => {
      alive = false
      removeEventListener('message', onMessage)
      callbacks.current.onSnapshotSource(null)
      session?.[Symbol.dispose](); editor?.[Symbol.dispose]()
    }
  }, [api, html])

  if (!html) return <div className="ma-editor ma-editor-wait" role="status">Открываю редактор…</div>
  // Без allow-popups и allow-same-origin: фрейм не открывает окон и не видит страницу Mini App.
  return <iframe ref={frame} className="ma-editor" src={MINI_APP_EDITOR_FRAME_PATH} sandbox="allow-scripts" title="Редактор документа" />
}
