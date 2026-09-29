import { test } from "node:test";
import assert from "node:assert/strict";
import {
  beginChatDocument, chatDocumentReceipts, finishChatDocument, freeName, isPersonalSpace, moveChatDocument, personalSpace, personalSpaceSlug,
  readChatDocumentText, type ChatDocumentAPI,
} from "./chat-documents.ts";
import { checkedAgentAction, executeAgentAction, prepareAgentAction, type AgentActionSession } from "./agent-actions.ts";
import { MnemosAPIError } from "./mnemos-api.ts";

const STORAGE = "https://storage.example";
const HEAD = "a".repeat(64), NEW_HEAD = "b".repeat(64);
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const REQUEST = "chat-0123456789abcdef0123";
const CHECKSUM = "A".repeat(43) + "=";
const USER = "u-7f3a9c2e";

function kv() {
  const map = new Map<string, unknown>();
  return { get: <T>(k: string) => map.get(k) as T | undefined, put: (k: string, v: unknown) => { map.set(k, structuredClone(v)); }, delete: (k: string) => map.delete(k) };
}

type Project = { id: string; name: string; slug: string; created_by?: string; visibility?: "private" | "department" | "organization"; can_edit?: boolean };

function session(opts: { names?: string[]; projects?: Project[]; create?: ChatDocumentAPI["createPrivateDocument"]; ticketUrl?: string; closes?: boolean } = {}) {
  const calls: unknown[][] = [];
  const created = new Map<string, string>();
  const projects: Project[] = [...(opts.projects ?? [])];
  const api = {
    async openDraft(project: string) { calls.push(["openDraft", project]); return { head: HEAD }; },
    async listPrivateDocuments(project: string) { calls.push(["list", project]); return { documents: (opts.names ?? []).map((name, i) => ({ node_id: `n${i}`, name, content_type: DOCX, conflicted: false })), head: HEAD, next_cursor: "" }; },
    async beginProjectUpload(project: string, size: number, checksum: string) {
      calls.push(["ticket", project, size]);
      return { upload_id: "up-1", url: opts.ticketUrl ?? STORAGE + "/b/o?sig=1", method: "PUT", checksum_header: "x-amz-checksum-sha256", checksum_value: checksum, content_length: size };
    },
    createPrivateDocument: opts.create ?? (async (project: string, request: { request_id: string }) => {
      calls.push(["create", project, request]);
      if (!created.has(request.request_id)) created.set(request.request_id, `node-${created.size + 1}`);
      return { node_id: created.get(request.request_id)!, head: NEW_HEAD };
    }),
    async listProjects() { calls.push(["projects"]); return { projects }; },
    async createProject(name: string, slug: string) {
      calls.push(["createProject", name, slug]);
      if (projects.some(p => p.slug === slug)) throw new MnemosAPIError(409);
      const project: Project = { id: slug === personalSpaceSlug(USER) ? "p-personal" : "p-personal-tail", name, slug, created_by: USER, visibility: "department" };
      projects.push(project);
      return { project };
    },
    async setProjectVisibility(project: string, level: string) {
      calls.push(["visibility", project, level]);
      if (opts.closes === false) throw new MnemosAPIError(403, "project.personal_disabled");
      const p = projects.find(x => x.id === project)!;
      p.visibility = level as Project["visibility"];
      return { project_id: project, visibility: level, can_edit: false, applied: true };
    },
    async readDraftText(project: string, node: string, offset: number, max: number) {
      calls.push(["text", project, node, offset, max]);
      return { node_id: node, head: HEAD, name: "Отчёт.docx", content_type: DOCX, size_bytes: 10, offset, next_offset: offset + 5, total_bytes: 12, text: "Итоги", truncated: true };
    },
    async readDraftDocument(project: string, node: string) { calls.push(["draft", project, node]); return { head: HEAD, node_id: node, exists: true, conflicted: false, terms: [] }; },
    async transferPrivateDocument(project: string, node: string, request: { request_id: string; target_project_id: string; expected_head: string }) {
      calls.push(["transfer", project, node, request]);
      return { node_id: "moved-1", head: NEW_HEAD, project_id: request.target_project_id, name: "Отчёт.docx", source_project_id: project, source_node_id: node, source_head: request.expected_head, notified: true };
    },
  } as unknown as ChatDocumentAPI;
  return { api, calls, projects };
}

const file = { name: "Отчёт.docx", contentType: DOCX, size: 7, checksum: CHECKSUM };

test("личное пространство: служебное краткое имя, создаётся один раз и закрывается", async () => {
  assert.equal(personalSpaceSlug("U-7F3A_9c2e"), "lichnoe-u7f3a9c2e");
  const { api, calls } = session();
  const place = await personalSpace(api, USER);
  assert.deepEqual(place, { project: "p-personal", projectTitle: "Личное пространство", personal: true });
  assert.deepEqual(calls.find(c => c[0] === "createProject"), ["createProject", "Личное пространство", "lichnoe-u7f3a9c2e"]);
  assert.deepEqual(calls.find(c => c[0] === "visibility"), ["visibility", "p-personal", "private"]);
  // Повтор находит уже созданное, второго проекта нет.
  const again = await personalSpace(api, USER);
  assert.equal(again.project, "p-personal");
  assert.equal(calls.filter(c => c[0] === "createProject").length, 1);
});

test("личное пространство: занятое чужим имя — своё со случайным хвостом, узнаётся по создателю; гонка — повторный поиск", async () => {
  const foreign = { id: "p-other", name: "Личное пространство", slug: personalSpaceSlug(USER), created_by: "someone-else" };
  const { api, calls } = session({ projects: [foreign] });
  const created = await personalSpace(api, USER);
  assert.equal(created.project, "p-personal-tail");
  const slugs = calls.filter(c => c[0] === "createProject").map(c => c[2] as string);
  assert.equal(slugs[0], personalSpaceSlug(USER));
  assert.match(slugs[1], new RegExp(`^${personalSpaceSlug(USER)}-[a-z0-9]{6}$`));
  // Повтор находит своё пространство с хвостом, а не чужое с точным именем.
  assert.equal((await personalSpace(api, USER)).project, "p-personal-tail");
  assert.equal(calls.filter(c => c[0] === "createProject").length, 2);
  assert.equal(isPersonalSpace(foreign, USER), false);
  assert.equal(isPersonalSpace({ slug: personalSpaceSlug(USER) }, USER), false);
  assert.equal(isPersonalSpace({ slug: personalSpaceSlug(USER) + "-evil", created_by: USER }, USER), false);

  const mine = { id: "p-mine", name: "Мои файлы", slug: personalSpaceSlug(USER), created_by: USER, visibility: "private" as const };
  let listed = 0;
  const race = session();
  (race.api as unknown as Record<string, unknown>).listProjects = async () => ({ projects: listed++ === 0 ? [] : [mine] });
  (race.api as unknown as Record<string, unknown>).createProject = async () => { throw new MnemosAPIError(409); };
  assert.deepEqual(await personalSpace(race.api, USER), { project: "p-mine", projectTitle: "Мои файлы", personal: true });
});

test("пространство, которое не удалось закрыть, не используется: файл не кладётся, причина честная", async () => {
  const { api } = session({ closes: false });
  await assert.rejects(personalSpace(api, USER), /открылось бы отделу, поэтому файл не сохранён/);
  const existing = session({ projects: [{ id: "p-open", name: "Личное пространство", slug: personalSpaceSlug(USER), created_by: USER, visibility: "department" }], closes: false });
  await assert.rejects(personalSpace(existing.api, USER), /открылось бы отделу/);
});

test("личные проекты выключены — понятная причина", async () => {
  const { api } = session();
  (api as unknown as Record<string, unknown>).createProject = async () => { throw new MnemosAPIError(403, "project.personal_disabled"); };
  await assert.rejects(personalSpace(api, USER), /отключены личные проекты/);
});

test("билет выгрузки: только адрес хранилища установки, размер и сумма совпадают", async () => {
  const ok = session();
  const ticket = await beginChatDocument(ok.api, STORAGE, "p", file);
  assert.equal(ticket.upload_id, "up-1");
  assert.equal(ticket.checksum_value, CHECKSUM);
  assert.deepEqual(ok.calls[0], ["ticket", "p", 7]);

  const foreign = session({ ticketUrl: "https://evil.example/b/o" });
  await assert.rejects(beginChatDocument(foreign.api, STORAGE, "p", file), /неожиданный адрес/);
  await assert.rejects(beginChatDocument(ok.api, STORAGE, "p", { ...file, contentType: "image/png" }), /не кладётся/);
  await assert.rejects(beginChatDocument(ok.api, STORAGE, "p", { ...file, size: 64 * 1024 * 1024 + 1 }), /не кладётся/);
});

test("узел из выгруженного файла: личная версия с исходным видом, повтор не создаёт второй", async () => {
  const { api, calls } = session();
  const receipts = chatDocumentReceipts(kv());
  const first = await finishChatDocument(api, receipts, "p", REQUEST, "up-1", { name: "Отчёт.docx", contentType: DOCX });
  assert.deepEqual(first, { resource: "node-1", name: "Отчёт.docx", created: true });
  const create = calls.find(c => c[0] === "create")![2] as Record<string, unknown>;
  assert.equal(create.content_type, DOCX);
  assert.equal(create.upload_id, "up-1");
  assert.equal(create.parent_id, "");
  const second = await finishChatDocument(api, receipts, "p", REQUEST, "up-1", { name: "Отчёт.docx", contentType: DOCX });
  assert.equal(second.resource, "node-1");
  assert.equal(calls.filter(c => c[0] === "create").length, 1);
});

test("потерянный ответ: повтор посылает то же тело и получает тот же узел", async () => {
  let attempts = 0;
  const bodies: unknown[] = [];
  const { api } = session({ create: (async (_p: string, request: unknown) => {
    bodies.push(request);
    if (attempts++ === 0) throw new MnemosAPIError(503);
    return { node_id: "node-1", head: NEW_HEAD };
  }) as never });
  const receipts = chatDocumentReceipts(kv());
  await assert.rejects(finishChatDocument(api, receipts, "p", REQUEST, "up-1", file), /Mnemos не ответил/);
  const saved = await finishChatDocument(api, receipts, "p", REQUEST, "up-1", file);
  assert.equal(saved.resource, "node-1");
  assert.deepEqual(bodies[0], bodies[1]);
});

test("занятое имя получает « (2)», « (3)»; нет права — понятная причина", async () => {
  assert.equal(freeName("Отчёт.docx", new Set(["Отчёт.docx", "Отчёт (2).docx"])), "Отчёт (3).docx");
  assert.equal(freeName("README", new Set(["README"])), "README (2)");
  const { api } = session({ names: ["Отчёт.docx"] });
  const saved = await finishChatDocument(api, chatDocumentReceipts(kv()), "p", REQUEST, "up-1", file);
  assert.equal(saved.name, "Отчёт (2).docx");
  const denied = session({ create: (async () => { throw new MnemosAPIError(403); }) as never });
  await assert.rejects(finishChatDocument(denied.api, chatDocumentReceipts(kv()), "p", REQUEST, "up-1", file), /нет права записи/);
});

test("текст частями; «ещё разбирается» — состояние, а не ошибка", async () => {
  const { api, calls } = session();
  const part = await readChatDocumentText(api, "p", "n1", 0);
  assert.deepEqual(part, { state: "ready", name: "Отчёт.docx", contentType: DOCX, text: "Итоги", offset: 0, nextOffset: 5, totalBytes: 12, done: false, noText: false });
  assert.equal((calls[0] as number[])[4], 48 * 1024);
  (api as unknown as Record<string, unknown>).readDraftText = async () => { throw new MnemosAPIError(429, "content.preparing"); };
  assert.equal((await readChatDocumentText(api, "p", "n1", 5)).state, "preparing");
  await assert.rejects(readChatDocumentText(api, "p", "n1", -1), /смещение/);
});

test("перенос: текущая голова источника, тот же проект и конфликт отвергаются", async () => {
  const { api, calls } = session();
  const moved = await moveChatDocument(api, "p-personal", "n1", "p-team", "move-0123456789abcdef");
  assert.deepEqual(moved, { project: "p-team", resource: "moved-1", name: "Отчёт.docx", notified: true });
  assert.deepEqual((calls.find(c => c[0] === "transfer")![3]), { request_id: "move-0123456789abcdef", target_project_id: "p-team", expected_head: HEAD });
  await assert.rejects(moveChatDocument(api, "p", "n1", "p", "move-0123456789abcdef"), /уже в этом проекте/);
  (api as unknown as Record<string, unknown>).readDraftDocument = async () => ({ head: HEAD, node_id: "n1", exists: true, conflicted: true, terms: [] });
  await assert.rejects(moveChatDocument(api, "p-personal", "n1", "p-team", "move-0123456789abcdef"), /конфликт/);
});

test("действие агента «перенести файл»: карточка владельцу, выполнение переносом Mnemos", async () => {
  assert.throws(() => checkedAgentAction({ kind: "move_file", project: "p", document: "n", target: "t", extra: 1 }), /Лишние/);
  const request = checkedAgentAction({ kind: "move_file", project: "Личное пространство", document: "Отчёт", target: "Стройка" });
  const transfers: unknown[] = [];
  let listed = 0;
  const s = {
    async whoAmI() { return { subject: { tenant_id: "t", user_id: USER }, tenant_name: "Орг" }; },
    async listProjects() { return { projects: [
      { id: "p-personal", name: "Личное пространство", slug: personalSpaceSlug(USER), created_by: USER },
      { id: "p-team", name: "Стройка", slug: "stroika", can_edit: true },
      { id: "p-other", name: "Бухгалтерия", slug: "buh", can_edit: true },
    ] }; },
    async listPrivateDocuments() { listed++; return { documents: [{ node_id: "n1", name: "Отчёт.docx", content_type: DOCX, conflicted: false }], head: HEAD, next_cursor: "" }; },
    async readDraftDocument(_p: string, node: string) { return { head: HEAD, node_id: node, exists: true, conflicted: false, terms: [] }; },
    async transferPrivateDocument(project: string, node: string, r: { request_id: string; target_project_id: string; expected_head: string }) {
      transfers.push([project, node, r.target_project_id, r.expected_head]);
      return { node_id: "moved-1", head: NEW_HEAD, project_id: r.target_project_id, name: "Отчёт.docx", source_project_id: project, source_node_id: node, source_head: HEAD, notified: true };
    },
  } as unknown as AgentActionSession;
  // Источник — своё личное пространство (вне области агента), назначение — из области.
  const scope = new Set(["p-team"]);
  const prepared = await prepareAgentAction(s, scope, request);
  assert.equal(prepared.ownerOnly, true);
  assert.equal(prepared.title, "Перенести «Отчёт.docx» в проект «Стройка»");
  assert.match(String(prepared.resolved.request), /^move-[0-9a-f-]{36}$/);
  const outcome = await executeAgentAction(s, "move_file", prepared.resolved);
  assert.equal(outcome.summary, "Файл «Отчёт.docx» перенесён в проект «Стройка»");
  assert.deepEqual(transfers, [["p-personal", "n1", "p-team", HEAD]]);
  await assert.rejects(prepareAgentAction(s, scope, checkedAgentAction({ kind: "move_file", project: "Стройка", document: "Отчёт", target: "Стройка" })), /уже в проекте/);
  // Ревью 29.09: проект вне области агента не отдаёт ему даже имена личных документов.
  listed = 0;
  await assert.rejects(prepareAgentAction(s, scope, checkedAgentAction({ kind: "move_file", project: "Бухгалтерия", document: "Отчёт", target: "Стройка" })), /не подключён к агенту/);
  await assert.rejects(prepareAgentAction(s, scope, checkedAgentAction({ kind: "move_file", project: "Личное пространство", document: "Отчёт", target: "Бухгалтерия" })), /не подключён к агенту/);
  assert.equal(listed, 0);
});
