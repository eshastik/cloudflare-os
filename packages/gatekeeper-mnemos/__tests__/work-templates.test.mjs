import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {build} from 'esbuild';
const built=await build({stdin:{contents:'export {WorkTemplateView} from "./app/work-templates.ts"; export {TemplateActions} from "./src/template-actions.ts";',resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const {WorkTemplateView,TemplateActions}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
test('template UI selects source and recovers creation after reopening',async()=>{
 const dom=new JSDOM('<main></main>');globalThis.document=dom.window.document;const root=document.querySelector('main');let template;const creations=[];const store=new Map();
 const api={listWorkTemplates:async()=>({templates:template?[template]:[],next_cursor:''}),readWorkTemplate:async()=>template,listPrivateDocuments:async()=>({head:'a'.repeat(64),documents:[{node_id:'source',name:'<script>Form</script>',conflicted:false}],next_cursor:''}),draftState:async()=>({personal_exists:true,personal_head:'b'.repeat(64)}),saveWorkTemplate:async(id,input)=>{template={...input,template_id:id,revision:input.expected_revision+1,user_id:'human',agent_id:'',created_at:'2026-09-09T00:00:00Z'};return template;},createFromWorkTemplate:async(id,input)=>{creations.push(input);if(creations.length===1)throw new Error('lost');return {node_id:'new',head:'c'.repeat(64),template_id:id,template_revision:input.revision,source_head:template.source_head};}};
 const actions=new TemplateActions({get:k=>structuredClone(store.get(k)),put:(k,v)=>store.set(k,structuredClone(v))},api,()=>{},new AbortController().signal);
 Object.assign(api,{readSavedTemplateAction:p=>actions.read(p),saveTemplateAction:(...a)=>actions.save(...a),deferTemplateAction:(...a)=>actions.defer(...a),restoreTemplateAction:(...a)=>actions.restore(...a),executeSavedTemplateAction:(...a)=>actions.execute(...a)});
 const projects=[{id:'project',name:'Project',slug:'project'}];let view=new WorkTemplateView(root,api,projects,()=>{});
 const button=text=>[...root.querySelectorAll('button')].find(b=>b.textContent===text);const settle=async()=>{const end=Date.now()+1000;while([...root.querySelectorAll('button')].every(b=>b.disabled)){assert(Date.now()<end);await new Promise(r=>setTimeout(r,1));}};
 const input=(label,value)=>{const e=root.querySelector(`[aria-label="${label}"]`);assert(e);e.value=value;e.dispatchEvent(new dom.window.Event('input'));};
 try{
  await view.load('project');button('Новый шаблон из документа').click();await settle();button('Выбрать: <script>Form</script>').click();assert.equal(root.querySelectorAll('script').length,0);input('Название шаблона','Specification');input('Назначение шаблона','Acceptance checklist');button('Сохранить версию шаблона').click();await settle();assert.equal(template.node_id,'source');assert.equal(template.source_head,'a'.repeat(64));
  input('Имя рабочего документа','Working.txt');button('Создать документ по этой версии').click();await settle();assert.equal(creations.length,1);assert(button('Повторить сохранённую операцию'));
  view=new WorkTemplateView(root,api,projects,()=>{});await view.load('project');assert(!button('Создать документ по этой версии'));button('Повторить сохранённую операцию').click();await settle();assert.deepEqual(creations[0],creations[1]);assert(root.textContent.includes('Создан рабочий документ'));
  button('Specification · версия 1').click();await settle();
  api.createFromWorkTemplate=async()=>{throw new Error('version conflict');};
  button('Создать документ по этой версии').click();await settle();const conflicted=actions.read('project');
  button('Отложить и вернуться к каталогу').click();await settle();assert(button('Новый шаблон из документа'));assert(root.textContent.includes('не значит отменить'));
  button('Specification · версия 1').click();await settle();button('Создать документ по этой версии').click();await settle();
  assert.equal(actions.read('project').history[0].id,conflicted.id);button('Отложить и вернуться к каталогу').click();await settle();
  view=new WorkTemplateView(root,api,projects,()=>{});await view.load('project');button('Вернуться к операции '+conflicted.id).click();await settle();assert.deepEqual(actions.read('project').action,conflicted.action);assert(!button('Новый шаблон из документа'));
 }finally{dom.window.close();delete globalThis.document;}
});

test('shared template UI applies inherited scope and exact catalogue revision',async()=>{
 const dom=new JSDOM('<main></main>');globalThis.document=dom.window.document;const root=document.querySelector('main');const store=new Map();let created;
 const version={scope_id:'department',template_key:'spec',revision:3,proposal_id:'approved',approved_by:'reviewer',approved_at:'2026-09-09T00:00:00Z',source:{template_id:'personal',revision:1,title:'Shared specification',purpose:'Work',kind:'document',project_id:'source-project',node_id:'source',source_head:'a'.repeat(64),content_type:'text/plain',user_id:'author',agent_id:'',created_at:'2026-09-09T00:00:00Z'}};
 const api={listWorkTemplates:async()=>({templates:[],next_cursor:''}),listTemplateScopes:async()=>({scopes:[{scope_id:'team',name:'Team',level:'group'}]}),listScopedWorkTemplates:async(scope)=>{assert.equal(scope,'team');return {selected_scope_id:scope,templates:[version]};},readScopedWorkTemplate:async(scope,key,revision)=>{assert.equal(scope,'department');assert.equal(key,'spec');assert.equal(revision,3);return version;},draftState:async()=>({personal_exists:true,personal_head:'b'.repeat(64)}),createFromScopedWorkTemplate:async(scope,key,input)=>{created={scope,key,input};return {node_id:'copy',head:'c'.repeat(64),scope_id:scope,template_key:key,template_revision:input.revision,source_head:version.source.source_head};}};
 const actions=new TemplateActions({get:k=>structuredClone(store.get(k)),put:(k,v)=>store.set(k,structuredClone(v))},api,()=>{},new AbortController().signal);
 Object.assign(api,{readSavedTemplateAction:p=>actions.read(p),saveTemplateAction:(...a)=>actions.save(...a),executeSavedTemplateAction:(...a)=>actions.execute(...a)});
 const view=new WorkTemplateView(root,api,[{id:'destination',name:'Destination',slug:'destination'}],()=>{});
 const button=text=>[...root.querySelectorAll('button')].find(b=>b.textContent===text);
 const settle=async()=>{const deadline=Date.now()+1000;while([...root.querySelectorAll('button')].every(b=>b.disabled)){assert(Date.now()<deadline);await new Promise(r=>setTimeout(r,1));}};
 try{
  await view.load('destination');button('Общие шаблоны').click();await settle();button('Team · group').click();await settle();button('Shared specification · department · версия 3').click();await settle();
  assert(root.textContent.includes('утверждённая версия 3'));assert(!button('Выбрать документ для новой версии'));
  button('Создать документ по этой версии').click();await settle();assert.equal(created.scope,'department');assert.equal(created.key,'spec');assert.equal(created.input.revision,3);assert.equal(created.input.project_id,'destination');assert(root.textContent.includes('Документ создан'));
  assert.equal(actions.read('destination').action.scope,'department');
 }finally{dom.window.close();delete globalThis.document;}
});

test('proposal UI preserves the shown source and selected target',async()=>{
 const dom=new JSDOM('<main></main>');globalThis.document=dom.window.document;const root=document.querySelector('main');const store=new Map();let sent;
 const version={template_id:'personal',revision:2,title:'Instructions',purpose:'Work',kind:'guidance',project_id:'project',node_id:'source',source_head:'a'.repeat(64),content_type:'text/plain',user_id:'human',agent_id:'',created_at:'2026-09-09T00:00:00Z'};
 const api={listWorkTemplates:async()=>({templates:[version],next_cursor:''}),readWorkTemplate:async()=>version,listTemplateScopes:async()=>({scopes:[{scope_id:'team',revision:3,name:'Team',level:'group'}]}),proposeWorkTemplate:async(template,input)=>{sent={template,input};return {...input,proposal_id:'proposal',template_id:template,template_revision:input.revision};}};
 const actions=new TemplateActions({get:k=>structuredClone(store.get(k)),put:(k,v)=>store.set(k,structuredClone(v))},api,()=>{},new AbortController().signal);
 Object.assign(api,{readSavedTemplateAction:p=>actions.read(p),saveTemplateAction:(...a)=>actions.save(...a),executeSavedTemplateAction:(...a)=>actions.execute(...a)});
 const view=new WorkTemplateView(root,api,[{id:'project',name:'Project',slug:'project'}],()=>{});
 const button=text=>[...root.querySelectorAll('button')].find(b=>b.textContent===text);
 const settle=async()=>{const deadline=Date.now()+1000;while([...root.querySelectorAll('button')].every(b=>b.disabled)){assert(Date.now()<deadline);await new Promise(r=>setTimeout(r,1));}};
 const input=(label,value)=>{const e=root.querySelector(`[aria-label="${label}"]`);assert(e);e.value=value;e.dispatchEvent(new dom.window.Event(e.tagName==='SELECT'?'change':'input'));};
 try{
  await view.load('project');button('Instructions · версия 2').click();await settle();button('Предложить на следующий уровень').click();await settle();
  input('Целевая область','team');input('Ключ общего шаблона','team-instructions');input('Обоснование предложения','Use these reviewed instructions');input('Текущая версия целевого ключа (0 — новый)','');
  button('Сохранить и отправить предложение').click();await settle();assert.equal(sent,undefined);
  input('Текущая версия целевого ключа (0 — новый)','0');button('Сохранить и отправить предложение').click();await settle();
  assert.equal(sent.template,'personal');assert.equal(sent.input.revision,2);assert.equal(sent.input.target_scope_id,'team');assert.equal(sent.input.target_scope_revision,3);assert.equal(sent.input.template_key,'team-instructions');assert.equal(sent.input.expected_catalogue_revision,0);assert(root.textContent.includes('Отправка не означает одобрение'));assert.deepEqual(actions.read('project').action.input,sent.input);
 }finally{dom.window.close();delete globalThis.document;}
});

test('review queue UI opens exact proposal and renders untrusted text safely',async()=>{
 const dom=new JSDOM('<main></main>');globalThis.document=dom.window.document;const root=document.querySelector('main');let opened;
 const proposal={proposal_id:'proposal',user_id:'author',agent_id:'agent',template_id:'personal',template_revision:2,target_scope_id:'team',target_scope_revision:3,template_key:'spec',expected_catalogue_revision:1,message:'<script>untrusted</script>'};
 const api={readSavedTemplateDecision:async()=>null,listTemplateReviewScopes:async()=>({scopes:[{scope_id:'team',name:'Team'}]}),listTemplateProposals:async(scope)=>{assert.equal(scope,'team');return {proposals:[{proposal}]};},readTemplateProposal:async(id)=>{opened=id;return {proposal,decision:{approved:false,reviewer_id:'reviewer',created_at:'now',comment:'<img src=x onerror=alert(1)>'}};}};
 const view=new WorkTemplateView(root,api,[],()=>{});view.render();
 const button=text=>[...root.querySelectorAll('button')].find(b=>b.textContent===text);const settle=async()=>{const deadline=Date.now()+1000;while([...root.querySelectorAll('button')].every(b=>b.disabled)){assert(Date.now()<deadline);await new Promise(r=>setTimeout(r,1));}};
 try{button('На согласование').click();await settle();button('Очередь: Team').click();await settle();button('spec · author · ожидает решения').click();await settle();assert.equal(opened,'proposal');assert(root.textContent.includes('личный шаблон personal, версия 2'));assert(root.textContent.includes('Отказано'));assert(root.textContent.includes(proposal.message));assert.equal(root.querySelectorAll('script,img').length,0);}finally{dom.window.close();delete globalThis.document;}
});


test('review UI requires source for approval and replays saved decision after reopening',async()=>{
 const dom=new JSDOM('<main></main>');globalThis.document=dom.window.document;const root=document.querySelector('main');const previousFetch=globalThis.fetch;
 const content='<script>Exact source</script>';const bytes=new TextEncoder().encode(content);const hash=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
 const proposal={proposal_id:'proposal',user_id:'author',template_id:'template',template_revision:2,target_scope_id:'team',target_scope_revision:3,template_key:'spec',expected_catalogue_revision:0,message:'Review'};
 const source={proposal_id:'proposal',source:{template_id:'template',revision:2,project_id:'project',node_id:'node',source_head:'a'.repeat(64),content_type:'text/plain'}};
 let saved,decision;const sent=[];
 const api={listTemplateReviewScopes:async()=>({scopes:[{scope_id:'team',revision:3,name:'Team'}]}),readTemplateProposal:async()=>({proposal,decision}),readSavedTemplateDecision:async()=>structuredClone(saved??null),beginTemplateProposalDownload:async()=>({source,ticket:{url:'https://objects.example/source',method:'GET',size_bytes:bytes.length,sha256_hex:hash}}),readTemplateProposalSource:async()=>source,saveTemplateDecision:async(id,input)=>{assert.equal(id,'proposal');assert.equal(saved,undefined);saved={proposal:id,kind:'personal',input:structuredClone(input)};return structuredClone(saved);},executeSavedTemplateDecision:async()=>{sent.push(structuredClone(saved.input));if(sent.length===1)throw new Error('lost reply');decision={...saved.input,reviewer_id:'reviewer',created_at:'now'};saved.receipt=decision;return structuredClone(saved);}};
 globalThis.fetch=async()=>new Response(content);
 const button=text=>[...root.querySelectorAll('button')].find(b=>b.textContent===text);
 const settle=async()=>{const deadline=Date.now()+1000;while([...root.querySelectorAll('button')].every(b=>b.disabled)){assert(Date.now()<deadline);await new Promise(r=>setTimeout(r,1));}};
 const input=(label,value)=>{const e=root.querySelector(`[aria-label="${label}"]`);assert(e);e.value=value;e.dispatchEvent(new dom.window.Event('input'));};
 try{
  let view=new WorkTemplateView(root,api,[],()=>{},async(project,node,version,side)=>{assert.equal(project,"project");assert.equal(node,"node");assert.equal(version,"template-proposal:proposal");assert.equal(side,0);return content;});view.render();input('ID заявки на шаблон','proposal');button('Открыть заявку').click();await settle();
  assert(!button('Сохранить и одобрить'));assert(button('Сохранить и отказать'));
  button('Прочитать точный источник').click();await settle();assert(root.textContent.includes(content));assert.equal(root.querySelectorAll('script').length,0);
  input('Комментарий согласующего','Checked exact source');button('Сохранить и одобрить').click();await settle();
  assert.equal(saved.input.approved,true);assert.equal(saved.input.scope_revision,3);assert.equal(saved.input.comment,'Checked exact source');assert(!button('Сохранить и отказать'));assert(button('Повторить сохранённое решение'));
  view=new WorkTemplateView(root,api,[],()=>{},async(project,node,version,side)=>{assert.equal(project,"project");assert.equal(node,"node");assert.equal(version,"template-proposal:proposal");assert.equal(side,0);return content;});view.render();input('ID заявки на шаблон','proposal');button('Открыть заявку').click();await settle();button('Повторить сохранённое решение').click();await settle();
  assert.deepEqual(sent[0],sent[1]);assert(root.textContent.includes('Решение подтверждено'));assert(root.textContent.includes('Одобрено'));assert(!button('Повторить сохранённое решение'));
 }finally{globalThis.fetch=previousFetch;dom.window.close();delete globalThis.document;}
});


test('explicit personal override applies exact personal version without publishing or shared fallback',async()=>{
 const dom=new JSDOM('<main></main>');globalThis.document=dom.window.document;const root=document.querySelector('main');const store=new Map();let created,denied=false;
 const personal={template_id:'mine',revision:2,title:'My form',purpose:'Work',kind:'document',project_id:'source',node_id:'node',source_head:'a'.repeat(64),content_type:'text/plain',user_id:'human',agent_id:'',created_at:'2026-09-09T00:00:00Z'};
 const api={listWorkTemplates:async()=>({templates:[]}),listTemplateScopes:async()=>({scopes:[{scope_id:'team',name:'Team',level:'group'}]}),listScopedWorkTemplates:async()=>({selected_scope_id:'team',templates:[]}),resolveWorkTemplate:async(scope,key,override)=>{assert.equal(scope,'team');assert.equal(key,'spec');if(denied)throw new Error('Forbidden');assert.deepEqual(override,{template_id:'mine',revision:2});return {selected_scope_id:scope,template_key:key,personal};},draftState:async()=>({personal_exists:true,personal_head:'b'.repeat(64)}),createFromWorkTemplate:async(id,input)=>{created={id,input};return {node_id:'copy',head:'c'.repeat(64),template_id:id,template_revision:input.revision,source_head:personal.source_head};}};
 const actions=new TemplateActions({get:k=>structuredClone(store.get(k)),put:(k,v)=>store.set(k,structuredClone(v))},api,()=>{},new AbortController().signal);Object.assign(api,{readSavedTemplateAction:p=>actions.read(p),saveTemplateAction:(...a)=>actions.save(...a),executeSavedTemplateAction:(...a)=>actions.execute(...a)});
 const view=new WorkTemplateView(root,api,[{id:'destination',name:'Destination',slug:'destination'}],()=>{});const button=text=>[...root.querySelectorAll('button')].find(b=>b.textContent===text);
 const settle=async()=>{const deadline=Date.now()+1000;while([...root.querySelectorAll('button')].every(b=>b.disabled)){assert(Date.now()<deadline);await new Promise(r=>setTimeout(r,1));}};
 const input=(label,value)=>{const e=root.querySelector(`[aria-label="${label}"]`);assert(e);e.value=value;e.dispatchEvent(new dom.window.Event('input'));};
 try{await view.load('destination');button('Общие шаблоны').click();await settle();button('Team · group').click();await settle();input('Ключ шаблона для применения','spec');input('ID личного переопределения','mine');input('Версия личного переопределения','2');button('Выбрать личное переопределение').click();await settle();assert(root.textContent.includes('Личное переопределение ключа spec'));button('Создать документ по этой версии').click();await settle();assert.equal(created.id,'mine');assert.equal(created.input.revision,2);assert.equal(created.input.project_id,'destination');assert.equal(actions.read('destination').action.scope,undefined);
 denied=true;button('Выбрать унаследованную версию').click();await settle();assert(!button('Создать документ по этой версии'));assert(root.textContent.includes('Действие не подтверждено'));
 }finally{dom.window.close();delete globalThis.document;}
});
