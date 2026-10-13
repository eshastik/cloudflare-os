import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checkedNativeDocument,readAgentNativeDocument,saveAgentNativeDocument} from './agent-native-document.ts';

const HEAD='a'.repeat(64),NEXT='b'.repeat(64),ORIGIN='https://storage.test';
const snapshot={format:'cloudflareos.document' as const,formatVersion:1 as const,document:{title:'ТЗ',revision:1,blocks:[{id:'requirements',html:'<h1>Требования</h1><p><strong>Исходные данные</strong></p>',version:1}]}};
function fixture(source:Parameters<typeof checkedNativeDocument>[0]=snapshot){
 const state={head:HEAD,revoked:false,saves:0,uploads:0,gets:0,puts:0,drift:false,mime:`application/vnd.${(source as {format:string}).format}+json`,body:JSON.stringify(source),ticketPatch:{} as Record<string,unknown>,uploadPatch:{} as Record<string,unknown>,uploaded:''};
 const api={
  async readDraftDocument(){return {exists:true,conflicted:false,content_type:state.mime,head:state.head,terms:[{metadata:{name:'ТЗ.cfdoc'}}]};},
  async checkPrivateVersionRead(){if(state.revoked)throw Error('Доступ отозван');},
  async beginDraftDownload(){const bytes=new TextEncoder().encode(state.body);const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');return {method:'GET',url:ORIGIN+'/doc',node_id:'node',head:state.head,term_index:0,size_bytes:bytes.length,sha256_hex:hash,expires_at:new Date(Date.now()+60_000).toISOString(),...state.ticketPatch};},
  async beginNativeUpload(_project:string,size:number,checksum:string){state.uploads++;return {method:'PUT',url:ORIGIN+'/doc',upload_id:'upload',content_length:size,checksum_header:'x-amz-checksum-sha256',checksum_value:checksum,...state.uploadPatch};},
  async saveDraftDocument(_p:string,_n:string,_u:string,head:string){if(head!==state.head)throw Error('Конфликт');state.saves++;state.head=NEXT;return {head:NEXT};},
 } as Parameters<typeof readAgentNativeDocument>[0];
 const fetcher=(async(_url:unknown,init?:RequestInit)=>{
  assert.equal(init?.redirect,'manual');
  if(init?.method==='PUT'){state.puts++;state.uploaded=new TextDecoder().decode(init.body as Uint8Array);if(state.drift)state.head=NEXT;return new Response(null,{status:200});}
  state.gets++;return new Response(state.body);
 }) as typeof fetch;
 return {state,api,fetcher};
}
test('форма читается и заполняется с сохранением нативных блоков и оформления',async()=>{
 const {api,state,fetcher}=fixture();const read=await readAgentNativeDocument(api,ORIGIN,'project','node',fetcher);
 assert.deepEqual(read.snapshot,snapshot);assert.equal(read.head,HEAD);
 (read.snapshot.document.blocks as {html:string}[])[0].html+='<p>Личный кабинет: роли клиента и оператора.</p>';
 const result=await saveAgentNativeDocument(api,ORIGIN,'project','node',read.head,read.snapshot,fetcher);
 assert.equal(result.head,NEXT);assert.equal(result.status,'saved');assert.equal(state.saves,1);
 const saved=JSON.parse(state.uploaded);assert.match(saved.document.blocks[0].html,/<strong>Исходные данные<\/strong>/);assert.equal(saved.document.blocks[0].id,'requirements');assert.match(saved.document.blocks[0].html,/роли клиента/);
});
test('параллельная правка до сохранения не вызывает загрузку',async()=>{
 const {api,state,fetcher}=fixture();state.head=NEXT;
 await assert.rejects(saveAgentNativeDocument(api,ORIGIN,'project','node',HEAD,snapshot,fetcher),/изменилась/);
 assert.equal(state.uploads,0);assert.equal(state.saves,0);
});
test('правка человека во время загрузки сохраняется и не заменяется формой агента',async()=>{
 const {api,state,fetcher}=fixture();state.drift=true;
 await assert.rejects(saveAgentNativeDocument(api,ORIGIN,'project','node',HEAD,snapshot,fetcher),/изменилась/);
 assert.equal(state.puts,1);assert.equal(state.saves,0);assert.equal(state.head,NEXT);
});
test('отзыв доступа во время скачивания не выдаёт снимок',async()=>{
 const {api,state,fetcher}=fixture();const revoke=(async(...args:Parameters<typeof fetch>)=>{const response=await fetcher(...args);state.revoked=true;return response;}) as typeof fetch;
 await assert.rejects(readAgentNativeDocument(api,ORIGIN,'project','node',revoke),/отозван/);
});
test('чужой адрес, несовпавшая версия и сумма не дают содержимое',async()=>{
 for(const patch of [{url:'https://foreign.test/doc'},{head:NEXT},{sha256_hex:'0'.repeat(64)},{size_bytes:2},{expires_at:'bad'}]){
  const {api,state,fetcher}=fixture();state.ticketPatch=patch;
  await assert.rejects(readAgentNativeDocument(api,ORIGIN,'project','node',fetcher));
  assert.equal(state.saves,0);
 }
});
test('чужой адрес загрузки и неверная сумма не сохраняют версию',async()=>{
 for(const patch of [{url:'https://foreign.test/doc'},{checksum_value:'bad'},{content_length:1}]){
  const {api,state,fetcher}=fixture();state.uploadPatch=patch;
  await assert.rejects(saveAgentNativeDocument(api,ORIGIN,'project','node',HEAD,snapshot,fetcher));
  assert.equal(state.puts,0);assert.equal(state.saves,0);
 }
});
test('повреждённая структура, повтор блока и код вместо данных отвергаются',()=>{
 const duplicate=structuredClone(snapshot);duplicate.document.blocks.push(duplicate.document.blocks[0]);
 for(const invalid of [duplicate,{...snapshot,bindings:{}},{...snapshot,format:'cloudflareos.spreadsheet'},{...snapshot,document:{title:'ТЗ',blocks:[{id:'x'}]}}])assert.throws(()=>checkedNativeDocument(invalid));
});
test('ограничение размера применяется до выгрузки',async()=>{
 const {api,state,fetcher}=fixture();const large=structuredClone(snapshot);large.document.blocks[0].html='я'.repeat(1024*1024);
 await assert.rejects(saveAgentNativeDocument(api,ORIGIN,'project','node',HEAD,large,fetcher),/МиБ/);assert.equal(state.uploads,0);
});

test('неподтверждённое сохранение не выдаётся за готовый результат',async()=>{
 for(const receipt of [{},{head:''},{head:'0'.repeat(64)},{head:'неверная версия'}]){
  const {api,fetcher}=fixture();api.saveDraftDocument=async()=>receipt as any;
  await assert.rejects(saveAgentNativeDocument(api,ORIGIN,'project','node',HEAD,snapshot,fetcher),/не подтвердил/);
 }
});

test('перенаправление чтения или загрузки не выдаёт содержимое и не сохраняет версию',async()=>{
 for(const status of [301,302,307,308]){
  const {api,state}=fixture();
  const redirected:typeof fetch=async(_url,init)=>{assert.equal(init?.redirect,'manual');return new Response(null,{status,headers:{location:'https://foreign.test/doc'}});};
  await assert.rejects(readAgentNativeDocument(api,ORIGIN,'project','node',redirected),/не отдало/);
  await assert.rejects(saveAgentNativeDocument(api,ORIGIN,'project','node',HEAD,snapshot,redirected),/не приняло/);
  assert.equal(state.saves,0);
 }
});

const sheet={format:'cloudflareos.spreadsheet',formatVersion:1,document:{title:'Бюджет',dateSystem:'1900',sheetOrder:['s1'],sheets:{s1:{id:'s1',name:'План',rows:100,cols:26,colWidths:{},rowHeights:{},frozenRows:0,frozenCols:0,merges:[]}},cells:{s1:{A1:{value:'=SUM(B1:B2)',fmt:null,version:1},B1:{value:'10',fmt:{b:true},version:1}}}}};
const deck={format:'cloudflareos.presentation',formatVersion:1,document:{themeVersion:'workspace.1',revision:1,lastModified:1,title:'План',slides:[{id:'slide',background:{color:'#154F3B'},blocks:[{id:'heading',type:'title',x:20,y:30,w:400,props:{text:'Цель',fontSize:40}}]}]}};
for(const source of [sheet,deck])test(source.format+' заполняется без потери оформления и не меняет формат узла',async()=>{
 const {api,state,fetcher}=fixture(source);const read=await readAgentNativeDocument(api,ORIGIN,'project','node',fetcher);const doc=read.snapshot.document as any;
 if(source===sheet){doc.cells.s1.B1.value='42';doc.cells.s1.B2={value:'8',fmt:null,version:1};}else doc.slides[0].blocks[0].props.text='Запуск сервиса';
 await saveAgentNativeDocument(api,ORIGIN,'project','node',read.head,read.snapshot,fetcher);const saved=JSON.parse(state.uploaded);
 if(source===sheet){assert.equal(saved.document.cells.s1.A1.value,'=SUM(B1:B2)');assert.equal(saved.document.cells.s1.B1.value,'42');assert.deepEqual(saved.document.cells.s1.B1.fmt,{b:true});assert.deepEqual(saved.document.sheets,source.document.sheets);}else{assert.equal(saved.document.slides[0].blocks[0].props.text,'Запуск сервиса');assert.deepEqual(saved.document.slides[0].background,source.document.slides[0].background);assert.equal(saved.document.slides[0].blocks[0].props.fontSize,40);}
 const other=fixture(source);await assert.rejects(saveAgentNativeDocument(other.api,ORIGIN,'project','node',HEAD,snapshot,other.fetcher),/менять формат/);assert.equal(other.state.uploads,0);
});
test('повреждённые таблицы и презентации отклоняются валидаторами редакторов до выгрузки',async()=>{
 const badSheet=structuredClone(sheet);badSheet.document.cells.s1.A1.value=42 as any;
 const badDeck=structuredClone(deck);badDeck.document.slides[0].blocks[0].x=NaN;
 for(const source of [badSheet,badDeck]){const {api,state,fetcher}=fixture(source);await assert.rejects(saveAgentNativeDocument(api,ORIGIN,'project','node',HEAD,source as any,fetcher));assert.equal(state.uploads,0);}
});
test('MIME скачанного снимка должен совпасть с узлом',async()=>{const {api,state,fetcher}=fixture(sheet);state.mime='application/vnd.cloudflareos.presentation+json';await assert.rejects(readAgentNativeDocument(api,ORIGIN,'project','node',fetcher),/не совпал/);});
