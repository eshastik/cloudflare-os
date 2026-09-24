import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { RpcTarget } from "capnweb";
import { CaretDown, CaretRight, CheckCircle, Folder, UploadSimple, WarningCircle, X } from "@phosphor-icons/react";
import {
  bytesText, filesCount, groupDigits, paceLine, progressLine, skippedLine, uploadPercent, wordFor, type UploadView,
} from "../src/upload-progress.ts";
import { useHost } from "./host.ts";
import { Button } from "./ui.tsx";

// Уведомление о загрузке файлов. Загрузку ведёт оболочка (файлы и адреса хранилища во фрейм не
// попадают), фрейм получает только числа и имена и рисует уведомление: на странице проекта — в блоке
// «Файлы», в любом другом разделе — плашкой в углу. Смена раздела фрейм не перезагружает, поэтому
// плашка живёт до конца загрузки.

interface UploadContextValue {
  view: UploadView | null;
  /** Хост присылает ход загрузки; старый хост подписку не знает — тогда итог показывает сама страница. */
  live: boolean;
  /** Страница проекта берёт уведомление своего проекта к себе; возвращает отказ от него. */
  claim(project: string): () => void;
  answer(choice: "upload" | "cancel"): void;
  stop(): void;
  retry(): void;
  resume(): void;
  dismiss(): void;
}

const UploadContext = createContext<UploadContextValue | null>(null);

class UploadReceiver extends RpcTarget {
  constructor(private readonly listener: (view: UploadView | null) => void) { super(); }
  setUploadState(view: UploadView | null): void { this.listener(view); }
}

/** Загрузка ещё идёт: файлы читаются, ждут ответа или уходят в хранилище. */
export function uploadActive(view: UploadView | null): boolean {
  return !!view && (view.phase === "reading" || view.phase === "confirm" || view.phase === "uploading");
}

export function UploadProvider({ children, onFinished, onOpenProject }: { children: ReactNode; onFinished(): void; onOpenProject(project: string): void }) {
  const host = useHost();
  const [view, setView] = useState<UploadView | null>(null);
  const [claimed, setClaimed] = useState<string[]>([]);
  const [live, setLive] = useState(false);
  const finished = useRef(onFinished);
  finished.current = onFinished;
  useEffect(() => {
    let alive = true;
    const receiver = new UploadReceiver(next => { if (alive) setView(next); });
    host.subscribeUploads(receiver).then(current => { if (alive) { setLive(true); setView(current ?? null); } }).catch(() => {});
    return () => { alive = false; };
  }, [host]);
  // Файлы проекта перечитываются по завершении, даже если человек ушёл в другой раздел.
  const lastPhase = useRef<string>("");
  useEffect(() => {
    const phase = view ? `${view.id}/${view.phase}` : "";
    if (view?.phase === "done" && lastPhase.current !== phase) finished.current();
    lastPhase.current = phase;
  }, [view]);
  const claim = useCallback((project: string) => {
    setClaimed(all => [...all, project]);
    return () => setClaimed(all => { const at = all.indexOf(project); return at < 0 ? all : [...all.slice(0, at), ...all.slice(at + 1)]; });
  }, []);
  const id = view?.id ?? 0;
  const call = (action: Promise<unknown>) => { void action.catch(() => {}); };
  const value: UploadContextValue = {
    view,
    live,
    claim,
    answer: choice => call(host.answerUpload(id, choice)),
    stop: () => call(host.stopUpload(id)),
    retry: () => call(host.retryUpload(id)),
    resume: () => call(host.resumeUpload(id)),
    dismiss: () => { setView(null); call(host.dismissUpload(id)); },
  };
  const floating = view && !(view.project && claimed.includes(view.project));
  return (
    <UploadContext.Provider value={value}>
      {children}
      {floating && <FloatingUpload value={value} view={view} onOpenProject={onOpenProject} />}
    </UploadContext.Provider>
  );
}

/** Уведомление загрузки в этот проект для блока «Файлы»; null — загрузки в него нет. */
export function useProjectUpload(project: string): { view: UploadView | null; card: ReactNode; live: boolean } {
  const context = useContext(UploadContext);
  const claim = context?.claim;
  useEffect(() => claim?.(project), [claim, project]);
  const view = context?.view && context.view.project === project ? context.view : null;
  return { view, live: !!context?.live, card: context && view ? <InlineFrame><UploadCard key={view.id} value={context} view={view} /></InlineFrame> : null };
}

/** Состояние загрузки для кнопок: пока идёт одна, вторую не начать. */
export function useUploadBusy(): boolean {
  return uploadActive(useContext(UploadContext)?.view ?? null);
}

/** Полоса хода: 6 px, заливка акцентом. Без числа — ход ещё не известен. */
function ProgressBar({ percent, label }: { percent: number | null; label: string }) {
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined}
      className="h-1.5 w-full overflow-hidden rounded-full bg-kumo-tint">
      <div className={`h-full rounded-full bg-kumo-brand transition-[width] duration-300 ease-out motion-reduce:transition-none ${percent === null ? "w-1/4 animate-pulse" : ""}`}
        style={percent === null ? undefined : { width: `${Math.max(percent, 1)}%` }} />
    </div>
  );
}

function CloseButton({ onClick }: { onClick(): void }) {
  return <Button variant="ghost" size="sm" shape="circle" aria-label="Закрыть" title="Закрыть" icon={<X size={16} aria-hidden="true" />} onClick={onClick} />;
}

const titleClass = "m-0 text-[15px] leading-5 font-semibold text-kumo-default";
const noteClass = "m-0 text-[14px] leading-5 text-kumo-subtle tabular-nums";

function target(view: UploadView): string {
  return "folder" in view && view.folder ? `«${view.folder}»` : "";
}

/** Карточка загрузки. compact — плашка в углу вне страницы проекта. */
function UploadCard({ value, view, compact = false }: { value: UploadContextValue; view: UploadView; compact?: boolean }) {
  const [skippedOpen, setSkippedOpen] = useState(false);
  const [failedOpen, setFailedOpen] = useState(false);
  switch (view.phase) {
    case "reading":
      return (
        <div data-upload="reading" className="flex flex-col gap-2.5">
          <p className={titleClass}>Читаем выбранное…</p>
          <ProgressBar percent={null} label="Отбор файлов" />
        </div>
      );
    case "confirm":
      return (
        <div data-upload="confirm" className="flex items-start gap-3.5">
          {!compact && <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-selection-bg text-kumo-brand"><Folder size={20} /></span>}
          <div className="min-w-0 flex-1">
            <p className={titleClass}>{view.folder ? `Загрузить папку «${view.folder}»?` : "Загрузить выбранные файлы?"}</p>
            <p className={`${noteClass} mt-0.5`} data-upload-total="">{filesCount(view.files)} · {bytesText(view.bytes)}</p>
            {view.skipped > 0 && <>
              <button type="button" aria-expanded={skippedOpen} onClick={() => setSkippedOpen(!skippedOpen)}
                className="mt-2 flex max-w-full cursor-pointer items-start gap-1 border-0 bg-transparent p-0 text-left text-[13px] leading-[18px] text-kumo-subtle hover:text-kumo-default">
                <span aria-hidden="true" className="mt-px shrink-0">{skippedOpen ? <CaretDown size={14} /> : <CaretRight size={14} />}</span>
                <span data-upload-skipped="">{skippedLine(view)}</span>
              </button>
              {skippedOpen && <ul aria-label="Причины пропуска" className="m-0 mt-2 ml-[18px] flex list-none flex-col gap-1 border-l border-kumo-fill p-0 pl-3 text-[13px] leading-[18px]">
                {view.groups.map(group => (
                  <li key={group.label} className="flex gap-3">
                    <span className="min-w-0 flex-1 truncate text-kumo-default">{group.label}</span>
                    <span className="shrink-0 text-kumo-subtle tabular-nums">{filesCount(group.files)}</span>
                  </li>
                ))}
                {view.skippedMore && <li className="text-kumo-subtle">Счёт остановлен на пределе обхода: пропущено не меньше.</li>}
              </ul>}
            </>}
            <div className="mt-3.5 flex flex-wrap gap-2">
              {view.files > 0 && <Button size="sm" icon={<UploadSimple size={15} aria-hidden="true" />} onClick={() => value.answer("upload")}>Загрузить</Button>}
              <Button size="sm" variant="secondary" onClick={() => value.answer("cancel")}>Отмена</Button>
            </div>
          </div>
        </div>
      );
    case "uploading": {
      const percent = uploadPercent(view);
      const pace = paceLine(view);
      return (
        <div data-upload="uploading" className="flex flex-col gap-2.5">
          <div className="flex items-baseline gap-3">
            <p className={`${titleClass} min-w-0 flex-1 truncate`}>{view.stopping ? "Останавливаем…" : `Загружаем ${target(view) || "файлы"}`}</p>
            <span className="text-[15px] leading-5 font-semibold text-kumo-default tabular-nums" data-upload-percent="">{percent}%</span>
          </div>
          <ProgressBar percent={percent} label="Ход загрузки" />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className={`${noteClass} min-w-0 flex-1`} data-upload-progress="">{progressLine(view)}</p>
            {!compact && <Button size="sm" variant="secondary" disabled={view.stopping} onClick={value.stop}>Остановить</Button>}
          </div>
          {(pace || view.failed > 0) && <p className={noteClass}>
            {pace}
            {view.failed > 0 && <span className="text-kumo-danger">{pace ? " · " : ""}{groupDigits(view.failed)} {wordFor(view.failed, "ошибка", "ошибки", "ошибок")}</span>}
          </p>}
          {!compact && view.current && <p className="m-0 truncate text-[13px] leading-[18px] text-kumo-inactive" title={view.current} data-upload-current="">{view.current}</p>}
        </div>
      );
    }
    case "done": {
      const complete = view.failedCount === 0 && view.stopped === 0;
      return (
        <div data-upload="done" className="flex items-start gap-3">
          <span aria-hidden="true" className={`mt-px shrink-0 ${complete ? "text-kumo-brand" : "text-kumo-warning"}`}>{complete ? <CheckCircle size={20} weight="fill" /> : <WarningCircle size={20} weight="fill" />}</span>
          <div className="min-w-0 flex-1">
            <p className={titleClass} data-upload-result="">Загружено {filesCount(view.accepted)} · {bytesText(view.acceptedBytes)}</p>
            {complete && <p className={`${noteClass} mt-0.5`}>{view.personal ? "Файлы сохранены как личные черновики проекта. Для общего доступа их нужно опубликовать." : view.note}</p>}
            {view.stopped > 0 && <p className={`${noteClass} mt-0.5`}>Остановлено: не загружено {filesCount(view.stopped)} из {groupDigits(view.files)}.</p>}
            {view.failedCount > 0 && <p className="m-0 mt-0.5 text-[14px] leading-5 text-kumo-danger">
              Не загрузилось {filesCount(view.failedCount)}.{" "}
              <button type="button" aria-expanded={failedOpen} onClick={() => setFailedOpen(!failedOpen)} className="cursor-pointer border-0 bg-transparent p-0 text-kumo-brand hover:text-kumo-brand-hover">{failedOpen ? "Скрыть" : "Показать"}</button>
            </p>}
            {failedOpen && <ul aria-label="Не загрузились" className="m-0 mt-2 flex max-h-40 list-none flex-col gap-0.5 overflow-auto p-0 text-[13px] leading-[18px] text-kumo-default">
              {view.failed.map(path => <li key={path} className="truncate" title={path}>{path}</li>)}
              {view.failedCount > view.failed.length && <li className="text-kumo-subtle">и ещё {groupDigits(view.failedCount - view.failed.length)}</li>}
            </ul>}
            {(view.failedCount > 0 || view.stopped > 0) && <div className="mt-3 flex flex-wrap gap-2">
              {view.failedCount > 0 && <Button size="sm" onClick={value.retry}>Повторить {groupDigits(view.failedCount)}</Button>}
              {view.stopped > 0 && <Button size="sm" variant="secondary" onClick={value.resume}>Догрузить остальные</Button>}
            </div>}
          </div>
          <CloseButton onClick={value.dismiss} />
        </div>
      );
    }
    case "error":
      return (
        <div data-upload="error" className="flex items-start gap-3">
          <span aria-hidden="true" className="mt-px shrink-0 text-kumo-danger"><WarningCircle size={20} weight="fill" /></span>
          <p className="m-0 min-w-0 flex-1 text-[14px] leading-5 text-kumo-default">{view.message}</p>
          <CloseButton onClick={value.dismiss} />
        </div>
      );
  }
}

/** Встроенная карточка в блоке «Файлы». */
function InlineFrame({ children }: { children: ReactNode }) {
  return <div role="status" aria-label="Загрузка файлов" className="mb-4 rounded-[18px] border border-kumo-fill bg-kumo-overlay px-5 py-4">{children}</div>;
}

/** Плашка в правом нижнем углу: та же полоса и числа; щелчок возвращает к проекту. */
function FloatingUpload({ value, view, onOpenProject }: { value: UploadContextValue; view: UploadView; onOpenProject(project: string): void }) {
  const canOpen = !!view.project && (view.phase === "uploading" || view.phase === "done");
  return (
    <div role="status" aria-label="Загрузка файлов" data-upload-floating=""
      className="fixed right-4 bottom-4 z-50 w-[min(360px,calc(100vw-32px))] rounded-[18px] border border-kumo-fill bg-kumo-overlay px-4 py-3.5 shadow-[0_1px_2px_rgba(24,32,28,0.05),0_16px_40px_rgba(24,32,28,0.08)]">
      <UploadCard key={view.id} value={value} view={view} compact />
      {canOpen && <div className="mt-2.5 flex items-center gap-2 border-t border-kumo-fill pt-2.5">
        <button type="button" onClick={() => onOpenProject(view.project)} className="min-w-0 flex-1 cursor-pointer truncate border-0 bg-transparent p-0 text-left text-[13px] leading-[18px] text-kumo-brand hover:text-kumo-brand-hover">Открыть проект</button>
        {view.phase === "uploading" && <Button size="sm" variant="ghost" disabled={view.stopping} onClick={value.stop}>Остановить</Button>}
      </div>}
    </div>
  );
}
