import type {AccountStorage,MnemosAccountSession} from "./account-session.ts";
import type {CorporateWorkflowPreview} from "./corporate-import.ts";
import type {PrivateDocumentCreate} from "./mnemos-api.ts";
type API=Pick<MnemosAccountSession,"previewCorporateWorkflow"|"prepareCorporateWorkflow"|"checkPrivateVersionRead"|"beginNativeUpload"|"createPrivateDocument"|"readDraftDocument">;
interface Intent {project:string;source:string;head:string;request:PrivateDocumentCreate;attempted?:boolean;result?:{node_id:string;head:string};}
export interface CorporateWorkflowState {id:string;state:"prepared"|"unconfirmed"|"created";name:string;node_id?:string;}
const hash=async(bytes:Uint8Array)=>{const sum=new Uint8Array(await crypto.subtle.digest("SHA-256",new Uint8Array(bytes)));return {hex:Array.from(sum,x=>x.toString(16).padStart(2,"0")).join(""),base64:btoa(String.fromCharCode(...sum))};};
const fail=()=>Error("Shared workflow unavailable or changed");
/** Durable requests retain coordinates and receipts, never source or tracker content. */
export class CorporateWorkflows {
 constructor(private storage:AccountStorage,private origin:string,private fetcher:typeof fetch=fetch){}
 private state(id:string,intent:Intent):CorporateWorkflowState{return {id,name:intent.request.name,state:intent.result?"created":intent.attempted?"unconfirmed":"prepared",...(intent.result?{node_id:intent.result.node_id}:{})};}
 async prepare(api:API,project:string,shown:CorporateWorkflowPreview,plan:unknown,confirmed:boolean){
  if(!confirmed)throw fail();
  const fresh=await api.previewCorporateWorkflow(project,shown.source_node_id,shown.source_head,shown.provider,plan);
  for(const key of ["source_node_id","source_head","source_sha256","provider","content","sha256"] as const)if(fresh[key]!==shown[key])throw fail();
  if(!["jira","bitrix24"].includes(fresh.provider)||!/^([a-f0-9]{64})$/.test(fresh.source_sha256))throw fail();
  const bytes=new TextEncoder().encode(fresh.content),sum=await hash(bytes);if(bytes.length>4*1024*1024||sum.hex!==fresh.sha256)throw fail();
  const id=(await hash(new TextEncoder().encode(JSON.stringify([fresh.provider,project,fresh.source_node_id,fresh.source_sha256,sum.hex])))).hex,key="corporateWorkflowCreation:"+id;
  let intent=this.storage.get<Intent>(key);
  if(intent){await api.checkPrivateVersionRead(intent.project,intent.source,intent.head);if(intent.result){const doc=await api.readDraftDocument(intent.project,intent.result.node_id);if(!doc.exists)throw fail();}return this.state(id,intent);}
  const prepared=await api.prepareCorporateWorkflow(project,fresh.source_node_id,fresh.source_head,fresh.provider,plan,sum.hex,true);
  if(prepared.source_node_id!==fresh.source_node_id||prepared.source_head!==fresh.source_head||prepared.content!==fresh.content||prepared.sha256!==sum.hex||prepared.issue_id!=="workflow:"+sum.hex||!prepared.preview_id||prepared.content_type!=="application/vnd.mnemos.task-tracker+json")throw fail();
  const ticket=await api.beginNativeUpload(project,bytes.length,sum.base64),url=new URL(ticket.url),origin=new URL(this.origin);
  if(origin.protocol!=="https:"||origin.origin!==this.origin||url.origin!==this.origin||url.username||url.password||url.hash||ticket.method!=="PUT"||ticket.content_length!==bytes.length||ticket.checksum_header.toLowerCase()!=="x-amz-checksum-sha256"||ticket.checksum_value!==sum.base64)throw fail();
  const fetcher=this.fetcher,response=await fetcher(url,{method:"PUT",redirect:"manual",signal:AbortSignal.timeout(20000),headers:{[ticket.checksum_header]:sum.base64},body:bytes});await response.body?.cancel();if(!response.ok)throw fail();
  await api.checkPrivateVersionRead(project,fresh.source_node_id,fresh.source_head);
  intent={project,source:fresh.source_node_id,head:fresh.source_head,request:{request_id:crypto.randomUUID(),expected_head:fresh.source_head,parent_id:"",name:fresh.provider==="jira"?"Процесс Jira":"Процесс Bitrix24",content_type:prepared.content_type,upload_id:ticket.upload_id,corporate_preview_id:prepared.preview_id,message:"Import reviewed shared corporate workflow"}};
  this.storage.put(key,intent);return this.state(id,intent);
 }
 async execute(api:API,id:string){
  if(!/^[a-f0-9]{64}$/.test(id))throw fail();const key="corporateWorkflowCreation:"+id,intent=this.storage.get<Intent>(key);if(!intent)throw fail();
  await api.checkPrivateVersionRead(intent.project,intent.source,intent.head);
  if(!intent.result){intent.attempted=true;this.storage.put(key,intent);intent.result=await api.createPrivateDocument(intent.project,intent.request);this.storage.put(key,intent);}
  const doc=await api.readDraftDocument(intent.project,intent.result.node_id);if(!doc.exists)throw fail();return this.state(id,intent);
 }
}
