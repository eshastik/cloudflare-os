import type { RpcStub } from 'capnweb'
import type { GatekeeperInboxUploadIssuer, GatekeeperUiFrame } from '@gadgets/workshop-shared/gatekeeper'
import { uploadIntakeFile, type PickedIntakeFile } from '../../gatekeeper-mnemos/src/intake.ts'
import { isPermanentUploadError, isRefusedUpload, uploadInBatches, uploadRefusal } from '../../gatekeeper-mnemos/src/upload-batches.ts'
import type { UploadView } from '../../gatekeeper-mnemos/src/upload-progress.ts'
import { MAX_UPLOAD_FILES, planPickedFiles, type IntakeDroppedFile, type IntakeUploadPlan } from './intakeDrop'
import { createUploadPanel, runIntakeUpload, toUploadView, type IntakeUploadPanelState, type IntakeUploadUi, type UploadPanel, type UploadProgress } from './intakeUploadPanel'
import { disposeGatekeeperFrame } from './disposeGatekeeperFrame'
import { LOGOUT_EVENT } from './authNavigation'

// Владелец загрузок файлов в Mnemos на уровне оболочки. Раньше загрузку вёл хост фрейма приложения,
// и уход из приложения (в беседу, рабочее место, настройки) уничтожал её вместе с фреймом. Теперь
// File-объекты, очередь, ход и сами PUT по подписанным адресам живут здесь, в модуле страницы:
// загрузку обрывают только закрытие и перезагрузка вкладки или выход из учётной записи.
//
// Полномочия не расширяются. Билеты выдаёт и приём подтверждает тот же объект inboxUploads.issuer,
// что приходит в кадре приложения (getGatekeeperApp того же человека и того же подключения): либо
// копия ссылки из открытого фрейма, либо новый кадр, из которого берётся только issuer. Тела файлов
// идут напрямую в хранилище (ADR 0003), через RPC — только размер, сумма и путь.
//
// Журнал в localStorage хранит, какие файлы уже приняты (путь, размер, SHA-256). После перезагрузки
// вкладки выбор файлов браузер не возвращает, поэтому человек видит «загрузка прервана» и выбирает
// папку снова; принятые файлы с той же суммой пропускаются.

export interface UploadTarget { vendorId: string; accountId?: number; project?: string }
export interface InboxUploads { storageOrigin: string; issuer: RpcStub<GatekeeperInboxUploadIssuer> }
export type UploadApi = { getGatekeeperApp(id: string, accountId?: number): Promise<GatekeeperUiFrame | null> }

/** Состояние, которое показывают плашка оболочки и уведомление во фрейме. */
export interface UploadSnapshot {
  /** Загрузка, которую сейчас показывать; null — показывать нечего. */
  job: { id: number; target: UploadTarget; folder: string; state: IntakeUploadPanelState } | null
  /** Загрузок, ждущих очереди. */
  queued: number
  /** Идёт отправка файлов: закрытие вкладки её оборвёт. */
  busy: boolean
  /** Открыт фрейм Mnemos, который рисует уведомление сам: плашка оболочки не нужна. */
  claimed: boolean
}

const JOURNAL_PREFIX = 'mnemos-upload:v1:'
/** Запись журнала без отметок живой вкладки старше этого считается оборванной (вкладка упала). */
export const JOURNAL_STALE_MS = 20_000
const JOURNAL_SAVE_MS = 2000
const HEARTBEAT_MS = 5000
const JOURNAL_KEEP_MS = 7 * 24 * 3600_000
const INTERRUPTED_NOTE = 'Загрузка не завершена. Файлы, принятые до сбоя, уже в памяти; проверьте их перед повтором.'

interface JournalEntry {
  v: 1
  vendorId: string
  accountId?: number
  project?: string
  folder: string
  directory: boolean
  /** Всего файлов в загрузке и их объём. */
  files: number
  bytes: number
  /** Принятые файлы: путь → [размер, SHA-256 base64]. */
  accepted: Record<string, [number, string]>
  heartbeat: number
  /** Вкладка закрыта или перезагружена во время загрузки. */
  closed?: boolean
}

interface Job {
  target: UploadTarget
  directory: boolean
  panel: UploadPanel
  ui: IntakeUploadUi
  state: IntakeUploadPanelState | null
  folder: string
  created: number
  /** Файлы подтверждены и ждут, пока закончится загрузка перед ними. */
  waiting: boolean
  /** Прогон отправляет файлы (держит очередь). */
  running: boolean
  stop: (() => void) | null
  cancelled: boolean
  journalKey: string | null
  journal: JournalEntry | null
  saveTimer: ReturnType<typeof setTimeout> | null
}

type Lease = { api: unknown; uploads: InboxUploads }

function keyOf(target: UploadTarget): string { return `${target.vendorId}\n${target.accountId ?? ''}` }

async function sha256Base64(file: File): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))
  return btoa(String.fromCharCode(...digest))
}

/** Открывает выбор файлов или папки. Пустой список — человек закрыл окно выбора. */
export function pickFiles(directory: boolean, signal?: AbortSignal): Promise<IntakeDroppedFile[]> {
  return new Promise<File[]>((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'; input.multiple = true; input.webkitdirectory = directory
    input.style.display = 'none'; document.body.append(input)
    const cleanup = () => { input.remove(); signal?.removeEventListener('abort', abort) }
    const abort = () => { cleanup(); reject(Error('Загрузка отменена')) }
    signal?.addEventListener('abort', abort, { once: true })
    input.addEventListener('change', () => { const selected = Array.from(input.files ?? []); cleanup(); resolve(selected) }, { once: true })
    input.addEventListener('cancel', () => { cleanup(); resolve([]) }, { once: true })
    input.click()
  }).then(files => files.map(file => ({ file, path: file.webkitRelativePath || file.name })))
}

export class UploadCenter {
  #jobs: Job[] = []
  #listeners = new Set<() => void>()
  #runListeners = new Set<() => void>()
  #snapshot: UploadSnapshot | null = null
  #claims = 0
  #nextId = 0
  #lifetime = new AbortController()
  #holder: Job | null = null
  #waiters: { job: Job; resolve(): void }[] = []
  #api: UploadApi | null = null
  #user: string | null = null
  #offers = new Map<string, Lease>()
  #leases = new Map<string, Promise<Lease>>()
  #heartbeat: ReturnType<typeof setInterval> | null = null
  readonly #storage: () => Storage | null
  readonly #pick: typeof pickFiles

  constructor(options: { storage?: () => Storage | null; pick?: typeof pickFiles } = {}) {
    this.#storage = options.storage ?? (() => { try { return window.localStorage } catch { return null } })
    this.#pick = options.pick ?? pickFiles
  }

  // --- подписка ---

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  /** Прогон закончился: фреймы перечитывают файлы проекта. */
  subscribeRuns(listener: () => void): () => void {
    this.#runListeners.add(listener)
    return () => { this.#runListeners.delete(listener) }
  }

  snapshot = (): UploadSnapshot => this.#snapshot ??= this.#compute()

  /** Фрейм Mnemos рисует уведомление сам, пока держит отметку. */
  claim(): () => void {
    this.#claims++
    this.#notify()
    let released = false
    return () => { if (released) return; released = true; this.#claims--; this.#notify() }
  }

  /** Состояние для фрейма: только числа, имена и пути. */
  view(): UploadView | null {
    const { job, queued } = this.snapshot()
    const view = job ? toUploadView(job.state) : null
    return view?.phase === 'uploading' && queued ? { ...view, queued } : view
  }

  #compute(): UploadSnapshot {
    const visible = this.#jobs.filter(job => job.state && !job.waiting)
    const attention = visible.find(job => job.state!.phase === 'reading' || job.state!.phase === 'confirm')
    const active = visible.find(job => job.state!.phase === 'uploading')
    const finished = visible.filter(job => job.state!.phase === 'done' || job.state!.phase === 'error').at(-1)
    const job = attention ?? active ?? finished
    return {
      job: job ? { id: job.state!.id, target: job.target, folder: job.folder || job.state!.folder, state: job.state! } : null,
      queued: this.#jobs.filter(job => job.waiting).length,
      busy: this.#jobs.some(job => job.running),
      claimed: this.#claims > 0,
    }
  }

  #notify() {
    this.#snapshot = null
    for (const listener of [...this.#listeners]) listener()
  }

  // --- подключение ---

  /**
   * Оболочка сообщает текущий доступ человека. Переподключение меняет api, но не человека: загрузки
   * идут дальше через новый кадр. Смена человека обрывает всё прежнее.
   */
  bind(api: UploadApi, user: string) {
    if (user !== this.#user) {
      if (this.#user !== null) this.abortAll()
      this.#user = user
      if (user) this.#restore()
    }
    if (api !== this.#api) {
      this.#api = api
      this.#releaseLeases()
    }
  }

  /** Открытый фрейм отдаёт свою ссылку на выдачу билетов: без неё центр возьмёт новый кадр. */
  offer(target: UploadTarget, uploads: InboxUploads, api: unknown): () => void {
    const key = keyOf(target)
    const lease = { api, uploads }
    this.#offers.set(key, lease)
    return () => { if (this.#offers.get(key) === lease) this.#offers.delete(key) }
  }

  async #uploads(target: UploadTarget): Promise<InboxUploads> {
    const key = keyOf(target)
    const current = this.#leases.get(key)
    if (current) {
      const lease = await current.catch(() => null)
      if (lease && (this.#api === null || lease.api === this.#api)) return lease.uploads
      if (this.#leases.get(key) === current) { this.#leases.delete(key); lease?.uploads.issuer[Symbol.dispose]?.() }
    }
    const api = this.#api
    const offer = this.#offers.get(key)
    const next: Promise<Lease> = offer && (api === null || offer.api === api)
      ? Promise.resolve({ api: offer.api, uploads: { storageOrigin: offer.uploads.storageOrigin, issuer: offer.uploads.issuer.dup() } })
      : (async () => {
          if (!api) throw Error('Нет подключения к памяти')
          const frame = await api.getGatekeeperApp(target.vendorId, target.accountId)
          try {
            if (!frame?.inboxUploads) throw Error('Приём файлов недоступен')
            return { api, uploads: { storageOrigin: frame.inboxUploads.storageOrigin, issuer: (frame.inboxUploads.issuer as RpcStub<GatekeeperInboxUploadIssuer>).dup() } }
          } finally { disposeGatekeeperFrame(frame) }
        })()
    this.#leases.set(key, next)
    next.catch(() => { if (this.#leases.get(key) === next) this.#leases.delete(key) })
    return (await next).uploads
  }

  #releaseLeases() {
    for (const lease of this.#leases.values()) void lease.then(({ uploads }) => uploads.issuer[Symbol.dispose]?.(), () => {})
    this.#leases.clear()
  }

  // --- загрузки ---

  /**
   * Новая загрузка: отбор, сводка, очередь, отправка. Возвращает итог первого прогона (его ждёт
   * фрейм, начавший загрузку); фрейм может закрыться раньше — загрузка от этого не зависит.
   * plan вызывается сразу, до первого await: DataTransfer перетаскивания закрывается после события.
   */
  async start(request: { target: UploadTarget; directory: boolean; note: string; plan: () => Promise<IntakeUploadPlan> }): Promise<PickedIntakeFile[]> {
    const lifetime = this.#lifetime.signal
    lifetime.throwIfAborted()
    const job = this.#createJob(request.target, request.directory)
    job.ui.reading(request.target.project)
    const planned = request.plan()
    // Подключение закрепляется сейчас, пока открыт фрейм, в котором человек начал загрузку.
    this.#uploads(request.target).catch(() => {})
    try {
      const plan = await planned
      if (job.cancelled) return []
      job.folder = folderName(plan.files)
      return await this.#runJob(job, plan, request.note)
    } catch (error) {
      if (!job.cancelled && !lifetime.aborted) job.ui.error(INTERRUPTED_NOTE)
      throw error
    }
  }

  #createJob(target: UploadTarget, directory: boolean): Job {
    const job: Job = {
      target, directory, state: null, folder: '', created: Date.now(), waiting: false, running: false, stop: null, cancelled: false,
      journalKey: null, journal: null, saveTimer: null,
      panel: undefined as unknown as UploadPanel, ui: undefined as unknown as IntakeUploadUi,
    }
    job.panel = createUploadPanel({
      nextId: () => ++this.#nextId,
      onChange: state => {
        job.state = state
        // Закрытое уведомление без идущего прогона больше не нужно.
        if (!state && !job.running) this.#drop(job)
        // Итог новой загрузки заменяет итоги прежних: держать их File-объекты незачем.
        if (state?.phase === 'done' || state?.phase === 'error') {
          for (const other of [...this.#jobs]) {
            if (other === job || other.running || other.state?.phase !== 'done' && other.state?.phase !== 'error') continue
            if (other.state.phase === 'done' && other.state.interrupted) continue
            other.cancelled = true; this.#drop(other)
          }
        }
        this.#notify()
      },
    })
    job.ui = { ...job.panel.ui, start: (files, stop) => { job.stop = stop; job.panel.ui.start(files, stop) } }
    this.#jobs.push(job)
    return job
  }

  #drop(job: Job) {
    const at = this.#jobs.indexOf(job)
    if (at >= 0) this.#jobs.splice(at, 1)
  }

  #runJob(job: Job, plan: IntakeUploadPlan, note: string, already?: { files: number; bytes: number }): Promise<PickedIntakeFile[]> {
    const total = { files: plan.files.length + (already?.files ?? 0), bytes: plan.bytes + (already?.bytes ?? 0) }
    return runIntakeUpload(job.ui, plan, (files, progress, stop) => this.#run(job, files, progress, stop, total), note,
      () => { for (const listener of [...this.#runListeners]) listener() }, already)
      .then(results => { for (const listener of [...this.#runListeners]) listener(); return results })
  }

  async #run(job: Job, files: IntakeDroppedFile[], onProgress: (progress: UploadProgress) => void, stop: AbortSignal, total: { files: number; bytes: number }): Promise<PickedIntakeFile[]> {
    const lifetime = this.#lifetime.signal
    const signal = AbortSignal.any([lifetime, stop])
    job.running = true; job.waiting = true
    this.#notify()
    try {
      try { await this.#acquire(job, signal) }
      catch (error) { if (lifetime.aborted) throw error; return files.map(({ path }) => ({ path, stopped: true })) }
      job.waiting = false
      // Ход и скорость считаются с момента, когда подошла очередь, а не с подтверждения.
      if (job.stop) job.panel.ui.start(files, job.stop)
      this.#journalStart(job, total)
      return await this.#send(job, files, onProgress, stop)
    } finally {
      job.waiting = false; job.running = false
      this.#release(job)
      // После выхода из учётной записи запись журнала остаётся: при входе загрузка покажется прерванной.
      if (!lifetime.aborted) this.#journalEnd(job)
      // Подключение не держится без дела; загрузка, ждущая ответа на сводку, держит своё.
      if (!this.#jobs.some(other => other.running || other.state?.phase === 'reading' || other.state?.phase === 'confirm')) this.#releaseLeases()
      this.#notify()
    }
  }

  #acquire(job: Job, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    if (!this.#holder) { this.#holder = job; return Promise.resolve() }
    return new Promise<void>((resolve, reject) => {
      const waiter = { job, resolve: () => { signal.removeEventListener('abort', abort); resolve() } }
      const abort = () => { this.#waiters = this.#waiters.filter(item => item !== waiter); reject(signal.reason) }
      signal.addEventListener('abort', abort, { once: true })
      this.#waiters.push(waiter)
    })
  }

  #release(job: Job) {
    if (this.#holder !== job) return
    const next = this.#waiters.shift()
    this.#holder = next?.job ?? null
    next?.resolve()
  }

  // Пакетами по несколько файлов параллельно, с повтором временных ошибок: upload-batches.ts
  // объясняет, почему не больше (предел незавершённых загрузок и запросов в минуту у сервера).
  // Ход считается по байтам принятых и окончательно отклонённых файлов: fetch не сообщает, сколько
  // байт одного PUT уже ушло, поэтому файл засчитывается целиком, когда приём подтверждён.
  // stop — «Остановить»: принятое остаётся принятым, начатое прерывается, остальное помечается stopped.
  async #send(job: Job, files: IntakeDroppedFile[], onProgress: (progress: UploadProgress) => void, stop: AbortSignal): Promise<PickedIntakeFile[]> {
    const lifetime = this.#lifetime.signal
    const signal = AbortSignal.any([lifetime, stop])
    if (!Array.isArray(files) || files.length > MAX_UPLOAD_FILES) throw Error('Слишком много файлов')
    for (const { file, path } of files) if (!(file instanceof File) || typeof path !== 'string' || path.length > 1024) throw Error('Некорректный файл')
    const project = job.target.project
    const result: PickedIntakeFile[] = new Array(files.length)
    const progress: UploadProgress = { doneFiles: 0, doneBytes: 0, failed: 0, current: '' }
    const active: number[] = []
    const report = () => onProgress({ ...progress, current: active.length ? files[active[active.length - 1]].path : '' })
    const run = uploadInBatches({
      items: files.map((_, index) => index), signal, permanent: isPermanentUploadError, refused: isRefusedUpload,
      onStart: index => { if (!active.includes(index)) active.push(index); report() },
      onSettled: (index, error) => {
        const at = active.indexOf(index); if (at >= 0) active.splice(at, 1)
        progress.doneFiles++; progress.doneBytes += files[index].file.size; if (error !== undefined && !isRefusedUpload(error)) progress.failed++
        report()
      },
      upload: async index => {
        const { file, path } = files[index]
        // Подключение берётся на каждый файл: после переподключения оболочки прежняя ссылка мертва.
        const uploads = await this.#uploads(job.target)
        let checksum = ''
        const uploadId = await uploadIntakeFile(file, async (size, sum) => {
          checksum = sum
          const ticket = await (project ? uploads.issuer.issue(size, sum, project) : uploads.issuer.issue(size, sum))
          if (new URL(ticket.url).origin !== new URL(uploads.storageOrigin).origin) throw Error('Адрес хранилища не совпадает с настройкой установки')
          signal.throwIfAborted()
          return ticket
        }, (url, options) => fetch(url, { ...options, signal }))
        signal.throwIfAborted()
        const receipt = await (project ? uploads.issuer.submit(uploadId, path, file.lastModified, project) : uploads.issuer.submit(uploadId, path, file.lastModified))
        // Приём подтверждён сервером: файл в итоге, даже если в этот момент нажали «Остановить».
        result[index] = { path, uploadId, modifiedAt: file.lastModified, receipt }
        this.#journalAccept(job, path, file.size, checksum)
        signal.throwIfAborted()
      },
    })
    let outcome: Awaited<typeof run>
    try { outcome = await run }
    catch (error) {
      if (lifetime.aborted || !stop.aborted) throw error
      return files.map(({ path }, index) => result[index] ?? { path, stopped: true })
    }
    for (const { item, error } of outcome.failed) {
      const refused = uploadRefusal(error)
      result[item] = refused ? { path: files[item].path, refused } : { path: files[item].path, error: 'Приём не подтверждён. Проверьте очередь и повторите этот файл при необходимости.' }
    }
    return result
  }

  // --- действия над загрузкой по её номеру (номер знает и фрейм) ---

  #byId(id: unknown): Job | null {
    return typeof id === 'number' ? this.#jobs.find(job => job.state?.id === id) ?? null : null
  }

  stateOf(id: unknown): IntakeUploadPanelState | null { return this.#byId(id)?.state ?? null }

  /** «Загрузить всё, включая служебные» — только из оболочки, фрейму оно недоступно. */
  answer(id: number, choice: 'filtered' | 'all' | null) {
    const state = this.stateOf(id)
    if (state?.phase === 'confirm') state.choose(choice)
  }

  stop(id: number) {
    const state = this.stateOf(id)
    if (state?.phase === 'uploading') state.stop()
  }

  retry(id: number) {
    const state = this.stateOf(id)
    if (state?.phase === 'done') state.retry?.()
  }

  resume(id: number) {
    const state = this.stateOf(id)
    if (state?.phase === 'done') state.resume?.()
  }

  dismiss(id: number) {
    const job = this.#byId(id)
    if (!job?.state || (job.state.phase !== 'done' && job.state.phase !== 'error')) return
    if (job.state.phase === 'done' && job.state.interrupted && job.journalKey) this.#remove(job.journalKey)
    job.cancelled = true
    job.panel.ui.reset()
    this.#drop(job)
    this.#notify()
  }

  /** Выход из учётной записи. */
  signOut() {
    this.abortAll()
    this.#user = null
    this.#api = null
  }

  /** Всё начатое обрывается, в журнале остаётся «прервано». */
  abortAll() {
    this.#flushJournal(true)
    this.#lifetime.abort(Error('Загрузка прервана'))
    this.#lifetime = new AbortController()
    const jobs = this.#jobs
    this.#jobs = []
    for (const job of jobs) { job.cancelled = true; if (job.saveTimer) clearTimeout(job.saveTimer); job.saveTimer = null; job.journal = null; job.panel.ui.reset() }
    this.#holder = null; this.#waiters = []
    this.#releaseLeases()
    this.#stopHeartbeat()
    this.#notify()
  }

  // --- журнал ---

  #journalStart(job: Job, total: { files: number; bytes: number }) {
    if (!this.#user) return
    job.journalKey ??= `${JOURNAL_PREFIX}${this.#user}:${crypto.randomUUID()}`
    job.journal = {
      v: 1, vendorId: job.target.vendorId, ...(job.target.accountId === undefined ? {} : { accountId: job.target.accountId }),
      ...(job.target.project ? { project: job.target.project } : {}), folder: job.folder, directory: job.directory,
      files: total.files, bytes: total.bytes, accepted: job.journal?.accepted ?? {}, heartbeat: Date.now(),
    }
    this.#save(job)
    this.#startHeartbeat()
  }

  #journalAccept(job: Job, path: string, size: number, checksum: string) {
    if (!job.journal || !checksum) return
    job.journal.accepted[path] = [size, checksum]
    job.saveTimer ??= setTimeout(() => { job.saveTimer = null; this.#save(job) }, JOURNAL_SAVE_MS)
  }

  #journalEnd(job: Job) {
    if (job.saveTimer) { clearTimeout(job.saveTimer); job.saveTimer = null }
    if (job.journalKey) this.#remove(job.journalKey)
    if (!this.#jobs.some(other => other.running)) this.#stopHeartbeat()
  }

  #save(job: Job) {
    if (!job.journal || !job.journalKey) return
    job.journal.heartbeat = Date.now()
    try { this.#storage()?.setItem(job.journalKey, JSON.stringify(job.journal)) } catch { /* переполнение хранилища: догрузка без пропуска принятого */ }
  }

  #remove(key: string) {
    try { this.#storage()?.removeItem(key) } catch { /* хранилище недоступно */ }
  }

  #startHeartbeat() {
    this.#heartbeat ??= setInterval(() => { for (const job of this.#jobs) if (job.running && !job.waiting) this.#save(job) }, HEARTBEAT_MS)
  }

  #stopHeartbeat() {
    if (this.#heartbeat) { clearInterval(this.#heartbeat); this.#heartbeat = null }
  }

  /** Вкладка закрывается: идущие загрузки отмечаются прерванными синхронно, пока страница жива. */
  pageHidden() { this.#flushJournal(true) }

  #flushJournal(closed: boolean) {
    for (const job of this.#jobs) {
      if (!job.running || !job.journal) continue
      if (closed) job.journal.closed = true
      this.#save(job)
    }
  }

  /** Прерванные загрузки этого человека из журнала: уведомление «прервано» с «Догрузить остальные». */
  #restore() {
    const storage = this.#storage()
    if (!storage || !this.#user) return
    const prefix = `${JOURNAL_PREFIX}${this.#user}:`
    const now = Date.now()
    let keys: string[] = []
    try { keys = Array.from({ length: storage.length }, (_, index) => storage.key(index) ?? '').filter(key => key.startsWith(prefix)) } catch { return }
    const found: { key: string; entry: JournalEntry }[] = []
    for (const key of keys) {
      let entry: JournalEntry | null = null
      try { entry = JSON.parse(storage.getItem(key) ?? 'null') } catch { entry = null }
      if (!entry || entry.v !== 1 || typeof entry.vendorId !== 'string' || typeof entry.accepted !== 'object' || now - entry.heartbeat > JOURNAL_KEEP_MS) { this.#remove(key); continue }
      // Свежая запись без отметки о закрытии — загрузка идёт в другой вкладке.
      if (!entry.closed && now - entry.heartbeat < JOURNAL_STALE_MS) continue
      found.push({ key, entry })
    }
    found.sort((a, b) => a.entry.heartbeat - b.entry.heartbeat)
    for (const { key, entry } of found) this.#showInterrupted(key, entry)
    if (found.length) this.#notify()
  }

  #showInterrupted(key: string, entry: JournalEntry) {
    const job = this.#createJob({ vendorId: entry.vendorId, accountId: entry.accountId, project: entry.project }, entry.directory)
    job.journalKey = key; job.journal = entry; job.folder = entry.folder
    const accepted = Object.values(entry.accepted)
    job.ui.reading(entry.project)
    job.ui.done({
      files: entry.files, accepted: accepted.length, acceptedBytes: accepted.reduce((sum, [size]) => sum + size, 0),
      failed: [], refused: [], stopped: Math.max(0, entry.files - accepted.length), personal: false, note: '', interrupted: true,
      retry: null, resume: () => { void this.#resumeInterrupted(job).catch(() => {}) },
    })
  }

  /** Выбор папки заново: принятые файлы (тот же путь, размер и SHA-256) пропускаются. */
  async #resumeInterrupted(job: Job): Promise<void> {
    if (job.running) return
    const lifetime = this.#lifetime.signal
    const picked = await this.#pick(job.directory, lifetime)
    if (!picked.length || job.cancelled) return
    const accepted = job.journal?.accepted ?? {}
    job.ui.reading(job.target.project)
    try {
      const plan = await planPickedFiles(picked, { filter: job.directory })
      const already = { files: 0, bytes: 0 }
      const unaccepted = async (files: IntakeDroppedFile[]) => {
        const rest: IntakeDroppedFile[] = []
        for (const item of files) {
          const known = accepted[item.path]
          if (known && known[0] === item.file.size && await sha256Base64(item.file) === known[1]) { already.files++; already.bytes += item.file.size }
          else rest.push(item)
        }
        return rest
      }
      const files = await unaccepted(plan.files)
      if (job.cancelled) return
      if (!files.length) {
        if (job.journalKey) this.#remove(job.journalKey)
        job.ui.done({ files: already.files, accepted: already.files, acceptedBytes: already.bytes, failed: [], refused: [], stopped: 0,
          personal: false, note: 'Все файлы уже были приняты до перезагрузки.', retry: null, resume: null })
        return
      }
      const rest: IntakeUploadPlan = { ...plan, files, bytes: files.reduce((sum, { file }) => sum + file.size, 0),
        allFiles: async () => { already.files = 0; already.bytes = 0; return unaccepted(await plan.allFiles()) } }
      job.folder ||= folderName(files)
      await this.#runJob(job, rest, job.target.project ? 'Материалы добавлены в проект.' : 'Предложения появятся после разбора.', already)
    } catch (error) {
      if (!job.cancelled && !lifetime.aborted) job.ui.error(INTERRUPTED_NOTE)
      throw error
    }
  }
}

function folderName(files: readonly IntakeDroppedFile[]): string {
  const first = files[0]?.path.split('/')
  if (!first || first.length < 2) return ''
  return files.every(({ path }) => path.startsWith(`${first[0]}/`)) ? first[0] : ''
}

/**
 * Обработчики страницы: закрытие вкладки отмечает загрузки прерванными; предупреждение beforeunload
 * стоит только пока файлы отправляются (лишний обработчик мешает браузеру кэшировать страницу).
 */
export function installPageHooks(center: UploadCenter, target: Window): () => void {
  let guarded = false
  const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
  const sync = () => {
    const busy = center.snapshot().busy
    if (busy === guarded) return
    guarded = busy
    if (busy) target.addEventListener('beforeunload', warn)
    else target.removeEventListener('beforeunload', warn)
  }
  const hidden = () => center.pageHidden()
  const logout = () => center.signOut()
  const unsubscribe = center.subscribe(sync)
  target.addEventListener('pagehide', hidden)
  target.addEventListener(LOGOUT_EVENT, logout)
  return () => {
    unsubscribe()
    target.removeEventListener('pagehide', hidden)
    target.removeEventListener(LOGOUT_EVENT, logout)
    if (guarded) target.removeEventListener('beforeunload', warn)
  }
}

/** Один владелец загрузок на вкладку: живёт вне дерева React и переживает любую навигацию. */
export const uploadCenter = new UploadCenter()
if (typeof window !== 'undefined') installPageHooks(uploadCenter, window)
