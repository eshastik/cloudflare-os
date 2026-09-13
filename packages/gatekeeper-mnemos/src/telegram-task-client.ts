import {telegramVoiceBudget} from './telegram-budget.ts';
import type {TelegramBudgetSettings,UploadTicket} from './mnemos-api.ts';
import {checkedVoiceTranscript,checkedVoiceSource,checkedVoiceConfirmation,type VoiceSource,type VoiceConfirmation} from './voice-contract.ts';
import {checkedTelegramVoiceInput,type TelegramVoiceInput,type TelegramVoiceAdmission,type TelegramVoiceRecognition} from './telegram-voice-transfer.ts';
/** Server-only scoped client. Its credential is never a human/agent API token. */
export interface TelegramTaskScope {
  tenant: string; channel: string; owner: string; binding: string; bot: string; sender: number; secret: string;
}
export interface TelegramTaskSource {
  update_id: number; message_id: number; sender_id: number; message: string; criteria: string;
}
export interface TelegramTaskReply {
  update_id: number; request_id: string;
  outcome: {request_id: string; state: 'completed' | 'unconfirmed' | 'budget_blocked';
    result: {content: string} | null; receipt_present?: boolean};
  budget?:{update_id:number;request_id:string;budget_revision:number;project_id:string;proposal_id:string;state:'approved'|'awaiting_approval'|'rejected'|'revoked'|'policy_changed'};
}
/** Budget and runtime observation for one explicitly reviewed voice command. */
export interface TelegramVoiceCommandReply {
 source_request_id:string;confirmation_id:string;project_id:string;binding_id:string;budget_revision:number;proposal_id:string;
 state:'awaiting_approval'|'rejected'|'revoked'|'policy_changed'|'completed'|'unconfirmed'|'budget_blocked';
 outcome?:TelegramTaskReply['outcome'];
}
export interface TelegramCorrectionSource {
 update_id:number;message_id:number;sender_id:number;target_update_id:number;message:string;
}
export interface TelegramCorrectionReply {
 update_id:number;target_update_id:number;
 outcome:{request_id:string;correction_id:string;sequence:number;journalled:boolean};
}
export class TelegramTaskError extends Error {
  readonly status: number;
  constructor(status: number) {super('Telegram task operation failed or is unconfirmed.'); this.status = status;}
}
export class TelegramCorrectionClosed extends TelegramTaskError {constructor(){super(409);}}
async function isClosed(response:Response){
 const reader=response.body?.getReader();if(!reader)return false;
 let size=0,text='';const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:false});
 try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>1024)return false;text+=decoder.decode(part.value,{stream:true});}
  text+=decoder.decode();return object(JSON.parse(text)).code==='telegram.correction_closed';
 }catch{return false;}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
function coordinate(value: string) {
  if (typeof value !== 'string' || !value || value === '.' || value === '..' ||
      new TextEncoder().encode(value).length > 255 || /[\x00-\x1f]/.test(value)) throw new TelegramTaskError(400);
  return encodeURIComponent(value);
}
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function updateID(value: number) {if (!Number.isSafeInteger(value) || value < 0) throw new TelegramTaskError(400);}

export class TelegramTaskClient {
  #scope: TelegramTaskScope;
  #base: string;
  #fetch: typeof fetch;
  /** Executes only the saved review under pinned channel defaults; repeats reuse its proposal. */
  async runVoice(target:number,review:VoiceConfirmation,expected:{project:string;budgetRevision:number},previous?:TelegramVoiceCommandReply):Promise<TelegramVoiceCommandReply>{
    updateID(target);review={...review};expected={...expected};
    const confirmation=/^telegram-review-(0|[1-9][0-9]*)$/.exec(review.operation_id);
    if(!confirmation||!review.current)throw new TelegramTaskError(400);
    const confirmationUpdate=Number(confirmation[1]);updateID(confirmationUpdate);
    const out=object(await this.#request('/voices/'+target+'/run',{sender_id:this.#scope.sender,confirmation_update_id:confirmationUpdate,revision:review.revision,text_sha256:review.text_sha256,confirmed:true}));
    if(out.source_request_id!==review.source_request_id||out.confirmation_id!==review.operation_id||out.project_id!==expected.project||out.binding_id!==this.#scope.binding||out.budget_revision!==expected.budgetRevision||typeof out.proposal_id!=='string'||!out.proposal_id||out.proposal_id.length>255||previous&&out.proposal_id!==previous.proposal_id||!['awaiting_approval','rejected','revoked','policy_changed','completed','unconfirmed','budget_blocked'].includes(String(out.state)))throw new TelegramTaskError(502);
    const running=['completed','unconfirmed','budget_blocked'].includes(String(out.state));
    const outcome=running?this.#reply({update_id:target,request_id:object(out.outcome).request_id,outcome:out.outcome},target,previous?.outcome?.request_id).outcome:undefined;
    if(outcome&&outcome.state!==out.state||!running&&out.outcome!==undefined)throw new TelegramTaskError(502);
    return {source_request_id:review.source_request_id,confirmation_id:review.operation_id,project_id:expected.project,binding_id:this.#scope.binding,budget_revision:expected.budgetRevision,proposal_id:out.proposal_id,state:out.state as TelegramVoiceCommandReply['state'],...(outcome?{outcome}:{})};
  }
  /** Saves a human correction as a new unconfirmed version of this channel's voice. */
  async editVoice(target:number,update:number,revision:number,text:string,source:string){
    updateID(target);updateID(update);
    if(target===update||!Number.isSafeInteger(revision)||revision<1||revision>=Number.MAX_SAFE_INTEGER||typeof text!=='string'||!text.trim()||text.includes('\0')||new TextEncoder().encode(text).length>65536)throw new TelegramTaskError(400);
    const reply=await this.#request('/voices/'+target+'/edit',{update_id:update,sender_id:this.#scope.sender,expected_revision:revision,text});
    try{
      const result=checkedVoiceTranscript(reply,source,revision+1);
      if(result.operation_id!=='telegram-edit-'+update||result.kind!=='human'||result.text!==text||!result.uncertain)throw new Error();
      return result;
    }catch{throw new TelegramTaskError(502);}
  }
  /** Records explicit review of a channel-owned transcript; never starts a task. */
  async confirmVoice(target:number,update:number,revision:number,textHash:string,source:string){
    updateID(target);updateID(update);
    if(target===update||!Number.isSafeInteger(revision)||revision<1||!/^[0-9a-f]{64}$/.test(textHash))throw new TelegramTaskError(400);
    const reply=await this.#request('/voices/'+target+'/confirm',{update_id:update,sender_id:this.#scope.sender,revision,text_sha256:textHash,confirmed:true});
    try{
      const result=checkedVoiceConfirmation(reply,source,'telegram-review-'+update);
      if(result.revision!==revision||result.text_sha256!==textHash)throw new Error();
      return result;
    }catch{throw new TelegramTaskError(502);}
  }
  constructor(origin: string, scope: TelegramTaskScope, fetcher: typeof fetch = fetch) {
    const url = new URL(origin);
    if (url.protocol !== 'https:' || url.origin !== origin || !/^[A-Za-z0-9_-]{43}$/.test(scope.secret) ||
        !Number.isSafeInteger(scope.sender) || scope.sender <= 0) throw new TelegramTaskError(400);
    for (const value of [scope.owner,scope.binding,scope.bot]) coordinate(value);
    this.#scope = {...scope}; this.#fetch = fetcher;
    this.#base = origin + '/v1/telegram-channel-access/' + coordinate(scope.tenant) + '/' + coordinate(scope.channel);
  }
  async #request(suffix: string, body?: unknown): Promise<unknown> {
    try {
      const fetcher = this.#fetch;
      const response = await fetcher(this.#base + suffix, {method: body ? 'POST' : 'GET', redirect:'manual',
        signal: AbortSignal.timeout(30000), headers:{Authorization:'Bearer '+this.#scope.secret,...(body ? {'Content-Type':'application/json'} : {})},
        ...(body ? {body:JSON.stringify(body)} : {})});
      if (!response.ok || !response.body) {
        if(suffix==='/corrections'&&response.status===409&&await isClosed(response))throw new TelegramCorrectionClosed();
        await response.body?.cancel();
        throw new TelegramTaskError([401,403].includes(response.status) ? 403 : response.status === 409 ? 409 : 503);
      }
      const reader = response.body.getReader(), decoder = new TextDecoder('utf-8',{fatal:true,ignoreBOM:false});
      let text = '', size = 0;
      try {
        for (;;) {const {done,value} = await reader.read(); if (done) break;
          size += value.byteLength; if (size > 4*1024*1024) throw new TelegramTaskError(502);
          text += decoder.decode(value,{stream:true});}
        text += decoder.decode();
      } catch {await reader.cancel().catch(() => {}); throw new TelegramTaskError(502);}
      finally {reader.releaseLock();}
      try {return JSON.parse(text);} catch {throw new TelegramTaskError(502);}
    } catch (error) {
      if (error instanceof TelegramTaskError) throw error;
      // Fetch exceptions can contain headers or credentials. Preserve no original cause.
      throw new TelegramTaskError(503);
    }
  }
  async transcribeVoice(update:number,source:{request:string;project:string;binding:string;budgetRevision:number}):Promise<TelegramVoiceRecognition>{
    updateID(update);const out=object(await this.#request('/voices/'+update+'/transcribe',{}));
    if(out.update_id!==update||out.source_request_id!==source.request||out.project_id!==source.project||out.binding_id!==source.binding||out.budget_revision!==source.budgetRevision||typeof out.proposal_id!=='string'||!out.proposal_id||out.proposal_id.length>255||typeof out.binding_id!=='string'||!out.binding_id||out.binding_id.length>255||!Number.isSafeInteger(out.budget_revision)||Number(out.budget_revision)<1||!['completed','unconfirmed','budget_blocked','awaiting_approval','rejected','revoked','policy_changed'].includes(String(out.state)))throw new TelegramTaskError(502);
    const transcript=out.state==='completed'?checkedVoiceTranscript(out.transcript,source.request,1):undefined;
    if(transcript&&(transcript.kind!=='provider'||!transcript.uncertain)||!transcript&&out.transcript!==undefined)throw new TelegramTaskError(502);
    return {update_id:update,source_request_id:source.request,project_id:source.project,proposal_id:out.proposal_id,binding_id:out.binding_id,budget_revision:Number(out.budget_revision),state:out.state as TelegramVoiceRecognition['state'],...(transcript?{transcript}:{})};
  }
  async voiceSettings():Promise<TelegramBudgetSettings>{
    return telegramVoiceBudget(await this.#request('/voices/settings') as TelegramBudgetSettings);
  }
  async prepareVoice(input:TelegramVoiceInput):Promise<TelegramVoiceAdmission>{
    input=checkedTelegramVoiceInput(input);if(input.sender_id!==this.#scope.sender)throw new TelegramTaskError(400);
    const out=object(await this.#request('/voices',input));
    for(const [key,value] of Object.entries(input))if(out[key]!==value)throw new TelegramTaskError(502);
    const budget=telegramVoiceBudget(out.budget as TelegramBudgetSettings);
    if(typeof out.request_id!=='string'||!/^tgv-[a-f0-9]{64}$/.test(out.request_id)||budget.revision!==input.expected_budget_revision||!budget.voice_binding_id||!budget.voice_limit_usd_micros)throw new TelegramTaskError(502);
    return {...input,request_id:out.request_id,budget};
  }
  async beginVoiceUpload(update:number):Promise<UploadTicket>{
    updateID(update);return await this.#request('/voices/'+update+'/upload',{}) as UploadTicket;
  }
  async importVoice(input:TelegramVoiceAdmission,upload:string):Promise<VoiceSource>{
    updateID(input.update_id);coordinate(upload);
    const out=checkedVoiceSource(await this.#request('/voices/'+input.update_id+'/import',{upload_id:upload}),input.request_id,input.budget.project_id,input.media_type);
    if(out.sha256!==input.sha256||out.size_bytes!==input.size_bytes)throw new TelegramTaskError(502);return out;
  }
  /** Fresh authorization for queuing or releasing a reply; it performs no model work. */
  async validate(): Promise<void> {
    const result = object(await this.#request('')), scope = this.#scope;
    if (result.id !== scope.channel || result.owner_id !== scope.owner || result.binding_id !== scope.binding ||
        result.bot_id !== scope.bot || result.sender_id !== scope.sender || result.enabled !== true || result.revision !== 1)
      throw new TelegramTaskError(403);
  }
  /** This credential can remove itself even after owner/agent deactivation. */
  async revoke(): Promise<void> {
    const result=object(await this.#request('/revoke',{}));
    if(result.disabled!==true)throw new TelegramTaskError(502);
  }
  /** Exact source retry cannot launch a second task or select a different parent. */
  async correct(source:TelegramCorrectionSource,expectedRequest?:string):Promise<TelegramCorrectionReply>{
    source={...source};updateID(source.update_id);updateID(source.target_update_id);
    if(!Number.isSafeInteger(source.message_id)||source.message_id<1||source.sender_id!==this.#scope.sender||typeof source.message!=='string'||!source.message.trim()||source.message.includes('\0')||new TextEncoder().encode(source.message).length>12000)throw new TelegramTaskError(400);
    const reply=object(await this.#request('/corrections',source)),outcome=object(reply.outcome);
    if(reply.update_id!==source.update_id||reply.target_update_id!==source.target_update_id||typeof outcome.request_id!=='string'||!outcome.request_id||outcome.request_id.length>255||expectedRequest!==undefined&&outcome.request_id!==expectedRequest||typeof outcome.correction_id!=='string'||!outcome.correction_id||outcome.correction_id.length>255||!Number.isSafeInteger(outcome.sequence)||Number(outcome.sequence)<1||Number(outcome.sequence)>100||typeof outcome.journalled!=='boolean')throw new TelegramTaskError(502);
    return {update_id:source.update_id,target_update_id:source.target_update_id,outcome:{request_id:outcome.request_id,correction_id:outcome.correction_id,sequence:Number(outcome.sequence),journalled:outcome.journalled}};
  }
  async submit(source: TelegramTaskSource, expectedRequest?: string): Promise<TelegramTaskReply> {
    source = {...source}; updateID(source.update_id);
    if (!Number.isSafeInteger(source.message_id) || source.message_id < 1 || source.sender_id !== this.#scope.sender ||
        typeof source.message !== 'string' || !source.message.trim() || new TextEncoder().encode(source.message).length > 12000 ||
        typeof source.criteria !== 'string' || !source.criteria.trim() || new TextEncoder().encode(source.criteria).length > 3000)
      throw new TelegramTaskError(400);
    return this.#reply(await this.#request('/tasks',source),source.update_id,expectedRequest);
  }
  async read(update: number, expectedRequest?: string): Promise<TelegramTaskReply> {
    updateID(update);
    return this.#reply(await this.#request('/tasks/'+update),update,expectedRequest);
  }
  #reply(value: unknown, update: number, expected?: string): TelegramTaskReply {
    const result = object(value), outcome = object(result.outcome), payload = object(outcome.result);
    if (result.update_id !== update || typeof result.request_id !== 'string' || !result.request_id ||
        new TextEncoder().encode(result.request_id).length > 255 || /[\x00-\x1f]/.test(result.request_id) ||
        expected !== undefined && result.request_id !== expected || outcome.request_id !== result.request_id ||
        !['completed','unconfirmed','budget_blocked'].includes(String(outcome.state)) ||
        outcome.state === 'completed' && typeof payload.content !== 'string' ||
        outcome.receipt_present !== undefined && typeof outcome.receipt_present !== 'boolean' ||
        outcome.receipt_present === false && outcome.state !== 'unconfirmed') throw new TelegramTaskError(502);
    let budget:TelegramTaskReply['budget'];
    if(result.budget!==undefined){
      const b=object(result.budget);
      if(b.update_id!==update||b.request_id!==result.request_id||!Number.isSafeInteger(b.budget_revision)||Number(b.budget_revision)<1||typeof b.project_id!=='string'||!b.project_id||b.project_id.length>255||typeof b.proposal_id!=='string'||!b.proposal_id||b.proposal_id.length>255||!['approved','awaiting_approval','rejected','revoked','policy_changed'].includes(String(b.state)))throw new TelegramTaskError(502);
      budget={update_id:update,request_id:result.request_id,budget_revision:Number(b.budget_revision),project_id:b.project_id,proposal_id:b.proposal_id,state:b.state as NonNullable<TelegramTaskReply['budget']>['state']};
    }
    return {update_id:update,request_id:result.request_id,...(budget?{budget}:{}),outcome:{request_id:result.request_id,
      state:outcome.state as TelegramTaskReply['outcome']['state'],
      result:outcome.state === 'completed' ? {content:payload.content as string} : null,
      ...(outcome.receipt_present !== undefined ? {receipt_present:outcome.receipt_present as boolean} : {})}};
  }
}
