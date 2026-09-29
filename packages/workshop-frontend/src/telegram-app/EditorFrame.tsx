import { useEffect, useRef, useState } from 'react'
import { RpcTarget, newMessagePortRpcSession, type RpcStub } from 'capnweb'
import { hostThemeMessage, type HostThemeMode } from '../gadgetHostTheme'
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
  /** Тема Mini App: тёмная, если в Telegram тёмная тема. */
  mode: HostThemeMode
  /** Появился (или пропал) источник снимка — фрейм готов отдавать документ. */
  onSnapshotSource(read: NativeSnapshotSource | null): void
  onFailed(): void
}

export default function EditorFrame({ api, accent, mode, onSnapshotSource, onFailed }: Props) {
  // Код экрана; разметку фрейма собирает «готов» с темой на этот момент — первый кадр без мигания.
  const [code, setCode] = useState<string | null>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const themeRef = useRef({ mode, accent })
  themeRef.current = { mode, accent }
  const callbacks = useRef({ onSnapshotSource, onFailed })
  callbacks.current = { onSnapshotSource, onFailed }

  useEffect(() => {
    let cancelled = false
    api.getUiBundle().then(bundle => {
      if (cancelled) return
      if (!bundle) { callbacks.current.onFailed(); return }
      setCode(bundle.jsCode)
    }, () => { if (!cancelled) callbacks.current.onFailed() })
    return () => { cancelled = true }
  }, [api])

  // Смена темы Telegram или акцента — сообщением host-theme, без перезагрузки фрейма.
  useEffect(() => {
    frame.current?.contentWindow?.postMessage(hostThemeMessage(themeRef.current), '*')
  }, [accent, mode, code])

  useEffect(() => {
    if (code === null) return
    let session: { [Symbol.dispose](): void } | null = null
    let editor: RpcStub<RpcTarget> | null = null
    let alive = true
    const onMessage = async (event: MessageEvent) => {
      const window = frame.current?.contentWindow
      // Только наш фрейм и только непрозрачный источник: фрейм не мог уйти на другой адрес.
      if (!window || event.source !== window || event.origin !== 'null') return
      // Фрейм загружен отдельным адресом со своим CSP; разметку редактора он получает отсюда.
      if (event.data?.type === 'editor-frame-ready') { window.postMessage({ type: 'editor-frame-html', html: createSandboxedHtml(code, undefined, themeRef.current) }, '*'); return }
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
        window.postMessage(hostThemeMessage(themeRef.current), '*')
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
  }, [api, code])

  if (code === null) return <div className="ma-editor ma-editor-wait" role="status">Открываю редактор…</div>
  // Без allow-popups и allow-same-origin: фрейм не открывает окон и не видит страницу Mini App.
  return <iframe ref={frame} className="ma-editor" src={MINI_APP_EDITOR_FRAME_PATH} sandbox="allow-scripts" title="Редактор документа" />
}
