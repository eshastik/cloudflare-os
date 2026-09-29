// Карточка гаджета в ленте беседы: итог gadgetWork, когда сборка сохранена в проект.
// Открывает файл гаджета через навигацию оболочки (useMnemosLink), а не по внешнему адресу.
import { memo, useEffect, useRef, useState } from "react";
import { AppWindow, FolderSimple, LockSimple } from "@phosphor-icons/react";
import type { AiChatMessage } from "@gadgets/workshop-shared/api";
import type { GadgetWorkResult } from "@gadgets/workshop-shared/code-work";

export type SavedGadget = Extract<GadgetWorkResult, { saved: true }>;

export type GadgetWorkCardProps = {
  gadget: SavedGadget;
  projectTitle: string;
  /** Открыть гаджет; нет — приложение Mnemos не подключено, кнопка неактивна. Обещание — открытие идёт. */
  onOpen?: () => void | Promise<unknown>;
};

/** Строка под названием: описание из манифеста, иначе — что значит «совместный» или «личный». */
function gadgetSummary(gadget: SavedGadget): string {
  const description = gadget.description?.trim();
  if (description) return description;
  return gadget.collaborative
    ? "Одни данные на всех, кому открыт файл."
    : "У каждого, кому его дадут, свои данные.";
}

const badgeClass = "inline-flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[12px] font-medium leading-4";

export const GadgetWorkCard = memo(function GadgetWorkCard({ gadget, projectTitle, onOpen }: GadgetWorkCardProps) {
  // Первое открытие заводит гаджет в рабочем месте — это секунды; кнопка показывает, что нажатие принято.
  const [opening, setOpening] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const open = () => {
    if (!onOpen || opening) return;
    const result = onOpen();
    if (!(result instanceof Promise)) return;
    setOpening(true);
    void result.catch(() => {}).finally(() => { if (mounted.current) setOpening(false); });
  };
  return (
    <article
      aria-label={`Гаджет «${gadget.title}»`}
      data-testid="gadget-work-card"
      className="w-full max-w-[560px] overflow-hidden rounded-2xl border border-kumo-fill bg-kumo-overlay"
    >
      <div className="flex gap-3 px-4 pt-4 pb-3.5">
        <span
          aria-hidden="true"
          className="grid h-11 w-11 flex-shrink-0 place-items-center rounded-xl border border-kumo-brand/15 bg-kumo-brand/10 text-kumo-brand"
        >
          <AppWindow size={22} weight="duotone" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="m-0 text-[16px] font-semibold leading-[22px] tracking-[-0.2px] text-kumo-default [overflow-wrap:anywhere]">
            {gadget.title}
          </h3>
          <p className="m-0 mt-0.5 line-clamp-2 text-[13px] leading-[18px] text-kumo-subtle">{gadgetSummary(gadget)}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className={`${badgeClass} bg-kumo-fill text-kumo-subtle`}>
              {gadget.collaborative ? "Совместный" : "Личный"}
            </span>
            <span className={`${badgeClass} bg-kumo-warning-tint text-kumo-warning`}>
              <span aria-hidden="true" className="h-[7px] w-[7px] rounded-full bg-current" />
              Личная версия
            </span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3 border-t border-kumo-line px-4 py-3">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="m-0 flex min-w-0 items-center gap-1.5 text-[13px] leading-[18px] text-kumo-default">
            <FolderSimple size={14} aria-hidden="true" className="flex-shrink-0 text-kumo-inactive" />
            <span className="min-w-0 truncate font-medium">{projectTitle}</span>
            <span className="flex-shrink-0 text-kumo-inactive">{gadget.created ? "новый файл" : "новая версия"}</span>
          </p>
          <p className="m-0 flex items-start gap-1.5 text-[12px] leading-4 text-kumo-subtle">
            <LockSimple size={13} aria-hidden="true" className="mt-px flex-shrink-0 text-kumo-inactive" />
            <span>Видите только вы, пока не опубликуете.</span>
          </p>
        </div>
        <button
          type="button"
          onClick={open}
          disabled={!onOpen || opening}
          aria-busy={opening || undefined}
          title={onOpen ? undefined : "Приложение Mnemos не подключено"}
          className="inline-flex h-9 flex-shrink-0 cursor-pointer items-center justify-center rounded-lg bg-kumo-brand px-4 text-[14px] font-medium text-white transition-[background-color,transform] duration-150 ease-out hover:bg-kumo-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kumo-ring focus-visible:ring-offset-2 focus-visible:ring-offset-kumo-overlay active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 aria-busy:!cursor-progress aria-busy:!opacity-100 min-w-[112px] motion-reduce:transition-none touch:h-10"
        >
          {opening ? "Открываю…" : "Открыть"}
        </button>
      </div>
      {gadget.sourcesNote && (
        <p className="m-0 border-t border-kumo-line px-4 py-2.5 text-[12px] leading-4 text-kumo-subtle">
          Исходники не сохранились: следующая правка начнётся с чистого шаблона.
        </p>
      )}
    </article>
  );
});

/** Сохранённые гаджеты беседы: узлы, для которых в ленте уже стоит карточка. */
export function savedGadgetResources(messages: readonly AiChatMessage[]): Set<string> {
  const resources = new Set<string>();
  for (const message of messages) {
    if (message.type !== "message" || !message.toolCalls) continue;
    for (const call of message.toolCalls) {
      if (call.toolName === "gadgetWork" && call.output?.gadget?.saved) resources.add(call.output.gadget.resource);
    }
  }
  return resources;
}

// Ссылка Markdown [текст](адрес) или голый адрес http(s).
const LINK = /\[([^\]\n]*)\]\(\s*<?([^()\s<>]+)>?\s*\)|<?(https?:\/\/[^\s<>()]+)>?/g;
// Строка, в которой после удаления ссылки остались только маркеры списка и знаки препинания.
const EMPTY_REST = /^[\s\-*•>:—–.,;!?()]*$/;

function isGadgetUrl(raw: string, resources: ReadonlySet<string>): boolean {
  try {
    const url = new URL(raw, "https://local.invalid");
    return url.pathname.startsWith("/gatekeepers/") && resources.has(url.searchParams.get("document") ?? "");
  } catch {
    return false;
  }
}

/**
 * Убирает из ответа агента ссылки на гаджеты, у которых в ленте уже есть карточка: кнопка
 * «Открыть» там, а внешняя ссылка ведёт мимо навигации оболочки. Прочие ссылки не трогает.
 */
export function hideGadgetLinks(text: string, resources: ReadonlySet<string>): string {
  if (resources.size === 0 || !text.includes("document=")) return text;
  const lines: string[] = [];
  for (const line of text.split("\n")) {
    let hit = false;
    const rest = line.replace(LINK, (whole: string, _label: string | undefined, target: string | undefined, bare: string | undefined) => {
      if (!isGadgetUrl(target ?? bare ?? "", resources)) return whole;
      hit = true;
      return "";
    });
    if (!hit) { lines.push(line); continue; }
    if (EMPTY_REST.test(rest)) continue;
    lines.push(rest
      .replace(/^[ \t]*[—–:][ \t]*/, "")
      .replace(/[ \t]*[:—–-][ \t]*([.!?]?)[ \t]*$/, "$1")
      .replace(/[ \t]+([.,;!?])/g, "$1")
      .replace(/[ \t]{2,}/g, " ")
      .trimEnd());
  }
  return lines.join("\n");
}
