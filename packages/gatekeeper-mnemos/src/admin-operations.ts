/** Ограниченное предложение агента: проект либо доступ существующего человека к файлам. */
export type AdminOperationRequest =
  | {kind: "create_project"; name: string; slug: string}
  | {kind: "grant_project_access"; person: string; project: string; domain?: string; mode: "read" | "write"};

/** Состояние сохраняется сервером вместе с результатом исполнения. */
export interface AdminOperation {
  request_id: string;
  request: AdminOperationRequest;
  summary: string;
  state: "pending" | "approved" | "rejected" | "applied";
  result?: Record<string, string>;
}

/** Отсекает дополнительные поля, чтобы описание и исполняемое тело совпадали. */
export function checkedAdminOperation(input: AdminOperationRequest): AdminOperationRequest {
  if (!input || typeof input !== "object") throw new Error("Не указано действие Mnemos.");
  const text = (value: unknown, label: string, empty = false) => {
    if (typeof value !== "string" || (!empty && !value) || value.trim() !== value || new TextEncoder().encode(value).length > 255 || /[\u0000-\u001f]/.test(value)) throw new Error(`Некорректное значение: ${label}.`);
    return value;
  };
  if (input.kind === "create_project") {
    if (Object.keys(input).some(k => !["kind", "name", "slug"].includes(k))) throw new Error("Лишние параметры создания проекта.");
    const name = text(input.name, "название проекта"), slug = text(input.slug, "краткое имя");
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(slug)) throw new Error("Краткое имя проекта должно содержать латинские буквы, цифры и дефисы.");
    return {kind: input.kind, name, slug};
  }
  if (input.kind !== "grant_project_access" || (input.mode !== "read" && input.mode !== "write") || Object.keys(input).some(k => !["kind", "person", "project", "domain", "mode"].includes(k))) throw new Error("Недопустимое назначение доступа.");
  const domain = input.domain === undefined ? "" : text(input.domain, "предметная область", true);
  return {kind: input.kind, person: text(input.person, "сотрудник"), project: text(input.project, "проект"), ...(domain ? {domain} : {}), mode: input.mode};
}
