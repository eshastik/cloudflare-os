import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {buildSync} from 'esbuild';
import {fileURLToPath} from 'node:url';
const shim='data:text/javascript,'+encodeURIComponent('export class RpcTarget{} export class RpcStub{constructor(target){return target}}');
registerHooks({resolve(specifier,context,next){if(specifier==='cloudflare:workers')return {url:shim,shortCircuit:true};return next(specifier,context)}});
const bundled=buildSync({entryPoints:[fileURLToPath(new URL('./blueprint-templates.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',external:['cloudflare:workers'],write:false});
const {BlueprintTemplates}=await import('data:text/javascript,'+encodeURIComponent(bundled.outputFiles[0].text));

test('нативная форма сохраняется без Blueprint, повтор сохраняет точную версию и проверяет доступ',async()=>{
 const entries=new Map<string,unknown>();const calls:any[]=[];let denied=false;let version:any;
 const check=()=>{if(denied)throw Error('denied')};
 const session={
  async openDraft(project:string){check();assert.equal(project,'project');return {head:'a'.repeat(64)}},
  async beginNativeUpload(project:string,size:number,checksum:string){check();calls.push(['native-upload',project,size,checksum]);return {upload_id:'upload'}},
  async beginProjectUpload(){throw Error('Blueprint upload must not run')},
  async createPrivateDocument(project:string,input:any){check();calls.push(['create',project,input]);return {node_id:'snapshot',head:'b'.repeat(64)}},
  async saveWorkTemplateSnapshot(id:string,input:any){check();calls.push(['save',id,input]);version={...input,template_id:id,revision:input.expected_revision+1,content_type:'application/vnd.cloudflareos.document+json'};return version},
  async readWorkTemplate(id:string,revision:number){check();assert.equal(id,version.template_id);assert.ok(revision===0||revision===version.revision);return version},
 };
 const storage={get:(key:string)=>entries.get(key),put:(key:string,value:unknown)=>entries.set(key,structuredClone(value))};
 const templates=new BlueprintTemplates(session as any,storage as any);
 const prepared=await templates.prepare('project','ТЗ','Форма требований',undefined,'native-document:editor','cloudflareos.document');
 const creator=prepared.creator;
 await assert.rejects(creator.issue(1024*1024+1,'checksum'));assert.equal(calls.length,0);
 await creator.issue(100,'checksum');await assert.rejects(creator.checkpoint('foreign'));await creator.checkpoint('upload');
 const saved=await creator.save();assert.equal(saved.revision,1);
 assert.equal(calls[1][2].content_type,'application/vnd.cloudflareos.document+json');assert.equal(calls[1][2].upload_id,'upload');
 assert.equal(calls[2][2].kind,'document');assert.equal(calls[2][2].source_head,'b'.repeat(64));
 assert.deepEqual(await (await templates.resume(prepared.id)).save(),saved);assert.equal(calls.length,3);
 assert.deepEqual(await templates.latest('native-document:editor'),saved);
 denied=true;await assert.rejects(creator.save(),/denied/);denied=false;
 await assert.rejects(templates.prepare('project','ТЗ','Форма',undefined,'source','cloudflareos.spreadsheet' as any));
 await assert.rejects(templates.prepare('project','ТЗ','Форма',{template_id:saved.template_id,revision:1},'source'));
 const next=await templates.prepare('project','ТЗ','Правка',{template_id:saved.template_id,revision:1},'native-document:editor','cloudflareos.document');
 await next.creator.issue(100,'checksum');await next.creator.checkpoint('upload');const changed=await next.creator.save();
 assert.equal(changed.template_id,saved.template_id);assert.equal(changed.revision,2);assert.equal(saved.revision,1);
});

test('просмотр общей версии выдаёт только метаданные и билет, а показ требует текущего доступа',async()=>{
 const ref={scope_id:'team',template_key:'form',revision:5},head='a'.repeat(64);let denied=false;
 const source={title:'Форма',purpose:'ТЗ',kind:'document',source_head:head,content_type:'application/vnd.cloudflareos.document+json',project_id:'private-project',node_id:'private-node'};
 const session={async listTemplateScopes(){return {scopes:[{scope_id:'team',revision:3,name:'Группа',enabled:true,level:'group'}],next_cursor:''}},async beginWorkTemplateDownload(reference:unknown){assert.deepEqual(reference,ref);return {source,ticket:{url:'https://objects.example/form',method:'GET',size_bytes:100,sha256_hex:'b'.repeat(64),expires_at:new Date(Date.now()+60_000).toISOString()}}},async readWorkTemplateSelection(references:unknown){if(denied)throw Error('denied');assert.deepEqual(references,[ref]);return {materials:[{scoped:{source}}]}}};
 const templates=new BlueprintTemplates(session as any,{} as any),preview=await templates.preview(ref);
 assert.deepEqual(preview.material.reference,ref);assert.equal(preview.sourceHead,head);assert.equal(JSON.stringify(preview).includes('private-project'),false);assert.equal(JSON.stringify(preview).includes('private-node'),false);
 await templates.validatePreview(ref,head);denied=true;await assert.rejects(templates.validatePreview(ref,head),/denied/);denied=false;
 await assert.rejects(templates.validatePreview(ref,'c'.repeat(64)));source.content_type='application/octet-stream';await assert.rejects(templates.preview(ref));
});

for(const scopeLevel of ['group','department','organization'])test('личная правка обновляет исходный общий ключ: '+scopeLevel,async()=>{
 const entries=new Map<string,unknown>();let denied=false,level=scopeLevel,kind='guidance';let version:any,action:any;const writes:any[]=[];
 const ref={scope_id:'team',template_key:'method',revision:5};
 const session={
  async readWorkTemplateSelection(references:any){if(denied)throw Error('denied');assert.deepEqual(references,[ref]);return {materials:[{scoped:{source:{kind,content_type:'application/vnd.cloudflareos.document+json'}}}]};},
  async listTemplateScopes(){return {scopes:[{scope_id:'team',revision:3,name:'Группа',enabled:true,level}],next_cursor:''};},
  async openDraft(){return {head:'a'.repeat(64)}},async beginNativeUpload(){return {upload_id:'upload'}},
  async createPrivateDocument(){return {node_id:'copy',head:'b'.repeat(64)}},
  async saveWorkTemplateSnapshot(id:string,input:any){version={...input,template_id:id,revision:1};return version},
  async readWorkTemplate(){return version},async readSavedTemplateAction(){return action??null},
  async saveTemplateAction(_project:string,input:any){writes.push(input);action={id:'action',...input};return action},
  async executeSavedTemplateAction(){return {receipt:{kind:'propose',proposal:{proposal_id:'proposal',target_scope_id:'team'}}}},
 };
 const storage={get:(key:string)=>entries.get(key),put:(key:string,value:unknown)=>entries.set(key,structuredClone(value))};
 const templates=new BlueprintTemplates(session as any,storage as any);
 denied=true;await assert.rejects(templates.prepare('project','Методика','ТЗ',undefined,'copy','cloudflareos.document','guidance',ref));denied=false;
 kind='document';await assert.rejects(templates.prepare('project','Методика','ТЗ',undefined,'copy','cloudflareos.document','guidance',ref));kind='guidance';
 const prepared=await templates.prepare('project','Методика','ТЗ',undefined,'copy','cloudflareos.document','guidance',ref);
 await prepared.creator.issue(100,'checksum');await prepared.creator.checkpoint('upload');const saved=await prepared.creator.save();assert.notEqual(saved.template_id,ref.template_key);assert.equal(saved.revision,1);
 await assert.rejects(prepared.creator.propose('other',3,'Уточнить критерий'));await assert.rejects(prepared.creator.propose('team',3,''));assert.equal(writes.length,0);
 denied=true;await assert.rejects(prepared.creator.propose('team',3,'Уточнить критерий'));assert.equal(writes.length,0);denied=false;
 await prepared.creator.propose('team',3,'Уточнить критерий');assert.equal(writes[0].template,saved.template_id);assert.equal(writes[0].input.template_key,'method');assert.equal(writes[0].input.expected_catalogue_revision,5);assert.equal(writes[0].input.message,'Уточнить критерий');
 await assert.rejects(prepared.creator.propose('team',3,'Другая причина'));assert.equal(writes.length,1);
 await (await templates.resume(prepared.id)).propose('team',3,'Уточнить критерий');assert.deepEqual(writes[1].input,writes[0].input);
});

test('повышение нативной версии закрепляет показанный следующий уровень и не пропускает изменённые правила',async()=>{
 const ref={scope_id:'team',template_key:'method',revision:5};const entries=new Map<string,unknown>();let parentRevision=3,writes:any[]=[],denied=false;
 const scopes=[{scope_id:'team',revision:2,name:'Группа',enabled:true,level:'group',parent_id:'dept'},{scope_id:'dept',revision:3,name:'Отдел',enabled:true,level:'department',parent_id:'org'},{scope_id:'org',revision:1,name:'Организация',enabled:true,level:'organization',parent_id:''}];
 const session={
  async beginWorkTemplateDownload(){return {source:{title:'Методика',purpose:'ТЗ',kind:'guidance',source_head:'a'.repeat(64),content_type:'application/vnd.cloudflareos.document+json'},ticket:{size_bytes:100,expires_at:new Date(Date.now()+60000).toISOString()}}},
  async listTemplateScopes(cursor:string){return cursor?{scopes:scopes.slice(1).map(s=>s.scope_id==='dept'?{...s,revision:parentRevision}:s),next_cursor:''}:{scopes:scopes.slice(0,1),next_cursor:'parent'}},
  async readScopedWorkTemplate(scope:string,key:string,revision:number){if(denied)throw Error('denied');assert.equal(key,'method');if(scope==='team'){assert.equal(revision,5);return {source:{project_id:'project'}}}return {revision:7}},
  async readSavedTemplateAction(){return null},async saveTemplateAction(_project:string,input:any){writes.push(input);return {id:'action'}},
  async executeSavedTemplateAction(){return {receipt:{kind:'propose',proposal:{proposal_id:'proposal'}}}},async readTemplateProposal(){if(denied)throw Error('denied');return {proposal:{proposal_id:'proposal',target_scope_id:'dept'}}},
 };
 const templates=new BlueprintTemplates(session as any,{get:(key:string)=>entries.get(key),put:(key:string,value:unknown)=>entries.set(key,structuredClone(value))} as any);
 assert.deepEqual((await templates.preview(ref)).promotion,{scope_id:'dept',revision:3,name:'Отдел',level:'department'});
 const target={scope_id:'dept',revision:3},id=crypto.randomUUID();parentRevision=4;await assert.rejects(templates.promote('team','method',5,'Для отдела',id,target));assert.equal(writes.length,0);parentRevision=3;
 await templates.promote('team','method',5,'Для отдела',id,target);assert.equal(writes[0].input.source_scope_id,'team');assert.equal(writes[0].input.target_scope_id,'dept');assert.equal(writes[0].input.target_scope_revision,3);assert.equal(writes[0].input.expected_catalogue_revision,7);
 await templates.promote('team','method',5,'Для отдела',id,target);assert.equal(writes.length,1);denied=true;await assert.rejects(templates.promote('team','method',5,'Для отдела',id,target));
});


test('план доступа закреплён в предложении: старый ответ и смена правил не объявляются успехом',async()=>{
 const entries=new Map<string,unknown>(),id='capture';const version={template_id:id,revision:1,user_id:'author',project_id:'project',node_id:'snapshot',source_head:'head',content_type:'application/vnd.cloudflareos.document+json'};
 const scopes=[{scope_id:'group',revision:1,level:'group',enabled:true,parent_id:'dept',approvers:['reviewer']},{scope_id:'dept',revision:1,level:'department',enabled:true,parent_id:'org',approvers:['other']},{scope_id:'org',revision:1,level:'organization',enabled:true,parent_id:'',approvers:['other']}];let receiptPath=structuredClone(scopes),writes=0;
 const session={async whoAmI(){return {subject:{user_id:'author'}}},async readWorkTemplate(){return version},async listTemplateScopes(){return {scopes,next_cursor:''}},async openDraft(){return {head:'head'}},async downloadPrivateVersion(){return {sha256_hex:'hash',size_bytes:100,content_type:version.content_type}},async listPrivateDraftParticipants(){return {participants:[{principal_id:'reviewer',display_name:'Мария',mode:'read',can_read:true}],next_cursor:''}},async readSavedTemplateAction(){return null},async saveTemplateAction(){writes++;return {id:'action'}},async executeSavedTemplateAction(){return {receipt:{kind:'propose',proposal:{proposal_id:'proposal',target_scope_id:'group',scope_path:receiptPath}}}}};
 entries.set('blueprint-template:'+id,{id,project:'project',purpose:'ТЗ',version});
 const creator=await new BlueprintTemplates(session as any,{get:(k:string)=>entries.get(k),put:(k:string,v:unknown)=>entries.set(k,structuredClone(v))} as any).resume(id);
 const plan=await creator.reviewAccess('group',1);receiptPath[2].revision=2;
 await assert.rejects(creator.propose('group',1,undefined,plan.key),/другим правилам/);assert.equal(writes,1);
 receiptPath=structuredClone(scopes);await creator.propose('group',1,undefined,plan.key);assert.equal(writes,2);
 scopes[2].revision=2;const changed=await creator.reviewAccess('group',1);
 await assert.rejects(creator.propose('group',1,undefined,changed.key),/прежним составом/);assert.equal(writes,2);
});

test('просмотр личной формы возвращает авторизованный исходный проект для редактирования',async()=>{
 const ref={template_id:'personal',revision:3},source={project_id:'source-project',title:'Форма',purpose:'ТЗ',kind:'document',source_head:'a'.repeat(64),content_type:'application/vnd.cloudflareos.document+json'};
 const session={async beginWorkTemplateDownload(reference:unknown){assert.deepEqual(reference,ref);return {source,ticket:{size_bytes:100,expires_at:new Date(Date.now()+60000).toISOString()}}}};
 const preview=await new BlueprintTemplates(session as any,{} as any).preview(ref);assert.equal(preview.sourceProjectId,'source-project');assert.deepEqual(preview.material.reference,ref);
});
