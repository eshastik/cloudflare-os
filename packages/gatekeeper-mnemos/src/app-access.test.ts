import { test } from "node:test";
import assert from "node:assert/strict";
import { MnemosAPIError } from "./mnemos-api.ts";
import { APP_ACCESS_DENIED, APP_MIME, appAccess, appDirectory, type AppAccessSession } from "./app-access.ts";
import { mnemosNodeFormatOfMime } from "@gadgets/workshop-shared/native-document";

const HEAD = "a".repeat(64);
const denied = (status: number) => async () => { throw new MnemosAPIError(status); };

/** Сессия Mnemos одного человека: что вернули бы приглашения, свой черновик и общая версия. */
function session(overrides: Partial<AppAccessSession> = {}) {
  const calls: string[] = [];
  const base: AppAccessSession = {
    whoAmI: async () => { calls.push("whoAmI"); return { subject: { tenant_id: "org", user_id: "anna" }, tenant_name: "Орг" }; },
    listInvitedDocuments: async () => { calls.push("invited"); return { documents: [], next_cursor: "" }; },
    listSharedDocuments: async () => { calls.push("shared"); return []; },
    openDraft: async () => { calls.push("openDraft"); return {}; },
    readDraftDocument: async () => { calls.push("draft"); throw new MnemosAPIError(404); },
    nodeHistory: async () => { calls.push("history"); throw new MnemosAPIError(403); },
    listProjects: async () => { calls.push("projects"); return { projects: [{ id: "p" }] }; },
    listOrgUnits: async () => { calls.push("units"); return [{ org_unit_id: "u1", name: "Продажи", members: [{ principal_id: "anna", display_name: "Анна", is_head: false }, { principal_id: "boris", display_name: "Борис", is_head: true }] }]; },
  };
  const wrapped = Object.fromEntries(Object.entries({ ...base, ...overrides }).map(([name, fn]) => [name, async (...args: unknown[]) => { if (overrides[name as keyof AppAccessSession]) calls.push(name); return (fn as (...a: unknown[]) => unknown)(...args); }])) as AppAccessSession;
  return { session: wrapped, calls };
}
const invited = (mode: "read" | "write", content_type = APP_MIME) => ({
  listInvitedDocuments: async () => ({ documents: [{ node_id: "n", name: "Список", content_type, head: HEAD, owner_id: "owner" }], next_cursor: "" }),
  listSharedDocuments: async () => [{ project_id: "p", project_name: "П", node_id: "n", owner_id: "owner", owner_name: "Владелец", granted_by_name: "Владелец", name: "Список", content_type, head: HEAD, mode, granted_at: "", seen: true }],
});

test("тип содержимого узла приложения распознаётся как формат оболочки", () => {
  assert.equal(mnemosNodeFormatOfMime(APP_MIME), "cloudflareos.app");
  assert.equal(mnemosNodeFormatOfMime("application/vnd.cloudflareos.document+json"), "cloudflareos.document");
  assert.equal(mnemosNodeFormatOfMime("application/json"), null);
  assert.equal(mnemosNodeFormatOfMime("application/vnd.cloudflareos.app+json; x"), null);
});

test("участник узла: право — из приглашения, правка или чтение", async () => {
  assert.equal((await appAccess(session(invited("write")).session, "p", "n", false)).access, "edit");
  assert.equal((await appAccess(session(invited("read")).session, "p", "n", false)).access, "read");
  // Приглашение к документу, а не к приложению, права на приложение не даёт.
  await assert.rejects(appAccess(session(invited("write", "application/vnd.cloudflareos.document+json")).session, "p", "n", false), new RegExp(APP_ACCESS_DENIED));
  // Приглашение есть, а в «Поделились с вами» его уже нет (отозвано) — отказ.
  await assert.rejects(appAccess(session({ ...invited("write"), listSharedDocuments: async () => [] }).session, "p", "n", false), new RegExp(APP_ACCESS_DENIED));
});

test("свой черновик с узлом: правка; при первом открытии черновик открывается и читаются имя и организация", async () => {
  const own = session({ readDraftDocument: async () => ({ head: HEAD, node_id: "n", exists: true, content_type: APP_MIME, conflicted: false, terms: [] }) });
  assert.deepEqual(await appAccess(own.session, "p", "n", true), { access: "edit", principal: "anna", tenant: "org", name: "Анна", project: "p", node: "n" });
  assert.ok(own.calls.includes("openDraft"));
  const periodic = session({ readDraftDocument: async () => ({ head: HEAD, node_id: "n", exists: true, content_type: APP_MIME, conflicted: false, terms: [] }) });
  assert.deepEqual(await appAccess(periodic.session, "p", "n", false), { access: "edit", principal: "anna", tenant: "", name: "", project: "p", node: "n" });
  assert.ok(!periodic.calls.includes("openDraft") && !periodic.calls.includes("units"), "периодическая проверка не открывает черновик и не читает справочник");
  // Узел в конфликте или чужого типа в своём черновике правки не даёт.
  const conflicted = session({ readDraftDocument: async () => ({ head: HEAD, node_id: "n", exists: true, content_type: APP_MIME, conflicted: true, terms: [] }) });
  await assert.rejects(appAccess(conflicted.session, "p", "n", false), new RegExp(APP_ACCESS_DENIED));
});

test("отдел или организация: только чтение опубликованного; удалённое или чужого типа — отказ", async () => {
  const event = (exists: boolean, content_type = APP_MIME) => ({ nodeHistory: async () => ({ events: [{ event_id: "e", head: HEAD, recorded_at: "", exists, content_type, observed: true, actor: "", on_behalf_of: "" }] }) });
  const reader = session({ ...event(true), openDraft: denied(403) });
  assert.equal((await appAccess(reader.session, "p", "n", true)).access, "read");
  await assert.rejects(appAccess(session(event(false)).session, "p", "n", false), new RegExp(APP_ACCESS_DENIED));
  await assert.rejects(appAccess(session(event(true, "text/plain")).session, "p", "n", false), new RegExp(APP_ACCESS_DENIED));
});

test("чужой: нет приглашения, черновика и общей версии — отказ; сбой Mnemos не превращается в право", async () => {
  await assert.rejects(appAccess(session().session, "p", "n", false), new RegExp(APP_ACCESS_DENIED));
  await assert.rejects(appAccess(session({ nodeHistory: denied(500) }).session, "p", "n", false), (e: unknown) => e instanceof MnemosAPIError && e.status === 500);
  await assert.rejects(appAccess(session().session, "", "n", false), new RegExp(APP_ACCESS_DENIED));
});

test("справочник: люди из отделов без повторов и отделы с составом", async () => {
  const out = await appDirectory(session().session);
  assert.deepEqual(out.people, [{ id: "anna", name: "Анна" }, { id: "boris", name: "Борис" }]);
  assert.deepEqual(out.departments, [{ id: "u1", name: "Продажи", members: [{ id: "anna", name: "Анна" }, { id: "boris", name: "Борис" }] }]);
});

test("ключ экземпляра — из ответа Mnemos: проект вне списка проектов человека не открывается", async () => {
  const reader = session({ nodeHistory: async () => ({ events: [{ event_id: "e", head: HEAD, recorded_at: "", exists: true, content_type: APP_MIME, observed: true, actor: "", on_behalf_of: "" }] }), listProjects: async () => ({ projects: [{ id: "other" }] }) });
  await assert.rejects(appAccess(reader.session, "p", "n", true), new RegExp(APP_ACCESS_DENIED));
  const byInvite = await appAccess(session(invited("read")).session, "p", "n", true);
  assert.deepEqual([byInvite.project, byInvite.node], ["p", "n"]);
});
