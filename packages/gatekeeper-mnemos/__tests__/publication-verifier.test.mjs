import { test } from "node:test";
import assert from "node:assert/strict";
import { Miniflare } from "miniflare";
import { fileURLToPath } from "node:url";

test("persistent Worker verifier checks observer credentials and follows revoke/reconnect", async () => {
  const seen = [];
  const mf = new Miniflare({ workers: [{
    name: "mnemos", modules: true,
    modulesRules: [{ type: "Text", include: ["**/*.txt"] }],
    scriptPath: fileURLToPath(new URL("../dist/mnemos.js", import.meta.url)),
    compatibilityDate: "2026-02-02", compatibilityFlags: ["allow_irrevocable_stub_storage", "nodejs_compat"],
    bindings: { MNEMOS_API_ORIGIN: "https://memory.example" },
    durableObjects: { ACCOUNTS: { className: "UserAccount", useSQLite: true } },
    outboundService: async request => {
      const path = new URL(request.url).pathname;
      const token = request.headers.get("Authorization");
      if (path === "/v1/whoami") return Response.json({ subject: { tenant_id: "org", user_id: token === "Bearer owner" ? "owner" : "observer" } });
      seen.push(token);
      assert.equal(path, "/v1/projects/project/nodes/document/history/event/access");
      assert.equal(request.method, "GET");
      if (token === "Bearer observer-denied") return new Response(null, { status: 403 });
      return Response.json({ node_id: "document", event_id: "event" });
    },
  }, {
    name: "driver", modules: true, compatibilityDate: "2026-02-02", compatibilityFlags: ["allow_irrevocable_stub_storage", "nodejs_compat"],
    durableObjects: { ACCOUNTS: { className: "UserAccount", scriptName: "mnemos", useSQLite: true } },
    script: `export default { async fetch(request, env) {
      const owner = env.ACCOUNTS.get(env.ACCOUNTS.idFromName("owner"));
      const observer = env.ACCOUNTS.get(env.ACCOUNTS.idFromName("observer"));
      await owner.acceptVerifiedCredential("owner");
      await observer.acceptVerifiedCredential("observer-denied");
      const verifier = await observer.getVerifier();
      const resource = "https://memory.example/v1/projects/project/nodes/document";
      const denied = await verifier.canReadPublication(resource, "event", "org");
      await observer.acceptVerifiedCredential("observer-allowed");
      const allowed = await verifier.canReadPublication(resource, "event", "org");
      await observer.revoke();
      const revoked = await verifier.canReadPublication(resource, "event", "org");
      let hidden = false;
      try { await verifier.acceptVerifiedCredential("owner"); } catch { hidden = true; }
      return Response.json({ denied, allowed, revoked, hidden });
    }};`,
  }] });
  try {
    const driver = await mf.getWorker("driver");
    const response = await driver.fetch("https://driver.example/");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { denied: false, allowed: true, revoked: false, hidden: true });
    assert.deepEqual(seen, ["Bearer observer-denied", "Bearer observer-allowed"]);
  } finally { await mf.dispose(); }
});
