import {YandexCredentialRejected} from './oauth.ts';
import type {DriveImportSnapshot} from '@gadgets/workshop-shared/drive-import';

const API='https://cloud-api.yandex.net/v1/disk/resources';
const LIMIT=16*1024*1024;
const DOWNLOAD_HOSTS=new Set(['downloader.disk.yandex.ru','downloader.disk.yandex.net','downloader.dst.yandex.ru']);
interface Metadata {path:string;name:string;type:'file';mime_type:string;modified:string;size:number;md5:string}
const text=(value:unknown,max:number):value is string=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\x00-\x1f\x7f]/.test(value);

async function body(response:Response,limit:number){
 const declared=response.headers.get('Content-Length');
 if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>limit)){await response.body?.cancel();throw Error('Disk import exceeds size limit.');}
 const reader=response.body?.getReader();if(!reader)throw Error('Disk response unavailable.');
 const parts:Uint8Array[]=[];let length=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>limit){await reader.cancel();throw Error('Disk import exceeds size limit.');}parts.push(value);}}
 finally{reader.releaseLock();}
 const bytes=new Uint8Array(length);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}return bytes;
}

/** Reads original bytes only. The owning account supplies credentials and a revocation check.
 * Disk paths are provider identities here; renames are not followed automatically. */
export class YandexDiskImportReader {
 #credential:()=>Promise<string>;
 #validate:()=>Promise<void>;
 #fetch:typeof fetch;
 constructor(credential:()=>Promise<string>,validate:()=>Promise<void>,fetcher:typeof fetch=fetch){this.#credential=credential;this.#validate=validate;this.#fetch=fetcher;}
 async #request(url:URL,signal:AbortSignal,authenticated:boolean){
  await this.#validate();
  const headers:Record<string,string>={};
  if(authenticated){
   const token=await this.#credential();
   if(!text(token,8192)||/\s/.test(token))throw Error('Disk credential unavailable.');
   headers.Authorization='OAuth '+token;
  }
  const fetcher=this.#fetch;
  let response:Response;
  try{response=await fetcher(url,{method:'GET',headers,redirect:'manual',signal});}
  catch{throw Error('Disk request failed.');}
  if(response.status!==200){await response.body?.cancel();if(authenticated&&response.status===401)throw new YandexCredentialRejected();throw Error('Disk source unavailable.');}
  return response;
 }
 async #json(url:URL,signal:AbortSignal):Promise<unknown>{
  const bytes=await body(await this.#request(url,signal,true),64*1024);
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(bytes));}catch{throw Error('Invalid Disk response.');}
 }
 async #metadata(path:string,signal:AbortSignal):Promise<Metadata>{
  const url=new URL(API);url.search=new URLSearchParams({path,fields:'path,name,type,mime_type,modified,size,md5'}).toString();
  const value=await this.#json(url,signal) as Metadata;
  if(!value||value.path!==path||value.type!=='file'||!text(value.name,4096)||!text(value.mime_type,255)||
     !text(value.modified,64)||!Number.isFinite(Date.parse(value.modified))||
     !Number.isSafeInteger(value.size)||value.size<0||value.size>LIMIT||typeof value.md5!=='string'||!/^[a-f0-9]{32}$/.test(value.md5))throw Error('Disk file metadata unavailable.');
  return {path:value.path,name:value.name,type:value.type,mime_type:value.mime_type,modified:value.modified,size:value.size,md5:value.md5};
 }
 async snapshot(fileId:string):Promise<DriveImportSnapshot>{
  if(!text(fileId,255)||!fileId.startsWith('disk:/')||fileId.slice(6).split('/').some(part=>!part||part==='.'||part==='..')||fileId.includes('\\'))throw Error('Invalid Disk file selection.');
  const signal=AbortSignal.timeout(30000);
  const before=await this.#metadata(fileId,signal);
  const request=new URL(API+'/download');request.search=new URLSearchParams({path:fileId}).toString();
  const link=await this.#json(request,signal) as {href?:unknown;method?:unknown;templated?:unknown};
  if(!link||!text(link.href,8192)||link.method!=='GET'||link.templated!==false)throw Error('Invalid Disk download link.');
  let url:URL;try{url=new URL(link.href);}catch{throw Error('Invalid Disk download link.');}
  if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash||!DOWNLOAD_HOSTS.has(url.hostname))throw Error('Invalid Disk download origin.');
  // A download link is temporary authority. Never attach the account OAuth token to it.
  const bytes=await body(await this.#request(url,signal,false),LIMIT);
  if(bytes.length!==before.size||[...new Uint8Array(await crypto.subtle.digest('MD5',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('')!==before.md5)throw Error('Disk file checksum mismatch.');
  const after=await this.#metadata(fileId,signal);
  if(JSON.stringify(after)!==JSON.stringify(before))throw Error('Disk source changed during import.');
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  await this.#validate();
  return {provider:'yandex-disk',fileId,sourceVersion:before.modified+':'+before.md5,sourceName:before.name,
   sourceMimeType:before.mime_type,contentType:before.mime_type,exported:false,bytes,
   sha256:[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('')};
 }
}
