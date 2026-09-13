import type {AccountStorage,MnemosAccountSession} from "./account-session.ts";
export interface TrackerSetup {title:string;stages:{id:string;name:string;department:string}[];transitions:{from:string;to:string}[]}
export interface TrackerCreationIntent {id:string;project:string;setup:TrackerSetup;head?:string;upload?:string;attempted?:boolean;result?:{node_id:string;head:string}}
type API=Pick<MnemosAccountSession,"listPrivateDocuments"|"draftState"|"openDraft"|"beginNativeUpload"|"createPrivateDocument"|"readDraftDocument">;
function validate(project:string,setup:TrackerSetup){
 const id=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/;const text=(s:unknown,max:number)=>typeof s==='string'&&s.trim()&&!s.includes('\0')&&new TextEncoder().encode(s).length<=max;
 if(!id.test(project)||!setup||!text(setup.title,255)||/[\/\\]/.test(setup.title)||!Array.isArray(setup.stages)||setup.stages.length<1||setup.stages.length>64||!Array.isArray(setup.transitions)||setup.transitions.length>4032)throw Error('Invalid tracker setup');
 const ids=new Set<string>();for(const stage of setup.stages){if(!id.test(stage.id)||ids.has(stage.id)||!text(stage.name,512)||!text(stage.department,512))throw Error('Invalid tracker stage');ids.add(stage.id);}
 const edges=new Set<string>();for(const edge of setup.transitions){const key=JSON.stringify([edge.from,edge.to]);if(!ids.has(edge.from)||!ids.has(edge.to)||edge.from===edge.to||edges.has(key))throw Error('Invalid tracker transition');edges.add(key);}
 if(new TextEncoder().encode(JSON.stringify(setup)).length>100000)throw Error('Tracker setup too large');
}
/** Account-owned creation receipt survives iframe closure and uncertain POSTs. */
export class TrackerCreation {
 #tail:Promise<unknown>=Promise.resolve();
 constructor(private storage:AccountStorage,private storageOrigin:string,private fetcher:typeof fetch=fetch){}
 private key(project:string){if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/.test(project))throw Error('Invalid project');return 'trackerCreation:'+project;}
 async read(api:API,project:string){const key=this.key(project);await api.listPrivateDocuments(project);const value=this.storage.get<TrackerCreationIntent>(key);return value?structuredClone(value):null;}
 async save(api:API,project:string,setup:TrackerSetup,expected:string){validate(project,setup);await api.listPrivateDocuments(project);const key=this.key(project),previous=this.storage.get<TrackerCreationIntent>(key);if(previous&&!previous.result){if(JSON.stringify(previous.setup)===JSON.stringify(setup))return structuredClone(previous);throw Error('Unresolved tracker creation');}if((previous?.id??'')!==expected)throw Error('Creation request changed');const saved:TrackerCreationIntent={id:crypto.randomUUID(),project,setup:structuredClone(setup)};this.storage.put(key,saved);return structuredClone(saved);}
 execute(api:API,project:string,id:string):Promise<TrackerCreationIntent>{const work=this.#tail.catch(()=>{}).then(()=>this.executeOnce(api,project,id));this.#tail=work;return work;}
 private async executeOnce(api:API,project:string,id:string){
  const intent=await this.read(api,project);if(!intent||intent.id!==id)throw Error('Creation request changed');validate(project,intent.setup);
  const save=()=>this.storage.put(this.key(project),intent);
  if(intent.result){const doc=await api.readDraftDocument(project,intent.result.node_id);if(!doc.exists)throw Error('Created tracker unavailable');return intent;}
  if(!intent.head){intent.head=(await api.openDraft(project)).head;save();}
  if(!intent.upload){
   const bytes=new TextEncoder().encode(JSON.stringify({format:'mnemos.task-tracker',format_version:1,revision:1,title:intent.setup.title,stages:intent.setup.stages,transitions:intent.setup.transitions,tasks:[]}));
   const checksum=btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))));const ticket=await api.beginNativeUpload(project,bytes.length,checksum);const url=new URL(ticket.url),origin=new URL(this.storageOrigin);
   if(origin.protocol!=='https:'||origin.origin!==this.storageOrigin||url.origin!==origin.origin||url.username||url.password||url.hash||ticket.method!=='PUT'||ticket.content_length!==bytes.length||ticket.checksum_header.toLowerCase()!=='x-amz-checksum-sha256'||ticket.checksum_value!==checksum)throw Error('Invalid tracker upload ticket');
   const fetcher=this.fetcher;const response=await fetcher(url,{method:'PUT',redirect:'manual',signal:AbortSignal.timeout(20000),headers:{[ticket.checksum_header]:checksum},body:bytes});if(!response.ok)throw Error('Tracker upload not confirmed');
   await api.draftState(project);intent.upload=ticket.upload_id;save();
  }
  intent.attempted=true;save();
  const result=await api.createPrivateDocument(project,{request_id:intent.id,expected_head:intent.head,parent_id:'',name:intent.setup.title,content_type:'application/vnd.mnemos.task-tracker+json',upload_id:intent.upload,message:'Create optional project tracker'});
  intent.result=result;save();const doc=await api.readDraftDocument(project,result.node_id);if(!doc.exists)throw Error('Created tracker unavailable');return intent;
 }
}
export type TrackerManagement={readTrackerCreation:(project:string)=>ReturnType<TrackerCreation['read']>;saveTrackerCreation:(project:string,setup:TrackerSetup,expected:string)=>ReturnType<TrackerCreation['save']>;executeTrackerCreation:(project:string,id:string)=>ReturnType<TrackerCreation['execute']>};
