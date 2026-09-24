// Ход работы агента в беседе по макету «Беседа»: строка итога («Готово за 42 с · 11 поисков, …»)
// раскрывает шаги; однотипные подряд идущие шаги свёрнуты в одну строку; строка шага раскрывает
// итог — найденные документы со ссылками, строки файла, код и его вывод, текст ошибки.
// Подписи берутся из реестра toolDisplay.ts.
import { memo, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AppWindow, CalendarBlank, CaretRight, Check, CircleNotch, Code, CurrencyRub, Envelope, File as FileIcon,
  FileText, FolderSimple, Globe, HandPalm, Info, Key, LinkSimple, MagnifyingGlass, PaperPlaneTilt, PencilSimple,
  Plugs, Plus, Robot, ShareNetwork, Stamp, Trash, Users, WarningCircle, type Icon,
} from "@phosphor-icons/react";
import {
  buildWorkSteps, formatDuration, groupSteps, plural, STEP_DISPLAY, summarizeRun,
  type FoundItem, type StepGroup, type StepIcon, type WorkBatch, type WorkStep,
} from "./toolDisplay";
import styles from "../../ChatInterface.module.css";

const ICONS: Record<StepIcon, Icon> = {
  search: MagnifyingGlass, document: FileText, file: FileIcon, folder: FolderSimple, edit: PencilSimple,
  create: Plus, code: Code, web: Globe, link: LinkSimple, info: Info, publish: PaperPlaneTilt,
  share: ShareNetwork, person: Users, access: Key, delete: Trash, mail: Envelope, calendar: CalendarBlank,
  connection: Plugs, stop: HandPalm, app: AppWindow, review: Stamp, budget: CurrencyRub, agent: Robot,
};

export type DocumentLink = NonNullable<FoundItem["link"]>;
/** Обработчик перехода к документу или проекту; undefined — открыть негде (приложение не подключено). */
export type OpenDocument = (link: DocumentLink) => (() => void) | undefined;

function iconFor(kind: string): Icon {
  return ICONS[STEP_DISPLAY[kind]?.icon ?? "connection"];
}

function hasDetail(step: WorkStep): boolean {
  return step.detail.type !== "none" || !!step.error;
}

/** Убирает разметку Markdown из описаний внешних подключений: здесь нужен текст, а не оформление. */
function plainText(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1").trim();
}

function FoundList({ step, openDocument }: { step: Extract<WorkStep["detail"], { type: "found" }> & { kind: string }; openDocument?: OpenDocument }) {
  const { items, total, note, query } = step;
  const empty = items.length === 0;
  return (
    <div className="space-y-2">
      {query && query.length > 60 && <p className="m-0 text-[13px] leading-[18px] text-kumo-subtle">Запрос: «{query}»</p>}
      {empty ? (
        <p className="m-0 text-[13px] leading-[18px] text-kumo-subtle">
          {total === 0 ? "Ничего не найдено." : "Что нашлось, в истории этой беседы не сохранено."}
        </p>
      ) : (
        <ul className="m-0 list-none space-y-2 p-0">
          {items.map((item, index) => {
            const open = item.link ? openDocument?.(item.link) : undefined;
            const ItemIcon = item.folder ? FolderSimple : FileText;
            return (
              <li key={`${item.name}-${index}`} className="flex min-w-0 gap-2">
                <ItemIcon size={14} className="mt-[3px] flex-shrink-0 text-kumo-inactive" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-baseline gap-2">
                    {open ? (
                      <button type="button" onClick={open} className="min-w-0 cursor-pointer truncate border-0 bg-transparent p-0 text-left text-[13px] font-medium leading-[18px] text-kumo-link hover:underline focus-visible:underline focus-visible:outline-none">
                        {item.name}
                      </button>
                    ) : (
                      <span className="min-w-0 truncate text-[13px] font-medium leading-[18px] text-kumo-default">{item.name}</span>
                    )}
                    {item.path && <span className="min-w-0 truncate text-[12px] leading-4 text-kumo-inactive">{item.path}</span>}
                  </div>
                  {item.snippet && <p className="m-0 mt-0.5 line-clamp-2 text-[12px] leading-[17px] text-kumo-subtle">{item.snippet}</p>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {(total !== undefined && total > items.length || note) && (
        <p className="m-0 text-[12px] leading-4 text-kumo-inactive">
          {[total !== undefined && total > items.length ? `и ещё ${total - items.length}` : "", note ?? ""].filter(Boolean).join("; ")}
        </p>
      )}
    </div>
  );
}

function CodeBlock({ code, output }: { code: string; output?: string }) {
  return (
    <div className="space-y-2">
      <pre className="m-0 max-h-56 overflow-auto rounded-xl border border-kumo-line bg-kumo-overlay p-2.5 font-mono text-[12px] leading-[18px] text-kumo-subtle whitespace-pre-wrap">{code}</pre>
      {output && (
        <>
          <p className="m-0 text-[12px] leading-4 text-kumo-inactive">Результат</p>
          <pre className="m-0 max-h-56 overflow-auto rounded-xl border border-kumo-line bg-kumo-overlay p-2.5 font-mono text-[12px] leading-[18px] text-kumo-subtle whitespace-pre-wrap">{output}</pre>
        </>
      )}
    </div>
  );
}

function StepDetailView({ step, openDocument }: { step: WorkStep; openDocument?: OpenDocument }) {
  const detail = step.detail;
  return (
    <div className="space-y-2 py-1.5" data-testid="work-step-detail">
      {step.error && (
        <p className="m-0 rounded-lg bg-kumo-danger-tint/60 px-2.5 py-1.5 text-[13px] leading-[18px] text-kumo-danger whitespace-pre-wrap">{step.error}</p>
      )}
      {detail.type === "found" && <FoundList step={{ ...detail, kind: step.kind }} openDocument={openDocument} />}
      {detail.type === "lines" && detail.lines.map((line, index) => (
        <p key={index} className="m-0 break-words text-[13px] leading-[18px] text-kumo-subtle">{line}</p>
      ))}
      {detail.type === "text" && <p className="m-0 text-[13px] leading-[18px] text-kumo-subtle whitespace-pre-wrap">{plainText(detail.text)}</p>}
      {detail.type === "code" && <CodeBlock code={detail.code} output={detail.output} />}
    </div>
  );
}

function Row({ icon, label, meta, error, expandable, open, onToggle, strong = false, children }: {
  icon: ReactNode; label: string; meta?: string; error?: boolean; expandable: boolean; open: boolean;
  onToggle: () => void; strong?: boolean; children?: ReactNode;
}) {
  return (
    <div>
      <button
        type="button"
        disabled={!expandable}
        onClick={onToggle}
        aria-expanded={expandable ? open : undefined}
        className={`group/row flex w-full min-w-0 items-center gap-2.5 rounded-lg py-1 text-left transition-colors duration-150 ease-out enabled:cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kumo-ring ${strong ? "text-kumo-default" : "text-kumo-subtle enabled:hover:text-kumo-default"}`}
      >
        <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center" aria-hidden="true">{icon}</span>
        <span className="flex min-w-0 flex-1 items-baseline gap-2 text-[14px] leading-5">
          <span className="min-w-0 truncate">{label}</span>
          {meta && <span className="flex-shrink-0 text-[13px] text-kumo-inactive">· {meta}</span>}
          {error && <span className="flex-shrink-0 self-center rounded-full bg-kumo-danger-tint px-2 py-px text-[11px] font-medium text-kumo-danger">ошибка</span>}
          {expandable && (
            <CaretRight size={11} weight="bold" className={`flex-shrink-0 self-center text-kumo-inactive transition-transform duration-150 ease-out ${open ? "rotate-90" : ""}`} aria-hidden="true" />
          )}
        </span>
      </button>
      {open && children && <div className="ml-[7px] border-l border-kumo-line pl-[17px]">{children}</div>}
    </div>
  );
}

const StepLine = memo(function StepLine({ step, openDocument }: { step: WorkStep; openDocument?: OpenDocument }) {
  const [open, setOpen] = useState(false);
  const StepIconGlyph = step.error ? WarningCircle : iconFor(step.kind);
  return (
    <Row
      icon={<StepIconGlyph size={15} className={step.error ? "text-kumo-danger" : "text-kumo-inactive"} />}
      label={step.label}
      meta={step.meta}
      error={!!step.error}
      expandable={hasDetail(step)}
      open={open}
      onToggle={() => setOpen(value => !value)}
    >
      <StepDetailView step={step} openDocument={openDocument} />
    </Row>
  );
});

const GroupLine = memo(function GroupLine({ group, openDocument }: { group: StepGroup; openDocument?: OpenDocument }) {
  const [open, setOpen] = useState(false);
  if (group.steps.length === 1) return <StepLine step={group.steps[0]} openDocument={openDocument} />;
  const GroupIcon = iconFor(group.kind);
  return (
    <Row
      icon={<GroupIcon size={15} className="text-kumo-inactive" />}
      label={group.label}
      meta={group.meta}
      expandable
      open={open}
      onToggle={() => setOpen(value => !value)}
    >
      <div className="py-0.5">
        {group.steps.map(step => <StepLine key={step.key} step={step} openDocument={openDocument} />)}
      </div>
    </Row>
  );
});

function CodeRuns({ runs }: { runs: { key: string; code: string; output?: string }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Row
      icon={<Code size={15} className="text-kumo-inactive" />}
      label={`Код, которым агент обращался к подключениям`}
      meta={plural(runs.length, ["запуск", "запуска", "запусков"])}
      expandable
      open={open}
      onToggle={() => setOpen(value => !value)}
    >
      <div className="space-y-3 py-1.5">
        {runs.map(run => <CodeBlock key={run.key} code={run.code} output={run.output} />)}
      </div>
    </Row>
  );
}

export type WorkRunProps = {
  batches: readonly WorkBatch[];
  projectNames?: ReadonlyMap<string, string>;
  /** Начало и конец хода: для «Готово за 42 с». */
  startedAt?: Date;
  finishedAt?: Date;
  /** Ход ещё идёт: итог не подводится, шаги раскрыты. */
  inProgress?: boolean;
  open: boolean;
  onToggle: () => void;
  openDocument?: OpenDocument;
};

export const WorkRun = memo(function WorkRun({ batches, projectNames, startedAt, finishedAt, inProgress = false, open, onToggle, openDocument }: WorkRunProps) {
  const { steps, code } = useMemo(() => buildWorkSteps(batches, { projectNames }), [batches, projectNames]);
  const groups = useMemo(() => groupSteps(steps), [steps]);
  if (steps.length === 0 && code.length === 0) return null;
  if (steps.length === 1 && code.length === 0) {
    return <div className="max-w-[640px]" data-testid="work-run"><StepLine step={steps[0]} openDocument={openDocument} /></div>;
  }
  const durationMs = startedAt && finishedAt ? finishedAt.getTime() - startedAt.getTime() : undefined;
  const summary = summarizeRun(steps, code.length, durationMs, inProgress);
  const failed = steps.some(step => step.error);
  const expanded = open || inProgress;
  return (
    <div className="max-w-[640px]" data-testid="work-run">
      <Row
        icon={inProgress
          ? <CircleNotch size={15} className="animate-spin text-kumo-brand motion-reduce:animate-none" />
          : failed ? <WarningCircle size={15} className="text-kumo-warning" /> : <Check size={15} weight="bold" className="text-kumo-brand" />}
        label={summary}
        expandable={!inProgress}
        open={expanded}
        onToggle={onToggle}
      >
        <div className="py-0.5">
          {groups.map(group => <GroupLine key={group.key} group={group} openDocument={openDocument} />)}
          {code.length > 0 && <CodeRuns runs={code} />}
        </div>
      </Row>
    </div>
  );
});

/** Идущий шаг: настоящее время, индикатор и живой таймер. */
export function LiveStep({ label, startedAt }: { label: string; startedAt?: number }) {
  const [start] = useState(() => startedAt ?? Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const elapsed = now - start;
  return (
    <div className="flex min-w-0 max-w-[640px] items-center gap-2.5 py-1 text-[14px] leading-5 text-kumo-default" role="status" data-testid="live-step">
      <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center" aria-hidden="true">
        <CircleNotch size={15} className="animate-spin text-kumo-brand motion-reduce:animate-none" />
      </span>
      <span className={`min-w-0 truncate ${styles.thinkingShimmer}`}>{label}…</span>
      {elapsed >= 1000 && <span className="flex-shrink-0 text-[13px] tabular-nums text-kumo-inactive">{formatDuration(elapsed)}</span>}
    </div>
  );
}
