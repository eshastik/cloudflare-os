import type {DriveImportSnapshot} from "@gadgets/workshop-shared/drive-import";
import {fetchWithAuthRetry,type AccessTokenProvider} from './auth-retry';

const BASE='https://www.googleapis.com/drive/v3/files/';
const MAX_BYTES=16*1024*1024;
const EXPORTS:Record<string,string>={
 'application/vnd.google-apps.document':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
 'application/vnd.google-apps.spreadsheet':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
 'application/vnd.google-apps.presentation':'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
interface Metadata {id:string;name:string;mimeType:string;version:string;size?:string;sha256Checksum?:string;trashed:boolean;capabilities:{canDownload:boolean}}

async function boundedBody(response:Response,limit:number):Promise<Uint8Array>{
 const declared=response.headers.get('Content-Length');
 if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>limit)){await response.body?.cancel();throw Error('Drive import exceeds size limit.')}
 const reader=response.body?.getReader();if(!reader)throw Error('Drive response body unavailable.');
 const chunks:Uint8Array[]=[];let length=0;
 try{
  for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>limit){await reader.cancel();throw Error('Drive import exceeds size limit.')}chunks.push(value)}
 }finally{reader.releaseLock()}
 const out=new Uint8Array(length);let offset=0;for(const chunk of chunks){out.set(chunk,offset);offset+=chunk.length}return out;
}

/** Capture one selected source using GET only. No remote links from metadata are followed.
 * The caller supplies the owning account's revocation check, independently of token refresh.
 * This returns original bytes or an explicitly identified Workspace export, not native Mnemos content. */
export class GoogleDriveImportReader {
 constructor(private token:AccessTokenProvider,private validateOwner:()=>Promise<void>){}
 async #get(url:string,signal:AbortSignal){
  await this.validateOwner();
  const response=await fetchWithAuthRetry(url,{method:'GET',redirect:'manual',signal},this.token,{retries:1});
  if(response.status!==200){await response.body?.cancel();throw Error('Drive source unavailable.')}
  return response;
 }
 async #metadata(id:string,signal:AbortSignal):Promise<Metadata>{
  const query=new URLSearchParams({supportsAllDrives:'true',fields:'id,name,mimeType,version,size,sha256Checksum,trashed,capabilities(canDownload)'});
  const response=await this.#get(BASE+id+'?'+query,signal);
  const data=await boundedBody(response,64*1024);
  let value:Metadata;
  try { value=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(data)); }
  catch { throw Error('Invalid Drive metadata response.'); }
  if(!value||value.id!==id||typeof value.name!=='string'||!value.name||value.name.length>4096||
     typeof value.mimeType!=='string'||!value.mimeType||value.mimeType.length>255||
     typeof value.version!=='string'||!/^\d{1,32}$/.test(value.version)||value.trashed!==false||value.capabilities?.canDownload!==true)
   throw Error('Drive source metadata unavailable.');
  if(value.sha256Checksum!==undefined&&(typeof value.sha256Checksum!=='string'||!/^[a-f0-9]{64}$/.test(value.sha256Checksum)))throw Error('Drive source checksum unavailable.');
  return value;
 }
 async snapshot(fileId:string):Promise<DriveImportSnapshot>{
  if(typeof fileId!=='string'||!/^[A-Za-z0-9_-]{1,255}$/.test(fileId))throw Error('Invalid Drive file selection.');
  const signal=AbortSignal.timeout(30000);
  const before=await this.#metadata(fileId,signal);
  const exported=before.mimeType.startsWith('application/vnd.google-apps.');
  const contentType=exported?EXPORTS[before.mimeType]:before.mimeType;
  if(!contentType)throw Error('Unsupported Google Workspace export.');
  if(!exported&&(typeof before.size!=='string'||!/^\d{1,32}$/.test(before.size)||BigInt(before.size)>BigInt(MAX_BYTES)))throw Error('Drive source size unavailable or exceeds limit.');
  const query=new URLSearchParams(exported?{mimeType:contentType}:{alt:'media',supportsAllDrives:'true'});
  const response=await this.#get(BASE+fileId+(exported?'/export':'')+'?'+query,signal);
  if(response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!==contentType.toLowerCase()){
   await response.body?.cancel();throw Error('Unexpected Drive content type.');
  }
  const bytes=await boundedBody(response,MAX_BYTES);
  if(!exported&&BigInt(bytes.length)!==BigInt(before.size!))throw Error('Incomplete Drive file.');
  const after=await this.#metadata(fileId,signal);
  if(after.version!==before.version||after.name!==before.name||after.mimeType!==before.mimeType||after.size!==before.size||after.sha256Checksum!==before.sha256Checksum)throw Error('Drive source changed during import.');
  const hash=await crypto.subtle.digest('SHA-256',bytes);
  const sha256=[...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('');
  if(!exported&&before.sha256Checksum!==undefined&&before.sha256Checksum!==sha256)throw Error('Drive file checksum mismatch.');
  await this.validateOwner();
  return {provider:'google-drive',fileId,sourceVersion:before.version,sourceName:before.name,sourceMimeType:before.mimeType,contentType,exported,bytes,
   sha256};
 }
}
