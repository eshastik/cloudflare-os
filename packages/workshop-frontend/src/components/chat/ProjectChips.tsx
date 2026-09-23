// Набор проектов беседы: тихие чипы над полем ввода («Продажи · Склад · +»). Контекст работы,
// а не право доступа: пустой набор — проект определится по задаче.
import { useEffect, useRef, useState } from "react";
import { Plus, X, Sparkle } from "@phosphor-icons/react";
import type { ChatProjectChoice } from "@gadgets/workshop-shared/api";
import type { ChatProject } from "@gadgets/workshop-shared/code-work";
import { MAX_CHAT_PROJECTS, displayName } from "@gadgets/workshop-shared/code-work";

export type ProjectChipsProps = {
  projects: ChatProject[];
  onChange(projects: ChatProject[]): void;
  loadChoices(): Promise<ChatProjectChoice[]>;
  disabled?: boolean;
};

function sameProject(a: { accountId: number; projectId: string }, b: { accountId: number; projectId: string }) {
  return a.accountId === b.accountId && a.projectId === b.projectId;
}

export function ProjectChips({ projects, onChange, loadChoices, disabled = false }: ProjectChipsProps) {
  const [open, setOpen] = useState(false);
  const [choices, setChoices] = useState<ChatProjectChoice[] | null>(null);
  const [failed, setFailed] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || choices) return;
    let cancelled = false;
    loadChoices()
      .then((list) => { if (!cancelled) setChoices(list); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [open, choices, loadChoices]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const available = (choices ?? []).filter((c) => !projects.some((p) => sameProject(p, c)));
  const full = projects.length >= MAX_CHAT_PROJECTS;

  return (
    <div ref={rootRef} className="relative flex flex-wrap items-center gap-1.5 px-4 pt-2 text-[12px] leading-4" aria-label="Проекты беседы">
      {projects.length === 0 && (
        <span className="text-kumo-inactive">Проект определится по задаче</span>
      )}
      {projects.map((project) => (
        <span
          key={`${project.accountId}:${project.projectId}`}
          className="inline-flex max-w-[220px] items-center gap-1 rounded-full border border-kumo-line bg-kumo-elevated/60 py-0.5 pl-2.5 pr-1 text-kumo-subtle"
          title={project.pinnedBy === "agent" ? "Агент подключил проект по ходу работы" : undefined}
        >
          {project.pinnedBy === "agent" && <Sparkle size={11} className="flex-shrink-0 text-kumo-inactive" aria-label="подключил агент" />}
          <span className="truncate">{displayName(project.title, "Проект")}</span>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(projects.filter((p) => !sameProject(p, project)))}
            className="flex h-4 w-4 cursor-pointer items-center justify-center rounded-full text-kumo-inactive hover:text-kumo-default disabled:cursor-not-allowed disabled:opacity-40"
            aria-label={`Убрать проект «${displayName(project.title, "Проект")}»`}
          >
            <X size={10} weight="bold" />
          </button>
        </span>
      ))}
      <button
        type="button"
        disabled={disabled || full}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-5 w-5 cursor-pointer items-center justify-center rounded-full border border-dashed border-kumo-line text-kumo-inactive hover:text-kumo-default disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="Добавить проект"
        aria-expanded={open}
      >
        <Plus size={11} weight="bold" />
      </button>
      {open && (
        <div role="listbox" aria-label="Выбор проекта" className="absolute bottom-full left-4 z-20 mb-1 max-h-64 w-72 overflow-auto rounded-xl border border-kumo-line bg-kumo-base p-1 shadow-lg">
          {failed ? (
            <div className="px-2.5 py-2 text-kumo-danger">Не удалось загрузить проекты</div>
          ) : choices === null ? (
            <div className="px-2.5 py-2 text-kumo-inactive">Загружаю проекты…</div>
          ) : available.length === 0 ? (
            <div className="px-2.5 py-2 text-kumo-inactive">
              {choices.length === 0 ? "Нет доступных проектов. Подключите память в настройках." : "Все проекты уже добавлены"}
            </div>
          ) : available.map((choice) => (
            <button
              key={`${choice.accountId}:${choice.projectId}`}
              type="button"
              role="option"
              aria-selected={false}
              onClick={() => {
                onChange([...projects, {
                  accountId: choice.accountId, projectId: choice.projectId, title: choice.title,
                  pinnedBy: "user", ...(choice.hasCode ? { hasCode: true } : {}),
                }]);
                setOpen(false);
              }}
              className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] leading-5 text-kumo-default hover:bg-kumo-elevated"
            >
              <span className="truncate">{displayName(choice.title, "Проект без названия")}</span>
              {choice.hasCode && <span className="flex-shrink-0 text-[11px] text-kumo-inactive">есть код</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
