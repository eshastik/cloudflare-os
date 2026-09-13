import type {AccountStorage} from './account-session.ts';
import type {TelegramVoiceMessage} from './telegram-inbox.ts';
import {parseTelegramVoice} from './telegram-voice.ts';
interface Storage extends AccountStorage {list<T>(options:{prefix:string;limit?:number;startAfter?:string}):Iterable<[string,T]>;transactionSync?<T>(callback:()=>T):T}
export interface TelegramVoiceImport {request:string;project:string;sha256:string}
export interface TelegramVoiceIntent {request:string;channel:string;epoch:string;input:TelegramVoiceMessage;state:'pending'|'imported';received_at:number;imported?:TelegramVoiceImport}
/** Durable voice metadata, scoped to one confirmed channel epoch. No token or file URL is stored. */
export class TelegramVoiceInbox {
 #storage:Storage;#prefix:string;#channel:string;#epoch:string;#sender:number;
 constructor(storage:Storage,channel:string,epoch:string,sender:number){
  if(!channel||!epoch||!Number.isSafeInteger(sender)||sender<1)throw Error('Voice channel unavailable.');
  this.#storage=storage;this.#channel=channel;this.#epoch=epoch;this.#sender=sender;this.#prefix='telegramVoice:'+JSON.stringify([channel,epoch])+':';
 }
 #pendingPrefix(){return 'telegramVoicePending:'+JSON.stringify([this.#channel,this.#epoch])+':';}
 #transaction<T>(callback:()=>T):T{return this.#storage.transactionSync?this.#storage.transactionSync(callback):callback();}
 #index(){
  const marker='telegramVoiceIndexed:'+JSON.stringify([this.#channel,this.#epoch]);
  if(this.#storage.get(marker))return;
  // Before this index existed a channel could contain at most 100 entries.
  for(const [key,item] of this.#storage.list<TelegramVoiceIntent>({prefix:this.#prefix,limit:100}))if(item.state==='pending')this.#storage.put(this.#pendingPrefix()+key.slice(this.#prefix.length),true);
  this.#storage.put(marker,true);
 }
 async accept(input:TelegramVoiceMessage,authorize:()=>Promise<void>):Promise<TelegramVoiceIntent>{
  const voice=parseTelegramVoice(input.voice);
  if(!voice||input.sender!==this.#sender||!Number.isSafeInteger(input.update)||input.update<0||!Number.isSafeInteger(input.message)||input.message<1||input.caption!==undefined&&(typeof input.caption!=='string'||new TextEncoder().encode(input.caption).length>16384))throw Error('Voice input unavailable.');
  const pinned:TelegramVoiceMessage={update:input.update,message:input.message,sender:input.sender,voice,...(input.caption===undefined?{}:{caption:input.caption}),...(input.replyTo===undefined?{}:{replyTo:input.replyTo})};
  await authorize();
  const key=this.#prefix+String(input.update).padStart(16,'0');const previous=this.#storage.get<TelegramVoiceIntent>(key);
  if(previous){if(JSON.stringify(previous.input)!==JSON.stringify(pinned))throw Error('Voice input changed.');return structuredClone(previous);}
  this.#index();
  if([...this.#storage.list({prefix:this.#pendingPrefix(),limit:100})].length>=100)throw Error('Voice inbox is full.');
  const intent:TelegramVoiceIntent={request:crypto.randomUUID(),channel:this.#channel,epoch:this.#epoch,input:pinned,state:'pending',received_at:Date.now()};
  this.#transaction(()=>{this.#storage.put(key,intent);this.#storage.put(this.#pendingPrefix()+String(input.update).padStart(16,'0'),true);});return structuredClone(intent);
 }
 async list(authorize:()=>Promise<void>):Promise<TelegramVoiceIntent[]>{
  await authorize();this.#index();return [...this.#storage.list({prefix:this.#pendingPrefix(),limit:100})].map(([key])=>{
   const item=this.#storage.get<TelegramVoiceIntent>(this.#prefix+key.slice(this.#pendingPrefix().length));
   if(!item||item.state!=='pending')throw Error('Voice queue unavailable.');return structuredClone(item);
  });
 }
 /** Only the trusted scoped transfer calls this after verifying the server original. */
 async importedFromChannel(update:number,source:TelegramVoiceImport,authorize:()=>Promise<void>):Promise<void>{
  const item=await this.read(update,authorize);
  if(!/^tgv-[a-f0-9]{64}$/.test(source.request)||!source.project||!/^[a-f0-9]{64}$/.test(source.sha256))throw Error('Voice import mismatch.');
  if(item.imported&&(item.imported.request!==source.request||item.imported.project!==source.project||item.imported.sha256!==source.sha256))throw Error('Voice import changed.');
  this.#index();const key=String(update).padStart(16,'0');
  this.#transaction(()=>{this.#storage.put(this.#prefix+key,{...item,state:'imported',imported:structuredClone(source)});
  this.#storage.delete(this.#pendingPrefix()+key);});
 }
 async imported(update:number,source:TelegramVoiceImport,authorize:()=>Promise<void>):Promise<void>{
  const item=await this.read(update,authorize);
  if(source.request!==item.request||!source.project||!/^[a-f0-9]{64}$/.test(source.sha256))throw Error('Voice import mismatch.');
  if(item.imported&&(item.imported.request!==source.request||item.imported.project!==source.project||item.imported.sha256!==source.sha256))throw Error('Voice import changed.');
  this.#index();
  const key=String(update).padStart(16,'0');
  this.#transaction(()=>{this.#storage.put(this.#prefix+key,{...item,state:'imported',imported:structuredClone(source)});
  this.#storage.delete(this.#pendingPrefix()+key);});
 }
 async read(update:number,authorize:()=>Promise<void>):Promise<TelegramVoiceIntent>{
  if(!Number.isSafeInteger(update)||update<0)throw Error('Voice input unavailable.');
  await authorize();const saved=this.#storage.get<TelegramVoiceIntent>(this.#prefix+String(update).padStart(16,'0'));
  if(!saved||saved.input.sender!==this.#sender)throw Error('Voice input unavailable.');return structuredClone(saved);
 }
}
