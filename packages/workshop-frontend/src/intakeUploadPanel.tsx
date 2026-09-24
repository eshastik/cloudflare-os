import { useEffect, useMemo, useRef, useState } from 'react'
import type { PickedIntakeFile } from '../../gatekeeper-mnemos/src/intake.ts'
import { filesWord, megabytes, skippedFilesPhrase, skippedGroupsText } from '../../gatekeeper-mnemos/src/upload-filter.ts'
import {
  FAILED_PATHS_SHOWN, SpeedMeter, bytesText, filesCount, groupDigits, paceLine, progressLine, skippedLine, uploadPercent,
  type UploadView,
} from '../../gatekeeper-mnemos/src/upload-progress.ts'
import { MAX_UPLOAD_FILES, type IntakeDroppedFile, type IntakeUploadPlan } from './intakeDrop'

// Сводка перед загрузкой папки, ход загрузки и итог с повтором. Состояние держит оболочка: выбор
// «загрузить всё» не должен быть доступен коду фрейма. Приложение Mnemos подписывается на
// состояние (UploadView) и рисует уведомление само — в блоке «Файлы» проекта или плашкой в углу;
// тогда панель оболочки не показывается. Без подписки её рисует оболочка.

/** Меньше этого числа файлов без пропусков загружаем без лишнего вопроса. */
export const CONFIRM_THRESHOLD = 200
/** Итог без ошибок закрывается сам через столько миллисекунд. */
export const AUTO_CLOSE_MS = 6000
/** Ход загрузки обновляется не чаще: тысячи файлов не должны давать тысячи перерисовок. */
const PROGRESS_INTERVAL_MS = 200

/** Ход одного прогона: обработано файлов и байт, отказы, текущий файл. */
export interface UploadProgress { doneFiles: number; doneBytes: number; failed: number; current: string }

interface Base { id: number; project: string; folder: string }
export type IntakeUploadPanelState = Base & (
  | { phase: 'reading' }
  | { phase: 'confirm'; plan: IntakeUploadPlan; choose(choice: 'filtered' | 'all' | null): void }
  | { phase: 'uploading'; files: number; bytes: number; progress: UploadProgress; speed: number; eta: number | null; stopping: boolean; stop(): void }
  | { phase: 'done'; files: number; accepted: number; acceptedBytes: number; failed: string[]; stopped: number; personal: boolean; note: string; retry: (() => void) | null; resume: (() => void) | null }
  | { phase: 'error'; message: string }
)

export interface IntakeUploadUi {
  /** Начало: файлы выбраны, идёт отбор. project — куда загружаем (пусто — приёмная). */
  reading(project?: string): void
  /** Файлы, которые человек согласился загрузить, или null. */
  choose(plan: IntakeUploadPlan): Promise<IntakeDroppedFile[] | null>
  /** Начат прогон по этим файлам; stop прерывает его. */
  start(files: IntakeDroppedFile[], stop: () => void): void
  progress(progress: UploadProgress): void
  done(state: Omit<Extract<IntakeUploadPanelState, { phase: 'done' }>, 'phase' | keyof Base>): void
  error(message: string): void
  reset(): void
}

type Upload = (files: IntakeDroppedFile[], onProgress: (progress: UploadProgress) => void, stop: AbortSignal) => Promise<PickedIntakeFile[]>

/**
 * Сводка → загрузка → итог. Повтор берёт только не принятые файлы, «Продолжить» — не начатые после
 * остановки; итог складывается с прошлыми прогонами. Возвращает результаты первого прогона (их ждёт
 * приложение во фрейме). afterRun зовётся после повтора и продолжения, чтобы фрейм перечитал файлы.
 */
export async function runIntakeUpload(ui: IntakeUploadUi, plan: IntakeUploadPlan, upload: Upload, note: string,
    afterRun?: () => void): Promise<PickedIntakeFile[]> {
  const files = await ui.choose(plan)
  if (!files?.length) return []
  const status = new Map<string, 'ok' | 'failed' | 'stopped'>()
  let personal = false
  const run = async (list: IntakeDroppedFile[]) => {
    const controller = new AbortController()
    ui.start(list, () => controller.abort(new Error('Загрузка остановлена')))
    const results = await upload(list, progress => ui.progress(progress), controller.signal)
    for (const result of results) {
      status.set(result.path, result.error ? 'failed' : result.stopped ? 'stopped' : 'ok')
      personal ||= result.receipt?.placement_state === 'personal'
    }
    report()
    return results
  }
  const again = (kind: 'failed' | 'stopped') => {
    const list = files.filter(({ path }) => status.get(path) === kind)
    if (!list.length) return null
    return () => {
      void run(list).then(() => afterRun?.())
        .catch(() => ui.error('Загрузка не завершена. Файлы, принятые до сбоя, уже в памяти; проверьте их перед повтором.'))
    }
  }
  const report = () => {
    const accepted = files.filter(({ path }) => status.get(path) === 'ok')
    const failed = files.filter(({ path }) => status.get(path) === 'failed').map(({ path }) => path)
    ui.done({
      files: files.length, accepted: accepted.length, acceptedBytes: accepted.reduce((sum, { file }) => sum + file.size, 0),
      failed, stopped: files.filter(({ path }) => status.get(path) === 'stopped').length, personal, note,
      retry: again('failed'), resume: again('stopped'),
    })
  }
  return run(files)
}

/** Имя выбранной папки: общий первый сегмент путей; пусто — отдельные файлы. */
function folderOf(files: readonly IntakeDroppedFile[]): string {
  const first = files[0]?.path.split('/')
  if (!first || first.length < 2) return ''
  return files.every(({ path }) => path.startsWith(`${first[0]}/`)) ? first[0] : ''
}

export function useIntakeUploadPanel(options: { autoCloseMs?: number } = {}): { state: IntakeUploadPanelState | null; ui: IntakeUploadUi; current(): IntakeUploadPanelState | null } {
  const [state, setStateRaw] = useState<IntakeUploadPanelState | null>(null)
  const stateRef = useRef<IntakeUploadPanelState | null>(null)
  const pending = useRef<((choice: 'filtered' | 'all' | null) => void) | null>(null)
  const autoClose = options.autoCloseMs ?? AUTO_CLOSE_MS
  const ui = useMemo<IntakeUploadUi>(() => {
    let base: Base = { id: 0, project: '', folder: '' }
    let run: { meter: SpeedMeter; files: number; bytes: number; latest: UploadProgress; stop(): void; stopping: boolean; timer: ReturnType<typeof setTimeout> | null; flushed: number } | null = null
    let closer: ReturnType<typeof setTimeout> | null = null
    const set = (next: IntakeUploadPanelState | null) => { stateRef.current = next; setStateRaw(next) }
    const clearTimers = () => {
      if (run?.timer) { clearTimeout(run.timer); run.timer = null }
      if (closer) { clearTimeout(closer); closer = null }
    }
    const flush = () => {
      if (!run) return
      run.timer = null; run.flushed = Date.now()
      const now = Date.now(), current = run
      const speed = current.meter.sample(current.latest.doneBytes, now)
      set({ ...base, phase: 'uploading', files: current.files, bytes: current.bytes, progress: current.latest, speed,
        eta: current.meter.eta(current.bytes - current.latest.doneBytes, now), stopping: current.stopping,
        stop: () => { if (run !== current || current.stopping) return; current.stopping = true; current.stop(); flush() } })
    }
    return {
      reading: project => { clearTimers(); run = null; base = { id: base.id + 1, project: project ?? '', folder: '' }; set({ ...base, phase: 'reading' }) },
      choose: async plan => {
        base = { ...base, folder: folderOf(plan.files) }
        if (!plan.files.length && !plan.skippedFiles) { set({ ...base, phase: 'error', message: 'В выбранном нет файлов.' }); return null }
        if (plan.files.length > MAX_UPLOAD_FILES) {
          set({ ...base, phase: 'error', message: `После отбора служебных файлов осталось ${groupDigits(plan.files.length)} ${filesWord(plan.files.length)} — больше ${groupDigits(MAX_UPLOAD_FILES)} за один раз. Разделите папку на части.` })
          return null
        }
        if (!plan.skippedFiles && plan.files.length < CONFIRM_THRESHOLD) return plan.files
        pending.current?.(null)
        const choice = await new Promise<'filtered' | 'all' | null>(resolve => {
          const choose = (value: 'filtered' | 'all' | null) => { if (pending.current !== choose) return; pending.current = null; resolve(value) }
          pending.current = choose
          set({ ...base, phase: 'confirm', plan, choose })
        })
        if (choice === null) { set(null); return null }
        if (choice === 'filtered') return plan.files
        set({ ...base, phase: 'reading' })
        return plan.allFiles()
      },
      start: (files, stop) => {
        clearTimers()
        run = { meter: new SpeedMeter(), files: files.length, bytes: files.reduce((sum, { file }) => sum + file.size, 0),
          latest: { doneFiles: 0, doneBytes: 0, failed: 0, current: '' }, stop, stopping: false, timer: null, flushed: 0 }
        run.meter.sample(0, Date.now())
        flush()
      },
      progress: progress => {
        if (!run) return
        run.latest = progress
        if (run.timer) return
        const wait = Math.max(0, PROGRESS_INTERVAL_MS - (Date.now() - run.flushed))
        run.timer = setTimeout(flush, wait)
      },
      done: result => {
        clearTimers(); run = null
        set({ ...base, phase: 'done', ...result })
        if (!result.failed.length && !result.stopped && autoClose > 0) {
          const id = base.id
          closer = setTimeout(() => { closer = null; if (stateRef.current?.id === id && stateRef.current.phase === 'done') set(null) }, autoClose)
        }
      },
      error: message => { clearTimers(); run = null; set({ ...base, phase: 'error', message }) },
      reset: () => { clearTimers(); run = null; pending.current?.(null); pending.current = null; set(null) },
    }
  }, [autoClose])
  useEffect(() => () => ui.reset(), [ui])
  return { state, ui, current: () => stateRef.current }
}

/** Состояние для фрейма: только числа, имена и пути. */
export function toUploadView(state: IntakeUploadPanelState | null): UploadView | null {
  if (!state) return null
  const { id, project } = state
  switch (state.phase) {
    case 'reading': return { phase: 'reading', id, project }
    case 'confirm': return { phase: 'confirm', id, project, folder: state.folder, files: state.plan.files.length, bytes: state.plan.bytes,
      skipped: state.plan.skippedFiles, skippedMore: state.plan.skippedMore, groups: state.plan.groups.map(({ label, files }) => ({ label, files })) }
    case 'uploading': return { phase: 'uploading', id, project, folder: state.folder, files: state.files, bytes: state.bytes, doneFiles: state.progress.doneFiles,
      doneBytes: state.progress.doneBytes, failed: state.progress.failed, current: state.progress.current, speed: state.speed, eta: state.eta, stopping: state.stopping }
    case 'done': return { phase: 'done', id, project, files: state.files, accepted: state.accepted, acceptedBytes: state.acceptedBytes,
      failed: state.failed.slice(0, FAILED_PATHS_SHOWN), failedCount: state.failed.length, stopped: state.stopped, personal: state.personal, note: state.note }
    case 'error': return { phase: 'error', id, project, message: state.message }
  }
}

/** «Будет загружено N файлов (X МБ). Пропущено M служебных файлов: node_modules, .venv». */
export function uploadSummary(plan: IntakeUploadPlan): string {
  const n = plan.files.length, m = plan.skippedFiles
  const head = `Будет загружено ${n} ${filesWord(n)} (${megabytes(plan.bytes)}).`
  if (!m) return head
  return `${head} Пропущено ${plan.skippedMore ? 'не меньше ' : ''}${skippedFilesPhrase(m)}: ${skippedGroupsText(plan.groups)}.`
}

const button = 'inline-flex h-8 cursor-pointer items-center rounded-full px-3.5 text-[13px] font-medium leading-4 transition-colors focus-visible:outline-2 focus-visible:outline-kumo-ring'
const primary = `${button} bg-kumo-brand text-white hover:bg-kumo-brand-hover`
const secondary = `${button} border border-kumo-line bg-kumo-base text-kumo-default hover:bg-kumo-tint`
const quiet = `${button} text-kumo-subtle underline-offset-2 hover:underline`

/** Панель оболочки: карточка в углу. Нужна, когда приложение во фрейме не рисует уведомление само. */
export function IntakeUploadPanel({ state, onClose }: { state: IntakeUploadPanelState; onClose(): void }) {
  switch (state.phase) {
    case 'reading':
      return <p className="m-0">Читаем файлы…</p>
    case 'confirm': {
      const { plan } = state
      const view = toUploadView(state) as Extract<UploadView, { phase: 'confirm' }>
      const everything = plan.files.length + plan.skippedFiles
      return <div>
        <p className="m-0 font-semibold text-kumo-default">{state.folder ? `Загрузить папку «${state.folder}»?` : 'Загрузить выбранные файлы?'}</p>
        <p className="m-0 mt-1 break-words" data-testid="intake-upload-summary">{filesCount(plan.files.length)} · {bytesText(plan.bytes)}{plan.skippedFiles ? `. ${skippedLine(view)}` : ''}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {plan.files.length > 0 && <button type="button" className={primary} onClick={() => state.choose('filtered')}>Загрузить</button>}
          <button type="button" className={secondary} onClick={() => state.choose(null)}>Отмена</button>
          {plan.skippedFiles > 0 && !plan.skippedMore && everything <= MAX_UPLOAD_FILES &&
            <button type="button" className={quiet} onClick={() => state.choose('all')}>Загрузить всё, включая служебные ({groupDigits(everything)})</button>}
        </div>
      </div>
    }
    case 'uploading': {
      const view = toUploadView(state) as Extract<UploadView, { phase: 'uploading' }>
      const percent = uploadPercent(view)
      return <div>
        <p className="m-0 flex items-baseline gap-2 text-kumo-default"><span className="font-semibold">{state.stopping ? 'Останавливаем…' : 'Загружаем'}</span><span className="ml-auto tabular-nums">{percent}%</span></p>
        <div role="progressbar" aria-label="Ход загрузки" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="mt-2 h-1.5 overflow-hidden rounded-full bg-kumo-tint">
          <div className="h-full rounded-full bg-kumo-brand transition-[width] duration-200" style={{ width: `${percent}%` }} />
        </div>
        <p className="m-0 mt-2 tabular-nums">{progressLine(view)}{view.failed ? ` · ошибок ${groupDigits(view.failed)}` : ''}</p>
        {paceLine(view) && <p className="m-0 tabular-nums">{paceLine(view)}</p>}
        {view.current && <p className="m-0 truncate" title={view.current}>{view.current}</p>}
        <div className="mt-2"><button type="button" className={secondary} disabled={state.stopping} onClick={state.stop}>Остановить</button></div>
      </div>
    }
    case 'done': {
      const failed = state.failed.length
      return <div>
        <p className="m-0 break-words font-semibold text-kumo-default">Загружено {filesCount(state.accepted)} · {bytesText(state.acceptedBytes)}{state.accepted < state.files ? ` из ${groupDigits(state.files)}` : ''}</p>
        {!failed && !state.stopped && <p className="m-0 mt-1">{state.note}</p>}
        {state.stopped > 0 && <p className="m-0 mt-1">Остановлено: не загружено {filesCount(state.stopped)}.</p>}
        {failed > 0 && <p className="m-0 mt-1 break-words text-kumo-danger">Не загрузилось {failed} {filesWord(failed)}: {state.failed.slice(0, 3).join(', ')}{failed > 3 ? '…' : ''}</p>}
        <div className="mt-2 flex flex-wrap gap-2">
          {state.retry && <button type="button" className={primary} onClick={state.retry}>Повторить</button>}
          {state.resume && <button type="button" className={secondary} onClick={state.resume}>Продолжить</button>}
          <button type="button" className={secondary} onClick={onClose}>Закрыть</button>
        </div>
      </div>
    }
    case 'error':
      return <div>
        <p className="m-0 break-words">{state.message}</p>
        <button type="button" className={`${secondary} mt-2`} onClick={onClose}>Закрыть</button>
      </div>
  }
}
