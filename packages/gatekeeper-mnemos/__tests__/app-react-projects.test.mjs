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
    await app.until(() => section("Последние материалы")?.textContent.includes("Заметка команды"), "обзор проекта по умолчанию");
    assert.ok(section("Последние материалы").textContent.includes("На согласовании · 1 из 2"), "статус документа в обзоре");
    await app.until(() => section("Ждёт решения")?.textContent.includes("Проверить ТЗ на страницу цен"), "текущая работа проекта");
    assert.ok(section("Ждёт решения").textContent.includes("alice"), "кто ведёт");
    assert.ok(section("Ждёт решения").textContent.includes("Согласовать: Заметка команды"), "согласование, где решение за текущим человеком");
    app.tab("Материалы").click();
    await app.until(() => section("Материалы")?.textContent.includes("Заметка команды"), "материалы проекта");
    assert.ok(section("Материалы").textContent.includes("На согласовании · 1 из 2"), "статус документа");
    assert.ok(section("Папки")?.textContent.includes("Папка"), "папки проекта");
    app.tab("Участники").click();
    await app.until(() => section("Участники и направления")?.textContent.includes("Кэрол"), "участники из политики");
    assert.ok(section("Участники и направления").textContent.includes("Согласует направление Дизайн"), "роль по направлению");
    assert.ok(section("Участники и направления").textContent.includes("dave"), "согласующий без имени показан по идентификатору");
    await app.until(() => section("Агенты проекта")?.textContent.includes("agent-alice"), "агенты");
    await app.until(() => section("Правила согласования")?.textContent.includes("Папка"), "правило по папке");
    assert.ok(section("Правила согласования").textContent.includes("Все документы проекта"), "правило на весь проект");
    await app.until(() => section("Источники проекта")?.textContent.includes("Аналитика") && section("Источники проекта").textContent.includes("yandex"), "источники проекта");

    app.button("Настроить согласования").click();
    await app.until(() => app.button("Сохранить настройки согласования"), "редактор правил открыт внутри вкладки");
    assert.ok(app.text().includes("Направление 1"));
    app.button("Назад").click();
    await app.until(() => section("Правила согласования"), "возврат на страницу проекта");

    app.tab("Материалы").click();
    await app.until(() => app.button("Все документы проекта"), "вкладка материалов");
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
    await app.until(() => section("Ждёт решения"), "обзор проекта");
    assert.equal(section("Ждёт решения").textContent.includes("Проверить ТЗ"), false, "обращений нет");
    app.tab("Участники").click();
    await app.until(() => section("Правила согласования")?.textContent.includes("Правил согласования нет"), "пустые правила");
    app.button("Второй проект").click();
    // Вкладки первого проекта ещё на экране: ждём заголовок второго, иначе щелчок уйдёт в старую страницу.
    await app.until(() => [...app.document.querySelectorAll("#root h2")].some(h => h.textContent === "Второй проект"), "второй проект");
    await app.until(() => section("Ждёт решения")?.textContent.includes("ничего не ждёт вашего решения"), "у второго проекта ничего не ждёт решения");
    app.tab("Участники").click();
    await app.until(() => section("Правила согласования")?.textContent.includes("нет права или сервер отказал"), "отказ показан");
  } finally { app.dispose(); }
});


test("«Мои проекты»: обзор с материалами открыт сразу, скрытых настроек нет, беседа начинается с выбранным проектом", async () => {
  const app = await mountMemoryApp({}, {section: "projects", project: "two"});
  try {
    await app.until(() => app.button("Начать беседу"), "страница проекта");
    assert.ok(app.text().includes("Мои проекты"));
    assert.equal(app.document.querySelectorAll("#root details").length, 0, "главное содержимое не свёрнуто");
    assert.equal(app.tab("Обзор").getAttribute("aria-selected"), "true");
    assert.deepEqual(app.tabs().map(t => t.textContent), ["Обзор", "Материалы", "Задачи агентов", "Участники"], "без репозитория вкладки «Код» нет");
    await app.until(() => app.document.querySelector('#root section[aria-label="Последние материалы"]')?.textContent.includes("Другой документ"), "материалы в обзоре");
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
  try {await app.until(()=>app.tab("Материалы"),"вкладки проекта");app.tab("Материалы").click();
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
 try {await app.until(()=>app.tab("Материалы"),"вкладки проекта");app.tab("Материалы").click();
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
 try {await app.until(()=>app.tab("Материалы"),"вкладки проекта");app.tab("Материалы").click();
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

test("Область меняется у выбранных файлов до подтверждения, исключённый файл сохраняет предложение", async()=>{
 const decisions=[];
 const alerts=["a","b","c"].map(id=>({id,blob_sha256_hex:id.repeat(64),status:"open",paths:[`${id}.txt`],suggested_domain:"legal",candidates:[]}));
 const app=await mountMemoryApp({
  async inboxAlerts(decided){return {alerts:decided?[]:alerts,truncated:false};},
  async decideInboxAlert(id,decision){decisions.push({id,decision});return {};},
 },{section:"projects",project:"two"});
 try {await app.until(()=>app.tab("Материалы"),"вкладки проекта");app.tab("Материалы").click();
  await app.until(()=>app.button("Подтвердить: 3")&&!app.button("Подтвердить: 3").closest("fieldset").disabled,"список поступлений");
  const area=name=>app.document.querySelector(`[aria-label="Область: ${name}.txt"]`);
  const checks=app.document.querySelectorAll('section[aria-label="Проверьте загруженные материалы"] input[type="checkbox"]');
  checks[2].click();
  await app.until(()=>app.button("Подтвердить: 2"),"два выбранных файла");
  const bulk=app.document.querySelector('[aria-label="Область выбранных файлов"]');
  assert.ok(bulk,"есть общая смена области");
  app.type(bulk,"finance");
  await app.until(()=>app.button("Применить к выбранным")&&!app.button("Применить к выбранным").disabled,"область введена");
  app.button("Применить к выбранным").click();
  await app.until(()=>area("a").value==="finance"&&area("b").value==="finance","область применена");
  assert.equal(area("c").value,"legal");
  assert.equal(decisions.length,0,"редактирование ещё не отправляет решение");
  app.button("Подтвердить: 2").click();
  await app.until(()=>decisions.length===2,"подтверждены только выбранные");
  assert.deepEqual(decisions.map(d=>[d.id,d.decision.place]),[["a","second/finance/a.txt"],["b","second/finance/b.txt"]]);
 }finally{app.dispose();}
});

test("Поступления проекта показывают обработку до появления вопроса",async()=>{
 const app=await mountMemoryApp({
  async inboxStatus(project){assert.equal(project,"two");return {total:3,in_queue:2,awaiting_classification:0,awaiting_placement:1,placed_in_tree:0,dead_lettered:0,dead_letters:[]};},
  async inboxAlerts(){return {alerts:[],truncated:false};},
 },{section:"projects",project:"two"});
 try{await app.until(()=>app.tab("Материалы"),"вкладки проекта");app.tab("Материалы").click();await app.until(()=>app.text().includes("В обработке: 3"),"виден ход обработки");assert.equal(app.button("Подтвердить: 0"),undefined);}finally{app.dispose();}
});

test("Переходы между разделами, проектами и вкладками не перезагружают данные", async () => {
  let loads = 0;
  const app = await mountMemoryApp({ async listProjects() { loads++; return { projects: [{ id: "one", name: "Общий проект", slug: "shared" }, { id: "two", name: "Второй проект", slug: "second" }] }; } }, { section: "projects", project: "one" });
  try {
    const heading = name => [...app.document.querySelectorAll("#root h2")].some(h => h.textContent === name);
    await app.until(() => heading("Общий проект"), "первый проект");
    const before = loads;
    app.button("Второй проект").click();
    await app.until(() => heading("Второй проект"), "второй проект без перезагрузки");
    app.tab("Участники").click();
    await app.until(() => app.document.querySelector('#root section[aria-label="Правила согласования"]'), "вкладка сразу после смены проекта");
    app.go("documents");
    await app.until(() => app.document.querySelector("#root h1")?.textContent === "Материалы", "раздел из меню");
    app.go("projects", "one", "members");
    await app.until(() => heading("Общий проект") && app.document.querySelector('#root section[aria-label="Правила согласования"]'), "проект и вкладка из адреса");
    assert.equal(loads, before, "список проектов не загружался заново");
    assert.ok(app.calls.some(([name, section, project]) => name === "openSection" && section === "projects" && project === "two"), "выбор проекта записан в адрес");
  } finally { app.dispose(); }
});
