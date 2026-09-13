import {ConnectionAuditStorage} from './connection-audit-storage.ts';
import {CalDAVClient,type CalDAVServer,type CalDAVCredential} from '@gadgets/caldav-client';
import type {AccountStorage} from './account-session.ts';
import type {CalDAVSetup,CalDAVAccountInfo} from './caldav-types.ts';
import type {CalendarDraftContent} from './calendar-drafts.ts';
interface Owner {tenant:string;owner:string;epoch:string;}
interface Server extends CalDAVServer {id:string;title:string;provider:'apple'|'yandex'|'caldav';}
interface Record {id:string;owner:Owner;server:string;serverKey:string;credential?:CalDAVCredential;generation:string;enabled:boolean;calendars:Array<{id:string;url:string;title:string}>;}
export const CALDAV_RESOURCE={urlPattern:'mnemos://caldav/calendars/*',title:'Календари CalDAV',description:'Личные подключения Яндекс, iCloud и корпоративных календарей; права агентам выдаются отдельно.'};
const serverKey=(server:Server)=>JSON.stringify([server.provider,server.url,[...server.origins].sort(),server.icloud===true]);
const denied=()=>Error('CalDAV account unavailable.');
const id=(value:unknown)=>{if(typeof value!=='string'||!/^[a-f0-9-]{36}$/.test(value))throw denied();return value;};
/** Only deployment configuration can add corporate destinations. */
export function caldavServers(config=''):Server[]{
 const servers:Server[]=[{id:'yandex',title:'Яндекс Календарь',provider:'yandex',url:'https://caldav.yandex.ru/',origins:['https://caldav.yandex.ru']},{id:'apple',title:'iCloud',provider:'apple',url:'https://caldav.icloud.com/',origins:['https://caldav.icloud.com'],icloud:true}];
 if(config){const values:unknown=JSON.parse(config);if(!Array.isArray(values)||values.length>20)throw denied();for(const value of values){if(!value||typeof value.id!=='string'||!/^corp-[a-z0-9-]{1,40}$/.test(value.id)||servers.some(server=>server.id===value.id)||typeof value.title!=='string'||!value.title||value.title.length>200||typeof value.url!=='string'||!Array.isArray(value.origins)||value.origins.length<1||value.origins.length>32)throw denied();const url=new URL(value.url);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||!value.origins.includes(url.origin))throw denied();for(const origin of value.origins){const parsed=new URL(origin);if(parsed.protocol!=='https:'||parsed.origin!==origin)throw denied();}servers.push({id:value.id,title:value.title,provider:'caldav',url:url.href,origins:[...value.origins]});}}
 return servers;
}
/** Private per-human account store. Sources are fenced by both Mnemos owner epoch
 * and the individual CalDAV generation; disconnect deletes the password. */
export class CalDAVAccounts {
 #storage:ConnectionAuditStorage;#servers:Server[];#epoch:()=>string|undefined;#fetch:typeof fetch;
 constructor(storage:AccountStorage,servers:Server[],epoch:()=>string|undefined,fetcher:typeof fetch=fetch){this.#storage=new ConnectionAuditStorage(storage,'caldav');this.#servers=servers;this.#epoch=epoch;this.#fetch=fetcher;}
 #index(owner:Owner){return 'caldavAccounts:'+JSON.stringify(owner);}
 #read(key:string){return this.#storage.get<Record>('caldavAccount:'+id(key));}
 #owned(record:Record|undefined,owner:Owner){if(!record||record.owner.tenant!==owner.tenant||record.owner.owner!==owner.owner||record.owner.epoch!==owner.epoch||this.#epoch()!==owner.epoch)throw denied();return record;}
 #info(record:Record):CalDAVAccountInfo{return {id:record.id,server:record.server,username:record.credential?.username??'',enabled:record.enabled,calendars:record.calendars.map(({id,title})=>({id,title}))};}
 #server(key:string){const server=this.#servers.find(value=>value.id===key);if(!server)throw denied();return server;}
 list(owner:Owner){if(this.#epoch()!==owner.epoch)throw denied();return {servers:this.#servers.map(({id,title,url})=>({id,title,url})),accounts:(this.#storage.get<string[]>(this.#index(owner))??[]).map(key=>this.#read(key)).filter((record):record is Record=>!!record).map(record=>this.#info(this.#owned(record,owner)))};}
 async connect(owner:Owner,input:CalDAVSetup){
  if(!input||Object.keys(input).some(key=>!['request','server','username','password'].includes(key)))throw denied();const key=id(input.request),server=this.#server(input.server);
  if(typeof input.username!=='string'||!input.username||input.username.length>255||/[:\x00-\x1f\x7f]/.test(input.username)||typeof input.password!=='string'||!input.password||input.password.length>4096||/[\x00\r\n]/.test(input.password)||this.#epoch()!==owner.epoch)throw denied();
  const previous=this.#read(key);if(previous){this.#owned(previous,owner);if(previous.server!==input.server||previous.serverKey!==serverKey(server)||previous.credential?.username!==input.username||previous.credential.password!==input.password)throw Error('CalDAV request changed. Use a new request.');if(previous.enabled)return this.#info(previous);}
  const index=this.#storage.get<string[]>(this.#index(owner))??[];if(!index.includes(key)&&index.length>=20)throw Error('CalDAV account limit reached.');
  const record:Record={id:key,owner:{...owner},server:server.id,serverKey:serverKey(server),credential:{username:input.username,password:input.password},generation:crypto.randomUUID(),enabled:false,calendars:[]};
  this.#storage.put('caldavAccount:'+key,record);this.#storage.put(this.#index(owner),[...new Set([...index,key])]);
  const validate=async()=>{const current=this.#owned(this.#read(key),owner);if(current.generation!==record.generation||!current.credential)throw denied();};
  try{
   const calendars=await new CalDAVClient(server,record.credential!,validate,this.#fetch).listCalendars();
   const saved=await Promise.all(calendars.map(async calendar=>({id:key+'.'+[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(calendar.url)))].map(x=>x.toString(16).padStart(2,'0')).join(''),url:calendar.url,title:calendar.title})));
   await validate();const complete={...record,enabled:true,calendars:saved};this.#storage.put('caldavAccount:'+key,complete);return this.#info(complete);
  }catch{if(this.#read(key)?.generation===record.generation){this.#storage.discard('caldavAccount:'+key);this.#storage.put(this.#index(owner),(this.#storage.get<string[]>(this.#index(owner))??[]).filter(value=>value!==key));}throw Error('CalDAV connection failed. Check the app password and server.');}
 }
 remove(owner:Owner,key:string){this.#owned(this.#read(key),owner);this.#storage.delete('caldavAccount:'+key);this.#storage.put(this.#index(owner),(this.#storage.get<string[]>(this.#index(owner))??[]).filter(value=>value!==key));}
 select(owner:Owner,calendarId:string){if(typeof calendarId!=='string'||calendarId.length>255)throw denied();const record=this.#owned(this.#read(calendarId.split('.')[0]),owner);const calendar=record.calendars.find(value=>value.id===calendarId);if(!record.enabled||!record.credential||!calendar)throw denied();this.validate(calendarId,record.generation);return {generation:record.generation,metadata:{provider:this.#server(record.server).provider,calendar_id:calendar.id,title:calendar.title,time_zone:'UTC'}};}
 #source(calendarId:string,generation:string){
  if(typeof calendarId!=='string'||calendarId.length>255)throw denied();const record=this.#read(calendarId.split('.')[0]);
  if(!record||!record.enabled||!record.credential||record.generation!==generation||this.#epoch()!==record.owner.epoch)throw denied();
  const calendar=record.calendars.find(value=>value.id===calendarId);if(!calendar)throw denied();const server=this.#server(record.server);if(record.serverKey!==serverKey(server))throw denied();
  return {record,calendar,server};
 }
 validate(calendarId:string,generation:string){this.#source(calendarId,generation);}
 metadata(calendarId:string,generation:string){const {calendar,server}=this.#source(calendarId,generation);return {provider:server.provider,calendar_id:calendar.id,title:calendar.title,time_zone:'UTC'};}
 async readWindow(calendarId:string,generation:string,input:Parameters<CalDAVClient['readWindow']>[1]){
  const {record,calendar,server}=this.#source(calendarId,generation),validate=async()=>{this.validate(calendarId,generation)};
  const result=await new CalDAVClient(server,record.credential!,validate,this.#fetch).readWindow(calendar.url,input);await validate();return {calendar_id:calendarId,time_zone:'UTC',events_json:JSON.stringify(result.events),truncated:result.truncated};
 }
 async checkScheduling(owner:Owner,calendarId:string){const selected=this.select(owner,calendarId);const {record,calendar,server}=this.#source(calendarId,selected.generation);const validate=async()=>{this.#owned(this.#read(record.id),owner);this.validate(calendarId,selected.generation);};const result=await new CalDAVClient(server,record.credential!,validate,this.#fetch).scheduling(calendar.url);await validate();return {calendar_id:calendarId,available:result.available};}
 async create(calendarId:string,generation:string,content:CalendarDraftContent){const {record,calendar,server}=this.#source(calendarId,generation),validate=async()=>{this.validate(calendarId,generation)};return new CalDAVClient(server,record.credential!,validate,this.#fetch).create(calendar.url,content);}
}
