import type {AccountStorage,MnemosAccountSession} from "./account-session.ts";
export interface ResourceMapSetup {title:string}
export interface ResourceMapCreationIntent {id:string;project:string;setup:ResourceMapSetup;head?:string;upload?:string;attempted?:boolean;result?:{node_id:string;head:string}}
type API=Pick<MnemosAccountSession,"listPrivateDocuments"|"draftState"|"openDraft"|"beginNativeUpload"|"createPrivateDocument"|"readDraftDocument">;
function validate(project:string,setup:ResourceMapSetup){
 if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/.test(project)||!setup||typeof setup.title!=="string"||!setup.title.trim()||/[\/\\\0]/.test(setup.title)||new TextEncoder().encode(setup.title).length>255)throw Error("Invalid resource map setup");
}
/** Account-owned creation receipt survives iframe closure and uncertain POSTs. */
export class ResourceMapCreation {
 #tail:Promise<unknown>=Promise.resolve();
 constructor(private storage:AccountStorage,private storageOrigin:string,private fetcher:typeof fetch=fetch){}
 private key(project:string){if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/.test(project))throw Error('Invalid project');return 'resourceMapCreation:'+project;}
 async read(api:API,project:string){const key=this.key(project);await api.listPrivateDocuments(project);const value=this.storage.get<ResourceMapCreationIntent>(key);return value?structuredClone(value):null;}
 async save(api:API,project:string,setup:ResourceMapSetup,expected:string){validate(project,setup);await api.draftState(project);const key=this.key(project),previous=this.storage.get<ResourceMapCreationIntent>(key);if(previous&&!previous.result){if(JSON.stringify(previous.setup)===JSON.stringify(setup))return structuredClone(previous);throw Error('Unresolved resourceMap creation');}if((previous?.id??'')!==expected)throw Error('Creation request changed');const saved:ResourceMapCreationIntent={id:crypto.randomUUID(),project,setup:structuredClone(setup)};this.storage.put(key,saved);return structuredClone(saved);}
 execute(api:API,project:string,id:string):Promise<ResourceMapCreationIntent>{const work=this.#tail.catch(()=>{}).then(()=>this.executeOnce(api,project,id));this.#tail=work;return work;}
 private async executeOnce(api:API,project:string,id:string){
  const intent=await this.read(api,project);if(!intent||intent.id!==id)throw Error('Creation request changed');validate(project,intent.setup);
  const save=()=>this.storage.put(this.key(project),intent);
  if(intent.result){const doc=await api.readDraftDocument(project,intent.result.node_id);if(!doc.exists)throw Error('Created resourceMap unavailable');return intent;}
  if(!intent.head){intent.head=(await api.openDraft(project)).head;save();}
  if(!intent.upload){
   const bytes=new TextEncoder().encode(JSON.stringify({format:'mnemos.resource-map',format_version:1,revision:1,title:intent.setup.title,resources:[],links:[]}));
   const checksum=btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))));const ticket=await api.beginNativeUpload(project,bytes.length,checksum);const url=new URL(ticket.url),origin=new URL(this.storageOrigin);
   if(origin.protocol!=='https:'||origin.origin!==this.storageOrigin||url.origin!==origin.origin||url.username||url.password||url.hash||ticket.method!=='PUT'||ticket.content_length!==bytes.length||ticket.checksum_header.toLowerCase()!=='x-amz-checksum-sha256'||ticket.checksum_value!==checksum)throw Error('Invalid resourceMap upload ticket');
   const fetcher=this.fetcher;const response=await fetcher(url,{method:'PUT',redirect:'manual',signal:AbortSignal.timeout(20000),headers:{[ticket.checksum_header]:checksum},body:bytes});if(!response.ok)throw Error('ResourceMap upload not confirmed');
   await api.draftState(project);intent.upload=ticket.upload_id;save();
  }
  intent.attempted=true;save();
  const result=await api.createPrivateDocument(project,{request_id:intent.id,expected_head:intent.head,parent_id:'',name:intent.setup.title,content_type:'application/vnd.mnemos.resource-map+json',upload_id:intent.upload,message:'Create project resource map'});
  intent.result=result;save();const doc=await api.readDraftDocument(project,result.node_id);if(!doc.exists)throw Error('Created resourceMap unavailable');return intent;
 }
}
export type ResourceMapManagement={readResourceMapCreation:(project:string)=>ReturnType<ResourceMapCreation['read']>;saveResourceMapCreation:(project:string,setup:ResourceMapSetup,expected:string)=>ReturnType<ResourceMapCreation['save']>;executeResourceMapCreation:(project:string,id:string)=>ReturnType<ResourceMapCreation['execute']>};
