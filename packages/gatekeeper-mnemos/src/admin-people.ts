/** Личность привязана к устойчивому идентификатору провайдера, не к почте. */
export interface AdminPerson { userName: string; externalId: string; displayName: string; active?: boolean }
export interface AdminPersonCreate { issuer: string; user: AdminPerson }
export interface AdminPeopleResult { total: number; created: number; updated: number; reactivated: string[] }
export interface AdminRight { kind: "anchor" | "capability"; principal_id: string; project_id?: string; node_id?: string; class?: "filesystem" | "database"; mode?: "read" | "write"; functional_role_id?: string; capability?: string }
export interface AdminRights { principal_id: string; exists: boolean; deactivated: boolean; rights: AdminRight[] }
/** Полный набор осей сохраняется при выдаче и отзыве; область относится к ресурсу. */
export function checkedAdminRight(input: AdminRight): AdminRight {
  if (!input || typeof input.principal_id !== "string" || !input.principal_id.trim()) throw Error("Укажите человека.");
  if (input.kind === "capability") {
    if (!input.capability) throw Error("Укажите полномочие.");
    return {kind: input.kind, principal_id: input.principal_id, capability: input.capability};
  }
  if (input.kind !== "anchor" || !input.project_id || !["filesystem", "database"].includes(input.class ?? "") || !["read", "write"].includes(input.mode ?? "")) throw Error("Проверьте проект, класс ресурса и действие.");
  return {kind: "anchor", principal_id: input.principal_id, project_id: input.project_id, node_id: input.node_id ?? "", class: input.class, mode: input.mode, functional_role_id: input.functional_role_id ?? ""};
}
