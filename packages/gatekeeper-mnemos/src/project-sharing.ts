/** Видимость проекта: кому он виден, кроме тех, кому права выданы явно. */
export const PROJECT_VISIBILITIES = ["private", "department", "organization"] as const;
export type ProjectVisibility = typeof PROJECT_VISIBILITIES[number];

/** Правила организации о создании проектов и их видимости. */
export interface ProjectSharingSettings {
  personal_projects_enabled: boolean;
  project_create_by: "everyone" | "heads" | "admins";
  share_department_approval: "head" | "none";
  share_organization_by: "head" | "admin";
  share_organization_approval: "none" | "admin";
  default_visibility: ProjectVisibility;
}

/** Запрос на расширение видимости проекта, который решает руководитель отдела или администратор. */
export interface ShareRequest {
  request_id: string;
  project_id: string;
  project_name: string;
  level: ProjectVisibility;
  can_edit: boolean;
  org_unit_id?: string;
  org_unit_name?: string;
  requested_by: string;
  requested_by_name: string;
  decider: "head" | "admin";
  status: "pending" | "approved" | "rejected" | "superseded";
  decided_by?: string;
  created_at: string;
  decided_at?: string;
}

/** Итог просьбы изменить видимость: применено сразу или ждёт решения. */
export interface ProjectVisibilityResult {
  project_id: string;
  visibility: ProjectVisibility;
  can_edit: boolean;
  applied: boolean;
  request?: ShareRequest;
}

const oneOf = <T extends string>(value: unknown, allowed: readonly T[]): value is T => typeof value === "string" && (allowed as readonly string[]).includes(value);
const text = (value: unknown, max = 1024): value is string => typeof value === "string" && value.length <= max;

export function isProjectVisibility(value: unknown): value is ProjectVisibility {
  return oneOf(value, PROJECT_VISIBILITIES);
}

/** Неизвестное значение — отказ, а не молчаливое «по умолчанию»: так же поступает сервер. */
export function validSharingSettings(value: unknown): value is ProjectSharingSettings {
  if (!value || typeof value !== "object") return false;
  const s = value as Record<string, unknown>;
  return typeof s.personal_projects_enabled === "boolean"
    && oneOf(s.project_create_by, ["everyone", "heads", "admins"] as const)
    && oneOf(s.share_department_approval, ["head", "none"] as const)
    && oneOf(s.share_organization_by, ["head", "admin"] as const)
    && oneOf(s.share_organization_approval, ["none", "admin"] as const)
    && isProjectVisibility(s.default_visibility);
}

/** Копия только известных полей: лишнее из ответа или из интерфейса дальше не уходит. */
export function checkedSharingSettings(value: unknown): ProjectSharingSettings {
  if (!validSharingSettings(value)) throw new TypeError("Invalid project sharing settings");
  return { personal_projects_enabled: value.personal_projects_enabled, project_create_by: value.project_create_by, share_department_approval: value.share_department_approval,
    share_organization_by: value.share_organization_by, share_organization_approval: value.share_organization_approval, default_visibility: value.default_visibility };
}

export function validShareRequest(value: unknown): value is ShareRequest {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return text(r.request_id, 255) && !!r.request_id && text(r.project_id, 255) && !!r.project_id && text(r.project_name) && isProjectVisibility(r.level)
    && typeof r.can_edit === "boolean" && (r.org_unit_id === undefined || text(r.org_unit_id, 255)) && (r.org_unit_name === undefined || text(r.org_unit_name))
    && text(r.requested_by, 255) && text(r.requested_by_name) && oneOf(r.decider, ["head", "admin"] as const)
    && oneOf(r.status, ["pending", "approved", "rejected", "superseded"] as const) && (r.decided_by === undefined || text(r.decided_by, 255))
    && text(r.created_at, 64) && (r.decided_at === undefined || text(r.decided_at, 64));
}

export function validVisibilityResult(value: unknown, project: string): value is ProjectVisibilityResult {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return r.project_id === project && isProjectVisibility(r.visibility) && typeof r.can_edit === "boolean" && typeof r.applied === "boolean"
    && (r.request === undefined || r.request === null || validShareRequest(r.request) && r.request.project_id === project)
    // Неприменённое изменение обязано нести запрос: иначе человеку нечего ждать.
    && (r.applied || validShareRequest(r.request));
}

/** Уровень видимости словами, как его видит человек. */
export const VISIBILITY_TITLES: Record<ProjectVisibility, string> = { private: "Только я", department: "Мой отдел", organization: "Вся организация" };
