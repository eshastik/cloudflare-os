import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { REPOSITORY_FAILURES } from "./git-repositories.ts";
import { FOLDER_HAS_DRAFTS, FOLDER_REMOVED, GIT_FAILURE_CODES } from "./mnemos-api.ts";

// Коды отказа, которые сервер Mnemos отдаёт интерфейсу на маршрутах /v1/git/…, /v1/projects/{p}/git/…,
// /v1/projects/{p}/code/…, /v1/projects/{p}/visibility и отказ «папка удалена» публикации. Перечень ОБЯЗАН совпадать с файлом сервера
// services/storage-api/internal/httpapi/testdata/interface_failure_codes.txt: там его сверяет с обработчиками
// TestInterfaceFailureCodesAreListedForTheInterface. Здесь — что у каждого кода есть текст для человека.
const SERVER_CODES = [
  "code_project.files_rejected",
  "git.merge.no_approver", "git.merge.not_approved", "git.merge.not_ready", "git.merge.not_responsible", "git.merge.revert_conflict", "git.merge.revert_unsupported", "git.merge.stale",
  "git.unavailable", "git.write_unconfirmed",
  "git_repo.app_permissions", "git_repo.files_unsupported", "git_repo.internal_admin_only", "git_repo.missing", "git_repo.not_revoked", "git_repo.owner_active", "git_repo.source_disabled", "git_repo.stale",
  "git_sync.connect_unconfigured", "git_sync.duplicate", "git_sync.forbidden", "git_sync.github_access_unconfirmed", "git_sync.github_missing", "git_sync.github_not_connected",
  "git_sync.invalid", "git_sync.missing", "git_sync.project_create_forbidden", "git_sync.repository", "git_sync.signature", "git_sync.stale", "git_sync.unavailable",
  "project.personal_disabled", "project.private_code_admin", "project.private_code_consent", "project.share_forbidden", "project.share_no_department", "project.sharing_settings_invalid",
  // Удаление папки с неопубликованными черновиками — текст собирает folderHasDraftsMessage.
  "node.folder_has_drafts",
  // Публикация документа, чью папку удалили до запрета, — текст собирает folderRemovedMessage.
  "publication.folder_removed",
];

test("каждый код отказа сервера на маршрутах кода и видимости имеет текст для человека", () => {
  const texts = new Set<string>([...Object.keys(REPOSITORY_FAILURES), ...GIT_FAILURE_CODES, FOLDER_REMOVED, FOLDER_HAS_DRAFTS]);
  const missing = SERVER_CODES.filter(code => !texts.has(code)).sort();
  assert.deepEqual(missing, [], "коды без текста");
  // Лишний текст — код, которого сервер на этих маршрутах не отдаёт: сверяются множества, а не количество.
  const server = new Set(SERVER_CODES);
  assert.deepEqual(Object.keys(REPOSITORY_FAILURES).filter(code => !server.has(code)).sort(), [], "тексты для кодов, которых сервер не отдаёт");
  assert.equal(new Set(SERVER_CODES).size, SERVER_CODES.length, "повтор в перечне");
  for (const [code, text] of Object.entries(REPOSITORY_FAILURES)) assert.match(text, /[а-яё]/i, `текст ${code} — по-русски`);
});

// Серверный перечень — рядом с форком (../../../mnemos от пакета) или по MNEMOS_REPO. Сверяются множества:
// код, который сервер отдаёт, а форк не знает, — красный тест; нет серверного перечня — тест явно пропущен.
const PACKAGE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_LIST = join(process.env.MNEMOS_REPO ? resolve(process.env.MNEMOS_REPO) : resolve(PACKAGE, "../../../mnemos"), "services/storage-api/internal/httpapi/testdata/interface_failure_codes.txt");

test("перечень кодов форка совпадает с серверным перечнем", t => {
  if (!existsSync(SERVER_LIST)) { t.skip(`пропущено: нет серверного перечня (${SERVER_LIST})`); return; }
  const server = readFileSync(SERVER_LIST, "utf8").split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#")).sort();
  assert.deepEqual([...SERVER_CODES].sort(), server, "перечень кодов разошёлся с сервером");
});
