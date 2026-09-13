import type {CalendarWriteSource} from '@gadgets/workshop-shared/gatekeeper';
import {GoogleCalendarApi} from './calendar-api';
/** Provider adapter for a proposal already approved against its full content. */
export async function createApprovedGoogleCalendar(api:Pick<GoogleCalendarApi,'createEvent'>,calendarId:string,content:Parameters<CalendarWriteSource['create']>[0],validate:()=>Promise<void>){
 if(!content||Object.keys(content).length!==6||Object.keys(content).some(key=>!['title','start','end','description','location','attendees'].includes(key)))throw Error('Invalid calendar proposal.');
 const start=new Date(content.start),end=new Date(content.end);
 if(!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime())||start.toISOString()!==content.start||end.toISOString()!==content.end||end.getTime()<=start.getTime()||end.getTime()-start.getTime()>366*86400000||!Array.isArray(content.attendees)||content.attendees.length>100||typeof content.title!=='string'||!content.title.trim())throw Error('Invalid calendar proposal.');
 for(const [key,limit] of [['title',998],['description',16384],['location',1024]] as const){if(typeof content[key]!=='string'||content[key].includes('\0')||new TextEncoder().encode(content[key]).length>limit)throw Error('Invalid calendar proposal.');}
 const event={title:content.title,start:{kind:'dateTime' as const,dateTime:start,timeZone:'UTC'},end:{kind:'dateTime' as const,dateTime:end,timeZone:'UTC'},description:content.description,location:content.location,attendees:content.attendees.map(email=>{if(typeof email!=='string'||email.length>254||!/^[^\s<>@]+@[^\s<>@]+$/.test(email))throw Error('Invalid calendar attendee.');return {email};})};
 await validate();let result:Awaited<ReturnType<GoogleCalendarApi['createEvent']>>;
 try{result=await api.createEvent(calendarId,event,'all');}catch{throw Error('Calendar creation outcome is unconfirmed.');}
 if(!result||typeof result.id!=='string'||!/^[A-Za-z0-9_-]{1,255}$/.test(result.id))throw Error('Calendar creation outcome is unconfirmed.');
 await validate();return {event_id:result.id};
}
