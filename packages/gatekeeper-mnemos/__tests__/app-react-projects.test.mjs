import { test } from "node:test";
import assert from "node:assert/strict";
import { mountMemoryApp } from "./app-react-harness.mjs";

test("«Проекты»: список, страница проекта с участниками, материалами, работой, правилами и источниками; редактор правил", async () => {
  const app = await mountMemoryApp({
    async readPublicationPolicy(project) {
      if (project !== "one") return { project_id: project, revision: 1, domains: [] };
      return { project_id: "one", revision: 4, domains: [{ domain_id: "Дизайн", node_ids: ["dir"], approver_ids: ["carol"] }, { domain_id: "Разработка", all_documents: true, node_ids: [], approver_ids: ["alice", "dave"] }] };
    },
    async listPolicyApprovers(project) { return { approvers: project === "one" ? [{ principal_id: "carol", display_name: "Кэрол" }, { principal_id: "alice", display_name: "Алиса" }, { principal_id: "dave", display_name: "" }] : [], next_cursor: "" }; },
    async listMailConnections() { return { connections: [{ connection_id: "m-1", project_id: "one", provider: "yandex", query_sha256: "", revision: 1, enabled: true }] }; },
    async listVisibleDatabaseConnections() { return { databases: [{ db_id: "db-1", project_id: "one", name: "Аналитика", driver: "postgres", env_var: "", registered_by: "alice", registered_at: "", configured: true, last_sweep_at: "2026-09-12T09:10:00Z", unreachable_since: "" }], truncated: false }; },
  });
  try {
    await app.open("Проекты");
    await app.until(() => app.button("Общий проект") && app.button("Второй проект"), "список проектов");
    assert.ok(app.button("Создать проект"), "проект можно создать прямо во вкладке");
    app.button("Общий проект").click();
    const section = name => app.document.querySelector(`#root section[aria-label="${name}"]`);
    await app.until(() => section("Участники и направления")?.textContent.includes("Кэрол"), "участники из политики");
    assert.ok(section("Участники и направления").textContent.includes("Согласует направление Дизайн"), "роль по направлению");
    assert.ok(section("Участники и направления").textContent.includes("dave"), "согласующий без имени показан по идентификатору");
    await app.until(() => section("Материалы")?.textContent.includes("Заметка команды"), "материалы проекта");
    assert.ok(section("Материалы").textContent.includes("На согласовании · 1 из 2"), "статус документа");
    await app.until(() => section("Текущая работа")?.textContent.includes("Проверить ТЗ на страницу цен"), "текущая работа проекта");
    assert.ok(section("Текущая работа").textContent.includes("alice"), "кто ведёт");
    await app.until(() => section("Агенты проекта")?.textContent.includes("agent-alice"), "агенты");
    await app.until(() => section("Правила согласования")?.textContent.includes("Папка"), "правило по папке");
    assert.ok(section("Правила согласования").textContent.includes("Все документы проекта"), "правило на весь проект");
    await app.until(() => section("Источники проекта")?.textContent.includes("Аналитика") && section("Источники проекта").textContent.includes("yandex"), "источники проекта");

    app.button("Настроить согласования").click();
    await app.until(() => app.button("Сохранить настройки согласования"), "редактор правил открыт внутри вкладки");
    assert.ok(app.text().includes("Направление 1"));
    app.button("Назад").click();
    await app.until(() => section("Правила согласования"), "возврат на страницу проекта");

    app.button("Все документы проекта").click();
    await app.until(() => app.document.querySelector("#root h1")?.textContent === "Материалы", "переход к документам");
    // Кнопка проекта в «Документах» несёт счётчик документов, поэтому ищется по началу текста.
    await app.until(() => app.buttons().find(b => b.textContent.startsWith("Общий проект"))?.getAttribute("aria-current") === "true", "выбран тот же проект");
  } finally { app.dispose(); }
});

test("«Проекты»: пустая политика и отказ сервера показаны честно", async () => {
  const app = await mountMemoryApp({
    async readPublicationPolicy(project) { if (project === "two") throw new Error("forbidden"); return { project_id: project, revision: 1, domains: [] }; },
    async listCollaborations() { return { requests: [], next_cursor: "" }; },
  });
  try {
    await app.open("Проекты");
    await app.until(() => app.button("Общий проект"), "список проектов");
    const section = name => app.document.querySelector(`#root section[aria-label="${name}"]`);
    await app.until(() => section("Правила согласования")?.textContent.includes("Правил согласования нет"), "пустые правила");
    assert.ok(section("Текущая работа").textContent.includes("Текущей работы нет"), "пустая работа");
    app.button("Второй проект").click();
    await app.until(() => section("Правила согласования")?.textContent.includes("нет права или сервер отказал"), "отказ показан");
  } finally { app.dispose(); }
});


test("«Мои проекты»: материалы видны сразу, настройки свёрнуты, беседа начинается с выбранным проектом", async () => {
  const app = await mountMemoryApp({}, {section: "projects", project: "two"});
  try {
    await app.until(() => app.button("Начать беседу"), "страница проекта");
    assert.ok(app.text().includes("Мои проекты"));
    const settings = [...app.document.querySelectorAll("#root details")].find(e => e.querySelector("summary")?.textContent === "Участники и настройки проекта");
    assert.ok(settings);
    assert.equal(settings.open, false);
    const materials = app.document.querySelector('#root section[aria-label="Материалы"]');
    assert.ok(materials);
    assert.equal(materials.closest("details"), null);
    app.button("Начать беседу").click();
    await app.until(() => app.calls.some(c => c[0] === "openPrompt"), "подготовка беседы");
    const prompt = app.calls.find(c => c[0] === "openPrompt")[1];
    assert.match(prompt, /Второй проект/);
    assert.deepEqual(JSON.parse(JSON.stringify(app.calls.find(c => c[0] === "openPrompt")[2])),{projectId:"two",title:"Второй проект"});
    assert.equal(app.calls.some(c => c[0] === "proposeConnectProject"), false);
  } finally { app.dispose(); }
});


test("Файлы и папки загружаются в выбранный проект, а не в беседу", async () => {
  const app = await mountMemoryApp({}, {section: "projects", project: "two", pickedFiles: [{path: "договор.pdf", receipt: {outcome: "placed", enqueued: false, placement_state: "personal"}}]});
  try {
    await app.until(() => app.button("Загрузить файлы"), "загрузка проекта");
    app.button("Загрузить файлы").click();
    await app.until(() => app.text().includes("Принято файлов: 1 из 1"), "результат загрузки");
    assert.ok(app.calls.some(c => c[0] === "pickInboxFiles" && c[1] === false && c[2] === "two"));
    assert.ok(app.text().includes("личные черновики проекта"));
    app.button("Выбрать папку").click();
    await app.until(() => app.calls.some(c => c[0] === "pickInboxFiles" && c[1] === true && c[2] === "two"), "папка в том же проекте");
    assert.equal(app.calls.some(c => c[0] === "openPrompt"), false);
  } finally { app.dispose(); }
});


test("Материал проекта открывается непосредственно в гаджете", async () => {
  const app = await mountMemoryApp({}, {section: "projects", project: "one", nativeOpen: true});
  try {
    await app.until(() => app.button("Заметка команды"), "документ в проекте");
    app.button("Заметка команды").click();
    await app.until(() => app.calls.some(c => c[0] === "openNativeDocument"), "переход в редактор");
    assert.equal(app.calls.find(c => c[0] === "openNativeDocument")[1], "one");
    assert.equal(app.calls.some(c => c[0] === "openSection" && c[1] === "documents"), false);
  } finally { app.dispose(); }
});


test("Материалы проекта: подтверждение области и обновление после размещения", async()=>{
 let confirmed=false;
 const decisions=[];
 const alert={id:"q1",blob_sha256_hex:"a".repeat(64),status:"open",paths:["договор.txt"],suggested_domain:"legal",candidates:[]};
 const app=await mountMemoryApp({
  async inboxAlerts(decided,project){
   assert.equal(project,"two");
   return {alerts:decided?(confirmed?[{...alert,status:"approved",result_project_id:"two",result_node_id:"new-doc"}]:[]):(confirmed?[]:[alert]),truncated:false};
  },
  async decideInboxAlert(id,decision){decisions.push({id,decision});confirmed=true;return {alert:{...alert,status:"approved"}};},
 },{section:"projects",project:"two"});
 try {
  await app.until(()=>app.button("Подтвердить: 1")&&!app.button("Подтвердить: 1").closest("fieldset").disabled,"область готова к подтверждению");
  app.button("Подтвердить: 1").click();
  await app.until(()=>app.text().includes("Список документов обновлён"),"результат размещения прочитан");
  assert.deepEqual(JSON.parse(JSON.stringify(decisions)),[{id:"q1",decision:{approve:true,place:"second/legal/договор.txt",intake_project_id:"two"}}]);
  assert.equal(app.button("Подтвердить: 1"),undefined);
 } finally {app.dispose();}
});


test("Потерянный ответ подтверждения блокирует повтор до чтения сервера", async()=>{
 let sent=false, writes=0, release;
 const reread=new Promise(resolve=>{release=resolve;});
 const alert={id:"q-lost",blob_sha256_hex:"b".repeat(64),status:"open",paths:["счёт.txt"],suggested_domain:"finance",candidates:[]};
 const app=await mountMemoryApp({
  async inboxAlerts(decided,project){
   assert.equal(project,"two");
   if(sent)await reread;
   return {alerts:decided?[]:sent?[]:[alert],truncated:false};
  },
  async decideInboxAlert(){writes++;sent=true;throw Error("response lost");},
 },{section:"projects",project:"two"});
 try {
  await app.until(()=>app.button("Подтвердить: 1")&&!app.button("Подтвердить: 1").closest("fieldset").disabled,"первое подтверждение доступно");
  app.button("Подтвердить: 1").click();
  await app.until(()=>app.text().includes("Остальные решения проверяем по серверу"),"неизвестный результат показан");
  assert.equal(app.button("Подтвердить: 1").closest("fieldset").disabled,true);
  assert.equal(writes,1);
  release();
  await app.until(()=>!app.button("Подтвердить: 1"),"сервер подтвердил отсутствие открытого вопроса");
  assert.equal(writes,1);
 } finally {release();app.dispose();}
});
