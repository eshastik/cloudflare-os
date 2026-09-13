import ICAL from 'ical.js';
import type {CalendarDraftContent} from '@gadgets/workshop-shared/calendar-draft';
const invalid=()=>Error('CalDAV event data unavailable.');
function text(value:unknown,max=16384){if(typeof value!=='string'||value.includes('\0')||new TextEncoder().encode(value).length>max)throw invalid();return value;}
/** Read server-expanded occurrences. Never silently treat an unexpanded series
 * or a floating local time as one UTC meeting. */
export function readCalendarData(data:string){
 text(data,2*1024*1024);const calendar=new ICAL.Component(ICAL.parse(data));if(calendar.name!=='vcalendar')throw invalid();
 const components=calendar.getAllSubcomponents('vevent');if(components.length>1000)throw invalid();
 return components.map(component=>{
  if(component.hasProperty('rrule')||component.hasProperty('rdate'))throw Error('CalDAV server did not expand recurring meetings.');
  const event=new ICAL.Event(component);
  if(!component.hasProperty('dtstart'))throw invalid();
  const time=(value:ICAL.Time)=>{
   if(value.isDate)return {kind:'date' as const,date:value.toString()};
   if(!value.zone||value.zone.tzid==='floating')throw invalid();
   const milliseconds=value.toUnixTime()*1000;if(!Number.isFinite(milliseconds))throw invalid();
   return {kind:'dateTime' as const,dateTime:new Date(milliseconds).toISOString(),timeZone:value.zone.tzid};
  };
  const start=time(event.startDate),end=time(event.endDate);
  if(start.kind!==end.kind||event.endDate.compare(event.startDate)<=0)throw invalid();
  return {id:text(event.uid,255),summary:text(event.summary??''),description:text(event.description??''),location:text(event.location??'',1024),start,end,status:component.getFirstPropertyValue('status')==='CANCELLED'?'cancelled':'confirmed',...(event.recurrenceId?{recurrence_id:event.recurrenceId.toString()}:{})};
 });
}
/** Serialize approved plain text through the iCalendar library, including proper
 * escaping/folding; organizer is resolved from the provider principal. */
export function approvedCalendarData(content:CalendarDraftContent,uid:string,organizer:string){
 if(!content||Object.keys(content).length!==6||Object.keys(content).some(key=>!['title','start','end','description','location','attendees'].includes(key)))throw invalid();
 text(content.title,998);text(content.description);text(content.location,1024);
 if(!content.title.trim()||/[\r\n]/.test(content.title)||!Array.isArray(content.attendees)||content.attendees.length>100||!/^[a-f0-9-]{36}$/.test(uid))throw invalid();
 const address=(value:string)=>{if(typeof value!=='string'||value.length>254||!/^[^\s<>@]+@[^\s<>@]+$/.test(value)||/[\x00-\x1f\x7f]/.test(value))throw invalid();return value;};
 for(const value of [content.start,content.end])if(typeof value!=='string'||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value)throw invalid();
 const duration=Date.parse(content.end)-Date.parse(content.start);if(duration<=0||duration>366*86400000)throw invalid();
 // RFC5545 DATE-TIME has second precision. Do not silently round an approved instant.
 if(!content.start.endsWith('.000Z')||!content.end.endsWith('.000Z'))throw Error('CalDAV meetings require whole-second times.');
 const calendar=new ICAL.Component('vcalendar');calendar.updatePropertyWithValue('version','2.0');calendar.updatePropertyWithValue('prodid','-//Mnemos//Team Calendar//EN');
 const event=new ICAL.Component('vevent');calendar.addSubcomponent(event);
 for(const [key,value] of [['uid',uid],['summary',content.title],['description',content.description],['location',content.location],['status','CONFIRMED']] as const)event.updatePropertyWithValue(key,value);
 event.updatePropertyWithValue('dtstamp',ICAL.Time.fromJSDate(new Date(),true));
 event.updatePropertyWithValue('dtstart',ICAL.Time.fromJSDate(new Date(content.start),true));event.updatePropertyWithValue('dtend',ICAL.Time.fromJSDate(new Date(content.end),true));
 if(content.attendees.length){event.updatePropertyWithValue('organizer','mailto:'+address(organizer));for(const email of content.attendees){const attendee=new ICAL.Property('attendee');attendee.setValue('mailto:'+address(email));attendee.setParameter('role','REQ-PARTICIPANT');attendee.setParameter('rsvp','TRUE');event.addProperty(attendee);}}
 return calendar.toString()+'\r\n';
}
