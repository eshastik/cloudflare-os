import { useEffect, useState, useSyncExternalStore } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { CaretDown, UploadSimple } from '@phosphor-icons/react'
import { groupDigits, paceLine, progressLine, uploadPercent, type UploadView } from '../../gatekeeper-mnemos/src/upload-progress.ts'
import { IntakeUploadPanel, toUploadView } from './intakeUploadPanel'
import { uploadCenter, type UploadCenter, type UploadSnapshot } from './uploadCenter'
import { useOptionalAuthenticatedApi } from './AuthContext'

// Плашка загрузки файлов, одна на всю оболочку: видна в беседе, рабочем месте, настройках и любом
// разделе. Пока открыт фрейм Mnemos, уведомление рисует он (в блоке «Файлы» проекта или своей
// плашкой), а эта скрыта. Щелчок по заголовку ведёт к проекту, куда идёт загрузка.

/** Привязка владельца загрузок к человеку и его текущему подключению. */
export function useUploadCenterBinding(center: UploadCenter = uploadCenter) {
  const auth = useOptionalAuthenticatedApi()
  const api = auth?.authenticatedApi
  const user = auth?.currentUser?.id
  useEffect(() => { if (api && user) center.bind(api, user) }, [center, api, user])
}

export function useUploadSnapshot(center: UploadCenter = uploadCenter): UploadSnapshot {
  return useSyncExternalStore(center.subscribe, center.snapshot)
}

const quiet = 'inline-flex h-8 cursor-pointer items-center rounded-full px-3 text-[13px] font-medium leading-4 transition-colors focus-visible:outline-2 focus-visible:outline-kumo-ring disabled:cursor-default disabled:opacity-60'

export default function UploadDock({ center = uploadCenter }: { center?: UploadCenter }) {
  useUploadCenterBinding(center)
  const snapshot = useUploadSnapshot(center)
  const navigate = useNavigate()
  // Свёрнутая плашка — кнопка с процентом: не закрывает поле ввода беседы и кнопки страниц.
  const [collapsed, setCollapsed] = useState(false)
  const { job, queued, claimed } = snapshot
  if (!job || claimed) return null
  const { state, target } = job
  const view = toUploadView(state) as UploadView
  const open = () => void navigate({
    to: '/gatekeepers/$appId', params: { appId: target.vendorId },
    search: { ...(target.accountId === undefined ? {} : { account: target.accountId }), section: target.project ? 'projects' : 'documents', ...(target.project ? { project: target.project } : {}) } as never,
  })
  const name = job.folder ? `«${job.folder}»` : 'файлы'
  const percent = view.phase === 'uploading' ? uploadPercent(view) : null
  // Сводку перед загрузкой свернуть нельзя: она ждёт ответа.
  if (collapsed && view.phase !== 'confirm') {
    const label = view.phase === 'uploading' ? `${percent}%` : view.phase === 'reading' ? 'Читаем…' : view.phase === 'done' ? (view.interrupted ? 'Загрузка прервана' : 'Загрузка завершена') : 'Загрузка не завершена'
    return (
      <button type="button" data-testid="upload-dock" onClick={() => setCollapsed(false)} aria-label={`Загрузка файлов: ${label}. Развернуть`}
        className="fixed right-4 bottom-4 z-[60] inline-flex h-10 cursor-pointer items-center gap-2 rounded-full border border-kumo-fill bg-kumo-overlay pr-4 pl-3 text-[13px] font-medium text-kumo-default tabular-nums shadow-[0_1px_2px_rgba(24,32,28,0.05),0_8px_24px_rgba(24,32,28,0.08)] hover:bg-kumo-tint focus-visible:outline-2 focus-visible:outline-kumo-ring">
        <UploadSimple size={15} aria-hidden="true" className="text-kumo-brand" />{label}{queued ? <span className="text-kumo-subtle">+{groupDigits(queued)}</span> : null}
      </button>
    )
  }
  const collapse = view.phase !== 'confirm' &&
    <button type="button" aria-label="Свернуть" title="Свернуть" onClick={() => setCollapsed(true)}
      className="-mt-1 -mr-2 inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-kumo-subtle hover:bg-kumo-tint hover:text-kumo-default focus-visible:outline-2 focus-visible:outline-kumo-ring">
      <CaretDown size={15} aria-hidden="true" />
    </button>
  return (
    <aside role="status" aria-label="Загрузка файлов" data-testid="upload-dock"
      className="fixed right-4 bottom-4 z-[60] w-[min(360px,calc(100vw-32px))] overflow-hidden rounded-[18px] border border-kumo-fill bg-kumo-overlay text-[13px] leading-[18px] text-kumo-subtle shadow-[0_1px_2px_rgba(24,32,28,0.05),0_16px_40px_rgba(24,32,28,0.08)]">
      {/* Ход — полосой по верхнему краю: плашка остаётся низкой и не спорит с содержимым раздела. */}
      {percent !== null && <div role="progressbar" aria-label="Ход загрузки" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-[3px] bg-kumo-tint">
        <div className="h-full bg-kumo-brand transition-[width] duration-300 ease-out motion-reduce:transition-none" style={{ width: `${Math.max(percent, 1)}%` }} />
      </div>}
      <div className="px-4 py-3.5">
        {view.phase === 'uploading' ? <>
          <div className="flex items-start gap-2">
            <button type="button" onClick={open} title="Открыть проект"
              className="flex min-w-0 flex-1 cursor-pointer items-baseline gap-2 border-0 bg-transparent p-0 text-left text-kumo-default hover:text-kumo-brand focus-visible:outline-2 focus-visible:outline-kumo-ring">
              <UploadSimple size={15} aria-hidden="true" className="shrink-0 self-center" />
              <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{view.stopping ? 'Останавливаем…' : `Загружаем ${name}`}</span>
              <span className="text-[14px] font-semibold tabular-nums" data-upload-percent="">{percent}%</span>
            </button>
            {collapse}
          </div>
          <p className="m-0 mt-1.5 tabular-nums" data-upload-progress="">{progressLine(view)}{view.failed ? ` · ошибок ${groupDigits(view.failed)}` : ''}</p>
          {(paceLine(view) || queued > 0) && <p className="m-0 tabular-nums">{[paceLine(view), queued ? `ещё ${groupDigits(queued)} в очереди` : ''].filter(Boolean).join(' · ')}</p>}
          <div className="mt-2 -mx-3 -mb-1.5 flex items-center justify-between gap-2">
            <button type="button" className={`${quiet} text-kumo-brand hover:bg-kumo-tint`} onClick={open}>{target.project ? 'Открыть проект' : 'Открыть приёмную'}</button>
            <button type="button" className={`${quiet} text-kumo-default hover:bg-kumo-tint`} disabled={view.stopping} onClick={() => center.stop(job.id)}>Остановить</button>
          </div>
        </> : <>
          <div className="flex items-start gap-2">
            {(view.phase === 'done' || view.phase === 'error') && target.project
              ? <button type="button" onClick={open} className="mb-1.5 block min-w-0 flex-1 cursor-pointer truncate border-0 bg-transparent p-0 text-left text-[12px] text-kumo-brand hover:underline focus-visible:outline-2 focus-visible:outline-kumo-ring">
                  {job.folder ? `Папка «${job.folder}» · открыть проект` : 'Открыть проект'}
                </button>
              : <span className="flex-1" />}
            {view.phase !== 'reading' && collapse}
          </div>
          <IntakeUploadPanel state={state} onClose={() => center.dismiss(job.id)} />
        </>}
      </div>
    </aside>
  )
}
