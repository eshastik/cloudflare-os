import {test} from "node:test";
import assert from "node:assert/strict";
import {isPermanentUploadError, isRefusedUpload, retryWhileUploading, splitIntoBatches, uploadFailure, uploadInBatches, uploadRefusal} from "./upload-batches.ts";
import {MnemosAPI, MnemosAPIError, UPLOAD_IN_PROGRESS} from "./mnemos-api.ts";

const instant = async () => {};

test("пакеты: порядок сохранён, последний пакет — остаток", () => {
  assert.deepEqual(splitIntoBatches([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(splitIntoBatches([], 50), []);
  assert.equal(splitIntoBatches(Array.from({length: 4800}, (_, i) => i), 50).length, 96);
  assert.throws(() => splitIntoBatches([1], 0));
});

test("параллельно идёт не больше заданного числа файлов, пакеты — по очереди", async () => {
  let active = 0, peak = 0;
  const started: number[] = [];
  const progress: number[] = [];
  const result = await uploadInBatches({
    items: Array.from({length: 23}, (_, i) => i), batchSize: 10, concurrency: 3, wait: instant,
    upload: async item => { started.push(item); active++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 1)); active--; return item * 2; },
    onProgress: done => progress.push(done),
  });
  assert.equal(peak, 3);
  assert.equal(result.done.length, 23);
  assert.deepEqual(result.failed, []);
  assert.deepEqual(progress, Array.from({length: 23}, (_, i) => i + 1));
  // Файл следующего пакета не стартует, пока не закончен предыдущий пакет.
  assert.deepEqual(started.slice(0, 10).sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test("временная ошибка повторяется, постоянная — нет", async () => {
  const calls = new Map<string, number>();
  const waits: number[] = [];
  const result = await uploadInBatches({
    items: ["flaky", "big", "dead"], retries: 2, backoffMs: [5, 50], wait: async ms => { waits.push(ms); },
    permanent: isPermanentUploadError,
    upload: async item => {
      const n = (calls.get(item) ?? 0) + 1; calls.set(item, n);
      if (item === "flaky" && n < 3) throw new Error("Mnemos request failed");
      if (item === "big") throw new Error("Файл больше 64 МБ: текущая приёмная не может обработать его целиком");
      if (item === "dead") throw new Error("Хранилище не приняло файл. Повторите загрузку");
      return item;
    },
  });
  assert.deepEqual(result.done.map(d => d.item), ["flaky"]);
  assert.deepEqual(result.failed.map(f => f.item).sort(), ["big", "dead"]);
  assert.deepEqual(Object.fromEntries(calls), {flaky: 3, big: 1, dead: 3});
  assert.deepEqual(waits.sort((a, b) => a - b), [5, 5, 50, 50]);
});

test("серия отказов подряд останавливает загрузку, остальные файлы помечены незагруженными", async () => {
  let calls = 0;
  const result = await uploadInBatches({
    items: Array.from({length: 100}, (_, i) => i), concurrency: 1, retries: 0, stopAfterConsecutiveFailures: 5, wait: instant,
    upload: async () => { calls++; throw new Error("403"); },
  });
  assert.equal(calls, 5);
  assert.equal(result.stopped, true);
  assert.equal(result.failed.length, 100);
});

test("отмена прерывает загрузку и ожидание повтора", async () => {
  const controller = new AbortController();
  const pending = uploadInBatches({
    items: [1, 2, 3], concurrency: 1, signal: controller.signal, backoffMs: [60_000],
    upload: async () => { throw new Error("сеть"); },
  });
  setTimeout(() => controller.abort(new Error("Загрузка отменена")), 5);
  await assert.rejects(pending, /отменена/);
});

test("по умолчанию 6 файлов параллельно: меньше предела 32 незавершённых загрузок вместе с серией отказов", async () => {
  let active = 0, peak = 0;
  await uploadInBatches({
    items: Array.from({length: 30}, (_, i) => i), wait: instant,
    upload: async item => { active++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 1)); active--; return item; },
  });
  assert.equal(peak, 6);
});

test("onStart и onSettled: каждый файл начат и завершён ровно раз, отказ — с ошибкой", async () => {
  const started: number[] = [], settled: [number, boolean][] = [];
  await uploadInBatches({
    items: [1, 2, 3], retries: 1, wait: instant, concurrency: 1,
    upload: async item => { if (item === 2) throw new Error("сеть"); return item; },
    onStart: item => started.push(item), onSettled: (item, error) => settled.push([item, error !== undefined]),
  });
  // Упавший файл начинался дважды (повтор), завершён один раз.
  assert.deepEqual(started, [1, 2, 2, 3]);
  assert.deepEqual(settled, [[1, false], [2, true], [3, false]]);
});

test("остановка ждёт начатые файлы: принятый в момент остановки не теряется", async () => {
  const controller = new AbortController();
  const accepted: number[] = [];
  let release: () => void = () => {};
  const slow = new Promise<void>(resolve => { release = resolve; });
  const pending = uploadInBatches({
    items: [1, 2, 3, 4], concurrency: 2, signal: controller.signal, wait: instant,
    upload: async (item, signal) => {
      if (item === 1) { await slow; accepted.push(item); signal?.throwIfAborted(); return item; } // сервер уже принял
      if (item === 2) { await new Promise((_, reject) => signal!.addEventListener("abort", () => reject(signal!.reason), {once: true})); }
      accepted.push(item); return item;
    },
  });
  await new Promise(r => setTimeout(r, 5));
  controller.abort(new Error("Загрузка остановлена"));
  let finished = false;
  void pending.catch(() => {}).finally(() => { finished = true; });
  await new Promise(r => setTimeout(r, 5));
  assert.equal(finished, false, "отказ не раньше, чем закончится начатый файл");
  release();
  await assert.rejects(pending, /остановлена/);
  assert.deepEqual(accepted, [1], "файлы 3 и 4 не начинались");
});

// Ответы сервера пересекают RPC только текстом: uploadFailure кладёт в него код состояния и отказ политики.
const server = (status: number, code?: string, refusal?: {reason: string; detail: string}) =>
  uploadFailure(new MnemosAPIError(status, code as never, refusal)) as Error;

test("4xx не повторяются, кроме 408/409/425/429; 5xx и сеть — повторяются", async () => {
  for (const status of [400, 401, 403, 404, 413, 422]) assert.equal(isPermanentUploadError(server(status)), true, `HTTP ${status}`);
  for (const status of [408, 409, 425, 429, 500, 502, 503]) assert.equal(isPermanentUploadError(server(status)), false, `HTTP ${status}`);
  assert.equal(server(400).message, "Mnemos request failed (HTTP 400)");
  // Ошибка без кода состояния (сеть, локальная проверка) проходит как есть.
  const local = new Error("сеть");
  assert.equal(uploadFailure(local), local);
  const calls = new Map<number, number>();
  await uploadInBatches({
    items: [400, 403, 429, 503], retries: 2, wait: instant, permanent: isPermanentUploadError,
    upload: async status => { calls.set(status, (calls.get(status) ?? 0) + 1); throw server(status); },
  });
  assert.deepEqual(Object.fromEntries(calls), {400: 1, 403: 1, 429: 3, 503: 3});
});

test("отказ политики: причина и текст сервера доходят до браузера, файл не повторяется", () => {
  const detail = "файлы .env, ключи и сертификаты не загружаются: в них могут быть пароли и токены";
  const error = server(400, "ingest.refused_by_policy", {reason: "secret", detail});
  assert.equal(isRefusedUpload(error), true);
  assert.equal(isPermanentUploadError(error), true);
  assert.deepEqual(uploadRefusal(error), {reason: "secret", detail});
  // Правило оператора без публичной причины: причина пуста, текст — сообщение сервера.
  assert.deepEqual(uploadRefusal(server(400, "ingest.refused_by_policy", {reason: "", detail: "файл не принят правилом"})), {reason: "", detail: "файл не принят правилом"});
  assert.equal(uploadRefusal(server(400)), undefined);
  assert.equal(uploadRefusal(new Error("сеть")), undefined);
});

test("сотни отказов политики подряд не останавливают загрузку и не повторяются", async () => {
  const items = [...Array.from({length: 300}, (_, i) => `vendor/${i}.js`), "doc.pdf"];
  let calls = 0;
  const result = await uploadInBatches({
    items, concurrency: 1, retries: 2, stopAfterConsecutiveFailures: 25, wait: instant,
    permanent: isPermanentUploadError, refused: isRefusedUpload,
    upload: async item => { calls++; if (item.startsWith("vendor/")) throw server(400, "ingest.refused_by_policy", {reason: "build", detail: "папки сборки не загружаются"}); return item; },
  });
  assert.equal(result.stopped, false);
  assert.equal(calls, 301);
  assert.deepEqual(result.done.map(d => d.item), ["doc.pdf"]);
  assert.equal(result.failed.length, 300);
});

test("429 upload_in_progress: повтор с растущей паузой, затем понятная ошибка", async () => {
  const waits: number[] = [];
  let calls = 0;
  const value = await retryWhileUploading(async () => { if (++calls < 3) throw new MnemosAPIError(429, UPLOAD_IN_PROGRESS); return "открыт"; },
    {pausesMs: [1, 2, 3], wait: async ms => { waits.push(ms); }});
  assert.equal(value, "открыт");
  assert.deepEqual(waits, [1, 2]);
  waits.length = 0;
  await assert.rejects(retryWhileUploading(async () => { throw new MnemosAPIError(429, UPLOAD_IN_PROGRESS); }, {pausesMs: [1, 2], wait: async ms => { waits.push(ms); }}),
    /В проект ещё загружаются файлы/);
  assert.deepEqual(waits, [1, 2]);
  // Другие ошибки не повторяются.
  let other = 0;
  await assert.rejects(retryWhileUploading(async () => { other++; throw new MnemosAPIError(429, "request.rate_limit"); }, {pausesMs: [1], wait: instant}));
  assert.equal(other, 1);
});

test("ответ сервера 400 ingest.refused_by_policy разбирается в причину и текст; чужой 400 — только код", async () => {
  const detail = "папки сборки и сторонних библиотек (node_modules, vendor, dist, build и подобные) не загружаются: их можно восстановить, а поиск они засоряют";
  const answer = (status: number, body: object) => new MnemosAPI("https://api.example", async () => "token", async () => Response.json(body, {status}));
  const refused = await answer(400, {code: "ingest.refused_by_policy", message: "файл не принят приёмной политикой", reason: "build", detail})
    .submitProjectUpload("p1", "u1", "Лев/vendor/a.js").catch(error => error);
  assert.equal(refused.status, 400);
  assert.deepEqual(uploadRefusal(uploadFailure(refused)), {reason: "build", detail});
  // Причина вне формата не пропускается, текст — из сообщения сервера.
  const odd = await answer(400, {code: "ingest.refused_by_policy", message: "файл не принят приёмной политикой", reason: "Bad Reason!"})
    .submitProjectUpload("p1", "u1", "Лев/a.js").catch(error => error);
  assert.deepEqual(uploadRefusal(uploadFailure(odd)), {reason: "", detail: "файл не принят приёмной политикой"});
  const other = await answer(400, {code: "body.malformed", message: "x"}).submitProjectUpload("p1", "u1", "Лев/a.js").catch(error => error);
  assert.equal(uploadRefusal(uploadFailure(other)), undefined);
  assert.equal(isPermanentUploadError(uploadFailure(other)), true);
  const busy = await answer(429, {code: UPLOAD_IN_PROGRESS, message: "в проект ещё загружаются файлы"}).openDraft("p1").catch(error => error);
  assert.equal(busy.code, UPLOAD_IN_PROGRESS);
  assert.equal(isPermanentUploadError(uploadFailure(busy)), false);
});
