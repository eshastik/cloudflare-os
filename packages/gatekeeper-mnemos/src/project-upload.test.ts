import {test} from "node:test";
import assert from "node:assert/strict";
import {MnemosAPI, MnemosAPIError} from "./mnemos-api.ts";

test("Загрузка сохраняет выбранный проект в билете и в приёме файла", async () => {
  const calls: {path: string; body: Record<string, unknown>}[] = [];
  const api = new MnemosAPI("https://memory.example", async () => "token", async (url, init) => {
    calls.push({path: new URL(String(url)).pathname, body: JSON.parse(String(init?.body))});
    return Response.json({upload_id: "ticket", outcome: "placed", enqueued: false});
  });
  await api.beginProjectUpload("project-two", 8 * 1024 * 1024, "a".repeat(43) + "=");
  await api.submitProjectUpload("project-two", "ticket", "Папка/договор.pdf", 0);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].path, "/v1/uploads");
  assert.equal(calls[0].body.project_id, "project-two");
  assert.equal(calls[1].path, "/v1/inbox");
  assert.equal(calls[1].body.project_id, "project-two");
  assert.equal(calls[1].body.source_path, "Папка/договор.pdf");
  assert.equal(calls[1].body.upload_id, "ticket");
});

test("Отказ проекта не превращается в приём без проекта", async () => {
  let requests = 0;
  const api = new MnemosAPI("https://memory.example", async () => "token", async () => {
    requests++; return new Response("", {status: 403});
  });
  await assert.rejects(api.submitProjectUpload("other-project", "ticket", "file.txt"), error => error instanceof MnemosAPIError && error.status === 403);
  assert.equal(requests, 1);
  assert.throws(() => api.submitProjectUpload("", "ticket", "file.txt"));
  assert.equal(requests, 1);
  assert.throws(() => api.beginProjectUpload("project", 64 * 1024 * 1024 + 1, "a".repeat(43) + "="));
  assert.equal(requests, 1);
});
