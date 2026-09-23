// Размышления модели показываются человеку на его языке (русском). Модели часто рассуждают
// по-английски, даже когда подсказка просит иначе, поэтому сервер переводит завершённые
// размышления, а интерфейс до прихода перевода показывает исходник свёрнутым.

/** Доля русских слов, начиная с которой текст считается русским. Считаются слова, а не буквы:
 * длинное английское имя функции в русской фразе не должно перевешивать её. */
export const RUSSIAN_WORD_SHARE = 0.5;

/** Код, пути и адреса не говорят о языке текста: при подсчёте букв они выбрасываются. */
function proseOnly(text: string): string {
  return text
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .replace(/`[^`\n]*`/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\S*[/\\]\S*/g, " ");
}

/** Текст уже по-русски (или в нём нет слов, которые стоит переводить). */
export function isMostlyRussian(text: string): boolean {
  let words = proseOnly(text).match(/\p{L}+/gu) ?? [];
  if (words.length === 0) return true;
  let russian = words.filter(word => /[\u0400-\u04FF]/.test(word)).length;
  return russian / words.length >= RUSSIAN_WORD_SHARE;
}

/** Что показать человеку из размышлений сообщения. */
export function reasoningForDisplay(message: {reasoning?: string; reasoningTranslation?: string}):
    {text: string; translated: boolean} | {pending: true; original: string} | null {
  let original = message.reasoning?.trim();
  if (!original) return null;
  if (message.reasoningTranslation?.trim()) return {text: message.reasoningTranslation, translated: true};
  if (isMostlyRussian(original)) return {text: original, translated: false};
  return {pending: true, original};
}
