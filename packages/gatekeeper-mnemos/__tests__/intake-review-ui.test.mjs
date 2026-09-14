import {test} from "node:test";
import assert from "node:assert/strict";
import {mountMemoryApp} from "./app-react-harness.mjs";

test("папка проверяется до размещения; частичный сбой не создаёт второй проект",async()=>{
 const events=[];let retry=false;const projects=[];
 let releaseRefresh;const refreshAllowed=new Promise(resolve=>{releaseRefresh=resolve;});
 const files=["one","two"].map((id,i)=>({id,blob_sha256_hex:id,paths:[`Папка/Файл${i+1}.txt`],status:"open",candidates:[],reason:"project.not_determined",suggested_domain:"право"}));
 const app=await mountMemoryApp({
  async listProjects(){if(events.some(e=>e[0]==="decide"))await refreshAllowed;return {projects};},
  async inboxStatus(){return {total:2,in_queue:0,awaiting_classification:2,awaiting_placement:0,placed_in_tree:0,dead_lettered:0,dead_letters:[]};},
  async inboxAlerts(){return {alerts:files.filter(f=>f.status==="open"),truncated:false};},
  async createProject(name,slug){events.push(["create",name,slug]);const project={id:"new",name,slug};projects.push(project);return {project};},
  async decideInboxAlert(id,input){events.push(["decide",id,input]);if(id==="two"&&!retry)throw Error("temporary");files.find(f=>f.id===id).status="approved";},
 },{section:"intake"});
 try {
  await app.until(()=>app.button("Папка"),"папка доступна для выбора");app.button("Папка").click();
  await app.until(()=>app.document.querySelector('[aria-label="Проект для выбранных"]'),"общие настройки");
  app.type(app.document.querySelector('[aria-label="Проект для выбранных"]'),"__new__");
  await app.until(()=>app.document.querySelector('[aria-label="Название нового проекта"]'),"имя проекта");
  app.type(app.document.querySelector('[aria-label="Название нового проекта"]'),"Договоры");
  app.type(app.document.querySelector('[aria-label="Область для выбранных"]'),"юридический");
  app.button("Применить к выбранным").click();
  await app.until(()=>app.document.querySelector('[aria-label="Область: Папка/Файл1.txt"]').value==="юридический","общая область назначена");
  app.button("Проверить итог размещения").click();
  await app.until(()=>app.button("Подтвердить размещение: 2"),"итог двух материалов");
  assert.equal(events.length,0,"до подтверждения изменений нет");
  app.button("Подтвердить размещение: 2").click();
  await app.until(()=>app.text().includes("Не подтверждено — обновите"),"частичный сбой показан");
  await app.until(()=>app.button("Проверить итог размещения"),"кнопка повторной проверки показана");
  assert.ok(app.button("Проверить итог размещения").matches(":disabled"),"до обновления форма заблокирована");
  releaseRefresh();
  await app.until(()=>app.button("Проверить итог размещения")?.matches(":disabled")===false,"проверка доступна после обновления");
  assert.equal(events.filter(e=>e[0]==="create").length,1);
  assert.equal(files[0].status,"approved");
  retry=true;app.button("Проверить итог размещения").click();
  await app.until(()=>app.button("Подтвердить размещение: 1"),"повтор оставшегося материала");app.button("Подтвердить размещение: 1").click();
  await app.until(()=>files[1].status==="approved","второе решение принято");
  assert.equal(events.filter(e=>e[0]==="create").length,1);
  assert.ok(events.filter(e=>e[0]==="decide").every(e=>e[2].place.includes("/юридический/")));
 }finally{app.dispose();}
});

test("два предложенных новых проекта не объединяются при последовательном выборе",async()=>{
 const created=[],decisions=[],projects=[];
 const alerts=["Право","Финансы"].map((name,i)=>({id:String(i),blob_sha256_hex:String(i),paths:[name+"/Файл.txt"],status:"open",candidates:[],suggested_project_name:name,suggested_domain:"общий"}));
 const app=await mountMemoryApp({
  async listProjects(){return {projects};},
  async inboxStatus(){return {total:2,in_queue:0,awaiting_classification:2,awaiting_placement:0,placed_in_tree:0,dead_lettered:0,dead_letters:[]};},
  async inboxAlerts(){return {alerts:alerts.filter(a=>a.status==="open"),truncated:false};},
  async createProject(name,slug){created.push(name);const project={id:slug,name,slug};projects.push(project);return {project};},
  async decideInboxAlert(id,input){decisions.push(input.place);alerts.find(a=>a.id===id).status="approved";},
 },{section:"intake"});
 try {
  const suggested=()=>app.buttons().filter(b=>b.textContent==="Использовать предложенный проект");
  await app.until(()=>suggested().length===2,"два предложения");suggested()[0].click();
  await app.until(()=>app.text().includes("Выбрано 1 из 2"),"первый выбор");suggested()[1].click();
  await app.until(()=>app.text().includes("Выбрано 2 из 2"),"второй выбор");
  app.button("Проверить итог размещения").click();await app.until(()=>app.button("Подтвердить размещение: 2"),"итог");
  assert.match(app.text(),/Будет создан проект «Право»/);assert.match(app.text(),/Будет создан проект «Финансы»/);
  app.button("Подтвердить размещение: 2").click();await app.until(()=>decisions.length===2,"оба размещения");
  assert.deepEqual(created,["Право","Финансы"]);assert.notEqual(decisions[0].split("/")[0],decisions[1].split("/")[0]);
 }finally{app.dispose();}
});
