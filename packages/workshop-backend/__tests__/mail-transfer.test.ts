import {it,expect} from 'vitest';
import type {MailReadSource,GatekeeperUser} from '@gadgets/workshop-shared/gatekeeper';
import {UserDurableObject} from '../src/user.js';
import {MailSourceGuard,MailSendLease} from '../src/mail-source-lease.js';
import {DEFAULT_ADMIN_CONFIG,serializeAdminConfig} from '../src/admin-config.js';

it('transfers only owned accounts and retains current policy checks around saved-source reads',async()=>{
 let config=DEFAULT_ADMIN_CONFIG,sourceLive=true,targetLive=true,sourceExpired=false,targetExpired=false;
 let factoryCalls=0,acceptCalls=0,duringRead=()=>{};
 let saved:MailReadSource|undefined;
 const resource={urlPattern:'https://mail.google.com/mail/*',title:'Calendar',description:''};
 const source={validate:async()=>{},metadata:async()=>({provider:'google',query:'label:team'}),readSelection:async()=>{duringRead();return {provider:'google',query:'label:team',messages_json:'[]',truncated:false};}} as Fetcher<MailReadSource>;
 const google={getMailReadSource:async(id:string)=>{factoryCalls++;expect(id).toBe('label:team');return {source,sourceKey:'account-calendar-generation',resource};}} as Fetcher<GatekeeperUser>;
 const mnemos={getSupportedResources:async()=>[{urlPattern:'mnemos://imap/mailboxes/*',title:'IMAP',description:'',receives:'mail' as const}],acceptMailReadSource:async(project:string,request:string,key:string,received:MailReadSource)=>{acceptCalls++;expect([project,request]).toEqual(['project','request']);expect(key).toBe('[7,"account-calendar-generation"]');saved=received;await received.validate();return {selection_id:'selection',query:'label:team'};}} as Fetcher<GatekeeperUser>;
 const user=Object.create(UserDurableObject.prototype) as UserDurableObject;
 Object.assign(user,{
  env:{BLUEPRINTS:{get:async()=>serializeAdminConfig(config)}},
  storage:{connectedAccounts:{get:(id:number)=>id===7&&sourceLive?{id,account:google,vendorId:'google',credentialsExpired:sourceExpired}:id===8&&targetLive?{id,account:mnemos,vendorId:'mnemos',credentialsExpired:targetExpired}:undefined}},
  ctx:{id:{toString:()=> 'user-id'},exports:{MailSourceLease:({props}:any)=>{expect(props.userId).toBe('user-id');return new MailSourceGuard(props.source,()=>user.checkCalendarSourceAccounts(props.accounts));}}},
 });
 await expect(user.prepareMailConnection(99,8,'label:team','project','request')).rejects.toThrow('unavailable');
 config={...DEFAULT_ADMIN_CONFIG,disabledGatekeepers:['google']};
 await expect(user.prepareMailConnection(7,8,'label:team','project','request')).rejects.toThrow('disabled');expect(factoryCalls).toBe(0);
 config={...DEFAULT_ADMIN_CONFIG,disabledResources:{google:[resource.urlPattern]}};
 await expect(user.prepareMailConnection(7,8,'label:team','project','request')).rejects.toThrow('disabled');expect(acceptCalls).toBe(0);
 config=DEFAULT_ADMIN_CONFIG;
 await expect(user.prepareMailConnection(7,8,'label:team','project','request')).resolves.toEqual({selection_id:'selection',query:'label:team'});
 expect(saved).toBeDefined();expect(saved).not.toBe(source);
 targetExpired=true;await expect(saved!.validate()).resolves.toBeUndefined();
 await expect(user.prepareMailConnection(7,8,'label:team','project','request')).rejects.toThrow('unavailable');
 targetExpired=false;
 const query={limit:1};
 await expect(saved!.readSelection(query)).resolves.toMatchObject({messages_json:'[]'});
 duringRead=()=>{config={...DEFAULT_ADMIN_CONFIG,disabledResources:{google:[resource.urlPattern]}};};
 await expect(saved!.readSelection(query)).rejects.toThrow('disabled');
 config=DEFAULT_ADMIN_CONFIG;duringRead=()=>{targetLive=false;};
 await expect(saved!.readSelection(query)).rejects.toThrow('unavailable');
 targetLive=true;duringRead=()=>{};sourceExpired=true;
 await expect(saved!.validate()).rejects.toThrow('unavailable');
 sourceExpired=false;sourceLive=false;
 await expect(saved!.metadata()).rejects.toThrow('unavailable');
});

it('registers through an owned, valid, enabled Mnemos account only',async()=>{
 let config=DEFAULT_ADMIN_CONFIG,expired=false;
 const calls:unknown[][]=[];
 const account={getSupportedResources:async()=>[{urlPattern:'mnemos://imap/mailboxes/*',title:'IMAP',description:'',receives:'mail' as const}],registerMailSelection:async(...args:unknown[])=>{calls.push(args);return {connection_id:'connection'};}};
 const user=Object.create(UserDurableObject.prototype) as UserDurableObject;
 Object.assign(user,{
  env:{BLUEPRINTS:{get:async()=>serializeAdminConfig(config)}},
  storage:{connectedAccounts:{get:(id:number)=>id===8?{id,account,vendorId:'mnemos',credentialsExpired:expired}:id===7?{id,account:{...account,getSupportedResources:async()=>[]},vendorId:'google'}:undefined}},
 });
 for(const id of [0,NaN,99,7])await expect(user.registerMailSelection(id,'project','request','selection')).rejects.toThrow();
 expired=true;await expect(user.registerMailSelection(8,'project','request','selection')).rejects.toThrow('unavailable');
 expired=false;config={...DEFAULT_ADMIN_CONFIG,disabledGatekeepers:['mnemos']};
 await expect(user.registerMailSelection(8,'project','request','selection')).rejects.toThrow('disabled');
 expect(calls).toHaveLength(0);config=DEFAULT_ADMIN_CONFIG;
 await expect(user.registerMailSelection(8,'project','request','selection')).resolves.toEqual({connection_id:'connection'});
 expect(calls).toEqual([['project','request','selection']]);
});

it.each(['google','microsoft'])('lists %s folders only for the owner and rechecks account and policy after provider IO',async(vendor)=>{
 const pattern=vendor==='google'?'https://mail.google.com/*':'https://graph.microsoft.com/v1.0/me/mailFolders/*';
 let config=DEFAULT_ADMIN_CONFIG,live=true,expired=false,calls=0,hook=()=>{};
 const account={getSupportedResources:async()=>[],listMailFolders:async(parent:string)=>{calls++;expect(parent).toBe('parent');hook();return {folders:[{id:'child',name:'Team',hasChildren:false}],truncated:false}}};
 const user=Object.create(UserDurableObject.prototype) as UserDurableObject;
 Object.assign(user,{env:{BLUEPRINTS:{get:async()=>serializeAdminConfig(config)}},storage:{connectedAccounts:{get:(id:number)=>id===9&&live?{id,account,vendorId:vendor,credentialsExpired:expired}:undefined}}});
 await expect(user.listMailFolders(99,'parent')).rejects.toThrow();
 config={...DEFAULT_ADMIN_CONFIG,disabledGatekeepers:[vendor]};await expect(user.listMailFolders(9,'parent')).rejects.toThrow('disabled');
 config={...DEFAULT_ADMIN_CONFIG,disabledResources:{[vendor]:[pattern]}};await expect(user.listMailFolders(9,'parent')).rejects.toThrow('disabled');
 config=DEFAULT_ADMIN_CONFIG;expired=true;await expect(user.listMailFolders(9,'parent')).rejects.toThrow('unavailable');expect(calls).toBe(0);
 expired=false;await expect(user.listMailFolders(9,'parent')).resolves.toMatchObject({folders:[{id:'child'}]});
 hook=()=>{live=false};await expect(user.listMailFolders(9,'parent')).rejects.toThrow('unavailable');
});

it.each(['google','microsoft','mnemos'])('explicit %s send resolves the saved owned account and rejects a substituted generation or disabled provider',async(vendor)=>{
 let config=DEFAULT_ADMIN_CONFIG,key='saved-generation',sends=0;
 const user=Object.create(UserDurableObject.prototype) as UserDurableObject;
 const sourceId=vendor==='mnemos'?8:7,coordinates=JSON.stringify([sourceId,'saved-generation']);
 const outcome=vendor==='mnemos'?{accepted:true}:{message_id:'sent'};
 const source={validate:async()=>{},send:async()=>{sends++;return outcome}};
 const provider={getMailSendSource:async(query:string)=>{expect(query).toBe('label:team');return {source,sourceKey:key,resource:{urlPattern:'https://mail.google.com/mail/*'}}}};
 const receiver={getSupportedResources:async()=>[{urlPattern:'mnemos://imap/mailboxes/*',title:'IMAP',description:'',receives:'mail' as const}],prepareMailDraftSend:async()=>({sourceKey:coordinates,query:'label:team'}),sendMailDraft:async(id:string,hash:string,saved:string,cap:typeof source)=>{expect([id,hash,saved]).toEqual(['draft','a'.repeat(64),coordinates]);return {state:'accepted',...await cap.send()}}};
 Object.assign(user,{env:{BLUEPRINTS:{get:async()=>serializeAdminConfig(config)}},storage:{connectedAccounts:{get:(id:number)=>id===8&&vendor==='mnemos'?{id,account:{...provider,...receiver},vendorId:vendor}:id===7?{id,account:provider,vendorId:vendor}:id===8?{id,account:receiver,vendorId:'mnemos'}:undefined}},ctx:{id:{toString:()=> 'human'},exports:{MailSendLease:({props}:any)=>{const lease=Object.create(MailSendLease.prototype);Object.assign(lease,{ctx:{props,exports:{UserDurableObject:{idFromString:()=> 'human',get:()=>user}}}});return lease;}}}});
 await expect(user.sendMailDraft(99,'draft','a'.repeat(64))).rejects.toThrow('unavailable');
 key='substituted';await expect(user.sendMailDraft(8,'draft','a'.repeat(64))).rejects.toThrow('changed');expect(sends).toBe(0);
 key='saved-generation';config={...DEFAULT_ADMIN_CONFIG,disabledGatekeepers:[vendor]};await expect(user.sendMailDraft(8,'draft','a'.repeat(64))).rejects.toThrow('disabled');expect(sends).toBe(0);
 config=DEFAULT_ADMIN_CONFIG;await expect(user.sendMailDraft(8,'draft','a'.repeat(64))).resolves.toEqual({state:'accepted',...outcome});expect(sends).toBe(1);
});

it('transfers an IMAP source within the same owned Mnemos account and retains revocation checks',async()=>{
 let config=DEFAULT_ADMIN_CONFIG,live=true;
 const resource={urlPattern:'mnemos://imap/mailboxes/*',title:'IMAP',description:'',receives:'mail' as const};
 const source={validate:async()=>{if(!live)throw Error('revoked')},metadata:async()=>({provider:'imap',query:'folder'}),readSelection:async()=>({provider:'imap',query:'folder',messages_json:'[]',truncated:false})};
 let saved:MailReadSource|undefined;
 const account={getSupportedResources:async()=>[resource],getMailReadSource:async(query:string)=>{expect(query).toBe('folder:mailbox');return {source,sourceKey:'generation',resource}},acceptMailReadSource:async(_project:string,_request:string,key:string,received:MailReadSource)=>{expect(key).toBe('[8,"generation"]');saved=received;await received.validate();return {selection_id:'selected',query:'folder'}},listMailFolders:async()=>({folders:[{id:'mailbox',name:'INBOX',hasChildren:false}],truncated:false})};
 const user=Object.create(UserDurableObject.prototype) as UserDurableObject;
 Object.assign(user,{env:{BLUEPRINTS:{get:async()=>serializeAdminConfig(config)}},storage:{connectedAccounts:{get:(id:number)=>id===8?{id,account,vendorId:'mnemos'}:undefined}},ctx:{id:{toString:()=> 'user-id'},exports:{MailSourceLease:({props}:any)=>new MailSourceGuard(props.source,()=>user.checkCalendarSourceAccounts(props.accounts))}}});
 await expect(user.listMailFolders(8,'')).resolves.toMatchObject({folders:[{id:'mailbox'}]});
 await expect(user.prepareMailConnection(8,8,'folder:mailbox','project','request')).resolves.toMatchObject({selection_id:'selected'});
 await expect(saved!.validate()).resolves.toBeUndefined();live=false;await expect(saved!.validate()).rejects.toThrow('revoked');live=true;
 config={...DEFAULT_ADMIN_CONFIG,disabledResources:{mnemos:[resource.urlPattern]}};
 await expect(saved!.validate()).rejects.toThrow('disabled');await expect(user.listMailFolders(8,'')).rejects.toThrow('disabled');
});

const mailReceiver=(declared:boolean)=>({
 getSupportedResources:async()=>[{urlPattern:'memory://mail/*',title:'Mail',description:'',...(declared?{receives:'mail' as const}:{})}],
 acceptMailReadSource:async()=>({selection_id:'selected',query:'label:team'}),
 registerMailSelection:async()=>({connection_id:'connection'}),
});
it('hands mail sources to any vendor declaring a receiving resource and refuses an undeclared one apart from an unavailable account',async()=>{
 const resource={urlPattern:'https://mail.google.com/mail/*',title:'Mail',description:''};
 const source={validate:async()=>{},metadata:async()=>({provider:'google',query:'label:team'}),readSelection:async()=>({provider:'google',query:'label:team',messages_json:'[]',truncated:false})};
 const google={getMailReadSource:async()=>({source,sourceKey:'generation',resource})};
 const user=Object.create(UserDurableObject.prototype) as UserDurableObject;
 Object.assign(user,{env:{BLUEPRINTS:{get:async()=>serializeAdminConfig(DEFAULT_ADMIN_CONFIG)}},storage:{connectedAccounts:{get:(id:number)=>id===7?{id,account:google,vendorId:'google'}:id===8?{id,account:mailReceiver(true),vendorId:'memory'}:id===9?{id,account:mailReceiver(false),vendorId:'other'}:undefined}},ctx:{id:{toString:()=> 'user-id'},exports:{MailSourceLease:({props}:any)=>new MailSourceGuard(props.source,()=>user.checkCalendarSourceAccounts(props.accounts))}}});
 await expect(user.prepareMailConnection(7,8,'label:team','project','request')).resolves.toMatchObject({selection_id:'selected'});
 await expect(user.registerMailSelection(8,'project','request','selection')).resolves.toEqual({connection_id:'connection'});
 const refused=await user.prepareMailConnection(7,9,'label:team','project','request').catch((error:Error)=>error.message);
 expect(refused).toBe('This account does not receive mail sources.');
 await expect(user.registerMailSelection(9,'project','request','selection')).rejects.toThrow('does not receive mail sources');
 await expect(user.prepareMailConnection(7,99,'label:team','project','request')).rejects.toThrow('unavailable');
});
