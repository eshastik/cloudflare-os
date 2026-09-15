import test from "node:test";
import assert from "node:assert/strict";
import {mountMemoryApp} from "./app-react-harness.mjs";
const scope={scope_id:"team",revision:3,name:"Финансовая группа",level:"group",enabled:true,approvers:["alice"]};
const proposal={proposal_id:"q",template_id:"template",template_revision:2,target_scope_id:"team",target_scope_revision:3,expected_catalogue_revision:7,user_id:"author",message:"Уточнить расчёт бюджета"};
function api(){let saved=null,decision=null;const writes=[];return {writes,
 async listTemplateReviewScopes(){return {scopes:[scope],next_cursor:""};},
 async listTemplateProposals(){return {proposals:[{proposal,decision},{proposal:{...proposal,proposal_id:"own",user_id:"alice"}}],next_cursor:""};},
 async readTemplateProposal(){return {proposal,decision};},
 async readSavedTemplateDecision(){return saved;},
 async readTemplateProposalSource(){return {proposal_id:"q",source:{template_id:"template",revision:2,source_head:"a".repeat(64),project_id:"project",node_id:"doc",content_type:"text/plain"}};},
 async saveTemplateDecision(id,input){writes.push(input);saved={proposal:id,input};return saved;},
 async executeSavedTemplateDecision(){decision={approved:saved.input.approved};saved={...saved,receipt:decision};return saved;},
};}
test("Шаблон проверяется и согласуется из основной очереди",async()=>{
 const backend=api(),app=await mountMemoryApp(backend,{section:"approvals"});
 try{
  await app.until(()=>app.button("Проверить шаблон"),"карточка предложения");
  assert.equal(app.buttons().filter(b=>b.textContent==="Проверить шаблон").length,1,"собственное предложение исключено");
  assert.equal(app.button("Одобрить шаблон"),undefined);
  app.button("Проверить шаблон").click();
  await app.until(()=>app.text().includes("текст")&&app.button("Одобрить шаблон"),"предложенная версия");
  assert.equal(app.button("Одобрить шаблон").disabled,true);
  app.type(app.document.querySelector('[aria-label="Комментарий к шаблону"]'),"Изменения проверены");
  await app.until(()=>!app.button("Одобрить шаблон").disabled,"комментарий введён");
  app.button("Одобрить шаблон").click();
  await app.until(()=>!app.document.querySelector('section[aria-label="Шаблоны на согласовании"]'),"решение записано и очередь обновлена");
  assert.equal(backend.writes.length,1);assert.equal(backend.writes[0].approved,true);assert.equal(backend.writes[0].scope_revision,3);
 }finally{app.dispose();}
});
test("Потерянный ответ требует проверки сохранённого решения",async()=>{
 const backend=api();const save=backend.saveTemplateDecision.bind(backend);
 backend.saveTemplateDecision=async(...args)=>{await save(...args);throw Error("ответ потерян");};
 const app=await mountMemoryApp(backend,{section:"my-work"});
 try{
  await app.until(()=>app.button("Проверить шаблон"),"шаблон во входящих");app.button("Проверить шаблон").click();
  await app.until(()=>app.document.querySelector('[aria-label="Комментарий к шаблону"]'),"форма решения");
  app.type(app.document.querySelector('[aria-label="Комментарий к шаблону"]'),"Проверено");
  await app.until(()=>app.button("Одобрить шаблон")&&!app.button("Одобрить шаблон").disabled,"версия прочитана");app.button("Одобрить шаблон").click();
  await app.until(()=>app.button("Повторить проверку"),"нужна сверка");assert.equal(app.button("Отклонить шаблон").disabled,true);
  app.button("Повторить проверку").click();await app.until(()=>app.button("Повторить сохранённое решение"),"сохранённое намерение прочитано");
  assert.equal(app.button("Отклонить шаблон"),undefined);app.button("Повторить сохранённое решение").click();
  await app.until(()=>!app.document.querySelector('section[aria-label="Шаблоны на согласовании"]'),"повтор подтверждён");assert.equal(backend.writes.length,1);
 }finally{app.dispose();}
});

test("Предложенный Blueprint открывается отдельной копией без согласования",async()=>{
 const backend=api();backend.readTemplateProposalSource=async()=>({proposal_id:"q",source:{template_id:"template",revision:2,source_head:"a".repeat(64),project_id:"project",node_id:"doc",content_type:"application/vnd.mnemos.blueprint-template+json"}});
 const bytes=new TextEncoder().encode('archive');const hash=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
 const snapshot={schema:'mnemos.blueprint-template',schemaVersion:1,blueprint:{id:'bp',version:2,title:'Бюджет',archiveSHA256:hash,archiveBase64:Buffer.from(bytes).toString('base64')}};
 const app=await mountMemoryApp(backend,{section:'approvals',downloadText:JSON.stringify(snapshot)});
 try{
  await app.until(()=>app.button('Проверить шаблон'),'предложение');app.button('Проверить шаблон').click();
  await app.until(()=>app.button('Открыть копию в гаджете')&&!app.button('Открыть копию в гаджете').disabled,'копия доступна');
  app.button('Открыть копию в гаджете').click();await app.until(()=>app.calls.some(([method])=>method==='openTemplateProposal'),'открытие через хост');
  assert.deepEqual(app.calls.find(([method])=>method==='openTemplateProposal'),['openTemplateProposal','project','doc','q']);
  assert.equal(backend.writes.length,0,'открытие не утверждает предложение');
 }finally{app.dispose();}
});
