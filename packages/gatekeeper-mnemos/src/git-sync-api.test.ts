import { test } from "node:test";
import assert from "node:assert/strict";
import { MnemosAPI, MnemosAPIError } from "./mnemos-api.ts";

test("синхронизация с GitHub: пути, тела и отказ неполных заявок до сети", async () => {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const api = new MnemosAPI("https://memory.example", async () => "human", async (url, init) => {
    const u = new URL(String(url));
    calls.push({ method: String(init?.method), path: u.pathname + u.search, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (u.pathname.endsWith("/sync") || u.pathname === "/v1/git/sync-links" && init?.method === "GET") return Response.json({ links: [{ link_id: "l1", project_id: "p", state: "ok", repository_name: "org/site" }] });
    return Response.json({ queued: true });
  });
  const page = await api.listGitSyncLinks();
  assert.deepEqual(page.links[0].include, []);
  assert.equal(page.links[0].report.added, 0);
  assert.deepEqual(page.links[0].report.conflict_paths, []);
  await api.listProjectGitSync("p/x");
  await api.createGitSyncLink({ project_id: "p", source: "app", installation_id: "7", repository_id: "42", repository_name: "org/site", branch: "main", folder: "Код", include: ["docs/**"], exclude: [], visibility: "department" });
  await api.updateGitSyncLink("l1", { expected_revision: 2, branch: "dev", folder: "", include: [], exclude: ["*.lock"] });
  await api.deleteGitSyncLink("l1", 3);
  await api.refreshGitSyncLink("l1");
  await api.listGitAppRepositories();
  assert.deepEqual(calls.map(c => `${c.method} ${c.path}`), [
    "GET /v1/git/sync-links", "GET /v1/projects/p%2Fx/git/sync", "POST /v1/git/sync-links", "PUT /v1/git/sync-links/l1",
    "DELETE /v1/git/sync-links/l1?expected_revision=3", "POST /v1/git/sync-links/l1/refresh", "GET /v1/git/app/repositories",
  ]);
  assert.equal((calls[2].body as { installation_id: string }).installation_id, "7");

  const base = { project_id: "p", repository_id: "42", repository_name: "org/site", branch: "main", folder: "", include: [], exclude: [] };
  assert.throws(() => api.createGitSyncLink({ ...base, source: "app" }), MnemosAPIError);
  assert.throws(() => api.createGitSyncLink({ ...base, source: "connection", connection_id: "c", installation_id: "7" }), MnemosAPIError);
  assert.throws(() => api.createGitSyncLink({ ...base, source: "app", installation_id: "7", folder: "a/../b" }), MnemosAPIError);
  assert.throws(() => api.createGitSyncLink({ ...base, source: "app", installation_id: "7", branch: " " }), MnemosAPIError);
  assert.throws(() => api.deleteGitSyncLink("l1", 0), MnemosAPIError);
  assert.equal(calls.length, 7);
});

test("ответ без списка связей отвергается", async () => {
  const api = new MnemosAPI("https://memory.example", async () => "human", async () => Response.json({ links: [{ state: "ok" }] }));
  await assert.rejects(api.listGitSyncLinks(), (e: unknown) => e instanceof MnemosAPIError && e.status === 502);
});
