import {withDraftAudit,type DraftAuditEvent} from './draft-audit.ts';
import {outgoingMailAttachments,type MailOutgoingAttachment} from '@gadgets/workshop-shared/mail-attachment';
import type {AccountStorage} from './account-session.ts';
import {validateMailReply, mailReplySubject, type MailReplyTarget} from '@gadgets/workshop-shared/mail-reply';

/** Trusted coordinates resolved from the connection and authenticated agent. */
export interface MailDraftContext {
 tenant:string;owner:string;epoch:string;connection:string;agent:string;
}
/** Plain-text outgoing proposal, not a provider-side draft or permission to send. */
export interface MailDraftContent {to:string[];cc?:string[];attachments?:MailOutgoingAttachment[];subject:string;body:string;reply_id?:string;reply?:MailReplyTarget;}
/** Immutable content and the owner's decision against its exact digest. */
export interface MailDraft {
 /** Internal durable delivery history; omitted from human review projections. */
 audit_events?:DraftAuditEvent[];
 id:string;request:string;context:MailDraftContext;content:MailDraftContent;sha256:string;
 state:'pending'|'approved'|'rejected';
 delivery?:{state:'attempted'|'accepted';message_id?:string};
}
function coordinate(value:unknown){if(typeof value!=='string'||!value||value.length>255||/[\x00-\x20\x7f]/.test(value))throw Error('Invalid mail draft coordinates.');}
async function normalize(input:MailDraftContent,reply?:MailReplyTarget):Promise<MailDraftContent>{
 if(!input||Object.keys(input).some(key=>!['to','cc','subject','body','reply_id','attachments'].includes(key))||!Array.isArray(input.to)||input.to.length<1||input.to.length>100||input.cc!==undefined&&(!Array.isArray(input.cc)||input.to.length+input.cc.length>100))throw Error('Invalid mail draft.');
 if(input.reply_id!==undefined){if(typeof input.reply_id!=='string'||!/^[a-f0-9-]{36}$/.test(input.reply_id)||!reply)throw Error('Read the source message before replying.');validateMailReply(reply);if(input.subject!==mailReplySubject(reply.subject))throw Error('Keep the source subject when replying.');}
 else if(reply)throw Error('Reply source changed.');
 const recipients=[...input.to,...(input.cc??[])].map(value=>{
  if(typeof value!=='string'||value.length>254||!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(value))throw Error('Use plain email addresses for mail recipients.');
  const [local,domain]=value.split('@');if(local.length>64||local.startsWith('.')||local.endsWith('.')||local.includes('..')||domain.split('.').some(label=>!label||label.length>63||label.startsWith('-')||label.endsWith('-')))throw Error('Invalid mail recipient.');
  return local+'@'+domain.toLowerCase();
 });
 const to=recipients.slice(0,input.to.length),cc=recipients.slice(input.to.length);
 if(new Set(recipients.map(value=>value.toLowerCase())).size!==recipients.length||typeof input.subject!=='string'||!input.subject.trim()||/[\r\n\0]/.test(input.subject)||new TextEncoder().encode(input.subject).length>998||typeof input.body!=='string'||input.body.includes('\0')||new TextEncoder().encode(input.body).length>256*1024)throw Error('Invalid mail draft.');
 const attachments=await outgoingMailAttachments(input.attachments);
 return {to,...(attachments.length?{attachments}:{}),...(cc.length?{cc}:{}),subject:input.subject,body:input.body,...(reply?{reply_id:input.reply_id,reply:structuredClone(reply)}:{})};
}
async function hash(value:unknown){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(x=>x.toString(16).padStart(2,'0')).join('');}
/** Private durable queue. Callers supply trusted context and revalidate current
 * connection/agent rights; only a human account path may call decide(). */
export class MailDrafts {
 #storage:AccountStorage;
 constructor(storage:AccountStorage){this.#storage=storage;}
 #put(draft:MailDraft){
  const key='mailDraft:'+draft.id;
  const phase=draft.delivery?.state??(draft.state==='pending'?'staged':draft.state);
  const previous=this.#storage.get<MailDraft>(key);
  const previousPhase=previous?previous.delivery?.state??(previous.state==='pending'?'staged':previous.state):undefined;
  const saved=previous&&previousPhase===phase?{...draft,audit_events:previous.audit_events}:withDraftAudit(draft,'mail',phase,previous);
  // Canonical state and its events are one durable value. The request key is
  // only an index; reads resolve it back to this canonical record.
  this.#storage.put(key,saved);
  this.#storage.put('mailDraftRequest:'+JSON.stringify([draft.context.epoch,draft.context.connection,draft.context.agent,draft.request]),saved);
  return saved;
 }
 /** Internal execution requires separate send authority for this connection. */
 async dispatch(id:string,owner:Pick<MailDraftContext,'tenant'|'owner'|'epoch'>,sha256:string,validate:()=>Promise<void>,send:(content:MailDraftContent,request:string)=>Promise<{accepted?:true;message_id?:string}>):Promise<MailDraft>{
  const shown=await this.read(id,owner,validate);
  if(shown.sha256!==sha256||shown.state!=='approved')throw Error('Approve the exact mail draft before sending.');
  await validate();
  const current=this.#storage.get<MailDraft>('mailDraft:'+id);
  if(!current||current.sha256!==sha256||current.context.epoch!==owner.epoch||current.context.owner!==owner.owner||current.context.tenant!==owner.tenant||current.state!=='approved')throw Error('Mail draft changed.');
  if(current.delivery?.state==='accepted')return structuredClone(current);
  if(current.delivery)throw Error('Mail send outcome is unconfirmed. Check the mailbox before preparing another draft.');
  // Persist before IO. Uncertain outcomes never authorize an automatic resend.
  const attempted:MailDraft={...current,delivery:{state:'attempted'}};
  this.#put(attempted);
  let receipt:{accepted?:true;message_id?:string};
  try{receipt=await send(structuredClone(current.content),current.id);if(receipt?.message_id!==undefined)coordinate(receipt.message_id);else if(receipt?.accepted!==true)throw Error('Invalid provider acceptance.');}catch{throw Error('Mail send outcome is unconfirmed. Check the mailbox before preparing another draft.');}
  const accepted:MailDraft={...attempted,delivery:{state:'accepted',...(receipt.message_id===undefined?{}:{message_id:receipt.message_id})}};
  const saved=this.#put(accepted);
  await validate();return structuredClone(saved);
 }
 async stage(context:MailDraftContext,request:string,input:MailDraftContent,validate:()=>Promise<void>,reply?:MailReplyTarget):Promise<MailDraft>{
  for(const value of [context.tenant,context.owner,context.epoch,context.connection,context.agent,request])coordinate(value);
  const trusted=structuredClone(context),content=await normalize(structuredClone(input),reply),sha256=await hash({context:trusted,content});
  const key='mailDraftRequest:'+JSON.stringify([trusted.epoch,trusted.connection,trusted.agent,request]);
  await validate();
  const indexed=this.#storage.get<MailDraft>(key);
  const previous=indexed?(this.#storage.get<MailDraft>('mailDraft:'+indexed.id)??indexed):undefined;
  if(previous){if(previous.sha256!==sha256)throw Error('Mail draft request changed. Use a new request.');return structuredClone(previous);}
  const draft:MailDraft={id:crypto.randomUUID(),request,context:trusted,content,sha256,state:'pending'};
  return structuredClone(this.#put(draft));
 }
 async read(id:string,owner:Pick<MailDraftContext,'tenant'|'owner'|'epoch'>,validate:()=>Promise<void>):Promise<MailDraft>{
  coordinate(id);await validate();
  const draft=this.#storage.get<MailDraft>('mailDraft:'+id);
  if(!draft||draft.context.tenant!==owner.tenant||draft.context.owner!==owner.owner||draft.context.epoch!==owner.epoch)throw Error('Mail draft unavailable.');
  return structuredClone(draft);
 }
 async decide(id:string,owner:Pick<MailDraftContext,'tenant'|'owner'|'epoch'>,sha256:string,approved:boolean,validate:()=>Promise<void>):Promise<MailDraft>{
  if(typeof approved!=='boolean'||typeof sha256!=='string'||!/^[a-f0-9]{64}$/.test(sha256))throw Error('Invalid mail draft decision.');
  await this.read(id,owner,validate);await validate();
  // Re-read after asynchronous validation: concurrent decisions cannot overwrite.
  const draft=this.#storage.get<MailDraft>('mailDraft:'+id);
  if(!draft||draft.context.tenant!==owner.tenant||draft.context.owner!==owner.owner||draft.context.epoch!==owner.epoch||draft.sha256!==sha256)throw Error('Mail draft changed.');
  const state=approved?'approved':'rejected';
  if(draft.state!=='pending'&&draft.state!==state)throw Error('Mail draft already decided.');
  const result:MailDraft={...draft,state};
  return structuredClone(this.#put(result));
 }
}

/** Human review projection; private account epoch is never returned to the UI. */
export interface MailDraftReview {id:string;connection_id:string;agent_id:string;content:MailDraftContent;sha256:string;state:MailDraft['state'];delivery?:MailDraft['delivery'];}
/** Owner-only UI methods. Approval records a decision, not delivery. */
export interface MailDraftManagement {
 listMailDrafts(connection:string,cursor?:string):Promise<MailDraftPage>;
 readMailDraft(id:string):Promise<MailDraftReview>;
 decideMailDraft(id:string,sha256:string,approved:boolean):Promise<MailDraftReview>;
}
export function mailDraftReview(draft:MailDraft):MailDraftReview{return {id:draft.id,connection_id:draft.context.connection,agent_id:draft.context.agent,content:structuredClone(draft.content),sha256:draft.sha256,state:draft.state,...(draft.delivery?{delivery:structuredClone(draft.delivery)}:{})};}

/** A bounded page of proposals for one owner and connection, without message bodies. */
export interface MailDraftPage {
 drafts:Array<Pick<MailDraftReview,'id'|'agent_id'|'state'> & {subject:string}>;
 next_cursor?:string;
}
/** Scans existing durable records, including drafts created before list support. */
export async function listMailDrafts(storage:{list<T>(options:{prefix:string;limit:number;startAfter?:string}):Iterable<[string,T]>},owner:Pick<MailDraftContext,'tenant'|'owner'|'epoch'>,connection:string,cursor:string,validate:()=>Promise<void>):Promise<MailDraftPage>{
 coordinate(connection);
 if(typeof cursor!=='string'||cursor!==''&&!/^mailDraft:[a-f0-9-]{36}$/.test(cursor))throw Error('Invalid mail draft cursor.');
 await validate();
 const rows=[...storage.list<MailDraft>({prefix:'mailDraft:',limit:51,...(cursor?{startAfter:cursor}:{})})];
 const page=rows.slice(0,50);
 const drafts=page.filter(([,draft])=>draft.context.tenant===owner.tenant&&draft.context.owner===owner.owner&&draft.context.epoch===owner.epoch&&draft.context.connection===connection)
  .map(([,draft])=>({id:draft.id,agent_id:draft.context.agent,state:draft.state,subject:draft.content.subject}));
 await validate();
 return {drafts,...(rows.length>50?{next_cursor:page.at(-1)![0]}:{})};
}
