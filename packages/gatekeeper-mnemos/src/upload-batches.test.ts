import {test} from "node:test";
import assert from "node:assert/strict";
import {isPermanentUploadError, splitIntoBatches, uploadInBatches} from "./upload-batches.ts";

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
