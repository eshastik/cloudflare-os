import {MnemosAPIError,type MnemosAPI} from "./mnemos-api.ts";
import type {AccountStorage} from "./account-session.ts";
import type {WorkTemplateSave,WorkTemplateApplication,WorkTemplateVersion,WorkTemplateApplied,ScopedWorkTemplateApplied,TemplatePromotionInput,TemplatePromotion} from "./work-templates.ts";
export type TemplateAction={kind:"propose";template:string;input:TemplatePromotionInput}|{kind:"save";template:string;input:WorkTemplateSave}|{kind:"create";template:string;scope?:string;input:WorkTemplateApplication};
export interface SavedTemplateAction {id:string;project:string;action:TemplateAction;deferred?:boolean;history?:SavedTemplateAction[];receipt?:{kind:"propose";proposal:TemplatePromotion}|{kind:"save";version:WorkTemplateVersion}|{kind:"create";document:WorkTemplateApplied|ScopedWorkTemplateApplied}}
/** Persist the complete operation before sending it; unknown replies retain it. */
export class TemplateActions {
 private storage:AccountStorage|undefined;private api:MnemosAPI;private check:()=>void;private signal:AbortSignal;
 constructor(storage:AccountStorage|undefined,api:MnemosAPI,check:()=>void,signal:AbortSignal){this.storage=storage;this.api=api;this.check=check;this.signal=signal;}
 private key(project:string){this.check();if(!this.storage||typeof project!=="string"||!project||project.length>255)throw new MnemosAPIError(400);return "work-template-action:"+encodeURIComponent(project);}
 read(project:string):SavedTemplateAction|null{const key=this.key(project);return structuredClone(this.storage!.get<SavedTemplateAction>(key)??null);}
 save(project:string,action:TemplateAction,expected:string):SavedTemplateAction{
  const key=this.key(project);
  if(!action||typeof action.template!=="string"||!action.template||action.template.length>255||!action.input||action.input.project_id!==project||new TextEncoder().encode(JSON.stringify(action)).length>16384)throw new MnemosAPIError(400);
  if(action.kind==="save"){
   const i=action.input;if(!Number.isSafeInteger(i.expected_revision)||i.expected_revision<0||typeof i.title!=="string"||!i.title.trim()||new TextEncoder().encode(i.title).length>255||typeof i.purpose!=="string"||!i.purpose.trim()||new TextEncoder().encode(i.purpose).length>4096||!["document","guidance","agent_instructions","skill"].includes(i.kind)||typeof i.node_id!=="string"||!i.node_id||!/^[0-9a-f]{64}$/.test(i.source_head))throw new MnemosAPIError(400);
  }else if(action.kind==="create"){
   if(action.scope!==undefined&&(typeof action.scope!=="string"||!action.scope||action.scope.length>255))throw new MnemosAPIError(400);
   const i=action.input;if(!Number.isSafeInteger(i.revision)||i.revision<1||typeof i.request_id!=="string"||!i.request_id||i.request_id.length>255||typeof i.name!=="string"||!i.name.trim()||new TextEncoder().encode(i.name).length>255||!/^[0-9a-f]{64}$/.test(i.expected_head))throw new MnemosAPIError(400);
  }else if(action.kind==="propose"){
   const i=action.input;if(!Number.isSafeInteger(i.revision)||i.revision<1||typeof i.request_id!=="string"||!i.request_id||i.request_id.length>255||typeof i.target_scope_id!=="string"||!i.target_scope_id||i.target_scope_id.length>255||!Number.isSafeInteger(i.target_scope_revision)||i.target_scope_revision<1||!Number.isSafeInteger(i.expected_catalogue_revision)||i.expected_catalogue_revision<0||typeof i.template_key!=="string"||!i.template_key.trim()||new TextEncoder().encode(i.template_key).length>255||typeof i.message!=="string"||!i.message.trim()||new TextEncoder().encode(i.message).length>4096||(i.source_scope_id!==undefined&&(typeof i.source_scope_id!=="string"||!i.source_scope_id||i.source_scope_id.length>255||action.template!==i.template_key)))throw new MnemosAPIError(400);
  }else throw new MnemosAPIError(400);
  const previous=this.read(project);
  if(previous&&!previous.receipt&&!previous.deferred){if(JSON.stringify(previous.action)===JSON.stringify(action))return previous;throw new MnemosAPIError(409);}
  if((previous?.id??"")!==expected)throw new MnemosAPIError(409);
  const history=previous?.history??[];if(previous?.deferred&&!previous.receipt){if(history.length>=100)throw new MnemosAPIError(409);const {history:_,...entry}=previous;history.push(entry);}
  const saved:SavedTemplateAction={id:crypto.randomUUID(),project,action:structuredClone(action),...(history.length?{history}: {})};if(new TextEncoder().encode(JSON.stringify(saved)).length>100000)throw new MnemosAPIError(409);this.storage!.put(key,saved);return structuredClone(saved);
 }
 defer(project:string,id:string):SavedTemplateAction{
  const saved=this.read(project);if(!saved||saved.id!==id||saved.receipt)throw new MnemosAPIError(409);
  const result={...saved,deferred:true};this.storage!.put(this.key(project),result);return structuredClone(result);
 }
 restore(project:string,id:string,expected:string):SavedTemplateAction{
  const saved=this.read(project);if(!saved||saved.id!==expected||(!saved.receipt&&!saved.deferred))throw new MnemosAPIError(409);
  const history=saved.history??[];const index=history.findIndex(a=>a.id===id);if(index<0)throw new MnemosAPIError(409);
  const [entry]=history.splice(index,1);if(!saved.receipt){const {history:_,...current}=saved;history.push(current);}
  const result={...entry,deferred:false,history};this.storage!.put(this.key(project),result);return structuredClone(result);
 }
 async execute(project:string,id:string):Promise<SavedTemplateAction>{
  const saved=this.read(project);if(!saved||saved.id!==id)throw new MnemosAPIError(409);if(saved.receipt)return saved;
  const a=saved.action;
  const receipt:NonNullable<SavedTemplateAction["receipt"]>=a.kind==="propose"?{kind:"propose",proposal:await this.api.proposeWorkTemplate(a.template,a.input,this.signal)}:a.kind==="save"?{kind:"save",version:await this.api.saveWorkTemplate(a.template,a.input,this.signal)}:{kind:"create",document:a.scope?await this.api.createFromScopedWorkTemplate(a.scope,a.template,a.input,this.signal):await this.api.createFromWorkTemplate(a.template,a.input,this.signal)};
  this.check();const current=this.read(project);if(!current||current.id!==id)throw new MnemosAPIError(409);if(current.receipt)return current;
  const result={...current,receipt};this.storage!.put(this.key(project),result);return structuredClone(result);
 }
}
