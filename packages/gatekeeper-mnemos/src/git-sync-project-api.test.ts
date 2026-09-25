import { test } from "node:test";
import assert from "node:assert/strict";
import { MnemosAPI, MnemosAPIError } from "./mnemos-api.ts";

test("«Создать проект» из репозитория: одна заявка на сервер, имя обрезано, неполная заявка не уходит", async () => {
  const calls: { method: string; path: string; body: Record<string, unknown> }[] = [];
  const api = new MnemosAPI("https://memory.example", async () => "human", async (url, init) => {
    const u = new URL(String(url));
    calls.push({ method: String(init?.method), path: u.pathname, body: JSON.parse(String(init?.body)) });
    return Response.json({ project: { id: "p-new", name: "org/site" }, link: { link_id: "l1", project_id: "p-new", state: "pending" } });
  });
  const base = { source: "app" as const, installation_id: "7", repository_id: "42", repository_name: "org/site", branch: "trunk", folder: "", include: [], exclude: ["tests/**"], visibility: "private" as const };
  const out = await api.createProjectFromRepository({ ...base, name: "  Сайт  " });
  assert.equal(out.project.id, "p-new");
  assert.deepEqual(calls.map(c => `${c.method} ${c.path}`), ["POST /v1/git/sync-projects"]);
  assert.equal(calls[0].body.name, "Сайт");
  assert.equal(calls[0].body.branch, "trunk");
  assert.equal("project_id" in calls[0].body, false);

  assert.throws(() => api.createProjectFromRepository({ ...base, name: "   " }), MnemosAPIError);
  assert.throws(() => api.createProjectFromRepository({ ...base, name: "я".repeat(200) }), MnemosAPIError);
  assert.throws(() => api.createProjectFromRepository({ ...base, name: "Сайт", installation_id: "" }), MnemosAPIError);
  assert.throws(() => api.createProjectFromRepository({ ...base, name: "Сайт", exclude: [" "] }), MnemosAPIError);
  assert.equal(calls.length, 1);
});
