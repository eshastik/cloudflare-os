import OrganizationSummaryPanel from "./OrganizationSummaryPanel"
import { startAccountConnect } from './auth/accountConnect'
import MailConnectionPanel from "./MailConnectionPanel"
import DriveImportPanel from "./DriveImportPanel"
import CalendarConnectionPanel from "./CalendarConnectionPanel"
import { useEffect, useRef, useState } from 'react'
import { Button, Dialog, Select } from '@cloudflare/kumo'
import { X } from '@phosphor-icons/react'
import { WorkshopIconButton } from './components/WorkshopControls'
import type { SupportedResource } from '@gadgets/workshop-shared/gatekeeper'
import type { GatekeeperAppFrame } from '@gadgets/workshop-shared/api'
import { useAuthenticatedApi } from './AuthContext'
import SandboxedGatekeeperApp from './SandboxedGatekeeperApp'
import GatekeeperSectionLoading from './GatekeeperSectionLoading'
import { loadGatekeeperFrame } from './gatekeeperFrameCache'
import { reportIssue } from './errorReporting'

import { disposeGatekeeperFrame } from './disposeGatekeeperFrame'
import { AccountsSubscriberAdapter } from './accountsSubscriber'
import { receives } from './accountCapabilities'

type UiAccount = { name: string; resources: SupportedResource[] }

// Renders a gatekeeper's full-page management app (a sandboxed SPA the gatekeeper serves).
// Fetches the app frame (iframe HTML + `ui` capability) from the backend and hosts it.
// Раздел и проект фрейм читает из адреса сам; их смена не пересоздаёт фрейм.
// loadingTitle — название раздела из меню: его показывает индикатор загрузки.
export default function GatekeeperAppPage({ appId, accountId, tool, onAccountChange, embeddedIntake = false, onClosePanel, onIntakeDropReady, loadingTitle }: { appId: string; section?: string; project?: string; accountId?:number; tool?:'connections'|'summary'; onAccountChange?:(account:number|null)=>void; embeddedIntake?: boolean; onClosePanel?:()=>void; onIntakeDropReady?:(handler:((transfer:DataTransfer)=>void)|null)=>void; loadingTitle?: string }) {
  const { authenticatedApi } = useAuthenticatedApi()
  const [accounts, setAccounts] = useState<Map<number, UiAccount>>(new Map())
  const [ready, setReady] = useState(false)
  const [readyFor,setReadyFor]=useState<{api:object;appId:string}|null>(null)
  const initialAccount = () => { if (embeddedIntake) return null; const value = new URLSearchParams(window.location.search).get("account"); return value !== null && /^\d+$/.test(value) ? Number(value) : null }
  const [selected, setSelected] = useState<number | null>(initialAccount)
  const requested=onAccountChange ? accountId??null : selected
  // Подключение, которое открыл сервер, когда адрес его не называл.
  const [opened, setOpened] = useState<{appId:string;accountId:number}|null>(null)
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

  const subscribed = ready && readyFor?.api===authenticatedApi && readyFor.appId===appId
  // Адрес без подключения: сервер сам выбирает подключение по вендору, подписку не ждём — она нужна
  // только для выбора среди нескольких организаций и для панелей почты и календаря. Принудительно
  // заведённые подключения в подписке не видны вовсе.
  if (requested !== null && !subscribed) return <GatekeeperSectionLoading title={loadingTitle} />
  const ids = [...accounts.keys()]
  const current = requested ?? (opened?.appId === appId ? opened.accountId : null) ?? (ids.length===1 ? ids[0] : null)
  return <>
    {subscribed && ids.length > 1 && <div className="px-4 pt-3">
      <Select label="Организация" placeholder="Выберите подключение" value={current === null ? null : String(current)} onValueChange={value => {const id=value?Number(value):null;if(onAccountChange)onAccountChange(id);else setSelected(id)}}>
        {ids.map(id => <Select.Option key={id} value={String(id)}>{accounts.get(id)!.name}</Select.Option>)}
      </Select>
    </div>}
    {notice && <p role="alert">{notice}</p>}
    <GatekeeperAppContent key={`${requested ?? 'default'}:${tool ?? ''}`} appId={appId} requestedTool={tool} accountId={requested ?? undefined} resources={current === null ? [] : accounts.get(current)?.resources ?? []} accountsReady={subscribed} loadingTitle={loadingTitle} onOpened={id => setOpened({appId, accountId: id})} embeddedIntake={embeddedIntake} onClosePanel={onClosePanel} onIntakeDropReady={onIntakeDropReady} />
  </>
}

function GatekeeperAppContent({ appId, accountId, resources, accountsReady, loadingTitle, onOpened, embeddedIntake, requestedTool, onClosePanel, onIntakeDropReady }: { appId: string; accountId?: number; resources: SupportedResource[]; accountsReady: boolean; loadingTitle?: string; onOpened: (accountId: number) => void; embeddedIntake: boolean; requestedTool?: 'connections' | 'summary'; onClosePanel?:()=>void; onIntakeDropReady?:(handler:((transfer:DataTransfer)=>void)|null)=>void }) {
  const { authenticatedApi } = useAuthenticatedApi()
  // Wrap the frame in an object: it holds a `ui` RPC stub, and we never want useState's setter to
  // treat a stored value as an updater function.
  const [state, setState] = useState<{ frame: GatekeeperAppFrame } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [tool, setTool] = useState<'mail' | 'calendar' | 'drive' | 'summary' | null>(null)
  const [toolOpened, setToolOpened] = useState(false)
  const openedRef = useRef(onOpened)
  openedRef.current = onOpened

  useEffect(() => {
    let cancelled = false
    let acquired: GatekeeperAppFrame | null = null
    setState(null)
    setError(null)
    loadGatekeeperFrame(authenticatedApi, appId, accountId)
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
        if (typeof frame.accountId === 'number') openedRef.current(frame.accountId)
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
    return <GatekeeperSectionLoading title={loadingTitle} />
  }

  // Панели показываются по возможностям, которые заявили описание аккаунта и фрейм, а не по имени вендора.
  const mail = receives(resources, 'mail') || !!state.frame.mailDraftSender
  const calendar = receives(resources, 'calendar') || !!state.frame.calendarDraftCreator
  const drive = receives(resources, 'drive')
  // Settings links here with ?tool=…; the dialog opens once the frame has declared what it offers.
  // Панели почты и файлов зависят от подписки на подключения; решение ждёт её.
  if (tool === null && requestedTool && !toolOpened && (requestedTool === 'summary' || accountsReady)) {
    const initial = requestedTool === 'summary' ? (state.frame.organizationMetrics ? 'summary' : null) : mail ? 'mail' : calendar ? 'calendar' : drive ? 'drive' : null
    setToolOpened(true)
    if (initial) setTool(initial)
  }
  // Фрейм занимает ровно область содержимого оболочки и прокручивается сам. Прежняя высота
  // calc(100vh - 56px) на iPhone выходила за видимую часть экрана (100vh там — экран без панелей Safari),
  // и низ фрейма уходил под панель браузера.
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Dialog.Root open={tool !== null} onOpenChange={open => { if (!open) setTool(null) }}>
        <Dialog size="lg" className="!w-[min(600px,calc(100vw-32px))] max-h-[85dvh] overflow-y-auto bg-kumo-base p-0">
          <div className="flex items-start justify-between gap-4 border-b border-kumo-line p-5">
            <div>
              <Dialog.Title className="text-lg font-medium">{tool === 'summary' ? 'Свод организаций' : 'Почта, календари и файлы'}</Dialog.Title>
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
      <div style={{ flex: 1, minHeight: 0 }}><SandboxedGatekeeperApp accountId={accountId ?? state.frame.accountId} frame={state.frame} loadingTitle={loadingTitle} gatekeeperVendorId={appId} embeddedIntake={embeddedIntake} onClosePanel={onClosePanel} onIntakeDropReady={onIntakeDropReady} /></div>
    </div>
  )
}

function GatekeeperAppRecovery({ appId, retry }: { appId: string, error: string, retry: () => void }) {
  const { authenticatedApi } = useAuthenticatedApi()
  const [accounts, setAccounts] = useState<Map<number, string>>(new Map())
  const [busy, setBusy] = useState(false)
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
    setBusy(true); setNotice('')
    try {
      await startAccountConnect({ kind: 'reconnect', accountId: id })
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
    {notice && <p role="status">{notice}</p>}
    <Button variant="secondary" type="button" disabled={busy} onClick={retry}>Открыть приложение ещё раз</Button>
  </div>
}
