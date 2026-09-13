import assert from 'node:assert/strict';
export const origin='https://caldav.example',calendar=origin+'/calendars/me/team/';
export const server={url:origin,origins:[origin]},credential={username:'owner@example.test',password:'private-app-password'};
export const content={title:'Team meeting',start:'2026-09-11T10:00:00.000Z',end:'2026-09-11T11:00:00.000Z',description:'Line 1\nBEGIN:VEVENT\nText,semicolon;backslash\\',location:'Room',attendees:['person@example.test']};
const multi=(href,properties)=>'<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:href>'+href+'</d:href><d:propstat><d:prop>'+properties+'</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>';
export function davFixture(approvedCalendarData){
 const state={calls:[],writes:[],live:true,foreign:false,writeStatus:201,scheduling:true};
 const fetcher=async(input,init)=>{
  const url=new URL(input);assert.equal(url.origin,origin);assert.equal(init.redirect,'manual');assert.equal(init.headers.get('Authorization'),'Basic '+Buffer.from(credential.username+':'+credential.password).toString('base64'));state.calls.push({path:url.pathname,method:init.method});
  const xml=value=>new Response(value,{status:207,headers:{'Content-Type':'application/xml'}});
  if(url.pathname==='/.well-known/caldav')return new Response(null,{status:302,headers:{Location:'/dav/'}});
  if(init.method==='PUT'){state.writes.push(init.body);assert.equal(init.headers.get('If-None-Match'),'*');return new Response(null,{status:state.writeStatus});}
  if(init.method==='OPTIONS')return new Response(null,{status:200,headers:{DAV:state.scheduling?'1, calendar-access, calendar-auto-schedule':'1, calendar-access'}});
  if(init.method==='REPORT'){
   assert.match(init.body,/:expand/);assert.match(init.body,/20260911T000000Z/);
   const data=approvedCalendarData({...content,attendees:[]},'11111111-1111-4111-8111-111111111111','');
   return xml(multi('/calendars/me/team/event.ics','<d:getetag>"v1"</d:getetag><c:calendar-data><![CDATA['+data+']]></c:calendar-data>'));
  }
  if(init.body.includes('current-user-principal'))return xml(multi(url.pathname,'<d:current-user-principal><d:href>'+(state.foreign?'https://foreign.invalid/steal':'/principals/me/')+'</d:href></d:current-user-principal>'));
  if(init.body.includes('calendar-home-set'))return xml(multi('/principals/me/','<c:calendar-home-set><d:href>/calendars/me/</d:href></c:calendar-home-set>'));
  if(init.body.includes('calendar-user-address-set'))return xml(multi('/principals/me/','<c:calendar-user-address-set><d:href>mailto:owner@example.test</d:href></c:calendar-user-address-set>'));
  if(url.pathname==='/calendars/me/')return xml(multi('/calendars/me/team/','<d:displayname>Team</d:displayname><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set>'));
  return xml(multi(url.pathname,'<d:supported-report-set><d:supported-report><d:report><c:calendar-query/></d:report></d:supported-report></d:supported-report-set>'));
 };
 return {state,fetcher};
}
