import { test } from "node:test";
import assert from "node:assert/strict";
import { MnemosAPI, MnemosAPIError } from "./mnemos-api.ts";

const sha = "a".repeat(40);

function api(respond: (url: URL) => unknown, calls: URL[]) {
  return new MnemosAPI("https://memory.example", async () => "human-token", async (url, init) => {
    const u = new URL(String(url)); calls.push(u);
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer human-token");
    return Response.json(respond(u));
  });
}

test("Навигация по коду обращается к точным маршрутам с экранированными координатами", async () => {
  const calls: URL[] = [];
  const client = api(u => {
    if (u.pathname.endsWith("/tree")) return { repository_id: "1", commit_sha: sha, path: "a b", entries: [{ name: "x.go", path: "a b/x.go", type: "file", size_bytes: 3, sha }], truncated: false };
    if (u.pathname.endsWith("/branches")) return { repository_id: "1", branches: [{ name: "main", sha }] };
    if (u.pathname.endsWith("/log")) return { repository_id: "1", ref: "main", commits: [{ repository_id: "1", sha, message: "m", committed_at: "2026-09-23T00:00:00Z", parents: [] }] };
    if (u.pathname.endsWith("/compare")) return { repository_id: "1", base: "main", head: "agents/x", total_commits: 1, commits: [], commits_truncated: false, files: [{ path: "x.go", status: "added", additions: 1, deletions: 0 }], files_complete: true, diff: "", diff_truncated: false };
    return { project_id: "p/1", node_id: "", pending: false, children: [] };
  }, calls);
  await client.readGitTree("p/1", "internal-code", "1", sha, "a b");
  await client.readGitTree("p/1", "internal-code", "1", sha);
  await client.listGitBranches("p/1", "internal-code", "1", 2);
  await client.readGitLog("p/1", "internal-code", "1", "main", "x.go", 3);
  await client.compareGitRefs("p/1", "internal-code", "1", "main", "agents/x");
  await client.readProjectOverview("p/1");
  await client.readProjectOverview("p/1", "node");
  const base = "/v1/projects/p%2F1/git/internal-code/repositories/1";
  assert.deepEqual(calls.map(u => u.pathname + u.search), [
    `${base}/tree?commit=${sha}&path=a+b`,
    `${base}/tree?commit=${sha}`,
    `${base}/branches?page=2`,
    `${base}/log?ref=main&page=3&path=x.go`,
    `${base}/compare?base=main&head=agents%2Fx`,
    "/v1/projects/p%2F1/overview",
    "/v1/projects/p%2F1/overview?node=node",
  ]);
});

test("Ответ неверной формы не превращается в экран кода", async () => {
  const calls: URL[] = [];
  await assert.rejects(api(() => ({ entries: [{ name: "x", path: "x", type: "socket" }], commit_sha: sha }), calls).readGitTree("p", "c", "1", sha));
  await assert.rejects(api(() => ({ branches: "main" }), calls).listGitBranches("p", "c", "1"));
  await assert.rejects(api(() => ({ commits: [{}] }), calls).readGitLog("p", "c", "1", "main"));
  await assert.rejects(api(() => ({ files: [], commits: [] }), calls).compareGitRefs("p", "c", "1", "main", "x"), "дифф обязателен");
  await assert.rejects(api(() => ({ children: [] }), calls).readProjectOverview("p"), e => e instanceof MnemosAPIError && e.status === 502);
});

test("Отказ сервера в навигации передаётся как отказ, без текста сервера", async () => {
  const client = new MnemosAPI("https://memory.example", async () => "human-token", async () => new Response("internal secret", { status: 403 }));
  await assert.rejects(client.readGitTree("p", "c", "1", sha), e => e instanceof MnemosAPIError && e.status === 403 && !e.message.includes("secret"));
  await assert.rejects(client.readProjectOverview("p"), e => e instanceof MnemosAPIError && e.status === 403);
});
