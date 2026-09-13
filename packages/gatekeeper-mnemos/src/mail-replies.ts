import {validateMailReply, mailReplySubject, type MailReplyTarget} from '@gadgets/workshop-shared/mail-reply';
import type {AccountStorage} from './account-session.ts';

interface Scope {selection:string;tenant:string;owner:string;epoch:string;}
interface Saved {scope:Scope;target:MailReplyTarget;id:string;}
/** Stores only immutable reply coordinates for messages already returned by a selected read capability. */
export class MailReplies {
 private storage:AccountStorage;
 constructor(storage:AccountStorage){this.storage=storage;}
 async capture(scope:Scope,message:Record<string,unknown>):Promise<{reply_id:string;reply_subject:string}|undefined>{
  if(typeof message.internet_message_id!=='string'||typeof message.subject!=='string'||typeof message.message_id!=='string')return;
  const refs=Array.isArray(message.references)?message.references:[];
  const target:MailReplyTarget={message_id:message.message_id,internet_message_id:message.internet_message_id,
   ...(typeof message.thread_id==='string'?{thread_id:message.thread_id}:{}),subject:message.subject,
   references:[...refs.filter((ref):ref is string=>typeof ref==='string'&&ref!==message.internet_message_id),message.internet_message_id]};
  try{validateMailReply(target);}catch{return;}
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({scope,target})));
  const key='mailReplySource:'+Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');
  let saved=this.storage.get<Saved>(key);
  if(!saved){saved={scope:structuredClone(scope),target,id:crypto.randomUUID()};this.storage.put(key,saved);}
  const address='mailReply:'+saved.id,existing=this.storage.get<Saved>(address);
  if(existing&&JSON.stringify(existing)!==JSON.stringify(saved))throw Error('Stored mail coordinates changed.');
  if(!existing)this.storage.put(address,saved);
  return {reply_id:saved.id,reply_subject:mailReplySubject(target.subject)};
 }
 resolve(scope:Scope,id:string):MailReplyTarget{
  if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id))throw Error('Reply source unavailable.');
  const saved=this.storage.get<Saved>('mailReply:'+id);
  if(!saved||Object.keys(scope).some(key=>scope[key as keyof Scope]!==saved.scope[key as keyof Scope]))throw Error('Reply source unavailable.');
  validateMailReply(saved.target);return structuredClone(saved.target);
 }
}
