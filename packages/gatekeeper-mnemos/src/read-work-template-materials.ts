import {checkedTemplateReferences,type WorkTemplateMaterial,type WorkTemplateReference} from '@gadgets/workshop-shared/work-template';
import {mnemosNodeFormatOfMime} from '@gadgets/workshop-shared/native-document';
import type {MnemosAccountSession} from './account-session.ts';

const MAX_MATERIAL_BYTES=1024*1024;
const MAX_SELECTION_BYTES=4*MAX_MATERIAL_BYTES;

/** Читает весь набор из хранилища и повторно проверяет права перед выдачей агенту. */
export async function readWorkTemplateMaterials(
 session:Pick<MnemosAccountSession,'readWorkTemplateSelection'|'beginWorkTemplateDownload'>,
 storageOrigin:string,references:WorkTemplateReference[],fetcher:typeof fetch=fetch,
):Promise<{materials:WorkTemplateMaterial[]}>{
 const refs=checkedTemplateReferences(references);
 const origin=new URL(storageOrigin);
 if(origin.protocol!=='https:'||origin.origin!==storageOrigin||origin.username||origin.password)throw new Error('Некорректный адрес хранилища Mnemos.');
 const selected=await session.readWorkTemplateSelection(refs);
 const sources=selected.materials.map(m=>m.personal??m.scoped!.source);
 if(sources.some(source=>!['text/plain','text/markdown'].includes(source.content_type)&&!['cloudflareos.document','cloudflareos.spreadsheet','cloudflareos.presentation'].includes(mnemosNodeFormatOfMime(source.content_type)??'')))throw new Error('Формат выбранного шаблона пока не поддерживается. Выберите текстовую методику или нативную форму.');
 const materials:WorkTemplateMaterial[]=[];let total=0;
 const signal=AbortSignal.timeout(30_000);
 for(const [index,reference] of refs.entries()){
  const source=sources[index];
  const issued=await session.beginWorkTemplateDownload(reference);const ticket=issued.ticket;
  if(issued.source.source_head!==source.source_head||issued.source.content_type!==source.content_type||ticket.head!==source.source_head||ticket.node_id!==source.node_id||ticket.content_type!==source.content_type||ticket.method!=='GET'||!Number.isSafeInteger(ticket.size_bytes)||ticket.size_bytes<0||ticket.size_bytes>MAX_MATERIAL_BYTES||!Number.isFinite(Date.parse(ticket.expires_at))||Date.parse(ticket.expires_at)<=Date.now())throw new Error('Mnemos не подтвердил точный снимок шаблона.');
  total+=ticket.size_bytes;if(total>MAX_SELECTION_BYTES)throw new Error('Набор шаблонов превышает четыре МиБ.');
  const target=new URL(ticket.url);
  if(target.origin!==storageOrigin||target.username||target.password||target.hash)throw new Error('Содержимое шаблона находится вне хранилища Mnemos.');
  const response=await fetcher(target.href,{method:'GET',redirect:'error',signal});
  if(response.status!==200)throw new Error('Хранилище не отдало точный снимок шаблона.');
  const data=await readBounded(response,ticket.size_bytes);
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),b=>b.toString(16).padStart(2,'0')).join('');
  if(hash!==ticket.sha256_hex)throw new Error('Контрольная сумма шаблона не совпала.');
  const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(data);
  const format=mnemosNodeFormatOfMime(source.content_type);
  let content:WorkTemplateMaterial['content'];
  if(format){
   const snapshot=JSON.parse(text);
   if(!snapshot||snapshot.format!==format||snapshot.formatVersion!==1||!snapshot.document||typeof snapshot.document!=='object'||Array.isArray(snapshot.document)||Object.keys(snapshot).some(k=>!['format','formatVersion','document'].includes(k)))throw new Error('Нативный снимок шаблона повреждён.');
   content={type:'native',snapshot};
  }else content={type:'text',text};
  materials.push({reference,title:source.title,purpose:source.purpose,kind:source.kind,sourceHead:source.source_head,contentType:source.content_type,content});
 }
 const current=await session.readWorkTemplateSelection(refs);
 current.materials.forEach((m,index)=>{const source=m.personal??m.scoped!.source;if(source.source_head!==sources[index].source_head||source.content_type!==sources[index].content_type)throw new Error('Снимок шаблона изменился во время чтения.');});
 return {materials};
}

async function readBounded(response:Response,expected:number):Promise<Uint8Array>{
 if(!response.body){if(expected===0)return new Uint8Array();throw new Error('Содержимое шаблона отсутствует.');}
 const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
 try{
  for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>expected){await reader.cancel();throw new Error('Размер шаблона не совпал.');}chunks.push(value);}
 }finally{reader.releaseLock();}
 if(size!==expected)throw new Error('Содержимое шаблона неполное.');
 const result=new Uint8Array(size);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}return result;
}
