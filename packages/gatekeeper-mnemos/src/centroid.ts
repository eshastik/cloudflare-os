import type {AccountStorage} from './account-session.ts';
/** A server receipt bound to one project and caller request. */
export interface CentroidResult {project_id:string;request_id:string;replayed:boolean;changed:boolean;documents:number;excluded:number;embed_tokens:number;embed_micro_usd:number}
/** Durable human intent, retained when the server response is uncertain. */
export interface CentroidRequest {project:string;request_id:string;result?:CentroidResult}
export function validCentroidResult(value:unknown,request:CentroidRequest):value is CentroidResult{
 if(!value||typeof value!=='object')return false;const r=value as CentroidResult;
 return r.project_id===request.project&&r.request_id===request.request_id&&typeof r.replayed==='boolean'&&typeof r.changed==='boolean'&&
 ['documents','excluded','embed_tokens','embed_micro_usd'].every(k=>Number.isSafeInteger(r[k as keyof CentroidResult])&&Number(r[k as keyof CentroidResult])>=0);
}
/** Persist intent and completion in the account's audited operation storage. */
export class CentroidRequests{
 constructor(private storage:AccountStorage){}
 get(project:string){return this.storage.get<CentroidRequest>('centroidRequest:'+project);}
 prepare(project:string,restart=false){
  const previous=this.get(project);if(previous&&(!restart||!previous.result))return previous;
  const request:CentroidRequest={project,request_id:crypto.randomUUID().replaceAll('-','')};this.storage.put('centroidRequest:'+project,request);return request;
 }
 complete(request:CentroidRequest,result:CentroidResult){
  if(!validCentroidResult(result,request)||this.get(request.project)?.request_id!==request.request_id)throw Error('Invalid centroid receipt');
  const completed={...request,result};this.storage.put('centroidRequest:'+request.project,completed);return completed;
 }
}
