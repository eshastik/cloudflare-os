import {MnemosAPIError,type MnemosAPI} from "./mnemos-api.ts";
import type {AccountStorage} from "./account-session.ts";
import type {TemplateContentDecisionInput,TemplateContentDecision,TemplateDecisionInput,TemplatePromotionDecision} from "./work-templates.ts";
export interface SavedTemplateContentDecision {proposal:string;scope:string;domain:string;input:TemplateContentDecisionInput;receipt?:TemplateContentDecision}
export interface SavedTemplateDecision {proposal:string;kind:"personal"|"scoped";input:TemplateDecisionInput;receipt?:TemplatePromotionDecision}
/** Decisions are immutable intents keyed by proposal; changing an unknown decision is forbidden. */
export class TemplateReviewActions {
 private storage:AccountStorage|undefined;private api:MnemosAPI;private check:()=>void;private signal:AbortSignal;
 constructor(storage:AccountStorage|undefined,api:MnemosAPI,check:()=>void,signal:AbortSignal){this.storage=storage;this.api=api;this.check=check;this.signal=signal;}
 private contentKey(id:string,scope:string,domain:string){this.key(id);for(const v of [scope,domain])if(typeof v!=="string"||!v||v.length>255)throw new MnemosAPIError(400);return "template-content-decision:"+JSON.stringify([id,scope,domain]);}
 readContent(id:string,scope:string,domain:string):SavedTemplateContentDecision|null{const key=this.contentKey(id,scope,domain);return structuredClone(this.storage!.get<SavedTemplateContentDecision>(key)??null);}
 async saveContent(id:string,scope:string,domain:string,input:TemplateContentDecisionInput):Promise<SavedTemplateContentDecision>{
  const key=this.contentKey(id,scope,domain);if(!input||typeof input.request_id!=="string"||!input.request_id||input.request_id.length>255||typeof input.approved!=="boolean"||typeof input.comment!=="string"||!input.comment.trim()||new TextEncoder().encode(input.comment).length>4096)throw new MnemosAPIError(400);
  const previous=this.readContent(id,scope,domain);if(previous){if(JSON.stringify(previous.input)!==JSON.stringify(input))throw new MnemosAPIError(409);return previous;}
  const review=await this.api.readTemplateProposal(id,this.signal);this.check();if(review.decision||!review.proposal.scope_path.find(s=>s.scope_id===scope)?.review_requirements?.some(r=>r.domain_id===domain))throw new MnemosAPIError(409);if(this.readContent(id,scope,domain))throw new MnemosAPIError(409);
  const saved:SavedTemplateContentDecision={proposal:id,scope,domain,input:structuredClone(input)};this.storage!.put(key,saved);return structuredClone(saved);
 }
 async executeContent(id:string,scope:string,domain:string):Promise<SavedTemplateContentDecision>{
  const saved=this.readContent(id,scope,domain);if(!saved)throw new MnemosAPIError(409);if(saved.receipt)return saved;const receipt=await this.api.decideTemplateContent(id,scope,domain,saved.input,this.signal);this.check();const current=this.readContent(id,scope,domain);if(!current||JSON.stringify(current.input)!==JSON.stringify(saved.input))throw new MnemosAPIError(409);if(current.receipt)return current;const result={...current,receipt};this.storage!.put(this.contentKey(id,scope,domain),result);return structuredClone(result);
 }
 private key(id:string){this.check();if(!this.storage||typeof id!=="string"||!id||id.length>255)throw new MnemosAPIError(400);return "template-decision:"+encodeURIComponent(id);}
 read(id:string):SavedTemplateDecision|null{const key=this.key(id);return structuredClone(this.storage!.get<SavedTemplateDecision>(key)??null);}
 async save(id:string,input:TemplateDecisionInput):Promise<SavedTemplateDecision>{
  const key=this.key(id);if(!input||typeof input.request_id!=="string"||!input.request_id||input.request_id.length>255||typeof input.approved!=="boolean"||!Number.isSafeInteger(input.scope_revision)||input.scope_revision<1||typeof input.comment!=="string"||!input.comment.trim()||new TextEncoder().encode(input.comment).length>4096)throw new MnemosAPIError(400);
  if(input.publish_snapshot!==undefined&&(typeof input.publish_snapshot!=="boolean"||input.publish_snapshot&&!input.approved))throw new MnemosAPIError(400);
  const previous=this.read(id);if(previous){if(JSON.stringify(previous.input)!==JSON.stringify(input))throw new MnemosAPIError(409);return previous;}
  const review=await this.api.readTemplateProposal(id,this.signal);this.check();
  if(this.read(id))throw new MnemosAPIError(409);
  const saved:SavedTemplateDecision={proposal:id,kind:review.proposal.source_scope_id?"scoped":"personal",input:structuredClone(input)};this.storage!.put(key,saved);return structuredClone(saved);
 }
 async execute(id:string):Promise<SavedTemplateDecision>{
  const saved=this.read(id);if(!saved)throw new MnemosAPIError(409);if(saved.receipt)return saved;
  const receipt=await this.api.decideTemplateProposal(id,saved.kind,saved.input,this.signal);this.check();
  const current=this.read(id);if(!current||JSON.stringify(current.input)!==JSON.stringify(saved.input))throw new MnemosAPIError(409);if(current.receipt)return current;
  const result={...current,receipt};this.storage!.put(this.key(id),result);return structuredClone(result);
 }
}
