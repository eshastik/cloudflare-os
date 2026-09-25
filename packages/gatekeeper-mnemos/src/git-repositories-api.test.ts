import { test } from "node:test";
import assert from "node:assert/strict";
import { MnemosAPI, MnemosAPIError } from "./mnemos-api.ts";
import { REPOSITORY_FAILURES } from "./git-repositories.ts";

const RECORD = { project_id: "p", connection_id: "github-app-7", repository_id: "42", repository_name: "org/site", source: "github_app", provider: "github", source_name: "org", branch: "main", private: true, agents: false, files: true, revision: 3, can_manage: true };

test("«Репозитории»: пути и тела запросов; негодные заявки отвергаются до сети", async () => {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const api = new MnemosAPI("https://memory.example", async () => "human", async (url, init) => {
    const u = new URL(String(url));
    calls.push({ method: String(init?.method), path: u.pathname + u.search, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (u.pathname === "/v1/git/repositories" && init?.method === "GET") return Response.json({ records: [{ ...RECORD, link: { link_id: "l1", project_id: "p", state: "ok" } }], internal: { available: true, revision: 2, can_disable: false }, app_configured: true, admin: false });
    if (u.pathname === "/v1/git/repositories") return Response.json({ record: RECORD, project: { id: "p", name: "Сайт" } });
    if (u.pathname.endsWith("/git/records")) return Response.json({ records: [RECORD] });
    if (u.pathname.endsWith("/capabilities")) return Response.json({ ...RECORD, agents: true, revision: 4 });
    return Response.json({ ok: true });
  });
  const overview = await api.listRepositoryOverview();
  assert.deepEqual(overview.records[0].link?.skipped, [], "пропуски по умолчанию — пустой список");
  assert.equal(overview.internal.can_disable, false);
  await api.addRepository({ name: " Сайт ", source: "app", installation_id: "7", repository_id: "42", repository_name: "org/site", files: true, agents: true, visibility: "department", consent: true });
  await api.listProjectRepositories("p");
  const on = await api.setRepositoryCapabilities("p", "github-app-7", "42", { expected_revision: 3, agents: true });
  assert.equal(on.agents, true);
  await api.detachRepository("p", "github-app-7", "42", 4);
  await api.resolveRevokedRepository("l1", false);
  await api.readGitOwnership("bob");
  await api.transferGitOwnership("bob", "carol");
  await api.disableInternalCodeHosting(2);
  assert.deepEqual(calls.map(c => `${c.method} ${c.path}`), [
    "GET /v1/git/repositories", "POST /v1/git/repositories", "GET /v1/projects/p/git/records", "PUT /v1/projects/p/git/github-app-7/repositories/42/capabilities",
    "POST /v1/projects/p/git/github-app-7/repositories/42/detach", "POST /v1/git/sync-links/l1/revoked", "GET /v1/people/bob/git-ownership",
    "POST /v1/people/bob/git-ownership/transfer", "POST /v1/git/internal/disable",
  ]);
  assert.deepEqual(calls[1].body, { name: "Сайт", source: "app", installation_id: "7", repository_id: "42", repository_name: "org/site", files: true, agents: true, visibility: "department", consent: true });
  assert.deepEqual(calls[5].body, { remove: false });

  const count = calls.length;
  const base = { repository_id: "42", repository_name: "org/site", files: true, agents: false } as const;
  await assert.rejects(api.addRepository({ ...base, source: "app", name: "Сайт" }), MnemosAPIError, "без установки");
  await assert.rejects(api.addRepository({ ...base, source: "connection", connection_id: "c", installation_id: "7", name: "Сайт" }), MnemosAPIError, "два входа сразу");
  await assert.rejects(api.addRepository({ ...base, source: "app", installation_id: "7" }), MnemosAPIError, "ни проекта, ни имени");
  await assert.rejects(api.addRepository({ ...base, files: false, source: "app", installation_id: "7", name: "Сайт" }), MnemosAPIError, "ничего не включено");
  await assert.rejects(api.setRepositoryCapabilities("p", "c", "42", { expected_revision: 3 }), MnemosAPIError, "пустое изменение");
  assert.throws(() => api.detachRepository("p", "c", "42", 0), MnemosAPIError);
  assert.equal(calls.length, count, "негодные заявки не ушли в сеть");
});

test("«Репозитории»: отказы приватности и прав приложения приходят словами — и 403, и 409", async () => {
  for (const [status, code] of [[409, "project.private_code_consent"], [403, "project.private_code_admin"], [409, "git_repo.app_permissions"], [409, "git_repo.files_unsupported"]] as const) {
    const api = new MnemosAPI("https://memory.example", async () => "human", async () => Response.json({ code, message: "server text" }, { status }));
    await assert.rejects(api.setRepositoryCapabilities("p", "c", "42", { expected_revision: 1, files: true }), (e: unknown) => e instanceof MnemosAPIError && e.status === status && e.code === code && e.message === REPOSITORY_FAILURES[code]);
  }
  // Отказы кода, которые раньше приходили общей фразой, теперь словами — и на 403, и на 404, и на 501.
  for (const [status, code] of [[403, "git_sync.forbidden"], [403, "git_sync.github_access_unconfirmed"], [409, "git_repo.not_revoked"], [409, "git_sync.duplicate"], [404, "git_repo.missing"], [501, "git_sync.unavailable"]] as const) {
    const api = new MnemosAPI("https://memory.example", async () => "human", async () => Response.json({ code, message: "server text" }, { status }));
    await assert.rejects(api.listRepositoryOverview(), (e: unknown) => e instanceof MnemosAPIError && e.status === status && e.code === code && e.message === REPOSITORY_FAILURES[code]);
  }
  assert.match(REPOSITORY_FAILURES["git_sync.github_access_unconfirmed"], /Нажмите «Обновить доступ»/);
  // Прочие 403 и 404 по-прежнему без подробностей.
  for (const status of [403, 404]) {
    const other = new MnemosAPI("https://memory.example", async () => "human", async () => Response.json({ code: "authz.access_denied", message: "x" }, { status }));
    await assert.rejects(other.listRepositoryOverview(), (e: unknown) => e instanceof MnemosAPIError && e.status === status && e.code === undefined);
  }
});

test("«Подключить внутреннее хранилище кода»: путь запроса, итог и отказ словами; негодный ответ отвергается", async () => {
  const answers: unknown[] = [
    { repository: { connection_id: "internal-code", repository_id: "88", repository_name: "projects/lev", commit_sha: "e".repeat(40), files: 3662, commits: 2, skipped_count: 0, skipped: [] } },
    { repository: null, reason: "Файлы проекта нельзя положить в хранилище кода: в проекте больше 20000 файлов." },
    { repository: null },
  ];
  const paths: string[] = [];
  const api = new MnemosAPI("https://memory.example", async () => "human", async (url, init) => {
    paths.push(`${init?.method} ${new URL(String(url)).pathname}`);
    return Response.json(answers.shift());
  });
  const ok = await api.connectCodeFromFiles("p");
  assert.equal(ok.repository?.files, 3662);
  assert.equal(ok.repository?.commits, 2);
  const refused = await api.connectCodeFromFiles("p");
  assert.equal(refused.repository, null);
  assert.match(refused.reason ?? "", /больше 20000 файлов/);
  await assert.rejects(api.connectCodeFromFiles("p"), (e: unknown) => e instanceof MnemosAPIError && e.status === 502, "отказ без причины — негодный ответ");
  assert.deepEqual(paths, ["POST /v1/projects/p/code/from-files", "POST /v1/projects/p/code/from-files", "POST /v1/projects/p/code/from-files"]);
  await assert.rejects(api.connectCodeFromFiles(".."), "негодный проект отвергается до сети");
  assert.equal(paths.length, 3);
});
