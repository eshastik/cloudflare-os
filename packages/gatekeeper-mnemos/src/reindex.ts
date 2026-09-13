import type {AccountStorage} from './account-session.ts';

/** Receipt returned by the version-pinned Mnemos reindex endpoint. */
export interface ReindexResult {
 replayed:boolean;node_id:string;revision:number;generation:number;changed:boolean;
 segments:number;vectorized:number;policy_class:string;policy_alert:boolean;policy_why:string;
 embed_tokens:number;embed_micro_usd:number;notes:string[]|null;
}
/** A durable user request; an uncertain response retains the same identifier. */
export interface ReindexRequest {node:string;revision:number;request_id:string;result?:ReindexResult}
/** Validate a receipt before persisting or presenting its outcome. */
export function validReindexResult(value:unknown,request:ReindexRequest):value is ReindexResult {
 if(!value||typeof value!=='object')return false;const r=value as ReindexResult;
 return r.node_id===request.node&&r.revision===request.revision&&
 ['generation','segments','vectorized','embed_tokens','embed_micro_usd'].every(k=>Number.isSafeInteger(r[k as keyof ReindexResult])&&Number(r[k as keyof ReindexResult])>=0)&&
 ['replayed','changed','policy_alert'].every(k=>typeof r[k as keyof ReindexResult]==='boolean')&&
 ['policy_class','policy_why'].every(k=>typeof r[k as keyof ReindexResult]==='string')&&
 (r.notes===null||(Array.isArray(r.notes)&&r.notes.every(n=>typeof n==='string')));
}
/** Storage transitions are synchronous so concurrent prepare calls reuse a key. */
export class ReindexRequests {
 constructor(private storage:AccountStorage){}
 private key(node:string){return 'reindexRequest:'+node;}
 get(node:string){return this.storage.get<ReindexRequest>(this.key(node));}
 prepare(node:string,revision:number,restart:boolean):ReindexRequest {
  const previous=this.get(node);
  if(previous&&(!restart||!previous.result))return previous;
  const request:ReindexRequest={node,revision,request_id:crypto.randomUUID().replaceAll('-','')};
  this.storage.put(this.key(node),request);return request;
 }
 complete(request:ReindexRequest,result:ReindexResult){
  if(!validReindexResult(result,request))throw Error('Invalid reindex receipt');
  const current=this.get(request.node);
  if(current?.request_id!==request.request_id)throw Error('Reindex request changed');
  this.storage.put(this.key(request.node),{...request,result});
 }
}
