import { test } from "node:test";
import assert from "node:assert/strict";
import { MnemosAccount, type AccountStorage } from "./account-session.ts";

function storage(): AccountStorage {
  const values = new Map<string, unknown>();
  return { get: <T>(key: string) => values.get(key) as T | undefined,
    put: (key, value) => { values.set(key, value); }, delete: key => { values.delete(key); } };
}

test("publication observer uses their own credential, checks the exact event and refuses stale responses", async () => {
  const resource = "https://memory.example/v1/projects/project/nodes/document";
  let status = 200, calls = 0;
  let disconnectDuringCheck = false, wrongEvent = false;
  const account = new MnemosAccount(storage(), "https://memory.example", async (input, init) => {
    calls++;
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer observer-token");
    const path = new URL(String(input)).pathname;
    if (path === "/v1/whoami") return Response.json({ subject: { tenant_id: "org", user_id: "observer" } });
    assert.equal(path, "/v1/projects/project/nodes/document/history/event/access");
    assert.equal(init?.method, "GET");
    if (disconnectDuringCheck) account.disconnect();
    return Response.json({ node_id: "document", event_id: wrongEvent ? "other" : "event" }, { status });
  });
  await account.connect("observer-token");
  assert.equal(await account.canReadPublication(resource, "event", "org"), true);
  assert.equal(calls, 2);
  assert.equal(await account.canReadPublication(resource, "event", "other-tenant"), false);
  assert.equal(calls, 2, "matching document coordinates in another tenant must not grant access");
  for (const denied of [401, 403, 404]) {
    status = denied;
    assert.equal(await account.canReadPublication(resource, "event", "org"), false);
  }
  for (const transient of [429, 500, 503]) {
    status = transient;
    await assert.rejects(account.canReadPublication(resource, "event", "org"), { status: transient });
  }
  status = 200; wrongEvent = true;
  await assert.rejects(account.canReadPublication(resource, "event", "org"), { status: 502 });
  wrongEvent = false;
  const beforeInvalid = calls;
  await assert.rejects(account.canReadPublication(resource, "../other", "org"));
  assert.equal(calls, beforeInvalid);
  disconnectDuringCheck = true;
  assert.equal(await account.canReadPublication(resource, "event", "org"), false);
  const before = calls;
  assert.equal(await account.canReadPublication(resource, "event", "org"), false);
  await assert.rejects(account.canReadPublication(resource.replace("memory.example", "other.example"), "event", "org"));
  assert.equal(calls, before);
});
