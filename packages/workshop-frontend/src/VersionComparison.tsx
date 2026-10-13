import type {ReactNode} from 'react'
import {X} from '@phosphor-icons/react'
import type {ParagraphChange,Piece,VersionDiff} from './versionDiff'
const subText='text-[13px] leading-[18px] text-kumo-subtle'
function Pieces({ pieces }: { pieces: Piece[] }) {
  return <>{pieces.map((piece, i) => piece.op === 'add'
    ? <ins key={i} className="rounded-[3px] bg-selection-bg px-0.5 text-selection-text no-underline">{piece.text}</ins>
    : piece.op === 'del'
      ? <del key={i} className="rounded-[3px] bg-kumo-danger-tint px-0.5 text-kumo-danger">{piece.text}</del>
      : <span key={i}>{piece.text}</span>)}</>
}

/** Абзацы с правками и по одному неизменённому вокруг; длинные неизменённые куски свёрнуты в «…». */
function ParagraphList({ paragraphs }: { paragraphs: ParagraphChange[] }) {
  const changed = paragraphs.map(p => p.op !== 'same')
  const shown = paragraphs.map((_, i) => changed[i] || changed[i - 1] || changed[i + 1])
  const out: ReactNode[] = []
  let lastSection: string | undefined
  paragraphs.forEach((p, i) => {
    if (!shown[i]) { if (shown[i - 1]) out.push(<li key={`gap-${i}`} aria-hidden="true" className="text-kumo-inactive">…</li>); return }
    if (p.op !== 'same' && p.section && p.section !== lastSection) { lastSection = p.section; out.push(<li key={`section-${i}`} className="pt-1 text-[12px] leading-4 font-medium text-kumo-subtle">Раздел «{p.section}»</li>) }
    out.push(<li key={i} data-change={p.op} className={`border-l-2 pl-3 ${p.op === 'same' ? 'border-transparent text-kumo-subtle' : p.op === 'add' ? 'border-kumo-brand' : p.op === 'del' ? 'border-kumo-danger' : 'border-kumo-warning'}`}><Pieces pieces={p.pieces} /></li>)
  })
  return <ol className="m-0 flex list-none flex-col gap-2 p-0 font-serif text-[15px] leading-[1.55] text-kumo-default">{out}</ol>
}

/** Что изменилось между двумя версиями: текст с выделенными добавлениями и удалениями, ячейки, слайды. */
export function VersionComparison({ diff, labels, onClose, nothingText }: { diff: VersionDiff; labels: [string, string]; onClose?(): void;nothingText?:string }) {
  const nothing = diff.kind === 'document' ? !diff.paragraphs.some(p => p.op !== 'same') && diff.title[0] === diff.title[1]
    : diff.kind === 'spreadsheet' ? !diff.cells.length && !diff.sheets.length : !diff.slides.length
  return <section data-version-comparison aria-label={`Сравнение: ${labels[0]} и ${labels[1]}`} className="flex flex-col gap-3 rounded-2xl border border-kumo-fill p-4">
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <h3 className="m-0 text-[15px] leading-5 font-semibold text-kumo-default">{labels[0]} → {labels[1]}</h3>
        <p className="m-0 mt-0.5 text-[13px] leading-[18px] text-kumo-subtle">{diff.summary.charAt(0).toUpperCase() + diff.summary.slice(1)}</p>
      </div>
      {onClose&&<button type="button" aria-label="Скрыть сравнение" title="Скрыть сравнение" onClick={onClose}
        className="inline-flex h-10 w-10 sm:h-7 sm:w-7 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-kumo-subtle hover:bg-kumo-tint hover:text-kumo-default"><X size={14} /></button>}
    </div>
    {nothing && <p className={`m-0 ${subText}`}>{nothingText??'Содержимое версий совпадает.'}</p>}
    {diff.kind === 'document' && diff.title[0] !== diff.title[1] && <p className="m-0 text-[14px] leading-5">Название: <Pieces pieces={[{ text: diff.title[0], op: 'del' }, { text: ' ', op: 'same' }, { text: diff.title[1], op: 'add' }]} /></p>}
    {diff.kind === 'document' && !nothing && <ParagraphList paragraphs={diff.paragraphs} />}
    {diff.kind === 'spreadsheet' && <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[14px] leading-5">
      {diff.sheets.map(s => <li key={`sheet-${s.name}-${s.op}`}>{s.op === 'add' ? 'Добавлен лист' : 'Удалён лист'} «{s.name}»</li>)}
      {diff.cells.slice(0, 200).map(c => <li key={`${c.sheet}-${c.ref}`} data-change="cell" className="flex flex-wrap items-baseline gap-x-2">
        <span className="min-w-[88px] text-kumo-subtle">{c.sheet} · {c.ref}</span>
        {c.before ? <del className="rounded-[3px] bg-kumo-danger-tint px-1 text-kumo-danger">{c.before}</del> : <span className="text-kumo-inactive">пусто</span>}
        <span aria-hidden="true" className="text-kumo-inactive">→</span>
        {c.after ? <ins className="rounded-[3px] bg-selection-bg px-1 text-selection-text no-underline">{c.after}</ins> : <span className="text-kumo-inactive">пусто</span>}
      </li>)}
      {diff.cells.length > 200 && <li className="text-kumo-subtle">И ещё {diff.cells.length - 200} изменённых ячеек.</li>}
    </ul>}
    {diff.kind === 'presentation' && <ul className="m-0 flex list-none flex-col gap-3 p-0">
      {diff.slides.map(s => <li key={`${s.op}-${s.number}`} className="flex flex-col gap-1.5">
        <span className="text-[13px] leading-[18px] font-medium text-kumo-default">Слайд {s.number}: {s.op === 'add' ? 'добавлен' : s.op === 'del' ? 'удалён' : s.op === 'layout' ? 'изменено оформление, текст тот же' : 'изменён текст'}</span>
        {s.paragraphs.length > 0 && <ParagraphList paragraphs={s.paragraphs} />}
      </li>)}
    </ul>}
  </section>
}

