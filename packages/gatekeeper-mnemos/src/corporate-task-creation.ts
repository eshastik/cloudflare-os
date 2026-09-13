import {CorporateWorkflows} from "./corporate-workflow.ts";
import {CorporateUpdates} from "./corporate-update.ts";
import type {BitrixTaskMapping} from "./corporate-import.ts";
import {CorporateCards} from "./corporate-card.ts";
import type {AccountStorage,MnemosAccountSession} from "./account-session.ts";
import type {PrivateDocumentCreate} from "./mnemos-api.ts";
type API=Pick<MnemosAccountSession,"prepareMappedJiraTask"|"prepareJiraFile"|"prepareBitrixFile"|"previewJiraImport"|"previewBitrixImport"|"prepareBitrixRecord"|"prepareMappedBitrixTask"|"prepareJiraTask"|"checkPrivateVersionRead"|"beginNativeUpload"|"createPrivateDocument"|"readDraftDocument">;
interface Intent {document?:{name:string;content_type:string};assignment?:{status:string;assignee:string};project:string;node:string;head:string;issue:string;hash:string;request:PrivateDocumentCreate;result?:{node_id:string;head:string};attempted?:boolean;}
export interface CorporateTaskState {document?:{name:string;content_type:string};assignment?:{status:string;assignee:string};id:string;name:string;state:"prepared"|"unconfirmed"|"created";node_id?:string;}
const digest=async(bytes:Uint8Array)=>{const sum=new Uint8Array(await crypto.subtle.digest("SHA-256",new Uint8Array(bytes)));return {hex:Array.from(sum,b=>b.toString(16).padStart(2,"0")).join(""),base64:btoa(String.fromCharCode(...sum))};};
/** Account-scoped durable creation intent. Source content is never stored here. */
export class CorporateTaskCreation {
 private cards:CorporateCards;
 private workflows:CorporateWorkflows;
 private updates:CorporateUpdates;
 private tail:Promise<unknown>=Promise.resolve();
 constructor(private storage:AccountStorage,private origin:string,private fetcher:typeof fetch=fetch){this.workflows=new CorporateWorkflows(storage,origin,fetcher);this.cards=new CorporateCards(origin,fetcher);this.updates=new CorporateUpdates(storage,origin,fetcher);}
 prepareWorkflow(api:Parameters<CorporateWorkflows["prepare"]>[0],project:string,shown:Parameters<CorporateWorkflows["prepare"]>[2],plan:unknown,confirmed:boolean){return this.serial(()=>this.workflows.prepare(api,project,shown,plan,confirmed));}
 executeWorkflow(api:Parameters<CorporateWorkflows["execute"]>[0],id:string){return this.serial(()=>this.workflows.execute(api,id));}
 prepareUpdate(api:Parameters<CorporateUpdates["prepare"]>[0],project:string,shown:Parameters<CorporateUpdates["prepare"]>[2]){return this.serial(()=>this.updates.prepare(api,project,shown));}
 executeUpdate(api:Parameters<CorporateUpdates["execute"]>[0],id:string){return this.serial(()=>this.updates.execute(api,id));}
 recoverUpdate(api:Parameters<CorporateUpdates["recover"]>[0],project:string,node:string){return this.updates.recover(api,project,node);}
 async resolveCardLink(api:Parameters<CorporateCards["read"]>[0]&Pick<MnemosAccountSession,"resolveCorporateTarget">,project:string,node:string,head:string,index:number){
  const card=await this.cards.read(api,project,node);if(card.head!==head||!Number.isSafeInteger(index)||index<0||index>=card.references.length)throw Error("Card changed");
  const ref=card.references[index];if(!["company","contact","person","department"].includes(ref.kind))return {node_id:""};
  return api.resolveCorporateTarget(project,node,head,["company","contact"].includes(ref.kind)?"client":ref.kind,ref.kind+":"+ref.id);
 }
 readCard(api:Parameters<CorporateCards["read"]>[0],project:string,node:string){return this.cards.read(api,project,node);}
 saveCard(api:Parameters<CorporateCards["save"]>[0],project:string,node:string,head:string,title:string,notes:string){return this.serial(()=>this.cards.save(api,project,node,head,title,notes));}
 private serial<T>(work:()=>Promise<T>):Promise<T>{const next=this.tail.catch(()=>{}).then(work);this.tail=next;return next;}
 private state(id:string,i:Intent):CorporateTaskState{return {id,...(i.document?{document:i.document}:{}),...(i.assignment?{assignment:i.assignment}:{}),name:i.request.name,state:i.result?"created":i.attempted?"unconfirmed":"prepared",...(i.result?{node_id:i.result.node_id}:{})};}
 prepare(api:API,project:string,node:string,head:string,issue:string,kind?:string,mapping?:BitrixTaskMapping,jiraIssue?:string){return this.serial(async()=>{
  if((kind==="task"||kind==="jira-task")!==!!mapping)throw Error("Explicit task mapping required");
  const jiraMapped=kind==="jira-task";const jiraFile=kind==="attachment";if(jiraFile&&!jiraIssue)throw Error("Attachment issue required");
  const source=await (kind&&!jiraFile&&!jiraMapped?api.previewBitrixImport(project,node,head):api.previewJiraImport(project,node,head));
  const entity=kind&&!jiraMapped?kind+":"+issue:issue;
  const selected="issues" in source.preview?(jiraFile?!!source.preview.attachments?.some(a=>a.id===issue&&a.issue_id===jiraIssue):(!kind||jiraMapped)&&source.preview.issues.some(i=>i.id===issue)):(!!kind&&source.preview.records.some(r=>r.id===issue&&r.kind===kind));
  if(source.source_node_id!==node||source.source_head!==head||!selected||!/^[a-f0-9]{64}$/.test(source.source_sha256))throw Error("Invalid import source");
  const id=(await digest(new TextEncoder().encode(JSON.stringify(kind?[jiraFile||jiraMapped?"jira":"bitrix24",project,node,source.source_sha256,entity,mapping?Object.fromEntries(Object.entries(mapping).sort(([a],[b])=>a.localeCompare(b))):"copy"]:[project,node,source.source_sha256,issue,"review"])))).hex;
  const key="corporateTaskCreation:"+id;let saved=this.storage.get<Intent>(key);
  if(saved){await api.checkPrivateVersionRead(saved.project,saved.node,saved.head);if(saved.result){const current=await api.readDraftDocument(saved.project,saved.result.node_id);if(!current.exists)throw Error("Created import unavailable");}return this.state(id,saved);}
  const fileInfo=jiraFile&&"issues" in source.preview?source.preview.attachments?.find(f=>f.id===issue&&f.issue_id===jiraIssue):kind==="file"&&"records" in source.preview?source.preview.files?.find(f=>f.object_id===issue):undefined;
  if((kind==="file"||jiraFile)&&(!fileInfo?.available||!fileInfo.content_type||!fileInfo.sha256))throw Error("File contents unavailable");
  const prepared=await (jiraFile?api.prepareJiraFile(project,node,head,jiraIssue!,issue):kind==="file"?api.prepareBitrixFile(project,node,head,issue):mapping?(jiraMapped?api.prepareMappedJiraTask(project,node,head,issue,mapping):api.prepareMappedBitrixTask(project,node,head,issue,mapping)):kind?api.prepareBitrixRecord(project,node,head,kind,issue):api.prepareJiraTask(project,node,head,issue));
  const binary="content_base64" in prepared;
  const bytes=binary?Uint8Array.from(atob(prepared.content_base64),c=>c.charCodeAt(0)):new TextEncoder().encode(prepared.content),sum=await digest(bytes);
  const preparedEntity=binary?prepared.entity_id:prepared.issue_id;
  if(binary!==(kind==="file"||jiraFile)||prepared.source_node_id!==node||prepared.source_head!==head||preparedEntity!==entity||prepared.content_type!==(fileInfo?fileInfo.content_type:kind&&!mapping?"application/json":"application/vnd.mnemos.task-tracker+json")||prepared.sha256!==sum.hex||!prepared.preview_id||bytes.length>4*1024*1024||(fileInfo&&(prepared.sha256!==fileInfo.sha256||bytes.length!==fileInfo.size_bytes)))throw Error("Invalid prepared import");
  const name=fileInfo?fileInfo.name:jiraMapped?"Jira "+issue.slice(0,80):kind?"Bitrix24 "+entity.slice(0,80):"Разбор Jira "+issue.slice(0,80);
  if(!name||/[\/\\\0]/.test(name)||new TextEncoder().encode(name).length>255)throw Error("Invalid import filename");

  const origin=new URL(this.origin);if(origin.protocol!=="https:"||origin.origin!==this.origin)throw Error("Invalid upload origin");
  const ticket=await api.beginNativeUpload(project,bytes.length,sum.base64);const url=new URL(ticket.url);
  if(url.origin!==origin.origin||url.username||url.password||url.hash||ticket.method!=="PUT"||ticket.content_length!==bytes.length||ticket.checksum_header.toLowerCase()!=="x-amz-checksum-sha256"||ticket.checksum_value!==sum.base64)throw Error("Invalid upload ticket");
  const fetcher=this.fetcher;const response=await fetcher(url,{method:"PUT",redirect:"manual",headers:{[ticket.checksum_header]:sum.base64},body:bytes});if(!response.ok)throw Error("Upload not confirmed");
  await api.checkPrivateVersionRead(project,node,head);
  saved={...(fileInfo?{document:{name,content_type:prepared.content_type}}:{}),...(mapping?{assignment:{status:mapping.status,assignee:mapping.assignee_id}}:{}),project,node,head,issue,hash:source.source_sha256,request:{request_id:crypto.randomUUID(),expected_head:head,parent_id:"",name,content_type:prepared.content_type,upload_id:ticket.upload_id,corporate_preview_id:prepared.preview_id,message:jiraMapped?"Create explicitly mapped Jira task":jiraFile?"Copy selected Jira attachment":kind?"Copy selected Bitrix24 record":"Create explicitly requested Jira review task"}};
  this.storage.put(key,saved);return this.state(id,saved);
 });}
 execute(api:API,id:string){return this.serial(async()=>{
  if(!/^[a-f0-9]{64}$/.test(id))throw Error("Invalid creation selection");const key="corporateTaskCreation:"+id;const saved=this.storage.get<Intent>(key);if(!saved)throw Error("No prepared import");
  await api.checkPrivateVersionRead(saved.project,saved.node,saved.head);
  if(!saved.result){saved.attempted=true;this.storage.put(key,saved);const result=await api.createPrivateDocument(saved.project,saved.request);saved.result=result;this.storage.put(key,saved);}
  const current=await api.readDraftDocument(saved.project,saved.result.node_id);if(!current.exists)throw Error("Created import unavailable");return this.state(id,saved);
 });}
}
export type CorporateTaskManagement={prepareSharedCorporateWorkflow:(project:string,shown:Parameters<CorporateWorkflows["prepare"]>[2],plan:unknown,confirmed:boolean)=>ReturnType<CorporateTaskCreation["prepareWorkflow"]>;executeSharedCorporateWorkflow:(id:string)=>ReturnType<CorporateTaskCreation["executeWorkflow"]>;prepareMappedJiraCorporateTask:(project:string,node:string,head:string,issue:string,mapping:BitrixTaskMapping)=>ReturnType<CorporateTaskCreation["prepare"]>;prepareCorporateAttachment:(project:string,node:string,head:string,issue:string,attachment:string)=>ReturnType<CorporateTaskCreation["prepare"]>;prepareCorporateUpdate:(project:string,shown:Parameters<CorporateUpdates["prepare"]>[2])=>ReturnType<CorporateTaskCreation["prepareUpdate"]>;executeCorporateUpdate:(id:string)=>ReturnType<CorporateTaskCreation["executeUpdate"]>;recoverCorporateUpdate:(project:string,node:string)=>ReturnType<CorporateTaskCreation["recoverUpdate"]>;prepareMappedCorporateTask:(project:string,node:string,head:string,issue:string,mapping:BitrixTaskMapping)=>ReturnType<CorporateTaskCreation["prepare"]>;resolveCorporateCardLink:(project:string,node:string,head:string,index:number)=>ReturnType<CorporateTaskCreation["resolveCardLink"]>;readCorporateCard:(project:string,node:string)=>ReturnType<CorporateTaskCreation["readCard"]>;saveCorporateCard:(project:string,node:string,head:string,title:string,notes:string)=>ReturnType<CorporateTaskCreation["saveCard"]>;prepareCorporateRecord:(project:string,node:string,head:string,kind:string,issue:string)=>ReturnType<CorporateTaskCreation["prepare"]>;prepareCorporateTask:(project:string,node:string,head:string,issue:string)=>ReturnType<CorporateTaskCreation["prepare"]>;executeCorporateTask:(id:string)=>ReturnType<CorporateTaskCreation["execute"]>};
