import {test} from "node:test";
import assert from "node:assert/strict";
import {mountMemoryApp} from "./app-react-harness.mjs";

// Каждый раздел перечня открывается со своим заголовком и содержимым, а не пустой страницей и не чужим разделом.
const SECTIONS = [
 ["my-work","Входящие",'[aria-label="Ждут вашего решения"]'],
 ["projects","Проекты",'nav[aria-label="Список проектов"]'],
 ["documents","Материалы",'[aria-label="Поиск по материалам"]'],
 ["team","Мой отдел","section"],
 ["people","Люди и отделы",'section[aria-label="Люди и отделы"]'],
 ["rules","Правила",'section[aria-label="Правила организации"]'],
 ["connections","Подключения",'section[aria-label="Почта"]'],
 ["agents","Агенты и расходы",'section[aria-label="Бюджеты проектов"]'],
 ["journal","Журнал и состояние",'section[aria-label="Журнал действий"]'],
];
const heading = app => app.document.querySelector("#root h1")?.textContent;

for (const [id, title, marker] of SECTIONS) test(`раздел ${id} открывается со своим заголовком «${title}» и содержимым`, async () => {
 const app = await mountMemoryApp({}, {section:id});
 try {
  await app.until(() => heading(app) === title && app.document.querySelector(`#root ${marker}`), `раздел ${id}`);
  assert.ok(!app.text().includes("Раздел не открылся"), "без ошибки отрисовки");
 } finally {app.dispose();}
});

test("переход между разделами без перезагрузки фрейма каждый раз показывает выбранный раздел", async () => {
 const app = await mountMemoryApp({}, {section:"projects"});
 try {
  for (const [id, title, marker] of [...SECTIONS, SECTIONS[7], SECTIONS[0], SECTIONS[7]]) {
   app.go(id);
   await app.until(() => heading(app) === title && app.document.querySelector(`#root ${marker}`), `переход в ${id}`);
  }
 } finally {app.dispose();}
});

test("прежние адреса ведут в новые разделы", async () => {
 for (const [old, title] of [["approvals","Входящие"],["sources","Подключения"],["templates","Журнал и состояние"],["analytics","Агенты и расходы"],["intake","Материалы"],["organization","Правила"]]) {
  const app = await mountMemoryApp({}, {section:old});
  try { await app.until(() => heading(app) === title, `${old} → ${title}`); }
  finally {app.dispose();}
 }
});

test("панель приёма рядом с беседой по-прежнему открывается адресом intake", async () => {
 const app = await mountMemoryApp({}, {section:"intake", presentationMode:"panel"});
 try { assert.ok(app.document.querySelector('[aria-label="Приём данных"]')); }
 finally {app.dispose();}
});

test("прямой раздел материалов открывается с выбранным проектом без второго меню",async()=>{
 const app=await mountMemoryApp({}, {section:"documents",project:"two"});
 try {
  await app.until(()=>heading(app)==="Второй проект" && app.text().includes("Другой документ"),"материалы выбранного проекта");
  assert.deepEqual([...app.document.querySelectorAll('[role="tab"]')].map(tab => tab.textContent),["Файлы", "Беседы"]);
 } finally {app.dispose();}
});

test("правила и журнал закрыты сотруднику без полномочий",async()=>{
 for (const section of ["rules","journal","organization"]) {
  const app=await mountMemoryApp({async whoAmI(){return {subject:{tenant_id:"org",user_id:"reader"},tenant_name:"Команда",capabilities:[]}}},{section});
  try {
   await app.until(()=>app.text().includes("Этот раздел доступен администратору"),`отказ в ${section}`);
   assert.equal(app.document.querySelector('#root section[aria-label="Журнал действий"]'),null);
  } finally {app.dispose();}
 }
});

test("неизвестная прямая ссылка не открывает другой раздел молча",async()=>{
 const app=await mountMemoryApp({}, {section:"unknown"});
 try {await app.until(()=>app.text().includes("Раздел не найден"),"ошибка ссылки");}
 finally {app.dispose();}
});


test("адрес материалов передаёт выбранный оригинал хосту при прямой ссылке и смене проекта", async () => {
 const app = await mountMemoryApp({async nodeHistory(_project, node) {
  return {events: [{event_id: `published-${node}`, exists: true, recorded_at: "2026-10-02T10:00:00Z"}]};
 }}, {section: "documents", project: "one", document: "doc"});
 const previews = () => app.calls.filter(call => call[0] === "previewFile");
 try {
  await app.until(() => previews().length === 1, "оригинал по начальной ссылке");
  assert.deepEqual(previews()[0], ["previewFile", "one", "doc", "file-publication:published-doc", "Заметка команды", "Общий проект"]);
  app.go("documents", "two");
  await app.until(() => app.buttons().some(b => b.textContent === "Другой документ"), "смена проекта");
  app.button("Другой документ").click();
  await app.until(() => previews().length === 2, "выбранный оригинал");
  assert.deepEqual(previews()[1], ["previewFile", "two", "other", "file-publication:published-other", "Другой документ", "Второй проект"]);
  app.go("documents", "one", "", "doc");
  await app.until(() => previews().length === 3, "возврат по ссылке");
  assert.deepEqual(previews()[2], previews()[0]);
  assert.equal(app.document.querySelector('[aria-label="Просмотр документа"]'), null, "оригинал не заменяется извлечённым текстом в боковой панели");
 } finally {app.dispose();}
});
