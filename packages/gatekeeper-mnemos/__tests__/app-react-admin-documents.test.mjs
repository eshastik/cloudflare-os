import {test} from "node:test";
import assert from "node:assert/strict";
import {mountMemoryApp} from "./app-react-harness.mjs";

test("администратор выбирает автора и читает его точную личную версию",async()=>{
 const requests=[];
 const app=await mountMemoryApp({
  async readPrincipalMembership(){return {enabled:true};},
  async listPeople(){return {users:[{userName:"bob",displayName:"Борис",active:true}]};},
  async listPrivateDocumentsForOwner(project,owner,cursor){requests.push([project,owner,cursor]);return {documents:[{node_id:"private-doc",name:"Черновик Бориса",content_type:"text/plain",conflicted:false}],head:"c".repeat(64),next_cursor:""};},
 },{section:"documents"});
 try {
  const block=()=>app.document.querySelector('#root details[aria-label="Личные версии сотрудников"]');
  await app.until(()=>block(),"административный просмотр раскрывается на странице материалов");
  block().open=true;block().dispatchEvent(new app.dom.window.Event("toggle"));
  await app.until(()=>app.document.querySelector('[aria-label="Автор личных версий"] option[value="bob"]'),"выбор автора по имени");
  app.type(app.document.querySelector('[aria-label="Автор личных версий"]'),"bob");
  await app.until(()=>app.button("Черновик Бориса"),"личный документ");
  app.button("Черновик Бориса").click();
  await app.until(()=>app.text().includes("текст"),"содержимое чужого черновика");
  assert.deepEqual(requests,[["one","bob",""]]);
  assert.ok(app.text().includes("Борис"));
  assert.deepEqual(app.calls.find(c=>c[0]==="downloadText"),["downloadText","one","private-doc","private:"+"c".repeat(64),0]);
  assert.equal(app.button("Открыть личный черновик"),undefined);
  assert.equal(app.buttons().some(b=>b.textContent==="К материалам"),false,"без отдельного экрана");
  app.button("Скачать файл").click();
  await app.until(()=>app.calls.some(c=>c[0]==="downloadFile"),"скачивание исходного файла");
  assert.deepEqual(app.calls.find(c=>c[0]==="downloadFile"),["downloadFile","one","private-doc","private:"+"c".repeat(64),"Черновик Бориса"]);
 }finally{app.dispose();}
});
