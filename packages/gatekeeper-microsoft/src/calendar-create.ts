import type {CalendarDraftContent} from '@gadgets/workshop-shared/calendar-draft';
const failure=()=>Error('Calendar creation outcome is unconfirmed.');
/** One Graph write to the account's selected calendar; caller owns approval and durable deduplication. */
export async function createApprovedOutlookCalendar(calendar:string,content:CalendarDraftContent,token:()=>Promise<string>,validate:()=>Promise<void>,fetcher:typeof fetch=fetch):Promise<{event_id:string}>{
 if(typeof calendar!=='string'||!/^[A-Za-z0-9_+=/-]{1,255}$/.test(calendar)||!content||Object.keys(content).length!==6||Object.keys(content).some(key=>!['title','start','end','description','location','attendees'].includes(key)))throw Error('Invalid calendar proposal.');
 for(const [key,limit] of [['title',998],['description',16384],['location',1024]] as const){if(typeof content[key]!=='string'||content[key].includes('\0')||new TextEncoder().encode(content[key]).length>limit)throw Error('Invalid calendar text.');}
 if(!content.title.trim()||/[\r\n]/.test(content.title)||!Array.isArray(content.attendees)||content.attendees.length>100||content.attendees.some(email=>typeof email!=='string'||email.length>254||!/^[^\s<>@]+@[^\s<>@]+$/.test(email)||/[\x00-\x1f\x7f]/.test(email)))throw Error('Invalid calendar proposal.');
 for(const instant of [content.start,content.end])if(typeof instant!=='string'||!Number.isFinite(Date.parse(instant))||new Date(instant).toISOString()!==instant)throw Error('Calendar time must be a canonical UTC instant.');
 const duration=Date.parse(content.end)-Date.parse(content.start);if(duration<=0||duration>366*86400000)throw Error('Invalid calendar duration.');
 const body=JSON.stringify({subject:content.title,body:{contentType:'Text',content:content.description},start:{dateTime:content.start.slice(0,-1),timeZone:'UTC'},end:{dateTime:content.end.slice(0,-1),timeZone:'UTC'},location:{displayName:content.location},attendees:content.attendees.map(address=>({emailAddress:{address},type:'required'}))});
 await validate();const accessToken=await token();await validate();
 if(typeof accessToken!=='string'||!accessToken||accessToken.length>16384||/[^\x21-\x7e]/.test(accessToken))throw Error('Microsoft credentials unavailable.');
 try{
  const response=await fetcher('https://graph.microsoft.com/v1.0/me/calendars/'+encodeURIComponent(calendar)+'/events',{method:'POST',headers:{Authorization:'Bearer '+accessToken,'Content-Type':'application/json',Prefer:'outlook.timezone="UTC", IdType="ImmutableId"'},body,redirect:'manual',signal:AbortSignal.timeout(15000)});
  if(response.status!==201||!response.body){await response.body?.cancel();throw failure();}
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>256*1024){await reader.cancel();throw failure();}chunks.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const result=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(bytes));
  if(typeof result?.id!=='string'||!/^[A-Za-z0-9_+=/-]{1,255}$/.test(result.id))throw failure();
  await validate();return {event_id:result.id};
 }catch{throw failure();}
}
