import OrganizationSummaryPanel from "./OrganizationSummaryPanel"
import MailConnectionPanel from "./MailConnectionPanel"
import DriveImportPanel from "./DriveImportPanel"
import CalendarConnectionPanel from "./CalendarConnectionPanel"
import { useEffect, useState } from 'react'
import { Button, Dialog, Select } from '@cloudflare/kumo'
import { ChartBar, PlugsConnected, X } from '@phosphor-icons/react'
import { WorkshopIconButton } from './components/WorkshopControls'
import type { GatekeeperUiFrame, SupportedResource } from '@gadgets/workshop-shared/gatekeeper'
import { useAuthenticatedApi } from './AuthContext'
import SandboxedGatekeeperApp from './SandboxedGatekeeperApp'
import { reportIssue } from './errorReporting'

import { disposeGatekeeperFrame } from './disposeGatekeeperFrame'
import { AccountsSubscriberAdapter } from './accountsSubscriber'
import { receives } from './accountCapabilities'

type UiAccount = { name: string; resources: SupportedResource[] }

// Renders a gatekeeper's full-page management app (a sandboxed SPA the gatekeeper serves).
// Fetches the app frame (iframe HTML + `ui` capability) from the backend and hosts it.
export default function GatekeeperAppPage({ appId, section, project, accountId, onAccountChange }: { appId: string; section?: string; project?: string; accountId?:number; onAccountChange?:(account:number|null)=>void }) {
  const { authenticatedApi } = useAuthenticatedApi()
  const [accounts, setAccounts] = useState<Map<number, UiAccount>>(new Map())
  const [ready, setReady] = useState(false)
  const [readyFor,setReadyFor]=useState<{api:object;appId:string}|null>(null)
  const initialAccount = () => { const value = new URLSearchParams(window.location.search).get("account"); return value !== null && /^\d+$/.test(value) ? Number(value) : null }
  const [selected, setSelected] = useState<number | null>(initialAccount)
  const requested=onAccountChange ? accountId??null : selected
  const [notice, setNotice] = useState('')
  useEffect(() => {
    let cancelled = false
    let subscription: Awaited<ReturnType<typeof authenticatedApi.subscribeConnectedAccounts>> | undefined
    setAccounts(new Map()); setReady(false); setSelected(initialAccount()); setNotice('')
    const subscriber = new AccountsSubscriberAdapter({
      add({ id, description, vendorId, supportedResources }) {
        if (cancelled || vendorId !== appId || !description.providesUi) return
        const name = description.displayName || description.uniqueName || `${description.providesUi.title} ${id}`
        setAccounts(previous => new Map(previous).set(id, { name, resources: supportedResources }))
      },
      remove(id) {
        if (cancelled) return
        setAccounts(previous => { const next = new Map(previous); next.delete(id); return next })
        setSelected(previous => previous === id ? null : previous)
      },
      ready() { if (!cancelled) {setReadyFor({api:authenticatedApi,appId});setReady(true)} },
    })
    authenticatedApi.subscribeConnectedAccounts(subscriber).then(value => {
      if (cancelled) value[Symbol.dispose]()
      else subscription = value
    }).catch(() => { if (!cancelled) { setNotice('Не удалось загрузить подключения. Обновите страницу.'); setReadyFor({api:authenticatedApi,appId}); setReady(true) } })
    return () => { cancelled = true; subscription?.[Symbol.dispose]() }
  }, [authenticatedApi, appId])

  if (!ready || readyFor?.api!==authenticatedApi || readyFor.appId!==appId) return <div className="px-4 py-16 text-center text-sm text-kumo-subtle">Загрузка…</div>
  const ids = [...accounts.keys()]
  // Один аккаунт открывается сразу. Ни одного в подписке — тоже сразу: принудительно заведённые
  // аккаунты в ней не показываются, и аккаунт по вендору выбирает сервер.
  const current = requested ?? (ids.length===1 ? ids[0] : null)
  const open = ids.length===0 || current!==null
  return <>
    {ids.length > 1 && <div className="px-4 pt-3">
      <Select label="Организация" placeholder="Выберите подключение" value={current === null ? null : String(current)} onValueChange={value => {const id=value?Number(value):null;if(onAccountChange)onAccountChange(id);else setSelected(id)}}>
        {ids.map(id => <Select.Option key={id} value={String(id)}>{accounts.get(id)!.name}</Select.Option>)}
      </Select>
    </div>}
    {notice && <p role="alert">{notice}</p>}
    {open && <GatekeeperAppContent key={`${current ?? 'default'}:${section ?? ''}:${project ?? ''}`} appId={appId} accountId={current ?? undefined} resources={current === null ? [] : accounts.get(current)?.resources ?? []} />}
  </>
}

function GatekeeperAppContent({ appId, accountId, resources }: { appId: string; accountId?: number; resources: SupportedResource[] }) {
  const { authenticatedApi } = useAuthenticatedApi()
  // Wrap the frame in an object: it holds a `ui` RPC stub, and we never want useState's setter to
  // treat a stored value as an updater function.
  const [state, setState] = useState<{ frame: GatekeeperUiFrame } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [tool, setTool] = useState<'mail' | 'calendar' | 'drive' | 'summary' | null>(null)

  useEffect(() => {
    let cancelled = false
    let acquired: GatekeeperUiFrame | null = null
    setState(null)
    setError(null)
    authenticatedApi
      .getGatekeeperApp(appId, accountId)
      .then((frame) => {
        if (!frame) {
          if (!cancelled) setError('Это приложение недоступно в этой установке.')
          return
        }
        if (cancelled) {
          disposeGatekeeperFrame(frame)
          return
        }
        acquired = frame
        setState({ frame })
      })
      .catch((err) => {
        console.error('Failed to load gatekeeper app:', err)
        reportIssue('gatekeeper-app.load', err, {
          gatekeeperVendorId: appId,
        })
        if (!cancelled) setError(`${err}`)
      })
    return () => {
      cancelled = true
      disposeGatekeeperFrame(acquired)
    }
  }, [authenticatedApi, appId, accountId, attempt])

  if (error) {
    return <GatekeeperAppRecovery key={appId} appId={appId} error={error} retry={() => setAttempt(n => n + 1)} />
  }
  if (!state) {
    return <div className="px-4 py-16 text-center text-sm text-kumo-subtle">Загрузка…</div>
  }

  // Панели показываются по возможностям, которые заявили описание аккаунта и фрейм, а не по имени вендора.
  const mail = receives(resources, 'mail') || !!state.frame.mailDraftSender
  const calendar = receives(resources, 'calendar') || !!state.frame.calendarDraftCreator
  const drive = receives(resources, 'drive')
  // Fill the viewport below the header so the embedded app can manage its own internal layout.
  return (
    <div style={{ height: 'calc(100vh - 56px)', display: 'flex', flexDirection: 'column' }}>
      {(mail || calendar || drive || state.frame.organizationMetrics) && <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-b border-kumo-line px-4 py-2">
        {(mail || calendar || drive) && <Button variant="ghost" size="sm" onClick={() => setTool(mail ? 'mail' : calendar ? 'calendar' : 'drive')}><PlugsConnected size={16} />Подключения</Button>}
        {state.frame.organizationMetrics && <Button variant="ghost" size="sm" onClick={() => setTool('summary')}><ChartBar size={16} />Свод организаций</Button>}
      </div>}
      <Dialog.Root open={tool !== null} onOpenChange={open => { if (!open) setTool(null) }}>
        <Dialog size="lg" className="!w-[min(600px,calc(100vw-32px))] max-h-[85dvh] overflow-y-auto bg-kumo-base p-0">
          <div className="flex items-start justify-between gap-4 border-b border-kumo-line p-5">
            <div>
              <Dialog.Title className="text-lg font-medium">{tool === 'summary' ? 'Организации' : 'Подключения'}</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-kumo-subtle">{tool === 'summary' ? 'Общий свод по вашим организациям.' : 'Почта, календари и файлы для работы команды.'}</Dialog.Description>
            </div>
            <Dialog.Close render={props => <WorkshopIconButton {...props} aria-label="Закрыть"><X size={18} /></WorkshopIconButton>} />
          </div>
          {tool !== 'summary' && <nav aria-label="Тип подключения" className="flex flex-wrap gap-2 border-b border-kumo-line px-5 py-3">
            {mail && <Button variant={tool === 'mail' ? 'secondary' : 'ghost'} aria-pressed={tool === 'mail'} onClick={() => setTool('mail')}>Почта</Button>}
            {calendar && <Button variant={tool === 'calendar' ? 'secondary' : 'ghost'} aria-pressed={tool === 'calendar'} onClick={() => setTool('calendar')}>Календарь</Button>}
            {drive && <Button variant={tool === 'drive' ? 'secondary' : 'ghost'} aria-pressed={tool === 'drive'} onClick={() => setTool('drive')}>Файлы</Button>}
          </nav>}
          <div className="p-5">
            {tool === 'summary' && state.frame.organizationMetrics && <OrganizationSummaryPanel appId={appId} />}
            {tool === 'calendar' && calendar && <CalendarConnectionPanel />}
            {tool === 'mail' && mail && <MailConnectionPanel />}
            {tool === 'drive' && drive && <DriveImportPanel />}
          </div>
        </Dialog>
      </Dialog.Root>
      <div style={{ flex: 1, minHeight: 0 }}><SandboxedGatekeeperApp frame={state.frame} gatekeeperVendorId={appId} /></div>
    </div>
  )
}

function GatekeeperAppRecovery({ appId, retry }: { appId: string, error: string, retry: () => void }) {
  const { authenticatedApi } = useAuthenticatedApi()
  const [accounts, setAccounts] = useState<Map<number, string>>(new Map())
  const [busy, setBusy] = useState(false)
  const [loginUrl, setLoginUrl] = useState<string | null>(null)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let cancelled = false
    let subscription: Awaited<ReturnType<typeof authenticatedApi.subscribeConnectedAccounts>> | undefined
    const subscriber = new AccountsSubscriberAdapter({
      add({ id, description, vendorId }) {
        if (cancelled || vendorId !== appId) return
        setAccounts(previous => new Map(previous).set(id, description.displayName || description.uniqueName || 'Подключённый аккаунт'))
      },
      remove(id) {
        if (!cancelled) setAccounts(previous => { const next = new Map(previous); next.delete(id); return next })
      },
      ready() {},
    })
    authenticatedApi.subscribeConnectedAccounts(subscriber).then(value => {
      if (cancelled) value[Symbol.dispose]()
      else subscription = value
    }).catch(() => { if (!cancelled) setNotice('Не удалось загрузить подключённые аккаунты. Откройте приложение ещё раз.') })
    return () => { cancelled = true; subscription?.[Symbol.dispose]() }
  }, [authenticatedApi, appId])

  async function reconnect(id: number) {
    setBusy(true); setLoginUrl(null); setNotice('')
    try {
      const { url } = await authenticatedApi.reconnectAccount(id)
      setLoginUrl(url)
    } catch {
      setNotice('Не удалось начать вход. Попробуйте ещё раз.')
    } finally { setBusy(false) }
  }

  return <div className="mx-auto max-w-md space-y-4 px-4 py-16 text-sm text-kumo-subtle">
    <h1 className="text-lg font-medium text-kumo-default">Не удалось открыть «Память»</h1>
    <p>Сессия организации могла истечь. Войдите снова, чтобы продолжить работу с документами и агентами.</p>
    {[...accounts].map(([id, name]) => <div key={id}>
      <Button variant="primary" type="button" disabled={busy} onClick={() => void reconnect(id)}>Переподключить {name}</Button>
    </div>)}
    {loginUrl && <p><a className="font-medium underline text-kumo-default" href={loginUrl} rel="noopener noreferrer">Продолжить вход →</a></p>}
    {notice && <p role="status">{notice}</p>}
    <Button variant="secondary" type="button" disabled={busy} onClick={retry}>Открыть приложение ещё раз</Button>
  </div>
}
