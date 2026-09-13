import type {AccountStorage} from './account-session.ts';
import type {DraftAuditEvent} from './draft-audit.ts';
import {DraftAuditDelivery} from './draft-audit-delivery.ts';
interface QueueStorage extends AccountStorage {list<T>(options:{prefix:string;limit:number;startAfter?:string}):Iterable<[string,T]>}
interface Pending {key:string;kind:'mail'|'calendar';origin:string;version:string}
interface SavedDraft {audit_events?:DraftAuditEvent[];audit_origin?:string}
const PREFIX='draftAuditPending:';
/** Persistent retry queue for audit only; it never holds provider write authority. */
export class DraftAuditQueue {
 constructor(private storage:QueueStorage,private credential:(kind:'mail'|'calendar',origin:string)=>string,private request:typeof fetch=fetch){}
 /** Wrap trusted draft storage. Queue intent precedes canonical state so failure
  * to enqueue cannot leave an untracked state transition. */
 capture(origin:string,pending:()=>void):AccountStorage{
  const url=new URL(origin);if(url.protocol!=='https:'||url.origin!==origin)throw Error('Draft audit origin unavailable.');
  return {get:<T>(key:string)=>this.storage.get<T>(key),delete:key=>this.storage.delete(key),put:<T>(key:string,value:T)=>{
   const kind=key.startsWith('mailDraft:')?'mail':key.startsWith('calendarDraft:')?'calendar':undefined;
   const draft=value as SavedDraft;
   if(!kind||!draft?.audit_events?.length){this.storage.put(key,value);return;}
   const previous=this.storage.get<SavedDraft>(key),pinned=previous?.audit_origin??origin;
   this.storage.put(PREFIX+key,{key,kind,origin:pinned,version:crypto.randomUUID()} satisfies Pending);
   pending();
   this.storage.put(key,{...value,audit_origin:pinned});
  }};
 }
 /** Bounded round-robin delivery prevents one unavailable connection from
  * starving later events. A concurrent append retains its own pending marker. */
 hasPending(){return [...this.storage.list({prefix:PREFIX,limit:1})].length>0;}
 async drain(limit=5):Promise<boolean>{
  if(!Number.isInteger(limit)||limit<1||limit>5)throw Error('Invalid audit delivery batch.');
  const cursor=this.storage.get<string>('draftAuditCursor');
  let entries=[...this.storage.list<Pending>({prefix:PREFIX,limit,...(cursor?{startAfter:cursor}:{})})];
  if(!entries.length&&cursor)entries=[...this.storage.list<Pending>({prefix:PREFIX,limit})];
  for(const [key,item] of entries){
   try{
    const draft=this.storage.get<SavedDraft>(item.key);
    if(draft?.audit_events?.length){
     if(draft.audit_origin!==item.origin)throw Error('Draft audit origin changed.');
     await new DraftAuditDelivery(this.storage,item.origin,this.credential(item.kind,item.origin),this.request).deliver(item.kind,draft.audit_events);
    }
    if(this.storage.get<Pending>(key)?.version===item.version)this.storage.delete(key);
   }catch{/* Keep durable evidence; the next bounded pass retries only events. */}
   this.storage.put('draftAuditCursor',key);
  }
  return this.hasPending();
 }
}
