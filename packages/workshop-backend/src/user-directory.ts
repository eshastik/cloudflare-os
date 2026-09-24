// Справочник пользователей установки для подсказок в окне «Поделиться».
//
// Учётные записи живут в отдельных объектах пользователей, перечислить их нельзя. Поэтому каждый
// пользователь при входе один раз вносит в справочник своё имя входа и отображаемое имя (и заново —
// после смены имени), а вошедший через Mnemos — ещё и свой принципал Mnemos, чтобы его можно было
// склеить с человеком из списка Mnemos. Справочник — второй источник подсказок: первый — люди
// Mnemos того, кто делится (rankInvitees), они видны сразу, до чьего-либо входа.

import type { CollaboratorRole } from "@gadgets/workshop-shared/api";
import type { MnemosPeople } from "./mnemos-people.js";

/** mnemos — организация и принципал Mnemos этого пользователя, если он входил через Mnemos. */
export type DirectoryEntry = { id: string; name: string; mnemos?: { tenant: string; principal: string } };
/** department — отдел из Mnemos (вторая строка подсказки). */
export type Invitee = { id: string; name: string; email?: string; department?: string };

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
  return found.slice(0, MAX_INVITEES).map(p => ({ id: p.id, name: p.name, ...(p.email ? { email: p.email } : {}),
    ...(p.department ? { department: p.department } : {}) }));
}

/**
 * Профиль приглашённого, который ещё ни разу не входил в оболочку: только почта сотрудника, которую
 * Mnemos того, кто делится, отдал вместе с человеком, и только если при входе эта почта станет
 * именем входа (без привязки LOGIN_ALIASES — привязанная входит в уже существующую учётную запись).
 */
export function notYetSignedInProfile(username: string, mnemos: MnemosPeople | null, aliases: Map<string, string>)
    : { type: "user"; id: string; name: string } | null {
  const email = username.trim().toLowerCase();
  if (email !== username || !email.includes("@") || loginForEmail(email, aliases) !== email) return null;
  const person = mnemos?.people.find(p => p.email === email);
  return person ? { type: "user", id: email, name: person.name } : null;
}

/** Имя входа оболочки для почты: привязка LOGIN_ALIASES или сама почта (как при входе через Mnemos). */
export function loginForEmail(email: string, aliases: Map<string, string>): string {
  const key = email.trim().toLowerCase();
  return aliases.get(key) ?? key;
}

/**
 * Подсказки из двух источников: люди Mnemos того, кто делится, и справочник входивших в оболочку.
 * Один человек — одна подсказка: запись справочника склеивается с человеком Mnemos по почте
 * (имя входа или привязка LOGIN_ALIASES) либо по принципалу Mnemos, записанному при входе.
 *
 * id — то, что принимает addCollaborator: имя входа из справочника, а для ещё не входившего —
 * почта из Mnemos (или её привязка). Человек Mnemos без почты и без записи в справочнике не
 * предлагается: пригласить его не на что.
 *
 * Почта в подсказке — только если Mnemos показывает почты этому человеку (управляющий
 * сотрудниками); без подключения Mnemos почт в подсказках нет вовсе.
 */
export function rankInvitees(input: {
  query: string
  directory: Iterable<DirectoryEntry>
  aliases: Map<string, string>
  mnemos: MnemosPeople | null
  exclude: ReadonlySet<string>
  limit?: number
}): Invitee[] {
  const q = lower(input.query.trim());
  if (!q) return [];
  const aliasEmail = new Map<string, string>();
  for (const [email, name] of input.aliases) if (!aliasEmail.has(name)) aliasEmail.set(name, email);
  const entryEmail = (entry: DirectoryEntry) => aliasEmail.get(entry.id) ?? (entry.id.includes("@") ? lower(entry.id) : undefined);

  const directory = [...input.directory];
  const byEmail = new Map<string, DirectoryEntry>();
  const byPrincipal = new Map<string, DirectoryEntry>();
  for (const entry of directory) {
    const email = entryEmail(entry);
    if (email) byEmail.set(email, entry);
    if (input.mnemos && entry.mnemos?.tenant === input.mnemos.tenant) byPrincipal.set(entry.mnemos.principal, entry);
  }

  type Candidate = { id: string; name: string; names: string[]; email?: string; department?: string };
  const candidates = new Map<string, Candidate>();
  for (const person of input.mnemos?.people ?? []) {
    const entry = (person.email ? byEmail.get(person.email) : undefined) ?? byPrincipal.get(person.principal);
    const id = entry?.id ?? (person.email ? loginForEmail(person.email, input.aliases) : undefined);
    if (!id || candidates.has(id)) continue;
    candidates.set(id, {
      id, name: person.name, names: entry && entry.name !== person.name ? [person.name, entry.name] : [person.name],
      email: person.email ?? (entry ? entryEmail(entry) : undefined), department: person.departments[0],
    });
  }
  for (const entry of directory) {
    if (candidates.has(entry.id)) continue;
    candidates.set(entry.id, { id: entry.id, name: entry.name, names: [entry.name], email: entryEmail(entry) });
  }

  const showEmail = input.mnemos?.manager === true;
  const ranked: { rank: number; invitee: Invitee }[] = [];
  for (const c of candidates.values()) {
    if (input.exclude.has(c.id)) continue;
    const names = c.names.map(lower);
    const rank = names.some(n => n.startsWith(q)) ? 0
      : names.some(n => n.split(/[\s.\-_]+/).some(word => word.startsWith(q))) ? 1
      : lower(c.id).startsWith(q) || (c.email !== undefined && c.email.startsWith(q)) ? 2
      : -1;
    if (rank < 0) continue;
    ranked.push({ rank, invitee: { id: c.id, name: c.name,
      ...(showEmail && c.email ? { email: c.email } : {}),
      ...(c.department ? { department: c.department } : {}) } });
  }
  ranked.sort((a, b) => a.rank - b.rank || a.invitee.name.localeCompare(b.invitee.name, "ru"));
  return ranked.slice(0, input.limit ?? MAX_INVITEES).map(r => r.invitee);
}
