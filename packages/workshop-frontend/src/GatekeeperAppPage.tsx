import OrganizationSummaryPanel from "./OrganizationSummaryPanel"
import MailConnectionPanel from "./MailConnectionPanel"
import DriveImportPanel from "./DriveImportPanel"
import CalendarConnectionPanel from "./CalendarConnectionPanel"
import { useEffect, useState } from 'react'
import type { GatekeeperUiFrame } from '@gadgets/workshop-shared/gatekeeper'
import { useAuthenticatedApi } from './AuthContext'
import SandboxedGatekeeperApp from './SandboxedGatekeeperApp'
import AgentConsentPanel from './AgentConsentPanel'
import { reportIssue } from './errorReporting'

import { disposeGatekeeperFrame } from './disposeGatekeeperFrame'
import { AccountsSubscriberAdapter } from './accountsSubscriber'

// Renders a gatekeeper's full-page management app (a sandboxed SPA the gatekeeper serves).
// Fetches the app frame (iframe HTML + `ui` capability) from the backend and hosts it.
export default function GatekeeperAppPage({ appId }: { appId: string }) {
  return appId === 'mnemos' ? <MnemosAccountApp /> : <GatekeeperAppContent appId={appId} />
}

function MnemosAccountApp() {
  const { authenticatedApi } = useAuthenticatedApi()
  const [accounts, setAccounts] = useState<Map<number, string>>(new Map())
  const [selected, setSelected] = useState<number | null>(null)
  const [notice, setNotice] = useState('')
  useEffect(() => {
    let cancelled = false
    let subscription: Awaited<ReturnType<typeof authenticatedApi.subscribeConnectedAccounts>> | undefined
    const subscriber = new AccountsSubscriberAdapter({
      add({ id, description, vendorId }) {
        if (!cancelled && vendorId === 'mnemos') setAccounts(previous => new Map(previous).set(id, description.displayName || description.uniqueName || `Mnemos ${id}`))
      },
      remove(id) {
        if (cancelled) return
        setAccounts(previous => { const next = new Map(previous); next.delete(id); return next })
        setSelected(previous => previous === id ? null : previous)
      },
    })
    authenticatedApi.subscribeConnectedAccounts(subscriber).then(value => {
      if (cancelled) value[Symbol.dispose]()
      else subscription = value
    }).catch(() => { if (!cancelled) setNotice('Не удалось загрузить подключения Mnemos. Обновите страницу.') })
    return () => { cancelled = true; subscription?.[Symbol.dispose]() }
  }, [authenticatedApi])
  return <>
    <label>Организация для управления Mnemos <select aria-label="Организация для управления Mnemos" value={selected ?? ''} onChange={event => setSelected(event.target.value ? Number(event.target.value) : null)}>
      <option value="">Выберите подключение</option>
      {[...accounts].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
    </select></label>
    {notice && <p role="alert">{notice}</p>}
    {selected !== null && accounts.has(selected) && <GatekeeperAppContent key={selected} appId="mnemos" accountId={selected} />}
  </>
}

function GatekeeperAppContent({ appId, accountId }: { appId: string; accountId?: number }) {
  const { authenticatedApi } = useAuthenticatedApi()
  // Wrap the frame in an object: it holds a `ui` RPC stub, and we never want useState's setter to
  // treat a stored value as an updater function.
  const [state, setState] = useState<{ frame: GatekeeperUiFrame } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    let acquired: GatekeeperUiFrame | null = null
    setState(null)
    setError(null)
    authenticatedApi
      .getGatekeeperApp(appId, accountId)
      .then((frame) => {
        if (!frame) {
          if (!cancelled) setError('This app is not available on this deployment.')
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
    return (
      <>{appId === "mnemos" && <OrganizationSummaryPanel />}<GatekeeperAppRecovery key={appId} appId={appId} error={error} retry={() => setAttempt(n => n + 1)} /></>
    )
  }
  if (!state) {
    return <div className="px-4 py-16 text-center text-sm text-kumo-subtle">Loading…</div>
  }

  const consentIds = new URLSearchParams(window.location.search).getAll('request_id')
  if (appId === 'mnemos' && consentIds.length) {
    if (consentIds.length !== 1 || !/^[A-Za-z0-9_-]{43}$/.test(consentIds[0]) || !state.frame.agentConsent) {
      return <p role="alert">Запрос подключения агента недействителен или не поддерживается.</p>
    }
    return <AgentConsentPanel key={consentIds[0]} request={consentIds[0]} capability={state.frame.agentConsent} />
  }

  // Fill the viewport below the header so the embedded app can manage its own internal layout.
  return (
    <div style={{ height: 'calc(100vh - 56px)', display: 'flex', flexDirection: 'column' }}>
      {appId === 'mnemos' && <><OrganizationSummaryPanel /><CalendarConnectionPanel /><MailConnectionPanel /><DriveImportPanel /></>}
      <div style={{ flex: 1, minHeight: 0 }}><SandboxedGatekeeperApp frame={state.frame} gatekeeperVendorId={appId} /></div>
    </div>
  )
}

function GatekeeperAppRecovery({ appId, error, retry }: { appId: string, error: string, retry: () => void }) {
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
        setAccounts(previous => new Map(previous).set(id, description.displayName || description.uniqueName || 'Connected account'))
      },
      remove(id) {
        if (!cancelled) setAccounts(previous => { const next = new Map(previous); next.delete(id); return next })
      },
      ready() {},
    })
    authenticatedApi.subscribeConnectedAccounts(subscriber).then(value => {
      if (cancelled) value[Symbol.dispose]()
      else subscription = value
    }).catch(() => { if (!cancelled) setNotice('Could not load connected accounts. Try opening the app again.') })
    return () => { cancelled = true; subscription?.[Symbol.dispose]() }
  }, [authenticatedApi, appId])

  async function reconnect(id: number) {
    setBusy(true); setLoginUrl(null); setNotice('')
    try {
      const { url } = await authenticatedApi.reconnectAccount(id)
      setLoginUrl(url)
    } catch {
      setNotice('Could not start sign-in. Try again.')
    } finally { setBusy(false) }
  }

  return <div className="mx-auto max-w-md space-y-4 px-4 py-16 text-sm text-kumo-subtle">
    <p role="alert">{error}</p>
    <p>Try opening the app again. If your sign-in has expired, reconnect your account first.</p>
    {[...accounts].map(([id, name]) => <div key={id}>
      <button type="button" disabled={busy} onClick={() => void reconnect(id)}>Reconnect {name}</button>
    </div>)}
    {loginUrl && <p><a href={loginUrl} target="_blank" rel="noopener noreferrer">Continue sign-in</a>. After signing in, return here and open the app again.</p>}
    {notice && <p role="status">{notice}</p>}
    <button type="button" disabled={busy} onClick={retry}>Open app again</button>
  </div>
}
