import { useEffect, useRef, useState } from 'react'
import type { GatekeeperAgentConsent, GatekeeperUiFrame } from '@gadgets/workshop-shared/gatekeeper'

type Preview = Awaited<ReturnType<GatekeeperAgentConsent['preview']>>

/** Parent owns and disposes the account capability. No callback is sent to the iframe. */
export default function AgentConsentPanel({ request, capability }: {
  request: string; capability: NonNullable<GatekeeperUiFrame['agentConsent']>
}) {
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(true)
  const [notice, setNotice] = useState('')
  const [callback, setCallback] = useState<string | null>(null)
  const deciding = useRef(false)
  const revision = useRef(0)

  useEffect(() => {
    const current = ++revision.current
    setPreview(null); setCallback(null); setBusy(true); setNotice(''); deciding.current = false
    capability.preview(request).then(value => {
      if (revision.current === current) setPreview(value)
    }).catch(() => {
      if (revision.current === current) setNotice('Не удалось открыть запрос. Он мог истечь, быть использован или ваша сессия закончилась. Начните подключение заново.')
    }).finally(() => { if (revision.current === current) setBusy(false) })
    return () => { ++revision.current }
  }, [request, capability])

  async function decide(approved: boolean) {
    if (!preview || busy || deciding.current) return
    deciding.current = true
    const selection = preview.selection, current = revision.current
    setBusy(true); setPreview(null); setNotice('')
    try {
      const result = await capability.decide(selection, approved)
      if (revision.current !== current) return
      const target = new URL(result.redirect_uri)
      const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(target.hostname)
      if (target.username || target.password || target.hash ||
          (target.protocol !== 'https:' && !(target.protocol === 'http:' && loopback))) throw new Error('Invalid callback')
      setCallback(target.href)
      setNotice(approved ? 'Подключение подтверждено. Вернитесь в клиент агента, чтобы завершить вход.' : 'Подключение отклонено.')
    } catch {
      if (revision.current === current) setNotice('Результат не подтверждён. Проверьте список подключений и начните новый запрос в клиенте агента. Повторная выдача автоматически не выполняется.')
    } finally { if (revision.current === current) setBusy(false) }
  }

  return <section className="mx-auto max-w-xl space-y-4 p-6">
    <h1>Подключение личного агента</h1>
    {preview && <>
      <p>Аккаунт: {preview.account}</p>
      <p>Клиент: {preview.client_id}</p>
      <p>Ресурс: {preview.resource}</p>
      <p>Запрошенные разрешения: {preview.scopes.join(', ')}</p>
      <p>Срок запроса: {preview.expires_at}</p>
      <p>Подтверждайте только подключение, которое вы начали в своём клиенте. Доступ к документам назначается отдельно и ограничен вашими правами.</p>
      <button type="button" disabled={busy} onClick={() => void decide(true)}>Подключить агента</button>{' '}
      <button type="button" disabled={busy} onClick={() => void decide(false)}>Отклонить</button>
    </>}
    {busy && <p role="status">Загрузка…</p>}
    {notice && <p role="status">{notice}</p>}
    {callback && <a href={callback} rel="noreferrer" referrerPolicy="no-referrer">Вернуться в клиент агента</a>}
  </section>
}
