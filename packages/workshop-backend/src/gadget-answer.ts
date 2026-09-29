// Ответ агента кода в задаче гаджета: код гаджета закрыт (ADR 0028, п. 4), поэтому до человека и агента
// беседы не доходят блоки кода длиннее пяти строк и строки, совпадающие с кодом последней сборки.
// Правило в AGENTS.md агента кода — первая линия; это — вторая, на сервере.

export const GADGET_CODE_HIDDEN = "(код гаджета не показывается)";
/** Блок в тройных кавычках длиннее этого числа строк скрывается целиком. */
const MAX_BLOCK_LINES = 5;
/** Строка или встроенный фрагмент короче этого не сверяется с кодом: совпадения слов не в счёт. */
const MIN_FRAGMENT = 40;

const norm = (text: string) => text.replace(/\s+/g, " ").trim();

export function hideGadgetCode(answer: string, codeText = ""): string {
  // Незакрытый блок (ответ оборвался) — до конца текста.
  let text = answer.replace(/```[^\n]*\n([\s\S]*?)(?:```|$)/g, (block, body: string) => {
    let lines = body.replace(/\n$/, "").split("\n");
    return lines.length > MAX_BLOCK_LINES ? GADGET_CODE_HIDDEN : block;
  });
  let code = norm(codeText);
  if (code.length < MIN_FRAGMENT) return text;
  let known = (fragment: string) => { let n = norm(fragment); return n.length >= MIN_FRAGMENT && code.includes(n); };
  let out: string[] = [];
  for (let line of text.split("\n")) {
    let content = line.replace(/^\s*(?:[-*>]|\d+\.)\s+/, "");
    if (known(content)) {
      if (out[out.length - 1] !== GADGET_CODE_HIDDEN) out.push(GADGET_CODE_HIDDEN);
      continue;
    }
    out.push(line.replace(/`([^`\n]+)`/g, (span, inner: string) => known(inner) ? GADGET_CODE_HIDDEN : span));
  }
  return out.join("\n");
}
