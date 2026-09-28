import { test } from "node:test";
import assert from "node:assert/strict";
import { MENU_COUNT_MAX_AGE_MS, MENU_COUNT_REFRESH_MS, MENU_INBOX_KEY, menuInboxCount, sourceErrorsFor } from "./account-description.ts";

const OWNER = { tenant: "org", owner: "alice", epoch: "e1" };
const ok = { accounts: [{ enabled: true }] }, bad = { accounts: [{ enabled: true, last_error_at: "2026-09-01" }] };

test("источники проверяются под одной личностью, удалённые — параллельно, порядок прежний", async () => {
  const seen: string[] = [];
  let inFlight = 0, peak = 0;
  const remote = (kind: string, connections: { enabled: boolean }[]) => async () => {
    inFlight++; peak = Math.max(peak, inFlight); await new Promise(r => setTimeout(r, 5)); inFlight--; seen.push(kind); return { connections };
  };
  const errors = await sourceErrorsFor({
    owner: OWNER,
    local: [["mail", o => { assert.deepEqual(o, OWNER); return ok; }], ["calendar", () => bad], ["drive", () => { throw Error("нет"); }]],
    remote: [["mail", remote("mail", [{ enabled: false }])], ["calendar", remote("calendar", [])]],
    epochChanged: () => false,
  });
  assert.deepEqual(errors, ["calendar", "drive", "mail"]);
  assert.equal(peak, 2);
  assert.deepEqual(seen.sort(), ["calendar", "mail"]);
});

test("без личности для источников и при смене подключения за время чтения все источники неисправны", async () => {
  const none = await sourceErrorsFor({ owner: null, local: [["mail", () => ok], ["calendar", () => ok], ["drive", () => ok]], remote: [], epochChanged: () => false });
  assert.deepEqual(none, ["mail", "calendar", "drive"]);
  const changed = await sourceErrorsFor({ owner: OWNER, local: [["mail", () => ok]], remote: [["calendar", async () => { throw Error("401"); }]], epochChanged: () => true });
  assert.deepEqual(changed, ["calendar", "mail", "drive"]);
});

function memory() {
  const data = new Map<string, unknown>();
  return { data, get<T>(key: string) { return data.get(key) as T | undefined; }, put<T>(key: string, value: T) { data.set(key, value); } };
}

test("счётчик «Входящих» не держит описание: сначала без числа, пересчёт в фоне и один на аккаунт", async () => {
  const storage = memory(), refresh: { current?: Promise<void> } = {}, kept: Promise<void>[] = [];
  let release!: (value: { inbox: number }) => void, counts = 0;
  const count = () => { counts++; return new Promise<{ inbox: number }>(resolve => { release = resolve; }); };
  const read = (now: number) => menuInboxCount({ storage, userId: "alice", now, count, refresh, keepAlive: w => kept.push(w) });
  assert.deepEqual(read(Date.now()), { inbox: undefined, pending: true });
  assert.deepEqual(read(Date.now()), { inbox: undefined, pending: true });
  assert.equal(counts, 1);
  release({ inbox: 3 });
  await kept[0];
  assert.equal(refresh.current, undefined);
  assert.deepEqual(read(Date.now()), { inbox: 3, pending: false });
  assert.equal(counts, 1);
});

test("старый счётчик показывается, пока пересчитывается; очень старый и чужой не показываются", () => {
  const storage = memory(), refresh: { current?: Promise<void> } = {};
  const count = () => new Promise<{ inbox: number }>(() => {});
  const now = 1_000_000_000;
  storage.put(MENU_INBOX_KEY, { userId: "alice", inbox: 7, at: now - MENU_COUNT_REFRESH_MS - 1 });
  assert.deepEqual(menuInboxCount({ storage, userId: "alice", now, count, refresh, keepAlive: () => {} }), { inbox: 7, pending: true });
  storage.put(MENU_INBOX_KEY, { userId: "alice", inbox: 7, at: now - MENU_COUNT_MAX_AGE_MS - 1 });
  assert.deepEqual(menuInboxCount({ storage, userId: "alice", now, count, refresh, keepAlive: () => {} }), { inbox: undefined, pending: true });
  storage.put(MENU_INBOX_KEY, { userId: "bob", inbox: 7, at: now });
  assert.deepEqual(menuInboxCount({ storage, userId: "alice", now, count, refresh, keepAlive: () => {} }), { inbox: undefined, pending: true });
});

test("сбой подсчёта не сохраняет ноль и не оставляет зависший пересчёт", async () => {
  const storage = memory(), refresh: { current?: Promise<void> } = {}, kept: Promise<void>[] = [];
  menuInboxCount({ storage, userId: "alice", now: Date.now(), count: async () => { throw Error("медленно"); }, refresh, keepAlive: w => kept.push(w) });
  await kept[0];
  assert.equal(storage.data.size, 0);
  assert.equal(refresh.current, undefined);
  menuInboxCount({ storage, userId: "alice", now: Date.now(), count: async () => undefined, refresh, keepAlive: w => kept.push(w) });
  await kept[1];
  assert.equal(storage.data.size, 0);
});
