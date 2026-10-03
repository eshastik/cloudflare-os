import test from "node:test";
import assert from "node:assert/strict";
import {mountMemoryApp} from "./app-react-harness.mjs";
const baseScope={scope_id:"team",revision:3,name:"Финансовая группа",level:"group",enabled:true,approvers:["alice"]};
const baseProposal={proposal_id:"q",template_id:"template",template_revision:2,target_scope_id:"team",target_scope_revision:3,expected_catalogue_revision:7,user_id:"author",source_owner_id:"author",scope_path:[baseScope],message:"Уточнить расчёт бюджета"};
/** Во «Входящих» предложение — строка списка; проверка идёт в панели подробностей. */
const openRow=async app=>{await app.until(()=>app.document.querySelector('#root [data-inbox="template"]'),"строка шаблона");app.document.querySelector('#root [data-inbox="template"] button').click();};
const templateRow=app=>app.document.querySelector('#root [data-inbox="template"]');
function api(requirements=[]){const scope={...baseScope,review_requirements:requirements},proposal={...baseProposal,scope_path:[scope]};let saved=null,decision=null;const writes=[],content=[],contentWrites=[],savedContent=new Map();return {writes,contentWrites,
 async listTemplateReviewScopes(){return {scopes:[scope],next_cursor:""};},
 async listTemplateProposals(){return {proposals:[{proposal,decision},{proposal:{...proposal,proposal_id:"own",user_id:"alice"}}],next_cursor:""};},
 async readTemplateProposal(){return {proposal,decision,content_decisions:content};},
 async readSavedTemplateContentDecision(id,scopeId,domain){return savedContent.get(domain)??null;},
 async saveTemplateContentDecision(id,scopeId,domain,input){contentWrites.push(input);const intent={proposal:id,scope:scopeId,domain,input};savedContent.set(domain,intent);return intent;},
 async executeSavedTemplateContentDecision(id,scopeId,domain){const intent=savedContent.get(domain);const receipt={...intent.input,proposal_id:id,scope_id:scopeId,domain_id:domain,reviewer_id:"alice"};content.push(receipt);const result={...intent,receipt};savedContent.set(domain,result);return result;},
 async readSavedTemplateDecision(){return saved;},
 async readTemplateProposalBaseline(){return null;},
 async readTemplateProposalSource(){return {proposal_id:"q",source:{template_id:"template",revision:2,source_head:"a".repeat(64),project_id:"project",node_id:"doc",content_type:"text/plain"}};},
 async saveTemplateDecision(id,input){writes.push(input);saved={proposal:id,input};return saved;},
 async executeSavedTemplateDecision(){decision={approved:saved.input.approved};saved={...saved,receipt:decision};return saved;},
};}
test("Шаблон проверяется и согласуется из основной очереди",async()=>{
 const backend=api(),app=await mountMemoryApp(backend,{section:"approvals"});
 try{
  await openRow(app);await app.until(()=>app.button("Проверить шаблон"),"карточка предложения");
  assert.equal(app.document.querySelectorAll('#root [data-inbox="template"]').length,1,"собственное предложение исключено");
  assert.equal(app.button("Опубликовать шаблон"),undefined);
  app.button("Проверить шаблон").click();
  await app.until(()=>app.text().includes("текст")&&app.button("Опубликовать шаблон"),"предложенная версия");
  assert.equal(app.button("Опубликовать шаблон").disabled,true);
  app.type(app.document.querySelector('[aria-label="Комментарий к шаблону"]'),"Изменения проверены");
  await app.until(()=>!app.button("Опубликовать шаблон").disabled,"комментарий введён");
  app.button("Опубликовать шаблон").click();
  await app.until(()=>!templateRow(app),"решение записано и очередь обновлена");
  assert.equal(backend.writes.length,1);assert.equal(backend.writes[0].approved,true);assert.equal(backend.writes[0].scope_revision,3);assert.equal(backend.writes[0].publish_snapshot,true);
 }finally{app.dispose();}
});
test("Потерянный ответ требует проверки сохранённого решения",async()=>{
 const backend=api();const save=backend.saveTemplateDecision.bind(backend);
 backend.saveTemplateDecision=async(...args)=>{await save(...args);throw Error("ответ потерян");};
 const app=await mountMemoryApp(backend,{section:"my-work"});
 try{
  await openRow(app);await app.until(()=>app.button("Проверить шаблон"),"шаблон во входящих");app.button("Проверить шаблон").click();
  await app.until(()=>app.document.querySelector('[aria-label="Комментарий к шаблону"]'),"форма решения");
  app.type(app.document.querySelector('[aria-label="Комментарий к шаблону"]'),"Проверено");
  await app.until(()=>app.button("Опубликовать шаблон")&&!app.button("Опубликовать шаблон").disabled,"версия прочитана");app.button("Опубликовать шаблон").click();
  await app.until(()=>app.button("Повторить проверку"),"нужна сверка");assert.equal(app.button("Отклонить шаблон").disabled,true);
  app.button("Повторить проверку").click();await app.until(()=>app.button("Повторить сохранённое решение")&&!app.button("Повторить сохранённое решение").disabled,"сохранённое намерение прочитано");
  assert.equal(app.button("Отклонить шаблон"),undefined);app.button("Повторить сохранённое решение").click();
  await app.until(()=>!templateRow(app),"повтор подтверждён");assert.equal(backend.writes.length,1);
 }finally{app.dispose();}
});

test("Предложенный Blueprint открывается отдельной копией без согласования",async()=>{
 const backend=api();backend.readTemplateProposalSource=async()=>({proposal_id:"q",source:{template_id:"template",revision:2,source_head:"a".repeat(64),project_id:"project",node_id:"doc",content_type:"application/vnd.mnemos.blueprint-template+json"}});
 const bytes=new TextEncoder().encode('archive');const hash=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
 const snapshot={schema:'mnemos.blueprint-template',schemaVersion:1,blueprint:{id:'bp',version:2,title:'Бюджет',archiveSHA256:hash,archiveBase64:Buffer.from(bytes).toString('base64')}};
 const app=await mountMemoryApp(backend,{section:'approvals',downloadText:JSON.stringify(snapshot)});
 try{
  await openRow(app);await app.until(()=>app.button('Проверить шаблон'),'предложение');app.button('Проверить шаблон').click();
  await app.until(()=>app.button('Открыть копию рядом')&&!app.button('Открыть копию рядом').disabled,'копия доступна');
  app.button('Открыть копию рядом').click();await app.until(()=>app.calls.some(([method])=>method==='openTemplateProposal'),'открытие через хост');
  assert.deepEqual(app.calls.find(([method])=>method==='openTemplateProposal'),['openTemplateProposal','project','doc','q']);
  assert.equal(backend.writes.length,0,'открытие не утверждает предложение');
 }finally{app.dispose();}
});

test('при недоступной общей версии нельзя одобрить неполное сравнение',async()=>{
 const backend=api();backend.readTemplateProposalBaseline=async()=>{throw Error('forbidden')};
 const app=await mountMemoryApp(backend,{section:'approvals'});
 try{await openRow(app);await app.until(()=>app.button('Проверить шаблон'),'предложение');app.button('Проверить шаблон').click();await app.until(()=>app.button('Повторить проверку'),'отказ сравнения');app.type(app.document.querySelector('[aria-label="Комментарий к шаблону"]'),'Проверено');assert.equal(app.button('Опубликовать шаблон').disabled,true);assert.equal(backend.writes.length,0)}finally{app.dispose()}
});

test('общая и предложенная версии видны рядом до принятия решения',async()=>{
 const backend=api();backend.readTemplateProposalBaseline=async()=>({template_id:'old-template',revision:1,source_head:'b'.repeat(64),project_id:'old-project',node_id:'old-doc',content_type:'text/plain'});
 const app=await mountMemoryApp(backend,{section:'approvals',downloadText:(_p,_n,version)=>version.startsWith('template-baseline:')?'Утверждённый текст':'Предлагаемый текст'});
 try{
  await openRow(app);await app.until(()=>app.button('Проверить шаблон'),'предложение');app.button('Проверить шаблон').click();
  await app.until(()=>app.document.querySelector('[aria-label="До изменений"]'),'сравнение');
  assert.match(app.document.querySelector('[aria-label="До изменений"]').textContent,/общая версия 7.*Утверждённый текст/);
  assert.match(app.document.querySelector('[aria-label="Предложенная версия"]').textContent,/Предлагаемый текст/);
  assert.deepEqual(app.calls.find(([method,_p,_n,version])=>method==='downloadText'&&version.startsWith('template-baseline:')),['downloadText','old-project','old-doc','template-baseline:q',0]);
  assert.equal(backend.writes.length,0);
 }finally{app.dispose()}
});

test('публикация ждёт каждого согласующего, а решение по направлению сохраняется отдельно',async()=>{
 const backend=api([{domain_id:'finance',approvers:['alice','bob']}]),app=await mountMemoryApp(backend,{section:'approvals'});
 try{await openRow(app);await app.until(()=>app.button('Проверить шаблон'),'предложение');app.button('Проверить шаблон').click();await app.until(()=>app.document.querySelector('[aria-label="Комментарий по направлению finance"]'),'согласование');
 app.type(app.document.querySelector('[aria-label="Комментарий к шаблону"]'),'Опубликовать проверенную версию');app.type(app.document.querySelector('[aria-label="Комментарий по направлению finance"]'),'Финансы проверены');await app.until(()=>!app.button('Согласовать по направлению').disabled,'версия прочитана');assert.equal(app.button('Опубликовать шаблон').disabled,true);app.button('Согласовать по направлению').click();
 await app.until(()=>app.text().includes('согласовано')&&!app.button('Согласовать по направлению'),'ответ записан');assert.equal(app.button('Опубликовать шаблон').disabled,true,'нужен второй ответ');assert.equal(backend.contentWrites.length,1);assert.equal(backend.writes.length,0,'согласование не публикует');
 }finally{app.dispose();}
});

test('отклонение по направлению доступно без чтения документа, одобрение запрещено',async()=>{
 const backend=api([{domain_id:'finance',approvers:['alice']}]);backend.readTemplateProposalSource=async()=>{throw Error('403')};const app=await mountMemoryApp(backend,{section:'approvals'});
 try{await openRow(app);await app.until(()=>app.button('Проверить шаблон'),'предложение');app.button('Проверить шаблон').click();await app.until(()=>app.text().includes('Не удалось открыть предложенную версию')&&app.document.querySelector('[aria-label="Комментарий по направлению finance"]'),'отказ чтения');app.type(app.document.querySelector('[aria-label="Комментарий по направлению finance"]'),'Нет доступа к содержимому');await app.until(()=>!app.button('Отклонить по направлению').disabled,'можно отклонить');assert.equal(app.button('Согласовать по направлению').disabled,true);assert.equal(app.button('Опубликовать шаблон').disabled,true);app.button('Отклонить по направлению').click();await app.until(()=>backend.contentWrites.length===1,'отказ сохранён');assert.equal(backend.contentWrites[0].approved,false);assert.equal(backend.writes.length,0);
 }finally{app.dispose();}
});
