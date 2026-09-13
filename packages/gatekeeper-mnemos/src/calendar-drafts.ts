import {withDraftAudit,type DraftAuditEvent} from './draft-audit.ts';
import type {CalendarDraftContent,CalendarDraftExecution} from '@gadgets/workshop-shared/calendar-draft';
import type {AccountStorage} from './account-session.ts';

/** Trusted coordinates resolved from the connection and authenticated agent. */
export interface CalendarDraftContext {
 tenant:string;owner:string;epoch:string;connection:string;agent:string;
}
/** A timed meeting proposal; start/end are instants, never floating local times. */
export type {CalendarDraftContent} from '@gadgets/workshop-shared/calendar-draft';
/** Immutable content and the owner's decision against its exact digest. */
export interface CalendarDraft {
 /** Internal durable delivery history; omitted from human review projections. */
 audit_events?:DraftAuditEvent[];
 id:string;request:string;context:CalendarDraftContext;content:CalendarDraftContent;sha256:string;
 state:'pending'|'approved'|'rejected';
 execution?:CalendarDraftExecution;
}
function coordinate(value:unknown){if(typeof value!=='string'||!value||value.length>255||/[\x00-\x20\x7f]/.test(value))throw Error('Invalid calendar draft coordinates.');}
function instant(value:string):string{
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value))throw Error('Calendar time requires RFC3339 with an offset.');
 const [year,month,day,hour,minute,second]=value.slice(0,19).split(/[-T:]/).map(Number);
 const dayCheck=new Date(0);dayCheck.setUTCFullYear(year,month-1,day);dayCheck.setUTCHours(0,0,0,0);
 const offset=/([+-])(\d{2}):(\d{2})$/.exec(value);
 if(year<1||month<1||month>12||dayCheck.getUTCFullYear()!==year||dayCheck.getUTCMonth()!==month-1||dayCheck.getUTCDate()!==day||hour>23||minute>59||second>59||offset&&(Number(offset[2])>23||Number(offset[3])>59))throw Error('Invalid calendar time.');
 const timestamp=Date.parse(value);if(!Number.isFinite(timestamp))throw Error('Invalid calendar time.');return new Date(timestamp).toISOString();
}
function normalize(input:CalendarDraftContent):CalendarDraftContent{
 if(!input||Object.keys(input).length!==6||Object.keys(input).some(key=>!['title','start','end','description','location','attendees'].includes(key)))throw Error('Invalid calendar draft.');
 for(const [key,limit] of [['title',998],['description',16384],['location',1024]] as const){if(typeof input[key]!=='string'||input[key].includes('\0')||new TextEncoder().encode(input[key]).length>limit)throw Error('Invalid calendar text.');}
 if(!input.title.trim()||/[\r\n]/.test(input.title)||!Array.isArray(input.attendees)||input.attendees.length>100)throw Error('Invalid calendar draft.');
 const attendees=input.attendees.map(value=>{if(typeof value!=='string'||value.length>254||!/^[^\s<>@]+@[^\s<>@]+$/.test(value)||/[\x00-\x1f\x7f]/.test(value))throw Error('Use plain email addresses for attendees.');const at=value.lastIndexOf('@');return value.slice(0,at+1)+value.slice(at+1).toLowerCase();});
 if(new Set(attendees).size!==attendees.length)throw Error('Duplicate attendee.');
 const start=instant(input.start),end=instant(input.end),duration=Date.parse(end)-Date.parse(start);
 if(duration<=0||duration>366*86400000)throw Error('Invalid event duration.');
 return {title:input.title,start,end,description:input.description,location:input.location,attendees};
}
async function hash(value:unknown){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(x=>x.toString(16).padStart(2,'0')).join('');}
/** Private durable queue. Callers supply trusted context and revalidate current
 * connection/agent rights; only a human account path may call decide(). */
export class CalendarDrafts {
 #storage:AccountStorage;
 constructor(storage:AccountStorage){this.#storage=storage;}
 #put(draft:CalendarDraft){
  const key='calendarDraft:'+draft.id;
  const phase=draft.execution?.state??(draft.state==='pending'?'staged':draft.state);
  const previous=this.#storage.get<CalendarDraft>(key);
  const previousPhase=previous?previous.execution?.state??(previous.state==='pending'?'staged':previous.state):undefined;
  const saved=previous&&previousPhase===phase?{...draft,audit_events:previous.audit_events}:withDraftAudit(draft,'calendar',phase,previous);
  // Canonical state and its events are one durable value. The request key is
  // only an index; reads resolve it back to this canonical record.
  this.#storage.put(key,saved);
  this.#storage.put('calendarDraftRequest:'+JSON.stringify([draft.context.epoch,draft.context.connection,draft.context.agent,draft.request]),saved);
  return saved;
 }
 /** Internal execution needs separate provider write authority for the saved selection. */
 async dispatch(id:string,owner:Pick<CalendarDraftContext,'tenant'|'owner'|'epoch'>,sha256:string,validate:()=>Promise<void>,create:(content:CalendarDraftContent)=>Promise<{event_id:string}>):Promise<CalendarDraft>{
  const shown=await this.read(id,owner,validate);
  if(shown.sha256!==sha256||shown.state!=='approved')throw Error('Approve the exact meeting before creating it.');
  await validate();const current=this.#storage.get<CalendarDraft>('calendarDraft:'+id);
  if(!current||current.sha256!==sha256||current.context.tenant!==owner.tenant||current.context.owner!==owner.owner||current.context.epoch!==owner.epoch||current.state!=='approved')throw Error('Calendar draft changed.');
  if(current.execution?.state==='created')return structuredClone(current);
  if(current.execution)throw Error('Calendar creation outcome is unconfirmed. Check the calendar before proposing another meeting.');
  const attempted:CalendarDraft={...current,execution:{state:'attempted'}};this.#put(attempted);
  let result:{event_id:string};try{result=await create(structuredClone(current.content));coordinate(result?.event_id);}catch{throw Error('Calendar creation outcome is unconfirmed. Check the calendar before proposing another meeting.');}
  const created:CalendarDraft={...attempted,execution:{state:'created',event_id:result.event_id}};const saved=this.#put(created);await validate();return structuredClone(saved);
 }
 async stage(context:CalendarDraftContext,request:string,input:CalendarDraftContent,validate:()=>Promise<void>):Promise<CalendarDraft>{
  for(const value of [context.tenant,context.owner,context.epoch,context.connection,context.agent,request])coordinate(value);
  const trusted=structuredClone(context),content=normalize(input),sha256=await hash({context:trusted,content});
  const key='calendarDraftRequest:'+JSON.stringify([trusted.epoch,trusted.connection,trusted.agent,request]);
  await validate();
  const indexed=this.#storage.get<CalendarDraft>(key);
  const previous=indexed?(this.#storage.get<CalendarDraft>('calendarDraft:'+indexed.id)??indexed):undefined;
  if(previous){if(previous.sha256!==sha256)throw Error('Calendar draft request changed. Use a new request.');return structuredClone(previous);}
  const draft:CalendarDraft={id:crypto.randomUUID(),request,context:trusted,content,sha256,state:'pending'};
  return structuredClone(this.#put(draft));
 }
 async read(id:string,owner:Pick<CalendarDraftContext,'tenant'|'owner'|'epoch'>,validate:()=>Promise<void>):Promise<CalendarDraft>{
  coordinate(id);await validate();
  const draft=this.#storage.get<CalendarDraft>('calendarDraft:'+id);
  if(!draft||draft.context.tenant!==owner.tenant||draft.context.owner!==owner.owner||draft.context.epoch!==owner.epoch)throw Error('Calendar draft unavailable.');
  return structuredClone(draft);
 }
 async decide(id:string,owner:Pick<CalendarDraftContext,'tenant'|'owner'|'epoch'>,sha256:string,approved:boolean,validate:()=>Promise<void>):Promise<CalendarDraft>{
  if(typeof approved!=='boolean'||typeof sha256!=='string'||!/^[a-f0-9]{64}$/.test(sha256))throw Error('Invalid calendar draft decision.');
  await this.read(id,owner,validate);await validate();
  // Re-read after asynchronous validation: concurrent decisions cannot overwrite.
  const draft=this.#storage.get<CalendarDraft>('calendarDraft:'+id);
  if(!draft||draft.context.tenant!==owner.tenant||draft.context.owner!==owner.owner||draft.context.epoch!==owner.epoch||draft.sha256!==sha256)throw Error('Calendar draft changed.');
  const state=approved?'approved':'rejected';
  if(draft.state!=='pending'&&draft.state!==state)throw Error('Calendar draft already decided.');
  const result:CalendarDraft={...draft,state};
  return structuredClone(this.#put(result));
 }
}

/** Human review projection; private account epoch is never returned to the UI. */
export interface CalendarDraftReview {id:string;connection_id:string;agent_id:string;content:CalendarDraftContent;sha256:string;state:CalendarDraft['state'];execution?:CalendarDraftExecution;}
/** Owner-only UI methods. Approval records a decision; it does not create a provider event. */
export interface CalendarDraftManagement {
 listCalendarDrafts(connection:string,cursor?:string):Promise<CalendarDraftPage>;
 readCalendarDraft(id:string):Promise<CalendarDraftReview>;
 decideCalendarDraft(id:string,sha256:string,approved:boolean):Promise<CalendarDraftReview>;
}
export function calendarDraftReview(draft:CalendarDraft):CalendarDraftReview{return {id:draft.id,connection_id:draft.context.connection,agent_id:draft.context.agent,content:structuredClone(draft.content),sha256:draft.sha256,state:draft.state,...(draft.execution?{execution:structuredClone(draft.execution)}:{})};}

/** A bounded page of proposals for one owner and connection, without message bodies. */
export interface CalendarDraftPage {
 drafts:Array<Pick<CalendarDraftReview,'id'|'agent_id'|'state'> & {title:string}>;
 next_cursor?:string;
}
/** Scans existing durable records, including drafts created before list support. */
export async function listCalendarDrafts(storage:{list<T>(options:{prefix:string;limit:number;startAfter?:string}):Iterable<[string,T]>},owner:Pick<CalendarDraftContext,'tenant'|'owner'|'epoch'>,connection:string,cursor:string,validate:()=>Promise<void>):Promise<CalendarDraftPage>{
 coordinate(connection);
 if(typeof cursor!=='string'||cursor!==''&&!/^calendarDraft:[a-f0-9-]{36}$/.test(cursor))throw Error('Invalid calendar draft cursor.');
 await validate();
 const rows=[...storage.list<CalendarDraft>({prefix:'calendarDraft:',limit:51,...(cursor?{startAfter:cursor}:{})})];
 const page=rows.slice(0,50);
 const drafts=page.filter(([,draft])=>draft.context.tenant===owner.tenant&&draft.context.owner===owner.owner&&draft.context.epoch===owner.epoch&&draft.context.connection===connection)
  .map(([,draft])=>({id:draft.id,agent_id:draft.context.agent,state:draft.state,title:draft.content.title}));
 await validate();
 return {drafts,...(rows.length>50?{next_cursor:page.at(-1)![0]}:{})};
}
