import type {AccountStorage} from './account-session.ts';
import {validReindexResult,type ReindexRequest,type ReindexResult} from './reindex.ts';

/** An authorized inventory obtained from one server snapshot. */
export interface ReindexInventory {captured_at:string;entries:{project_id:string;node_id:string;revision:number}[]}
/** Persisted progress of the currently selected bulk run. */
export interface ReindexBatch {
 id:string;projects:string[];history:boolean;captured_at:string;total:number;next:number;
 changed:number;failed:number;tokens:number;micro_usd:number;
}
interface Outcome {changed:boolean;tokens:number;micro_usd:number}
interface Entry extends ReindexRequest {outcome?:Outcome}
const CHUNK=32,KEY='reindexBatch:current';
const inFlight=new Set<string>();

/** Validate the complete inventory before allocating any persistent request. */
export function validReindexInventory(value:unknown,projects:string[],history:boolean):value is ReindexInventory {
 if(!value||typeof value!=='object')return false;const v=value as ReindexInventory;
 if(typeof v.captured_at!=='string'||!Number.isFinite(Date.parse(v.captured_at))||!Array.isArray(v.entries)||v.entries.length>100000)return false;
 const scope=new Set(projects),seen=new Set<string>(),nodes=new Map<string,string>();
 for(const e of v.entries){
  if(!e||!scope.has(e.project_id)||typeof e.node_id!=='string'||!e.node_id||!Number.isInteger(e.revision)||e.revision<1||e.revision>2147483647)return false;
  const key=JSON.stringify([e.node_id,e.revision]);if(seen.has(key)||(!history&&nodes.has(e.node_id))||(nodes.has(e.node_id)&&nodes.get(e.node_id)!==e.project_id))return false;
  seen.add(key);nodes.set(e.node_id,e.project_id);
 }
 return true;
}

/** Chunked durable plan. Results are saved before advancing the cursor, so a
 * failed cursor write can be recovered without issuing the request again. */
export class ReindexBatches {
 constructor(private storage:AccountStorage){}
 current(){return this.storage.get<ReindexBatch>(KEY);}
 private chunkKey(id:string,index:number){return `reindexBatchChunk:${id}:${Math.floor(index/CHUNK)}`;}
 /** Prevent two live management sessions from issuing the same batch step. */
 acquire(id:string){if(inFlight.has(id))throw Error('Reindex batch already running');inFlight.add(id);return ()=>inFlight.delete(id);}
 /** The header becomes visible only after every immutable request ID is stored. */
 prepare(projects:string[],history:boolean,inventory:ReindexInventory,restart=false):ReindexBatch {
  const previous=this.current();if(previous&&(!restart||previous.next<previous.total))return previous;
  if(!validReindexInventory(inventory,projects,history))throw Error('Invalid reindex inventory');
  const batch:ReindexBatch={id:crypto.randomUUID(),projects:[...new Set(projects)].sort(),history,captured_at:inventory.captured_at,total:inventory.entries.length,next:0,changed:0,failed:0,tokens:0,micro_usd:0};
  for(let n=0;n<inventory.entries.length;n+=CHUNK){
   const chunk:Entry[]=inventory.entries.slice(n,n+CHUNK).map(e=>({node:e.node_id,revision:e.revision,request_id:crypto.randomUUID().replaceAll('-','')}));
   this.storage.put(this.chunkKey(batch.id,n),chunk);
  }
  this.storage.put(KEY,batch);return batch;
 }
 private expected(id:string){const batch=this.current();if(!batch||batch.id!==id)throw Error('Reindex batch changed');return batch;}
 /** A recovered stored outcome advances locally and never returns a request. */
 next(id:string):{batch:ReindexBatch;request?:ReindexRequest}{
  const batch=this.expected(id);if(batch.next===batch.total)return {batch};
  const chunk=this.storage.get<Entry[]>(this.chunkKey(id,batch.next)),entry=chunk?.[batch.next%CHUNK];
  if(!entry)throw Error('Reindex batch chunk missing');
  if(entry.outcome)return {batch:this.advance(batch,entry.outcome)};
  return {batch,request:{node:entry.node,revision:entry.revision,request_id:entry.request_id}};
 }
 /** Record a validated server response. A stale result cannot overwrite a later step. */
 complete(id:string,index:number,request:ReindexRequest,result:ReindexResult):ReindexBatch {
  const batch=this.expected(id);if(batch.next!==index)return batch;
  const key=this.chunkKey(id,index),chunk=this.storage.get<Entry[]>(key),entry=chunk?.[index%CHUNK];
  if(!chunk||!entry||entry.request_id!==request.request_id||entry.node!==request.node||entry.revision!==request.revision||!validReindexResult(result,entry))throw Error('Invalid reindex batch receipt');
  if(!entry.outcome){entry.outcome={changed:result.changed,tokens:result.embed_tokens,micro_usd:result.embed_micro_usd};this.storage.put(key,chunk);}
  return this.advance(batch,entry.outcome);
 }
 private advance(batch:ReindexBatch,outcome:Outcome){
  const next={...batch,next:batch.next+1,changed:batch.changed+Number(outcome.changed),failed:batch.failed+Number(!outcome.changed),tokens:batch.tokens+outcome.tokens,micro_usd:batch.micro_usd+outcome.micro_usd};
  if(!Number.isSafeInteger(next.tokens)||!Number.isSafeInteger(next.micro_usd))throw Error('Reindex cost overflow');
  this.storage.put(KEY,next);return next;
 }
}
