import {telegramVoiceBudget} from './telegram-budget.ts';
import type {AccountStorage} from './account-session.ts';
import type {TelegramBudgetSettings} from './mnemos-api.ts';
import type {TelegramTaskClient} from './telegram-task-client.ts';
import type {VoiceSource,VoiceTranscript} from './voice-contract.ts';

export interface TelegramVoiceInput {
 expected_budget_revision:number;update_id:number;message_id:number;sender_id:number;
 file_unique_id:string;media_type:string;size_bytes:number;sha256:string;
}
export interface TelegramVoiceRecognition {
 update_id:number;source_request_id:string;project_id:string;proposal_id:string;binding_id:string;budget_revision:number;
 state:'completed'|'unconfirmed'|'budget_blocked'|'awaiting_approval'|'rejected'|'revoked'|'policy_changed';transcript?:VoiceTranscript;
}
export interface TelegramVoiceAdmission extends TelegramVoiceInput {request_id:string;budget:TelegramBudgetSettings}
export function checkedTelegramVoiceInput(input:TelegramVoiceInput):TelegramVoiceInput{
 if(!input||!Number.isSafeInteger(input.expected_budget_revision)||input.expected_budget_revision<1||
 !Number.isSafeInteger(input.update_id)||input.update_id<0||!Number.isSafeInteger(input.message_id)||input.message_id<1||!Number.isSafeInteger(input.sender_id)||input.sender_id<1||
 typeof input.file_unique_id!=='string'||!input.file_unique_id||new TextEncoder().encode(input.file_unique_id).length>255||input.file_unique_id.includes('\0')||
 !['audio/ogg','audio/webm','audio/wav','audio/mpeg','audio/mp4','audio/flac'].includes(input.media_type)||!Number.isSafeInteger(input.size_bytes)||input.size_bytes<1||input.size_bytes>20_000_000||typeof input.sha256!=='string'||!/^[a-f0-9]{64}$/.test(input.sha256))throw Error('Invalid Telegram audio.');
 return {expected_budget_revision:input.expected_budget_revision,update_id:input.update_id,message_id:input.message_id,sender_id:input.sender_id,file_unique_id:input.file_unique_id,media_type:input.media_type,size_bytes:input.size_bytes,sha256:input.sha256};
}
type API=Pick<TelegramTaskClient,'validate'|'prepareVoice'|'beginVoiceUpload'|'importVoice'>;
type Intent={input:TelegramVoiceInput;budget:TelegramBudgetSettings;admission?:TelegramVoiceAdmission;upload?:string;source?:VoiceSource};
/** Scoped original transfer survives lost import replies without retaining bytes,
 * Telegram credentials or signed storage URLs in durable state. */
export class TelegramVoiceTransfer {
 #tail:Promise<unknown>=Promise.resolve();
 private storage:AccountStorage;private origin:string;private namespace:string;private fetcher:typeof fetch;
 constructor(storage:AccountStorage,origin:string,namespace:string,fetcher:typeof fetch=fetch){
  this.storage=storage;this.origin=origin;this.namespace=namespace;this.fetcher=fetcher;
  const url=new URL(origin);if(url.protocol!=='https:'||url.origin!==origin||!namespace)throw Error('Voice storage unavailable.');
 }
 #key(update:number){if(!Number.isSafeInteger(update)||update<0)throw Error('Invalid Telegram update.');return 'telegramVoiceTransfer:'+JSON.stringify([this.namespace,update]);}
 saved(update:number){return structuredClone(this.storage.get<Intent>(this.#key(update))??null);}
 save(api:API,input:TelegramVoiceInput,budget:TelegramBudgetSettings,bytes:Uint8Array){
  input=checkedTelegramVoiceInput(input);budget=telegramVoiceBudget(budget);
  if(!(bytes instanceof Uint8Array)||bytes.byteLength!==input.size_bytes)throw Error('Invalid Telegram audio bytes.');bytes=bytes.slice();
  return this.#serial(async()=>{
   const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as Uint8Array<ArrayBuffer>));const hash=[...digest].map(x=>x.toString(16).padStart(2,'0')).join('');
   if(hash!==input.sha256||budget.revision!==input.expected_budget_revision||!budget.voice_binding_id||!budget.voice_limit_usd_micros)throw Error('Telegram audio changed.');
   await api.validate();const key=this.#key(input.update_id);let intent=this.storage.get<Intent>(key);
   if(intent&&(JSON.stringify(intent.input)!==JSON.stringify(input)||JSON.stringify(intent.budget)!==JSON.stringify(budget)))throw Error('Telegram audio intent changed.');
   if(!intent){intent={input,budget};this.storage.put(key,intent);}
   if(!intent.admission){const admission=await api.prepareVoice(input);if(JSON.stringify(admission.budget)!==JSON.stringify(budget))throw Error('Telegram audio settings changed.');intent.admission=admission;this.storage.put(key,intent);}
   if(!intent.upload){
    const ticket=await api.beginVoiceUpload(input.update_id);let url:URL;try{url=new URL(ticket.url);}catch{throw Error('Invalid Telegram upload ticket.');}
    const checksum=btoa(String.fromCharCode(...digest));
    if(url.protocol!=='https:'||url.origin!==this.origin||url.username||url.password||url.hash||ticket.method!=='PUT'||ticket.content_length!==input.size_bytes||typeof ticket.upload_id!=='string'||!ticket.upload_id||ticket.checksum_header?.toLowerCase()!=='x-amz-checksum-sha256'||ticket.checksum_value!==checksum)throw Error('Invalid Telegram upload ticket.');
    await api.validate();const fetcher=this.fetcher;
    let response:Response;try{response=await fetcher(url,{method:'PUT',redirect:'manual',signal:AbortSignal.timeout(30000),headers:{[ticket.checksum_header]:checksum},body:bytes as Uint8Array<ArrayBuffer>});}catch{throw Error('Telegram audio upload unconfirmed.');}
    await response.body?.cancel();if(!response.ok)throw Error('Telegram audio upload unconfirmed.');
    intent.upload=ticket.upload_id;this.storage.put(key,intent);
   }
   return this.#finish(api,key,intent);
  });
 }
 resume(api:API,update:number){return this.#serial(async()=>{
  const key=this.#key(update),intent=this.storage.get<Intent>(key);if(!intent?.admission||!intent.upload)throw Error('Telegram audio needs original bytes.');
  return this.#finish(api,key,intent);
 });}
 async #finish(api:API,key:string,intent:Intent){
  await api.validate();const source=await api.importVoice(intent.admission!,intent.upload!);await api.validate();
  if(intent.source&&JSON.stringify(intent.source)!==JSON.stringify(source))throw Error('Telegram audio original changed.');
  intent.source=source;this.storage.put(key,intent);return source;
 }
 #serial<T>(work:()=>Promise<T>):Promise<T>{const task=this.#tail.catch(()=>{}).then(work);this.#tail=task;return task;}
}
