import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { CaretLeft, Check, Copy, Eye, EyeSlash, TelegramLogo } from '@phosphor-icons/react'
import { threadsReady, type TelegramBotState, type TelegramThreads } from '@gadgets/workshop-shared/telegram-bot'
import { useAuthenticatedApi } from './AuthContext'
import { useDocumentTitle } from './useDocumentTitle'
import { copyToClipboard } from './clipboard'
import { QrCode } from './components/QrCode'
import { GROUP_CARD, PAGE_TITLE, PRIMARY_PILL, SECONDARY_PILL } from './components/AppShell/pageStyles'

// «Telegram» в личных настройках (ADR 0027 Mnemos, этап 1): свой бот у каждого человека.
// Шаги: токен от BotFather → проверка бота → «/start КОД» из своего Telegram → подключено.
// Пока ждём код, состояние перечитывается: подтверждение приходит от Telegram, а не из этой страницы.

const POLL_MS = 3000
const INPUT = 'h-11 w-full rounded-xl border border-kumo-fill-hover bg-kumo-overlay pl-3 pr-11 font-mono text-[14px] text-kumo-default placeholder:font-sans placeholder:text-kumo-inactive transition-[border-color,box-shadow] focus:border-kumo-ring focus:outline-none focus:ring-[3px] focus:ring-kumo-ring/15'
const DANGER_PILL = 'inline-flex h-9 touch:h-10 shrink-0 cursor-pointer items-center rounded-full bg-kumo-danger px-3.5 text-[14px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-60'
const STEPS = ['Токен бота', 'Код из Telegram', 'Готово'] as const

function errorText(error: unknown, fallback: string): string {
  let message = error instanceof Error ? error.message : ''
  // Сервер отдаёт человеку готовый текст; технические сообщения (английские) не показываем.
  return /[а-яё]/i.test(message) ? message : fallback
}

function timeOf(at: number): string {
  return new Date(at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

function dateOf(at: number): string {
  return new Date(at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}

export default function TelegramSettings() {
  useDocumentTitle('Telegram')
  const { authenticatedApi } = useAuthenticatedApi()
  const [state, setState] = useState<TelegramBotState | null>(null)
  const [loadError, setLoadError] = useState('')

  const load = useCallback(async () => {
    try { setState(await authenticatedApi.getTelegramBot()); setLoadError('') }
    catch (error) { setLoadError(errorText(error, 'Не удалось прочитать подключение Telegram. Обновите страницу.')) }
  }, [authenticatedApi])

  useEffect(() => { void load() }, [load])

  // Ждём «/start КОД»: Telegram подтверждает сам, страница только перечитывает состояние.
  const pairing = state?.status === 'pairing'
  useEffect(() => {
    if (!pairing) return
    let timer = setInterval(() => { void load() }, POLL_MS)
    return () => clearInterval(timer)
  }, [pairing, load])

  const step = state?.status === 'connected' ? 2 : state?.status === 'pairing' ? 1 : 0

  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col px-4 pt-6 pb-[calc(2rem+env(safe-area-inset-bottom))] sm:px-0 sm:py-11">
      <header>
        <Link to="/settings" className="mb-3 inline-flex min-h-8 touch:min-h-10 items-center gap-1 text-[14px] text-kumo-link hover:underline">
          <CaretLeft size={12} /> Настройки
        </Link>
        <h1 className={PAGE_TITLE}>Telegram</h1>
        <p className="mt-2 mb-0 max-w-[52ch] text-[15px] leading-[22px] text-kumo-subtle">
          Свой бот, через который можно писать агенту беседы из Telegram. Бот отвечает только вашему аккаунту Telegram.
        </p>
      </header>

      <div className="mt-6 flex flex-col gap-4">
        {state && state.status !== 'unavailable' && <StepRail current={step} />}
        {loadError && <p role="alert" className="m-0 text-[14px] text-kumo-danger">{loadError}</p>}
        {!state && !loadError && <p role="status" className="m-0 text-[14px] text-kumo-subtle">Загрузка…</p>}
        {state?.status === 'unavailable' && <Unavailable reason={state.reason} />}
        {state?.status === 'none' && <TokenStep onDone={setState} />}
        {state?.status === 'pairing' && <PairingStep state={state} onChange={setState} />}
        {state?.status === 'connected' && <Connected state={state} onChange={setState} />}
      </div>
    </div>
  )
}

/** Три шага по порядку; текущий выделен цветом акцента, пройденные — галочкой. */
function StepRail({ current }: { current: number }) {
  return (
    <ol aria-label="Шаги подключения" className="m-0 flex list-none items-center gap-2 p-0">
      {STEPS.map((label, index) => {
        let done = index < current || current === STEPS.length - 1
        let active = index === current && current !== STEPS.length - 1
        return (
          <li key={label} aria-current={active ? 'step' : undefined} className="flex min-w-0 flex-1 items-center gap-2">
            <span className={[
              'grid h-6 w-6 shrink-0 place-items-center rounded-full text-[12px] font-semibold',
              done ? 'bg-kumo-brand text-white' : active ? 'border-2 border-kumo-brand text-kumo-brand' : 'border border-kumo-fill-hover text-kumo-subtle',
            ].join(' ')}>
              {done ? <Check size={12} weight="bold" aria-hidden="true" /> : index + 1}
            </span>
            <span className={`truncate text-[13px] ${active || done ? 'font-medium text-kumo-default' : 'text-kumo-subtle'}`}>{label}</span>
            {index < STEPS.length - 1 && <span aria-hidden="true" className={`h-px min-w-3 flex-1 ${done ? 'bg-kumo-brand' : 'bg-kumo-fill-hover'}`} />}
          </li>
        )
      })}
    </ol>
  )
}

function Unavailable({ reason }: { reason: 'no_key' | 'no_public_address' }) {
  return (
    <section aria-label="Подключение недоступно" className={`${GROUP_CARD} gap-1 px-[18px] py-4`}>
      <h2 className="m-0 text-[15px] font-semibold text-kumo-default">Подключить бота пока нельзя</h2>
      <p className="m-0 text-[14px] leading-5 text-kumo-subtle">
        {reason === 'no_key'
          ? 'На сервере не настроен ключ, которым шифруется токен бота. Попросите администратора установки обновить её — после этого экран заработает.'
          : 'У установки не задан публичный адрес https, на который Telegram присылает сообщения. Попросите администратора установки его настроить.'}
      </p>
    </section>
  )
}

function TokenStep({ onDone }: { onDone: (state: TelegramBotState) => void }) {
  const { authenticatedApi } = useAuthenticatedApi()
  const [token, setToken] = useState('')
  const [shown, setShown] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Токен верный, но у бота выключены треды: токен остаётся в поле, чтобы проверить снова.
  const [needsThreads, setNeedsThreads] = useState<Extract<TelegramBotState, { status: 'needs_threads' }> | null>(null)

  async function check() {
    if (busy || !token.trim()) return
    setBusy(true); setError('')
    try {
      let next = await authenticatedApi.connectTelegramBot(token.trim())
      if (next.status === 'needs_threads') { setNeedsThreads(next); return }
      setNeedsThreads(null); setToken(''); onDone(next)
    }
    catch (err) { setError(errorText(err, 'Бот не подключился. Проверьте токен и повторите.')) }
    finally { setBusy(false) }
  }
  function submit(event: React.FormEvent) { event.preventDefault(); void check() }

  return (
    <section aria-label="Токен бота" className={`${GROUP_CARD} px-[18px] py-4`}>
      <ol className="m-0 flex list-decimal flex-col gap-2 pl-5 text-[14px] leading-5 text-kumo-default marker:text-kumo-subtle">
        <li>
          Откройте в Telegram{' '}
          <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" className="text-kumo-link hover:underline">@BotFather</a>
          {' '}и отправьте <code className="rounded bg-kumo-tint px-1 font-mono text-[13px]">/newbot</code>. Он спросит имя и адрес бота.
        </li>
        <li>Скопируйте токен из ответа BotFather и вставьте ниже.</li>
      </ol>
      <form onSubmit={submit} className="mt-4 flex flex-col gap-2.5">
        <label htmlFor="telegram-token" className="text-[13px] text-kumo-subtle">Токен бота</label>
        <div className="relative">
          <input
            id="telegram-token"
            type={shown ? 'text' : 'password'}
            autoComplete="off"
            spellCheck={false}
            inputMode="text"
            value={token}
            disabled={busy}
            onChange={e => { setToken(e.target.value); setNeedsThreads(null) }}
            placeholder="Например, 123456789:AAH…"
            aria-invalid={!!error}
            aria-describedby={error ? 'telegram-token-error' : 'telegram-token-note'}
            className={`${INPUT} ${error ? 'border-kumo-danger focus:border-kumo-danger' : ''}`}
          />
          <button type="button" onClick={() => setShown(s => !s)} aria-label={shown ? 'Скрыть токен' : 'Показать токен'}
            className="absolute right-1 top-1/2 grid h-9 w-9 -translate-y-1/2 cursor-pointer place-items-center rounded-lg text-kumo-inactive transition-colors hover:text-kumo-default focus-visible:outline-2 focus-visible:outline-kumo-ring">
            {shown ? <EyeSlash size={16} /> : <Eye size={16} />}
          </button>
        </div>
        {error
          ? <p id="telegram-token-error" role="alert" className="m-0 text-[13px] leading-5 text-kumo-danger">{error}</p>
          : <p id="telegram-token-note" className="m-0 text-[13px] leading-5 text-kumo-subtle">Токен хранится на сервере в зашифрованном виде и не показывается агентам. Если бот уже где-то работает, сообщения будут приходить сюда.</p>}
        {needsThreads && <ThreadsHelp bot={needsThreads.bot} threads={needsThreads.threads} />}
        <div>
          <button type="submit" disabled={busy || !token.trim()} className={`${PRIMARY_PILL} cursor-pointer disabled:cursor-not-allowed disabled:opacity-60`}>
            {busy ? 'Проверяем бота…' : needsThreads ? 'Проверить снова' : 'Проверить бота'}
          </button>
        </div>
      </form>
    </section>
  )
}

/** Как включить треды: настройка есть только в BotFather как Mini App, в текстовом /mybots её нет. */
function ThreadsHelp({ bot, threads, warning }: { bot: { username: string; title: string }; threads: TelegramThreads; warning?: boolean }) {
  let missing = !threads.enabled ? 'у бота выключен режим тредов' : 'пользователям запрещено создавать треды'
  return (
    <div role={warning ? 'alert' : 'status'} className="flex flex-col gap-2 rounded-xl border border-kumo-warning/50 bg-kumo-warning/10 px-3.5 py-3 text-[14px] leading-5 text-kumo-default">
      <p className="m-0 font-medium">
        {warning ? `Треды выключены: ${missing}. Новые беседы в Telegram не появятся.` : `Бот @${bot.username} найден, но ${missing}.`}
      </p>
      <p className="m-0 text-kumo-subtle">Каждая беседа с агентом в Telegram — отдельный тред. Включите их в BotFather:</p>
      <ol className="m-0 flex list-decimal flex-col gap-1 pl-5 marker:text-kumo-subtle">
        <li>В Telegram найдите @BotFather и нажмите «Открыть» — настройка есть только в этом окне, в команде /mybots её нет.</li>
        <li>My bots → @{bot.username} → Bot Settings → Threads Settings.</li>
        <li>Включите Threaded Mode и не запрещайте пользователям создавать треды.</li>
      </ol>
      {!warning && <p className="m-0 text-kumo-subtle">Затем нажмите «Проверить снова».</p>}
    </div>
  )
}

function BotLine({ bot }: { bot: { username: string; title: string } }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-kumo-tint text-kumo-default"><TelegramLogo size={20} /></span>
      <span className="min-w-0">
        <span className="block truncate text-[15px] leading-5 font-medium text-kumo-default">{bot.title}</span>
        <span className="block truncate text-[13px] leading-5 text-kumo-subtle">@{bot.username}</span>
      </span>
    </div>
  )
}

function PairingStep({ state, onChange }: { state: Extract<TelegramBotState, { status: 'pairing' }>; onChange: (state: TelegramBotState) => void }) {
  const { authenticatedApi } = useAuthenticatedApi()
  const [now, setNow] = useState(() => Date.now())
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState<'' | 'renew' | 'cancel'>('')
  const [error, setError] = useState('')
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => {
    let timer = setInterval(() => setNow(Date.now()), 15000)
    return () => { clearInterval(timer); clearTimeout(copiedTimer.current) }
  }, [])
  const expired = state.expiresAt <= now
  const command = `/start ${state.code}`
  const link = `https://t.me/${state.bot.username}?start=${state.code}`

  async function copy() {
    if (!await copyToClipboard(command)) return
    setCopied(true)
    clearTimeout(copiedTimer.current)
    copiedTimer.current = setTimeout(() => setCopied(false), 2000)
  }
  async function act(kind: 'renew' | 'cancel') {
    if (busy) return
    setBusy(kind); setError('')
    try {
      if (kind === 'renew') onChange(await authenticatedApi.renewTelegramCode())
      else { await authenticatedApi.disconnectTelegramBot(); onChange(await authenticatedApi.getTelegramBot()) }
    } catch (err) { setError(errorText(err, 'Не получилось. Обновите страницу и повторите.')) }
    finally { setBusy('') }
  }

  return (
    <section aria-label="Код из Telegram" className={`${GROUP_CARD} gap-4 px-[18px] py-4`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <BotLine bot={state.bot} />
        <span className="text-[13px] text-kumo-subtle">Бот проверен</span>
      </div>
      {!threadsReady(state.threads) && <ThreadsHelp bot={state.bot} threads={state.threads} warning />}
      {expired ? (
        <div className="flex flex-col gap-2.5">
          <p className="m-0 text-[14px] leading-5 text-kumo-default">Код устарел. Получите новый и отправьте его боту.</p>
          <div><button type="button" className={PRIMARY_PILL} disabled={!!busy} onClick={() => { void act('renew') }}>{busy === 'renew' ? 'Получаем код…' : 'Получить новый код'}</button></div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <p className="m-0 text-[14px] leading-5 text-kumo-default">Откройте бота и нажмите «Запустить» — Telegram сам отправит код. Бот запомнит ваш аккаунт и будет отвечать только ему.</p>
              <div><a href={link} target="_blank" rel="noopener noreferrer" className={PRIMARY_PILL}>
                <TelegramLogo size={18} weight="fill" className="mr-1.5" aria-hidden="true" />Открыть бота в Telegram
              </a></div>
              <span role="status" className="text-[13px] leading-5 text-kumo-subtle">{copied ? 'Команда скопирована.' : `Код действует до ${timeOf(state.expiresAt)}. Ждём сообщение от Telegram…`}</span>
            </div>
            {/* На телефоне сканировать нечем: QR нужен, чтобы с компьютера открыть бота на телефоне. */}
            <figure className="m-0 flex shrink-0 flex-col items-center gap-1.5 touch:hidden">
              <QrCode value={link} label="QR-код: открыть бота в Telegram на телефоне" className="h-[148px] w-[148px] border border-kumo-fill-hover" />
              <figcaption className="text-[12px] leading-4 text-kumo-subtle">Или отсканируйте телефоном</figcaption>
            </figure>
          </div>
          <details className="group rounded-xl border border-kumo-fill-hover">
            <summary className="flex min-h-10 cursor-pointer list-none items-center px-4 text-[13px] text-kumo-subtle hover:text-kumo-default [&::-webkit-details-marker]:hidden">
              Не открывается? Отправьте команду вручную
            </summary>
            <div className="flex items-stretch overflow-hidden border-t border-kumo-fill-hover bg-kumo-base">
              <code aria-label="Команда для бота" className="flex min-w-0 flex-1 items-center px-4 py-3 font-mono text-[16px] leading-6 tracking-[0.02em] text-kumo-strong break-all select-all">{command}</code>
              <button type="button" onClick={() => { void copy() }} aria-label="Скопировать команду"
                className="grid w-12 shrink-0 cursor-pointer place-items-center border-l border-kumo-fill-hover text-kumo-subtle transition-colors hover:bg-kumo-tint hover:text-kumo-default focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-kumo-ring">
                {copied ? <Check size={18} className="text-kumo-brand" /> : <Copy size={18} />}
              </button>
            </div>
          </details>
        </div>
      )}
      {error && <p role="alert" className="m-0 text-[13px] text-kumo-danger">{error}</p>}
      <div className="border-t border-kumo-tint pt-3">
        <button type="button" className={SECONDARY_PILL} disabled={!!busy} onClick={() => { void act('cancel') }}>{busy === 'cancel' ? 'Отменяем…' : 'Отменить подключение'}</button>
      </div>
    </section>
  )
}

function Connected({ state, onChange }: { state: Extract<TelegramBotState, { status: 'connected' }>; onChange: (state: TelegramBotState) => void }) {
  const { authenticatedApi } = useAuthenticatedApi()
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function disconnect() {
    if (busy) return
    setBusy(true); setError('')
    try {
      let result = await authenticatedApi.disconnectTelegramBot()
      let next = await authenticatedApi.getTelegramBot()
      setNotice(result.webhookRemoved ? '' : 'Бот отключён, но Telegram не подтвердил снятие адреса для сообщений. Бот больше не отвечает; при желании удалите его в BotFather.')
      onChange(next)
    } catch (err) { setError(errorText(err, 'Отключение не подтверждено. Обновите страницу и проверьте ещё раз.')) }
    finally { setBusy(false) }
  }

  const owner = state.owner.username ? `${state.owner.name} (@${state.owner.username})` : state.owner.name
  return (
    <section aria-label="Бот подключён" className={GROUP_CARD}>
      <div className="px-[18px] pt-4 pb-3"><BotLine bot={state.bot} /></div>
      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 border-t border-kumo-tint px-[18px] py-3 text-[14px] leading-5">
        <dt className="text-kumo-subtle">Ваш Telegram</dt><dd className="m-0 min-w-0 break-words text-kumo-default">{owner}</dd>
        <dt className="text-kumo-subtle">Подключён</dt><dd className="m-0 text-kumo-default">{dateOf(state.connectedAt)}</dd>
        <dt className="text-kumo-subtle">Треды</dt>
        <dd className={`m-0 ${threadsReady(state.threads) ? 'text-kumo-default' : 'font-medium text-kumo-danger'}`}>{threadsReady(state.threads) ? 'Включены — каждая беседа идёт отдельным тредом' : 'Выключены'}</dd>
      </dl>
      {!threadsReady(state.threads) && <div className="px-[18px] pb-3"><ThreadsHelp bot={state.bot} threads={state.threads} warning /></div>}
      <p className="m-0 border-t border-kumo-tint px-[18px] py-3 text-[13px] leading-5 text-kumo-subtle">
        Бот принимает сообщения только от этого аккаунта и только в личном чате. Агент беседы появится в боте со следующим обновлением; пока бот подтверждает, что подключение работает.
      </p>
      {notice && <p role="status" className="m-0 px-[18px] pb-3 text-[13px] text-kumo-default">{notice}</p>}
      {error && <p role="alert" className="m-0 px-[18px] pb-3 text-[13px] text-kumo-danger">{error}</p>}
      <div className="flex flex-wrap items-center gap-2 border-t border-kumo-tint px-[18px] py-3">
        {!confirm && <button type="button" className={SECONDARY_PILL} onClick={() => setConfirm(true)}>Отключить бота</button>}
        {confirm && <>
          <span className="w-full text-[14px] text-kumo-default sm:w-auto">Отключить? Бот перестанет принимать сообщения.</span>
          <button type="button" className={DANGER_PILL} disabled={busy} onClick={() => { void disconnect() }}>{busy ? 'Отключаем…' : 'Да, отключить'}</button>
          <button type="button" className={SECONDARY_PILL} disabled={busy} onClick={() => setConfirm(false)}>Отмена</button>
        </>}
      </div>
    </section>
  )
}
