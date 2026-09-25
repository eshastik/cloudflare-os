import test from "node:test";
import assert from "node:assert/strict";
import { MnemosAPI } from "./mnemos-api.ts";
import { HISTORY_PREPARING, historyPercent, historyPreparing, historyPreparingText } from "./history-preparing.ts";
import { retryWhileUploading } from "./upload-batches.ts";

const answer = (status: number, body: object) => new MnemosAPI("https://api.example", async () => "token", async () => Response.json(body, { status }));

test("429 history_preparing: код и ход из ответа, метка в тексте переживает RPC", async () => {
  const error = await answer(429, { code: HISTORY_PREPARING, message: "history is being prepared", progress: { done: 120, total: 3670 }, detail: "перенесено 120 из 3670 файлов" })
    .openDraft("p1").catch(error => error);
  assert.equal(error.status, 429);
  assert.equal(error.code, HISTORY_PREPARING);
  assert.deepEqual(error.progress, { done: 120, total: 3670 });
  assert.equal(error.message, "История проекта готовится: перенесено 120 из 3 670 файлов [history_preparing 120/3670]");
  // Через RPC доходит только текст: ход восстанавливается из него.
  assert.deepEqual(historyPreparing(new Error(error.message)), { done: 120, total: 3670 });
  assert.equal(historyPercent({ done: 120, total: 3670 }), 3);
  // Подготовку истории не ждут в мосте: оболочка опрашивает сама, запрос не повторяется.
  let calls = 0;
  await assert.rejects(retryWhileUploading(async () => { calls++; throw error; }, { wait: async () => {} }), /История проекта готовится/);
  assert.equal(calls, 1);
});

test("ход без чисел или с чужими значениями — «готовится» без полосы; прочие ошибки не путаются", async () => {
  const odd = await answer(429, { code: HISTORY_PREPARING, progress: { done: -1, total: "много" } }).draftState("p1").catch(error => error);
  assert.deepEqual(odd.progress, { done: 0, total: 0 });
  assert.deepEqual(historyPreparing(new Error(odd.message)), { done: 0, total: 0 });
  assert.equal(historyPreparingText({ done: 0, total: 0 }), "История проекта готовится");
  assert.equal(historyPercent({ done: 0, total: 0 }), null);
  assert.equal(historyPreparingText({ done: 1, total: 21 }), "История проекта готовится: перенесено 1 из 21 файла");
  // Перенесено больше, чем всего, не бывает: число обрезается.
  assert.deepEqual(historyPreparing({ code: HISTORY_PREPARING, progress: { done: 9, total: 5 } }), { done: 5, total: 5 });
  const busy = await answer(429, { code: "request.rate_limit" }).openDraft("p1").catch(error => error);
  assert.equal(historyPreparing(busy), null);
  assert.equal(historyPreparing(new Error("Mnemos request failed")), null);
});
