// Раздел «Репозитории» (сервер: services/storage-api/internal/app/git_repository_records.go, миграция 0164).
// Репозиторий в проекте — одна запись с двумя возможностями: «Файлы в проекте» (синхронизация из GitHub)
// и «Агенты кода» (агенты в своих ветках, в основную — после «Принять»). Обе опираются на один источник доступа.
import type { GitSyncLink } from "./mnemos-api.ts";

export type RepositorySource = "github_app" | "internal" | "key";
export type RepositoryVisibility = "private" | "department" | "organization";

export interface RepositorySkip { path: string; reason: "binary" | "large" | string }
export type RepositoryLink = GitSyncLink & { paused?: boolean; access_revoked?: boolean; remove_requested?: boolean; skipped?: RepositorySkip[] };

export interface RepositoryRecord {
  project_id: string;
  connection_id: string;
  repository_id: string;
  repository_name: string;
  source: RepositorySource;
  provider: string;
  installation_id?: string;
  /** Аккаунт или название подключения словами. */
  source_name: string;
  branch: string;
  private: boolean;
  agents: boolean;
  files: boolean;
  revision: number;
  created_by?: string;
  created_at?: string;
  can_manage: boolean;
  /** Чей доступ к источнику держит «Агентов кода». */
  access_owner?: string;
  /** Агенты включены, но GitHub больше не открывает репозиторий этому человеку: агенты не работают. */
  agents_access_revoked?: boolean;
  link?: RepositoryLink;
}

export interface RepositoryOverview {
  records: RepositoryRecord[];
  internal: { available: boolean; connection_id?: string; revision?: number; can_disable: boolean };
  app_configured: boolean;
  admin: boolean;
}

export interface RepositoryInput {
  /** Пусто вместе с name — «Создать проект». */
  project_id?: string;
  name?: string;
  source: "app" | "connection";
  installation_id?: string;
  connection_id?: string;
  repository_id: string;
  repository_name: string;
  branch?: string;
  folder?: string;
  include?: string[];
  exclude?: string[];
  visibility?: RepositoryVisibility;
  files: boolean;
  agents: boolean;
  /** Человек подтвердил, что код приватного репозитория увидят все, кому открыт проект. */
  consent?: boolean;
}

export interface RepositoryResult { project?: { id: string; name: string; visibility?: string }; record: RepositoryRecord; message?: string }
export interface CapabilityChange { expected_revision: number; files?: boolean; agents?: boolean; consent?: boolean }
export interface GitOwnership { connections: { connection_id: string; provider: string; name: string; account_login: string; installation_id?: string }[]; links: RepositoryRecord[] }
export interface GitOwnershipTransfer { connections: number; links: number; installations: number }

/** Отказы раздела словами: интерфейс узнаёт их по тексту, коды через фрейм не проходят. */
export const REPOSITORY_FAILURES = {
  "project.private_code_consent": "Код приватного репозитория увидят все, кому открыт проект. Подтвердите это.",
  "project.private_code_admin": "Приватный код открывает всей организации только администратор.",
  "git_repo.app_permissions": "У приложения Mnemos в GitHub нет права записи: агенты кода через него не работают. Владелец приложения добавляет в настройках GitHub App права Contents и Pull requests — «Read and write», владелец аккаунта GitHub подтверждает их. Либо подключите ключ доступа GitHub в «Дополнительно».",
  "git_repo.files_unsupported": "Файлы в проект переносятся только из GitHub. Код этого репозитория доступен агентам и на странице проекта.",
  "git_repo.internal_admin_only": "Внутреннее хранилище кода отключает только администратор организации.",
  "git_repo.stale": "Репозиторий изменился. Обновите страницу и повторите.",
  "git_repo.source_disabled": "Источник этого репозитория отключён.",
  "git_repo.owner_active": "Сотрудник ещё работает в организации: его источники кода передаются только после удаления из организации.",
} as const;
export type RepositoryFailureCode = keyof typeof REPOSITORY_FAILURES;
export const REPOSITORY_FAILURE_CODES = Object.keys(REPOSITORY_FAILURES) as RepositoryFailureCode[];

export function checkedRepositoryOverview(value: unknown): RepositoryOverview {
  const page = value as Partial<RepositoryOverview> | null;
  if (!page || !Array.isArray(page.records) || page.records.some(r => !r || typeof r.project_id !== "string" || typeof r.connection_id !== "string" || typeof r.repository_id !== "string" || typeof r.revision !== "number")) throw new Error("Invalid repository overview");
  const internal = page.internal && typeof page.internal === "object" ? page.internal : { available: false, can_disable: false };
  return { records: page.records.map(checkedRecord), internal: { available: !!internal.available, connection_id: internal.connection_id, revision: internal.revision, can_disable: !!internal.can_disable }, app_configured: !!page.app_configured, admin: !!page.admin };
}

export function checkedRecord(r: RepositoryRecord): RepositoryRecord {
  const link = r.link ? { ...r.link, include: r.link.include ?? [], exclude: r.link.exclude ?? [], skipped: r.link.skipped ?? [] } : undefined;
  return { ...r, source_name: r.source_name ?? "", branch: r.branch ?? "", link };
}

/** «Подключить внутреннее хранилище кода» к проекту с уже загруженными файлами. repository — заведённый
 * репозиторий; null — отказ, причина словами в reason (как repository_error у проекта из папки). */
export interface CodeFromFilesResult {
  repository: { connection_id: string; repository_id: string; repository_name: string; commit_sha: string; files: number; commits: number; skipped_count: number; skipped: { path: string; reason: "large" | "path" | string }[] } | null;
  reason?: string;
}

export function checkedCodeFromFiles(value: unknown): CodeFromFilesResult {
  const v = value as Partial<CodeFromFilesResult> | null;
  const r = v?.repository;
  if (!v || (r !== null && (!r || typeof r.repository_id !== "string" || typeof r.repository_name !== "string" || typeof r.connection_id !== "string" || typeof r.files !== "number"))
    || (r === null && (typeof v.reason !== "string" || !v.reason || v.reason.length > 1000))) throw new Error("Invalid code from files answer");
  return r ? { repository: { ...r, skipped: Array.isArray(r.skipped) ? r.skipped : [], skipped_count: r.skipped_count ?? 0, commits: r.commits ?? 1 } } : { repository: null, reason: v.reason };
}
