import { useState, type CSSProperties } from 'react'

// Один индикатор на всю загрузку раздела приложения: от входа на страницу до первой отрисовки
// приложения с данными. Показывается на трёх этапах (подключения, фрейм, данные фрейма) одной и той же
// разметкой; фаза хода общая для страницы, поэтому смена этапа выглядит как одна непрерывная загрузка.
// Повторяет шапку раздела Mnemos (заголовок и список), чтобы после загрузки ничего не прыгало.
export default function GatekeeperSectionLoading({ title, overlay = false }: { title?: string; overlay?: boolean }) {
  const [phase] = useState(() => `-${Math.round(performance.now() % 3200)}ms`)
  const style = { '--section-loading-phase': phase } as CSSProperties
  return (
    <div role="status" aria-live="polite" data-testid="gatekeeper-section-loading" style={style}
      className={`${overlay ? 'pointer-events-none absolute inset-0 z-10' : 'relative h-full min-h-[60vh]'} overflow-hidden bg-kumo-base`}>
      <div aria-hidden="true" className="section-loading-bar" />
      <div className="mx-auto max-w-[1120px] px-4 py-6 sm:px-8 sm:py-8">
        {title
          ? <h1 className="m-0 text-[24px] font-semibold leading-[1.33] tracking-[-0.6px] text-kumo-default">{title}</h1>
          : <div aria-hidden="true" className="section-loading-row h-8 w-40 rounded-md bg-kumo-tint" />}
        <p className="mb-0 mt-1 text-[13px] leading-[1.38] tracking-[-0.25px] text-kumo-subtle">Загружаем раздел…</p>
        <div aria-hidden="true" className="mt-6 overflow-hidden rounded-xl border border-kumo-line">
          {[62, 44, 54, 36].map((width, index) => (
            <div key={index} className={`flex items-center gap-3 p-3 ${index ? 'border-t border-kumo-line' : ''}`}>
              <div className="min-w-0 flex-1">
                <div className="section-loading-row h-3 rounded bg-kumo-fill" style={{ width: `${width}%` }} />
                <div className="section-loading-row mt-2 h-2.5 rounded bg-kumo-tint" style={{ width: `${Math.round(width / 2)}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
