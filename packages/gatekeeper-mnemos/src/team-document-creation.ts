import type {AccountStorage, MnemosAccountSession} from "./account-session.ts";

/** Fixed creation coordinates, scoped by account storage and source snapshot. */
interface Intent {
 project:string;proposal:string;source:string;request:string;name:string;
 head?:string;upload?:string;attempted?:boolean;result?:{node_id:string;head:string};
}
type API=Pick<MnemosAccountSession,"readTeamBudget"|"readTeamResultDraft"|"openDraft"|"beginNativeUpload"|"createPrivateDocument"|"readDraftDocument">;

/** One coordinator per account, reusing the ordinary private document creation API. */
export class TeamDocumentCreation {
 #tail:Promise<unknown>=Promise.resolve();
 constructor(private storage:AccountStorage,private storageOrigin:string,private fetcher:typeof fetch=fetch){}
 create(api:API,project:string,proposal:string,source:string):Promise<{node_id:string;head:string}> {
  const work=this.#tail.catch(()=>{}).then(()=>this.#create(api,project,proposal,source));
  this.#tail=work;return work;
 }
 async #create(api:API,project:string,proposal:string,source:string) {
  if(!project||!proposal||!/^[a-f0-9]{64}$/.test(source))throw new Error("Invalid team document source");
  const origin=new URL(this.storageOrigin);
  if(origin.protocol!=="https:"||origin.origin!==this.storageOrigin)throw new Error("Invalid document storage");
  // Current source access is required even when returning a saved receipt.
  await api.readTeamBudget(project,proposal);
  const digest=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify([project,proposal,source]))));
  const key="teamDocumentCreation:"+Array.from(digest,b=>b.toString(16).padStart(2,"0")).join("");
  let intent=this.storage.get<Intent>(key);
  if(!intent){intent={project,proposal,source,request:crypto.randomUUID(),name:"Итог команды "+proposal.slice(0,12)};this.storage.put(key,intent);}
  const save=()=>this.storage.put(key,intent!);
  if(intent.result){const current=await api.readDraftDocument(project,intent.result.node_id);if(!current.exists)throw new Error("Created document is no longer present");return intent.result;}
  if(!intent.attempted) {
   const prepared=await api.readTeamResultDraft(project,proposal);
   if(prepared.source.snapshot_sha256!==source||!prepared.source.all_parts_shared||!prepared.document)throw new Error("Team source changed; prepare a new snapshot");
   if(!intent.head){intent.head=(await api.openDraft(project)).head;save();}
   if(!intent.upload){
    const bytes=new TextEncoder().encode(JSON.stringify(prepared.document));
    const sum=new Uint8Array(await crypto.subtle.digest("SHA-256",bytes));
    const checksum=btoa(String.fromCharCode(...sum));
    const ticket=await api.beginNativeUpload(project,bytes.length,checksum);
    const url=new URL(ticket.url);
    if(url.origin!==origin.origin||url.username||url.password||url.hash||ticket.method!=="PUT"||ticket.content_length!==bytes.length||ticket.checksum_header.toLowerCase()!=="x-amz-checksum-sha256"||ticket.checksum_value!==checksum)throw new Error("Invalid document upload ticket");
    const fetcher=this.fetcher;
    const response=await fetcher(url,{method:"PUT",redirect:"manual",headers:{[ticket.checksum_header]:checksum},body:bytes});
    if(!response.ok)throw new Error("Document upload not confirmed");
    intent.upload=ticket.upload_id;save();
   }
   const current=await api.readTeamResultDraft(project,proposal);
   if(current.source.snapshot_sha256!==source||!current.source.all_parts_shared)throw new Error("Team source changed before creation");
   intent.attempted=true;save();
  }
  if(!intent.head||!intent.upload)throw new Error("Document creation receipt incomplete");
  // A lost POST response must replay these exact coordinates, even if the draft
  // head or source subsequently changed. Mnemos authorizes replay itself.
  const result=await api.createPrivateDocument(project,{request_id:intent.request,expected_head:intent.head,parent_id:"",name:intent.name,content_type:"application/vnd.cloudflareos.document+json",upload_id:intent.upload,message:"Create team result snapshot "+source});
  intent.result=result;save();const current=await api.readDraftDocument(project,result.node_id);if(!current.exists)throw new Error("Created document is no longer present");return result;
 }
}

/** Browser-safe contract derived from the implementation, without Worker globals. */
type CreationArguments=Parameters<TeamDocumentCreation["create"]> extends [API,...infer Args] ? Args : never;
export type TeamDocumentManagement={readTeamResultDraft:API["readTeamResultDraft"];createTeamResultDocument:(...args:CreationArguments)=>ReturnType<TeamDocumentCreation["create"]>};
