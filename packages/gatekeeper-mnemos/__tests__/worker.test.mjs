import { test } from "node:test";
import assert from "node:assert/strict";
import { Miniflare } from "miniflare";
import { fileURLToPath } from "node:url";

test("real Worker RPC keeps account credentials private and revokes issued sessions", async () => {
  let upstreamCalls = 0, saves = 0, publications = 0;
  let personal = "a".repeat(64);
  const shared = "b".repeat(64);
  const mf = new Miniflare({
    workers: [
      {
        name: "mnemos", modules: true,
        modulesRules: [{ type: "Text", include: ["**/*.txt"] }],
        scriptPath: fileURLToPath(new URL("../dist/mnemos.js", import.meta.url)),
        compatibilityDate: "2026-02-02", compatibilityFlags: ["allow_irrevocable_stub_storage", "nodejs_compat"],
        bindings: { MNEMOS_API_ORIGIN: "https://memory.example", MNEMOS_STORAGE_ORIGIN: "https://objects.example" },
        durableObjects: { ACCOUNTS: { className: "UserAccount", useSQLite: true } },
        outboundService: async request => {
          upstreamCalls++;
          const path = new URL(request.url).pathname;
          assert.equal(new URL(request.url).origin, "https://memory.example");
          assert.equal(request.headers.get("Authorization"), "Bearer fixture-human-token");
          if (path === "/v1/projects/project/draft/open") { assert.equal(request.method, "POST"); return Response.json({ head: personal }); }
          if (path === "/v1/projects/project/draft/state") return Response.json({ personal_head: personal, shared_head: shared, personal_exists: true });
          if (path === "/v1/projects/project/draft/save") {
            const body = await request.json();
            if (body.expected_head !== personal) return new Response("head moved", { status: 409 });
            assert.deepEqual(body.changes, [{ node_id: "doc", upload_id: "upload" }]);
            saves++; personal = "c".repeat(64); return Response.json({ head: personal });
          }
          if (path === "/v1/projects/project/draft/publish") {
            const body = await request.json();
            assert.deepEqual(body, { expected_head: personal, expected_shared_head: shared, message: "Reviewed" });
            publications++; return Response.json({ personal_head: personal, shared_head: personal, published: true, conflicted: false });
          }
          if (new URL(request.url).pathname === "/v1/uploads") {
            assert.equal(request.method, "POST");
            assert.equal(request.headers.get("Authorization"), "Bearer fixture-human-token");
            const body = await request.json();
            assert.deepEqual(body, { project_id: "project", size_bytes: 4, checksum_sha256: "A".repeat(43) + "=" });
            return Response.json({ upload_id: "upload", url: "https://objects.example/object", method: "PUT", checksum_header: "x-amz-checksum-sha256", checksum_value: body.checksum_sha256, content_length: 4 });
          }
          assert.equal(new URL(request.url).origin, "https://memory.example");
          assert.equal(request.headers.get("Authorization"), "Bearer fixture-human-token");
          if (new URL(request.url).pathname === "/v1/projects/project/nodes/doc/history/event/download") return Response.json({ event_id: "event", node_id: "doc", content_type: "text/plain", url: "https://objects.example/object", method: "GET", size_bytes: 4, sha256_hex: "b".repeat(64) });
          if (path === "/v1/projects/project/nodes/doc/history/native-event/download") return Response.json({ event_id: "native-event", node_id: "doc", content_type: "application/vnd.cloudflareos.document+json", url: "https://objects.example/native", method: "GET", size_bytes: 400000, sha256_hex: "c".repeat(64) });
          if (new URL(request.url).pathname === "/v1/projects/project/nodes/doc/history") {
            assert.ok(["1", "50"].includes(new URL(request.url).searchParams.get("limit")));
            return Response.json({ events: [] });
          }
          if (new URL(request.url).pathname === "/v1/projects/project/draft/nodes/doc/download") {
            assert.deepEqual(await request.json(), { expected_head: "a".repeat(64), term_index: 0 });
            return Response.json({ head: "a".repeat(64), node_id: "doc", term_index: 0, url: "https://objects.example/object", method: "GET", size_bytes: 4, sha256_hex: "b".repeat(64) });
          }
          if (new URL(request.url).pathname === "/v1/projects/project/draft/nodes/doc") return Response.json({ head: "a".repeat(64), node_id: "doc", exists: true });
          if (new URL(request.url).pathname === "/v1/whoami") return Response.json({ subject: { tenant_id: "org", user_id: "alice" }, tenant_name: "Example team" });
          if (new URL(request.url).pathname === "/v1/projects") return Response.json({ projects: [{ id: "project", name: "Shared project", slug: "shared" }] });
          if (new URL(request.url).pathname === "/v1/projects/project/nodes") return Response.json({ nodes: [{ node_id: "doc", name: "Team note", is_dir: false }], truncated: false });
          if (new URL(request.url).pathname === "/v1/nodes/doc/content") return Response.json({ node_id: "doc", text: "Shared knowledge", media_type: "text/plain", truncated: false });
          return Response.json({ connections: [{ binding_id: "fixture-agent" }] });
        },
      },
      {
        name: "driver", modules: true, compatibilityDate: "2026-02-02", compatibilityFlags: ["allow_irrevocable_stub_storage", "nodejs_compat"],
        durableObjects: { ACCOUNTS: { className: "UserAccount", scriptName: "mnemos", useSQLite: true } },
        script: `export default { async fetch(request, env) {
          const account = env.ACCOUNTS.get(env.ACCOUNTS.idFromName("owner"));
          await account.acceptVerifiedCredential("fixture-human-token");
          const frame = await account.startAppUi();
          const session = frame.ui;
          const safeHtml = frame.iframeHtml.includes("<main") && !frame.iframeHtml.includes("fixture-human-token");
          let credentialMethodRejected = false;
          try { await session.acceptVerifiedCredential("unexpected"); } catch { credentialMethodRejected = true; }
          const identity = await session.whoAmI();
          const projects = await session.listProjects();
          const contextOK = identity.subject.user_id === "alice" && projects.projects[0].id === "project";
          const nodes = await session.browseProject("project", "");
          const content = await session.readDocument(nodes.nodes[0].node_id);
          const documentOK = content.text === "Shared knowledge";
          const page = await session.listAgentConnections();
          const ticket = await frame.textUploads.issuer.issue("project", 4, "A".repeat(43) + "=");
          let issuerHidden = false;
          try { await session.issue("project", 4, "A".repeat(43) + "="); } catch { issuerHidden = true; }
          const uploadOK = ticket.upload_id === "upload" && frame.textUploads.storageOrigin === "https://objects.example" && issuerHidden;
          const opened = await session.openDraft("project");
          const draft = await session.readDraftDocument("project", "doc");
          const draftOK = opened.head === draft.head;
          const download = await frame.textDownloads.issuer.issue("project", "doc", "a".repeat(64), 0);
          await frame.textDownloads.issuer.validate("project", "doc", "a".repeat(64));
          const historic = await frame.textDownloads.issuer.issue("project", "doc", "publication:event", 0);
          await frame.textDownloads.issuer.validate("project", "doc", "publication:event");
          let invalidSideRejected = false;
          try { await frame.textDownloads.issuer.issue("project", "doc", "publication:event", 1); } catch { invalidSideRejected = true; }
          const downloadOK = download.method === "GET" && download.node_id === "doc" && historic.method === "GET" && !historic.event_id && invalidSideRejected;
          const selected = await frame.nativeDownloads.selector.select("project", "doc", "native-event");
          const native = await selected.issue();
          await selected.validate();
          let selectorHidden = false, scopeChangeRejected = false, invalidSelectionRejected = false;
          try { await session.select("project", "doc", "native-event"); } catch { selectorHidden = true; }
          try { await selected.select("other", "other", "event"); } catch { scopeChangeRejected = true; }
          try { await frame.nativeDownloads.selector.select("project", "doc", "../event"); } catch { invalidSelectionRejected = true; }
          const nativeOK = native.content_type === "application/vnd.cloudflareos.document+json" && native.size_bytes === 400000 &&
            !native.node_id && !native.event_id && selectorHidden && scopeChangeRejected && invalidSelectionRejected;
          const saved = await session.saveDraftDocument("project", "doc", "upload", draft.head);
          let conflictRejected = false;
          try { await session.saveDraftDocument("project", "doc", "upload", draft.head); } catch { conflictRejected = true; }
          const state = await session.draftState("project");
          const published = await session.publishDraft("project", state.personal_head, state.shared_head, "Reviewed");
          const editOK = draftOK && saved.head === state.personal_head && conflictRejected && published.published;
          await account.revoke();
          let nativeRevoked = false, nativeIssueRevoked = false;
          try { await selected.validate(); } catch { nativeRevoked = true; }
          try { await selected.issue(); } catch { nativeIssueRevoked = true; }
          let writeRevoked = false;
          try { await session.saveDraftDocument("project", "doc", "upload", saved.head); } catch { writeRevoked = true; }

          let downloadRevoked = false;
          try { await frame.textDownloads.issuer.validate("project", "doc", "a".repeat(64)); } catch { downloadRevoked = true; }

          let uploadRevoked = false;
          try { await frame.textUploads.issuer.issue("project", 4, "A".repeat(43) + "="); } catch { uploadRevoked = true; }

          let oldRejected = false, newRejected = false;
          try { await session.listAgentConnections(); } catch { oldRejected = true; }
          try { await account.openManagementSession(); } catch { newRejected = true; }
          return Response.json({ page, oldRejected, newRejected, safeHtml, credentialMethodRejected, contextOK, documentOK, uploadOK, uploadRevoked, downloadOK, downloadRevoked, editOK, writeRevoked, nativeOK, nativeRevoked, nativeIssueRevoked });
        }};`,
      },
    ],
  });
  try {
    const worker = await mf.getWorker("driver");
    const response = await worker.fetch("https://driver.example/");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { page: { connections: [{ binding_id: "fixture-agent" }] }, oldRejected: true, newRejected: true, safeHtml: true, credentialMethodRejected: true, contextOK: true, documentOK: true, uploadOK: true, uploadRevoked: true, downloadOK: true, downloadRevoked: true, editOK: true, writeRevoked: true, nativeOK: true, nativeRevoked: true, nativeIssueRevoked: true });
    // Selection, issuance and post-transfer check add three calls. Revoked and malformed calls add none.
    assert.equal(upstreamCalls, 20);
    assert.equal(saves, 1); assert.equal(publications, 1);
    const publicWorker = await mf.getWorker("mnemos");
    assert.equal((await publicWorker.fetch("https://worker.example/")).status, 404);
  } finally { await mf.dispose(); }
});

test("Worker login installs the verified human and revocation fences an in-flight exchange", async () => {
  const login = { iamOrigin: "https://iam.example", authorizationEndpoint: "https://provider.example/auth", tokenEndpoint: "https://provider.example/token", clientId: "client", clientSecret: "private-provider-secret", iamClientSecret: "s".repeat(40), callbackUrl: "https://connector.example/callback" };
  let hold = false, release, entered;
  let exchanges = 0;
  const mf = new Miniflare({ workers: [{
    name: "mnemos", modules: true, modulesRules: [{ type: "Text", include: ["**/*.txt"] }],
    scriptPath: fileURLToPath(new URL("../dist/mnemos.js", import.meta.url)), compatibilityDate: "2026-02-02", compatibilityFlags: ["allow_irrevocable_stub_storage", "nodejs_compat"],
    bindings: { MNEMOS_API_ORIGIN: "https://memory.example", MNEMOS_LOGIN_CONFIG: JSON.stringify(login) },
    durableObjects: { ACCOUNTS: { className: "UserAccount", useSQLite: true } },
    outboundService: async request => {
      if (request.url === login.iamOrigin + "/v1/session/request") return Response.json({ state: "proof-state", nonce: "nonce", expires_in_ms: 300000 });
      if (request.url === login.tokenEndpoint) {
        exchanges++;
        const form = new URLSearchParams(await request.text());
        assert.equal(form.get("code"), "provider-code");
        assert.equal(form.get("redirect_uri"), login.callbackUrl);
        assert.ok(form.get("code_verifier"));
        if (hold) { entered(); await new Promise(resolve => { release = resolve; }); }
        return Response.json({ id_token: "provider-proof" });
      }
      if (request.url === login.iamOrigin + "/v1/session/credential") {
        assert.equal(request.headers.get("Authorization"), "Bearer " + login.iamClientSecret);
        assert.deepEqual(await request.json(), { state: "proof-state", id_token: "provider-proof" });
        return Response.json({ access_token: "verified-human", token_type: "Bearer", expires_in: 900 });
      }
      assert.equal(request.url, "https://memory.example/v1/whoami");
      assert.equal(request.headers.get("Authorization"), "Bearer verified-human");
      return Response.json({ subject: { tenant_id: "org", user_id: "alice" } });
    },
  }, {
    name: "driver", modules: true, compatibilityDate: "2026-02-02", compatibilityFlags: ["allow_irrevocable_stub_storage", "nodejs_compat"],
    durableObjects: { ACCOUNTS: { className: "UserAccount", scriptName: "mnemos", useSQLite: true }, RECEIPTS: { className: "Receipt", useSQLite: true } },
    serviceBindings: { VENDOR: { name: "mnemos", entrypoint: "GatekeeperVendor" } },
    script: `import { WorkerEntrypoint, DurableObject } from "cloudflare:workers";
    export class Receipt extends DurableObject {
      async complete(user, expiresAt) {
        this.ctx.storage.kv.put("user", user);
        this.ctx.storage.kv.put("expiresAt", expiresAt);
        this.ctx.storage.kv.put("completions", (this.ctx.storage.kv.get("completions") || 0) + 1);
        if (this.ctx.storage.kv.get("fail")) throw new Error("Fixture callback interrupted after persistence");
      }
      async failNext() { this.ctx.storage.kv.put("fail", true); }
      async restored(expiresAt) { this.ctx.storage.kv.put("expiresAt", expiresAt); this.ctx.storage.kv.put("restored", true); }
      async snapshot() {
        const user = this.ctx.storage.kv.get("user");
        const description = await user.describe();
        const frame = await user.startAppUi({ isAdmin: false });
        const identity = await frame.ui.whoAmI();
        frame.ui[Symbol.dispose]();
        return { description, identity, expiresAt: this.ctx.storage.kv.get("expiresAt"), completions: this.ctx.storage.kv.get("completions"), restored: this.ctx.storage.kv.get("restored") || false };
      }
      async reconnect() { return this.ctx.storage.kv.get("user").reconnect(); }
      async revoke() { await this.ctx.storage.kv.get("user").revoke(); }
    }
    export class Callback extends WorkerEntrypoint {
      receipt() { return this.env.RECEIPTS.get(this.env.RECEIPTS.idFromName("receipt")); }
      async complete(user, expiresAt) { await this.receipt().complete(user, expiresAt); }
      async credentialsRestored(expiresAt) { await this.receipt().restored(expiresAt); }
      async credentialsExpired() {}
    }
    export default { async fetch(request, env, ctx) {
      const account = env.ACCOUNTS.get(env.ACCOUNTS.idFromName("login-owner"));
      const receipt = env.RECEIPTS.get(env.RECEIPTS.idFromName("receipt"));
      try {
        switch (new URL(request.url).pathname) {
          case "/vendor": return Response.json(await env.VENDOR.connectAccount(ctx.exports.Callback({ props: {} })));
          case "/receipt": return Response.json(await receipt.snapshot());
          case "/reconnect": return Response.json(await receipt.reconnect());
          case "/fail-next": await receipt.failNext(); return Response.json({ ready: true });
          case "/disconnect": await receipt.revoke(); return Response.json({ revoked: true });
          case "/prepare": return Response.json({ id: env.ACCOUNTS.idFromName("login-owner").toString(), nonce: await account.prepareBrowserLogin() });
          case "/begin": return Response.json({ url: await account.beginLogin() });
          case "/complete": await account.completeLogin("proof-state", "provider-code"); return Response.json({ connected: true });
          case "/revoke": await account.revoke(); return Response.json({ revoked: true });
          default: { using session = await account.openManagementSession(); return Response.json(await session.whoAmI()); }
        }
      } catch (error) { return Response.json({ error: error.message }, { status: 403 }); }
    }};`,
  }] });
  try {
    const worker = await mf.getWorker("driver");
    const call = path => worker.fetch("https://driver.example" + path);
    const begin = await (await call("/begin")).json();
    assert.equal(begin.error, undefined);
    assert.equal(new URL(begin.url).searchParams.get("state"), "proof-state");
    assert.ok(!begin.url.includes(login.clientSecret));
    assert.deepEqual(await (await call("/complete")).json(), { connected: true });
    assert.equal((await (await call("/identity")).json()).subject.user_id, "alice");
    assert.equal((await call("/complete")).status, 403);
    await call("/revoke");
    assert.equal((await call("/identity")).status, 403);
    await call("/begin");
    hold = true;
    const waiting = new Promise(resolve => { entered = resolve; });
    const completion = call("/complete");
    await waiting;
    await call("/revoke");
    release();
    assert.equal((await completion).status, 403);
    assert.equal((await call("/identity")).status, 403);
    assert.equal(exchanges, 2);
    hold = false;
    const prepared = await (await call("/prepare")).json();
    const publicWorker = await mf.getWorker("mnemos");
    const startUrl = login.callbackUrl + "/start/" + prepared.id + "/" + prepared.nonce;
    const startResponse = await publicWorker.fetch(startUrl, { redirect: "manual" });
    assert.equal(startResponse.status, 302);
    assert.equal((await publicWorker.fetch(startUrl, { redirect: "manual" })).status, 403);
    const cookie = startResponse.headers.get("Set-Cookie").split(";")[0];
    const callbackUrl = login.callbackUrl + "?state=proof-state&code=provider-code";
    assert.equal((await publicWorker.fetch(callbackUrl)).status, 403);
    const completed = await publicWorker.fetch(callbackUrl, { headers: { Cookie: cookie } });
    assert.equal(completed.status, 200);
    assert.equal((await publicWorker.fetch(callbackUrl, { headers: { Cookie: cookie } })).status, 403);
    assert.equal((await (await call("/identity")).json()).subject.user_id, "alice");
    assert.equal(exchanges, 3);
    const connect = await (await call("/vendor")).json();
    assert.equal(connect.error, undefined);
    assert.ok(connect.url);
    const finish = async url => {
      const started = await publicWorker.fetch(url, { redirect: "manual" });
      assert.equal(started.status, 302);
      const cookie = started.headers.get("Set-Cookie").split(";")[0];
      return publicWorker.fetch(callbackUrl, { headers: { Cookie: cookie } });
    };
    assert.equal((await finish(connect.url)).status, 200);
    const receipt = await (await call("/receipt")).json();
    assert.equal(receipt.description.providesUi.title, "Память");
    assert.equal(receipt.identity.subject.user_id, "alice");
    assert.equal(receipt.completions, 1);
    assert.ok(Date.parse(receipt.expiresAt) > Date.now());
    assert.ok(Date.parse(receipt.expiresAt) <= Date.now() + 900000);
    const reconnect = await (await call("/reconnect")).json();
    assert.equal((await finish(reconnect.url)).status, 200);
    const restored = await (await call("/receipt")).json();
    assert.equal(restored.completions, 1); assert.equal(restored.restored, true);
    await call("/disconnect");
    assert.equal((await call("/receipt")).status, 403);
    assert.equal((await call("/reconnect")).status, 403);
    await call("/fail-next");
    const failedConnect = await (await call("/vendor")).json();
    assert.equal((await finish(failedConnect.url)).status, 403);
    assert.equal((await call("/receipt")).status, 403);
  } finally { release?.(); await mf.dispose(); }
});

test("native writer scopes saves to one personal document and fences head and account changes", async () => {
  let saves = 0, uploads = 0; const accesses=[];
  let head = 'a'.repeat(64);
  const mf = new Miniflare({ workers: [{
    name: 'mnemos', modules: true, modulesRules: [{ type: 'Text', include: ['**/*.txt'] }],
    scriptPath: fileURLToPath(new URL('../dist/mnemos.js', import.meta.url)),
    compatibilityDate: '2026-02-02', compatibilityFlags: ['allow_irrevocable_stub_storage', 'nodejs_compat'],
    bindings: { MNEMOS_API_ORIGIN: 'https://memory.example', MNEMOS_STORAGE_ORIGIN: 'https://objects.example' },
    durableObjects: { ACCOUNTS: { className: 'UserAccount', useSQLite: true } },
    outboundService: async request => {
      assert.equal(request.headers.get('Authorization'), 'Bearer fixture-human');
      const path = new URL(request.url).pathname; accesses.push(path);
      if (path === '/v1/whoami') return Response.json({ subject: { tenant_id: 'org', user_id: 'alice' } });
      if (path === '/v1/projects') return Response.json({ projects: [{ id: 'project', name: 'Team' }] });
      if (path === '/v1/projects/project/draft/documents') return Response.json({head, documents:[{node_id:'doc',name:'Native',content_type:'application/vnd.cloudflareos.document+json',conflicted:false}],next_cursor:''});
      if (path === '/v1/projects/project/nodes') return Response.json({ nodes: [{ node_id: 'doc', name: 'Native', is_dir: false }], truncated: false });
      if (path === '/v1/projects/project/nodes/doc/history') return Response.json({ events: [] });
      if (path === '/v1/projects/project/draft/open') return Response.json({ head });
      if (path === '/v1/projects/project/draft/nodes/doc') return Response.json({ head, node_id: 'doc', exists: true, conflicted: false, content_type: 'application/vnd.cloudflareos.document+json' });
      if (path === '/v1/uploads') {
        const body = await request.json();
        assert.deepEqual(body, { project_id: 'project', size_bytes: 300000, checksum_sha256: 'A'.repeat(43) + '=' });
        uploads++;
        return Response.json({ upload_id: 'native-upload', url: 'https://objects.example/native', method: 'PUT', checksum_header: 'x-amz-checksum-sha256', checksum_value: body.checksum_sha256, content_length: 300000 });
      }
      if (path === '/v1/projects/project/draft/save') {
        const body = await request.json();
        assert.deepEqual(body, { expected_head: head, message: 'Edit document', changes: [{ node_id: 'doc', upload_id: 'native-upload' }] });
        saves++; head = 'b'.repeat(64); return Response.json({ head });
      }
      assert.fail('Unexpected access or publication');
    },
  }, {
    name: 'driver', modules: true, compatibilityDate: '2026-02-02', compatibilityFlags: ['allow_irrevocable_stub_storage', 'nodejs_compat'],
    durableObjects: { ACCOUNTS: { className: 'UserAccount', scriptName: 'mnemos', useSQLite: true } },
    script: `export default { async fetch(request, env) {
      const account = env.ACCOUNTS.get(env.ACCOUNTS.idFromName('native-writer'));
      await account.acceptVerifiedCredential('fixture-human');
      const frame = await account.startAppUi(), selector = frame.nativeWrites.selector;
      const scopes = await selector.scopes(), documents = await selector.documents('project', '');
      let wrongFormat = false;
      try { await selector.select('project', 'doc', 'cloudflareos.spreadsheet'); } catch { wrongFormat = true; }
      const writer = await selector.select('project', 'doc', 'cloudflareos.document');
      const expected = await writer.head();
      const ticket = await writer.issue(expected, 300000, 'A'.repeat(43) + '=');
      let oversize = false, hidden = false;
      try { await writer.issue(expected, 4194305, 'A'.repeat(43) + '='); } catch { oversize = true; }
      try { await frame.ui.select('project', 'doc', 'cloudflareos.document'); } catch { hidden = true; }
      const saved = await writer.save(expected, ticket.upload_id);
      let moved = false;
      try { await writer.save(expected, ticket.upload_id); } catch { moved = true; }
      await account.revoke();
      let revoked = false;
      try { await writer.save(saved, ticket.upload_id); } catch { revoked = true; }
      return Response.json({ scopes: scopes.scopes[0].name, document: documents.documents[0].name,
        saved: saved === 'b'.repeat(64), wrongFormat, oversize, hidden, moved, revoked });
    } };`,
  }] });
  try {
    const response = await (await mf.getWorker('driver')).fetch('https://driver.example/');
    assert.deepEqual(await response.json(), { scopes: 'Team', document: 'Native', saved: true,
      wrongFormat: true, oversize: true, hidden: true, moved: true, revoked: true });
    assert.equal(saves, 1); assert.equal(uploads, 1);
  } catch(error) {throw new Error("Native fixture accesses: "+JSON.stringify(accesses),{cause:error});} finally { await mf.dispose(); }
});
