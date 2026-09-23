import { test } from "node:test";
import assert from "node:assert/strict";
import { MnemosAPI, MnemosAPIError } from "./mnemos-api.ts";
import { inboxDecisions, inboxEntries, INBOX_FILTER } from "./inbox-count.ts";
import { checkedSharingSettings, validSharingSettings, validVisibilityResult, type ShareRequest } from "./project-sharing.ts";

const REQUEST: ShareRequest = { request_id: "r1", project_id: "p1", project_name: "Отчёты", level: "department", can_edit: false, org_unit_id: "u1", org_unit_name: "Продажи",
  requested_by: "anna", requested_by_name: "Анна", decider: "head", status: "pending", created_at: "2026-09-24T10:00:00Z" };
const SETTINGS = { personal_projects_enabled: true, project_create_by: "everyone", share_department_approval: "head", share_organization_by: "head", share_organization_approval: "none", default_visibility: "private" } as const;

function recording(reply: (path: string, init?: RequestInit) => unknown) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const api = new MnemosAPI("https://memory.example", async () => "human", async (url, init) => {
    const u = new URL(String(url));
    calls.push({ method: init?.method ?? "GET", path: u.pathname + u.search, body: init?.body ? JSON.parse(String(init.body)) : null });
    return Response.json(reply(u.pathname + u.search, init));
  });
  return { api, calls };
}

test("Поделиться: видимость проекта уходит на свою ручку, ответ сверяется с проектом", async () => {
  const { api, calls } = recording(() => ({ project_id: "p/1", visibility: "private", can_edit: false, applied: false, request: { ...REQUEST, project_id: "p/1" } }));
  const out = await api.setProjectVisibility("p/1", "department", false);
  assert.equal(out.applied, false);
  assert.equal(out.request?.requested_by_name, "Анна");
  assert.deepEqual(calls, [{ method: "POST", path: "/v1/projects/p%2F1/visibility", body: { level: "department", can_edit: false } }]);
  await assert.rejects(api.setProjectVisibility("p1", "everyone" as never, false), (e: unknown) => e instanceof MnemosAPIError && e.status === 400);
  assert.equal(calls.length, 1, "неизвестный уровень не уходит на сервер");
  // Чужой проект в ответе или неприменённое изменение без запроса — ошибка ответа, а не успех.
  const wrong = recording(() => ({ project_id: "other", visibility: "department", can_edit: false, applied: true }));
  await assert.rejects(wrong.api.setProjectVisibility("p1", "department", false), (e: unknown) => e instanceof MnemosAPIError && e.status === 502);
  assert.equal(validVisibilityResult({ project_id: "p1", visibility: "private", can_edit: false, applied: false }, "p1"), false);
});

test("Запросы руководителю: ждущие решения и мои, решение по одному запросу", async () => {
  const { api, calls } = recording(path => path.startsWith("/v1/share-requests/") ? { ...REQUEST, status: "approved", decided_by: "boss" } : path.includes("mine") ? { requests: null } : { requests: [REQUEST] });
  assert.deepEqual((await api.listShareRequests(false)).requests, [REQUEST]);
  assert.deepEqual((await api.listShareRequests(true)).requests, [], "null от сервера — пустой список");
  assert.equal((await api.decideShareRequest("r1", true)).status, "approved");
  assert.deepEqual(calls.map(c => [c.method, c.path, c.body]), [
    ["GET", "/v1/share-requests", null], ["GET", "/v1/share-requests?mine=true", null], ["POST", "/v1/share-requests/r1/decision", { approve: true }],
  ]);
  const broken = recording(() => ({ requests: [{ ...REQUEST, level: "world" }] }));
  await assert.rejects(broken.api.listShareRequests(false), (e: unknown) => e instanceof MnemosAPIError && e.status === 502);
  const other = recording(() => ({ ...REQUEST, request_id: "r2" }));
  await assert.rejects(other.api.decideShareRequest("r1", false), (e: unknown) => e instanceof MnemosAPIError && e.status === 502);
});

test("Правила организации: чтение, запись только известных полей и сверка ответа", async () => {
  const { api, calls } = recording((path, init) => init?.method === "PUT" ? JSON.parse(String(init.body)) : SETTINGS);
  assert.deepEqual(await api.readProjectSharingSettings(), SETTINGS);
  const changed = { ...SETTINGS, personal_projects_enabled: false, extra: "лишнее" } as never;
  assert.equal((await api.updateProjectSharingSettings(changed)).personal_projects_enabled, false);
  assert.deepEqual(calls[1], { method: "PUT", path: "/v1/organization/settings", body: { ...SETTINGS, personal_projects_enabled: false } });
  await assert.rejects(api.updateProjectSharingSettings({ ...SETTINGS, default_visibility: "world" } as never), (e: unknown) => e instanceof MnemosAPIError && e.status === 400);
  assert.equal(calls.length, 2);
  assert.equal(validSharingSettings({ ...SETTINGS, project_create_by: "nobody" }), false);
  assert.throws(() => checkedSharingSettings(null));
  const stale = recording(() => SETTINGS);
  await assert.rejects(stale.api.updateProjectSharingSettings({ ...SETTINGS, share_department_approval: "none" }), (e: unknown) => e instanceof MnemosAPIError && e.status === 502);
});

test("Входящие: запрос руководителю — решение вида «Доступ», решённые и свои не ждут", () => {
  const shares = [REQUEST, { ...REQUEST, request_id: "done", status: "approved" as const }, { ...REQUEST, request_id: "own", requested_by: "boss" }, REQUEST];
  const entries = inboxEntries({ reviews: [], collaborations: [], shares }, "boss");
  assert.deepEqual(entries.map(e => e.key), ["share/r1"]);
  assert.equal(INBOX_FILTER.share, "access");
  assert.equal(inboxDecisions([], [], "boss", { shares }), 1);
});
