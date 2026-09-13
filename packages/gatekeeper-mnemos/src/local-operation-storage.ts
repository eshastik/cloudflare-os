import {createHash} from 'node:crypto';
import type {AccountStorage} from './account-session.ts';
import {storedAccountOwner} from './account-identity.ts';
import type {ConnectionAuditEvent} from './connection-audit-storage.ts';

const families = ['corporateTaskCreation','corporateUpdate','corporateWorkflowCreation','driveImportCapture',
 'resourceMapCreation','resourceMapEdit','teamDocumentCreation','trackerCreation','trackerEdit','mnemosTaskHistory','reindexRequest','reindexBatch','reindexBatchChunk','centroidRequest',
 'voiceUpload','voiceBudget','voiceCommandBudget','telegramVoice','telegramVoiceTransfer','telegramVoiceSettings'] as const;
/** Only canonical operation records are audited; derived indexes pass through. */
export function localOperationKind(key:string):string|undefined {
 if(/^telegramDelivery:[^:]+:job:[0-9]+$/.test(key))return 'telegramDeliveryJob';
 if(/^telegramInbox:[0-9]+:[^:]+:update:[0-9]+$/.test(key))return 'telegramMessageIntent';
 if(['gitRegistrations','mnemosManagedTaskRequest','mnemosManagedAgentRequest'].includes(key))return key;
 return families.find(kind=>key.startsWith(kind+':'));
}
interface Envelope {
 mnemos_local_operation:1; present:boolean; value?:unknown; audit_account_id:string;
 owner:{tenant:string;user:string}; connection_audit:ConnectionAuditEvent[];
}
interface Storage extends AccountStorage {list?<T>(options:{prefix:string;startAfter?:string;limit:number}):Iterable<[string,T]>}
// Tagged values distinguish missing, null, arrays and objects. Object order is irrelevant.
function canonical(value:unknown,depth=0):unknown {
 if(depth>64)throw Error('Local operation state too deep');
 if(value===undefined)return ['undefined'];
 if(value===null)return ['null'];
 if(typeof value==='string'||typeof value==='boolean')return [typeof value,value];
 if(typeof value==='number'&&Number.isFinite(value))return ['number',Object.is(value,-0)?'-0':String(value)];
 if(Array.isArray(value))return ['array',Array.from(value,item=>canonical(item,depth+1))];
 if(value&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype&&Object.getOwnPropertySymbols(value).length===0)
  return ['object',Object.keys(value).sort().map(key=>[key,canonical((value as Record<string,unknown>)[key],depth+1)])];
 throw Error('Unsupported local operation state');
}
function digest(value:unknown){return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');}
function envelope(value:unknown):value is Envelope{return !!value&&typeof value==='object'&&'mnemos_local_operation' in value&&value.mnemos_local_operation===1;}
/** State and pending history share one canonical KV write. Reads expose only the
 * original value, including during legacy migration and after queue pruning. */
export class LocalOperationStorage implements Storage {
 /** Bot DOs resolve their trusted account owner from the canonical connection. */
 constructor(private storage:Storage,private sink:AccountStorage,private owner=()=>storedAccountOwner(storage),readonly transactionSync?:<T>(callback:()=>T)=>T){}
 get<T>(key:string):T|undefined {
  const saved=this.storage.get<unknown>(key);
  if(!localOperationKind(key)||!envelope(saved))return saved as T|undefined;
  this.checkOwner(saved);return saved.present?structuredClone(saved.value) as T:undefined;
 }
 put<T>(key:string,value:T):void {if(!localOperationKind(key)){this.sink.put(key,value);return;}this.save(key,true,value);}
 delete(key:string):void {if(!localOperationKind(key)){this.sink.delete(key);return;}this.save(key,false);}
 *list<T>(options:{prefix:string;startAfter?:string;limit?:number}):Iterable<[string,T]>{
  if(!this.storage.list)throw Error('Local operation listing unavailable');
  let cursor=options.startAfter,count=0;const limit=options.limit??1000;
  while(count<limit){
   const rows=[...this.storage.list<unknown>({...options,startAfter:cursor,limit:limit-count})];
   if(!rows.length)return;
   for(const [key] of rows){cursor=key;const value=this.get<T>(key);if(value!==undefined){yield [key,value];count++;}}
  }
 }
 private checkOwner(saved:Envelope){const owner=this.owner();if(!owner||owner.tenant!==saved.owner.tenant||owner.user!==saved.owner.user)throw Error('Local operation owner changed');}
 private save(key:string,present:boolean,value?:unknown){
  const owner=this.owner();if(!owner)throw Error('Local operation owner unavailable');
  const previous=this.storage.get<unknown>(key);if(envelope(previous))this.checkOwner(previous);
  const before=envelope(previous)?[previous.present,previous.value]:[previous!==undefined,previous];
  const after=[present,present?value:undefined],beforeHash=digest(before),afterHash=digest(after);
  if(beforeHash===afterHash)return;
  const events=envelope(previous)?previous.connection_audit:[];
  if(events.length>= (present?127:128))throw Error('Local operation audit delivery backlog full');
  const id=envelope(previous)?previous.audit_account_id:crypto.randomUUID();
  const event:ConnectionAuditEvent={event_id:crypto.randomUUID(),protocol:'local-operation',account_id:id,
   tenant_id:owner.tenant,owner_id:owner.user,phase:present?'saved':'deleted',observed_at:new Date().toISOString(),
   operation_kind:localOperationKind(key)!,resource_sha256:digest(key),before_sha256:beforeHash,after_sha256:afterHash};
  this.sink.put(key,{mnemos_local_operation:1,present,...(present?{value:structuredClone(value)}:{}),owner,
   audit_account_id:id,connection_audit:[...events,event]} satisfies Envelope);
 }
}
