import { test } from "node:test";
import assert from "node:assert/strict";
import { MnemosAccount, type AccountStorage } from "./account-session.ts";
const human = { subject: { tenant_id: "org", user_id: "alice" } };
function storage(): AccountStorage {
  const map = new Map<string, unknown>();
  return { get: <T>(key: string) => map.get(key) as T | undefined, put: (key, value) => { map.set(key, value); }, delete: key => { map.delete(key); } };
}
test("disconnect invalidates sessions and suppresses an in-flight result", async () => {
  let finish!: (r: Response) => void; let count = 0;
  const account = new MnemosAccount(storage(), "https://memory.example", async () => {
    if (++count === 1) return Response.json(human);
    return new Promise(resolve => { finish = resolve; });
  });
  await account.connect("human-token"); const session = account.session();
  const pending = session.listAgentConnections();
  await new Promise(resolve => setTimeout(resolve, 0));
  account.disconnect(); finish(Response.json({ connections: [{ binding_id: "private" }] }));
  await assert.rejects(pending); await assert.rejects(session.listAgentConnections());
  assert.throws(() => account.session()); assert.equal(count, 2);
});
test("disconnect during credential verification cannot resurrect the account", async () => {
  let finish!: (r: Response) => void;
  const account = new MnemosAccount(storage(), "https://memory.example", async () => new Promise(resolve => { finish = resolve; }));
  const connecting = account.connect("candidate"); await new Promise(resolve => setTimeout(resolve, 0));
  account.disconnect(); finish(Response.json(human));
  await assert.rejects(connecting); assert.throws(() => account.session());
});
test("credential rejection is not stored and disposal stops further requests", async () => {
  let accepted = false; let calls = 0;
  const account = new MnemosAccount(storage(), "https://memory.example", async () => { calls++; return Response.json(human, { status: accepted ? 200 : 403 }); });
  await assert.rejects(account.connect("agent-token")); assert.throws(() => account.session());
  accepted = true; await account.connect("human-token");
  const session = account.session(); session.dispose();
  await assert.rejects(session.revokeAgentConnection("binding")); assert.equal(calls, 2);
});
test("draft ticket is tied to the requested node, head and conflict side", async () => {
  const head = "a".repeat(64);
  let result: Record<string, unknown> = { node_id: "doc", head, term_index: 0 };
  const account = new MnemosAccount(storage(), "https://memory.example", async (url, init) => {
    if (String(url).endsWith("/whoami")) return Response.json(human);
    if (String(url).endsWith("/download")) {
      assert.deepEqual(JSON.parse(String(init?.body)), { expected_head: head, term_index: 0 });
    }
    return Response.json(result);
  });
  await account.connect("human-token");
  const session = account.session();
  assert.equal((await session.beginDraftDownload("project", "doc", head, 0)).head, head);
  for (const change of [{ node_id: "other" }, { head: "b".repeat(64) }, { term_index: 2 }]) {
    result = { node_id: "doc", head, term_index: 0, ...change };
    await assert.rejects(session.beginDraftDownload("project", "doc", head, 0));
  }
  result = { node_id: "other", head };
  await assert.rejects(session.readDraftDocument("project", "doc"));
  session.dispose();
});

test("reconnect cannot change the owner and expired credentials never make requests", async (t) => {
  const kv = storage(); let calls = 0;
  const account = new MnemosAccount(kv, "https://memory.example", async (_url, init) => {
    calls++;
    const bearer = new Headers(init?.headers).get("Authorization");
    return Response.json({ subject: { tenant_id: "org", user_id: bearer === "Bearer other" ? "bob" : "alice", ...(bearer === "Bearer agent" ? { agent_principal_id: "agent" } : {}) } });
  });
  const now = Date.now(); await account.connect("original", now + 60000);
  const session = account.session();
  await assert.rejects(account.connect("other")); await assert.rejects(account.connect("agent"));
  assert.equal((await session.whoAmI()).subject.user_id, "alice");
  const before = calls;
  t.mock.method(Date, "now", () => now + 60001);
  await assert.rejects(session.whoAmI()); assert.throws(() => account.session()); assert.equal(calls, before);
  account.disconnect();
  await assert.rejects(account.connect("other"));
  await account.connect("original");
  assert.equal((await account.session().whoAmI()).subject.user_id, "alice");
});

test("search refuses foreign-project results and returns only the displayed fields", async () => {
  let project = "other";
  const account = new MnemosAccount(storage(), "https://memory.example", async url => {
    if (String(url).endsWith("/whoami")) return Response.json(human);
    return Response.json({ hits: [{ project_id: project, node_id: "doc", name: "Note", text: "found", ordinal: 1, internal: "not for UI" }], index_pending: true, degraded: false, databases: [{ name: "unrelated" }] });
  });
  await account.connect("human-token");
  const session = account.session();
  await assert.rejects(session.searchProject("one", "query"));
  project = "one";
  assert.deepEqual(await session.searchProject("one", "query"), { hits: [{ project_id: "one", node_id: "doc", name: "Note", text: "found", ordinal: 1 }], index_pending: true, degraded: false });
  account.disconnect();
  await assert.rejects(session.searchProject("one", "query"));
});

test("review tickets bind the document side and version before reaching the host", async () => {
  const review = "a".repeat(64);
  let ticket = { review_id: review, node_id: "doc", side: "after", decision_version: 3, present: true,
    content_type: "text/plain", url: "https://objects.example/file", method: "GET", size_bytes: 4, sha256_hex: "b".repeat(64) };
  let connected = false;
  const account = new MnemosAccount(storage(), "https://memory.example", async () => {
    if (!connected) { connected = true; return Response.json(human); }
    return Response.json(ticket);
  });
  await account.connect("human-token"); const session = account.session();
  assert.equal((await session.beginReviewDownload(review, "doc", 3, "after"))?.url, ticket.url);
  for (const change of [{ node_id: "other" }, { review_id: "c".repeat(64) }, { decision_version: 4 }, { side: "before" }, { content_type: "application/octet-stream" }]) {
    const original = ticket; ticket = { ...ticket, ...change };
    await assert.rejects(session.beginReviewDownload(review, "doc", 3, "after")); ticket = original;
  }
  ticket = { ...ticket, present: false };
  assert.equal(await session.beginReviewDownload(review, "doc", 3, "after"), null);
  account.disconnect(); await assert.rejects(session.beginReviewDownload(review, "doc", 3, "after"));
});


test("native review sides bind identity, version and format without widening text previews", async () => {
  const review = "a".repeat(64);
  let ticket = { review_id: review, node_id: "doc", side: "after", decision_version: 3, present: true,
    content_type: "application/vnd.cloudflareos.document+json", url: "https://objects.example/file", method: "GET", size_bytes: 4, sha256_hex: "b".repeat(64) };
  let denied = false, version = 3;
  const account = new MnemosAccount(storage(), "https://memory.example", async url => {
    if (String(url).endsWith("/whoami")) return Response.json(human);
    if (denied) return Response.json({}, { status: 403 });
    if (String(url).endsWith("/download")) return Response.json(ticket);
    return Response.json({ candidate_id: review, decision_version: version, domains: [{ node_ids: ["doc"] }] });
  });
  await account.connect("human-token"); const session = account.session();
  const get = () => session.beginNativeReviewDownload(review, "doc", 3, "after", "cloudflareos.document");
  assert.equal((await get())?.content_type, ticket.content_type);
  await assert.rejects(session.beginReviewDownload(review, "doc", 3, "after"));
  for (const change of [{ node_id: "other" }, { review_id: "c".repeat(64) }, { decision_version: 4 }, { side: "before" }, { content_type: "application/json" }, { content_type: "application/vnd.cloudflareos.spreadsheet+json" }]) {
    const original = ticket; ticket = { ...ticket, ...change };
    await assert.rejects(get()); ticket = original;
  }
  ticket.content_type = "application/vnd.cloudflareos.spreadsheet+json";
  assert.ok(await session.beginNativeReviewDownload(review, "doc", 3, "after", "cloudflareos.spreadsheet"));
  await session.validateReviewDownload(review, "doc", 3);
  version = 4; await assert.rejects(session.validateReviewDownload(review, "doc", 3));
  ticket.present = false; assert.equal(await get(), null);
  denied = true; await assert.rejects(get()); await assert.rejects(session.validateReviewDownload(review, "doc", 3));
  account.disconnect(); await assert.rejects(get());
});

test("historical text download binds event/node, rejects other formats and rechecks access", async () => {
  let denied = false;
  let ticket = { event_id: "event", node_id: "doc", content_type: "text/plain", url: "https://files.example/object", method: "GET", size_bytes: 3, sha256_hex: "a".repeat(64) };
  const account = new MnemosAccount(storage(), "https://memory.example", async (url) => {
    if (String(url).endsWith("/whoami")) return Response.json(human);
    if (String(url).endsWith("/download")) {
      assert.equal(new URL(String(url)).pathname, "/v1/projects/project/nodes/doc/history/event/download");
      return Response.json(ticket);
    }
    assert.equal(new URL(String(url)).pathname, "/v1/projects/project/nodes/doc/history");
    assert.equal(new URL(String(url)).searchParams.get("limit"), "1");
    return Response.json({ events: [] }, { status: denied ? 403 : 200 });
  });
  await account.connect("human-token");
  const session = account.session();
  assert.deepEqual(await session.beginPublicationTextDownload("project", "doc", "event"), { url: ticket.url, method: "GET", size_bytes: 3, sha256_hex: ticket.sha256_hex });
  for (const change of [{ event_id: "other" }, { node_id: "other" }, { content_type: "application/pdf" }]) {
    const previous = ticket; ticket = { ...ticket, ...change };
    await assert.rejects(session.beginPublicationTextDownload("project", "doc", "event")); ticket = previous;
  }
  await session.validatePublicationTextDownload("project", "doc");
  denied = true; await assert.rejects(session.validatePublicationTextDownload("project", "doc"));
  session.dispose();
});

test("private native observer checks use their own account and exact version, and revocation closes access", async () => {
  const version = "a".repeat(64);
  let allowed = true; let accesses = 0;
  const account = new MnemosAccount(storage(), "https://memory.example", async (url, init) => {
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer observer-token");
    if (String(url).endsWith("/whoami")) return Response.json(human);
    accesses++;
    assert.equal(String(url), `https://memory.example/v1/projects/project/nodes/doc/private-versions/${version}/access`);
    return allowed ? Response.json({ node_id: "doc", head: version }) : new Response(null, {status: 403});
  });
  await account.connect("observer-token");
  const resource = "https://memory.example/v1/projects/project/nodes/doc";
  assert.equal(await account.canReadPublication(resource, `private:${version}`, "org"), true);
  assert.equal(await account.canReadPublication(resource, `private:${version}`, "other-org"), false);
  assert.equal(accesses, 1);
  allowed = false;
  assert.equal(await account.canReadPublication(resource, `private:${version}`, "org"), false);
  account.disconnect();
  assert.equal(await account.canReadPublication(resource, `private:${version}`, "org"), false);
  assert.equal(accesses, 2);
});

test("native publication refuses newer heads, another author and unapproved proposals", async () => {
  const id = "a".repeat(64), personal = "b".repeat(64), shared = "c".repeat(64);
  let review = { candidate_id: id, project_id: "project", author_id: "alice", personal_head: personal, shared_head: shared, ready: true, stale: false };
  let state = { personal_head: personal, shared_head: shared, personal_exists: true }, calls = 0;
  const account = new MnemosAccount(storage(), "https://memory.example", async (url, init) => {
    if (String(url).endsWith("/whoami")) return Response.json(human);
    if (String(url).includes("/publication-reviews/")) return Response.json(review);
    if (String(url).endsWith("/publish")) {
      calls++; const body = JSON.parse(String(init?.body));
      assert.equal(body.expected_head, personal); assert.equal(body.expected_shared_head, shared);
      return Response.json({ personal_head: personal, shared_head: "d".repeat(64), published: true, conflicted: false });
    }
    return Response.json(state);
  });
  await account.connect("human-token"); const session = account.session();
  for (const change of [{ author_id: "bob" }, { ready: false }, { stale: true }, { project_id: "other" }, { candidate_id: "e".repeat(64) }]) {
    const original = review; review = { ...review, ...change }; await assert.rejects(session.publishReview("project", id)); review = original;
  }
  for (const change of [{ personal_head: "d".repeat(64) }, { shared_head: "d".repeat(64) }, { personal_exists: false }]) {
    const original = state; state = { ...state, ...change }; await assert.rejects(session.publishReview("project", id)); state = original;
  }
  assert.equal(calls, 0);
  assert.equal((await session.publishReview("project", id)).published, true); assert.equal(calls, 1);
});

test("agent consent binds a one-use selection to the account and exact preview", async () => {
  const decisions: unknown[] = [];
  const request = "a".repeat(43);
  const preview = { client_id: "local-agent", resource: "https://memory.example/mcp", scopes: ["memory"], expires_at: new Date(Date.now() + 60000).toISOString() };
  const account = new MnemosAccount(storage(), "https://memory.example", async (url, init) => {
    if (String(url).endsWith("/whoami")) return Response.json(human);
    assert.equal(String(url), `https://memory.example/v1/agent-authorizations/${request}`);
    if (init?.method === "POST") {
      decisions.push(JSON.parse(String(init.body)));
      return Response.json({ redirect_uri: "http://127.0.0.1:4321/callback?code=issued&state=saved" });
    }
    return Response.json(preview);
  });
  await account.connect("human-token");
  const session = account.session(), otherSession = account.session();
  const first = await session.previewAgentConsent(request);
  await assert.rejects(otherSession.decideAgentConsent(first.selection, true));
  const latest = await session.previewAgentConsent(request);
  await assert.rejects(session.decideAgentConsent(first.selection, true));
  latest.scopes.push("forged"); // Local callers cannot mutate the saved consent.
  await session.decideAgentConsent(latest.selection, true);
  await assert.rejects(session.decideAgentConsent(latest.selection, true));
  assert.deepEqual(decisions, [{ expected_client_id: preview.client_id, expected_resource: preview.resource, expected_scopes: ["memory"], approved: true }]);
  const pending = await session.previewAgentConsent(request);
  account.disconnect();
  await assert.rejects(session.decideAgentConsent(pending.selection, true));
  assert.equal(decisions.length, 1);
});

test("lost agent consent response cannot repeat issuance", async () => {
  let writes = 0;
  const account = new MnemosAccount(storage(), "https://memory.example", async (url, init) => {
    if (String(url).endsWith("/whoami")) return Response.json(human);
    if (init?.method === "POST") { writes++; throw new Error("connection lost"); }
    return Response.json({ client_id: "client", resource: "https://memory.example/mcp", scopes: ["memory"], expires_at: new Date(Date.now() + 60000).toISOString() });
  });
  await account.connect("human-token");
  const session = account.session();
  const selected = await session.previewAgentConsent("b".repeat(43));
  await assert.rejects(session.decideAgentConsent(selected.selection, true));
  await assert.rejects(session.decideAgentConsent(selected.selection, true));
  assert.equal(writes, 1);
});

test("managed provisioning keeps request identity and suppresses result after disconnect", async () => {
  let finish!: (response: Response) => void;
  const requestId = "a".repeat(43);
  let writes = 0;
  const account = new MnemosAccount(storage(), "https://memory.example", async (url, init) => {
    if (String(url).endsWith("/whoami")) return Response.json(human);
    assert.equal(new URL(String(url)).pathname, "/v1/agent-connections/provision");
    assert.deepEqual(JSON.parse(String(init?.body)), { request_id: requestId, template_id: "writer" });
    writes++;
    return new Promise(resolve => { finish = resolve; });
  });
  await account.connect("human-token");
  const session = account.session();
  await assert.rejects(session.provisionManagedAgent("bad", "writer"));
  assert.equal(writes, 0);
  const pending = session.provisionManagedAgent(requestId, "writer");
  await new Promise(resolve => setTimeout(resolve, 0));
  account.disconnect();
  finish(Response.json({ binding_id: "reserved", runtime_id: "agenticos", runtime_agent_id: "instance" }));
  await assert.rejects(pending);
  await assert.rejects(session.provisionManagedAgent(requestId, "writer"));
  assert.equal(writes, 1);
});
test("managed request survives reconstruction and lost response without a new ID", async () => {
  const kv = storage(); let fail = true; const sent: unknown[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    if (String(url).endsWith("/whoami")) return Response.json(human);
    sent.push(JSON.parse(String(init?.body)));
    if (fail) throw new Error("lost response");
    return Response.json({ binding_id: "binding", agent_principal_id: "agent", runtime_id: "agenticos", runtime_agent_id: "instance", revoked: false });
  };
  let account = new MnemosAccount(kv, "https://memory.example", fetcher);
  await account.connect("human-token");
  let session = account.session(); const request = session.prepareManagedAgent("writer");
  assert.match(request.request_id, /^[A-Za-z0-9_-]{43}$/);
  assert.throws(() => session.finishManagedAgentRequest(request.request_id));
  await assert.rejects(session.submitManagedAgent(request.request_id));
  account = new MnemosAccount(kv, "https://memory.example", fetcher); session = account.session();
  assert.deepEqual(session.managedAgentRequest(), request);
  assert.throws(() => session.prepareManagedAgent("different"));
  fail = false; const done = await session.submitManagedAgent(request.request_id);
  assert.ok(done.result); assert.deepEqual(sent[0], sent[1]);
  assert.deepEqual(await session.submitManagedAgent(request.request_id), done); assert.equal(sent.length, 2);
  session.finishManagedAgentRequest(request.request_id);
  assert.notEqual(session.prepareManagedAgent("writer").request_id, request.request_id);
});
test("task status is a separate read and disconnect prevents cached result delivery", async () => {
  const seen: Array<{ method: string | undefined; path: string; body: unknown }> = [];
  const account = new MnemosAccount(storage(), "https://memory.example", async (url, init) => {
    if (String(url).endsWith("/whoami")) return Response.json(human);
    seen.push({ method: init?.method, path: new URL(String(url)).pathname, body: init?.body ? JSON.parse(String(init.body)) : null });
    return Response.json({ request_id: "task", state: "completed", result: { content: "answer" } });
  });
  await account.connect("human-token"); const session = account.session();
  await session.runAgentTask("binding", "task", "message", "Checked result");
  await session.readAgentTask("binding", "task");
  assert.deepEqual(seen, [
    { method: "POST", path: "/v1/agent-connections/binding/tasks", body: { request_id: "task", message: "message", criteria: "Checked result" } },
    { method: "GET", path: "/v1/agent-connections/binding/tasks/task", body: null },
  ]);
  account.disconnect(); await assert.rejects(session.readAgentTask("binding", "task"));
  assert.equal(seen.length, 2);
});
test("saved task survives lost response and refresh never resubmits", async () => {
  const kv = storage(); let writes = 0; let requestId = ""; let wrongId = false;
  const fetcher: typeof fetch = async (url, init) => {
    if (String(url).endsWith("/whoami")) return Response.json(human);
    if (init?.method === "POST") { writes++; throw new Error("unknown outcome"); }
    return Response.json({ request_id: wrongId ? "foreign" : requestId, state: "completed", result: { content: "answer" } });
  };
  let account = new MnemosAccount(kv, "https://memory.example", fetcher); await account.connect("token");
  let session = account.session(); const prepared = session.prepareAgentTask("binding", "message", "Checked result"); requestId = prepared.request_id;
  await assert.rejects(session.submitSavedAgentTask(requestId));
  assert.throws(() => session.discardUnsentAgentTask(requestId));
  account = new MnemosAccount(kv, "https://memory.example", fetcher); session = account.session();
  assert.equal(session.managedTaskRequest()?.submitted, true);
  assert.equal(session.managedTaskRequest()?.criteria, "Checked result");
  assert.throws(() => session.prepareAgentTask("binding", "message", "Changed criteria"));
  assert.throws(() => session.prepareAgentTask("other", "changed", "Other criteria"));
  assert.throws(() => session.finishSavedAgentTask(requestId));
  wrongId = true; await assert.rejects(session.refreshSavedAgentTask(requestId));
  assert.equal(session.managedTaskRequest()?.outcome, undefined);
  wrongId = false; assert.equal((await session.refreshSavedAgentTask(requestId)).outcome?.result?.content, "answer");
  await session.submitSavedAgentTask(requestId); assert.equal(writes, 1);
  await session.reviewSavedAgentTask(requestId, 0, "answer", "accepted", "Checked result");
  session.finishSavedAgentTask(requestId); assert.equal(session.managedTaskRequest(), null);
});


test("reopening a saved task never releases cached output after remote revocation", async () => {
  const kv = storage(); let requestId = ""; let revoked = false; let writes = 0;
  const fetcher: typeof fetch = async (url, init) => {
    if (String(url).endsWith("/whoami")) return Response.json(human);
    if (revoked) return new Response(null, { status: 403 });
    if (init?.method === "POST") writes++;
    return Response.json({ request_id: requestId, state: "completed", result: { content: "private answer" } });
  };
  let account = new MnemosAccount(kv, "https://memory.example", fetcher); await account.connect("token");
  let session = account.session(); requestId = session.prepareAgentTask("binding", "message", "Checked result").request_id;
  assert.equal((await session.submitSavedAgentTask(requestId)).outcome?.result?.content, "private answer");
  revoked = true;
  account = new MnemosAccount(kv, "https://memory.example", fetcher); session = account.session();
  const pending = session.managedTaskRequest();
  assert.equal(pending?.request_id, requestId); assert.equal(pending?.submitted, true);
  assert.equal(pending?.outcome, undefined);
  assert.equal(session.prepareAgentTask("binding", "message", "Checked result").outcome, undefined);
  await assert.rejects(session.refreshSavedAgentTask(requestId));
  await assert.rejects(session.submitSavedAgentTask(requestId));
  assert.equal(writes, 1);
  assert.equal(session.managedTaskRequest()?.outcome, undefined);
});

test("legacy criteria upgrade is limited to unsent tasks and never replays submitted work", async () => {
 const kv = storage(); let writes = 0;
 const fetcher: typeof fetch = async (url, init) => {
  if (String(url).endsWith("/whoami")) return Response.json(human);
  if (init?.method === "POST") {writes++; return Response.json({request_id: "legacy", state: "completed", result: {content: "done"}});}
  return Response.json({request_id: "legacy", state: "completed", result: {content: "old result"}});
 };
 const account = new MnemosAccount(kv, "https://memory.example", fetcher); await account.connect("token"); const session = account.session();
 kv.put("mnemosManagedTaskRequest", {request_id: "legacy", binding_id: "binding", message: "original", submitted: false});
 await assert.rejects(session.submitSavedAgentTask("legacy"));
 assert.equal(session.managedTaskRequest()?.submitted, false); assert.equal(writes, 0);
 const upgraded = session.prepareAgentTask("binding", "original", "Check evidence");
 assert.equal(upgraded.request_id, "legacy"); assert.equal(upgraded.criteria, "Check evidence"); assert.equal(writes, 0);
 kv.put("mnemosManagedTaskRequest", {request_id: "legacy", binding_id: "binding", message: "original", submitted: true});
 assert.throws(() => session.prepareAgentTask("binding", "original", "New criteria"));
 await assert.rejects(session.submitSavedAgentTask("legacy")); assert.equal(writes, 0);
 assert.equal((await session.refreshSavedAgentTask("legacy")).outcome?.result?.content, "old result");
 await session.submitSavedAgentTask("legacy"); assert.equal(writes, 0);
 session.finishSavedAgentTask("legacy"); assert.equal(session.managedTaskRequest(), null);
});

test("task review binds the authorized result and revision, hides cached review after revocation", async () => {
 const kv = storage(); let result = "first result"; let denied = false;
 const fetcher: typeof fetch = async (url) => {
  if (String(url).endsWith("/whoami")) return Response.json(human);
  if (denied) return new Response(null, {status: 403});
  return Response.json({request_id: "task", state: "completed", result: {content: result}});
 };
 const account = new MnemosAccount(kv, "https://memory.example", fetcher); await account.connect("token"); const session = account.session();
 kv.put("mnemosManagedTaskRequest", {request_id: "task", binding_id: "binding", message: "work", criteria: "show evidence", submitted: true});
 const reviewed = await session.reviewSavedAgentTask("task", 0, result, "accepted", "Evidence checked");
 assert.equal(reviewed.review?.reviewer_id, human.subject.user_id);
 assert.equal(reviewed.review?.revision, 1); assert.equal(reviewed.review?.decision, "accepted");
 assert.equal(session.managedTaskRequest()?.review, undefined);
 await assert.rejects(session.reviewSavedAgentTask("task", 0, result, "changes_requested", "Stale update"));
 assert.equal((await session.refreshSavedAgentTask("task")).review?.decision, "accepted");
 result = "different result";
 await assert.rejects(session.reviewSavedAgentTask("task", 1, "first result", "accepted", "Old output"));
 assert.equal((await session.refreshSavedAgentTask("task")).review, undefined);
 const rework = await session.reviewSavedAgentTask("task", 0, result, "changes_requested", "Missing evidence");
 assert.equal(rework.review?.decision, "changes_requested");
 denied = true;
 await assert.rejects(session.reviewSavedAgentTask("task", 1, result, "accepted", "No access"));
 assert.equal(session.managedTaskRequest()?.review, undefined);
 await assert.rejects(session.refreshSavedAgentTask("task"));
});

test("finished tasks preserve history, reauthorize output, and prepare rework without execution", async () => {
 const kv = storage(); let denied = false; let writes = 0;
 const fetcher: typeof fetch = async (url, init) => {
  if (String(url).endsWith("/whoami")) return Response.json(human);
  if (init?.method === "POST") writes++;
  if (denied) return new Response(null, {status: 403});
  return Response.json({request_id: String(url).split("/").at(-1), state: "completed", result: {content: "result"}});
 };
 const account = new MnemosAccount(kv, "https://memory.example", fetcher); await account.connect("token"); const session = account.session();
 for (let i=0;i<28;i++) {
  const id = `task-${i}`;
  kv.put("mnemosManagedTaskRequest", {request_id: id, binding_id: "binding", message: "work", criteria: "evidence", submitted: true, outcome: {request_id: id, state: "completed", result: {content: "result"}}});
  assert.throws(() => session.finishSavedAgentTask(id));
  await session.reviewSavedAgentTask(id, 0, "result", i===27 ? "changes_requested" : "accepted", "Add missing evidence");
  session.finishSavedAgentTask(id); session.finishSavedAgentTask(id);
 }
 const page = session.finishedAgentTasks(); assert.equal(page.requests.length,25); assert.ok(page.next_cursor);
 assert.equal(page.requests[0]?.request_id,"task-27"); assert.equal(page.requests[0]?.review,undefined); assert.equal(page.requests[0]?.outcome,undefined);
 const next = session.finishedAgentTasks(page.next_cursor); assert.equal(next.requests.length,3); assert.equal(next.next_cursor,"");
 const restored = await session.readFinishedAgentTask("task-27"); assert.equal(restored.review?.decision,"changes_requested");
 const followup = await session.prepareAgentRework("task-27"); assert.notEqual(followup.request_id,"task-27"); assert.equal(followup.parent_request_id,"task-27"); assert.equal(followup.criteria,"evidence"); assert.match(followup.message,/Add missing evidence/); assert.equal(followup.submitted,false); assert.equal(writes,0);
 assert.equal((await session.prepareAgentRework("task-27")).request_id,followup.request_id);
 denied=true; await assert.rejects(session.readFinishedAgentTask("task-27")); await assert.rejects(session.prepareAgentRework("task-27")); assert.equal(writes,0);
});

test("only an unsent current task can be discarded", async () => {
 const kv = storage(); const account = new MnemosAccount(kv,"https://memory.example",async()=>Response.json(human)); await account.connect("token"); const session = account.session();
 const request = session.prepareAgentTask("binding","work","criteria");
 assert.throws(()=>session.discardUnsentAgentTask("other")); session.discardUnsentAgentTask(request.request_id); assert.equal(session.managedTaskRequest(),null);
});

test("team results reuse human review and history with team authorization on every read", async () => {
 const kv=storage(); let denied=false; let writes=0; let reads=0; let shared: Record<string, unknown> | undefined;
 const fetcher: typeof fetch=async (url,init)=>{
  const path=new URL(String(url)).pathname;
  if(path.endsWith("/whoami"))return Response.json(human);
  if(init?.method === "POST")writes++;
  if(denied)return new Response(null,{status:403});
  if(path.endsWith("/review")) {
   if(init?.method === "POST") {
    const input=JSON.parse(String(init.body));assert.equal(input.expected_revision,0);assert.equal(input.runtime_request_id,"team-result");
    shared={revision:1,user_id:"alice",runtime_request_id:input.runtime_request_id,result_sha256:input.result_sha256,decision:input.decision,comment:input.comment,created_at:"2026-09-09T00:00:00Z"};
    return Response.json(shared);
   }
   return Response.json(shared?{state:shared.decision,revision:1,review:shared}:{state:"unreviewed",revision:0});
  }
  if(path === "/v1/projects/project/budget-policy")return Response.json({project_id:"project",revision:3});
  if(path === "/v1/projects/project/team-budgets/proposal") return Response.json({id:"proposal",project_id:"project",proposal:{policy_revision:1,estimate_usd_micros:"100000",limit_usd_micros:"20000000",task:"approved work",criteria:"three evidence points",members:[{binding_id:"binding",role:"analyst"}]}});
  assert.equal(path,"/v1/projects/project/team-budgets/proposal/members/binding/task");reads++;
  return Response.json({request_id:"team-result",state:"completed",result:{content:"three points"}});
 };
 const account=new MnemosAccount(kv,"https://memory.example",fetcher);await account.connect("token");const session=account.session();
 session.prepareAgentTask("other","unsent work","criteria");
 await assert.rejects(session.prepareTeamBudgetReview("project","proposal","binding"));
 assert.equal(session.managedTaskRequest()?.message,"unsent work");
 session.discardUnsentAgentTask(session.managedTaskRequest()!.request_id);
 const request=await session.prepareTeamBudgetReview("project","proposal","binding");
 assert.equal(request.criteria,"three evidence points");assert.equal(request.team_budget?.role,"analyst");assert.equal(request.submitted,true);
 assert.equal((await session.prepareTeamBudgetReview("project","proposal","binding")).request_id,request.request_id);
 assert.equal(session.managedTaskRequest()?.outcome,undefined);
 kv.put("mnemosManagedTaskRequest",{...request,review:{revision:4,decision:"accepted",comment:"Old personal decision",reviewer_id:"alice",reviewed_at:"2026-09-08T00:00:00Z",result_content:"three points"}});
 const legacy=await session.refreshSavedAgentTask(request.request_id);assert.equal(legacy.review,undefined);assert.equal(legacy.legacy_review?.comment,"Old personal decision");assert.equal(session.managedTaskRequest()?.legacy_review,undefined);
 const review=await session.reviewSavedAgentTask(request.request_id,0,"three points","changes_requested","Add citations");
 assert.equal(review.review?.reviewer_id,"alice");assert.equal(review.review?.source,"server");
 assert.equal((await session.reviewSavedAgentTask(request.request_id,0,"three points","changes_requested","Add citations")).review?.revision,1);
 session.finishSavedAgentTask(request.request_id);
 assert.equal(session.finishedAgentTasks().requests[0].team_budget?.proposal_id,"proposal");
 assert.equal(session.finishedAgentTasks().requests[0].outcome,undefined);
 assert.equal((await session.readFinishedAgentTask(request.request_id)).review?.comment,"Add citations");
 const rework=await session.prepareTeamBudgetRework(request.request_id);
 assert.equal(rework.proposal.rework?.review_revision,1);assert.equal(rework.proposal.policy_revision,3);assert.equal(rework.proposal.task,"approved work");assert.equal(rework.proposal.criteria,"three evidence points");assert.equal(rework.proposal.rework?.request_id,request.request_id);assert.equal(rework.proposal.rework?.result_content,"three points");assert.equal(rework.proposal.rework?.comment,"Add citations");assert.match(rework.proposal.rework!.result_sha256,/^[a-f0-9]{64}$/);
 await assert.rejects(session.prepareAgentRework(request.request_id));
 kv.put("mnemosTaskHistory:newer",{request:{request_id:"newer",binding_id:"other",message:"later task",submitted:true},next:request.request_id});kv.put("mnemosTaskHistoryHead","newer");
 assert.equal((await session.prepareTeamBudgetReview("project","proposal","binding")).review?.source,"server");
 session.finishSavedAgentTask(request.request_id);
 assert.deepEqual(session.finishedAgentTasks().requests.map(r=>r.request_id),["newer",request.request_id]);
 assert.equal(session.finishedAgentTasks().requests[1].legacy_review,undefined);
 denied=true;await assert.rejects(session.readFinishedAgentTask(request.request_id));
 assert.ok(reads>=5);assert.equal(writes,1);
});


test("ordinary draft budget survives lost response and dispatches only its saved team task",async()=>{
 const kv=storage();let lost=true;let runs=0;let proposalWrites=0;let saved:unknown;const paths:string[]=[];
 const fetcher:typeof fetch=async(url,init)=>{
  const path=new URL(String(url)).pathname;paths.push(path);
  if(path.endsWith("/whoami"))return Response.json(human);
  if(path.endsWith("/budget-policy"))return Response.json({revision:3});
  if(path==="/v1/projects/project/team-budgets"){
   proposalWrites++;const input=JSON.parse(String(init?.body));if(saved)assert.deepEqual(input,saved);else saved=input;
   if(lost){lost=false;throw new Error("response lost after save");}
   return Response.json({id:"proposal",project_id:"project",state:"awaiting_approval",proposal:input});
  }
  if(path.endsWith("/members/binding/task")){
   if(init?.method==="POST"){runs++;assert.equal(init.body,"{}");}
   return Response.json({request_id:"team-result",state:runs?"completed":"unconfirmed",...(runs?{result:{content:"done"}}:{})});
  }
  if(path.endsWith("/review"))return Response.json({state:"unreviewed",revision:0});
  throw new Error("unexpected route");
 };
 const account=new MnemosAccount(kv,"https://memory.example",fetcher);await account.connect("token");let session=account.session();
 const draft=session.prepareAgentTask("binding","Task text","Acceptance criteria");
 await assert.rejects(session.budgetSavedAgentTask(draft.request_id,"project","1","20000000"));
 session=account.session();assert.equal(session.managedTaskRequest()?.budget_request?.input.request_id,draft.request_id);
 assert.throws(()=>session.discardUnsentAgentTask(draft.request_id));
 await assert.rejects(session.submitSavedAgentTask(draft.request_id));
 await assert.rejects(session.budgetSavedAgentTask(draft.request_id,"project","1","30000000"));
 const linked=await session.budgetSavedAgentTask(draft.request_id,"project","1","20000000");
 assert.equal(linked.request_id,"team-result");assert.equal(linked.draft_request_id,draft.request_id);assert.equal(linked.team_budget?.proposal_id,"proposal");assert.equal(linked.message,draft.message);assert.equal(linked.criteria,draft.criteria);assert.equal(runs,0);assert.equal(proposalWrites,2);
 assert.equal((await session.refreshSavedAgentTask(linked.request_id)).outcome?.state,"unconfirmed");
 await session.submitSavedAgentTask(linked.request_id);assert.equal(runs,1);assert.ok(!paths.some(p=>p.startsWith("/v1/agent-connections/")));
});

test("team cancellation survives lost response, blocks rerun and retains authorized history",async()=>{
 const kv=storage();let cancelCalls=0;let denied=false;
 const account=new MnemosAccount(kv,"https://memory.example",async(url,init)=>{
  const path=new URL(String(url)).pathname;
  if(path.endsWith("/whoami"))return Response.json(human);
  if(denied)return new Response(null,{status:403});
  if(path.endsWith("/cancel")){assert.equal(init?.method,"POST");if(++cancelCalls===1)throw new Error("cancel response lost");return Response.json({state:"cancelled"});}
  if(path.endsWith("/task")){assert.notEqual(init?.method,"POST");return Response.json({request_id:"team-cancel",state:"unconfirmed"});}
  if(path.endsWith("/review"))return Response.json({state:"unreviewed",revision:0});
  throw new Error("unexpected path");
 });await account.connect("token");let session=account.session();
 kv.put("mnemosManagedTaskRequest",{request_id:"team-cancel",binding_id:"binding",message:"task",criteria:"criteria",submitted:true,team_budget:{project_id:"project",proposal_id:"proposal",role:"worker"}});
 await assert.rejects(session.cancelSavedTeamTask("team-cancel"));
 session=account.session();assert.equal(session.managedTaskRequest()?.cancel_requested,true);
 await assert.rejects(session.submitSavedAgentTask("team-cancel"));
 await session.cancelSavedTeamTask("team-cancel");assert.equal(session.managedTaskRequest(),null);
 assert.equal(session.finishedAgentTasks().requests[0].cancelled,true);
 assert.equal((await session.readFinishedAgentTask("team-cancel")).outcome?.state,"unconfirmed");
 await session.cancelSavedTeamTask("team-cancel");assert.equal(cancelCalls,2);assert.equal(session.finishedAgentTasks().requests.length,1);
 denied=true;await assert.rejects(session.readFinishedAgentTask("team-cancel"));
 assert.ok(session.prepareAgentTask("binding","Next task","Next criteria"));
});

test("deferred budget draft preserves ambiguous terms without overwriting a newer task",async()=>{
 const kv=storage();let finish!:(value:Response)=>void;let body:any;let denied=false;let writes=0;
 const account=new MnemosAccount(kv,"https://memory.example",async(url,init)=>{
  const path=new URL(String(url)).pathname;
  if(path.endsWith("/whoami"))return Response.json(human);
  if(denied)return new Response(null,{status:403});
  if(path.endsWith("/budget-policy"))return Response.json({revision:2});
  assert.equal(path,"/v1/projects/project/team-budgets");writes++;body=JSON.parse(String(init?.body));return new Promise(resolve=>{finish=resolve;});
 });await account.connect("token");const session=account.session();const original=session.prepareAgentTask("binding","Deferred task","criteria");
 const inFlight=session.budgetSavedAgentTask(original.request_id,"project","1","20");
 await new Promise(resolve=>setTimeout(resolve,0));
 session.deferBudgetDraft(original.request_id);session.deferBudgetDraft(original.request_id);
 const next=session.prepareAgentTask("binding","Next task","criteria");
 finish(Response.json({id:"proposal",project_id:"project",proposal:body}));await assert.rejects(inFlight);
 assert.equal(session.managedTaskRequest()?.request_id,next.request_id);
 await assert.rejects(session.resumeBudgetDraft(original.request_id));
 assert.equal(session.finishedAgentTasks().requests[0].deferred,true);
 session.discardUnsentAgentTask(next.request_id);
 denied=true;await assert.rejects(session.resumeBudgetDraft(original.request_id));assert.equal(session.managedTaskRequest(),null);denied=false;
 const resumed=await session.resumeBudgetDraft(original.request_id);assert.equal(resumed.request_id,original.request_id);assert.deepEqual(resumed.budget_request?.input,body);assert.equal(writes,1);
 session.deferBudgetDraft(original.request_id);assert.equal(session.finishedAgentTasks().requests.length,1);assert.equal(session.finishedAgentTasks().requests[0].resumed,false);
});

test("organization summary uses verified tenant and fresh metrics permission; revocation suppresses in-flight data", async()=>{
 const kv=storage();let revoked=false;let finish:((r:Response)=>void)|undefined;let hold=false;
 const account=new MnemosAccount(kv,'https://memory.example',async(url)=>{
  if(String(url).endsWith('/whoami'))return Response.json({...human,tenant_name:'Organization'});
  assert.ok(String(url).endsWith('/platform/metrics'));
  if(revoked)return new Response('',{status:403});
  const body={shared_publications:0,human_logins_24h:0,authenticated_users_24h:0,recorded_at:'2026-09-12T12:00:00Z',workspace_activity:null,organization_work:{first_publication_at:null,first_acceptance_at:'2026-09-12T11:00:00Z',observed_at:'2026-09-12T12:00:00Z',periods:[1,7,30].map(days=>({days,publications:0,projects:0,has_completed_publication:false,accepted_requests:2,accepted_request_projects:1,completed_projects:1,has_completed_work:true}))}};
  if(hold)return new Promise(resolve=>{finish=()=>resolve(Response.json(body))});
  return Response.json(body);
 });
 await account.connect('human-token');const session=account.session();
 const summary=await session.readOrganizationMetrics('https://memory.example');assert.equal(summary.tenantId,'org');assert.equal(summary.name,'Organization');assert.equal(summary.periods[0].completedProjects,1);assert.equal('subject' in summary,false);
 revoked=true;await assert.rejects(session.readOrganizationMetrics('https://memory.example'));revoked=false;hold=true;
 const pending=session.readOrganizationMetrics('https://memory.example');await new Promise(resolve=>setTimeout(resolve,0));assert.ok(finish);account.disconnect();finish(Response.json({}));await assert.rejects(pending);session.dispose();
});

test("owner credential and epoch change atomically and legacy accounts preserve ownership", async () => {
  const map = new Map<string, unknown>();
  let fail = false, writes = 0;
  const kv: AccountStorage = {
    get: <T>(key: string) => map.get(key) as T | undefined,
    put: (key, value) => { writes++; if (fail) throw Error('storage unavailable'); map.set(key, value); },
    delete: key => { map.delete(key); },
  };
  const account = new MnemosAccount(kv, 'https://memory.example', async () => Response.json(human));
  fail = true;
  await assert.rejects(account.connect('candidate'));
  assert.equal(writes, 1); assert.equal(map.size, 0);
  fail = false; await account.connect('accepted');
  assert.equal(map.size, 1);
  const before = map.get('mnemosCredential'), epoch = account.calendarEpoch();
  fail = true; assert.throws(() => account.disconnect());
  assert.equal(map.get('mnemosCredential'), before); assert.equal(account.calendarEpoch(), epoch);
  fail = false; account.disconnect(); assert.throws(() => account.session());
  const disconnected = map.get('mnemosCredential') as {epoch:string;owner:{user:string}};
  assert.notEqual(disconnected.epoch, epoch); assert.equal(disconnected.owner.user, 'alice');
  await account.connect('again'); assert.equal(account.calendarEpoch(), disconnected.epoch);
  const legacy = storage();
  legacy.put('mnemosAccountOwner', {tenant:'org',user:'alice'});
  legacy.put('mnemosCredential', {token:'old',generation:'old-generation',expiresAt:Date.now()+60000});
  legacy.put('mnemosCalendarEpoch', 'legacy-epoch');
  const old = new MnemosAccount(legacy, 'https://memory.example', async () => Response.json(human));
  assert.equal(old.calendarEpoch(), 'legacy-epoch');
  await old.connect('renewed'); assert.equal(old.calendarEpoch(), 'legacy-epoch');
  const foreign = new MnemosAccount(legacy, 'https://memory.example', async () => Response.json({subject:{tenant_id:'org',user_id:'other'}}));
  await assert.rejects(foreign.connect('foreign'));
});
