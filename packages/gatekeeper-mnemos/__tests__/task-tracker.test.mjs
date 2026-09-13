import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {build} from 'esbuild';
const built=await build({stdin:{contents:'export {signalGapTask,gapResolution} from "./app/signal-gap-task.ts"; export {TaskTrackerView,decodeTrackerPreview,changeTrackerTask} from "./app/task-tracker.ts"; export {TrackerEdits} from "./src/tracker-edits.ts";',resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const {signalGapTask,gapResolution,TaskTrackerView,decodeTrackerPreview,changeTrackerTask,TrackerEdits}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const mime='application/vnd.mnemos.task-tracker+json';
const artifact={format:'mnemos.task-tracker',format_version:1,revision:2,title:'Launch',stages:[{id:'spec',name:'Specification',department:'Product'}],tasks:[{id:'task',title:'<img src=x onerror=alert(1)>',description:'Prepare rollout',stage_id:'spec',status:'in_progress',assignee_id:'human',dependencies:[],next_step:'Check metrics',blocker:'',result:''}]};
test('tracker view uses exact host download, clears revoked data and supports projects without trackers',async()=>{
 const dom=new JSDOM('<main/>');globalThis.document=dom.window.document;const root=document.querySelector('main');let mode='ok',reads=0,downloads=0;
 const api={listPrivateDocuments:async project=>({head:'a'.repeat(64),next_cursor:'',documents:project==='empty'?[]:[{node_id:'tracker',name:'Launch tracker',content_type:mime,conflicted:false}]}),readDraftDocument:async()=>{reads++;if(mode==='revoked')throw Error('denied');return {head:(mode==='changed'&&reads%2===0?'b':'a').repeat(64),node_id:'tracker',exists:true,conflicted:false,content_type:mime,terms:[{present:true,negative:false,metadata:{content_type:mime}}]};}};
 const view=new TaskTrackerView(root,api,[{id:'project',name:'Project',slug:'project'}],()=>{},async(project,node,head,side)=>{downloads++;assert.equal(project,'project');assert.equal(node,'tracker');assert.equal(head,'a'.repeat(64));assert.equal(side,0);return JSON.stringify(artifact);});
 await view.load('project');await view.open('tracker');assert(root.textContent.includes('Check metrics'));assert(root.textContent.includes('Ответственный: human'));assert.equal(root.querySelector('img'),null);assert.equal(downloads,1);
 mode='revoked';await view.open('tracker');assert(!root.textContent.includes('Check metrics'));assert(root.textContent.includes('недоступен'));
 mode='changed';reads=0;await view.open('tracker');assert(!root.textContent.includes('Check metrics'));assert(root.textContent.includes('недоступен'));
 mode='ok';await view.load('empty');assert(root.textContent.includes('Проект может работать без трекера'));assert.equal(downloads,2);
});
test('tracker preview rejects unknown formats, stages and broken references',()=>{
 assert.equal(decodeTrackerPreview(JSON.stringify(artifact)).revision,2);
 for(const patch of [{format:'other'},{format_version:2},{revision:0},{tasks:[{...artifact.tasks[0],stage_id:'missing'}]},{tasks:[{...artifact.tasks[0],dependencies:['missing']}]}])assert.throws(()=>decodeTrackerPreview(JSON.stringify({...artifact,...patch})));
 assert.deepEqual(decodeTrackerPreview(JSON.stringify({...artifact,tasks:null})).tasks,[]);
});
test('tracker editor preserves the original head and blocks repeating an unknown write',async()=>{
 const dom=new JSDOM('<main/>');globalThis.document=dom.window.document;const root=document.querySelector('main');let uploads=0,saves=0,payload;
 const head='a'.repeat(64);const api={listPrivateDocuments:async()=>({head,next_cursor:'',documents:[]}),readDraftDocument:async()=>({head,node_id:'tracker',exists:true,conflicted:false,content_type:mime,terms:[{present:true,negative:false,metadata:{content_type:mime}}]}),saveDraftDocument:async(project,node,upload,expected)=>{saves++;assert.equal(expected,head);assert.equal(upload,'upload');throw Error('unknown save');}};
 const input={...artifact,transitions:[],custom_data:'preserved'};
 const view=new TaskTrackerView(root,api,[],()=>{},async()=>JSON.stringify(input),async(project,text)=>{uploads++;payload=JSON.parse(text);return 'upload';});
 await view.load('project');await view.open('tracker');[...root.querySelectorAll('button')].find(b=>b.textContent==='Изменить задачу').click();
 const result=root.querySelector('[aria-label="Результат задачи"]');result.value='Rollout verified';result.dispatchEvent(new dom.window.Event('input'));
 const status=root.querySelector('[aria-label="Статус задачи"]');status.value='done';status.dispatchEvent(new dom.window.Event('change'));
 await view.saveTask();assert.equal(saves,1);assert.equal(uploads,1);assert.equal(payload.revision,3);assert.equal(payload.tasks[0].result,'Rollout verified');assert.equal(payload.custom_data,'preserved');assert(root.textContent.includes('Повторная запись отключена'));
 await view.saveTask();assert.equal(saves,1);assert.equal(uploads,1);
});
test('new tracker tasks preserve existing work and reject cyclic dependencies',()=>{
 const first={...artifact.tasks[0],status:'todo'};const source=JSON.stringify({...artifact,transitions:[],tasks:[first]});
 const next={...first,id:'next',title:'Next task',dependencies:['task']};
 const created=JSON.parse(changeTrackerTask(source,next,true));assert.equal(created.tasks.length,2);assert.deepEqual(created.tasks[0],first);assert.equal(created.revision,3);
 assert.throws(()=>changeTrackerTask(source,next,false));assert.throws(()=>changeTrackerTask(JSON.stringify(created),next,true));
 assert.throws(()=>changeTrackerTask(JSON.stringify(created),{...first,dependencies:['next']}));
 assert.throws(()=>changeTrackerTask(source,{...next,dependencies:['missing']},true));
 assert.throws(()=>changeTrackerTask(source,{...next,dependencies:['task','task']},true));
 assert.throws(()=>changeTrackerTask(source,{...next,status:'in_progress'},true));
 assert.deepEqual(JSON.parse(source).tasks,[first]);
});
test('new task form saves one task with a selected dependency',async()=>{
 const dom=new JSDOM('<main/>');globalThis.document=dom.window.document;const root=document.querySelector('main');let payload,saves=0;
 const source={...artifact,transitions:[],tasks:[{...artifact.tasks[0],title:'Existing task',status:'done',result:'Verified'}]};const head='a'.repeat(64);
 const api={listPrivateDocuments:async()=>({head,next_cursor:'',documents:[]}),readDraftDocument:async()=>({head,node_id:'tracker',exists:true,conflicted:false,content_type:mime,terms:[{present:true,negative:false,metadata:{content_type:mime}}]}),saveDraftDocument:async(project,node,upload,expected)=>{saves++;assert.equal(expected,head);return {head:'b'.repeat(64)};}};
 const view=new TaskTrackerView(root,api,[],()=>{},async()=>JSON.stringify(source),async(project,text)=>{payload=JSON.parse(text);return 'upload';});await view.load('project');await view.open('tracker');
 [...root.querySelectorAll('button')].find(b=>b.textContent==='Новая задача').click();const title=root.querySelector('[aria-label="Название задачи"]');title.value='Next delivery';title.dispatchEvent(new dom.window.Event('input'));
 const dependency=root.querySelector('[aria-label="Зависимость: Existing task"]');dependency.checked=true;dependency.dispatchEvent(new dom.window.Event('change'));
 await view.saveTask();assert.equal(saves,1);assert.equal(payload.tasks.length,2);assert.deepEqual(payload.tasks[0],source.tasks[0]);assert.deepEqual(payload.tasks[1].dependencies,['task']);assert.equal(payload.tasks[1].title,'Next delivery');assert(root.textContent.includes('Задача сохранена'));
});

test('persisted edit survives a lost save and panel reconstruction, refuses replay and revoked reads',async()=>{
 const dom=new JSDOM('<main/>');globalThis.document=dom.window.document;const root=document.querySelector('main');
 const values=new Map(),storage={get:k=>structuredClone(values.get(k)),put:(k,v)=>values.set(k,structuredClone(v)),delete:k=>values.delete(k)};
 let journal=new TrackerEdits(storage),head='a'.repeat(64),source=JSON.stringify({...artifact,transitions:[]}),denied=false,uploads=0,saves=0;
 const api={checkTrackerAssignee:async()=>{if(denied)throw Error('revoked');},listPrivateDocuments:async()=>({head,next_cursor:'',documents:[]}),readDraftDocument:async()=>{if(denied)throw Error('revoked');return {head,exists:true,conflicted:false,content_type:mime,terms:[{present:true,negative:false,metadata:{content_type:mime}}]};},saveDraftDocument:async()=>{saves++;head='b'.repeat(64);throw Error('reply lost after commit');}};
 Object.assign(api,{readTrackerEdit:(p,n)=>journal.read(api,p,n),prepareTrackerEdit:(p,n,v)=>journal.prepare(api,p,n,v),claimTrackerEdit:(p,n,id)=>journal.claim(api,p,n,id),clearTrackerEdit:(p,n,id,h)=>journal.clear(api,p,n,id,h)});
 const make=()=>new TaskTrackerView(root,api,[],()=>{},async()=>source,async(p,text)=>{uploads++;source=text;return 'upload';});
 let view=make();await view.load('project');await view.open('tracker');[...root.querySelectorAll('button')].find(b=>b.textContent==='Изменить задачу').click();
 const field=root.querySelector('[aria-label="Следующий шаг"]');field.value='Persist this correction';field.dispatchEvent(new dom.window.Event('input'));await view.saveTask();
 assert.equal(saves,1);assert.equal(uploads,1);assert.equal([...values.values()][0].attempted,true);
 journal=new TrackerEdits(storage);view=make();await view.load('project');await view.open('tracker');assert(root.textContent.includes('Восстановлена сохранённая правка'));assert.equal(root.querySelector('[aria-label="Следующий шаг"]').value,'Persist this correction');assert.equal(root.querySelector('[aria-label="Следующий шаг"]').readOnly,true);
 await view.saveTask();await view.resumeEdit();assert.equal(saves,1);assert.equal(uploads,1);
 const intent=await journal.read(api,'project','tracker');await assert.rejects(()=>journal.claim(api,'project','tracker',intent.id));await assert.rejects(()=>journal.clear(api,'project','tracker',intent.id,'a'.repeat(64)));
 denied=true;await assert.rejects(()=>journal.read(api,'project','tracker'));await view.open('tracker');assert(!root.textContent.includes('Persist this correction'));assert.equal(root.querySelector('textarea'),null);
 denied=false;await view.open('tracker');await view.dismissEdit();assert.equal(values.size,0);assert.equal(saves,1);
});
test('only one panel can claim a saved edit and pending input cannot be replaced',async()=>{
 const values=new Map(),storage={get:k=>structuredClone(values.get(k)),put:(k,v)=>values.set(k,structuredClone(v)),delete:k=>values.delete(k)};
 const head='a'.repeat(64),api={checkTrackerAssignee:async()=>{},readDraftDocument:async()=>({head,exists:true,conflicted:false,content_type:mime})};let journal=new TrackerEdits(storage);
 const input={head,source:JSON.stringify(artifact),task:{...artifact.tasks[0],next_step:'Saved before dispatch'},create:false};
 const intent=await journal.prepare(api,'project','tracker',input);journal=new TrackerEdits(storage);assert.equal((await journal.read(api,'project','tracker')).attempted,false);
 await assert.rejects(()=>journal.prepare(api,'project','tracker',{...input,task:{...input.task,next_step:'Other tab'}}));
 const attempts=await Promise.allSettled([journal.claim(api,'project','tracker',intent.id),journal.claim(api,'project','tracker',intent.id)]);assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);
});

test('assignee denial prevents preparing an edit and revocation prevents claiming it',async()=>{
 const values=new Map(),storage={get:k=>structuredClone(values.get(k)),put:(k,v)=>values.set(k,structuredClone(v)),delete:k=>values.delete(k)};
 const head='a'.repeat(64);let denied=true,checks=0;
 const api={readDraftDocument:async()=>({head,exists:true,conflicted:false,content_type:mime}),checkTrackerAssignee:async(p,n,h,principal)=>{checks++;assert.equal(h,head);assert.equal(principal,'human');if(denied)throw Error('assignee unavailable');}};
 const journal=new TrackerEdits(storage),input={head,source:JSON.stringify(artifact),task:{...artifact.tasks[0],next_step:'Check assignment'},create:false};
 await assert.rejects(()=>journal.prepare(api,'project','tracker',input));assert.equal(values.size,0);
 denied=false;const intent=await journal.prepare(api,'project','tracker',input);denied=true;await assert.rejects(()=>journal.claim(api,'project','tracker',intent.id));assert.equal((await journal.read(api,'project','tracker')).attempted,false);assert.equal(checks,3);
});

test('invited tracker is read-only, does not adopt or read a personal draft and clears after revocation',async()=>{
 const dom=new JSDOM('<main/>');globalThis.document=dom.window.document;const root=document.querySelector('main');let revoked=false,downloads=0,writes=0;
 const api={listPrivateDocuments:async()=>({head:'a'.repeat(64),next_cursor:'',documents:[]}),readDraftDocument:async()=>{throw Error('personal read must not be used');},saveDraftDocument:async()=>{writes++;},connectInvitedTracker:async()=>{writes++;}};
 const view=new TaskTrackerView(root,api,[],()=>{},async(p,n,version,side)=>{downloads++;assert.equal(version,'tracker-invitation:'+'b'.repeat(64));assert.equal(side,0);if(revoked)throw Error('revoked');return JSON.stringify(artifact);},async()=>{writes++;return 'upload';});
 await view.load('project');await view.openInvitation('tracker','b'.repeat(64));assert(root.textContent.includes('только просмотр'));assert(root.textContent.includes('Check metrics'));assert(![...root.querySelectorAll('button')].some(b=>['Новая задача','Изменить задачу','Сохранить задачу'].includes(b.textContent)));
 view.newTask();await view.saveTask();assert.equal(root.querySelector('textarea'),null);assert.equal(writes,0);
 revoked=true;await view.openInvitation('tracker','b'.repeat(64));assert(!root.textContent.includes('Check metrics'));assert.equal(writes,0);assert.equal(downloads,2);
});

test('external handoff pins selection and checks the actual assigned connection without writing',async()=>{
 const dom=new JSDOM('<main/>');globalThis.document=dom.window.document;const root=document.querySelector('main');const head='a'.repeat(64);let revoked=false,changed=false,checks=0;const cursors=[];
 const selected={...artifact,tasks:[{...artifact.tasks[0],assignee_id:'issued-external',status:'todo'}]};
 const api={listPrivateDocuments:async()=>({head,documents:[]}),readDraftDocument:async()=>({head:changed?'b'.repeat(64):head,node_id:'tracker',exists:true,conflicted:false,content_type:mime,terms:[{present:true,negative:false,metadata:{content_type:mime}}]}),saveDraftDocument:async()=>assert.fail('handoff must not write'),listAgentConnections:async cursor=>{cursors.push(cursor);return cursor?{connections:[{binding_id:'external',agent_principal_id:'issued-external',managed_runtime:false,revoked}]}:{connections:[{binding_id:'managed',agent_principal_id:'issued-external',managed_runtime:true,revoked:false}],next_cursor:'next'};},checkTrackerAssignee:async(project,node,expected,agent)=>{checks++;assert.deepEqual([project,node,expected,agent],['project','tracker',head,'issued-external']);}};
 const view=new TaskTrackerView(root,api,[],()=>{},async()=>JSON.stringify(selected));await view.load('project');await view.open('tracker');await view.prepareExternalHandoff('task');
 const text=root.querySelector('[aria-label="Поручение внешнему агенту"]');assert(text?.readOnly);assert.equal(root.querySelector('img'),null);assert.deepEqual(cursors,['','next']);assert.equal(checks,1);
 const instruction=text.value;const json=instruction.slice(instruction.indexOf('{'),instruction.indexOf('\nПрочитай актуальный'));const terms=JSON.parse(json);assert.deepEqual(terms.tracker,{project_id:'project',node_id:'tracker'});assert.equal(terms.agent_id,'issued-external');assert.equal(terms.task_id,'task');assert.equal(terms.observed_head,head);assert.equal(terms.task.title,selected.tasks[0].title);assert(!instruction.includes('Bearer'));
 revoked=true;await view.prepareExternalHandoff('task');assert.equal(root.querySelector('[aria-label="Поручение внешнему агенту"]'),null);assert.equal(checks,1);
 revoked=false;changed=true;await view.prepareExternalHandoff('task');assert.equal(root.querySelector('[aria-label="Поручение внешнему агенту"]'),null);assert(root.textContent.includes('Трекер недоступен'));
});

test('denied assignee access exposes no external handoff',async()=>{
 const dom=new JSDOM('<main/>');globalThis.document=dom.window.document;const root=document.querySelector('main');const head='a'.repeat(64);
 const api={listPrivateDocuments:async()=>({head,documents:[]}),readDraftDocument:async()=>({head,exists:true,conflicted:false,content_type:mime,terms:[{present:true,negative:false,metadata:{content_type:mime}}]}),listAgentConnections:async()=>({connections:[{agent_principal_id:'human',revoked:false,managed_runtime:false}]}),checkTrackerAssignee:async()=>{throw Error('denied');}};
 const view=new TaskTrackerView(root,api,[],()=>{},async()=>JSON.stringify(artifact));await view.load('project');await view.open('tracker');await view.prepareExternalHandoff('task');assert.equal(root.querySelector('[aria-label="Поручение внешнему агенту"]'),null);
});

test('measurement gap creates one addressed task with source and acceptance criteria',async()=>{
 const source={project_id:'project',publication:{enabled:true,revision:1,source_owner_id:'owner',source_request_id:'assessment'},snapshot:{requirements_sha256:'a'.repeat(64),project_id:'project',request_id:'assessment',collected_at:'2026-09-10T12:00:00Z',assessment:{assessed_at:'2026-09-10T12:02:00Z',findings:[{signal_id:'usage',purpose:'Active users',state:'stale',source_id:'corp',source_revision:'hash'}]}}};
 const seed=await signalGapTask(source,'usage');assert.match(seed.description,/Измерение устарело/);assert.match(seed.description,/Критерии приёмки/);assert.match(seed.description,/Оценка: assessment/);
 const later=structuredClone(source);later.snapshot.assessment.assessed_at='2026-09-10T12:03:00Z';assert.equal((await signalGapTask(later,'usage')).id,seed.id);
 later.snapshot.assessment.findings[0].state='available';await assert.rejects(()=>signalGapTask(later,'usage'));
 assert.throws(()=>gapResolution(seed.description,later));
 later.publication.source_request_id='new';later.snapshot.request_id='new';later.snapshot.collected_at='2026-09-10T12:02:00Z';assert.match(gapResolution(seed.description,later),/Новая опубликованная оценка: new/);
 later.snapshot.requirements_sha256='b'.repeat(64);assert.throws(()=>gapResolution(seed.description,later));later.snapshot.requirements_sha256='a'.repeat(64);
 later.snapshot.assessment.findings[0].state='stale';assert.throws(()=>gapResolution(seed.description,later));

 const dom=new JSDOM('<main/>');globalThis.document=dom.window.document;const root=document.querySelector('main');let saves=0,payload,head='a'.repeat(64);
 const api={listPrivateDocuments:async()=>({documents:[]}),readDraftDocument:async()=>({head,exists:true,conflicted:false,content_type:mime,terms:[{present:true,negative:false,metadata:{content_type:mime}}]}),saveDraftDocument:async()=>{saves++;head='b'.repeat(64);return {head};}};
 const view=new TaskTrackerView(root,api,[],()=>{},async()=>JSON.stringify(artifact),async(p,text)=>{payload=JSON.parse(text);return 'upload';},undefined,seed);
 await view.load('project');await view.open('tracker');view.prepareGapTask();await view.saveTask();assert.equal(saves,0);
 const assignee=root.querySelector('[aria-label="Ответственный"]');assignee.value='developer';assignee.dispatchEvent(new dom.window.Event('input'));await view.saveTask();assert.equal(saves,1);assert.equal(payload.tasks.length,2);assert.equal(payload.tasks[1].assignee_id,'developer');assert.equal(payload.tasks[1].description,seed.description);
 view.prepareGapTask();assert.match(root.textContent,/уже существует/);assert.equal(root.querySelector('[aria-label="Ответственный"]').value,'developer');
 dom.window.close();delete globalThis.document;
});
