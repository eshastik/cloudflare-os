export const DEFAULT_WORKSPACE_TITLE = "Новая беседа";

export function isDefaultWorkspaceTitle(title: string): boolean {
  return [DEFAULT_WORKSPACE_TITLE, "Untitled Workspace", "Untitled Gadget"].includes(title);
}

/** Старые служебные имена переводятся при чтении без переименования пользовательских данных. */
export function displayWorkspaceTitle(title: string): string {
  return isDefaultWorkspaceTitle(title) ? DEFAULT_WORKSPACE_TITLE : title;
}

/** Название беседы или приложения от модели: без кавычек и переносов, не длиннее 80 знаков и
 *  по-русски (хотя бы половина слов кириллицей; названия продуктов латиницей допустимы).
 *  null — модель ответила не по-русски, такое название не показываем. */
export function russianTitle(raw: string): string | null {
  let title = raw.replace(/[\r\n]+/g, " ").trim().replace(/^[«"'`]+|[»"'`.]+$/g, "").trim();
  if (title.length > 80) title = title.slice(0, 79).trimEnd() + "…";
  let words = title.match(/\p{L}+/gu) ?? [];
  if (!words.length) return null;
  let russian = words.filter(word => /[\u0400-\u04FF]/.test(word)).length;
  return russian > 0 && russian * 2 >= words.length ? title : null;
}
