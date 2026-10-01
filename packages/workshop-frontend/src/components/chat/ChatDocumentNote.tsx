// Пометка под документом, прикреплённым в беседе: где он лежит в Mnemos, ссылка на него и перенос
// в другой проект. Место после переноса держится здесь: сообщение в кэше беседы не перечитывается.
import { useCallback, useEffect, useState } from "react";
import { useKumoToastManager } from "@cloudflare/kumo";
import type { ChatDocumentRef, ChatProjectChoice } from "@gadgets/workshop-shared/api";
import { displayName } from "@gadgets/workshop-shared/code-work";
import { chatDocumentPlaceLabel } from "../../chatAttachmentFiles";
import { COMPOSER_POPOVER, useDismiss } from "./ProjectChips";

export type ChatDocumentNoteProps = {
  document: ChatDocumentRef;
  /** Открыть документ в приложении Mnemos; undefined — ссылки нет. */
  openDocument?: (doc: ChatDocumentRef) => (() => unknown) | undefined;
  loadProjects?: () => Promise<ChatProjectChoice[]>;
  move?: (targetProjectId: string) => Promise<ChatDocumentRef>;
};

const NOTE = "m-0 text-[11px] leading-[14px] text-kumo-subtle";
const LINK = "cursor-pointer text-left text-[11px] leading-[14px] underline decoration-kumo-line underline-offset-2";

export function ChatDocumentNote({ document: initial, openDocument, loadProjects, move }: ChatDocumentNoteProps) {
  const toasts = useKumoToastManager();
  const [doc, setDoc] = useState(initial);
  useEffect(() => setDoc(initial), [initial]);
  const [open, setOpen] = useState(false);
  const [choices, setChoices] = useState<ChatProjectChoice[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [moving, setMoving] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const rootRef = useDismiss(open, close);

  useEffect(() => {
    if (!open || choices || !loadProjects) return;
    let cancelled = false;
    setFailed(false);
    loadProjects()
      .then((list) => { if (!cancelled) setChoices(list); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [open, choices, loadProjects]);

  // Перенос возможен только внутри той же памяти: проект другой установки Mnemos не увидит.
  const available = (choices ?? []).filter((c) => c.accountId === doc.accountId && c.projectId !== doc.projectId);

  const moveTo = async (choice: ChatProjectChoice) => {
    if (!move) return;
    setOpen(false);
    setMoving(true);
    try {
      const next = await move(choice.projectId);
      setDoc(next);
      toasts.add({ title: `Файл «${next.name}» перенесён в проект «${next.projectTitle || displayName(choice.title, "Проект")}»` });
    } catch (err) {
      const reason = err instanceof Error && err.message ? err.message : "Mnemos не принял перенос.";
      toasts.add({ title: `Не удалось перенести «${doc.name}»: ${reason}`, variant: "error" });
    } finally {
      setMoving(false);
    }
  };

  const label = chatDocumentPlaceLabel(doc);
  const openHandler = openDocument?.(doc);
  return (
    <div ref={rootRef} className="relative flex flex-col items-start gap-0.5">
      {openHandler ? (
        <button type="button" onClick={() => { void openHandler(); }} className={`${LINK} text-kumo-subtle hover:text-kumo-default`}
          title={`Открыть «${doc.name}»`}>
          {label}
        </button>
      ) : (
        <p className={NOTE}>{label}</p>
      )}
      {move && loadProjects && (
        <button
          type="button"
          disabled={moving}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="listbox"
          className={`${LINK} text-kumo-link hover:text-kumo-brand disabled:cursor-wait disabled:opacity-60`}
        >
          {moving ? "Переношу…" : "Переместить в проект…"}
        </button>
      )}
      {open && (
        <div role="listbox" aria-label={`Куда перенести «${doc.name}»`}
          className={COMPOSER_POPOVER.replace("bottom-full", "top-full").replace("mb-2", "mt-1")}>
          <p className="m-0 px-2.5 pt-1.5 pb-1 text-[12px] leading-4 text-kumo-subtle">
            Файл станет вашей личной версией в выбранном проекте.
          </p>
          {failed ? (
            <div className="px-2.5 py-2 text-kumo-danger">Проекты не загрузились. Закройте список и откройте снова.</div>
          ) : choices === null ? (
            <div className="px-2.5 py-2 text-kumo-inactive">Загружаю проекты…</div>
          ) : available.length === 0 ? (
            <div className="px-2.5 py-2 text-kumo-inactive">Других проектов в этой памяти нет.</div>
          ) : available.map((choice) => (
            <button
              key={`${choice.accountId}:${choice.projectId}`}
              type="button"
              role="option"
              aria-selected={false}
              onClick={() => { void moveTo(choice); }}
              className="flex min-h-9 w-full cursor-pointer items-center rounded-lg px-2.5 py-1.5 text-left text-kumo-default hover:bg-kumo-tint touch:min-h-10"
            >
              <span className="truncate">{displayName(choice.title, "Проект без названия")}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
