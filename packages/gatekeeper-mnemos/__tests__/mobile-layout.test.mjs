// Вёрстка приложения на телефоне: настоящая сборка (src/generated/app.txt) в изолированном фрейме,
// Chrome с эмуляцией iPhone 390×844 и касаниями. Для каждого раздела: страница не шире экрана,
// а низ содержимого достижим прокруткой пальцем (жестом касания, не колесом).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { build } from "esbuild";

const WIDTH = 390, HEIGHT = 844, SHELL_BAR = 56;
const SECTIONS = [
  ["my-work"], ["projects"], ["projects", "p0"], ["documents"], ["team"], ["people"], ["rules"],
  ["journal"], ["connections"], ["connections", "", "repositories"], ["agents"],
];

// Данные заглушки: длинные имена и много строк, чтобы раздел был выше экрана и проверял переносы.
const STUB = String.raw`
  const LONG = ["Реконструкция складского комплекса в Подольске — второй этап", "Годовой отчёт", "Внедрение электронного документооборота с контрагентами", "Юридическое сопровождение сделки по приобретению", "Закупки оборудования для лаборатории контроля качества", "Стратегия 2027"];
  const projects = LONG.map((name, i) => ({ id: "p" + i, name, slug: "p" + i, visibility: ["private", "department", "organization"][i % 3], can_edit: true, org_unit_id: i % 2 ? "rd" : "" }));
  const nodes = id => Array.from({ length: 14 }, (_, i) => i < 3
    ? { node_id: id + "-d" + i, name: "Папка с очень длинным названием номер " + (i + 1), is_dir: true }
    : { node_id: id + "-f" + i, name: "Договор_поставки_оборудования_№" + (1000 + i) + "_редакция_согласованная_окончательная.docx", is_dir: false, parent_id: id + "-d0" });
  const people = [["alice", "Алиса Смирнова"], ["bob", "Борис Петров-Водкин"], ["kate", "Екатерина Константинопольская"]];
  const methods = {
    whoAmI: () => ({ subject: { tenant_id: "org", user_id: "alice" }, tenant_name: "Пример", capabilities: ["project.create", "principal.manage", "platform.metrics.read"], roles: { department_head: true, project_responsible: true, can_create_projects: true, responsible_projects: ["p1"] } }),
    listProjects: () => ({ projects }),
    browseProject: id => ({ nodes: nodes(id), truncated: false }),
    listPrivateDocuments: () => ({ documents: [], head: "d".repeat(64), next_cursor: "" }),
    draftState: () => ({ personal_head: "a".repeat(64), shared_head: "a".repeat(64), personal_exists: false }),
    readAgentAbsence: project => ({ project_id: project, local_binding_id: "", managed_binding_id: "", starts_at: "", ends_at: "", revision: 0, enabled: false }),
    listPublicationReviews: () => ({ reviews: [], next_cursor: "" }),
    listAgentConnections: () => ({ connections: [], next_cursor: "" }),
    managedTaskRequest: () => null, managedAgentRequest: () => null,
    listCollaborations: () => ({ requests: [], next_cursor: "" }),
    listShareRequests: () => ({ requests: [] }), listSharedDocuments: () => [],
    readProjectOverview: () => ({ l0: "Краткое описание проекта", l1: "Проект объединяет договоры, сметы и переписку по реконструкции.", pending: false, children: [] }),
    listProjectGitRepositories: () => ({ repositories: [] }),
    readPublicationPolicy: project => ({ project_id: project, revision: 1, domains: [] }),
    listPolicyApprovers: () => ({ approvers: [], next_cursor: "" }),
    listMailConnections: () => ({ connections: [] }), listCalendarConnections: () => ({ connections: [] }),
    listVisibleDatabaseConnections: () => ({ databases: [], truncated: false }), listGitConnections: () => ({ connections: [] }),
    listOrgUnits: () => [{ org_unit_id: "rd", name: "R&D", members: people.map(([id, name], i) => ({ principal_id: id, display_name: name, is_head: i !== 1 })) }],
    listPeople: () => ({ users: people.map(([userName, displayName]) => ({ userName, displayName, active: true })) }),
    listInvitations: () => [],
    readProjectSharingSettings: () => ({ personal_projects_enabled: true, project_create_by: "everyone", share_department_approval: "head", share_organization_by: "head", share_organization_approval: "none", default_visibility: "private" }),
    readSpending: period => ({ period, all_visible: true, micro_usd: "0", count: 0, estimated_count: 0, kinds: [], operations: [], projects: [], people: [], agents: [], models: [] }),
    externalAgentSetup: () => ({ resource: "https://memory.example/mcp", clientId: "mnemos-cli" }),
    inboxStatus: () => ({ total: 0, in_queue: 0, awaiting_classification: 0, awaiting_placement: 0, placed_in_tree: 0, dead_lettered: 0, dead_letters: [], dead_letters_truncated: false }),
    inboxAlerts: () => ({ alerts: [], truncated: false }),
    listWorkJournal: () => ({ entries: [], truncated: false }),
    readOperationAuditPage: () => ({ events: [], checkpoint: { sequence: 0, hash: "h" }, next: 0, truncated: false }),
    recordUIReadiness: () => {},
  };
`;

test("телефон 390 px: ни один раздел не шире экрана, низ достижим касанием", { timeout: 180000 }, async () => {
  const html = await readFile(new URL("../src/generated/app.txt", import.meta.url), "utf8");
  const output = await build({ stdin: { contents: `
    import { RpcTarget, newMessagePortRpcSession } from "capnweb";
    ${STUB}
    class UI extends RpcTarget {}
    for (const [name, fn] of Object.entries(methods)) UI.prototype[name] = async function (...args) { return fn(...args); };
    let place = { section: "my-work", project: "", view: "" };
    class Host extends RpcTarget {
      #ui = new UI(); get ui() { return this.#ui; }
      async subscribeTheme() { return "light"; } async subscribeAccent() { return "#1d6a50"; }
      async getSelectedSection() { return place.section; } async getSelectedProject() { return place.project; }
      async getSelectedView() { return place.view; } async getSelectedDocument() { return ""; }
      async getPresentationMode() { return "page"; } async setUnsavedChanges() {} async selectView() {} async openSection() {}
    }
    const frame = document.getElementById("app");
    const sessions = [];
    window.addEventListener("message", e => { if (e.source === frame.contentWindow && e.data?.type === "handshake") sessions.push(newMessagePortRpcSession(e.ports[0], new Host())); });
    window.openSection = (section, project, view) => { place = { section, project, view }; frame.srcdoc = ${JSON.stringify(html)}; };
    document.body.dataset.ready = "yes";
  `, resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", platform: "browser", minify: true });
  const script = output.outputFiles[0].text.replaceAll("</script", "<\\/script");
  const dir = await mkdtemp(join(tmpdir(), "mnemos-mobile-"));
  const page = join(dir, "index.html");
  // Как в оболочке: полоса 56 px сверху, фрейм занимает остальную высоту экрана.
  await writeFile(page, `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;height:100dvh;display:flex;flex-direction:column"><div style="height:${SHELL_BAR}px;flex:none"></div><iframe id="app" sandbox="allow-scripts allow-forms allow-modals" style="border:0;display:block;width:100%;flex:1;min-height:0"></iframe><script>${script}</script></body>`);
  const chrome = spawn(process.env.CHROME_BINARY || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless", "--hide-scrollbars", "--disable-background-networking", "--disable-component-update", "--disable-extensions", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${join(dir, "profile")}`, "--remote-debugging-port=0", "about:blank"], { detached: true, stdio: ["ignore", "ignore", "pipe"] });
  const problems = [];
  let socket;
  try {
    let stderr = "";
    const endpoint = await new Promise((ok, bad) => {
      chrome.stderr.on("data", chunk => { stderr += chunk; const m = stderr.match(/DevTools listening on (ws:\/\/\S+)/); if (m) ok(m[1]); });
      chrome.once("exit", () => bad(new Error("Chrome закрылся до запуска")));
      setTimeout(() => bad(new Error("Chrome не запустился")), 15000);
    });
    socket = new WebSocket(endpoint);
    await new Promise((ok, bad) => { socket.addEventListener("open", ok, { once: true }); socket.addEventListener("error", bad, { once: true }); });
    let seq = 0; const pending = new Map(); const contexts = new Map(); let frameSession = null;
    socket.addEventListener("message", event => {
      const m = JSON.parse(String(event.data));
      if (m.method === "Runtime.executionContextCreated" && m.params.context.auxData?.isDefault) contexts.set(m.params.context.auxData.frameId, m.params.context.id);
      if (m.method === "Target.attachedToTarget" && m.params.targetInfo.type === "iframe") frameSession = m.params.sessionId;
      if (m.id && pending.has(m.id)) { const { ok, bad } = pending.get(m.id); pending.delete(m.id); m.error ? bad(new Error(m.error.message)) : ok(m.result); }
    });
    const call = (method, params = {}, sessionId) => new Promise((ok, bad) => { const id = ++seq; pending.set(id, { ok, bad }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); });
    const { targetId } = await call("Target.createTarget", { url: "about:blank" });
    const { sessionId: S } = await call("Target.attachToTarget", { targetId, flatten: true });
    await call("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: HEIGHT, deviceScaleFactor: 3, mobile: true }, S);
    await call("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 }, S);
    await call("Page.enable", {}, S); await call("Runtime.enable", {}, S);
    await call("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, S);
    const evaluate = async (expression, sessionId = S, contextId) => (await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, ...(contextId ? { contextId } : {}) }, sessionId)).result?.value;
    const inFrame = async expression => {
      if (frameSession) return evaluate(expression, frameSession).catch(() => undefined);
      const child = (await call("Page.getFrameTree", {}, S)).frameTree.childFrames?.[0]?.frame.id;
      return child && contexts.has(child) ? evaluate(expression, S, contexts.get(child)).catch(() => undefined) : undefined;
    };
    const until = async (check, what) => { for (let i = 0; i < 600; i++) { if (await check()) return; await new Promise(r => setTimeout(r, 50)); } throw new Error(`не дождались: ${what}`); };
    await call("Page.navigate", { url: `file://${page}` }, S);
    await until(async () => (await evaluate("document.body?.dataset.ready")) === "yes", "страница стенда");

    for (const [section, project = "", view = ""] of SECTIONS) {
      const name = [section, project, view].filter(Boolean).join("/");
      contexts.clear();
      await evaluate(`openSection(${JSON.stringify(section)}, ${JSON.stringify(project)}, ${JSON.stringify(view)})`);
      // Раздел готов, когда в нём есть текст и нет признаков загрузки.
      await until(async () => (await inFrame(`(() => { const t = document.querySelector("#root")?.innerText ?? ""; return t.length > 40 && !/Загрузка|Загружаем/.test(t); })()`)) === true, `раздел ${name}`);
      const size = await inFrame(`({ scrollWidth: document.scrollingElement.scrollWidth, width: innerWidth, max: document.scrollingElement.scrollHeight - innerHeight })`);
      if (size.scrollWidth > size.width) problems.push(`${name}: страница шире экрана (${size.scrollWidth} > ${size.width})`);
      // Прокрутка пальцем: жесты снизу вверх, пока положение меняется.
      let last = -1;
      for (let i = 0; i < 40; i++) {
        await call("Input.synthesizeScrollGesture", { x: WIDTH / 2, y: HEIGHT - 120, yDistance: -(HEIGHT - 300), speed: 4000, gestureSourceType: "touch" }, S);
        const y = await inFrame("Math.round(scrollY)");
        if (y === last) break;
        last = y;
      }
      const end = await inFrame(`({ y: Math.round(scrollY), max: document.scrollingElement.scrollHeight - innerHeight })`);
      if (end.y < end.max - 2) problems.push(`${name}: касанием не дойти до низа (${end.y} из ${end.max})`);
    }
  } finally {
    socket?.close();
    try { process.kill(-chrome.pid, "SIGTERM"); } catch {}
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  assert.deepEqual(problems, []);
});
