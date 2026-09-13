import {localOperationKind} from './local-operation-storage.ts';
import {recoveryKeyNames} from './recovery-key.ts';
import type {AccountStorage} from './account-session.ts';
import type {ConnectionAuditEvent} from './connection-audit-storage.ts';
interface Storage extends AccountStorage {list<T>(options:{prefix:string;limit:number;startAfter?:string}):Iterable<[string,T]>}
interface Record {id?:string;audit_account_id?:string;connection_audit?:ConnectionAuditEvent[];connection_audit_origin?:string}
interface Pending {key:string;origin:string;version:string}
const PREFIX='connectionAuditPending:';
const isConnection=(key:string)=>key==='connection'||key==='mnemosCredential'||!!localOperationKind(key)||Object.values(recoveryKeyNames).some(name=>name===key)||/^(?:(imap|caldav|webdav)Account:|(mail|calendar)SelectionRequest:)/.test(key);

/** Retries only audit delivery, never provider operations. Each pass sends at
 * most five events; a failed account cannot starve later pending accounts. */
export class ConnectionAuditQueue {
 private storage:Storage;private credential:(origin:string)=>string;private request:typeof fetch;
 constructor(storage:Storage,credential:(origin:string)=>string,request:typeof fetch=fetch){this.storage=storage;this.credential=credential;this.request=request;}
 capture(origin:string,pending:()=>void):AccountStorage {
  const url=new URL(origin);if(url.protocol!=='https:'||url.origin!==origin)throw Error('Connection audit destination unavailable.');
  return {get:<T>(key:string)=>this.storage.get<T>(key),delete:key=>this.storage.delete(key),put:<T>(key:string,value:T)=>{
   const record=value as Record;
   if(!isConnection(key)||!record?.connection_audit?.length){this.storage.put(key,value);return;}
   const pinned=this.storage.get<Record>(key)?.connection_audit_origin??origin;
   // A failed marker write must not leave a transition without retry state.
   this.storage.put(PREFIX+key,{key,origin:pinned,version:crypto.randomUUID()} satisfies Pending);
   pending();
   this.storage.put(key,{...value,connection_audit_origin:pinned});
  }};
 }
 hasPending(){return [...this.storage.list({prefix:PREFIX,limit:1})].length>0;}
 async drain():Promise<boolean>{
  const cursor=this.storage.get<string>('connectionAuditCursor');
  let items=[...this.storage.list<Pending>({prefix:PREFIX,limit:5,...(cursor?{startAfter:cursor}:{})})];
  if(!items.length&&cursor)items=[...this.storage.list<Pending>({prefix:PREFIX,limit:5})];
  let attempts=0;
  for(const [key,pending] of items){
   if(attempts>=5)break;
   try{
    const saved=this.storage.get<Record>(pending.key);
    for(const event of (saved?.connection_audit??[]).slice(0,5-attempts)){
     attempts++;
     if(saved?.connection_audit_origin!==pending.origin||!this.#matches(pending.key,saved,event))throw Error('Connection audit scope changed.');
     const bytes=JSON.stringify(event);
     await this.#deliver(pending.origin,event,bytes);
     const current=this.storage.get<Record>(pending.key);
     if(!current||current.connection_audit_origin!==pending.origin)throw Error('Connection audit state changed.');
     const observed=current.connection_audit?.find(e=>e.event_id===event.event_id);
     if(!observed||JSON.stringify(observed)!==bytes)throw Error('Connection audit event changed.');
     // Re-read after HTTP so a concurrent transition is never overwritten.
     this.storage.put(pending.key,{...current,connection_audit:current.connection_audit!.filter(e=>e.event_id!==event.event_id)});
    }
    if(!this.storage.get<Record>(pending.key)?.connection_audit?.length&&this.storage.get<Pending>(key)?.version===pending.version)this.storage.delete(key);
   }catch{/* Preserve the canonical event; retry the identical payload next pass. */}
   this.storage.put('connectionAuditCursor',key);
  }
  return this.hasPending();
 }
 #matches(key:string,record:Record,event:ConnectionAuditEvent){
  if(event.protocol==='native-creation-key'||event.protocol==='office-update-key')return key===recoveryKeyNames[event.protocol]&&record.audit_account_id===event.account_id;
  if(event.protocol==='local-operation')return localOperationKind(key)===event.operation_kind&&record.audit_account_id===event.account_id;
  if(event.protocol==='telegram')return key==='connection'&&record.audit_account_id===event.account_id;
  if(event.protocol==='account')return key==='mnemosCredential'&&record.audit_account_id===event.account_id;
  if(event.protocol==='mail-selection'||event.protocol==='calendar-selection')return key.startsWith(event.protocol.split('-')[0]+'SelectionRequest:')&&record.id===event.account_id;
  return key===event.protocol+'Account:'+event.account_id;
 }
 async #deliver(origin:string,event:ConnectionAuditEvent,bytes:string){
  const url=new URL(origin),credential=this.credential(origin);
  if(url.protocol!=='https:'||url.origin!==origin||credential.length<32||credential.length>1024||/[\r\n]/.test(credential))throw Error('Connection audit destination unavailable.');
  const response=await this.request.call(globalThis,origin+'/v1/internal/connection-audit/'+event.protocol,{method:'POST',headers:{Authorization:'Bearer '+credential,'Content-Type':'application/json'},body:bytes,redirect:'manual',signal:AbortSignal.timeout(10000)});
  if(response.status!==200){await response.body?.cancel();throw Error('Connection audit not confirmed.');}
  const reader=response.body?.getReader();if(!reader)throw Error('Connection audit receipt unavailable.');
  const decoder=new TextDecoder();let text='',size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2048)throw Error('Connection audit receipt unavailable.');text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}finally{await reader.cancel();reader.releaseLock();}
  const receipt:unknown=JSON.parse(text);
  if(!receipt||typeof receipt!=='object'||Object.keys(receipt).length!==1||!('event_id' in receipt)||receipt.event_id!==event.event_id)throw Error('Connection audit receipt mismatch.');
 }
}
