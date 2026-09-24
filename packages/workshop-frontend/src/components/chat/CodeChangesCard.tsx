// «Что изменилось»: изменения агента в коде проекта и одна кнопка «Принять». Без веток, коммитов
// и запросов на слияние — это делает служба.
import { useEffect, useState } from "react";
import { ArrowUUpLeft, CheckCircle, Clock, WarningCircle, CaretRight } from "@phosphor-icons/react";
import type { ChatCodeAcceptResult, ChatCodeChanges } from "@gadgets/workshop-shared/api";
import type { ChangedFile, ChatCodeWork } from "@gadgets/workshop-shared/code-work";
import { displayName } from "@gadgets/workshop-shared/code-work";

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
    <details open className="mb-2 overflow-hidden rounded-xl border border-kumo-fill bg-kumo-base">
      <summary className="cursor-pointer px-3 py-1.5 text-[13px] font-medium text-kumo-default">{section.path}</summary>
      <div className="overflow-x-auto border-t border-kumo-fill">
        <pre className="m-0 font-mono text-[13px] leading-[1.75] text-kumo-default">
          {shown.map((line, index) => (
            <div
              key={index}
              className={`whitespace-pre px-3 ${line.startsWith("+") ? "bg-kumo-brand/10" : line.startsWith("-") ? "bg-kumo-danger-tint" : line.startsWith("@@") ? "text-kumo-subtle" : "text-kumo-subtle"}`}
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
          className="w-full cursor-pointer border-t border-kumo-fill px-3 py-1.5 text-left text-[12px] text-kumo-subtle hover:text-kumo-default"
        >
          Показать ещё {Math.min(DIFF_LINES, section.lines.length - limit)} строк
        </button>
      )}
    </details>
  );
}

function FileList({ files }: { files: ChangedFile[] }) {
  return (
    <ul className="mt-1 mb-0 list-none p-0">
      {files.slice(0, 20).map((file) => (
        <li key={file.path} className="flex h-10 items-center gap-2.5 rounded-[10px] px-2.5 text-[14px] leading-5 hover:bg-kumo-tint">
          <span className="min-w-0 flex-1 truncate text-kumo-default">{file.path}</span>
          <span className="flex-shrink-0 text-[13px] text-kumo-subtle">{STATUS_WORDS[file.status]}</span>
          <span className="flex-shrink-0 font-mono text-[12px] text-kumo-brand">+{file.additions}</span>
          {file.deletions > 0 && <span className="flex-shrink-0 font-mono text-[12px] text-kumo-danger">−{file.deletions}</span>}
        </li>
      ))}
      {files.length > 20 && (
        <li className="px-2.5 text-[13px] text-kumo-subtle">и ещё {files.length - 20}</li>
      )}
    </ul>
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
  // При нескольких репозиториях изменения группируются по ним; пути внутри группы — от папки репозитория.
  const groups = changes.repositories && changes.repositories.length > 1 ? changes.repositories.filter((r) => r.files.length > 0) : null;
  const hasDiff = groups ? groups.some((g) => g.diff) : !!changes.diff;
  const truncated = changes.truncated || !!groups?.some((g) => g.truncated);
  const shownFiles = groups ? groups.flatMap((g) => g.files) : changes.files;
  const totalAdditions = shownFiles.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = shownFiles.reduce((sum, f) => sum + f.deletions, 0);
  const OutcomeIcon = outcome === "accepted" ? CheckCircle : outcome === "awaiting_approval" ? Clock : outcome === "reverted" ? ArrowUUpLeft : WarningCircle;

  return (
    // Карточка по макету «Работа с кодом»: белая поверхность, радиус 20, пилюли действий.
    <section aria-label="Что изменилось" className="mx-5 mb-2 rounded-[20px] border border-kumo-fill bg-kumo-overlay px-4 py-3.5 text-[14px] leading-5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[16px] leading-6 font-semibold text-kumo-default">Что изменилось</div>
          <div className="truncate text-[13px] leading-4 text-kumo-subtle">
            {displayName(changes.projectTitle, "Проект")} · файлов: {changes.files.length} · +{totalAdditions} −{totalDeletions}
          </div>
        </div>
        {decided ? (
          <span className="inline-flex flex-shrink-0 items-center gap-3">
            <span
              role="status"
              className={`inline-flex items-center gap-1.5 text-[13px] ${outcome === "accepted" ? "text-kumo-success" : outcome === "awaiting_approval" || outcome === "reverted" ? "text-kumo-subtle" : "text-kumo-danger"}`}
            >
              <OutcomeIcon size={14} />
              {describeAcceptOutcome(outcome, note)}
            </span>
            {canRevert && (
              <button
                type="button"
                disabled={disabled || busy}
                onClick={() => run(revert!, "Не удалось вернуть изменения")}
                className="h-10 cursor-pointer rounded-full border border-kumo-fill-hover bg-kumo-overlay px-4 text-[14px] text-kumo-default transition-colors hover:bg-kumo-tint disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? "Возвращаю…" : "Вернуть как было"}
              </button>
            )}
          </span>
        ) : (
          <button
            type="button"
            disabled={disabled || busy}
            onClick={onAccept}
            className="h-10 flex-shrink-0 cursor-pointer rounded-full bg-kumo-brand px-[22px] text-[15px] font-semibold text-white transition-colors hover:bg-kumo-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kumo-ring disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Принимаю…" : "Принять"}
          </button>
        )}
      </div>
      {changes.summary && (
        <p className="mt-2 mb-0 line-clamp-3 whitespace-pre-line text-[15px] leading-6 text-kumo-default">{changes.summary}</p>
      )}
      {groups ? (
        groups.map((group, index) => (
          <div key={index} className="mt-2" data-testid="code-changes-repository">
            <div className="px-2.5 text-[13px] font-semibold leading-4 text-kumo-default">{group.name}</div>
            <FileList files={group.files} />
          </div>
        ))
      ) : changes.files.length > 0 ? (
        <div className="mt-1"><FileList files={changes.files} /></div>
      ) : decided ? (
        <p className="mt-2 mb-0 text-[13px] text-kumo-subtle">Новых изменений после принятия пока нет.</p>
      ) : null}
      {hasDiff && (
        <button
          type="button"
          onClick={() => setShowDiff((v) => !v)}
          aria-expanded={showDiff}
          className="mt-2 inline-flex cursor-pointer items-center gap-1 text-[13px] text-kumo-subtle hover:text-kumo-default"
        >
          <CaretRight size={11} weight="bold" className={`transition-transform ${showDiff ? "rotate-90" : ""}`} />
          Подробнее
        </button>
      )}
      {showDiff && (
        <div className="mt-2 max-h-[420px] overflow-auto">
          {groups
            ? groups.map((group, index) => (
              <div key={index}>
                <div className="mb-1 text-[13px] font-medium text-kumo-default">{group.name}</div>
                {splitDiff(group.diff).map((section, n) => <DiffFile key={n} section={section} />)}
              </div>
            ))
            : splitDiff(changes.diff).map((section, index) => <DiffFile key={index} section={section} />)}
          {truncated && (
            <p className="m-0 text-[13px] text-kumo-subtle">Показана только часть изменений: остальное слишком велико.</p>
          )}
        </div>
      )}
      {error && <p role="alert" className="mt-2 mb-0 text-[13px] text-kumo-danger">{error}</p>}
    </section>
  );
}
