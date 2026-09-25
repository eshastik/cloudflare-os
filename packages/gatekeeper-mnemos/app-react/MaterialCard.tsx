import { ChatCircleText, FileCode, FileText, ListChecks } from "@phosphor-icons/react";
import type { DocumentRow } from "./data.ts";
import { isMarkdown, markdownToPlain } from "./markdown.tsx";
import { relativeTime } from "./time.ts";
import { Button, StatusBadge } from "./ui.tsx";

/** Сколько символов фрагмента показывать в строке: дальше человек открывает документ. */
const SNIPPET_LENGTH = 240;

/** Файлы, у которых вместо листа — значок кода: по ним ищут именем и словом, а не смыслом. */
const CODE_FILE = /\.(py|pyi|js|mjs|cjs|jsx|ts|tsx|go|rs|java|kt|scala|c|h|cpp|hpp|cs|rb|php|swift|sh|bash|zsh|ps1|sql|ya?ml|toml|ini|cfg|conf|properties|proto|tf|gradle|lock|json)$|^(Dockerfile|Makefile|\.env.*|\.gitignore)$/i;

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

/** Части запроса так же, как их режет сервер: camelCase, snake_case, точки и косые черты. */
export function queryTerms(query: string): string[] {
  const parts = query.replace(/([a-zа-яё0-9])([A-ZА-ЯЁ])/g, "$1 $2").toLowerCase().split(/[\s\p{P}\p{S}]+/u);
  return [...new Set(parts.filter(part => part.length > 1))].slice(0, 8);
}

/** Найденные части выделяются в тексте; разметка собирается из узлов React, HTML из данных не исполняется. */
export function Highlight({ text, terms }: { text: string; terms?: string[] }) {
  if (!terms?.length) return <>{text}</>;
  const escaped = terms.map(t => t.replace(/[.*+?^$()|[\]{}\\]/g, "\\$&"));
  const pattern = new RegExp("(" + escaped.join("|") + ")", "gi");
  return <>{text.split(pattern).map((piece, i) => i % 2 ? <mark key={i} className="rounded-[4px] bg-[rgba(29,106,80,.14)] px-[1px] text-inherit">{piece}</mark> : piece)}</>;
}

/** Папка документа для подписи: путь без имени файла и без ведущей косой черты. */
export function folderOf(path: string | undefined, name: string): string {
  if (!path) return "";
  const trimmed = path.replace(/^\/+/, "");
  const folder = trimmed.endsWith(name) ? trimmed.slice(0, trimmed.length - name.length) : trimmed.slice(0, trimmed.lastIndexOf("/") + 1);
  return folder.replace(/\/+$/, "");
}

/**
 * Строка материала по макету: значок, имя, папка, фрагмент найденного, справа — проект и время.
 * Действия видны у выбранной строки и при наведении или фокусе, чтобы длинный список оставался спокойным.
 */
export function MaterialCard({ row, at, fragment, folder, showProject, terms, selected, onOpen, onChat }: {
  row: DocumentRow; at?: string; fragment?: string; folder?: string; showProject?: boolean; terms?: string[]; selected: boolean;
  onOpen(): void; onChat(action: MaterialAction): void;
}) {
  const code = CODE_FILE.test(row.name);
  const Icon = code ? FileCode : FileText;
  const text = fragment ? snippet(isMarkdown(row.contentType, row.name) ? markdownToPlain(fragment) : fragment) : "";
  const quiet = row.status.tone === "success";
  return (
    <article data-document={row.nodeId} aria-current={selected ? "true" : undefined}
      className={`group relative flex gap-3 border-b border-kumo-fill px-4 py-3 last:border-b-0 ${selected ? "bg-kumo-tint" : "hover:bg-kumo-tint/60"}`}>
      <Icon size={20} className="mt-0.5 shrink-0 text-kumo-subtle" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-3">
          <button type="button" onClick={onOpen}
            className="m-0 min-w-0 flex-1 truncate bg-transparent p-0 text-left text-[15px] leading-5 font-medium text-kumo-default outline-none after:absolute after:inset-0 focus-visible:underline"><Highlight text={row.name} terms={terms} /></button>
          <span className="shrink-0 text-[13px] leading-5 text-kumo-subtle">
            {showProject && row.projectName}{showProject && at && ", "}{at && <time dateTime={at}>{relativeTime(at)}</time>}
          </span>
        </div>
        {folder && <div className="mt-0.5 truncate text-[13px] leading-[18px] text-kumo-subtle" title={folder}>{folder}</div>}
        {text && <p className={`mt-1 mb-0 line-clamp-2 text-kumo-default/85 [overflow-wrap:anywhere] ${code ? "font-mono text-[12.5px] leading-5" : "text-[14px] leading-5"}`}><Highlight text={text} terms={terms} /></p>}
        <div className={`mt-2 flex flex-wrap items-center gap-1 ${selected ? "" : "sr-only group-hover:not-sr-only group-focus-within:not-sr-only"}`}>
          <Button variant="secondary" size="sm" className="relative" onClick={onOpen}>Открыть</Button>
          <MaterialChatButtons onChat={onChat} />
        </div>
      </div>
      {!quiet && <div className="relative shrink-0"><StatusBadge tone={row.status.tone}>{row.status.label}</StatusBadge></div>}
    </article>
  );
}

export function MaterialChatButtons({ onChat }: { onChat(action: MaterialAction): void }) {
  return <>
    {/* relative поднимает кнопки над ссылкой строки, растянутой на всю строку. */}
    <Button variant="ghost" size="sm" className="relative" icon={ChatCircleText} onClick={() => onChat("ask")}>Спросить в беседе</Button>
    <Button variant="ghost" size="sm" className="relative" icon={ListChecks} onClick={() => onChat("task")}>Сделать задачу по документу</Button>
  </>;
}
