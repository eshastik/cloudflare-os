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
        className="flex w-full items-center gap-3 rounded-xl px-1.5 py-0.5 text-left text-kumo-subtle transition-colors duration-150 ease-out enabled:cursor-pointer enabled:hover:text-kumo-default focus-visible:outline-none"
      >
        <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center">
          <Icon size={14} className={step.status === "error" ? "text-kumo-danger" : "text-kumo-inactive"} />
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-2 text-[13px] leading-5 tracking-[-0.2px]">
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
        <div className="themed-surface-inset ml-8 mt-1 space-y-2 rounded-2xl border border-kumo-line/70 bg-kumo-elevated/45 p-3">
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
    <div className="-ml-0.5">
      <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-xl px-1.5 py-1 text-left text-kumo-subtle transition-colors duration-150 ease-out hover:text-kumo-default focus-visible:text-kumo-default focus-visible:outline-none"
      >
        <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center">
          <Code size={15} className="text-kumo-inactive" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2 text-[14px] leading-5 tracking-[-0.25px]">
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
            <span className="mt-0.5 block truncate text-[12px] leading-4 text-kumo-inactive">{summary}</span>
          )}
        </span>
      </button>
      {running && onStop && (
        <button
          type="button"
          onClick={stop}
          disabled={stopping}
          className="flex-shrink-0 cursor-pointer rounded-lg border border-kumo-line px-2 py-0.5 text-[12px] leading-4 text-kumo-subtle transition-colors hover:text-kumo-default disabled:cursor-default disabled:opacity-60"
        >
          {stopping ? "Останавливаю…" : "Остановить"}
        </button>
      )}
      </div>
      {open && (
        <div className="ml-8 mt-1 space-y-0.5" data-testid="code-work-steps">
          {steps.map((step) => <StepRow key={step.id} step={step} />)}
          {running && steps.length === 0 && (
            <div className={`px-1.5 py-0.5 text-[13px] leading-5 ${styles.thinkingShimmer}`}>Готовлю рабочее место…</div>
          )}
          {error && (
            <pre className="rounded-xl border border-kumo-danger/20 bg-kumo-danger-tint/40 p-2.5 font-mono text-[12px] leading-[18px] text-kumo-danger whitespace-pre-wrap">
              {error}
            </pre>
          )}
          {!running && changedFiles && changedFiles.length > 0 && (
            <div className="px-1.5 pt-1 text-[12px] leading-4 text-kumo-inactive">
              Изменено файлов: {changedFiles.length}
            </div>
          )}
        </div>
      )}
    </div>
  );
});
