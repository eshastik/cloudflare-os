import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

const converter = new TurndownService({
  headingStyle: "atx", bulletListMarker: "-", codeBlockStyle: "fenced",
});
converter.use(gfm);
converter.remove(["script", "style", "iframe", "object", "noscript"]);
converter.addRule("safeLinks", {
  filter: "a",
  replacement: (content, node) => {
    const href = (node as HTMLElement).getAttribute("href") ?? "";
    return /^(https?:|mailto:)/i.test(href)
      ? `[${content}](<${href.replace(/[<>\r\n]/g, "")}>)`
      : content;
  },
});
// Изображения из HTML не загружаем по внешнему адресу: файлы вставляются штатным загрузчиком.
converter.addRule("imageAlt", {
  filter: "img", replacement: (_content, node) => (node as HTMLElement).getAttribute("alt") ?? "",
});

/** Форматированный буфер превращается в тот же Markdown, который хранится в сообщении. */
export function composerClipboardText(plain: string, html: string): string {
  let fence: string | null = null;
  const plainMarkdown = plain.split("\n").map(line => {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      return line;
    }
    return fence || /^( {4}|\t)/.test(line) ? line : line.replace(/^([ \t]*)[•◦▪‣]\s+/, "$1- ");
  }).join("\n");
  if (!html || /^https?:\/\/\S+$/.test(plain.trim())) return plainMarkdown;
  // template не подключается к странице: вставленный HTML не исполняется и не загружает ресурсы.
  const template = document.createElement("template");
  template.innerHTML = html;
  const root = template.content;
  for (const el of root.querySelectorAll<HTMLElement>("[style]")) {
    // Google Docs оборачивает весь фрагмент в <b style="font-weight:normal">.
    if (el.tagName === "B" && /^(normal|400)$/.test(el.style.fontWeight)) {
      el.replaceWith(...el.childNodes);
      continue;
    }
    for (const [tag, active] of [
      ["strong", /^(bold|[6-9]00)$/.test(el.style.fontWeight)],
      ["em", el.style.fontStyle === "italic"],
      ["del", el.style.textDecorationLine.includes("line-through")],
    ] as const) {
      if (!active || el.tagName.toLowerCase() === tag) continue;
      const wrapper = document.createElement(tag);
      wrapper.append(...el.childNodes);
      el.append(wrapper);
    }
  }
  if (!root.querySelector("ul, ol, h1, h2, h3, h4, h5, h6, strong, b, em, i, del, s, pre, code, blockquote, table, a")) return plainMarkdown;
  for (const table of root.querySelectorAll("table")) {
    // Excel копирует первую строку как td, а Markdown требует строку заголовков.
    const row = table.querySelector("tr");
    for (const cell of row?.querySelectorAll("td") ?? []) {
      const heading = document.createElement("th");
      heading.append(...cell.childNodes);
      cell.replaceWith(heading);
    }
  }
  return converter.turndown(root).trim() || plainMarkdown;
}

/** Сохраняет штатную отмену вставки там, где браузер поддерживает insertText. */
export function insertComposerText(textarea: HTMLTextAreaElement, text: string): void {
  // Блочный Markdown посреди фразы иначе превращается в обычный текст или блок кода.
  if (/^(?: {0,3}(?:[-*+] |\d+[.)] |#{1,6} |>|```|~~~)|\|)/m.test(text)) {
    const before = textarea.value.slice(0, textarea.selectionStart);
    const after = textarea.value.slice(textarea.selectionEnd);
    if (before && !before.endsWith("\n\n")) text = (before.endsWith("\n") ? "\n" : "\n\n") + text;
    if (after && !after.startsWith("\n\n")) text += after.startsWith("\n") ? "\n" : "\n\n";
  }
  textarea.focus();
  if (typeof document.execCommand === "function" && document.execCommand("insertText", false, text)) return;
  textarea.setRangeText(text, textarea.selectionStart, textarea.selectionEnd, "end");
}
