import type {MnemosAccountSession} from './account-session.ts';
import type {NativeDocumentSnapshot} from '@gadgets/workshop-shared/native-document';

const MIME='application/vnd.cloudflareos.document+json';
const LIMIT=1024*1024;
type Session=Pick<MnemosAccountSession,'readDraftDocument'|'beginDraftDownload'|'checkPrivateVersionRead'|'beginNativeUpload'|'saveDraftDocument'>;

/** Принимает данные встроенного редактора документа, без кода и полномочий. */
export function checkedNativeDocument(value:unknown):NativeDocumentSnapshot{
 const snapshot=value as NativeDocumentSnapshot;
 if(!snapshot||snapshot.format!=='cloudflareos.document'||snapshot.formatVersion!==1||Object.keys(snapshot).some(key=>!['format','formatVersion','document'].includes(key)))throw new Error('Поддерживается нативная форма документа.');
 const doc=snapshot.document;
 if(!doc||Array.isArray(doc)||typeof doc.title!=='string'||!Array.isArray(doc.blocks))throw new Error('Повреждена структура документа.');
 const ids=new Set<string>();
 for(const block of doc.blocks){
  if(!block||typeof block.id!=='string'||!block.id||block.id.length>100||ids.has(block.id)||typeof block.html!=='string')throw new Error('Повреждён блок документа.');
  ids.add(block.id);
 }
 const bytes=new TextEncoder().encode(JSON.stringify(snapshot));
 if(bytes.length>LIMIT)throw new Error('Документ превышает один МиБ.');
 return structuredClone(snapshot);
}
function storageUrl(origin:string,value:string):URL{
 const base=new URL(origin),url=new URL(value);
 if(base.protocol!=='https:'||base.origin!==origin||base.username||base.password||url.origin!==origin||url.username||url.password||url.hash)throw new Error('Адрес находится вне хранилища Mnemos.');
 return url;
}
function identity(project:string,node:string){
 if([project,node].some(v=>typeof v!=='string'||!v.trim()||new TextEncoder().encode(v).length>255||v.includes('\0')))throw new Error('Некорректный проект или документ.');
}
async function current(session:Session,project:string,node:string,expectedHead?:string){
 const doc=await session.readDraftDocument(project,node);
 if(!doc.exists||doc.conflicted||doc.content_type!==MIME||!/^[a-f0-9]{64}$/.test(doc.head))throw new Error('Нативный документ недоступен или содержит конфликт.');
 if(expectedHead!==undefined&&doc.head!==expectedHead)throw new Error('Версия документа изменилась. Перечитайте её и сохраните правку заново.');
 return doc;
}

/** Читает точный личный снимок правами агента; после скачивания проверяет отзыв доступа. */
export async function readAgentNativeDocument(session:Session,origin:string,project:string,node:string,fetcher:typeof fetch=fetch){
 identity(project,node);
 const doc=await current(session,project,node);
 const ticket=await session.beginDraftDownload(project,node,doc.head,0);
 if(ticket.method!=='GET'||ticket.node_id!==node||ticket.head!==doc.head||ticket.term_index!==0||!Number.isSafeInteger(ticket.size_bytes)||ticket.size_bytes<0||ticket.size_bytes>LIMIT||!Number.isFinite(Date.parse(ticket.expires_at))||Date.parse(ticket.expires_at)<=Date.now())throw new Error('Mnemos не подтвердил точную версию документа.');
 const response=await fetcher(storageUrl(origin,ticket.url),{redirect:'error',signal:AbortSignal.timeout(20_000)});
 if(response.status!==200||!response.body)throw new Error('Хранилище не отдало документ.');
 const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
 try{
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>ticket.size_bytes){await reader.cancel();throw new Error('Размер документа не совпал.');}chunks.push(value);}
 }finally{reader.releaseLock();}
 if(size!==ticket.size_bytes)throw new Error('Документ скачан не полностью.');
 const data=new Uint8Array(size);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.length;}
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),b=>b.toString(16).padStart(2,'0')).join('');
 if(hash!==ticket.sha256_hex)throw new Error('Контрольная сумма документа не совпала.');
 const snapshot=checkedNativeDocument(JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(data)));
 await session.checkPrivateVersionRead(project,node,doc.head);
 return {project,document:node,name:doc.terms[0]?.metadata?.name??node,head:doc.head,snapshot};
}

/** Сохраняет заполненную форму личной версией; expectedHead защищает правку человека. */
export async function saveAgentNativeDocument(session:Session,origin:string,project:string,node:string,expectedHead:string,value:NativeDocumentSnapshot,fetcher:typeof fetch=fetch){
 identity(project,node);
 if(typeof expectedHead!=='string'||!/^[a-f0-9]{64}$/.test(expectedHead))throw new Error('Передайте head из readNativeDraft.');
 const snapshot=checkedNativeDocument(value);
 await current(session,project,node,expectedHead);
 const data=new TextEncoder().encode(JSON.stringify(snapshot));
 const checksum=btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256',data))));
 const ticket=await session.beginNativeUpload(project,data.length,checksum);
 const url=storageUrl(origin,ticket.url);
 if(ticket.method!=='PUT'||ticket.content_length!==data.length||ticket.checksum_header.toLowerCase()!=='x-amz-checksum-sha256'||ticket.checksum_value!==checksum)throw new Error('Mnemos не подтвердил загрузку документа.');
 const response=await fetcher(url,{method:'PUT',redirect:'error',signal:AbortSignal.timeout(20_000),headers:{[ticket.checksum_header]:checksum},body:data});
 await response.body?.cancel();
 if(!response.ok)throw new Error('Хранилище не приняло документ.');
 await current(session,project,node,expectedHead);
 const result=await session.saveDraftDocument(project,node,ticket.upload_id,expectedHead);
 if(!result||typeof result.head!=='string'||!/^[a-f0-9]{64}$/.test(result.head)||/^0+$/.test(result.head))throw new Error('Mnemos не подтвердил сохранённую версию документа. Перечитайте документ перед повтором.');
 return {project,document:node,head:result.head,status:'saved' as const};
}
