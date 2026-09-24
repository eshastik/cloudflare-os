import { Fragment, type ReactNode } from "react";

/**
 * Небольшой рендер Markdown без зависимостей: текст разбирается в дерево и строится из React-элементов,
 * поэтому HTML из документа выводится как обычный текст и не исполняется.
 * Поддержано то, что пишут люди и агенты в заметках: заголовки, абзацы, списки, цитаты, код, таблицы,
 * жирный, курсив, зачёркнутый, код в строке и ссылки.
 */

type Inline =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "strong" | "em" | "del"; children: Inline[] }
  | { kind: "link"; href: string; children: Inline[] }
  | { kind: "break" };

type Block =
  | { kind: "heading"; level: number; children: Inline[] }
  | { kind: "paragraph"; children: Inline[] }
  | { kind: "code"; text: string }
  | { kind: "quote"; blocks: Block[] }
  | { kind: "list"; ordered: boolean; start: number; items: Block[][] }
  | { kind: "table"; head: Inline[][]; rows: Inline[][][] }
  | { kind: "rule" };

/** Markdown ли документ: по типу содержимого или по расширению имени. */
export function isMarkdown(contentType?: string, name?: string): boolean {
  if (contentType && /^text\/(x-)?markdown(\s*;|$)/i.test(contentType)) return true;
  return !!name && /\.(md|markdown)$/i.test(name.trim());
}

/** Ссылка открывается только по сетевому адресу или почте; прочие схемы (javascript:, data:) остаются текстом. */
export function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (/[\u0000-\u001f\s]/.test(href)) return null;
  return /^(https?:\/\/|mailto:)/i.test(href) ? href : null;
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const HEADING = /^\s{0,3}(#{1,6})(?:\s+(.*?))?\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>\s?/;
const BULLET = /^(\s*)[-*+]\s+(.*)$/;
const NUMBERED = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

function startsBlock(line: string): boolean {
  return FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || BULLET.test(line) || NUMBERED.test(line);
}

function tableCells(line: string): string[] {
  let body = line.trim();
  if (body.startsWith("|")) body = body.slice(1);
  if (body.endsWith("|") && !body.endsWith("\\|")) body = body.slice(0, -1);
  const cells: string[] = [];
  let cell = "";
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "\\" && body[i + 1] === "|") { cell += "|"; i++; continue; }
    if (body[i] === "|") { cells.push(cell.trim()); cell = ""; continue; }
    cell += body[i];
  }
  cells.push(cell.trim());
  return cells;
}

function parseBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1];
      const body: string[] = [];
      i++;
      while (i < lines.length && !new RegExp(`^\\s{0,3}${marker[0] === "`" ? "`" : "~"}{${marker.length},}\\s*$`).test(lines[i])) body.push(lines[i++]);
      i++;
      blocks.push({ kind: "code", text: body.join("\n") });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length, children: parseInline(heading[2] ?? "") });
      i++;
      continue;
    }

    if (RULE.test(line)) { blocks.push({ kind: "rule" }); i++; continue; }

    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && lines[i].trim() && (QUOTE.test(lines[i]) || !startsBlock(lines[i]))) body.push(lines[i++].replace(QUOTE, ""));
      blocks.push({ kind: "quote", blocks: parseBlocks(body) });
      continue;
    }

    const bullet = BULLET.exec(line), numbered = NUMBERED.exec(line);
    if (bullet || numbered) {
      const ordered = !bullet;
      const baseIndent = (bullet ?? numbered)![1].length;
      const items: string[][] = [];
      while (i < lines.length) {
        const current = lines[i];
        const b = BULLET.exec(current), n = NUMBERED.exec(current);
        const marker = ordered ? n : b;
        if (marker && marker[1].length <= baseIndent + 1) {
          items.push([ordered ? n![3] : b![2]]);
          i++;
          continue;
        }
        if (!current.trim()) {
          // Пустая строка внутри списка: список продолжается, если дальше идёт вложенная строка или новый пункт.
          const next = lines[i + 1] ?? "";
          const nextMarker = ordered ? NUMBERED.exec(next) : BULLET.exec(next);
          if (next.trim() && (/^\s{2,}/.test(next) || (nextMarker && nextMarker[1].length <= baseIndent + 1))) { items.at(-1)!.push(""); i++; continue; }
          break;
        }
        // Вложенные строки (с отступом) и продолжение текста пункта относятся к последнему пункту.
        if (/^\s{2,}/.test(current) && current.search(/\S/) > baseIndent) { items.at(-1)!.push(current.slice(Math.min(current.search(/\S/), baseIndent + 2))); i++; continue; }
        if (!startsBlock(current)) { items.at(-1)!.push(current); i++; continue; }
        break;
      }
      blocks.push({ kind: "list", ordered, start: numbered ? Number(numbered[2]) : 1, items: items.map(item => parseBlocks(item)) });
      continue;
    }

    if (line.includes("|") && i + 1 < lines.length && TABLE_SEPARATOR.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      const head = tableCells(line).map(parseInline);
      const rows: Inline[][][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes("|")) rows.push(tableCells(lines[i++]).map(parseInline));
      blocks.push({ kind: "table", head, rows });
      continue;
    }

    const body: string[] = [];
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i])) body.push(lines[i++]);
    const children: Inline[] = [];
    body.forEach((text, index) => {
      // Два пробела или обратная черта в конце строки — явный перенос; иначе строки абзаца склеиваются пробелом.
      const hard = /( {2,}|\\)$/.test(text);
      children.push(...parseInline(text.replace(/( {2,}|\\)$/, "").trim()));
      if (index < body.length - 1) children.push(hard ? { kind: "break" } : { kind: "text", text: " " });
    });
    blocks.push({ kind: "paragraph", children });
  }
  return blocks;
}

const ESCAPABLE = /[\\`*_{}[\]()#+\-.!|~>]/;

function parseInline(source: string): Inline[] {
  const out: Inline[] = [];
  let text = "";
  const flush = () => { if (text) { out.push({ kind: "text", text }); text = ""; } };
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\" && ESCAPABLE.test(source[i + 1] ?? "")) { text += source[i + 1]; i += 2; continue; }
    if (ch === "`") {
      const run = /^`+/.exec(source.slice(i))![0];
      const end = source.indexOf(run, i + run.length);
      if (end > 0) { flush(); out.push({ kind: "code", text: source.slice(i + run.length, end).trim() }); i = end + run.length; continue; }
      text += run; i += run.length; continue;
    }
    if (ch === "[") {
      const link = /^\[((?:[^[\]\\]|\\.)*)\]\(\s*<?([^\s()<>]*)>?(?:\s+["'][^"']*["'])?\s*\)/.exec(source.slice(i));
      if (link) {
        flush();
        const href = safeHref(link[2]);
        const children = parseInline(link[1]);
        if (href) out.push({ kind: "link", href, children }); else out.push(...children);
        i += link[0].length;
        continue;
      }
    }
    if (ch === "<") {
      const auto = /^<((?:https?:\/\/|mailto:)[^\s<>]+)>/i.exec(source.slice(i));
      if (auto) { flush(); out.push({ kind: "link", href: auto[1], children: [{ kind: "text", text: auto[1] }] }); i += auto[0].length; continue; }
    }
    const pair = source.slice(i, i + 2);
    if (pair === "**" || pair === "__" || pair === "~~") {
      const end = source.indexOf(pair, i + 2);
      if (end > i + 2 && source[i + 2] !== " ") {
        flush();
        out.push({ kind: pair === "~~" ? "del" : "strong", children: parseInline(source.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if ((ch === "*" || ch === "_") && source[i + 1] !== ch && source[i + 1] && source[i + 1] !== " ") {
      // Подчёркивание внутри слова (snake_case) курсивом не считается.
      const opensWord = ch === "*" || i === 0 || !/[\p{L}\p{N}]/u.test(source[i - 1]);
      let end = -1;
      for (let j = i + 1; j < source.length; j++) {
        if (source[j] === "\\") { j++; continue; }
        if (source[j] === ch && source[j + 1] !== ch && source[j - 1] !== " " && source[j - 1] !== ch
          && (ch === "*" || j + 1 >= source.length || !/[\p{L}\p{N}]/u.test(source[j + 1]))) { end = j; break; }
      }
      if (opensWord && end > i + 1) {
        flush();
        out.push({ kind: "em", children: parseInline(source.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    text += ch;
    i++;
  }
  flush();
  return out;
}

export function parseMarkdown(source: string): Block[] {
  return parseBlocks(source.replace(/\r\n?/g, "\n").split("\n"));
}

function inlineText(nodes: Inline[]): string {
  return nodes.map(node => node.kind === "text" || node.kind === "code" ? node.text : node.kind === "break" ? " " : inlineText(node.children)).join("");
}

function blockText(blocks: Block[]): string[] {
  return blocks.flatMap(block => {
    switch (block.kind) {
      case "heading": case "paragraph": return [inlineText(block.children)];
      case "code": return [block.text];
      case "quote": return blockText(block.blocks);
      case "list": return block.items.flatMap(item => blockText(item));
      case "table": return [block.head, ...block.rows].map(row => row.map(inlineText).join(" "));
      case "rule": return [];
    }
  });
}

/** Плоский текст без разметки: для коротких фрагментов в карточках. */
export function markdownToPlain(source: string): string {
  return blockText(parseMarkdown(source)).filter(Boolean).join(" ");
}

function renderInline(nodes: Inline[]): ReactNode[] {
  return nodes.map((node, index) => {
    switch (node.kind) {
      case "text": return <Fragment key={index}>{node.text}</Fragment>;
      case "code": return <code key={index} className="rounded-[6px] bg-kumo-tint px-1 font-mono text-[0.92em]">{node.text}</code>;
      case "strong": return <strong key={index} className="font-semibold">{renderInline(node.children)}</strong>;
      case "em": return <em key={index}>{renderInline(node.children)}</em>;
      case "del": return <del key={index}>{renderInline(node.children)}</del>;
      case "link": return <a key={index} href={node.href} target="_blank" rel="noopener noreferrer" className="text-kumo-link underline">{renderInline(node.children)}</a>;
      case "break": return <br key={index} />;
    }
  });
}

const HEADING_CLASS = ["", "text-[20px] leading-7", "text-[17px] leading-6", "text-[15px] leading-6", "text-[14px] leading-5", "text-[14px] leading-5", "text-[13px] leading-5"];

function renderBlocks(blocks: Block[]): ReactNode[] {
  return blocks.map((block, index) => {
    switch (block.kind) {
      case "heading": {
        const Tag = `h${block.level}` as "h1";
        return <Tag key={index} className={`mt-4 mb-2 font-semibold text-kumo-strong first:mt-0 ${HEADING_CLASS[block.level]}`}>{renderInline(block.children)}</Tag>;
      }
      case "paragraph": return <p key={index} className="my-2 first:mt-0 last:mb-0">{renderInline(block.children)}</p>;
      case "code": return <pre key={index} className="my-2 overflow-auto rounded-[8px] bg-kumo-tint p-2 font-mono text-[12.5px] leading-5 whitespace-pre"><code>{block.text}</code></pre>;
      case "quote": return <blockquote key={index} className="my-2 border-l-2 border-kumo-fill-hover pl-3 text-kumo-subtle">{renderBlocks(block.blocks)}</blockquote>;
      case "rule": return <hr key={index} className="my-3 border-kumo-fill" />;
      case "list": {
        const items = block.items.map((item, n) => <li key={n} className="my-0.5 [&>p]:my-0">{renderBlocks(item)}</li>);
        return block.ordered
          ? <ol key={index} start={block.start === 1 ? undefined : block.start} className="my-2 list-decimal pl-6">{items}</ol>
          : <ul key={index} className="my-2 list-disc pl-6">{items}</ul>;
      }
      case "table": return (
        <div key={index} className="my-2 overflow-auto">
          <table className="border-collapse text-[13px]">
            <thead><tr>{block.head.map((cell, n) => <th key={n} className="border border-kumo-fill px-2 py-1 text-left font-semibold">{renderInline(cell)}</th>)}</tr></thead>
            <tbody>{block.rows.map((row, r) => <tr key={r}>{row.map((cell, n) => <td key={n} className="border border-kumo-fill px-2 py-1 align-top">{renderInline(cell)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      );
    }
  });
}

/** Оформленный Markdown: элементы строятся из разобранного дерева, сырой HTML остаётся текстом. */
export function Markdown({ text, className = "" }: { text: string; className?: string }) {
  return <div data-markdown="" className={`[overflow-wrap:anywhere] ${className}`}>{renderBlocks(parseMarkdown(text))}</div>;
}
