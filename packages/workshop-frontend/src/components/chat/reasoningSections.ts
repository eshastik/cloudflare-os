// Размышления модели приходят блоками «**Заголовок**\n\nабзац», но блоки часто склеены: заголовок
// следующего прилипает к концу предыдущего абзаца («…содержимое.**Проверка документа**» или, после
// перевода, «…содержимое.Проверка документа\n\n»). Здесь блоки разводятся по заголовкам.

export type ReasoningSection = { title?: string; body: string };

/** Разрыв перед заголовком, приклеенным к концу предыдущего предложения. */
export function separateReasoningBlocks(text: string): string {
  return text
    .replace(/([.!?…:»)\]])\*\*(?=[^*\n]{2,120}\*\*)/g, "$1\n\n**")
    // Заголовок без разметки: после точки сразу фраза с заглавной буквы, без точки в конце и с пустой строкой после.
    .replace(/([а-яёa-z0-9)»][.!?…])([А-ЯЁA-Z][^\n.!?*]{2,100})\n\n/g, "$1\n\n**$2**\n\n");
}

export function reasoningSections(text: string): ReasoningSection[] {
  const sections: ReasoningSection[] = [];
  let current: ReasoningSection | null = null;
  for (const line of separateReasoningBlocks(text).split("\n")) {
    const heading = /^\s*\*\*([^*]+?)\*\*\s*$/.exec(line);
    if (heading) {
      if (current) sections.push(current);
      current = { title: heading[1].trim(), body: "" };
      continue;
    }
    current ??= { body: "" };
    current.body += `${line}\n`;
  }
  if (current) sections.push(current);
  return sections
    .map(section => ({ ...section, body: section.body.trim() }))
    .filter(section => section.title || section.body);
}
