const GRAPH='https://graph.microsoft.com/v1.0';
const failure=()=>Error('Selected Outlook calendar is unavailable or changed.');
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw failure();return value as Record<string,unknown>;}
function text(value:unknown,max:number){if(typeof value!=='string'||new TextEncoder().encode(value).length>max||value.includes('\0'))throw failure();return value;}
function id(value:unknown){const result=text(value,255);if(!/^[A-Za-z0-9_+=/-]{1,255}$/.test(result))throw failure();return result;}
function instant(value:unknown){
 const result=text(value,64);
 if(!/^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,7})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(result))throw failure();
 const parsed=new Date(result),date=new Date(result.slice(0,10)+'T00:00:00Z');
 if(!Number.isFinite(parsed.valueOf())||!Number.isFinite(date.valueOf())||date.toISOString().slice(0,10)!==result.slice(0,10))throw failure();
 return parsed.toISOString();
}
/** Account-owned, read-only source. UTC is the output representation; original
 * event zone labels and all-day status are retained without inventing local dates. */
export class SelectedOutlookCalendar {
 #calendar:string;#owner:string;#token:()=>Promise<string>;#validate:()=>Promise<void>;
 constructor(calendar:string,owner:string,token:()=>Promise<string>,validate:()=>Promise<void>){this.#calendar=id(calendar);this.#owner=id(owner);this.#token=token;this.#validate=validate;}
 async validate(){await this.#validate();}
 async #get(path:string,signal:AbortSignal,max=65536){
  await this.validate();const token=await this.#token();await this.validate();
  if(!token||token.length>16384||/[^\x21-\x7e]/.test(token))throw failure();
  const response=await fetch(GRAPH+path,{method:'GET',redirect:'manual',signal,headers:{Authorization:'Bearer '+token,Accept:'application/json',Prefer:'outlook.timezone="UTC", IdType="ImmutableId"'}});
  if(!response.ok||!response.body){await response.body?.cancel();throw failure();}
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>max){await reader.cancel();throw failure();}chunks.push(part.value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  await this.validate();return object(JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(bytes)));
 }
 async #identity(signal:AbortSignal){if((await this.#get('/me?$select=id',signal)).id!==this.#owner)throw failure();}
 async #metadata(signal:AbortSignal){
  await this.#identity(signal);
  const calendar=await this.#get('/me/calendars/'+encodeURIComponent(this.#calendar)+'?$select=id,name',signal);
  if(calendar.id!==this.#calendar)throw failure();
  const title=text(calendar.name,1024);if(!title)throw failure();
  return {provider:'microsoft',calendar_id:this.#calendar,title,time_zone:'UTC'};
 }
 /** Owner-only discovery, not exposed through a selected calendar capability. */
 async listCalendars(){
  try{
   const signal=AbortSignal.timeout(30000);await this.#identity(signal);
   let next='/me/calendars?'+new URLSearchParams({'$top':'100','$select':'id,name'});
   const calendars:{id:string;name:string}[]=[],seen=new Set<string>();
   for(let page=0;page<10;page++){
    const data=await this.#get(next,signal,256*1024);
    if(!Array.isArray(data.value)||data.value.length>100)throw failure();
    for(const item of data.value){const value=object(item),key=id(value.id),name=text(value.name,1024);if(!name||seen.has(key))throw failure();seen.add(key);calendars.push({id:key,name});}
    next='';
    if(data['@odata.nextLink']!==undefined){const url=new URL(text(data['@odata.nextLink'],8192));if(url.origin!=='https://graph.microsoft.com'||url.pathname!=='/v1.0/me/calendars'||url.username||url.password||url.hash)throw failure();next='/me/calendars'+url.search;}
    if(!next)break;
   }
   await this.#identity(signal);return {calendars,truncated:!!next};
  }catch{throw failure();}
 }
 async metadata(){try{const signal=AbortSignal.timeout(30000),result=await this.#metadata(signal);await this.#identity(signal);return result;}catch{throw failure();}}
 async readWindow(input:{time_min:string;time_max:string;limit:number}){
  try{
   if(!input||Object.keys(input).some(key=>!['time_min','time_max','limit'].includes(key))||!Number.isInteger(input.limit)||input.limit<1||input.limit>100)throw failure();
   const start=instant(input.time_min),end=instant(input.time_max),span=Date.parse(end)-Date.parse(start);
   if(span<=0||span>366*86400000)throw failure();
   const signal=AbortSignal.timeout(30000);await this.#metadata(signal);
   const query=new URLSearchParams({startDateTime:start,endDateTime:end,'$top':String(input.limit),'$select':'id,subject,body,start,end,isAllDay,isCancelled,originalStartTimeZone,originalEndTimeZone,type,seriesMasterId','$orderby':'start/dateTime'});
   const data=await this.#get('/me/calendars/'+encodeURIComponent(this.#calendar)+'/calendarView?'+query,signal,2*1024*1024);
   if(!Array.isArray(data.value)||data.value.length>input.limit)throw failure();
   const seen=new Set<string>();
   const events=data.value.map(value=>{
    const event=object(value),eventId=id(event.id);if(seen.has(eventId))throw failure();seen.add(eventId);
    const time=(value:unknown)=>{const point=object(value);if(point.timeZone!=='UTC')throw failure();const raw=text(point.dateTime,64);return instant(raw.endsWith('Z')?raw:raw+'Z');};
    const from=time(event.start),to=time(event.end);
    if(Date.parse(to)<Date.parse(from)||Date.parse(to)<=Date.parse(start)||Date.parse(from)>=Date.parse(end))throw failure();
    if(typeof event.isAllDay!=='boolean'||typeof event.isCancelled!=='boolean')throw failure();
    const body=object(event.body);if(!['text','html'].includes(String(body.contentType)))throw failure();
    const content=text(body.content,1024*1024),clipped=Array.from(content).slice(0,16000).join('');
    if(!['singleInstance','occurrence','exception'].includes(String(event.type)))throw failure();
    return {id:eventId,summary:text(event.subject,16384),start:{kind:'dateTime',dateTime:from,timeZone:'UTC'},end:{kind:'dateTime',dateTime:to,timeZone:'UTC'},
     all_day:event.isAllDay,status:event.isCancelled?'cancelled':'confirmed',description:clipped,description_format:body.contentType,description_truncated:clipped!==content,
     original_start_time_zone:text(event.originalStartTimeZone,255),original_end_time_zone:text(event.originalEndTimeZone,255),
     type:event.type,...(event.seriesMasterId?{series_master_id:id(event.seriesMasterId)}:{})};
   });
   if(data['@odata.nextLink']!==undefined&&!text(data['@odata.nextLink'],8192))throw failure();
   await this.#metadata(signal);await this.#identity(signal);await this.validate();
   const result={calendar_id:this.#calendar,time_zone:'UTC',events_json:JSON.stringify(events),truncated:data['@odata.nextLink']!==undefined};
   if(new TextEncoder().encode(JSON.stringify(result)).length>2*1024*1024)throw failure();return result;
  }catch{throw failure();}
 }
}
