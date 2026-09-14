import { test } from "node:test";
import assert from "node:assert/strict";
import { Miniflare } from "miniflare";
import { fileURLToPath } from "node:url";

const FLAGS = ["experimental", "allow_irrevocable_stub_storage", "nodejs_compat"];
const HEAD_A = "a".repeat(64), HEAD_B = "b".repeat(64), HEAD_S = "c".repeat(64);
const BEFORE = "# План\n\nПервый абзац.\n\n## Сроки\n\nСдать в марте.\n";
const AFTER = "# План\n\nПервый абзац.\n\n## Сроки\n\nСдать в апреле.\n";
// Владелец библиотеки и два наблюдателя: свой и из чужой организации.
const SUBJECTS = {
  "fixture-human-token": { tenant_id: "org", user_id: "alice" },
  "fixture-token-bob": { tenant_id: "org", user_id: "bob" },
  "fixture-token-carol": { tenant_id: "other", user_id: "carol" },
};
// Агентский credential связи Workshop владельца; выдаётся заглушкой только по человеческому токену.
const AGENT_TOKEN = "fixture-agent-token";

async function sha256Hex(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
}

/** Заглушка API и хранилища; каждый запрос записывается, чтобы тест видел, что и когда ушло. */
function backend(empty = false) {
  const calls = [];
  const uploads = new Map();
  const state = { empty, personalHead: HEAD_A, text: BEFORE, provisions: [], credentials: 0, revoked: false };
  const outboundService = async request => {
    const url = new URL(request.url);
    calls.push(`${request.method} ${url.origin}${url.pathname}`);
    if (url.origin === "https://objects.example") {
      if (request.method === "PUT") { uploads.set(url.pathname.split("/").at(-1), await request.text()); return new Response(null, { status: 200 }); }
      return new Response(new TextEncoder().encode(state.text), { status: 200 });
    }
    assert.equal(url.origin, "https://memory.example");
    // whoami отвечает по токену: наблюдатели подключают свои аккаунты; остальные пути — владелец
    // либо агентский credential его связи Workshop (S15).
    const token = (request.headers.get("Authorization") ?? "").replace(/^Bearer /, "");
    const subject = SUBJECTS[token];
    const by = token === AGENT_TOKEN ? "agent" : "human";
    calls[calls.length - 1] += ` by=${by}`;
    assert.ok(subject || token === AGENT_TOKEN, `неизвестный токен: ${token}`);
    const path = url.pathname;
    if (path === "/v1/whoami") { assert.ok(subject); return Response.json({ subject, tenant_name: subject.tenant_id === "org" ? "Команда" : "Чужие" }); }
    assert.ok(token === "fixture-human-token" || token === AGENT_TOKEN, `чужой токен на пути ${path}`);
    // Связь и credential выдаёт только человек; агентский токен сюда не пускается.
    if (path === "/v1/agent-connections/workshop") {
      assert.equal(by, "human");
      const body = await request.json();
      assert.match(body.request_id, /^[A-Za-z0-9_-]{43}$/);
      assert.ok(body.connection_name);
      assert.deepEqual(body.project_ids, ["project"]);
      state.provisions.push(body.request_id);
      return Response.json({ binding_id: "b1", agent_principal_id: "agent-b1", runtime_id: "workshop", runtime_agent_id: "b1", revoked: false,
        connection_name: body.connection_name, project_ids: body.project_ids });
    }
    if (path === "/v1/agent-connections/b1/credential") {
      assert.equal(by, "human");
      state.credentials++;
      return Response.json({ access_token: AGENT_TOKEN, token_type: "Bearer", expires_in: 900 });
    }
    if (path === "/v1/agent-connections/b1/revoke") { assert.equal(by, "human"); state.revoked = true; return Response.json({}); }
    if(path==="/v1/projects" && request.method==="POST"){assert.equal(by,"human");const body=await request.json();return Response.json({project:{id:"new-project",name:body.name,slug:body.slug}},{status:201})}
    if(path==="/v1/agent-connections/b1/workshop-scope"){assert.equal(by,"human");const ids=request.method==="GET"?["project"]:(await request.json()).project_ids;return Response.json({binding_id:"b1",project_ids:ids})}
    if (path === "/v1/projects") return Response.json({ projects: [{ id: "project", name: "Общий проект", slug: "shared" }] });
    if (path === "/v1/projects/project/nodes") return Response.json({ nodes: [{ node_id: "n1", name: "plan.md", is_dir: false }], truncated: false });
    if(path==="/v1/projects/project/draft/open"){assert.equal(by,"agent");if(state.empty)state.personalHead=HEAD_S;state.empty=false;return Response.json({head:state.personalHead})}
    if(path==="/v1/projects/project/draft/state"&&state.empty)return new Response("not initialized",{status:404});
    if (path === "/v1/projects/project/draft/state") return Response.json({ personal_exists: true, personal_head: state.personalHead, shared_head: HEAD_S });
    if (path === "/v1/projects/project/draft/nodes/n1") {
      return Response.json({ head: state.personalHead, node_id: "n1", exists: true, conflicted: false, content_type: "text/markdown",
        terms: [{ present: true, negative: false, metadata: { name: "plan.md", parent_id: "", content_type: "text/markdown" } }] });
    }
    if (path === "/v1/projects/project/draft/nodes/n1/download") {
      const body = await request.json();
      const bytes = new TextEncoder().encode(state.text);
      return Response.json({ head: body.expected_head, node_id: "n1", term_index: body.term_index, url: "https://objects.example/get/n1", method: "GET",
        size_bytes: bytes.length, sha256_hex: await sha256Hex(bytes), expires_at: "2100-01-01T00:00:00Z" });
    }
    if (path === "/v1/uploads") {
      const body = await request.json();
      return Response.json({ upload_id: "u1", url: "https://objects.example/put/u1", method: "PUT", checksum_header: "x-amz-checksum-sha256",
        checksum_value: body.checksum_sha256, content_length: body.size_bytes });
    }
    if(path === "/v1/projects/project/draft/create") {
      assert.equal(by,"agent"); const body=await request.json(); assert.equal(body.name,"new.md");assert.equal(body.parent_id,"");assert.equal(body.content_type,"text/markdown");assert.equal(body.expected_head,state.personalHead);
      calls.push("create by=agent");state.personalHead=HEAD_B;state.text=uploads.get(body.upload_id);return Response.json({node_id:"new-node",head:HEAD_B});
    }
    if (path === "/v1/projects/project/draft/save") {
      const body = await request.json();
      calls.push(`save by=${by} expected=${body.expected_head} upload=${body.changes[0].upload_id}`);
      if (body.expected_head !== state.personalHead) return new Response("conflict", { status: 409 });
      state.personalHead = HEAD_B; state.text = uploads.get(body.changes[0].upload_id) ?? "";
      return Response.json({ head: HEAD_B });
    }
    return new Response("not found", { status: 404 });
  };
  return { calls, uploads, state, outboundService };
}

const mnemosWorker = outboundService => ({
  name: "mnemos", modules: true, modulesRules: [{ type: "Text", include: ["**/*.txt"] }],
  scriptPath: fileURLToPath(new URL("../dist/mnemos.js", import.meta.url)),
  compatibilityDate: "2026-02-02", compatibilityFlags: FLAGS,
  bindings: { MNEMOS_API_ORIGIN: "https://memory.example", MNEMOS_STORAGE_ORIGIN: "https://objects.example" },
  durableObjects: { ACCOUNTS: { className: "UserAccount", useSQLite: true }, LIBRARIES: { className: "MnemosLibrary", useSQLite: true } },
  outboundService,
});

// Идентификатор DO аккаунта известен только внутри workerd, поэтому биндинг на
// GatekeeperUserImpl с props собирается вторым запуском конфигурации.
const driverWorker = userProps => ({
  name: "driver", modules: true, compatibilityDate: "2026-02-02", compatibilityFlags: FLAGS,
  durableObjects: { ACCOUNTS: { className: "UserAccount", scriptName: "mnemos", useSQLite: true }, DRIVER: { className: "Driver", useSQLite: true } },
  serviceBindings: userProps ? { USER: { name: "mnemos", entrypoint: "GatekeeperUserImpl", props: userProps } } : {},
  script: `import { DurableObject, RpcTarget } from "cloudflare:workers";
    class Queue extends RpcTarget {
      constructor(log) { super(); this.log = log; }
      async authorizeObservation(description) { if (!description.title) throw new Error("Наблюдение без заголовка"); this.log.push(["observe", description.title]); }
      async submitAction(action, description) {
        this.log.push(["submit", action, description.title, description.implementsRevert, description.description]);
      }
    }
    export class Driver extends DurableObject {
      async library() {
        const account = this.env.ACCOUNTS.get(this.env.ACCOUNTS.idFromName("owner"));
        await account.acceptVerifiedCredential("fixture-human-token");
        const singletonClass = await this.env.USER.getSingletonGatekeeperClass();
        return this.ctx.facets.get("library", () => ({ class: singletonClass, id: "library" }));
      }
      async run() {
        // describe() аккаунта читает подключение, поэтому credential принимается раньше.
        const library = await this.library();
        const description = await this.env.USER.describe();
        const resource = await library.describe();
        const types = await library.getTypeScriptTypes();
        const catalog = await library.getAgentCatalog({ limit: 10 }, new Queue([]));
        return { description, resource, typesLength: types.length, catalog };
      }
      async manage() {
        await this.library();const account=this.env.ACCOUNTS.get(this.env.ACCOUNTS.idFromName("owner"));
        const session=await account.openManagementSession();
        const project=await session.createProject("New project","new-project");
        const current=await session.readWorkshopAgentScope("b1");
        const scope=await session.updateWorkshopAgentScope("b1",current.project_ids,[project.project.id]);
        return {project,scope};
      }
      async create() {
        const library=await this.library();const log=[];const session=await library.startSession(new Queue(log));
        const proposal=await session.createDraft("project","","new.md",${JSON.stringify(AFTER)});
        return {proposal,log};
      }
      async draft() {
        const library = await this.library();
        const log = [];
        const session = await library.startSession(new Queue(log));
        const proposal = await session.saveDraft("project", "n1", ${JSON.stringify(AFTER)});
        let repeat = "";
        try { await library.applyAction(proposal.action); } catch (error) { repeat = error.message; }
        // Второе предложение после отзыва аккаунта: связь отозвана, запись не идёт.
        const account = this.env.ACCOUNTS.get(this.env.ACCOUNTS.idFromName("owner"));
        await account.revoke();
        let afterRevoke = "";
        try { await session.saveDraft("project", "n1", ${JSON.stringify(BEFORE)}); } catch (error) { afterRevoke = error.message; }
        return { proposal, log, repeat, afterRevoke };
      }
      // Верификатор наблюдателя — настоящий MnemosVerifier, выданный его же UserAccount.
      async observers() {
        const library = await this.library();
        const connect = async (name, token) => {
          const account = this.env.ACCOUNTS.get(this.env.ACCOUNTS.idFromName(name));
          await account.acceptVerifiedCredential(token);
          return account;
        };
        const bob = await connect("bob", "fixture-token-bob");
        const carol = await connect("carol", "fixture-token-carol");
        const attempt = async (id, account) => {
          try { await library.addObserver(id, await account.getVerifier()); return "ok"; } catch (error) { return error.message; }
        };
        const same = await attempt("bob", bob);
        const foreign = await attempt("carol", carol);
        // revoke — единственный публичный путь отключения аккаунта: владелец остаётся, токен пустеет.
        await bob.revoke();
        const revoked = await attempt("bob-again", bob);
        return { same, foreign, revoked };
      }
    }
    export default { async fetch(request, env) {
      const path = new URL(request.url).pathname;
      if (path === "/id") return Response.json({ id: env.ACCOUNTS.idFromName("owner").toString() });
      const driver = env.DRIVER.get(env.DRIVER.idFromName("driver"));
      const body = path === "/manage" ? await driver.manage() : path === "/create" ? await driver.create() : path === "/draft" ? await driver.draft() : path === "/observers" ? await driver.observers() : await driver.run();
      return Response.json(body);
    } };`,
});

async function drive(outboundService, path) {
  const mf = new Miniflare({ workers: [mnemosWorker(outboundService), driverWorker(null)] });
  try {
    const { id } = await (await (await mf.getWorker("driver")).fetch("https://driver.example/id")).json();
    await mf.setOptions({ workers: [mnemosWorker(outboundService), driverWorker({ userObjectId: id })] });
    const response = await (await mf.getWorker("driver")).fetch(`https://driver.example${path}`);
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    return body;
  } finally { await mf.dispose(); }
}

test("аккаунт объявляет синглтон MnemosLibrary, а его DO отвечает как гейткипер MNEMOS", async () => {
  const body = await drive(backend().outboundService, "/run");
  assert.equal(body.description.singleton.tsType, "MnemosLibrary");
  assert.equal(body.description.providesUi.title, "Память");
  assert.equal(body.resource.suggestedBindingName, "MNEMOS");
  assert.equal(body.resource.url, "mnemos://library");
  assert.equal(body.resource.tsType, "MnemosLibrary");
  assert.ok(body.typesLength > 0);
  assert.deepEqual(body.catalog.entries.map(entry => entry.id), ["project"]);
  assert.equal(body.catalog.entries[0].title, "Общий проект");
});

test("saveDraft пишет сразу агентским credential связи Workshop, очередь разрешений не используется", async () => {
  const api = backend();
  const body = await drive(api.outboundService, "/draft");
  assert.equal(body.proposal.action, 1);
  assert.equal(body.proposal.document, "n1");
  assert.equal(body.proposal.status,"saved");
  assert.equal(body.log.some(entry=>entry[0]==="submit"),false);
  const saveIndex = api.calls.findIndex(call => call.startsWith("POST https://memory.example/v1/projects/project/draft/save"));
  const uploadIndex = api.calls.findIndex(call => call === "PUT https://objects.example/put/u1");
  assert.ok(uploadIndex > 0 && saveIndex > uploadIndex, api.calls.join("\n"));
  assert.ok(api.calls.includes(`save by=agent expected=${HEAD_A} upload=u1`), api.calls.join("\n"));
  assert.equal(api.calls.filter(call => call.startsWith("PUT ")).length, 1);
  assert.equal(api.uploads.get("u1"), AFTER);
  assert.equal(api.state.text, AFTER);
  assert.match(body.repeat, /уже выполнено/);
  // S15: связь выдана человеком один раз, credential выпущен человеком, запись и загрузка — под агентским токеном;
  // bearer человека на путь записи не попадал.
  assert.equal(api.state.provisions.length, 1, api.calls.join("\n"));
  assert.ok(api.state.credentials >= 1);
  assert.ok(api.calls.includes("POST https://memory.example/v1/agent-connections/workshop by=human"), api.calls.join("\n"));
  assert.ok(api.calls.includes("POST https://memory.example/v1/agent-connections/b1/credential by=human"), api.calls.join("\n"));
  assert.ok(api.calls.includes("POST https://memory.example/v1/uploads by=agent"), api.calls.join("\n"));
  assert.ok(api.calls.includes("POST https://memory.example/v1/projects/project/draft/save by=agent"), api.calls.join("\n"));
  assert.ok(!api.calls.some(call => /\/(uploads|draft\/save|draft\/open) by=human$/.test(call)), api.calls.join("\n"));
  // Отзыв аккаунта отозвал связь на сервере; следующее одобрение — отказ без записи.
  assert.equal(api.state.revoked, true);
  assert.match(body.afterRevoke, /отозвана|отключён/);
  assert.equal(api.calls.filter(call => call.startsWith("save by=")).length, 1);
  assert.equal(api.state.text, AFTER);
});

test("addObserver принимает верификатор аккаунта той же организации и отвергает чужой и отключённый", async () => {
  const body = await drive(backend().outboundService, "/observers");
  assert.equal(body.same, "ok");
  assert.match(body.foreign, /другой организации/);
  assert.match(body.revoked, /другой организации/);
});

test("createDraft uses the real agent writer immediately",async()=>{
 const api=backend();const result=await drive(api.outboundService,"/create");
 assert.equal(result.proposal.document,"new-node");assert.equal(api.state.text,AFTER);assert.equal(api.calls.filter(c=>c==="create by=agent").length,1);assert.equal(result.log.some(e=>e[0]==="submit"),false);
});

test("human management RPC exposes creation and existing Workshop scope editing",async()=>{
 const result=await drive(backend().outboundService,"/manage");assert.equal(result.project.project.name,"New project");assert.deepEqual(result.scope.project_ids,["new-project"]);
});

test("createDraft initializes a fresh project through the real agent RPC writer",async()=>{
 const api=backend(true);const result=await drive(api.outboundService,"/create");assert.equal(result.proposal.document,"new-node");assert.equal(result.proposal.status,"saved");assert.ok(api.calls.some(c=>c==="POST https://memory.example/v1/projects/project/draft/open by=agent"));assert.equal(result.log.some(e=>e[0]==="submit"),false);
});
