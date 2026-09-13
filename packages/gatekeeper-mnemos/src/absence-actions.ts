import {MnemosAPIError, type MnemosAPI} from "./mnemos-api.ts";
import type {AccountStorage} from "./account-session.ts";
export type AbsenceAction = {kind:"share";binding:string;runtime:string;hash:string;body:string}|{kind:"dispatch";proposal:string}|{kind:"cancel";revision:number}|{kind:"budget";input:Parameters<MnemosAPI["createTeamBudget"]>[1]};
export interface SavedAbsenceAction {id:string;project:string;request:string;action:AbsenceAction;receipt?:{message:string;proposal?:string}}
/** Account-owned retry terms; execution still goes through current API authorization. */
export class AbsenceActions {
 private storage:AccountStorage|undefined;
 private api:MnemosAPI;
 private check:()=>void;
 private signal:AbortSignal;
 constructor(storage:AccountStorage|undefined,api:MnemosAPI,check:()=>void,signal:AbortSignal){this.storage=storage;this.api=api;this.check=check;this.signal=signal;}
 private key(request:string){this.check();if(!this.storage||typeof request!=="string"||!request||request.length>255)throw new MnemosAPIError(400);return "absence-action:"+encodeURIComponent(request);}
 read(request:string):SavedAbsenceAction|null{const key=this.key(request);return structuredClone(this.storage!.get<SavedAbsenceAction>(key)??null);}
 save(project:string,request:string,action:AbsenceAction,expected:string):SavedAbsenceAction{
  const key=this.key(request);
  if(typeof project!=="string"||!project||project.length>255||JSON.stringify(action).length>(action.kind==="share"?131072:40000))throw new MnemosAPIError(400);
  if(action.kind==="dispatch"){if(typeof action.proposal!=="string"||!action.proposal||action.proposal.length>255)throw new MnemosAPIError(400);}
  else if(action.kind==="cancel"){if(!Number.isSafeInteger(action.revision)||action.revision<1)throw new MnemosAPIError(400);}
  else if(action.kind==="budget"){if(action.input.absence_request_id!==request||typeof action.input.request_id!=="string"||!action.input.request_id)throw new MnemosAPIError(400);}
  else if(action.kind==="share"){if(typeof action.binding!=="string"||!action.binding||action.binding.length>255||typeof action.runtime!=="string"||!action.runtime||action.runtime.length>255||!/^[0-9a-f]{64}$/.test(action.hash)||typeof action.body!=="string"||!action.body.trim()||[...action.body].length>16384)throw new MnemosAPIError(400);}
  else throw new MnemosAPIError(400);
  const current=this.read(request);
  if(current&&!current.receipt){if(current.project===project&&JSON.stringify(current.action)===JSON.stringify(action))return current;throw new MnemosAPIError(409);}
  if((current?.id??"")!==expected)throw new MnemosAPIError(409);
  const record:SavedAbsenceAction={id:crypto.randomUUID(),project,request,action:structuredClone(action)};
  this.storage!.put(key,record);return structuredClone(record);
 }
 async execute(request:string,id:string):Promise<SavedAbsenceAction>{
  const record=this.read(request);if(!record||record.id!==id)throw new MnemosAPIError(409);
  if(record.receipt)return record;
  const {project,action}=record;let receipt:NonNullable<SavedAbsenceAction["receipt"]>;
  if(action.kind==="budget"){
   const out=await this.api.createTeamBudget(project,action.input,this.signal);
   if(out.project_id!==project||out.proposal.absence_request_id!==request||!out.id)throw new MnemosAPIError(409);
   receipt={proposal:out.id,message:`Бюджет ${out.id}: ${out.state}. Согласование доступно в разделе бюджетов проекта.`};
  }else if(action.kind==="dispatch"){
   const budget=await this.api.readTeamBudget(project,action.proposal,this.signal);this.check();
   if(budget.project_id!==project||budget.proposal.absence_request_id!==request||budget.state!=="approved")throw new MnemosAPIError(409);
   const out=await this.api.dispatchAbsenceTask(request,action.proposal,this.signal);
   if(out.request_id!==request||!out.runtime_request_id)throw new MnemosAPIError(409);
   receipt={proposal:action.proposal,message:`Ответ запуска: ${out.state}. Перечитайте общую задачу.`};
  }else if(action.kind==="share"){
   const task=await this.api.readAbsenceTask(request,this.signal);this.check();
   if(task.project_id!==project || task.request_id!==request || task.state!=="completed" || task.binding_id!==action.binding || task.runtime_request_id!==action.runtime || task.result_sha256!==action.hash)throw new MnemosAPIError(409);
   const out=await this.api.shareAgentAbsenceResult(request,action.binding,action.runtime,action.hash,action.body,this.signal);
   if(out.sequence<1 || out.kind!=="result" || out.absence_runtime_request_id!==action.runtime || out.absence_result_sha256!==action.hash)throw new MnemosAPIError(409);
   receipt={message:`Выбранный результат передан в обращение (сообщение ${out.sequence}). Инициатор может принять его в обсуждении.`};
  }else{
   const out=await this.api.cancelAbsenceTask(request,action.revision,this.signal);
   if(out.request_id!==request||!out.completed||out.revision<=action.revision)throw new MnemosAPIError(409);
   receipt={message:"Назначение отменено. Перечитайте задачу перед новым запуском."};
  }
  this.check();const current=this.read(request);if(!current||current.id!==id)throw new MnemosAPIError(409);
  if(current.receipt)return current;
  const completed={...record,receipt};this.storage!.put(this.key(request),completed);return structuredClone(completed);
 }
}
