import { test } from "node:test";
import assert from "node:assert/strict";
import { MnemosAPI, MnemosAPIError, relocateDraftsConfirmation } from "./mnemos-api.ts";

test("общий документ: правка уходит в ветку владельца от версии редактора, конфликт — 409 без повтора", async () => {
  const requests: { path: string; method?: string; body: unknown }[] = [];
  const api = new MnemosAPI("https://memory.example", async () => "human", async (url, init) => {
    requests.push({ path: new URL(String(url)).pathname, method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : null });
    return new Response("changed", { status: 409 });
  });
  const base = "a".repeat(64);
  await assert.rejects(api.saveSharedDocument("project", "doc", "user-owner", base, "upload"), (e: unknown) => e instanceof MnemosAPIError && e.status === 409);
  await assert.rejects(api.markSharedDocumentSeen("project", "user-owner", "doc"), MnemosAPIError);
  assert.throws(() => api.saveSharedDocument("project", "doc", "user-owner", "not-a-head", "upload"));
  assert.deepEqual(requests, [
    { path: "/v1/projects/project/draft/nodes/doc/shared-save", method: "POST", body: { owner_id: "user-owner", base_head: base, upload_id: "upload" } },
    { path: "/v1/me/shared-documents/seen", method: "POST", body: { project_id: "project", owner_id: "user-owner", node_id: "doc" } },
  ]);
});

test("публикация с документом в удалённой папке: отказ называет папку и документы словами", async () => {
  const api = new MnemosAPI("https://memory.example", async () => "human", async () => Response.json({ code: "publication.folder_removed", message: "папка удалена",
    removed_folder_documents: [{ node_id: "y", name: "Y.txt", folder_path: "/Отчёты" }, { node_id: "w", name: "W.txt", folder_path: "/Отчёты" }] }, { status: 409 }));
  await assert.rejects(api.publishDraft("project", "a".repeat(64), "b".repeat(64), "m"), (e: unknown) => e instanceof MnemosAPIError && e.status === 409 && e.code === "publication.folder_removed"
    && e.message === "Папка «Отчёты» удалена. Перенесите документы «Y.txt», «W.txt» в другую папку и опубликуйте снова." && e.removedFolder?.length === 2);
});

test("отказ «папка удалена» с усечённым перечнем называет, сколько документов ещё", async () => {
  const api = new MnemosAPI("https://memory.example", async () => "human", async () => Response.json({ code: "publication.folder_removed", message: "папка удалена",
    removed_folder_documents: [{ node_id: "y", name: "Y.txt", folder_path: "/Отчёты" }], removed_folder_more: 22 }, { status: 409 }));
  await assert.rejects(api.publishDraft("project", "a".repeat(64), "b".repeat(64), "m"), (e: unknown) => e instanceof MnemosAPIError
    && e.message === "Папка «Отчёты» удалена. Перенесите документ «Y.txt» в другую папку и опубликуйте снова. И ещё 22 документа в удалённых папках.");
});

test("папку с черновиками нельзя удалить: отказ словами, свои черновики поимённо, чужие числом", async () => {
  const text = (drafts: object) => new MnemosAPIError(409, "node.folder_has_drafts", undefined, undefined, undefined, 0, drafts as never).message;
  assert.equal(text({ folder_path: "/Отчёты", people: 2, own: [] }), "Папку нельзя удалить: в папке «Отчёты» есть неопубликованные черновики 2 сотрудников. Удалить её можно, когда черновики опубликуют, перенесут или удалят.");
  assert.equal(text({ folder_path: "/Отчёты", people: 0, own: [{ node_id: "y", name: "Y.txt" }] }), "Папку нельзя удалить: в папке «Отчёты» есть неопубликованные черновики. Ваши черновики в ней: «Y.txt» — их можно перенести самому. Удалить её можно, когда черновики опубликуют, перенесут или удалят.");
});

test("администратор видит авторов черновиков в отказе и подтверждает перенос словами", async () => {
  const text = (drafts: object) => new MnemosAPIError(409, "node.folder_has_drafts", undefined, undefined, undefined, 0, drafts as never).message;
  assert.equal(text({ folder_path: "/Отчёты", people: 2, own: [], authors: [{ principal_id: "u1", name: "Анна" }, { principal_id: "u2", name: "Борис" }] }),
    "Папку нельзя удалить: в папке «Отчёты» есть неопубликованные черновики 2 сотрудников. Черновики у сотрудников: Анна, Борис. Удалить её можно, когда черновики опубликуют, перенесут или удалят.");
  assert.equal(relocateDraftsConfirmation(2, "/Архив"), "Черновики 2 сотрудников будут перенесены в «Архив». Их авторы увидят их там.");
  const calls: { url: string; method?: string; body?: string }[] = [];
  const api = new MnemosAPI("https://memory.example", async () => "human", async (url, init) => { calls.push({ url: String(url), method: init?.method, body: String(init?.body) }); return Response.json({ people: 2, documents: 3 }); });
  assert.deepEqual(await api.relocateFolderDrafts("p", "f", "t"), { people: 2, documents: 3 });
  assert.equal(calls[0].url, "https://memory.example/v1/projects/p/nodes/f/drafts/relocate");
  assert.deepEqual(JSON.parse(calls[0].body ?? ""), { target_parent_id: "t" });
});

test("credentials stay on the configured server and are refreshed per request", async () => {
  const calls: { url: string; init?: RequestInit }[] = []; let tokens = 0;
  const api = new MnemosAPI("https://memory.example", async () => `token-${++tokens}`, async (url, init) => { calls.push({ url: String(url), init }); return Response.json({ connections: [] }); });
  await api.listAgentConnections("cursor&tenant=other"); await api.revokeAgentConnection("a/b");
  assert.equal(calls[0].init?.redirect, "manual");
  assert.equal(new URL(calls[0].url).searchParams.get("cursor"), "cursor&tenant=other");
  assert.equal(new Headers(calls[1].init?.headers).get("Authorization"), "Bearer token-2");
  assert.equal(calls[1].url, "https://memory.example/v1/agent-connections/a%2Fb/revoke");
});
test("redirects and internal errors are not followed or exposed", async () => {
  for (const status of [302, 401, 403, 500]) {
    let calls = 0;
    const api = new MnemosAPI("https://memory.example", async () => "secret", async () => { calls++; return new Response("secret internal detail", { status, headers: { Location: "https://attacker.example" } }); });
    await assert.rejects(api.listAgentConnections(), (err: unknown) => err instanceof MnemosAPIError && err.status === status && !err.message.includes("secret"));
    assert.equal(calls, 1);
  }
});
test("unsafe origins and path traversal are rejected; metadata is bounded", async () => {
  for (const origin of ["http://memory.example", "https://user:pass@memory.example", "https://memory.example/prefix", "https://memory.example?other=1"]) assert.throws(() => new MnemosAPI(origin, async () => "t"));
  const api = new MnemosAPI("https://memory.example", async () => "t", async () => Response.json("x".repeat(1_048_576)));
  assert.throws(() => api.nodeHistory("..", "node"));
  await assert.rejects(api.listAgentConnections(), MnemosAPIError);
});

test("draft save and publication preserve observed heads and never retry conflicts", async () => {
  const requests: { path: string; body: unknown }[] = [];
  const api = new MnemosAPI("https://memory.example", async () => "human", async (url, init) => {
    requests.push({ path: new URL(String(url)).pathname, body: init?.body ? JSON.parse(String(init.body)) : null });
    return new Response("private conflict details", { status: 409 });
  });
  const personal = "a".repeat(64), shared = "b".repeat(64);
  await assert.rejects(api.saveDraftDocument("project", "document", "upload", personal), (e: unknown) => e instanceof MnemosAPIError && e.status === 409);
  await assert.rejects(api.publishDraft("project", personal, shared, "Reviewed"), (e: unknown) => e instanceof MnemosAPIError && e.status === 409);
  assert.deepEqual(requests, [
    { path: "/v1/projects/project/draft/save", body: { expected_head: personal, message: "Edit document", changes: [{ node_id: "document", upload_id: "upload" }] } },
    { path: "/v1/projects/project/draft/publish", body: { expected_head: personal, expected_shared_head: shared, message: "Reviewed" } },
  ]);
  assert.throws(() => api.saveDraftDocument("project", "document", "upload", ""), MnemosAPIError);
  assert.throws(() => api.publishDraft("project", personal, shared, "x".repeat(4097)), MnemosAPIError);
  assert.equal(requests.length, 2);
});

test("project document reads and downloads retain project scope in every request", async () => {
  const paths: string[] = [];
  const client = new MnemosAPI("https://memory.example", async () => "token", async (url) => {
    paths.push(String(url)); return Response.json({ node_id: "doc" });
  });
  await client.readProjectDocument("project", "doc", 1024);
  await client.downloadProjectDocument("project", "doc");
  await client.downloadPublication("project", "doc", "event");
  assert.deepEqual(paths, [
    "https://memory.example/v1/projects/project/nodes/doc/content?whole=true&max_bytes=1024",
    "https://memory.example/v1/projects/project/nodes/doc/content?as=file",
    "https://memory.example/v1/projects/project/nodes/doc/history/event/download",
  ]);
  assert.throws(() => client.readProjectDocument("project", "doc", 262145));
  assert.throws(() => client.downloadProjectDocument("..", "doc"));
  assert.throws(() => client.downloadPublication("project", "doc", ".."));
  assert.equal(paths.length, 3);
});


test("search fixes the project scope and bounds the query before HTTP", async () => {
  let calls = 0;
  const api = new MnemosAPI("https://memory.example", async () => "human", async (url) => {
    calls++; const parsed = new URL(String(url));
    assert.equal(parsed.pathname, "/v1/search");
    assert.deepEqual([...parsed.searchParams], [["project_id", "project"], ["q", "a&project_id=other"], ["limit", "20"]]);
    return Response.json({ hits: [], index_pending: false, degraded: false });
  });
  await api.searchProject("project", "a&project_id=other");
  assert.throws(() => api.searchProject("project", " "));
  assert.throws(() => api.searchProject("project", "я".repeat(2049)));
  assert.equal(calls, 1);
});

 test("review submission sends only the observed project and heads", async () => {
  let count = 0;
  const personal = "a".repeat(64), shared = "b".repeat(64);
  const api = new MnemosAPI("https://memory.example", async () => "human", async (url, init) => {
    count++; assert.equal(String(url), "https://memory.example/v1/projects/project/reviews");
    assert.deepEqual(JSON.parse(String(init?.body)), { personal_head: personal, shared_head: shared });
    return Response.json({ candidate_id: "e".repeat(64) });
  });
  await api.requestPublicationReview("project", personal, shared);
  assert.throws(() => api.requestPublicationReview("project", "invalid", shared), MnemosAPIError);
  assert.equal(count, 1);
 });

test("review reads validate candidate IDs before making an authenticated request", async () => {
  const id = "c".repeat(64); let calls = 0;
  const api = new MnemosAPI("https://memory.example", async () => "human", async (url, init) => {
    calls++; assert.equal(String(url), `https://memory.example/v1/publication-reviews/${id}`);
    assert.equal(init?.method, "GET"); return Response.json({ candidate_id: id });
  });
  assert.throws(() => api.readPublicationReview("../other"), MnemosAPIError);
  await api.readPublicationReview(id); assert.equal(calls, 1);
});

test("review decisions preserve explicit rejection and expected version without retry", async () => {
  const id = "a".repeat(64); let calls = 0;
  const api = new MnemosAPI("https://memory.example", async () => "human", async (url, init) => {
    calls++; assert.equal(String(url), `https://memory.example/v1/publication-reviews/${id}/decisions`);
    assert.deepEqual(JSON.parse(String(init?.body)), { domain_id: "engineering", expected_version: 7, approved: false });
    return new Response("stale", { status: 409 });
  });
  await assert.rejects(api.recordReviewDecision(id, "engineering", 7, false));
  assert.equal(calls, 1);
  assert.throws(() => api.recordReviewDecision(id, "engineering", -1, true), MnemosAPIError);
});

test("policy management uses project scope, exact revision and opaque people cursor", async () => {
  const domains = [{ domain_id: "Engineering", node_ids: ["doc"], approver_ids: ["person"] }];
  const calls: { url: URL; init?: RequestInit }[] = [];
  const api = new MnemosAPI("https://memory.example", async () => "human", async (url, init) => {
    calls.push({ url: new URL(String(url)), init }); return Response.json({ revision: 8 });
  });
  await api.readPublicationPolicy("project");
  await api.listPolicyApprovers("project", "person/я&tenant=other");
  await api.setPublicationPolicy("project", 7, domains);
  assert.equal(calls[0].url.pathname, "/v1/projects/project/publication-policy");
  assert.equal(calls[1].url.searchParams.get("cursor"), "person/я&tenant=other");
  assert.equal(calls[1].url.searchParams.size, 1);
  assert.equal(calls[2].init?.method, "PUT");
  assert.deepEqual(JSON.parse(String(calls[2].init?.body)), { expected_revision: 7, domains });
  assert.throws(() => api.setPublicationPolicy("project", -1, domains), MnemosAPIError);
});


test("private native creation preserves frozen fields and rejects partial results", async () => {
  const request = { request_id: "operation", expected_head: "a".repeat(64), parent_id: "", name: "New", content_type: "application/vnd.cloudflareos.document+json", upload_id: "upload", message: "Create native document" };
  let response: object = { node_id: "new", head: "b".repeat(64) };
  const api = new MnemosAPI("https://memory.example", async () => "human", async (url, init) => {
    assert.equal(String(url), "https://memory.example/v1/projects/project/draft/create");
    assert.deepEqual(JSON.parse(String(init?.body)), request);
    return Response.json(response);
  });
  assert.equal((await api.createPrivateDocument("project", request)).node_id, "new");
  response = { node_id: "new" };
  await assert.rejects(api.createPrivateDocument("project", request), (e: unknown) => e instanceof MnemosAPIError && e.status === 502);
});

test("workspace activity carries no user or time and refreshes credentials without retrying", async () => {
  const calls: { url: string; init?: RequestInit }[] = []; let token = 0, fail = false;
  const api = new MnemosAPI("https://memory.example", async () => `credential-${++token}`, async (url, init) => { calls.push({url:String(url),init});return new Response(null,{status:fail?403:204}); });
  await api.recordWorkspaceActivity("a".repeat(32),1,false);
  assert.equal(calls[0].url,"https://memory.example/v1/me/workspace-activity");
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)),{stream_id:"a".repeat(32),sequence:1,active:false});
  fail=true;await assert.rejects(api.recordWorkspaceActivity("a".repeat(32),2,true));
  assert.equal(calls.length,2);
  assert.equal(new Headers(calls[1].init?.headers).get("Authorization"),"Bearer credential-2");
  assert.throws(()=>api.recordWorkspaceActivity("bad",3,true));
  assert.equal(calls.length,2);
});

test("траты уходят в /v1/spending без человека и агента в теле; сводка читается за период", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const api = new MnemosAPI("https://memory.example", async () => "credential", async (url, init) => {
    calls.push({ url: String(url), init });
    return init?.method === "POST" ? Response.json({ recorded: 1 }) : Response.json({ period: "7d", micro_usd: "5", count: 1 });
  });
  const entry = { record_id: "chat:1", occurred_at: "2026-09-24T10:00:00.000Z", kind: "chat" as const, operation: "chat.reply", provider: "openrouter", model: "deepseek/deepseek-v4-flash-0731", project_id: "p1", micro_usd: "110292", estimated: false, input_tokens: 900, output_tokens: 20 };
  assert.deepEqual(await api.recordSpending([entry]), { recorded: 1 });
  assert.equal(calls[0].url, "https://memory.example/v1/spending");
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { records: [entry] });
  for (const bad of [[], [{ ...entry, micro_usd: 1 }], [{ ...entry, kind: "ingest" }], [{ ...entry, operation: "Chat Reply" }], Array(101).fill(entry)]) {
    assert.throws(() => api.recordSpending(bad as never), MnemosAPIError);
  }
  await api.readSpending("7d", "Europe/Moscow");
  assert.equal(calls[1].url, "https://memory.example/v1/spending?period=7d&tz=Europe%2FMoscow");
  assert.throws(() => api.readSpending("year" as never), MnemosAPIError);
  assert.equal(calls.length, 2);
});

test("corporate JSON card creation sends the original receipt and request",async()=>{
 const version="a".repeat(64);
 const request={request_id:"request",expected_head:version,parent_id:"",name:"Bitrix company 1",content_type:"application/json",upload_id:"upload",corporate_preview_id:"receipt",message:"Copy"};
 let calls=0;
 const api=new MnemosAPI("https://memory.example",async()=>"token",async(url,init)=>{calls++;assert.equal(String(url),"https://memory.example/v1/projects/project/draft/create");assert.deepEqual(JSON.parse(String(init?.body)),request);return Response.json({node_id:"copy",head:version});});
 assert.equal((await api.createPrivateDocument("project",request)).node_id,"copy");assert.equal(calls,1);
});

test("запросы на слияние: принять и вернуть как было идут по адресу репозитория, коды отказа видны вызывающему", async () => {
  const requests: { path: string; method?: string; body: unknown }[] = [];
  let answer: Response = Response.json({ index: 7, outcome: "reverted" });
  const api = new MnemosAPI("https://memory.example", async () => "human", async (url, init) => {
    requests.push({ path: new URL(String(url)).pathname, method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : null });
    return answer;
  });
  assert.equal((await api.revertMergeRequest("p", "c", "1", 7)).outcome, "reverted");
  assert.match(requests[0].path, /\/merge-requests\/7\/revert$/);
  assert.equal(requests[0].method, "POST");
  assert.throws(() => api.revertMergeRequest("p", "c", "1", 0), MnemosAPIError);
  answer = Response.json({ code: "git.merge.revert_conflict", message: "details" }, { status: 409 });
  await assert.rejects(api.revertMergeRequest("p", "c", "1", 7), (e: unknown) => e instanceof MnemosAPIError && e.status === 409 && e.code === "git.merge.revert_conflict");
  answer = Response.json({ code: "git.merge.no_approver" }, { status: 409 });
  await assert.rejects(api.acceptMergeRequest("p", "c", "1", 7, "abc"), (e: unknown) => e instanceof MnemosAPIError && e.code === "git.merge.no_approver");
  answer = Response.json({ code: "internal.secret" }, { status: 409 });
  await assert.rejects(api.acceptMergeRequest("p", "c", "1", 7, "abc"), (e: unknown) => e instanceof MnemosAPIError && e.code === undefined, "незнакомый код не передаётся");
});
