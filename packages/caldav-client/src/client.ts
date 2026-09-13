import {createAccount,fetchCalendars,fetchCalendarObjects,fetchCalendarUserAddresses,createCalendarObject} from 'tsdav';
import {caldavTransport,type CalDAVServer,type CalDAVCredential} from './transport.ts';
import {approvedCalendarData,readCalendarData} from './events.ts';
import type {CalendarDraftContent} from '@gadgets/workshop-shared/calendar-draft';
export type {CalDAVServer,CalDAVCredential} from './transport.ts';
/** Internal protocol adapter; the gatekeeper retains it with account credentials.
 * A read capability must expose only metadata/readWindow, never this whole client. */
export class CalDAVClient {
 #server:CalDAVServer;#credential:CalDAVCredential;#validate:()=>Promise<void>;#fetch:typeof fetch;
 constructor(server:CalDAVServer,credential:CalDAVCredential,validate:()=>Promise<void>,fetcher:typeof fetch=fetch){this.#server=structuredClone(server);this.#credential=structuredClone(credential);this.#validate=validate;this.#fetch=fetcher;}
 async #session(){
  const transport=caldavTransport(this.#server,this.#credential,this.#validate,this.#fetch);
  const account=await createAccount({account:{serverUrl:this.#server.url,accountType:'caldav'},fetch:transport.fetch});
  for(const url of [account.rootUrl,account.principalUrl,account.homeUrl]){if(!url)throw Error('CalDAV account unavailable.');transport.check(url);}
  const calendars=await fetchCalendars({account,fetch:transport.fetch});if(calendars.length>50)throw Error('Too many calendars.');
  const seen=new Set<string>();for(const calendar of calendars){transport.check(calendar.url);if(!calendar.url.endsWith('/')||seen.has(calendar.url)||typeof calendar.displayName!=='string'||calendar.displayName.length>1024)throw Error('CalDAV calendar unavailable.');seen.add(calendar.url);}
  await this.#validate();return {account,calendars,transport};
 }
 async listCalendars(){try{const {calendars}=await this.#session();return calendars.map(calendar=>({url:calendar.url,title:String(calendar.displayName),timezone:calendar.timezone??''}));}catch{throw Error('CalDAV calendars unavailable.');}}
 async readWindow(calendarUrl:string,input:{time_min:string;time_max:string;limit:number}){
  try{
   if(!input||Object.keys(input).some(key=>!['time_min','time_max','limit'].includes(key))||!Number.isInteger(input.limit)||input.limit<1||input.limit>100)throw Error();
   for(const value of [input.time_min,input.time_max]){
    if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)||!Number.isFinite(Date.parse(value)))throw Error();
    const date=new Date(value.slice(0,10)+'T00:00:00Z');if(!Number.isFinite(date.valueOf())||date.toISOString().slice(0,10)!==value.slice(0,10))throw Error();
   }
   const duration=Date.parse(input.time_max)-Date.parse(input.time_min);if(duration<=0||duration>366*86400000)throw Error();
   const {calendars,transport}=await this.#session(),calendar=calendars.find(value=>value.url===calendarUrl);if(!calendar)throw Error();
   const objects=await fetchCalendarObjects({calendar,timeRange:{start:input.time_min,end:input.time_max},expand:true,useMultiGet:false,urlFilter:()=>true,fetch:transport.fetch});if(objects.length>1000)throw Error();
   const seen=new Set<string>();const events=objects.flatMap(object=>{const url=transport.check(object.url);if(url.origin!==new URL(calendar.url).origin||!url.href.startsWith(calendar.url)||seen.has(url.href)||typeof object.data!=='string')throw Error();seen.add(url.href);return readCalendarData(object.data);});
   events.sort((a,b)=>(a.start.kind==='date'?a.start.date:a.start.dateTime).localeCompare(b.start.kind==='date'?b.start.date:b.start.dateTime));
   await this.#validate();return {events:events.slice(0,input.limit),truncated:events.length>input.limit};
  }catch{throw Error('CalDAV events unavailable.');}
 }
 /** Read-only availability check; creation repeats it because server state can change. */
 async scheduling(calendarUrl:string){
  try{
   const {account,calendars,transport}=await this.#session();const calendar=calendars.find(value=>value.url===calendarUrl);if(!calendar)throw Error();
   const organizer=await this.#organizer(account,calendar.url,transport);await this.#validate();return {available:!!organizer};
  }catch{throw Error('CalDAV scheduling check unavailable.');}
 }
 async #organizer(account:Awaited<ReturnType<typeof createAccount>>,calendarUrl:string,transport:ReturnType<typeof caldavTransport>){
  const response=await transport.fetch(calendarUrl,{method:'OPTIONS'});await response.body?.cancel();
  if(!response.ok)throw Error();
  if(!response.headers.get('DAV')?.split(',').some(value=>value.trim()==='calendar-auto-schedule'))return '';
  const addresses=await fetchCalendarUserAddresses({account,fetch:transport.fetch});
  return addresses.find(address=>/^mailto:[^\s<>@]+@[^\s<>@]+$/i.test(address))?.slice(7)??'';
 }
 async create(calendarUrl:string,content:CalendarDraftContent){
  try{
   const {account,calendars,transport}=await this.#session(),calendar=calendars.find(value=>value.url===calendarUrl);if(!calendar)throw Error();
   let organizer='';
   if(content.attendees?.length){
    organizer=await this.#organizer(account,calendar.url,transport);
    if(!organizer)throw Error('CalDAV automatic scheduling unavailable.');
   }
   const uid=crypto.randomUUID(),data=approvedCalendarData(content,uid,organizer);
   const response=await createCalendarObject({calendar,filename:uid+'.ics',iCalString:data,fetch:transport.fetch});await response.body?.cancel();
   if(response.status!==201)throw Error();await this.#validate();return {event_id:uid};
  }catch{throw Error('CalDAV creation not confirmed. Do not retry automatically.');}
 }
}
