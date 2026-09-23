import { test } from "node:test";
import assert from "node:assert/strict";
import { mountMemoryApp } from "./app-react-harness.mjs";

test("из материала открывается личный черновик того же проекта и документа", async () => {
  const calls=[];
  const app=await mountMemoryApp({
    async openDraft(project){calls.push(["open",project]);return {};},
    async readDraftDocument(project,node){calls.push(["read",project,node]);return {node_id:node,head:"a".repeat(64),name:"Заметка команды",exists:true,conflicted:false,content_type:"text/plain",terms:[{present:true}]};},
  },{section:"documents"});
  try {
    await app.until(()=>app.button("Заметка команды"),"список материалов");
    app.button("Заметка команды").click();
    await app.until(()=>app.button("Открыть личный черновик"),"просмотр документа");
    app.button("Открыть личный черновик").click();
    await app.until(()=>app.document.querySelector("#legacy textarea")?.value==="текст","личный редактор");
    assert.deepEqual(calls,[["open","one"],["read","one","doc"]]);
    assert.equal(app.calls.filter(c=>c[0]==="publishDraft").length,0);
    [...app.document.querySelectorAll("#legacy button")].find(b=>b.textContent==="Закрыть редактор").click();
    await app.until(()=>app.button("Открыть личный черновик"),"возврат к тому же материалу");
    assert.match(app.text(),/Заметка команды/);
  }finally{app.dispose();}
});

test("Назад сохраняет несохранённый текст при отмене и очищает признак после подтверждения", async () => {
  const app = await mountMemoryApp({
    async openDraft() { return {}; },
    async readDraftDocument(project,node) { return {node_id:node,head:"a".repeat(64),name:"Заметка команды",exists:true,conflicted:false,content_type:"text/plain",terms:[{present:true}]}; },
  }, {section:"documents"});
  try {
    await app.until(()=>app.button("Заметка команды"),"материалы"); app.button("Заметка команды").click();
    await app.until(()=>app.button("Открыть личный черновик"),"материал"); app.button("Открыть личный черновик").click();
    await app.until(()=>app.document.querySelector("#legacy textarea")?.value==="текст","редактор");
    const area=app.document.querySelector("#legacy textarea"); app.type(area,"Важная несохранённая правка");
    await app.until(()=>app.calls.some(c=>c[0]==="setUnsavedChanges"&&c[1]===true),"dirty bridge");
    let confirmations=0; app.dom.window.confirm=()=>{confirmations++;return false;};
    app.button("Назад").click();
    assert.equal(confirmations,1); assert.equal(app.document.querySelector("#legacy textarea").value,"Важная несохранённая правка");
    app.dom.window.confirm=()=>true; app.button("Назад").click();
    await app.until(()=>app.button("Открыть личный черновик"),"выход из редактора");
    await app.until(()=>app.calls.filter(c=>c[0]==="setUnsavedChanges").at(-1)?.[1]===false,"очищенный dirty bridge");
  } finally {app.dispose();}
});

test("Назад не теряет настройки предметного согласования при отмене", async () => {
  const app=await mountMemoryApp({}, {section:"projects"});
  try {
    await app.until(()=>app.button("Общий проект"),"проект"); app.button("Общий проект").click();
    await app.until(()=>app.tab("Участники"),"вкладки проекта"); app.tab("Участники").click();
    await app.until(()=>app.button("Настроить согласования"),"настройки проекта"); app.button("Настроить согласования").click();
    await app.until(()=>app.button("Добавить направление"),"политика"); app.button("Добавить направление").click();
    await app.until(()=>app.document.querySelector("#legacy input"),"новое направление");
    app.type(app.document.querySelector("#legacy input"),"Юридические вопросы");
    await app.until(()=>app.calls.some(c=>c[0]==="setUnsavedChanges"&&c[1]===true),"dirty policy");
    let confirmations=0; app.dom.window.confirm=()=>{confirmations++;return false;};app.button("Назад").click();
    assert.equal(confirmations,1); assert.equal(app.document.querySelector("#legacy input").value,"Юридические вопросы");
  }finally{app.dispose();}
});
