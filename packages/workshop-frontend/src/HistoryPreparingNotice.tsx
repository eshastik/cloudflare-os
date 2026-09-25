import { historyPercent, historyPreparingText, type HistoryProgress } from '../../gatekeeper-mnemos/src/history-preparing.ts'

// История проекта ещё переносится на сервере (429 project.history_preparing). Это не ошибка и не повод
// что-то нажимать: оболочка сама спрашивает сервер, пока перенос не закончится. Документ тем временем
// читается и правится, как позволяет каталог.

function Bar({ percent, className }: { percent: number | null; className: string }) {
  return <span role="progressbar" aria-label="Подготовка истории проекта" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined}
    className={`block overflow-hidden rounded-full bg-kumo-tint ${className}`}>
    <span className={`block h-full rounded-full bg-kumo-brand transition-[width] duration-300 ease-out motion-reduce:transition-none ${percent === null ? 'w-1/4 animate-pulse' : ''}`}
      style={percent === null ? undefined : { width: `${Math.max(percent, 2)}%` }} />
  </span>
}

/** Строка для шапки документа: подпись и короткая полоса. */
export function HistoryPreparingLine({ progress }: { progress: HistoryProgress }) {
  const text = historyPreparingText(progress)
  return <span role="status" data-history-preparing="" title={text} className="flex min-w-0 items-center gap-2">
    <span className="min-w-0 truncate">{text}</span>
    <Bar percent={historyPercent(progress)} className="h-1 w-12 shrink-0" />
  </span>
}

/** Блок для панелей «Версии» и открытия документа. */
export default function HistoryPreparingNotice({ progress, subject = 'Версии и публикация появятся' }: { progress: HistoryProgress; subject?: string }) {
  return <div role="status" data-history-preparing="" className="flex flex-col gap-2 rounded-[14px] bg-kumo-tint/60 px-4 py-3 text-[14px] leading-5 text-kumo-subtle">
    <p className="m-0 font-medium text-kumo-default">{historyPreparingText(progress)}</p>
    <Bar percent={historyPercent(progress)} className="h-1.5 w-full" />
    <p className="m-0">{subject}, когда перенос закончится. Документ можно читать и править; проверяем сами.</p>
  </div>
}
