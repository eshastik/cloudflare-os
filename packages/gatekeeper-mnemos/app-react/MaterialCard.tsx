import { Button } from "@cloudflare/kumo";
import { ChatCircleText, FileText, ListChecks } from "@phosphor-icons/react";
import type { DocumentRow } from "./data.ts";
import { relativeTime } from "./time.ts";
import { StatusBadge } from "./ui.tsx";

/** Сколько символов фрагмента показывать в карточке: дальше человек открывает документ. */
const SNIPPET_LENGTH = 240;

export type MaterialAction = "ask" | "task";

/** Начало сообщения в беседе: человек дописывает вопрос или задачу сам, проект беседы уже выбран. */
export function materialPrompt(action: MaterialAction, name: string): string {
  return action === "ask" ? `Вопрос по документу «${name}»:\n\n` : `Задача по документу «${name}»:\n\n`;
}

/** Короткий фрагмент найденного текста: пробелы схлопнуты, длинное обрезано по слову. */
export function snippet(text: string, limit = SNIPPET_LENGTH): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= limit) return flat;
  const cut = flat.slice(0, limit);
  const space = cut.lastIndexOf(" ");
  return `${(space > limit * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** Карточка материала: название, проект, когда изменён, фрагмент (для результата поиска) и действия. */
export function MaterialCard({ row, at, fragment, selected, onOpen, onChat }: {
  row: DocumentRow; at?: string; fragment?: string; selected: boolean;
  onOpen(): void; onChat(action: MaterialAction): void;
}) {
  return (
    <article data-document={row.nodeId} aria-current={selected ? "true" : undefined}
      className={`rounded-xl border border-kumo-line p-4 ${selected ? "bg-kumo-tint" : "bg-kumo-base"}`}>
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-kumo-line bg-kumo-elevated text-kumo-subtle"><FileText size={16} aria-hidden="true" /></span>
        <div className="min-w-0 flex-1">
          <button type="button" onClick={onOpen} className="m-0 block max-w-full bg-transparent p-0 text-left text-[13px] leading-[18px] font-medium tracking-[-0.25px] text-kumo-default [overflow-wrap:anywhere] hover:text-kumo-strong">{row.name}</button>
          <div className="mt-0.5 text-[12px] text-kumo-subtle">
            {row.projectName}{at && <> · изменён <time dateTime={at}>{relativeTime(at)}</time></>}
          </div>
          {fragment && <p className="mt-2 mb-0 text-[13px] leading-[18px] tracking-[-0.25px] text-kumo-default [overflow-wrap:anywhere]">{snippet(fragment)}</p>}
        </div>
        <StatusBadge tone={row.status.tone}>{row.status.label}</StatusBadge>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 pl-12">
        <Button variant="secondary" size="sm" onClick={onOpen}>Открыть</Button>
        <MaterialChatButtons onChat={onChat} />
      </div>
    </article>
  );
}

export function MaterialChatButtons({ onChat }: { onChat(action: MaterialAction): void }) {
  return <>
    <Button variant="ghost" size="sm" icon={ChatCircleText} onClick={() => onChat("ask")}>Спросить в беседе</Button>
    <Button variant="ghost" size="sm" icon={ListChecks} onClick={() => onChat("task")}>Сделать задачу по документу</Button>
  </>;
}
