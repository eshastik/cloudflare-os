import {test} from "node:test";
import assert from "node:assert/strict";
import {mountMemoryApp} from "./app-react-harness.mjs";

test("прямой раздел материалов открывается с выбранным проектом без второго меню",async()=>{
 const app=await mountMemoryApp({}, {section:"documents",project:"two"});
 try {
  await app.until(()=>app.document.querySelector("#root h1")?.textContent==="Материалы" && app.text().includes("Другой документ"),"материалы выбранного проекта");
  assert.equal(app.document.querySelectorAll('[role="tab"]').length,0);
  assert.equal(app.document.querySelector("#legacy").hidden,true);
 } finally {app.dispose();}
});

test("наличие проекта не открывает управление организацией",async()=>{
 const app=await mountMemoryApp({async whoAmI(){return {subject:{tenant_id:"org",user_id:"reader"},tenant_name:"Команда",capabilities:[]}}},{section:"organization"});
 try {
  await app.until(()=>app.text().includes("Этот раздел недоступен"),"отказ без полномочий");
  assert.equal(app.button("Открыть: Журнал операций"),undefined);
 } finally {app.dispose();}
});

test("неизвестная прямая ссылка не открывает другой раздел молча",async()=>{
 const app=await mountMemoryApp({}, {section:"unknown"});
 try {await app.until(()=>app.text().includes("Раздел не найден"),"ошибка ссылки");}
 finally {app.dispose();}
});
