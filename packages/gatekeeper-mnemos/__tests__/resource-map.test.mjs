import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {build} from 'esbuild';
const built=await build({stdin:{contents:'export {ResourceMapView} from "./app/resource-map.ts";export {decodeResourceMap,changeResourceMap,resourceReviewText} from "./src/resource-map-artifact.ts";export {ResourceMapEdits} from "./src/resource-map-edits.ts";export {ResourceMapCreation} from "./src/resource-map-creation.ts";export {MnemosAPI} from "./src/mnemos-api.ts";',resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const {ResourceMapView,decodeResourceMap,changeResourceMap,resourceReviewText,ResourceMapEdits,ResourceMapCreation,MnemosAPI}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const mime='application/vnd.mnemos.resource-map+json';
const resource={id:'repo',kind:'repository',name:'<img src=x onerror=alert(1)>',description:'Private source context',url:'https://git.example/team/repo',owner_ids:['alice'],environment:'production'};
const artifact={format:'mnemos.resource-map',format_version:1,revision:3,title:'Product',resources:[resource,{...resource,id:'prod',kind:'deployment',name:'Production',owner_ids:[],url:''}],links:[{from:'prod',to:'repo',relation:'built_from'}]};
test('map shows authorized context and clears it after revocation or source change',async()=>{
 const dom=new JSDOM('<main/>');globalThis.document=dom.window.document;const root=document.querySelector('main');let mode='ok',reads=0,downloads=0;
 const api={listPrivateDocuments:async()=>({documents:[{node_id:'map',name:'Product',content_type:mime}],next_cursor:''}),readDraftDocument:async()=>{reads++;if(mode==='denied'||(mode==='revoked'&&reads%2===0))throw Error('denied');return {head:(mode==='changed'&&reads%2===0?'b':'a').repeat(64),exists:true,conflicted:false,content_type:mime,terms:[{present:true,negative:false,metadata:{content_type:mime}}]};}};
 const view=new ResourceMapView(root,api,[],()=>{},async(project,node,head,side)=>{downloads++;assert.deepEqual([project,node,head,side],['project','map','a'.repeat(64),0]);return JSON.stringify(artifact);});
 await view.load('project');await view.open('map');assert(root.textContent.includes('Private source context'));assert(root.textContent.includes('Собрано из:'));assert(root.textContent.includes('Ответственные: не указаны'));assert.equal(root.querySelector('img'),null);assert.equal(root.querySelector('a').rel,'noopener noreferrer');
 for(const state of ['denied','revoked','changed']){mode=state;reads=0;const before=downloads;await view.open('map');assert(!root.textContent.includes('Private source context'));assert(root.textContent.includes('недоступна'));assert.equal(downloads,before+(state==='denied'?0:1));}
});
test('map preview rejects executable or credential locations and broken relationships',()=>{
 for(const url of ['javascript:alert(1)','https://user:secret@git.example/repo','https://git.example/repo?token=x','https://git.example/repo#secret'])assert.throws(()=>decodeResourceMap(JSON.stringify({...artifact,resources:[{...resource,url}]})));
 assert.throws(()=>decodeResourceMap(JSON.stringify({...artifact,resources:[resource]})));
 assert.throws(()=>decodeResourceMap(JSON.stringify({...artifact,links:[{from:'repo',to:'missing',relation:'depends_on'}]})));
 assert.equal(decodeResourceMap(JSON.stringify(artifact)).revision,3);
});

function memory(){const values=new Map();return {get:key=>structuredClone(values.get(key)),put:(key,v)=>values.set(key,structuredClone(v)),delete:key=>values.delete(key)};}
test('resource edit keeps other entries and refuses unknown source fields and broken references',()=>{
 const desired=structuredClone(artifact);desired.resources[0].description='Updated';const after=JSON.parse(changeResourceMap(JSON.stringify(artifact),desired));assert.equal(after.revision,4);assert.deepEqual(after.resources[1],artifact.resources[1]);assert.deepEqual(after.links,artifact.links);
 assert.throws(()=>changeResourceMap(JSON.stringify({...artifact,future_data:'keep'}),desired));desired.resources.pop();assert.throws(()=>changeResourceMap(JSON.stringify(artifact),desired));
});
test('lost map save restores the intent and cannot be replayed automatically',async()=>{
 const dom=new JSDOM('<main/>');globalThis.document=dom.window.document;const root=document.querySelector('main'),storage=memory();let head='a'.repeat(64),body=JSON.stringify(artifact),saves=0;
 const api={listPrivateDocuments:async()=>({documents:[]}),readDraftDocument:async()=>({head,exists:true,conflicted:false,content_type:mime,terms:[{present:true,negative:false,metadata:{content_type:mime}}]}),saveDraftDocument:async(project,node,upload,expected)=>{assert.equal(expected,'a'.repeat(64));saves++;head='b'.repeat(64);body=upload;throw Error('lost response');}};
 let journal=new ResourceMapEdits(storage);Object.assign(api,{readResourceMapEdit:(p,n)=>journal.read(api,p,n),prepareResourceMapEdit:(p,n,i)=>journal.prepare(api,p,n,i),claimResourceMapEdit:(p,n,id)=>journal.claim(api,p,n,id),clearResourceMapEdit:(p,n,id,h)=>journal.clear(api,p,n,id,h)});
 const view=()=>new ResourceMapView(root,api,[],()=>{},async()=>body,async(p,content)=>content);
 let current=view();await current.load('project');await current.open('map');[...root.querySelectorAll('button')].find(b=>b.textContent==='Изменить карту').click();const field=root.querySelector('[aria-label="Описание ресурса 1"]');field.value='Saved with lost response';field.dispatchEvent(new dom.window.Event('input'));await current.save();assert.equal(saves,1);assert(root.textContent.includes('повторная запись отключена'));
 journal=new ResourceMapEdits(storage);current=view();await current.load('project');await current.open('map');assert(root.textContent.includes('версия 4'));assert(root.textContent.includes('Восстановлена сохранённая правка'));await current.save();assert.equal(saves,1);assert(![...root.querySelectorAll('button')].some(b=>b.textContent==='Продолжить сохранённую правку'));await current.dismiss();assert.equal(await api.readResourceMapEdit('project','map'),null);assert.equal(saves,1);
});

const setup={title:"Resource map"};
test('resource map creation survives reconstruction and replays exact coordinates after lost POST',async()=>{
 const values=new Map();const storage={get:key=>structuredClone(values.get(key)),put:(key,value)=>values.set(key,structuredClone(value)),delete:key=>values.delete(key)};
 let heads=0,uploads=0,puts=0,denied=false;const requests=[];
 const api={listPrivateDocuments:async()=>{if(denied)throw Error("revoked");return {documents:[]};},draftState:async()=>{if(denied)throw Error('revoked');return {};},openDraft:async()=>{heads++;return {head:'a'.repeat(64)};},beginNativeUpload:async(project,size,checksum)=>{uploads++;return {url:'https://storage.example/upload',method:'PUT',content_length:size,checksum_header:'x-amz-checksum-sha256',checksum_value:checksum,upload_id:'saved-upload'};},createPrivateDocument:async(project,input)=>{requests.push(structuredClone(input));if(requests.length===1)throw Error('lost POST');return {node_id:'tracker',head:'b'.repeat(64)};},readDraftDocument:async()=>({exists:true})};
 const fetcher=async function(url,options){assert.equal(this,undefined);puts++;assert.equal(url.origin,'https://storage.example');assert.equal(options.redirect,'manual');assert.equal(options.headers.Authorization,undefined);const artifact=JSON.parse(new TextDecoder().decode(options.body));assert.equal(artifact.format,'mnemos.resource-map');assert.deepEqual(artifact.resources,[]);assert.deepEqual(artifact.links,[]);return new Response('',{status:200});};
 let creation=new ResourceMapCreation(storage,'https://storage.example',fetcher);const saved=await creation.save(api,'project',setup,'');await assert.rejects(()=>creation.execute(api,'project',saved.id));assert.equal(requests.length,1);
 await assert.rejects(()=>creation.save(api,'project',{...setup,title:'Replacement'},saved.id));
 creation=new ResourceMapCreation(storage,'https://storage.example',fetcher);const restored=await creation.read(api,'project');assert.equal(restored.upload,'saved-upload');assert.equal(restored.attempted,true);
 const result=await creation.execute(api,'project',restored.id);assert.equal(result.result.node_id,'tracker');assert.deepEqual(requests[1],requests[0]);assert.equal(heads,1);assert.equal(uploads,1);assert.equal(puts,1);
 await creation.execute(api,'project',restored.id);assert.equal(requests.length,2);denied=true;await assert.rejects(()=>creation.execute(api,'project',restored.id));
});

test('document API accepts resource maps and still refuses arbitrary MIME',async()=>{
 let calls=0;const api=new MnemosAPI('https://api.example',async()=>'token',async(url,options)=>{calls++;assert.equal(JSON.parse(options.body).content_type,mime);return Response.json({node_id:'map',head:'b'.repeat(64)});});const request={request_id:'stable',expected_head:'a'.repeat(64),parent_id:'',name:'Map',content_type:mime,upload_id:'upload',message:'Create'};
 await api.createPrivateDocument('project',request);assert.equal(calls,1);await assert.rejects(()=>api.createPrivateDocument('project',{...request,content_type:'application/unknown'}));assert.equal(calls,1);
});

test('review shows readable exact map sides and refuses malformed claimed maps',()=>{
 assert.equal(resourceReviewText(null),null);assert.equal(resourceReviewText('ordinary text'),'ordinary text');assert.equal(resourceReviewText('{"hello":"world"}'),'{"hello":"world"}');
 const text=resourceReviewText(JSON.stringify(artifact));assert(text.includes('Ответственные: alice'));assert(text.includes('Собрано из:'));assert(!text.includes('format_version'));
 assert.throws(()=>resourceReviewText(JSON.stringify({...artifact,links:[{from:'repo',to:'missing',relation:'depends_on'}]})));
});
test('published map opens without a personal branch and clears on revocation or changed publication',async()=>{
 const dom=new JSDOM('<main/>');globalThis.document=dom.window.document;const root=document.querySelector('main');let mode='ok',reads=0,downloads=0;
 const api={listPrivateDocuments:async()=>({documents:[]}),readDraftDocument:async()=>{throw Error('Personal branch must not be read');},browseProject:async()=>({nodes:[{node_id:'map',name:'Shared inventory',is_dir:false}],next_cursor:'next'}),nodeHistory:async()=>{reads++;if(mode==='revoked')throw Error('denied');return {events:[{event_id:mode==='changed'&&reads%2===0?'event-new':'event',head:'a'.repeat(64),exists:true,content_type:mime}]};}};
 const view=new ResourceMapView(root,api,[],()=>{},async(p,n,version,side)=>{downloads++;assert.deepEqual([p,n,version,side],['project','map','publication:event',0]);return JSON.stringify(artifact);},async()=>{throw Error('No upload');},()=>{throw Error('No publish');});
 await view.load('project');assert(root.textContent.includes('Общая карта: Shared inventory'));assert(root.textContent.includes('Следующая страница опубликованных карт'));reads=0;await view.openPublished('map');assert(root.textContent.includes('Private source context'));assert(root.textContent.includes('Общая опубликованная версия'));assert(![...root.querySelectorAll('button')].some(b=>b.textContent==='Изменить карту'||b.textContent==='Согласование и публикация карты'));
 mode='changed';reads=0;await view.openPublished('map');assert(!root.textContent.includes('Private source context'));mode='revoked';const before=downloads;await view.openPublished('map');assert.equal(downloads,before);assert(root.textContent.includes('Карта недоступна'));
});

test('observability handoff rechecks the selected map and never forwards its private contents',async()=>{
 const dom=new JSDOM('<main/>');globalThis.document=dom.window.document;const root=document.querySelector('main');
 let head='a'.repeat(64),denied=false;const handed=[];
 const api={listPrivateDocuments:async()=>({documents:[]}),readDraftDocument:async()=>{if(denied)throw Error('denied');return {head,exists:true,conflicted:false,content_type:mime,terms:[{present:true,negative:false,metadata:{content_type:mime}}]};}};
 const make=()=>new ResourceMapView(root,api,[],()=>{},async()=>JSON.stringify(artifact),undefined,undefined,x=>handed.push(x));
 let view=make();await view.load('project');await view.open('map');head='b'.repeat(64);await view.prepareAssessment();assert.equal(handed.length,0);assert(!root.textContent.includes('Private source context'));
 head='a'.repeat(64);view=make();await view.load('project');await view.open('map');denied=true;await view.prepareAssessment();assert.equal(handed.length,0);
 denied=false;view=make();await view.load('project');await view.open('map');await view.prepareAssessment();assert.deepEqual(handed,[{project:'project',node:'map',head:'a'.repeat(64),source:'draft'}]);
 dom.window.close();delete globalThis.document;
});
