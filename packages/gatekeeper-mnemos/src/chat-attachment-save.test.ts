import { test } from "node:test";
import assert from "node:assert/strict";
import { chatAttachmentReceipts, freeName, saveChatAttachment, type ChatAttachmentSaveAPI } from "./chat-attachment-save.ts";
import { MnemosAPIError } from "./mnemos-api.ts";

const STORAGE = "https://storage.example";
const HEAD = "a".repeat(64), NEW_HEAD = "b".repeat(64);
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const REQUEST = "chat-0123456789abcdef0123";

function kv() {
  const map = new Map<string, unknown>();
  return { get: <T>(k: string) => map.get(k) as T | undefined, put: (k: string, v: unknown) => { map.set(k, structuredClone(v)); }, delete: (k: string) => map.delete(k) };
}

function session(names: string[] = [], create?: ChatAttachmentSaveAPI["createPrivateDocument"]) {
  const calls: unknown[][] = [];
  const created = new Map<string, string>();
  const api: ChatAttachmentSaveAPI = {
    async openDraft(project) { calls.push(["openDraft", project]); return { head: HEAD } as never; },
    async listPrivateDocuments(project) { calls.push(["list", project]); return { documents: names.map((name, i) => ({ node_id: `n${i}`, name, content_type: DOCX, conflicted: false })), head: HEAD, next_cursor: "" }; },
    async beginImportUpload(project, size, checksum) {
      calls.push(["upload", project, size]);
      return { upload_id: "up-1", url: STORAGE + "/b/o?sig=1", method: "PUT", checksum_header: "x-amz-checksum-sha256", checksum_value: checksum, content_length: size } as never;
    },
    createPrivateDocument: create ?? (async (project, request) => {
      calls.push(["create", project, request]);
      // Mnemos: тот же request_id — тот же узел.
      if (!created.has(request.request_id)) created.set(request.request_id, `node-${created.size + 1}`);
      return { node_id: created.get(request.request_id)!, head: NEW_HEAD };
    }),
  };
  const fetcher = (async (_url: URL, init: RequestInit) => { calls.push(["PUT", init.method]); return new Response(null, { status: 200 }); }) as unknown as typeof fetch;
  return { api, calls, fetcher };
}

const file = { name: "Отчёт.docx", contentType: DOCX, content: new Uint8Array([0x50, 0x4b, 3, 4, 1, 2, 3]) };

test("документ ложится личной версией с исходным видом файла, повтор не создаёт второй", async () => {
  const { api, calls, fetcher } = session();
  const receipts = chatAttachmentReceipts(kv());
  const first = await saveChatAttachment(api, STORAGE, fetcher, receipts, "p", REQUEST, file);
  assert.deepEqual(first, { resource: "node-1", name: "Отчёт.docx", created: true });
  const create = calls.find(c => c[0] === "create")![2] as Record<string, unknown>;
  assert.equal(create.content_type, DOCX);
  assert.equal(create.expected_head, HEAD);
  assert.equal(create.parent_id, "");
  const second = await saveChatAttachment(api, STORAGE, fetcher, receipts, "p", REQUEST, file);
  assert.equal(second.resource, "node-1");
  assert.equal(calls.filter(c => c[0] === "create").length, 1);
  assert.equal(calls.filter(c => c[0] === "PUT").length, 1);
});

test("потерянный ответ: повтор посылает то же тело и получает тот же узел", async () => {
  let attempts = 0;
  const bodies: unknown[] = [];
  const { api, fetcher } = session([], async (_p, request) => {
    bodies.push(request);
    if (attempts++ === 0) throw new MnemosAPIError(503);
    return { node_id: "node-1", head: NEW_HEAD };
  });
  const receipts = chatAttachmentReceipts(kv());
  await assert.rejects(saveChatAttachment(api, STORAGE, fetcher, receipts, "p", REQUEST, file), /Mnemos не ответил/);
  const saved = await saveChatAttachment(api, STORAGE, fetcher, receipts, "p", REQUEST, file);
  assert.equal(saved.resource, "node-1");
  assert.deepEqual(bodies[0], bodies[1]);
});

test("занятое имя получает « (2)», « (3)»", async () => {
  assert.equal(freeName("Отчёт.docx", new Set(["Отчёт.docx", "Отчёт (2).docx"])), "Отчёт (3).docx");
  assert.equal(freeName("README", new Set(["README"])), "README (2)");
  const { api, fetcher } = session(["Отчёт.docx"]);
  const saved = await saveChatAttachment(api, STORAGE, fetcher, chatAttachmentReceipts(kv()), "p", REQUEST, file);
  assert.equal(saved.name, "Отчёт (2).docx");
});

test("без права записи — понятная причина", async () => {
  const { api, fetcher } = session([], async () => { throw new MnemosAPIError(403); });
  await assert.rejects(saveChatAttachment(api, STORAGE, fetcher, chatAttachmentReceipts(kv()), "p", REQUEST, file), /нет права записи в этот проект/);
});

test("картинка и неизвестный вид в проект не кладутся", async () => {
  const { api, calls, fetcher } = session();
  await assert.rejects(saveChatAttachment(api, STORAGE, fetcher, chatAttachmentReceipts(kv()), "p", REQUEST, { ...file, contentType: "image/png" }), /не сохраняется/);
  assert.equal(calls.length, 0);
});
