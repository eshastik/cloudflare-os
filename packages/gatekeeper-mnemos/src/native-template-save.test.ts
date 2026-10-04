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
 const session={async beginWorkTemplateDownload(reference:unknown){assert.deepEqual(reference,ref);return {source,ticket:{url:'https://objects.example/form',method:'GET',size_bytes:100,sha256_hex:'b'.repeat(64),expires_at:new Date(Date.now()+60_000).toISOString()}}},async readWorkTemplateSelection(references:unknown){if(denied)throw Error('denied');assert.deepEqual(references,[ref]);return {materials:[{scoped:{source}}]}}};
 const templates=new BlueprintTemplates(session as any,{} as any),preview=await templates.preview(ref);
 assert.deepEqual(preview.material.reference,ref);assert.equal(preview.sourceHead,head);assert.equal(JSON.stringify(preview).includes('private-project'),false);assert.equal(JSON.stringify(preview).includes('private-node'),false);
 await templates.validatePreview(ref,head);denied=true;await assert.rejects(templates.validatePreview(ref,head),/denied/);denied=false;
 await assert.rejects(templates.validatePreview(ref,'c'.repeat(64)));source.content_type='application/octet-stream';await assert.rejects(templates.preview(ref));
});
