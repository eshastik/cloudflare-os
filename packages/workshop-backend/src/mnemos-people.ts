// Люди организации из Mnemos для подсказок «Поделиться».
//
// Список берётся подключением Mnemos того, кто делится, и ровно в том объёме, какой Mnemos отдаёт
// этому человеку: администратору — все сотрудники и все отделы, остальным — их собственные отделы.
// Почты Mnemos в перечне людей не отдаёт никому (ADR 0020 Mnemos); почта известна только из
// принятых приглашений, а их видят администратор и руководитель своего отдела.

export type MnemosPerson = {
  /** Идентификатор принципала в организации Mnemos. */
  principal: string;
  name: string;
  /** Названия отделов человека; первым идёт отдел, где он руководитель. */
  departments: string[];
  /** Почта входа из принятого приглашения, в нижнем регистре; только если Mnemos её отдал. */
  email?: string;
};

export type MnemosPeople = {
  /** Организация и принципал того, чьим подключением собран список. */
  tenant: string;
  self: string;
  /** Может ли этот человек управлять сотрудниками в Mnemos (полномочие principal.manage). */
  manager: boolean;
  people: MnemosPerson[];
};

/** Та часть сеанса управления Mnemos, которой пользуются подсказки: только чтение. */
export type MnemosPeopleUi = {
  listPeople(): Promise<{ users?: unknown }>;
  listOrgUnits(): Promise<unknown>;
  listInvitations(): Promise<unknown>;
};

/** Больше стольких людей не берём: подсказке длинный хвост не нужен, а память объекта конечна. */
export const MAX_MNEMOS_PEOPLE = 5000;

const text = (value: unknown, max = 320): value is string => typeof value === "string" && value.length > 0 && value.length <= max;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Организация и принципал подключения Mnemos по его uniqueName. Формат задаёт гейткипер Mnemos
 * (organizationAccountName): JSON-массив [организация, принципал] или [адрес, организация, принципал].
 */
export function mnemosAccountOwner(uniqueName: unknown): { tenant: string; principal: string } | null {
  if (typeof uniqueName !== "string") return null;
  let parsed: unknown;
  try { parsed = JSON.parse(uniqueName); } catch { return null; }
  if (!Array.isArray(parsed) || (parsed.length !== 2 && parsed.length !== 3) || !parsed.every(p => text(p, 512))) return null;
  return { tenant: parsed[parsed.length - 2] as string, principal: parsed[parsed.length - 1] as string };
}

/**
 * Собрать людей организации из сеанса управления. Отказ Mnemos в одном из списков (нет права)
 * не мешает остальным: сотрудник без права администратора получает людей своих отделов.
 */
export async function collectMnemosPeople(ui: MnemosPeopleUi, owner: { tenant: string; principal: string }): Promise<MnemosPeople> {
  const [people, units, invitations] = await Promise.allSettled([ui.listPeople(), ui.listOrgUnits(), ui.listInvitations()]);
  const byPrincipal = new Map<string, MnemosPerson>();
  const inactive = new Set<string>();
  const person = (principal: string, name: string) => {
    let found = byPrincipal.get(principal);
    if (!found && byPrincipal.size < MAX_MNEMOS_PEOPLE) byPrincipal.set(principal, found = { principal, name, departments: [] });
    if (found && !found.name && name) found.name = name;
    return found;
  };

  const manager = people.status === "fulfilled";
  if (people.status === "fulfilled" && Array.isArray(people.value?.users)) {
    for (const user of people.value.users as { userName?: unknown; displayName?: unknown; active?: unknown }[]) {
      if (!text(user?.userName, 255)) continue;
      if (user.active === false) { inactive.add(user.userName); continue; }
      person(user.userName, text(user.displayName, 255) ? user.displayName : "");
    }
  }

  if (units.status === "fulfilled" && Array.isArray(units.value)) {
    for (const unit of units.value as { name?: unknown; members?: unknown }[]) {
      if (!text(unit?.name, 255) || !Array.isArray(unit.members)) continue;
      for (const member of unit.members as { principal_id?: unknown; display_name?: unknown; is_head?: unknown }[]) {
        if (!text(member?.principal_id, 255) || inactive.has(member.principal_id)) continue;
        // Администратору перечень людей уже известен целиком: отдел не добавляет в него новых людей.
        if (manager && !byPrincipal.has(member.principal_id)) continue;
        const found = person(member.principal_id, text(member.display_name, 255) ? member.display_name : "");
        if (!found || found.departments.includes(unit.name)) continue;
        if (member.is_head === true) found.departments.unshift(unit.name); else found.departments.push(unit.name);
      }
    }
  }

  if (invitations.status === "fulfilled" && Array.isArray(invitations.value)) {
    for (const invitation of invitations.value as { status?: unknown; email?: unknown; accepted_by?: unknown }[]) {
      if (invitation?.status !== "accepted" || !text(invitation.accepted_by, 255) || !text(invitation.email)) continue;
      const email = invitation.email.trim().toLowerCase();
      const found = byPrincipal.get(invitation.accepted_by);
      if (found && !found.email && EMAIL.test(email)) found.email = email;
    }
  }

  byPrincipal.delete(owner.principal);
  return {
    tenant: owner.tenant,
    self: owner.principal,
    manager,
    people: [...byPrincipal.values()].filter(p => p.name),
  };
}
