import { useEffect, useRef, useState } from 'react'
import { Dialog } from '@cloudflare/kumo'
import { X, Check, Robot } from '@phosphor-icons/react'
import type { RpcStub } from 'capnweb'
import type { AuthenticatedApi } from '@gadgets/workshop-shared/api'
import type { GatekeeperAgentConsent } from '@gadgets/workshop-shared/gatekeeper'
import { WorkshopIconButton } from './components/WorkshopControls'
import { disposeGatekeeperFrame } from './disposeGatekeeperFrame'
import { openAgentConsentFrame, type AgentConsentFrame } from './accountCapabilities'

type Api = Pick<RpcStub<AuthenticatedApi>, 'subscribeConnectedAccounts' | 'getGatekeeperApp'>
type Preview = Awaited<ReturnType<GatekeeperAgentConsent['preview']>>
type Opened = { frame: AgentConsentFrame; vendorId: string; accountId: number }

const REQUEST_ID = /^[A-Za-z0-9_-]{43}$/

const SECONDARY = 'h-11 cursor-pointer rounded-full border border-kumo-fill-hover bg-kumo-overlay px-[18px] text-[15px] text-kumo-default transition-colors hover:bg-kumo-tint disabled:cursor-not-allowed disabled:opacity-60'
const PRIMARY = 'h-11 min-w-[140px] cursor-pointer rounded-full bg-kumo-brand px-[22px] text-[15px] font-semibold text-white transition-colors hover:bg-kumo-brand-hover disabled:cursor-not-allowed disabled:opacity-60'

const INVALID_LINK = 'Ссылка на подключение агента неверна: в ней должен быть ровно один request_id из 43 символов. Начните подключение заново в клиенте агента.'
const NO_ACCOUNT = 'Ни одно подключение не принимает агентов. Подключите аккаунт с экраном управления и начните запрос заново.'
const EXPIRED = 'Не удалось открыть запрос. Он мог истечь, быть использован или ваша сессия закончилась. Начните подключение заново в клиенте агента.'
const UNCONFIRMED = 'Результат не подтверждён. Проверьте список подключений и начните новый запрос в клиенте агента. Повторная выдача автоматически не выполняется.'

function formatExpiry(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
}

/** Диалог подтверждения внешнего агента поверх «Подключений». Фрейм аккаунта открывается и закрывается здесь; в iframe ничего не передаётся. */
export default function AgentConsentDialog({ requestIds, api, onClose, returnTo = href => window.location.assign(href) }: { requestIds: string[]; api: Api; onClose: () => void; returnTo?: (href: string) => void }) {
  const request = requestIds.length === 1 && REQUEST_ID.test(requestIds[0]) ? requestIds[0] : null
  const [opened, setOpened] = useState<Opened | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(request !== null)
  const [notice, setNotice] = useState(request === null ? INVALID_LINK : '')
  const [callback, setCallback] = useState<string | null>(null)
  const [settled, setSettled] = useState(false)
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const deciding = useRef(false)
  const revision = useRef(0)

  useEffect(() => {
    if (request === null) return
    const current = ++revision.current
    let acquired: Opened | null = null
    setOpened(null); setPreview(null); setCallback(null); setSettled(false); setBusy(true); setNotice(''); deciding.current = false
    openAgentConsentFrame(api).then(async value => {
      if (revision.current !== current) { disposeGatekeeperFrame(value?.frame ?? null); return }
      if (!value) { setNotice(NO_ACCOUNT); return }
      acquired = value
      setOpened(value)
      const shown = await value.frame.agentConsent.preview(request)
      if (revision.current === current) { setPreview(shown); setChosen(new Set((shown.projects ?? []).map(p => p.project_id))) }
    }).catch(() => {
      if (revision.current === current) setNotice(acquired ? EXPIRED : NO_ACCOUNT)
    }).finally(() => { if (revision.current === current) setBusy(false) })
    return () => { ++revision.current; disposeGatekeeperFrame(acquired?.frame ?? null) }
  }, [request, api])

  async function decide(approved: boolean) {
    if (!preview || !opened || busy || deciding.current) return
    deciding.current = true
    const selection = preview.selection, current = revision.current
    setBusy(true); setPreview(null); setNotice('')
    try {
      const projectIds = preview.projects ? preview.projects.map(p => p.project_id).filter(id => chosen.has(id)) : undefined
      const result = await opened.frame.agentConsent.decide(selection, approved, projectIds)
      if (revision.current !== current) return
      const target = new URL(result.redirect_uri)
      const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(target.hostname)
      if (target.username || target.password || target.hash ||
          (target.protocol !== 'https:' && !(target.protocol === 'http:' && loopback))) throw new Error('Invalid callback')
      setCallback(target.href)
      setNotice(approved ? 'Подключение подтверждено. Возвращаем вас в клиент агента…' : 'Подключение отклонено. Возвращаем вас в клиент агента…')
      // Клиент агента ждёт этот адрес: переход без лишнего клика; ссылка ниже — на случай, если браузер его не выполнил.
      returnTo(target.href)
    } catch {
      if (revision.current === current) setNotice(UNCONFIRMED)
    } finally { if (revision.current === current) { setSettled(true); setBusy(false) } }
  }

  // Макет Consent: белая карточка, крупный заголовок, одна фраза о правах, проекты галочками,
  // две кнопки-«пилюли». Технические подробности запроса (клиент, ресурс, операции, срок) — под
  // раскрывающейся строкой: их проверяет тот, кому это нужно, остальным они не мешают.
  return (
    <Dialog.Root open onOpenChange={open => { if (!open && !busy) onClose() }}>
      <Dialog
        className="!z-[1000] !top-[clamp(28px,8vh,80px)] !flex !max-h-[calc(100vh-clamp(28px,8vh,80px)-28px)] !w-[min(520px,calc(100vw-32px))] !-translate-y-0 flex-col overflow-hidden !rounded-[24px] bg-kumo-overlay p-0 shadow-[0_1px_2px_rgba(24,32,28,0.05),0_16px_40px_rgba(24,32,28,0.08)]"
        size="lg"
      >
        <div className="flex shrink-0 items-start gap-3.5 px-8 pt-8">
          <div className="grid h-[52px] w-[52px] shrink-0 place-items-center rounded-2xl bg-kumo-fill text-kumo-default">
            <Robot size={26} />
          </div>
          <div className="min-w-0 flex-1">
            <Dialog.Title className="m-0 text-[22px] leading-7 font-semibold tracking-[-0.4px] text-kumo-default">
              {preview ? `Подключить ${preview.client_id}` : 'Подключить своего агента'}
            </Dialog.Title>
            <Dialog.Description className="mt-1 mb-0 text-[14px] leading-5 text-kumo-subtle">
              Вы начали подключение в клиенте агента. Подтверждайте, только если начали его сами.
            </Dialog.Description>
          </div>
          <Dialog.Close
            render={props => (
              <WorkshopIconButton {...props} disabled={busy} aria-label="Закрыть" className="!h-8 !w-8 shrink-0 !rounded-full">
                <X size={16} />
              </WorkshopIconButton>
            )}
          />
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-8 py-5">
          {preview && <>
            <p className="m-0 text-[15px] leading-relaxed text-kumo-default">
              Агент будет работать от вашего имени: у него собственные разрешения, не шире ваших, и видит он не больше, чем вы.
              {preview.projects && preview.projects.length > 0 && ' Выберите, к каким проектам его пустить.'}
            </p>

            {preview.projects && (
              preview.projects.length === 0
                ? <p className="m-0 text-[14px] leading-5 text-kumo-subtle">У вас пока нет проектов. Агент подключится без доступа к документам.</p>
                : <ul aria-label="Проекты, с которыми агент сможет работать" className="m-0 list-none overflow-hidden rounded-2xl border border-kumo-fill p-0">
                    {preview.projects.map(project => (
                      <li key={project.project_id} className="border-t border-kumo-tint first:border-t-0">
                        <label className="flex cursor-pointer items-center gap-3 px-4 py-[13px] text-[15px] leading-5 text-kumo-default">
                          <input type="checkbox" data-consent-project={project.project_id} disabled={busy}
                            className="h-5 w-5 accent-kumo-brand"
                            checked={chosen.has(project.project_id)}
                            onChange={event => setChosen(prev => { const next = new Set(prev); if (event.target.checked) next.add(project.project_id); else next.delete(project.project_id); return next })} />
                          <span className="min-w-0 flex-1 truncate">{project.name || 'Проект без названия'}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
            )}

            <details className="group rounded-2xl border border-kumo-fill">
              <summary className="cursor-pointer list-none px-4 py-3 text-[14px] text-kumo-link marker:hidden">
                Что именно запрошено
              </summary>
              <div className="space-y-3 border-t border-kumo-tint px-4 py-3">
                <div>
                  <p className="m-0 text-[14px] leading-5 text-kumo-default">Клиент: {preview.client_id}</p>
                  <p className="m-0 mt-0.5 break-all font-mono text-[12px] leading-4 text-kumo-subtle">Ресурс: {preview.resource}</p>
                  <p className="m-0 mt-1 text-[14px] leading-5 text-kumo-default">Учётная запись: {preview.account} · отдельный агент, за вас</p>
                </div>
                <ul className="m-0 list-none overflow-hidden rounded-xl border border-kumo-tint p-0">
                  {preview.scopes.map(scope => (
                    <li key={scope} data-scope-line={scope} className="flex items-center gap-3 border-t border-kumo-tint px-3 py-2.5 first:border-t-0">
                      <div className="min-w-0 flex-1">
                        <p className="m-0 text-[14px] leading-5 text-kumo-default">{scope}</p>
                        <p className="m-0 mt-0.5 text-[12px] leading-4 text-kumo-subtle">Чтения записываются в аудит Mnemos</p>
                      </div>
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-kumo-tint px-2 py-0.5 text-[12px] leading-4 font-medium text-kumo-brand">
                        <Check size={12} weight="bold" />Запрошено
                      </span>
                    </li>
                  ))}
                  <li className="flex items-center gap-3 border-t border-kumo-tint px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="m-0 text-[14px] leading-5 text-kumo-default">Всё остальное</p>
                      <p className="m-0 mt-0.5 text-[12px] leading-4 text-kumo-subtle">Не запрошено. Доступ ко всем документам не выдаётся.</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-kumo-tint px-2 py-0.5 text-[12px] leading-4 font-medium text-kumo-subtle">Нет</span>
                  </li>
                </ul>
                <p className="m-0 text-[13px] leading-5 text-kumo-subtle">Запрос действует до {formatExpiry(preview.expires_at)}.</p>
              </div>
            </details>
          </>}

          {busy && <p role="status" className="m-0 text-[14px] leading-5 text-kumo-subtle">Загрузка…</p>}
          {notice && <p role="status" className="m-0 text-[15px] leading-relaxed text-kumo-default">{notice}</p>}
          {callback && (
            <p className="m-0 text-[14px] leading-5">
              <a href={callback} rel="noreferrer" referrerPolicy="no-referrer" className="text-kumo-link">Вернуться в клиент агента</a>
            </p>
          )}
          {settled && opened && (
            <p className="m-0 text-[14px] leading-5">
              <a href={`/gatekeepers/${encodeURIComponent(opened.vendorId)}`} className="text-kumo-link">Открыть карточку агента в «Памяти»</a>
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-col gap-3 px-8 pb-8">
          <div className="flex items-center justify-end gap-2.5">
            {preview ? <>
              <button type="button" onClick={() => void decide(false)} disabled={busy} className={SECONDARY}>Не подключать</button>
              <button type="button" onClick={() => void decide(true)} disabled={busy} className={PRIMARY}>Подключить</button>
            </> : (
              <Dialog.Close render={props => <button type="button" {...props} disabled={busy} className={SECONDARY}>Закрыть</button>} />
            )}
          </div>
          {preview && (
            <p className="m-0 text-[13px] leading-5 text-kumo-subtle">
              После нажатия вы вернётесь в клиент агента. Выданные права и отключение — на карточке агента в «Памяти».
            </p>
          )}
        </div>
      </Dialog>
    </Dialog.Root>
  )
}
