import { useMemo, useRef, useState } from 'react'
import type { PickedIntakeFile } from '../../gatekeeper-mnemos/src/intake.ts'
import { filesWord, megabytes, skippedFilesPhrase, skippedGroupsText } from '../../gatekeeper-mnemos/src/upload-filter.ts'
import { MAX_UPLOAD_FILES, type IntakeDroppedFile, type IntakeUploadPlan } from './intakeDrop'

// Сводка перед загрузкой папки, ход загрузки и итог с повтором. Панель рисует оболочка, а не
// приложение во фрейме: выбор «загрузить всё» не должен быть доступен коду фрейма.

/** Меньше этого числа файлов без пропусков загружаем без лишнего вопроса. */
export const CONFIRM_THRESHOLD = 200

export type IntakeUploadPanelState =
  | { phase: 'reading' }
  | { phase: 'confirm'; plan: IntakeUploadPlan; choose(choice: 'filtered' | 'all' | null): void }
  | { phase: 'uploading'; done: number; total: number }
  | { phase: 'done'; accepted: number; total: number; failed: string[]; note: string; retry: (() => void) | null }
  | { phase: 'error'; message: string }

export interface IntakeUploadUi {
  reading(): void
  /** Файлы, которые человек согласился загрузить, или null. */
  choose(plan: IntakeUploadPlan): Promise<IntakeDroppedFile[] | null>
  progress(done: number, total: number): void
  done(state: Omit<Extract<IntakeUploadPanelState, { phase: 'done' }>, 'phase'>): void
  error(message: string): void
  reset(): void
}

type Upload = (files: IntakeDroppedFile[], onProgress: (done: number, total: number) => void) => Promise<PickedIntakeFile[]>

/**
 * Сводка → загрузка → итог. Повтор берёт только незагрузившиеся файлы и складывает счёт с прошлым.
 * Возвращает результаты первой загрузки (их ждёт приложение во фрейме).
 */
export async function runIntakeUpload(ui: IntakeUploadUi, plan: IntakeUploadPlan, upload: Upload, note: string,
    afterRetry?: () => void): Promise<PickedIntakeFile[]> {
  const files = await ui.choose(plan)
  if (!files?.length) return []
  const results = await upload(files, (done, total) => ui.progress(done, total))
  const report = (all: PickedIntakeFile[], accepted: number) => {
    const failedPaths = all.filter(file => file.error).map(file => file.path)
    ui.done({
      accepted, total: files.length, failed: failedPaths, note,
      retry: failedPaths.length ? () => {
        const again = new Set(failedPaths)
        const retryFiles = files.filter(({ path }) => again.has(path))
        ui.progress(0, retryFiles.length)
        void upload(retryFiles, (done, total) => ui.progress(done, total))
          .then(next => { report(next, accepted + next.filter(file => !file.error).length); afterRetry?.() })
          .catch(() => ui.error('Повтор не завершён. Проверьте принятые материалы перед новой попыткой.'))
      } : null,
    })
  }
  report(results, results.filter(file => !file.error).length)
  return results
}

export function useIntakeUploadPanel(): { state: IntakeUploadPanelState | null; ui: IntakeUploadUi } {
  const [state, setState] = useState<IntakeUploadPanelState | null>(null)
  const pending = useRef<((choice: 'filtered' | 'all' | null) => void) | null>(null)
  const ui = useMemo<IntakeUploadUi>(() => ({
    reading: () => setState({ phase: 'reading' }),
    choose: async plan => {
      if (!plan.files.length && !plan.skippedFiles) { setState({ phase: 'error', message: 'В выбранном нет файлов.' }); return null }
      if (plan.files.length > MAX_UPLOAD_FILES) {
        setState({ phase: 'error', message: `После отбора служебных файлов осталось ${plan.files.length} ${filesWord(plan.files.length)} — больше ${MAX_UPLOAD_FILES} за один раз. Разделите папку на части.` })
        return null
      }
      if (!plan.skippedFiles && plan.files.length < CONFIRM_THRESHOLD) return plan.files
      pending.current?.(null)
      const choice = await new Promise<'filtered' | 'all' | null>(resolve => {
        const choose = (value: 'filtered' | 'all' | null) => { if (pending.current === choose) pending.current = null; resolve(value) }
        pending.current = choose
        setState({ phase: 'confirm', plan, choose })
      })
      if (choice === null) { setState(null); return null }
      if (choice === 'filtered') return plan.files
      setState({ phase: 'reading' })
      return plan.allFiles()
    },
    progress: (done, total) => setState({ phase: 'uploading', done, total }),
    done: result => setState({ phase: 'done', ...result }),
    error: message => setState({ phase: 'error', message }),
    reset: () => { pending.current?.(null); pending.current = null; setState(null) },
  }), [])
  return { state, ui }
}

/** «Будет загружено N файлов (X МБ). Пропущено M служебных файлов: node_modules, .venv». */
export function uploadSummary(plan: IntakeUploadPlan): string {
  const n = plan.files.length, m = plan.skippedFiles
  const head = `Будет загружено ${n} ${filesWord(n)} (${megabytes(plan.bytes)}).`
  if (!m) return head
  return `${head} Пропущено ${plan.skippedMore ? 'не меньше ' : ''}${skippedFilesPhrase(m)}: ${skippedGroupsText(plan.groups)}.`
}

const button = 'inline-flex h-[26px] cursor-pointer items-center rounded-md px-2 text-[12px] font-medium leading-4 transition-colors focus-visible:outline-2 focus-visible:outline-kumo-ring'
const primary = `${button} bg-kumo-brand text-white hover:bg-kumo-brand-hover`
const secondary = `${button} border border-kumo-line bg-kumo-base text-kumo-default hover:bg-kumo-tint`
const quiet = `${button} text-kumo-subtle underline-offset-2 hover:underline`

export function IntakeUploadPanel({ state, onClose }: { state: IntakeUploadPanelState; onClose(): void }) {
  switch (state.phase) {
    case 'reading':
      return <p className="m-0">Читаем файлы…</p>
    case 'confirm': {
      const { plan } = state
      const everything = plan.files.length + plan.skippedFiles
      return <div>
        <p className="m-0 break-words" data-testid="intake-upload-summary">{uploadSummary(plan)}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {plan.files.length > 0 && <button type="button" className={primary} onClick={() => state.choose('filtered')}>Загрузить</button>}
          <button type="button" className={secondary} onClick={() => state.choose(null)}>Отмена</button>
          {plan.skippedFiles > 0 && !plan.skippedMore && everything <= MAX_UPLOAD_FILES &&
            <button type="button" className={quiet} onClick={() => state.choose('all')}>Загрузить всё, включая служебные ({everything})</button>}
        </div>
      </div>
    }
    case 'uploading':
      return <div>Загружено {state.done} из {state.total}<progress className="mt-1 block h-1 w-full max-w-md" max={state.total || 1} value={state.done} /></div>
    case 'done': {
      const failed = state.failed.length
      return <div>
        <p className="m-0 break-words">Загружено {state.accepted} из {state.total}. {failed ? '' : state.note}</p>
        {failed > 0 && <p className="m-0 mt-1 break-words text-kumo-danger">Не загрузилось {failed} {filesWord(failed)}: {state.failed.slice(0, 3).join(', ')}{failed > 3 ? '…' : ''}</p>}
        <div className="mt-2 flex flex-wrap gap-2">
          {state.retry && <button type="button" className={primary} onClick={state.retry}>Повторить</button>}
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
