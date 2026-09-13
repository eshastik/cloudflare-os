import {MnemosAPIError,type MnemosAPI} from "./mnemos-api.ts";
import type {AccountStorage} from "./account-session.ts";
import type {TemplateDecisionInput,TemplatePromotionDecision} from "./work-templates.ts";
export interface SavedTemplateDecision {proposal:string;kind:"personal"|"scoped";input:TemplateDecisionInput;receipt?:TemplatePromotionDecision}
/** Decisions are immutable intents keyed by proposal; changing an unknown decision is forbidden. */
export class TemplateReviewActions {
 private storage:AccountStorage|undefined;private api:MnemosAPI;private check:()=>void;private signal:AbortSignal;
 constructor(storage:AccountStorage|undefined,api:MnemosAPI,check:()=>void,signal:AbortSignal){this.storage=storage;this.api=api;this.check=check;this.signal=signal;}
 private key(id:string){this.check();if(!this.storage||typeof id!=="string"||!id||id.length>255)throw new MnemosAPIError(400);return "template-decision:"+encodeURIComponent(id);}
 read(id:string):SavedTemplateDecision|null{const key=this.key(id);return structuredClone(this.storage!.get<SavedTemplateDecision>(key)??null);}
 async save(id:string,input:TemplateDecisionInput):Promise<SavedTemplateDecision>{
  const key=this.key(id);if(!input||typeof input.request_id!=="string"||!input.request_id||input.request_id.length>255||typeof input.approved!=="boolean"||!Number.isSafeInteger(input.scope_revision)||input.scope_revision<1||typeof input.comment!=="string"||!input.comment.trim()||new TextEncoder().encode(input.comment).length>4096)throw new MnemosAPIError(400);
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
