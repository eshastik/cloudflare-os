// Ответ агента (Markdown) → сообщения Telegram (HTML, не длиннее 4096 знаков).
//
// Telegram понимает узкое подмножество HTML: b, i, s, u, code, pre, blockquote. Остальное
// экранируется. Текст сначала режется на куски по границам абзацев и строк (блок кода, попавший на
// границу, открывается в следующем куске снова), потом каждый кусок переводится в HTML отдельно — так
// тег никогда не разрывается между сообщениями. Если разметка всё же не разобралась Telegram,
// вызывающий повторяет тот же кусок простым текстом (`plain`).

import { MAX_MESSAGE } from "./bot-api";

/** Запас на рост при переводе в HTML: экранирование и теги длиннее разметки Markdown. */
const SOURCE_CHUNK = 3000;

export type TelegramChunk = { html: string | null; plain: string };

function escape(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttribute(text: string): string {
  return escape(text).replaceAll("\"", "&quot;");
}

/** Строчная разметка: `код`, **жирный**, *курсив* / _курсив_, ~~зачёркнутый~~, [текст](https://…). */
function inline(text: string): string {
  let out = "";
  let pattern = /`([^`\n]+)`|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*\n]+)\*\*|__([^_\n]+)__|~~([^~\n]+)~~|\*([^*\n]+)\*|(?<![\p{L}\p{N}])_([^_\n]+)_(?![\p{L}\p{N}])/gu;
  let last = 0;
  for (let match of text.matchAll(pattern)) {
    out += escape(text.slice(last, match.index));
    let [, code, linkText, url, bold, bold2, strike, italic, italic2] = match;
    if (code !== undefined) out += `<code>${escape(code)}</code>`;
    // Адрес ссылки виден целиком: текст ссылки мог написать кто угодно (внедрение инструкций через
    // документ), и человек должен видеть, куда ведёт ссылка. Telegram сам делает адрес ссылкой.
    else if (url !== undefined) out += `${inline(linkText)} (${escape(url)})`;
    else if (bold !== undefined || bold2 !== undefined) out += `<b>${inline(bold ?? bold2)}</b>`;
    else if (strike !== undefined) out += `<s>${inline(strike)}</s>`;
    else out += `<i>${inline(italic ?? italic2)}</i>`;
    last = match.index + match[0].length;
  }
  return out + escape(text.slice(last));
}

/** Markdown одного куска → HTML Telegram. */
export function markdownToTelegramHtml(markdown: string): string {
  let lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  let out: string[] = [];
  let quote: string[] = [];
  let flushQuote = () => {
    if (quote.length) out.push(`<blockquote>${quote.join("\n")}</blockquote>`);
    quote = [];
  };
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    let fence = /^\s*```\s*([\w+-]*)\s*$/.exec(line);
    if (fence) {
      flushQuote();
      let body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) body.push(lines[i++]);
      let language = fence[1] ? ` class="language-${escapeAttribute(fence[1])}"` : "";
      out.push(`<pre><code${language}>${escape(body.join("\n"))}</code></pre>`);
      continue;
    }
    let quoted = /^\s*>\s?(.*)$/.exec(line);
    if (quoted) { quote.push(inline(quoted[1])); continue; }
    flushQuote();
    let heading = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) { out.push(`<b>${inline(heading[1])}</b>`); continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { out.push("———"); continue; }
    let bullet = /^(\s*)[-*+]\s+(.*)$/.exec(line);
    if (bullet) { out.push(`${bullet[1]}• ${inline(bullet[2])}`); continue; }
    out.push(inline(line));
  }
  flushQuote();
  return out.join("\n");
}

/** Markdown без разметки: то, что уйдёт простым текстом, если Telegram не принял HTML. */
function plainOf(markdown: string): string {
  return markdown.replace(/^\s*```[\w+-]*\s*$/gm, "").trim() || markdown.trim();
}

/** Жёсткая нарезка по длине: последний запасной путь для очень длинной строки. */
function hardSplit(text: string, size: number): string[] {
  let parts: string[] = [];
  for (let start = 0; start < text.length; start += size) {
    let end = Math.min(text.length, start + size);
    // Не рвём суррогатную пару (эмодзи и редкие символы).
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    parts.push(text.slice(start, end));
    start = end - size;
  }
  return parts.filter(part => part.length > 0);
}

/** Куски исходного Markdown: по абзацам, затем по строкам; блок кода на границе продолжается в следующем куске. */
function splitMarkdown(markdown: string, size: number): string[] {
  let lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  let chunks: string[] = [];
  let current: string[] = [];
  let length = 0;
  let fence: string | null = null;
  // Незакрытый блок кода перевод в HTML закрывает сам; в следующем куске он открывается заново.
  let flush = () => {
    if (!current.length) return;
    chunks.push(current.join("\n"));
    current = fence !== null ? [fence] : [];
    length = current.reduce((sum, line) => sum + line.length + 1, 0);
  };
  for (let line of lines) {
    let pieces = line.length > size ? hardSplit(line, size) : [line];
    for (let piece of pieces) {
      if (length + piece.length + 1 > size && current.length) flush();
      current.push(piece);
      length += piece.length + 1;
    }
    let marker = /^\s*```/.exec(line);
    if (marker) fence = fence === null ? line : null;
  }
  // Незакрытый блок кода в конце ответа закроет перевод в HTML.
  if (current.length) chunks.push(current.join("\n"));
  return chunks.filter(chunk => chunk.replace(/^\s*```[\w+-]*\s*$/gm, "").trim());
}

/** Ответ агента → сообщения Telegram не длиннее 4096 знаков. html: null — кусок уходит простым текстом. */
export function telegramChunks(markdown: string): TelegramChunk[] {
  let result: TelegramChunk[] = [];
  let convert = (source: string, size: number) => {
    let html = markdownToTelegramHtml(source);
    let plain = plainOf(source);
    if (html.length <= MAX_MESSAGE && plain.length <= MAX_MESSAGE) { result.push({ html, plain }); return; }
    // Экранирование раздуло кусок (много «<» и «&»): режем мельче, в крайнем случае — простым текстом.
    if (size > 500) { for (let part of splitMarkdown(source, Math.floor(size / 2))) convert(part, Math.floor(size / 2)); return; }
    for (let part of hardSplit(plain, MAX_MESSAGE)) result.push({ html: null, plain: part });
  };
  for (let source of splitMarkdown(markdown, SOURCE_CHUNK)) convert(source, SOURCE_CHUNK);
  return result;
}
