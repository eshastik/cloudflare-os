import type {DriveImportSnapshot,DriveImportOrigin,DriveImportReceipt} from '@gadgets/workshop-shared/drive-import';
import type {AccountStorage,MnemosAccountSession} from './account-session.ts';

type API=Pick<MnemosAccountSession,'openDraft'|'beginImportUpload'|'createPrivateDocument'|'readDraftDocument'>;
type Origin=DriveImportOrigin;
export interface DriveCaptureInput {project:string;request:string;sourceKey:string;fileId:string}
export interface DriveCaptureSource {read():Promise<DriveImportSnapshot>;validate():Promise<void>}
export type DriveCaptureReceipt=DriveImportReceipt;
type CaptureStorage=AccountStorage & {list?<T>(options:{prefix:string;startAfter?:string;limit:number}):Iterable<[string,T]>};
interface CapturedIdentity {provider?:Origin['provider'];sourceKey:string;fileId:string;head:string;sha256:string}
interface CapturedVersion {source_node_id:string;source_head:string;source_sha256:string}
export type DriveOriginIssuer=(value:{input:DriveCaptureInput;origin:Origin;head:string;upload:string})=>Promise<string>;
interface Intent {proof?:string;input:DriveCaptureInput;source?:Origin;head?:string;upload?:string;attempted?:boolean;result?:DriveCaptureReceipt}
function captureName(name:string){
 let result='',size=0;
 for(const char of name.replace(/[\/\\\x00-\x1f\x7f]/g,'_')){const length=new TextEncoder().encode(char).length;if(size+length>200)break;result+=char;size+=length}
 return result;
}
function id(value:string){return typeof value==='string'&&!!value&&value.length<=255&&!/[\x00-\x1f\x7f]/.test(value)}

/** Save an immutable source copy in the owner's personal branch using ordinary Mnemos uploads.
 * Keep one coordinator per UserAccount. The trusted host supplies the source, never an iframe URL.
 * Receipts retain original bytes' provenance; native parsing/publication happen separately. */
export class DriveImportCapture {
 #tail:Promise<unknown>=Promise.resolve();
 constructor(private storage:CaptureStorage,private storageOrigin:string,private fetcher:typeof fetch=fetch){}
 /** Compare account-owned capture records without exposing the external account key.
  * Unrecorded local Office uploads retain their existing import workflow. */
 validateUpdateSource(project:string,baseline:CapturedVersion,incoming:CapturedVersion):void {
  const read=(version:CapturedVersion)=>this.storage.get<CapturedIdentity>(this.#identityKey(project,version.source_node_id));
  if(!read(baseline)||!read(incoming))this.#restoreIdentities(project);
  const previous=read(baseline),next=read(incoming);
  if(!previous&&!next)return;
  if(!previous||!next||(previous.provider??'google-drive')!==(next.provider??'google-drive')||previous.sourceKey!==next.sourceKey||previous.fileId!==next.fileId||
     previous.head!==baseline.source_head||previous.sha256!==baseline.source_sha256||
     next.head!==incoming.source_head||next.sha256!==incoming.source_sha256)throw Error('Update requires the same captured Drive file and account.');
 }
 /** Older captures already contain trusted provenance. Rebuild its lookup in resumable pages,
  * without refetching the external file or repeating a document creation. */
 #restoreIdentities(project:string){
  if(!this.storage.list)return;
  const marker='driveImportSourceIndex:'+JSON.stringify(project);
  let progress=this.storage.get<{after?:string;complete?:boolean}>(marker)??{};
  if(progress.complete)return;
  const prefix='driveImportCapture:'+JSON.stringify([project]).slice(0,-1)+',';
  // Bound one RPC: large historical projects resume from the saved cursor.
  for(let pages=0;!progress.complete&&pages<10;pages++){
   const records=[...this.storage.list<Intent>({prefix,startAfter:progress.after,limit:100})];
   for(const [key,intent] of records){
    if(intent.result){
     if(intent.input.project!==project||key!=='driveImportCapture:'+JSON.stringify([project,intent.input.request])||intent.result.source.fileId!==intent.input.fileId)throw Error('Stored Drive capture coordinates changed.');
     this.#remember(intent.input,intent.result);
    }
    progress={after:key};
   }
   if(records.length<100)progress={...progress,complete:true};
   this.storage.put(marker,progress);
  }
  if(!progress.complete)throw Error("Source history recovery is incomplete; retry the review.");
 }
 #identityKey(project:string,node:string){return 'driveImportSource:'+JSON.stringify([project,node])}
 #remember(input:DriveCaptureInput,result:DriveCaptureReceipt){
  const key=this.#identityKey(input.project,result.node_id);
  const identity:CapturedIdentity={provider:result.source.provider,sourceKey:input.sourceKey,fileId:result.source.fileId,head:result.head,sha256:result.source.sha256};
  const previous=this.storage.get<CapturedIdentity>(key);
  if(previous&&((previous.provider??'google-drive')!==identity.provider||previous.sourceKey!==identity.sourceKey||previous.fileId!==identity.fileId||previous.head!==identity.head||previous.sha256!==identity.sha256))throw Error('Captured Drive identity changed.');
  this.storage.put(key,identity);
 }
 capture(api:API,input:DriveCaptureInput,source:DriveCaptureSource,issue?:DriveOriginIssuer):Promise<DriveCaptureReceipt>{
  const frozen={project:input.project,request:input.request,sourceKey:input.sourceKey,fileId:input.fileId};
  const work=this.#tail.catch(()=>{}).then(()=>this.#capture(api,frozen,source,issue));this.#tail=work;return work;
 }
 async #capture(api:API,input:DriveCaptureInput,source:DriveCaptureSource,issue?:DriveOriginIssuer){
  if(![input.project,input.request,input.fileId].every(id)||typeof input.sourceKey!=='string'||!input.sourceKey||input.sourceKey.length>8192||/[\x00-\x1f\x7f]/.test(input.sourceKey))throw Error('Invalid Drive capture coordinates.');
  const origin=new URL(this.storageOrigin);if(origin.protocol!=='https:'||origin.origin!==this.storageOrigin)throw Error('Invalid import storage.');
  const key='driveImportCapture:'+JSON.stringify([input.project,input.request]);
  let intent=this.storage.get<Intent>(key);
  if(intent&&JSON.stringify(intent.input)!==JSON.stringify(input))throw Error('Drive capture request changed.');
  if(!intent){intent={input};this.storage.put(key,intent)}
  const save=()=>this.storage.put(key,intent!);
  if(intent.result){await this.#checkResult(api,input.project,intent.result);this.#remember(input,intent.result);return intent.result}
  if(!intent.attempted){
   await source.validate();
   const snapshot=await source.read();
   if(!['google-drive','yandex-disk','webdav'].includes(snapshot.provider)||snapshot.fileId!==input.fileId||!id(snapshot.sourceVersion)||
      typeof snapshot.sourceName!=='string'||!snapshot.sourceName||snapshot.sourceName.length>4096||
      !id(snapshot.sourceMimeType)||!id(snapshot.contentType)||typeof snapshot.exported!=='boolean'||
      !(snapshot.bytes instanceof Uint8Array)||snapshot.bytes.length>16*1024*1024||!/^[a-f0-9]{64}$/.test(snapshot.sha256))throw Error('Invalid Drive capture.');
   const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',snapshot.bytes));
   if([...digest].map(x=>x.toString(16).padStart(2,'0')).join('')!==snapshot.sha256)throw Error('Drive capture checksum mismatch.');
   const bytes=snapshot.bytes;const captured:Origin={provider:snapshot.provider,fileId:snapshot.fileId,sourceVersion:snapshot.sourceVersion,sourceName:snapshot.sourceName,sourceMimeType:snapshot.sourceMimeType,contentType:snapshot.contentType,exported:snapshot.exported,sha256:snapshot.sha256,sizeBytes:bytes.length};
   if(intent.source&&JSON.stringify(intent.source)!==JSON.stringify(captured))throw Error('Drive source changed; use a new import request.');
   intent.source=captured;save();
   if(!intent.head){intent.head=(await api.openDraft(input.project)).head;save()}
   if(!intent.upload){
    const checksum=btoa(String.fromCharCode(...digest));
    const ticket=await api.beginImportUpload(input.project,bytes.length,checksum);const target=new URL(ticket.url);
    if(target.origin!==origin.origin||target.username||target.password||target.hash||ticket.method!=='PUT'||ticket.content_length!==bytes.length||
       ticket.checksum_header.toLowerCase()!=='x-amz-checksum-sha256'||ticket.checksum_value!==checksum)throw Error('Invalid import upload ticket.');
    const fetcher=this.fetcher;
    const response=await fetcher(target,{method:'PUT',redirect:'manual',signal:AbortSignal.timeout(30000),headers:{[ticket.checksum_header]:checksum},body:bytes});
    if(!response.ok)throw Error('Drive capture upload not confirmed.');
    intent.upload=ticket.upload_id;save();
   }
   await source.validate();
   if(issue&&!intent.proof){intent.proof=await issue({input:{...input},origin:{...intent.source!},head:intent.head!,upload:intent.upload!});if(!intent.proof||intent.proof.length>8192)throw Error('Invalid Drive origin proof.');save();}
   await source.validate();
   intent.attempted=true;save();
  }
  if(!intent.source||!intent.head||!intent.upload)throw Error('Incomplete Drive capture receipt.');
  // Once attempted, never fetch a newer source or allocate another creation request.
  // The ordinary API checks the current human and replays the original creation transaction.
  const result=await api.createPrivateDocument(input.project,{request_id:input.request,expected_head:intent.head,parent_id:'',
   ...(intent.proof?{drive_origin_proof:intent.proof}:{}),name:captureName(intent.source.sourceName),content_type:'application/octet-stream',upload_id:intent.upload,
   message:'Capture '+(intent.source.provider==='google-drive'?'Google Drive':intent.source.provider==='yandex-disk'?'Yandex Disk':'WebDAV')+' source '+intent.source.fileId+' version '+intent.source.sourceVersion});
  if(!id(result.node_id)||!id(result.head))throw Error('Invalid creation response.');
  intent.result={node_id:result.node_id,head:result.head,source:intent.source};save();await this.#checkResult(api,input.project,intent.result);this.#remember(input,intent.result);return intent.result;
 }
 async #checkResult(api:API,project:string,result:DriveCaptureReceipt){
  const current=await api.readDraftDocument(project,result.node_id);if(!current.exists)throw Error('Captured source is no longer present.');
 }
}
