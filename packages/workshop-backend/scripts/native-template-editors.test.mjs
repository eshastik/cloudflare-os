import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import * as Y from 'yjs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
execFileSync(process.execPath,[fileURLToPath(new URL('../../gatekeeper-mnemos/scripts/build-native-validation.mjs',import.meta.url))]);
const {readAgentNativeDocument,saveAgentNativeDocument}=await import('../../gatekeeper-mnemos/src/agent-native-document.ts');

// Исполняется поставляемый редактор; заменяется только платформа хранения.
async function editor(kind){
 const bytes=await readFile(new URL('../format-blueprints/workspace-'+kind+'.gadget',import.meta.url));
 const metadata=bytes.readUInt32BE(12),size=Number(bytes.readBigUInt64BE(16));assert.equal(bytes.length-24-metadata,size);
 const archive=new Y.Doc();Y.applyUpdateV2(archive,gunzipSync(bytes.subarray(24+metadata)));
 const source=archive.getMap().get('server.js')?.toString();assert.match(source,/restoreDocumentSnapshot/);archive.destroy();
 const code=source.replace('import { DurableObject } from "cloudflare:workers";','class DurableObject {}');
 const {Gadget}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
 const values=new Map();
 const storage={get:async key=>structuredClone(values.get(key)),put:async(key,value)=>{values.set(key,structuredClone(value));},delete:async key=>values.delete(key),transaction:async fn=>fn(storage)};
 return new Gadget({storage},{});
}

test('Настоящий редактор таблицы сохраняет формулы, стили, размеры и систему дат при восстановлении шаблона',async()=>{
 const app=await editor('sheets'),initial=await app.getDocument(),snapshot=await app.exportDocumentSnapshot(initial.revision),id=snapshot.document.sheetOrder[0];
 snapshot.document.title='Расчёт';snapshot.document.dateSystem='1904';snapshot.document.sheets[id].colWidths={'0':160};snapshot.document.sheets[id].rowHeights={'0':32};snapshot.document.sheets[id].frozenRows=1;
 snapshot.document.cells[id]={A1:{value:'Количество',fmt:{b:true,bg:'#ffffff'},version:1},B1:{value:'=SUM(B2:B4)',fmt:{nf:'number',d:2},version:1}};
 const expected=structuredClone(snapshot.document),restored=await app.restoreDocumentSnapshot(snapshot,initial.revision),result=await app.exportDocumentSnapshot(restored.revision);
 assert.equal(result.format,'cloudflareos.spreadsheet');assert.deepEqual(result.document.sheetOrder,expected.sheetOrder);assert.deepEqual(result.document.sheets,expected.sheets);assert.equal(result.document.dateSystem,'1904');
 for(const ref of ['A1','B1']){assert.equal(result.document.cells[id][ref].value,expected.cells[id][ref].value);assert.deepEqual(result.document.cells[id][ref].fmt,expected.cells[id][ref].fmt);}
 await assert.rejects(app.restoreDocumentSnapshot(snapshot,initial.revision),/Document changed/);assert.equal((await app.getDocument()).revision,restored.revision);
});

test('Настоящий редактор презентации сохраняет слайды и оформление, отказ не заменяет принятую версию',async()=>{
 const app=await editor('slides'),initial=await app.getDocument(),snapshot=await app.exportDocumentSnapshot(initial.revision);
 snapshot.document.title='План';snapshot.document.slides[0].background={color:'#ffffff',inset:true};snapshot.document.slides[0].blocks[0].props.text='Квартальный план';
 const expected=structuredClone(snapshot.document),restored=await app.restoreDocumentSnapshot(snapshot,initial.revision),result=await app.exportDocumentSnapshot(restored.revision);
 assert.equal(result.format,'cloudflareos.presentation');assert.equal(result.document.themeVersion,expected.themeVersion);assert.equal(result.document.title,'План');assert.deepEqual(result.document.slides,expected.slides);
 const broken=structuredClone(snapshot);broken.document.themeVersion='future';assert.throws(()=>app.restoreDocumentSnapshot(broken,restored.revision),/Unsupported/);assert.deepEqual((await app.getDocument()).slides,expected.slides);
});

for(const kind of ['docs','sheets','slides'])test('Заполнение '+kind+' агентом открывается настоящим редактором без потери структуры',async()=>{
 const app=await editor(kind);if(kind==='docs')await app.initializeBlocks({title:'Форма',blocks:[{id:'purpose',html:'<h1>Цель</h1>',version:1}]});const initial=await app.getDocument(),source=await app.exportDocumentSnapshot(initial.revision);
 const head='a'.repeat(64),next='b'.repeat(64),origin='https://storage.test';let body=JSON.stringify(source),savedHead=head;
 const session={readDraftDocument:async()=>({exists:true,conflicted:false,content_type:'application/vnd.'+source.format+'+json',head:savedHead,terms:[]}),checkPrivateVersionRead:async()=>{},beginDraftDownload:async()=>{const b=new TextEncoder().encode(body),h=Buffer.from(await crypto.subtle.digest('SHA-256',b)).toString('hex');return {method:'GET',url:origin+'/data',node_id:'node',head:savedHead,term_index:0,size_bytes:b.length,sha256_hex:h,expires_at:new Date(Date.now()+10000).toISOString()}},beginNativeUpload:async(_p,size,checksum)=>({method:'PUT',url:origin+'/data',upload_id:'u',content_length:size,checksum_header:'x-amz-checksum-sha256',checksum_value:checksum}),saveDraftDocument:async()=>{savedHead=next;return {head:next}}};
 const fetcher=async(_url,init)=>{if(init.method==='PUT'){body=new TextDecoder().decode(init.body);return new Response(null,{status:200})}return new Response(body)};
 const read=await readAgentNativeDocument(session,origin,'project','node',fetcher),doc=read.snapshot.document;
 if(kind==='docs'){doc.title='Заполненный документ';doc.blocks=[{id:'result',html:'<h1>Запуск</h1><p>Готовность 20 октября</p>',version:1}];}
 if(kind==='sheets'){const id=doc.sheetOrder[0];doc.cells[id].A1={value:'=SUM(B1:B2)',fmt:null,version:1};doc.cells[id].B1={value:'42',fmt:{b:true},version:1};doc.cells[id].B2={value:'8',fmt:null,version:1};}
 if(kind==='slides')doc.slides[0].blocks.find(b=>b.type==='title').props.text='Готовность 20 октября';
 const edited=structuredClone(doc);await saveAgentNativeDocument(session,origin,'project','node',read.head,read.snapshot,fetcher);
 const confirmed=await readAgentNativeDocument(session,origin,'project','node',fetcher);assert.equal(confirmed.head,next);
 const restored=await app.restoreDocumentSnapshot(confirmed.snapshot,initial.revision),visible=await app.exportDocumentSnapshot(restored.revision);
 if(kind==='docs')assert.equal(visible.document.blocks[0].html,edited.blocks[0].html);
 if(kind==='sheets'){assert.deepEqual(visible.document.sheets,edited.sheets);assert.equal(visible.document.cells[doc.sheetOrder[0]].A1.value,'=SUM(B1:B2)');assert.equal(visible.document.cells[doc.sheetOrder[0]].B1.value,'42');}
 if(kind==='slides')assert.deepEqual(visible.document.slides,edited.slides);
});
