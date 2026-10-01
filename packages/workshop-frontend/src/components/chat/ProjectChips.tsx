// Набор проектов беседы: тихие чипы в нижней строке поля ввода, рядом с «+» и переключателем
// «Код». Контекст работы, а не право доступа: пустой набор — проект определится по задаче.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CaretDown, FolderSimple, X, Sparkle } from "@phosphor-icons/react";
import type { ChatProjectChoice } from "@gadgets/workshop-shared/api";
import type { ChatProject } from "@gadgets/workshop-shared/code-work";
import { MAX_CHAT_PROJECTS, displayName } from "@gadgets/workshop-shared/code-work";

export type ProjectChipsProps = {
  projects: ChatProject[];
  onChange(projects: ChatProject[]): void;
  loadChoices(): Promise<ChatProjectChoice[]>;
  disabled?: boolean;
  /** Справа в той же строке (переключатель «Код»). */
  trailing?: ReactNode;
};

/** Чип настройки в строке поля ввода: тихий, без рамки, цель нажатия 40 px на телефоне. */
export const COMPOSER_CHIP =
  "inline-flex h-8 min-w-0 cursor-pointer items-center gap-1 rounded-full px-2 text-[13px] leading-4 text-kumo-subtle transition-colors duration-150 hover:bg-kumo-tint hover:text-kumo-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kumo-ring disabled:cursor-not-allowed disabled:opacity-40 aria-expanded:bg-kumo-tint aria-expanded:text-kumo-default touch:h-10";

/** Всплывающий список над строкой поля ввода. */
export const COMPOSER_POPOVER =
  "absolute bottom-full left-0 z-30 mb-2 max-h-72 w-[min(18rem,calc(100vw-2rem))] overflow-auto rounded-2xl border border-kumo-fill bg-kumo-overlay p-1 text-[13px] leading-5 shadow-lg";

function sameProject(a: { accountId: number; projectId: string }, b: { accountId: number; projectId: string }) {
  return a.accountId === b.accountId && a.projectId === b.projectId;
}

/** Закрывает всплывающий список по щелчку мимо и по Escape. */
export function useDismiss(open: boolean, close: () => void) {
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) close();
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    document.addEventListener("mousedown", outside);
    document.addEventListener("touchstart", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("touchstart", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open, close]);
  return rootRef;
}

export function ProjectChips({ projects, onChange, loadChoices, disabled = false, trailing }: ProjectChipsProps) {
  const [open, setOpen] = useState(false);
  const [choices, setChoices] = useState<ChatProjectChoice[] | null>(null);
  const [failed, setFailed] = useState(false);
  const rootRef = useDismiss(open, () => setOpen(false));

  useEffect(() => {
    if (!open || choices) return;
    let cancelled = false;
    setFailed(false);
    loadChoices()
      .then((list) => { if (!cancelled) setChoices(list); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [open, choices, loadChoices]);

  const available = (choices ?? []).filter((c) => !projects.some((p) => sameProject(p, c)));
  const full = projects.length >= MAX_CHAT_PROJECTS;

  return (
    <div className="relative flex min-w-0 flex-wrap items-center gap-0.5" aria-label="Проекты беседы">
      <div ref={rootRef} className="flex min-w-0 flex-wrap items-center gap-0.5">
        {projects.map((project) => (
          <span
            key={`${project.accountId}:${project.projectId}`}
            className="inline-flex h-8 max-w-[150px] items-center gap-1 rounded-full bg-kumo-tint pl-2.5 text-[13px] leading-4 text-kumo-default touch:h-10"
            title={project.pinnedBy === "agent" ? "Агент подключил проект по ходу работы" : undefined}
          >
            {project.pinnedBy === "agent" && <Sparkle size={11} className="flex-shrink-0 text-kumo-inactive" aria-label="подключил агент" />}
            <span className="truncate">{displayName(project.title, "Проект")}</span>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange(projects.filter((p) => !sameProject(p, project)))}
              className="flex h-8 w-7 flex-shrink-0 cursor-pointer items-center justify-center rounded-full text-kumo-inactive hover:text-kumo-default disabled:cursor-not-allowed disabled:opacity-40 touch:h-10 touch:w-9"
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
          className={COMPOSER_CHIP}
          aria-label="Добавить проект"
          aria-expanded={open}
          title="Проект определится по задаче, если его не выбрать"
        >
          <FolderSimple size={15} className="flex-shrink-0" />
          {projects.length === 0 && (
            <span className="truncate">
              <span className="max-sm:hidden">Проект: </span><span className="sm:hidden">А</span><span className="max-sm:hidden">а</span>вто
              <span className="sr-only">. Проект определится по задаче</span>
            </span>
          )}
          <CaretDown size={11} className="flex-shrink-0 opacity-70" aria-hidden="true" />
        </button>
        {open && (
          <div role="listbox" aria-label="Выбор проекта" className={COMPOSER_POPOVER}>
            <p className="m-0 px-2.5 pt-1.5 pb-1 text-[12px] leading-4 text-kumo-subtle">
              {projects.length === 0 ? "Без проекта агент выберет его сам по задаче." : "Агент будет работать с этими проектами."}
            </p>
            {failed ? (
              <div className="px-2.5 py-2 text-kumo-danger">Проекты не загрузились. Закройте список и откройте снова.</div>
            ) : choices === null ? (
              <div className="px-2.5 py-2 text-kumo-inactive">Загружаю проекты…</div>
            ) : available.length === 0 ? (
              <div className="px-2.5 py-2 text-kumo-inactive">
                {choices.length === 0 ? "Проектов пока нет. Подключите память в разделе «Подключения»." : "Все проекты уже добавлены."}
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
                className="flex min-h-9 w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-kumo-default hover:bg-kumo-tint touch:min-h-10"
              >
                <span className="truncate">{displayName(choice.title, "Проект без названия")}</span>
                {choice.hasCode && <span className="flex-shrink-0 text-[12px] text-kumo-inactive">есть код</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      {trailing}
    </div>
  );
}
