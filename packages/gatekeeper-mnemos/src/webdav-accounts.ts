import { sourceHealth, observeSourceRead } from './source-health.ts';
import type { SourceLoadHealth } from './source-health.ts';
import {ConnectionAuditStorage} from './connection-audit-storage.ts';
import {WebDAVImportReader,type WebDAVServer,type WebDAVCredential} from '@gadgets/webdav-client';
import type {AccountStorage} from './account-session.ts';

export interface WebDAVOwner {tenant:string;owner:string;epoch:string;}
export interface WebDAVSetup {request:string;server:string;username:string;password:string;}
export interface WebDAVAccountInfo extends SourceLoadHealth {id:string;server:string;username:string;enabled:boolean;}
/** Owner-only management surface; passwords are write-only input. */
export interface WebDAVManagement {
 listWebDAVAccounts():Promise<{servers:Array<{id:string;title:string;url:string}>;accounts:WebDAVAccountInfo[]}>;
 connectWebDAVAccount(input:WebDAVSetup):Promise<WebDAVAccountInfo>;
 removeWebDAVAccount(id:string):Promise<void>;
}
interface Server extends WebDAVServer {id:string;title:string;}
interface Record {id:string;owner:WebDAVOwner;server:string;serverKey:string;credential:WebDAVCredential;generation:string;enabled:boolean;}
export const WEBDAV_RESOURCE={urlPattern:'mnemos://webdav/files/*',title:'Файлы WebDAV',description:'Чтение выбранных файлов из личных подключений WebDAV.',receives:'drive' as const};
const denied=()=>Error('WebDAV account unavailable.');
const id=(value:unknown):string=>{if(typeof value!=='string'||!/^[a-f0-9-]{36}$/.test(value))throw denied();return value;};
const serverKey=(server:Server)=>JSON.stringify([server.id,server.url]);

/** Only deployment configuration can add destinations; browser input selects a known server. */
export function webdavServers(config=''):Server[]{
 if(!config)return [];
 const input:unknown=JSON.parse(config);if(!Array.isArray(input)||input.length>20)throw denied();
 const servers:Server[]=[];
 for(const value of input){
  if(!value||typeof value.id!=='string'||!/^corp-[a-z0-9-]{1,40}$/.test(value.id)||servers.some(s=>s.id===value.id)||typeof value.title!=='string'||!value.title||value.title.length>200||typeof value.url!=='string')throw denied();
  const url=new URL(value.url);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||!url.pathname.endsWith('/')||url.href.length>4096)throw denied();
  servers.push({id:value.id,title:value.title,url:url.href});
 }
 return servers;
}

/** Private per-human credentials, fenced by identity epoch, connection generation and configured root. */
export class WebDAVAccounts {
 private storage:ConnectionAuditStorage;
 constructor(storage:AccountStorage,private servers:Server[],private epoch:()=>string|undefined,private fetcher:typeof fetch=fetch){this.storage=new ConnectionAuditStorage(storage,'webdav');}
 #index(owner:WebDAVOwner){return 'webdavAccounts:'+JSON.stringify([owner.tenant,owner.owner,owner.epoch]);}
 #read(key:string){return this.storage.get<Record>('webdavAccount:'+id(key));}
 #owned(record:Record|undefined,owner:WebDAVOwner){if(!record||record.owner.tenant!==owner.tenant||record.owner.owner!==owner.owner||record.owner.epoch!==owner.epoch||this.epoch()!==owner.epoch)throw denied();return record;}
 #server(key:string){const server=this.servers.find(s=>s.id===key);if(!server)throw denied();return server;}
 #info(record:Record):WebDAVAccountInfo{return {...sourceHealth(this.storage,'webdav',record.id,record.generation),id:record.id,server:record.server,username:record.credential.username,enabled:record.enabled};}
 list(owner:WebDAVOwner){
  if(this.epoch()!==owner.epoch)throw denied();
  return {servers:this.servers.map(({id,title,url})=>({id,title,url})),accounts:(this.storage.get<string[]>(this.#index(owner))??[]).map(key=>this.#read(key)).filter((v):v is Record=>!!v).map(v=>this.#info(this.#owned(v,owner)))};
 }
 async connect(owner:WebDAVOwner,input:WebDAVSetup){
  if(!input||Object.keys(input).some(key=>!['request','server','username','password'].includes(key)))throw denied();
  const key=id(input.request),server=this.#server(input.server);
  if(typeof input.username!=='string'||!input.username||input.username.length>255||/[:\x00-\x1f\x7f]/.test(input.username)||typeof input.password!=='string'||!input.password||input.password.length>4096||/[\x00-\x1f\x7f]/.test(input.password)||this.epoch()!==owner.epoch)throw denied();
  const previous=this.#read(key);
  if(previous){this.#owned(previous,owner);if(previous.serverKey!==serverKey(server)||previous.credential.username!==input.username||previous.credential.password!==input.password)throw Error('WebDAV request changed. Use a new request.');if(previous.enabled)return this.#info(previous);}
  const index=this.storage.get<string[]>(this.#index(owner))??[];
  if(!index.includes(key)&&index.length>=20)throw Error('WebDAV account limit reached.');
  const record:Record={id:key,owner:{...owner},server:server.id,serverKey:serverKey(server),credential:{username:input.username,password:input.password},generation:crypto.randomUUID(),enabled:false};
  this.storage.put('webdavAccount:'+key,record);this.storage.put(this.#index(owner),[...new Set([...index,key])]);
  const validate=async()=>{const current=this.#owned(this.#read(key),owner);if(current.generation!==record.generation||current.serverKey!==serverKey(this.#server(current.server)))throw denied();};
  try{
   await new WebDAVImportReader(server,record.credential,validate,this.fetcher).checkConnection();await validate();
   record.enabled=true;this.storage.put('webdavAccount:'+key,record);return this.#info(record);
  }catch{
   if(this.#read(key)?.generation===record.generation){this.storage.discard('webdavAccount:'+key);this.storage.put(this.#index(owner),(this.storage.get<string[]>(this.#index(owner))??[]).filter(v=>v!==key));}
   throw Error('WebDAV connection failed. Check the app password and server.');
  }
 }
 remove(owner:WebDAVOwner,key:string){this.#owned(this.#read(key),owner);this.storage.delete('webdavAccount:'+key);this.storage.put(this.#index(owner),(this.storage.get<string[]>(this.#index(owner))??[]).filter(v=>v!==key));}
 #source(key:string,generation:string){
  const record=this.#read(key);if(!record||!record.enabled||record.generation!==generation||this.epoch()!==record.owner.epoch)throw denied();
  const server=this.#server(record.server);if(record.serverKey!==serverKey(server))throw denied();return {record,server};
 }
 select(owner:WebDAVOwner,key:string){const record=this.#owned(this.#read(key),owner);this.#source(key,record.generation);return {generation:record.generation};}
 validate(key:string,generation:string){this.#source(key,generation);}
 async read(key:string,generation:string,file:string){
  const {record,server}=this.#source(key,generation),validate=async()=>{this.validate(key,generation)};
  return observeSourceRead(this.storage,'webdav',key,generation,async()=>{
  const snapshot=await new WebDAVImportReader(server,record.credential,validate,this.fetcher).snapshot(file);await validate();return snapshot;
  });
 }
}
