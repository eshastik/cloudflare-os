import type {AccountStorage,MnemosAccountSession} from "./account-session.ts";
import type {CorporateRecordUpdatePreview} from "./corporate-import.ts";
type API=Pick<MnemosAccountSession,"prepareBitrixRecordUpdate"|"applyCorporateUpdate"|"beginNativeUpload"|"checkPrivateVersionRead">;
interface Intent {project:string;node:string;head:string;source:string;sourceHead:string;request:Parameters<MnemosAccountSession["applyCorporateUpdate"]>[2];attempted?:boolean;result?:{node_id:string;head:string};}
export interface CorporateUpdateState {id:string;node_id:string;state:"prepared"|"unconfirmed"|"updated";head?:string;}
const hash=async(bytes:Uint8Array)=>{const sum=new Uint8Array(await crypto.subtle.digest("SHA-256",new Uint8Array(bytes)));return {hex:Array.from(sum,x=>x.toString(16).padStart(2,"0")).join(""),base64:btoa(String.fromCharCode(...sum))};};
/** Stores request coordinates only; original/converted corporate content stays out of KV. */
export class CorporateUpdates {
 private tail:Promise<unknown>=Promise.resolve();
 constructor(private storage:AccountStorage,private origin:string,private fetcher:typeof fetch=fetch){}
 private serial<T>(work:()=>Promise<T>){const result=this.tail.catch(()=>{}).then(work);this.tail=result;return result;}
 private state(id:string,i:Intent):CorporateUpdateState{return {id,node_id:i.node,state:i.result?"updated":i.attempted?"unconfirmed":"prepared",...(i.result?{head:i.result.head}:{})};}
 private async check(api:API,i:Intent){await api.checkPrivateVersionRead(i.project,i.node,i.head);await api.checkPrivateVersionRead(i.project,i.source,i.sourceHead);}
 async recover(api:API,project:string,node:string){const id=this.storage.get<string>("corporateUpdateLatest:"+JSON.stringify([project,node]));if(!id)return null;const i=this.storage.get<Intent>("corporateUpdate:"+id);if(!i||i.project!==project||i.node!==node)throw Error("Update unavailable");await this.check(api,i);return this.state(id,i);}
 prepare(api:API,project:string,shown:CorporateRecordUpdatePreview){return this.serial(async()=>{
  if(!shown.plan.source_changed||shown.plan.conflicts.length||!shown.plan.content)throw Error("Unresolved update");
  const id=(await hash(new TextEncoder().encode(JSON.stringify([project,shown.target_node_id,shown.target_head,shown.current_sha256,shown.incoming_node_id,shown.incoming_head,shown.incoming_sha256,shown.resolution?.title_choice||""])))).hex;
  const key="corporateUpdate:"+id;let i=this.storage.get<Intent>(key);
  if(i){await this.check(api,i);return this.state(id,i);}
  const ready=await api.prepareBitrixRecordUpdate(project,shown.target_node_id,shown.target_head,shown.incoming_node_id,shown.incoming_head,shown.resolution);
  if(!ready.preview_id||ready.target_node_id!==shown.target_node_id||ready.target_head!==shown.target_head||ready.current_sha256!==shown.current_sha256||ready.incoming_node_id!==shown.incoming_node_id||ready.incoming_head!==shown.incoming_head||ready.incoming_sha256!==shown.incoming_sha256||ready.plan.content!==shown.plan.content||ready.plan.conflicts.length)throw Error("Update preview changed");
  const bytes=new TextEncoder().encode(ready.plan.content);if(bytes.length>4*1024*1024)throw Error("Update too large");const digest=await hash(bytes);
  const expected=new URL(this.origin);if(expected.protocol!=="https:"||expected.origin!==this.origin)throw Error("Invalid storage origin");
  const ticket=await api.beginNativeUpload(project,bytes.length,digest.base64);const url=new URL(ticket.url);
  if(url.origin!==expected.origin||url.username||url.password||url.hash||ticket.method!=="PUT"||ticket.content_length!==bytes.length||ticket.checksum_header.toLowerCase()!=="x-amz-checksum-sha256"||ticket.checksum_value!==digest.base64)throw Error("Invalid upload ticket");
  const fetcher=this.fetcher;const response=await fetcher(url,{method:"PUT",redirect:"manual",headers:{[ticket.checksum_header]:digest.base64},body:bytes});if(!response.ok)throw Error("Update upload unconfirmed");
  i={project,node:shown.target_node_id,head:shown.target_head,source:shown.incoming_node_id,sourceHead:shown.incoming_head,request:{request_id:crypto.randomUUID(),preview_id:ready.preview_id,upload_id:ticket.upload_id}};
  await this.check(api,i);this.storage.put(key,i);this.storage.put("corporateUpdateLatest:"+JSON.stringify([project,i.node]),id);return this.state(id,i);
 });}
 execute(api:API,id:string){return this.serial(async()=>{
  if(!/^[a-f0-9]{64}$/.test(id))throw Error("Invalid update selection");const key="corporateUpdate:"+id,i=this.storage.get<Intent>(key);if(!i)throw Error("Update unavailable");
  // Even successful replays go to the server to recheck WRITE and both sources.
  i.attempted=true;this.storage.put(key,i);const result=await api.applyCorporateUpdate(i.project,i.node,i.request);if(result.node_id!==i.node||!result.head)throw Error("Invalid update result");i.result=result;this.storage.put(key,i);return this.state(id,i);
 });}
}
