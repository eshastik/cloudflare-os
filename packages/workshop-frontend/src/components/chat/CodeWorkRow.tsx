// Строка работы агента в ленте: заголовок («Перешёл к работе с кодом проекта «…»»), сводка и
// вложенные шаги. Строка шага — человеческая; команда, путь и вывод — по раскрытию.
import { memo, useState } from "react";
import {
  CaretRight,
  Code,
  Database,
  FileText,
  File as FileIcon,
  FolderSimple,
  Globe,
  MagnifyingGlass,
  PencilSimple,
  Terminal,
  Wrench,
  WarningCircle,
  Brain,
} from "@phosphor-icons/react";
import type { AgentStep, ChangedFile } from "@gadgets/workshop-shared/code-work";
import { summarizeAgentSteps } from "../../codeWorkSteps";
import styles from "../../ChatInterface.module.css";

type Icon = typeof Code;

const STEP_ICONS: Record<AgentStep["kind"], Icon> = {
  file: FileIcon,
  edit: PencilSimple,
  run: Terminal,
  search: MagnifyingGlass,
  memory: Brain,
  document: FileText,
  database: Database,
  code: Code,
  project: FolderSimple,
  web: Globe,
  tool: Wrench,
  state: WarningCircle,
};

const StepRow = memo(function StepRow({ step }: { step: AgentStep }) {
  const [open, setOpen] = useState(false);
  const Icon = STEP_ICONS[step.kind] ?? Wrench;
  const hasDetails = Boolean(step.detail || step.output);
  const running = step.status === "running";
  return (
    <div>
      <button
        type="button"
        disabled={!hasDetails}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={hasDetails ? open : undefined}
        className="flex w-full items-center gap-2 rounded-lg py-0.5 text-left text-kumo-subtle transition-colors duration-150 ease-out enabled:cursor-pointer enabled:hover:text-kumo-default focus-visible:outline-none"
      >
        <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center">
          <Icon size={13} className={step.status === "error" ? "text-kumo-danger" : "text-kumo-inactive"} />
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-2 text-[14px] leading-5">
          <span className={`min-w-0 truncate ${running ? styles.thinkingShimmer : ""}`}>{step.title}</span>
          {step.status === "error" && (
            <span className="flex-shrink-0 rounded-full bg-kumo-danger-tint px-2 py-0.5 text-[10px] font-semibold tracking-[0.04em] text-kumo-danger">
              Ошибка
            </span>
          )}
          {hasDetails && (
            <CaretRight
              size={12}
              weight="bold"
              className={`flex-shrink-0 text-kumo-inactive transition-transform duration-150 ease-out ${open ? "rotate-90" : ""}`}
            />
          )}
        </span>
      </button>
      {open && hasDetails && (
        <div className="ml-6 mt-1 space-y-2 rounded-xl border border-kumo-fill bg-kumo-base p-2.5">
          {step.detail && (
            <pre className="max-h-40 overflow-auto rounded-xl border border-kumo-line/70 bg-kumo-base p-2.5 font-mono text-[12px] leading-[18px] text-kumo-subtle whitespace-pre-wrap">
              {step.detail}
            </pre>
          )}
          {step.output && (
            <pre className="max-h-56 overflow-auto rounded-xl border border-kumo-line/70 bg-kumo-base p-2.5 font-mono text-[12px] leading-[18px] text-kumo-subtle whitespace-pre-wrap">
              {step.output}
            </pre>
          )}
        </div>
      )}
    </div>
  );
});

export type CodeWorkRowProps = {
  title: string;
  steps: AgentStep[];
  running: boolean;
  durationMs?: number;
  changedFiles?: ChangedFile[];
  error?: string;
  /** Шаги раскрыты: во время работы — всегда, после — по нажатию. */
  defaultOpen?: boolean;
  /** «Остановить» текущий ответ агента кода; работа с кодом остаётся, можно писать дальше. */
  onStop?: () => void | Promise<void>;
};

export const CodeWorkRow = memo(function CodeWorkRow({
  title, steps, running, durationMs, changedFiles, error, defaultOpen = false, onStop,
}: CodeWorkRowProps) {
  const [openState, setOpen] = useState(defaultOpen);
  const [stopping, setStopping] = useState(false);
  const open = running || openState;
  const summary = steps.length || durationMs !== undefined ? summarizeAgentSteps(steps, durationMs) : "";
  const stop = async () => {
    if (!onStop || stopping) return;
    setStopping(true);
    try { await onStop(); } catch { setStopping(false); }
  };
  return (
    // Карточка работы агента кода по макету: белая, радиус 16, заголовок и короткие шаги под ним.
    <div className="max-w-[560px] rounded-2xl border border-kumo-fill bg-kumo-overlay px-4 py-3.5">
      <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-lg text-left text-kumo-default transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kumo-ring"
      >
        <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center">
          <Code size={16} weight="bold" className="text-kumo-brand" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2 text-[14px] leading-5 font-semibold">
            <span className={`min-w-0 truncate ${running ? styles.thinkingShimmer : ""}`}>{title}</span>
            {error && (
              <span className="flex-shrink-0 rounded-full bg-kumo-danger-tint px-2 py-0.5 text-[10px] font-semibold tracking-[0.04em] text-kumo-danger">
                Ошибка
              </span>
            )}
            <CaretRight
              size={13}
              weight="bold"
              className={`flex-shrink-0 text-kumo-inactive transition-transform duration-150 ease-out ${open ? "rotate-90" : ""}`}
            />
          </span>
          {summary && (
            <span className="mt-0.5 block truncate text-[13px] leading-4 font-normal text-kumo-subtle">{summary}</span>
          )}
        </span>
      </button>
      {running && onStop && (
        <button
          type="button"
          onClick={stop}
          disabled={stopping}
          className="h-8 flex-shrink-0 cursor-pointer rounded-full border border-kumo-fill-hover bg-kumo-overlay px-3 text-[13px] leading-4 text-kumo-default transition-colors hover:bg-kumo-tint disabled:cursor-default disabled:opacity-60"
        >
          {stopping ? "Останавливаю…" : "Остановить"}
        </button>
      )}
      </div>
      {open && (
        <div className="mt-2 space-y-1 pl-[26px]" data-testid="code-work-steps">
          {steps.map((step) => <StepRow key={step.id} step={step} />)}
          {running && steps.length === 0 && (
            <div className={`py-0.5 text-[14px] leading-5 ${styles.thinkingShimmer}`}>Готовлю рабочее место…</div>
          )}
          {error && (
            <pre className="rounded-xl border border-kumo-danger/20 bg-kumo-danger-tint/40 p-2.5 font-mono text-[12px] leading-[18px] text-kumo-danger whitespace-pre-wrap">
              {error}
            </pre>
          )}
          {!running && changedFiles && changedFiles.length > 0 && (
            <div className="pt-1 text-[14px] leading-5 text-kumo-default">
              Изменено файлов: {changedFiles.length}
            </div>
          )}
        </div>
      )}
    </div>
  );
});
