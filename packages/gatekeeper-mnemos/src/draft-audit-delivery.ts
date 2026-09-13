import type {AccountStorage} from './account-session.ts';
import type {DraftAuditEvent} from './draft-audit.ts';

/** Delivery of saved events only. This object has no mail/calendar write
 * capability, so retries cannot repeat a provider effect. Destination and
 * service credential must come from trusted installation configuration. */
export class DraftAuditDelivery {
 #storage:AccountStorage;
 #origin:string;
 #credential:string;
 #fetch:typeof fetch;
 constructor(storage:AccountStorage,origin:string,credential:string,request:typeof fetch=fetch){
  const url=new URL(origin);
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/'||credential.length<32||credential.length>1024||/[\r\n]/.test(credential))throw Error('Draft audit delivery unavailable.');
  this.#storage=storage;this.#origin=url.origin;this.#credential=credential;this.#fetch=request;
 }
 async deliver(kind:'mail'|'calendar',events:readonly DraftAuditEvent[]):Promise<void>{
  if(events.length>4)throw Error('Draft audit history unavailable.');
  for(const event of events){
   if(event.kind!==kind||event.event_id!==`${kind}:${event.draft_id}:${event.phase}`)throw Error('Draft audit event unavailable.');
   const key='draftAuditAck:'+JSON.stringify([this.#origin,event.tenant_id,event.event_id]);
   const bytes=JSON.stringify(event),previous=this.#storage.get<string>(key);
   if(previous!==undefined){if(previous!==bytes)throw Error('Draft audit event changed.');continue;}
   const response=await this.#fetch.call(globalThis,this.#origin+'/v1/internal/draft-audit/'+kind,{method:'POST',headers:{'Authorization':'Bearer '+this.#credential,'Content-Type':'application/json'},body:bytes,redirect:'manual',signal:AbortSignal.timeout(10000)});
   if(response.status!==200){await response.body?.cancel();throw Error('Draft audit delivery not confirmed.');}
   // Bound the receipt before parsing; a bridge never needs arbitrary response data.
   const reader=response.body?.getReader();if(!reader)throw Error('Draft audit receipt unavailable.');
   let text='';const decoder=new TextDecoder();let size=0;
   try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>2048)throw Error('Draft audit receipt unavailable.');text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}finally{await reader.cancel();reader.releaseLock();}
   let receipt:unknown;try{receipt=JSON.parse(text);}catch{throw Error('Draft audit receipt unavailable.');}
   if(!receipt||typeof receipt!=='object'||Object.keys(receipt).length!==1||!('event_id' in receipt)||receipt.event_id!==event.event_id)throw Error('Draft audit receipt mismatch.');
   this.#storage.put(key,bytes);
  }
 }
}
