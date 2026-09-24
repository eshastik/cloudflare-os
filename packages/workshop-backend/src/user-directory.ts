// Справочник пользователей установки для подсказок в окне «Поделиться».
//
// Учётные записи живут в отдельных объектах пользователей, перечислить их нельзя. Поэтому каждый
// пользователь при входе один раз вносит в справочник своё имя входа и отображаемое имя (и заново —
// после смены имени). Справочник даёт только эти два поля и почту из LOGIN_ALIASES: больше подсказке
// не нужно, а приглашение всё равно проверяет учётную запись по имени входа.

import type { CollaboratorRole } from "@gadgets/workshop-shared/api";

export type DirectoryEntry = { id: string; name: string };
export type Invitee = { id: string; name: string; email?: string };

/** Не больше стольких подсказок за запрос. */
export const MAX_INVITEES = 8;
/** Длина запроса: подсказка ищет по началу, длинные строки ничего не добавляют. */
export const MAX_INVITEE_QUERY = 100;

const lower = (value: string) => value.toLocaleLowerCase("ru-RU");

/**
 * Люди, у которых имя (любое слово), имя входа или почта начинаются с запроса. Сначала совпадения
 * по началу полного имени, затем по слову имени, затем по имени входа или почте; внутри — по алфавиту.
 * aliases — почта → имя входа (LOGIN_ALIASES): по ней ищут и её показывают.
 */
export function matchDirectory(entries: Iterable<DirectoryEntry>, query: string, aliases: Map<string, string>,
    exclude: ReadonlySet<string>, limit = MAX_INVITEES): Invitee[] {
  const q = lower(query.trim());
  if (!q) return [];
  const emails = new Map<string, string>();
  for (const [email, name] of aliases) if (!emails.has(name)) emails.set(name, email);
  const ranked: { rank: number; invitee: Invitee }[] = [];
  for (const entry of entries) {
    if (exclude.has(entry.id)) continue;
    const name = lower(entry.name), id = lower(entry.id);
    const email = emails.get(entry.id) ?? (entry.id.includes("@") ? entry.id : undefined);
    const rank = name.startsWith(q) ? 0
      : name.split(/[\s.\-_]+/).some(word => word.startsWith(q)) ? 1
      : id.startsWith(q) || (email !== undefined && lower(email).startsWith(q)) ? 2
      : -1;
    if (rank < 0) continue;
    ranked.push({ rank, invitee: { id: entry.id, name: entry.name, ...(email && email !== entry.id ? { email } : {}) } });
  }
  ranked.sort((a, b) => a.rank - b.rank || a.invitee.name.localeCompare(b.invitee.name, "ru"));
  return ranked.slice(0, limit).map(r => r.invitee);
}

/**
 * Подсказки для «Поделиться»: только тому, кто сам может приглашать в это рабочее место, и без тех,
 * у кого доступ уже есть. canShare бросает для человека без права делиться.
 */
export async function findInvitees(deps: {
  query: unknown
  canShare(): CollaboratorRole
  prohibited: boolean
  existing: Iterable<string>
  search(query: string, exclude: string[]): Promise<Invitee[]>
}): Promise<Invitee[]> {
  if (typeof deps.query !== "string" || deps.query.length > MAX_INVITEE_QUERY) throw new Error("Invalid query.");
  deps.canShare();
  const query = deps.query.trim();
  if (!query || deps.prohibited) return [];
  const found = await deps.search(query, [...new Set(deps.existing)]);
  return found.slice(0, MAX_INVITEES).map(p => ({ id: p.id, name: p.name, ...(p.email ? { email: p.email } : {}) }));
}
