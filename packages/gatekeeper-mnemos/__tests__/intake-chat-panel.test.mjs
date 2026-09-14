import {test} from "node:test";
import assert from "node:assert/strict";
import {mountMemoryApp} from "./app-react-harness.mjs";
test("приём в панели показывает загрузку, закрывается по Escape и восстанавливает историю",async()=>{
 const saved={id:"one",blob_sha256_hex:"a".repeat(64),paths:["договор.txt"],status:"approved",placement:"shared/legal/договор.txt",placement_state:"personal",personal_head:"b".repeat(64),result_project_id:"one",result_node_id:"doc",candidates:[]};
 const methods={async inboxStatus(){return {total:1,in_queue:0,awaiting_classification:0,awaiting_placement:0,placed_in_tree:1,dead_lettered:0,dead_letters:[]};},async inboxAlerts(decided){return {alerts:decided?[saved]:[],truncated:false};}};
 let app=await mountMemoryApp(methods,{section:"intake",presentationMode:"panel",pickedFiles:[{path:"договор.txt",receipt:{outcome:"enqueued",enqueued:true}}]});
 try {
  await app.until(()=>app.button("Выбрать файлы"),"выбор файлов панели");
  assert.equal(app.document.querySelector("#root h1"),null);assert.ok(!app.text().includes("Всего принято"));
  app.button("Выбрать файлы").click();await app.until(()=>app.text().includes("договор.txt"),"результат загрузки");
  assert.ok(app.calls.some(c=>c[0]==="pickInboxFiles"&&c[1]===false));
  app.document.defaultView.dispatchEvent(new app.document.defaultView.KeyboardEvent("keydown",{key:"Escape"}));
  await app.until(()=>app.calls.some(c=>c[0]==="closeIntake"),"закрытие по Escape");
 } finally {app.dispose();}
 app=await mountMemoryApp(methods,{section:"intake",presentationMode:"panel"});
 try{
  await app.until(()=>app.button("История решений")&&!app.button("История решений").matches(":disabled"),"повторное открытие");app.button("История решений").click();
  await app.until(()=>app.text().includes("договор.txt")&&app.text().includes("Личная версия"),"принятый файл сохранился");
 }finally{app.dispose();}
});
