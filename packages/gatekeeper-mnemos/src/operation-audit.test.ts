import { test } from "node:test";
import assert from "node:assert/strict";
import { MnemosAPI } from "./mnemos-api.ts";

// Лента людей просит у сервера только значимые действия: без этого параметра
// окно журнала забивают служебные записи request.admit и внешней проверки.
test("страница значимых действий передаёт significant=1 и допускает окно до 10000 записей", async () => {
 const urls: string[] = [];
 const page = { events: [], checkpoint: { sequence: 0, hash: "" }, next: 0, truncated: false };
 const api = new MnemosAPI("https://memory.example", async () => "token", async url => { urls.push(String(url)); return Response.json(page); });
 await api.readOperationAuditPage(0, 1000);
 await api.readOperationAuditPage(5, 10000, undefined, true);
 assert.deepEqual(urls.map(u => Object.fromEntries(new URL(u).searchParams)), [{ after: "0", limit: "1000" }, { after: "5", limit: "10000", significant: "1" }]);
 assert.throws(() => api.readOperationAuditPage(0, 1001), /Invalid audit limit/);
 assert.throws(() => api.readOperationAuditPage(0, 10001, undefined, true), /Invalid audit limit/);
});
