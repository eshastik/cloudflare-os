// «Что изменилось»: изменения агента в коде проекта и одна кнопка «Принять». Без веток, коммитов
// и запросов на слияние — это делает служба.
import { useEffect, useState } from "react";
import { ArrowUUpLeft, CheckCircle, Clock, WarningCircle, CaretRight } from "@phosphor-icons/react";
import type { ChatCodeAcceptResult, ChatCodeChanges } from "@gadgets/workshop-shared/api";
import type { ChangedFile, ChatCodeWork } from "@gadgets/workshop-shared/code-work";
import { WorkshopButton } from "../WorkshopControls";

type Outcome = NonNullable<ChatCodeWork["review"]>["outcome"];

const STATUS_WORDS: Record<ChangedFile["status"], string> = {
  added: "новый",
  modified: "изменён",
  deleted: "удалён",
  renamed: "переименован",
};

const DIFF_LINES = 400;

type DiffSection = { path: string; lines: string[] };

export function splitDiff(diff: string): DiffSection[] {
  const out: DiffSection[] = [];
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const match = /^diff --git a\/.* b\/(.*)$/.exec(line);
      out.push({ path: match?.[1] ?? line.slice(11), lines: [] });
    } else if (out.length && !/^(index |--- |\+\+\+ |new file mode|deleted file mode|similarity index|rename (from|to) |old mode|new mode)/.test(line)) {
      out[out.length - 1].lines.push(line);
    }
  }
  return out.filter((s) => s.lines.some((l) => l.length));
}

function DiffFile({ section }: { section: DiffSection }) {
  const [limit, setLimit] = useState(DIFF_LINES);
  const shown = section.lines.slice(0, limit);
  return (
    <details open className="mb-2 overflow-hidden rounded-xl border border-kumo-line bg-kumo-base">
      <summary className="cursor-pointer px-3 py-1.5 text-[12px] font-medium text-kumo-default">{section.path}</summary>
      <div className="overflow-x-auto border-t border-kumo-line">
        <pre className="m-0 font-mono text-[12px] leading-5">
          {shown.map((line, index) => (
            <div
              key={index}
              className={`whitespace-pre px-3 ${line.startsWith("+") ? "bg-kumo-success-tint" : line.startsWith("-") ? "bg-kumo-danger-tint" : line.startsWith("@@") ? "text-kumo-subtle" : "text-kumo-default"}`}
            >
              {line || " "}
            </div>
          ))}
        </pre>
      </div>
      {section.lines.length > limit && (
        <button
          type="button"
          onClick={() => setLimit((n) => n + DIFF_LINES)}
          className="w-full cursor-pointer border-t border-kumo-line px-3 py-1.5 text-left text-[12px] text-kumo-subtle hover:text-kumo-default"
        >
          Показать ещё {Math.min(DIFF_LINES, section.lines.length - limit)} строк
        </button>
      )}
    </details>
  );
}

/** Текст итога «Принять» для человека; заметка службы важнее общего текста. */
export function describeAcceptOutcome(outcome: Outcome, note?: string): string {
  switch (outcome) {
    case "accepted": return "Принято";
    case "awaiting_approval": return note || "Ждёт согласования";
    case "no_approver": return note || "Некому согласовать: назначьте ответственного за проект.";
    case "rejected": return note || "Не принято";
    case "reverted": return "Возвращено как было";
    case "draft": return "";
  }
}

export type CodeChangesCardProps = {
  /** Меняется, когда работа с кодом закончила ход: карточка перечитывает изменения. */
  refreshKey: string;
  review?: ChatCodeWork["review"];
  load(): Promise<ChatCodeChanges | null>;
  accept(): Promise<ChatCodeAcceptResult>;
  /** «Вернуть как было» — есть только у принятых изменений. */
  revert?(): Promise<ChatCodeAcceptResult>;
  disabled?: boolean;
};

export function CodeChangesCard({ refreshKey, review, load, accept, revert, disabled = false }: CodeChangesCardProps) {
  const [changes, setChanges] = useState<ChatCodeChanges | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ChatCodeAcceptResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setError(null);
    load().then((value) => { if (!cancelled) setChanges(value); }).catch(() => { if (!cancelled) setChanges(null); });
    return () => { cancelled = true; };
  }, [refreshKey, load]);

  const outcome: Outcome = result?.outcome ?? review?.outcome ?? "draft";
  const note = result?.note ?? review?.note;
  if (!changes || (changes.files.length === 0 && outcome === "draft")) return null;

  const run = async (action: () => Promise<ChatCodeAcceptResult>, failure: string) => {
    setBusy(true);
    setError(null);
    try {
      setResult(await action());
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : failure);
    } finally {
      setBusy(false);
    }
  };
  const onAccept = () => run(accept, "Не удалось принять изменения");
  const canRevert = outcome === "accepted" && !!revert && !!(review?.mergeRequest ?? changes.review?.mergeRequest);

  const decided = outcome !== "draft";
  const OutcomeIcon = outcome === "accepted" ? CheckCircle : outcome === "awaiting_approval" ? Clock : outcome === "reverted" ? ArrowUUpLeft : WarningCircle;

  return (
    <section aria-label="Что изменилось" className="mx-4 mb-2 rounded-2xl border border-kumo-line bg-kumo-elevated/40 p-3 text-[13px] leading-5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium text-kumo-default">Что изменилось</div>
          <div className="truncate text-[12px] leading-4 text-kumo-inactive">
            {changes.projectTitle} · файлов: {changes.files.length}
          </div>
        </div>
        {decided ? (
          <span className="inline-flex flex-shrink-0 items-center gap-3">
            <span
              role="status"
              className={`inline-flex items-center gap-1.5 text-[12px] ${outcome === "accepted" ? "text-kumo-success" : outcome === "awaiting_approval" || outcome === "reverted" ? "text-kumo-subtle" : "text-kumo-danger"}`}
            >
              <OutcomeIcon size={14} />
              {describeAcceptOutcome(outcome, note)}
            </span>
            {canRevert && (
              <button
                type="button"
                disabled={disabled || busy}
                onClick={() => run(revert!, "Не удалось вернуть изменения")}
                className="cursor-pointer text-[12px] text-kumo-subtle hover:text-kumo-default disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? "Возвращаю…" : "Вернуть как было"}
              </button>
            )}
          </span>
        ) : (
          <WorkshopButton tone="primary" size="sm" disabled={disabled || busy} onClick={onAccept}>
            {busy ? "Принимаю…" : "Принять"}
          </WorkshopButton>
        )}
      </div>
      {changes.summary && (
        <p className="mt-2 mb-0 line-clamp-3 whitespace-pre-line text-kumo-subtle">{changes.summary}</p>
      )}
      {changes.files.length > 0 && (
        <ul className="mt-2 mb-0 list-none space-y-0.5 p-0">
          {changes.files.slice(0, 20).map((file) => (
            <li key={file.path} className="flex items-center gap-2 text-[12px] leading-4">
              <span className="min-w-0 flex-1 truncate font-mono text-kumo-default">{file.path}</span>
              <span className="flex-shrink-0 text-kumo-inactive">{STATUS_WORDS[file.status]}</span>
              <span className="flex-shrink-0 font-mono text-kumo-success">+{file.additions}</span>
              <span className="flex-shrink-0 font-mono text-kumo-danger">−{file.deletions}</span>
            </li>
          ))}
          {changes.files.length > 20 && (
            <li className="text-[12px] text-kumo-inactive">и ещё {changes.files.length - 20}</li>
          )}
        </ul>
      )}
      {changes.diff && (
        <button
          type="button"
          onClick={() => setShowDiff((v) => !v)}
          aria-expanded={showDiff}
          className="mt-2 inline-flex cursor-pointer items-center gap-1 text-[12px] text-kumo-subtle hover:text-kumo-default"
        >
          <CaretRight size={11} weight="bold" className={`transition-transform ${showDiff ? "rotate-90" : ""}`} />
          Подробнее
        </button>
      )}
      {showDiff && (
        <div className="mt-2 max-h-[420px] overflow-auto">
          {splitDiff(changes.diff).map((section, index) => <DiffFile key={index} section={section} />)}
          {changes.truncated && (
            <p className="m-0 text-[12px] text-kumo-inactive">Показана только часть изменений: остальное слишком велико.</p>
          )}
        </div>
      )}
      {error && <p role="alert" className="mt-2 mb-0 text-[12px] text-kumo-danger">{error}</p>}
    </section>
  );
}
