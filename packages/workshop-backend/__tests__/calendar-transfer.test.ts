import {CalendarWriteLease} from '../src/calendar-source-lease.js';
import {it,expect} from 'vitest';
import type {CalendarReadSource,GatekeeperUser} from '@gadgets/workshop-shared/gatekeeper';
import {UserDurableObject} from '../src/user.js';
import {CalendarSourceGuard} from '../src/calendar-source-lease.js';
import {DEFAULT_ADMIN_CONFIG,serializeAdminConfig} from '../src/admin-config.js';

it('transfers only owned accounts and retains current policy checks around saved-source reads',async()=>{
 let config=DEFAULT_ADMIN_CONFIG,sourceLive=true,targetLive=true,sourceExpired=false,targetExpired=false;
 let factoryCalls=0,acceptCalls=0,duringRead=()=>{};
 let saved:CalendarReadSource|undefined;
 const resource={urlPattern:'https://calendar.google.com/calendar/*',title:'Calendar',description:''};
 const source={validate:async()=>{},metadata:async()=>({provider:'google',calendar_id:'calendar',title:'Team',time_zone:'Europe/Moscow'}),readWindow:async()=>{duringRead();return {calendar_id:'calendar',time_zone:'Europe/Moscow',events_json:'[]',truncated:false};}} as Fetcher<CalendarReadSource>;
 const google={getCalendarReadSource:async(id:string)=>{factoryCalls++;expect(id).toBe('calendar');return {source,sourceKey:'account-calendar-generation',resource};}} as Fetcher<GatekeeperUser>;
 const mnemos={acceptCalendarReadSource:async(project:string,request:string,key:string,received:CalendarReadSource)=>{acceptCalls++;expect([project,request]).toEqual(['project','request']);expect(key).toBe('[7,"account-calendar-generation"]');saved=received;await received.validate();return {selection_id:'selection',title:'Team'};}} as Fetcher<GatekeeperUser>;
 const user=Object.create(UserDurableObject.prototype) as UserDurableObject;
 Object.assign(user,{
  env:{BLUEPRINTS:{get:async()=>serializeAdminConfig(config)}},
  storage:{connectedAccounts:{get:(id:number)=>id===7&&sourceLive?{id,account:google,vendorId:'google',credentialsExpired:sourceExpired}:id===8&&targetLive?{id,account:mnemos,vendorId:'mnemos',credentialsExpired:targetExpired}:undefined}},
  ctx:{id:{toString:()=> 'user-id'},exports:{CalendarSourceLease:({props}:any)=>{expect(props.userId).toBe('user-id');return new CalendarSourceGuard(props.source,()=>user.checkCalendarSourceAccounts(props.accounts));}}},
 });
 await expect(user.prepareCalendarConnection(99,8,'calendar','project','request')).rejects.toThrow('unavailable');
 config={...DEFAULT_ADMIN_CONFIG,disabledGatekeepers:['google']};
 await expect(user.prepareCalendarConnection(7,8,'calendar','project','request')).rejects.toThrow('disabled');expect(factoryCalls).toBe(0);
 config={...DEFAULT_ADMIN_CONFIG,disabledResources:{google:[resource.urlPattern]}};
 await expect(user.prepareCalendarConnection(7,8,'calendar','project','request')).rejects.toThrow('disabled');expect(acceptCalls).toBe(0);
 config=DEFAULT_ADMIN_CONFIG;
 await expect(user.prepareCalendarConnection(7,8,'calendar','project','request')).resolves.toEqual({selection_id:'selection',title:'Team'});
 expect(saved).toBeDefined();expect(saved).not.toBe(source);
 targetExpired=true;await expect(saved!.validate()).resolves.toBeUndefined();
 await expect(user.prepareCalendarConnection(7,8,'calendar','project','request')).rejects.toThrow('unavailable');
 targetExpired=false;
 const query={time_min:'2026-09-10T00:00:00Z',time_max:'2026-09-11T00:00:00Z',limit:1};
 await expect(saved!.readWindow(query)).resolves.toMatchObject({events_json:'[]'});
 duringRead=()=>{config={...DEFAULT_ADMIN_CONFIG,disabledResources:{google:[resource.urlPattern]}};};
 await expect(saved!.readWindow(query)).rejects.toThrow('disabled');
 config=DEFAULT_ADMIN_CONFIG;duringRead=()=>{targetLive=false;};
 await expect(saved!.readWindow(query)).rejects.toThrow('unavailable');
 targetLive=true;duringRead=()=>{};sourceExpired=true;
 await expect(saved!.validate()).rejects.toThrow('unavailable');
 sourceExpired=false;sourceLive=false;
 await expect(saved!.metadata()).rejects.toThrow('unavailable');
});

it('registers through an owned, valid, enabled Mnemos account only',async()=>{
 let config=DEFAULT_ADMIN_CONFIG,expired=false;
 const calls:unknown[][]=[];
 const account={registerCalendarSelection:async(...args:unknown[])=>{calls.push(args);return {connection_id:'connection'};}};
 const user=Object.create(UserDurableObject.prototype) as UserDurableObject;
 Object.assign(user,{
  env:{BLUEPRINTS:{get:async()=>serializeAdminConfig(config)}},
  storage:{connectedAccounts:{get:(id:number)=>id===8?{id,account,vendorId:'mnemos',credentialsExpired:expired}:id===7?{id,account,vendorId:'google'}:undefined}},
 });
 for(const id of [0,NaN,99,7])await expect(user.registerCalendarSelection(id,'project','request','selection')).rejects.toThrow();
 expired=true;await expect(user.registerCalendarSelection(8,'project','request','selection')).rejects.toThrow('unavailable');
 expired=false;config={...DEFAULT_ADMIN_CONFIG,disabledGatekeepers:['mnemos']};
 await expect(user.registerCalendarSelection(8,'project','request','selection')).rejects.toThrow('disabled');
 expect(calls).toHaveLength(0);config=DEFAULT_ADMIN_CONFIG;
 await expect(user.registerCalendarSelection(8,'project','request','selection')).resolves.toEqual({connection_id:'connection'});
 expect(calls).toEqual([['project','request','selection']]);
});

it('lists Outlook calendars only for the owner and rechecks account and policy after provider IO',async()=>{
 let config=DEFAULT_ADMIN_CONFIG,live=true,expired=false,calls=0,hook=()=>{};
 const account={listCalendars:async()=>{calls++;hook();return {calendars:[{id:'child',name:'Team'}],truncated:false}}};
 const user=Object.create(UserDurableObject.prototype) as UserDurableObject;
 Object.assign(user,{env:{BLUEPRINTS:{get:async()=>serializeAdminConfig(config)}},storage:{connectedAccounts:{get:(id:number)=>id===9&&live?{id,account,vendorId:'microsoft',credentialsExpired:expired}:undefined}}});
 await expect(user.listCalendars(99)).rejects.toThrow();
 config={...DEFAULT_ADMIN_CONFIG,disabledGatekeepers:['microsoft']};await expect(user.listCalendars(9)).rejects.toThrow('disabled');
 config={...DEFAULT_ADMIN_CONFIG,disabledResources:{microsoft:['https://graph.microsoft.com/v1.0/me/calendars/*']}};await expect(user.listCalendars(9)).rejects.toThrow('disabled');
 config=DEFAULT_ADMIN_CONFIG;expired=true;await expect(user.listCalendars(9)).rejects.toThrow('unavailable');expect(calls).toBe(0);
 expired=false;await expect(user.listCalendars(9)).resolves.toMatchObject({calendars:[{id:'child'}]});
 hook=()=>{live=false};await expect(user.listCalendars(9)).rejects.toThrow('unavailable');
});

it.each(['google','microsoft','mnemos'])('creates only in the saved owned %s calendar and rechecks policy on the writer',async(vendor)=>{
 let config=DEFAULT_ADMIN_CONFIG,key='saved-generation',creates=0,duringCreate=()=>{};
 const user=Object.create(UserDurableObject.prototype) as UserDurableObject;
 const resource='https://www.googleapis.com/calendar/v3/calendars/*';
 const source={validate:async()=>{},create:async()=>{creates++;duringCreate();return {event_id:'created'}}};
 const provider={getCalendarWriteSource:async(calendar:string)=>{expect(calendar).toBe('team');return {source,sourceKey:key,resource:{urlPattern:resource}}}};
 const receiver={prepareCalendarDraftCreate:async()=>({sourceKey:'[7,"saved-generation"]',calendar_id:'team'}),createCalendarDraft:async(id:string,hash:string,saved:string,cap:typeof source)=>{expect([id,hash,saved]).toEqual(['draft','a'.repeat(64),'[7,"saved-generation"]']);return {state:'created',...await cap.create()}}};
 Object.assign(user,{env:{BLUEPRINTS:{get:async()=>serializeAdminConfig(config)}},storage:{connectedAccounts:{get:(id:number)=>id===7?{id,account:provider,vendorId:vendor}:id===8?{id,account:receiver,vendorId:'mnemos'}:undefined}},ctx:{id:{toString:()=> 'human'},exports:{CalendarWriteLease:({props}:any)=>{const lease=Object.create(CalendarWriteLease.prototype);Object.assign(lease,{ctx:{props,exports:{UserDurableObject:{idFromString:()=> 'human',get:()=>user}}}});return lease;}}}});
 await expect(user.createCalendarDraft(99,'draft','a'.repeat(64))).rejects.toThrow('unavailable');
 key='substituted';await expect(user.createCalendarDraft(8,'draft','a'.repeat(64))).rejects.toThrow('changed');expect(creates).toBe(0);
 key='saved-generation';config={...DEFAULT_ADMIN_CONFIG,disabledGatekeepers:[vendor]};await expect(user.createCalendarDraft(8,'draft','a'.repeat(64))).rejects.toThrow('disabled');expect(creates).toBe(0);
 config={...DEFAULT_ADMIN_CONFIG,disabledResources:{[vendor]:[resource]}};await expect(user.createCalendarDraft(8,'draft','a'.repeat(64))).rejects.toThrow('disabled');expect(creates).toBe(0);
 config=DEFAULT_ADMIN_CONFIG;await expect(user.createCalendarDraft(8,'draft','a'.repeat(64))).resolves.toEqual({state:'created',event_id:'created'});expect(creates).toBe(1);
 duringCreate=()=>{config={...DEFAULT_ADMIN_CONFIG,disabledGatekeepers:[vendor]}};
 await expect(user.createCalendarDraft(8,'draft','a'.repeat(64))).rejects.toThrow('disabled');expect(creates).toBe(2);
});

it('CalDAV can transfer into the same owned Mnemos account without relaxing ownership checks',async()=>{
 const user=Object.create(UserDurableObject.prototype) as UserDurableObject;
 const source={validate:async()=>{},metadata:async()=>({provider:'caldav',calendar_id:'calendar',title:'Team',time_zone:'UTC'}),readWindow:async()=>({calendar_id:'calendar',time_zone:'UTC',events_json:'[]',truncated:false})};
 let accepted=0;
 const account={getCalendarReadSource:async()=>({source,sourceKey:'private-generation',resource:{urlPattern:'mnemos://caldav/calendars/*'}}),acceptCalendarReadSource:async(project:string,request:string,key:string,cap:typeof source)=>{expect([project,request,key]).toEqual(['project','request','[8,"private-generation"]']);await cap.validate();accepted++;return {selection_id:'selected',title:'Team'}}};
 Object.assign(user,{env:{BLUEPRINTS:{get:async()=>serializeAdminConfig(DEFAULT_ADMIN_CONFIG)}},storage:{connectedAccounts:{get:(id:number)=>id===8?{id,account,vendorId:'mnemos'}:undefined}},ctx:{id:{toString:()=> 'owner'},exports:{CalendarSourceLease:({props}:any)=>new CalendarSourceGuard(props.source,()=>user.checkCalendarSourceAccounts(props.accounts))}}});
 await expect(user.prepareCalendarConnection(99,8,'calendar','project','request')).rejects.toThrow();
 await expect(user.prepareCalendarConnection(8,8,'calendar','project','request')).resolves.toMatchObject({selection_id:'selected'});expect(accepted).toBe(1);
});
