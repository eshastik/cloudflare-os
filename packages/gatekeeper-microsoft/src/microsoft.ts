import {createApprovedOutlookCalendar} from './calendar-create.ts';
import {sendApprovedOutlook} from './mail-send.ts';
import {DurableObject,WorkerEntrypoint} from 'cloudflare:workers';
import type {GatekeeperVendor as Vendor,GatekeeperUser,GatekeeperConnectCallback,GatekeeperUserVerifier,SupportedResource} from '@gadgets/workshop-shared/gatekeeper';
import type {MailReadSource,MailSendSource} from '@gadgets/workshop-shared/gatekeeper';
import {MicrosoftOAuth,MicrosoftCredentialRejected} from './oauth.ts';
import {MicrosoftAccount} from './account.ts';
import {SelectedOutlookCalendar} from './calendar-source.ts';
import type {CalendarReadSource,CalendarWriteSource} from '@gadgets/workshop-shared/gatekeeper';
import {SelectedOutlookReader} from './mail-source.ts';

type Env={BASE_URL:string;CLIENT_ID:string;CLIENT_SECRET:string;TENANT_ID:string};
const RESOURCE:SupportedResource={urlPattern:'https://graph.microsoft.com/v1.0/me/mailFolders/*',title:'Почта Outlook',description:'Чтение выбранной папки Outlook в Mnemos.'};
const SEND_RESOURCE:SupportedResource={urlPattern:'https://graph.microsoft.com/v1.0/me/sendMail',title:'Отправка Outlook',description:'Отправка согласованного человеком письма из выбранного аккаунта.'};
const CALENDAR_RESOURCE:SupportedResource={urlPattern:'https://graph.microsoft.com/v1.0/me/calendars/*',title:'Календарь Outlook',description:'Чтение выбранного календаря Outlook в Mnemos.'};
const CALENDAR_WRITE_RESOURCE:SupportedResource={urlPattern:'https://graph.microsoft.com/v1.0/me/calendars/*/events',title:'Создание встреч Outlook',description:'Создание согласованной встречи и отправка приглашений участникам.'};
const AVATAR={url:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="8" fill="#0078d4"/><text x="20" y="28" text-anchor="middle" font-size="25" fill="white">O</text></svg>')};
function base(env:Env){const url=new URL(env.BASE_URL);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error('Invalid Microsoft public URL.');return url.toString().replace(/\/$/,'');}
function response(text:string,status=200){return new Response(text,{status,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});}

export default {
 async fetch(request:Request,env:Env,ctx:ExecutionContext){
  if(request.method!=='GET')return response('Method not allowed.',405);
  try{
   const url=new URL(request.url),root=new URL(base(env));
   if(url.origin!==root.origin)return response('Not found.',404);
   const relative=url.pathname.slice(root.pathname==='/'?0:root.pathname.length);
   if(root.pathname!=='/'&&!url.pathname.startsWith(root.pathname+'/'))return response('Not found.',404);
   const start=/^\/([a-f0-9]{64})\/([a-f0-9]{64})$/.exec(relative);
   if(start){
    if(url.search)return response('Invalid authorization request.',400);
    const account=ctx.exports.UserAccount.get(ctx.exports.UserAccount.idFromString(start[1]));
    const destination=await account.begin(start[2]);
    return new Response(null,{status:302,headers:{Location:destination,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
   }
   if(relative!=='/oauth')return response('Not found.',404);
   if(url.searchParams.getAll('state').length!==1||url.searchParams.getAll('code').length!==1||url.searchParams.has('error'))return response('Authorization was not completed.',400);
   const state=/^([a-f0-9]{64}):([a-f0-9]{64})$/.exec(url.searchParams.get('state')!);
   if(!state)return response('Invalid authorization state.',400);
   await ctx.exports.UserAccount.get(ctx.exports.UserAccount.idFromString(state[1])).finish(url.searchParams.get('code')!,state[2]);
   return response('Outlook подключён. Закройте эту вкладку и вернитесь в CloudflareOS.');
  }catch{return response('Подключение не подтверждено. Вернитесь в CloudflareOS и повторите вход.',400);}
 }
};

export class GatekeeperVendor extends WorkerEntrypoint<Env> implements Vendor {
 async describe(){return {displayName:'Outlook',url:'https://outlook.office.com',logo:AVATAR,description:'Почта и календарь Outlook; отправка писем и создание встреч после согласования.'};}
 async getSupportedResources(){return [RESOURCE,CALENDAR_RESOURCE,SEND_RESOURCE,CALENDAR_WRITE_RESOURCE];}
 async getTypeScriptTypes(){return 'export {};';}
 async connectAccount(callback:Fetcher<GatekeeperConnectCallback>){
  const id=this.ctx.exports.UserAccount.newUniqueId();
  const initial=await this.ctx.exports.UserAccount.get(id).initialize(callback);
  return {url:base(this.env)+'/'+id+'/'+initial};
 }
}

export class UserAccount extends DurableObject<Env> {
 #account:MicrosoftAccount;
 constructor(ctx:DurableObjectState,env:Env){super(ctx,env);this.#account=new MicrosoftAccount(ctx.storage.kv,new MicrosoftOAuth({clientId:env.CLIENT_ID,clientSecret:env.CLIENT_SECRET,redirectUri:base(env)+'/oauth',tenant:env.TENANT_ID}));}
 async initialize(callback:Fetcher<GatekeeperConnectCallback>){
  if(this.ctx.storage.kv.get('callback'))throw Error('Account already initialized.');
  this.ctx.storage.kv.put('callback',callback);await this.ctx.storage.setAlarm(Date.now()+3600000);return this.#account.start();
 }
 async begin(initial:string){return this.#account.begin(initial,this.ctx.id.toString());}
 async reconnect(){if(!this.ctx.storage.kv.get('callback'))throw Error('Account unavailable.');return base(this.env)+'/'+this.ctx.id+'/'+this.#account.start();}
 async finish(code:string,state:string){
  const callback=this.ctx.storage.kv.get<Fetcher<GatekeeperConnectCallback>>('callback');if(!callback)throw Error('Account unavailable.');
  let completion=this.ctx.storage.kv.get<{state:string;generation:string;restoring:boolean}>('completion');
  if(!completion||completion.state!==state){
   await this.#account.finish(code,state);
   completion={state,generation:this.#account.generation(),restoring:!!this.ctx.storage.kv.get('connected')};
   this.ctx.storage.kv.put('completion',completion);
  }
  this.#account.validate(completion.generation);
  if(completion.restoring)await callback.credentialsRestored();
  else await callback.complete(this.ctx.exports.MicrosoftUser({props:{account:this.ctx.id.toString()}}));
  try{this.#account.validate(completion.generation);}catch{await callback.credentialsExpired();throw Error('Account disconnected.');}
  this.ctx.storage.kv.put('connected',true);this.ctx.storage.kv.delete('expiryNotificationPending');await this.ctx.storage.deleteAlarm();
 }
 async describe(){const identity=this.#account.describe();return {uniqueName:identity.id,displayName:identity.displayName,avatar:AVATAR,grantedResourceUrlPatterns:[RESOURCE.urlPattern,CALENDAR_RESOURCE.urlPattern,...(this.#account.canSend()?[SEND_RESOURCE.urlPattern]:[]),...(this.#account.canCreateCalendar()?[CALENDAR_WRITE_RESOURCE.urlPattern]:[])]};}
 async validateCalendarWrite(generation:string){this.#account.validate(generation);if(!this.#account.canCreateCalendar())throw Error('Reconnect Outlook and grant Calendars.ReadWrite before creating meetings.');}
 async createCalendar(generation:string,calendar:string,content:Parameters<CalendarWriteSource['create']>[0]){return createApprovedOutlookCalendar(calendar,content,()=>this.#token(),()=>this.validateCalendarWrite(generation));}
 async validateSend(generation:string){this.#account.validate(generation);if(!this.#account.canSend())throw Error('Reconnect Outlook and grant Mail.Send before sending.');}
 async sendMail(generation:string,content:Parameters<MailSendSource['send']>[0]){return sendApprovedOutlook(content,()=>this.#token(),()=>this.validateSend(generation));}
 async generation(){return this.#account.generation();}
 async validate(generation:string){this.#account.validate(generation);}
 async #token(){
  try{return await this.#account.token();}
  catch(error){
   if(error instanceof MicrosoftCredentialRejected){
    this.ctx.storage.kv.delete('completion');
    this.ctx.storage.kv.put('expiryNotificationPending',crypto.randomUUID());
    await this.ctx.storage.setAlarm(Date.now()+1000);
   }
   throw error;
  }
 }
 #mail(folder:string,generation:string){
  this.#account.validate(generation);
  return new SelectedOutlookReader(folder,this.#account.describe().id,()=>this.#token(),async()=>{this.#account.validate(generation);});
 }
 #calendar(calendar:string,generation:string){this.#account.validate(generation);return new SelectedOutlookCalendar(calendar,this.#account.describe().id,()=>this.#token(),async()=>{this.#account.validate(generation)});}
 async listCalendars(){return this.#calendar('root',this.#account.generation()).listCalendars();}
 async calendarMetadata(calendar:string,generation:string){return this.#calendar(calendar,generation).metadata();}
 async readCalendarWindow(calendar:string,generation:string,input:{time_min:string;time_max:string;limit:number}){return this.#calendar(calendar,generation).readWindow(input);}
 async listMailFolders(parent:string){const generation=this.#account.generation();return this.#mail(parent||'root',generation).listFolders(parent);}
 async mailMetadata(folder:string,generation:string){return this.#mail(folder,generation).metadata();}
 async readMailSelection(folder:string,generation:string,input:import('@gadgets/workshop-shared/mail-search').MailReadRequest){
  const result=await this.#mail(folder,generation).readSelection(input);
  return {provider:result.provider,query:result.query,self_addresses:result.self_addresses,messages_json:JSON.stringify(result.messages),...(result.attachment?{attachment:result.attachment}:{}),truncated:result.truncated,...(result.next_cursor?{next_cursor:result.next_cursor}:{})};
 }
 #connected(){try{this.#account.describe();return true;}catch{return false;}}
 async revoke(){this.#account.revoke();this.ctx.storage.kv.delete('completion');this.ctx.storage.kv.delete('expiryNotificationPending');await this.ctx.storage.deleteAlarm();}
 async alarm(){
  const notification=this.ctx.storage.kv.get<string>('expiryNotificationPending');
  if(notification){
   const callback=this.ctx.storage.kv.get<Fetcher<GatekeeperConnectCallback>>('callback')!;
   const connected=this.#connected();
   try{
    if(connected)await callback.credentialsRestored();else await callback.credentialsExpired();
    if(connected!==this.#connected()){
     this.ctx.storage.kv.put('expiryNotificationPending',crypto.randomUUID());await this.ctx.storage.setAlarm(Date.now()+1000);
    }else if(this.ctx.storage.kv.get('expiryNotificationPending')===notification)this.ctx.storage.kv.delete('expiryNotificationPending');
   }catch{
    if(this.ctx.storage.kv.get('expiryNotificationPending')||this.#connected()){
     this.ctx.storage.kv.put('expiryNotificationPending',crypto.randomUUID());await this.ctx.storage.setAlarm(Date.now()+60000);
    }
   }
  }else if(!this.ctx.storage.kv.get('connected')){this.#account.revoke();await this.ctx.storage.deleteAll();}
 }
}

export class MicrosoftUser extends WorkerEntrypoint<Env,{account:string}> implements GatekeeperUser {
 #account(){return this.ctx.exports.UserAccount.get(this.ctx.exports.UserAccount.idFromString(this.ctx.props.account));}
 async describe(){return this.#account().describe();}
 async getSupportedResources(){return [RESOURCE,CALENDAR_RESOURCE,SEND_RESOURCE,CALENDAR_WRITE_RESOURCE];}
 async getAuthenticatedEmail(){return null;}
 async ensureResources(patterns:string[]){if(!Array.isArray(patterns)||patterns.some(pattern=>![RESOURCE.urlPattern,CALENDAR_RESOURCE.urlPattern,SEND_RESOURCE.urlPattern,CALENDAR_WRITE_RESOURCE.urlPattern].includes(pattern)))throw Error('Unsupported Microsoft resource.');const account=await this.describe();if(patterns.some(pattern=>!account.grantedResourceUrlPatterns.includes(pattern)))return this.reconnect();return {};}
 async getVerifier():Promise<Fetcher<GatekeeperUserVerifier>>{return this.ctx.exports.MicrosoftVerifier({props:{account:this.ctx.props.account}});}
 async revoke(){await this.#account().revoke();}
 async reconnect(){return {url:await this.#account().reconnect()};}
 async getGatekeeperClassFor():Promise<never>{throw Error('Use the Mnemos connection forms.');}
 async startResourceConfigurator():Promise<never>{throw Error('Use the Mnemos connection forms.');}
 async listMailFolders(parent:string){return this.#account().listMailFolders(parent);}
 async listCalendars(){return this.#account().listCalendars();}
 async getCalendarWriteSource(calendarId:string){
  const generation=await this.#account().generation();
  await this.#account().calendarMetadata(calendarId,generation);
  const source=this.ctx.exports.MicrosoftCalendarWriteSource({props:{account:this.ctx.props.account,calendar:calendarId,generation}});
  await source.validate();return {source,sourceKey:JSON.stringify([this.ctx.props.account,calendarId,generation]),resource:CALENDAR_WRITE_RESOURCE};
 }
 async getCalendarReadSource(calendarId:string){
  const generation=await this.#account().generation();
  const source=this.ctx.exports.MicrosoftCalendarSource({props:{account:this.ctx.props.account,calendar:calendarId,generation}});
  await source.metadata();
  return {source,sourceKey:JSON.stringify([this.ctx.props.account,calendarId,generation]),resource:CALENDAR_RESOURCE};
 }
 async getMailSendSource(query:string){
  if(typeof query!=='string'||!query.startsWith('folder:')||query.length>262)throw Error('Select an Outlook folder.');
  const folder=query.slice(7),generation=await this.#account().generation();
  await this.#account().mailMetadata(folder,generation);
  const source=this.ctx.exports.MicrosoftMailSendSource({props:{account:this.ctx.props.account,generation}});
  await source.validate();return {source,sourceKey:JSON.stringify([this.ctx.props.account,folder,generation]),resource:SEND_RESOURCE};
 }
 async getMailReadSource(query:string){
  if(typeof query!=='string'||!query.startsWith('folder:')||query.length>262)throw Error('Select an Outlook folder.');
  const folder=query.slice(7),generation=await this.#account().generation();
  const source=this.ctx.exports.MicrosoftMailSource({props:{account:this.ctx.props.account,folder,generation}});
  await source.metadata();
  return {source,sourceKey:JSON.stringify([this.ctx.props.account,folder,generation]),resource:RESOURCE};
 }
}
export class MicrosoftVerifier extends WorkerEntrypoint<Env,{account:string}> implements GatekeeperUserVerifier {}
export class MicrosoftMailSource extends WorkerEntrypoint<Env,{account:string;folder:string;generation:string}> implements MailReadSource {
 #account(){return this.ctx.exports.UserAccount.get(this.ctx.exports.UserAccount.idFromString(this.ctx.props.account));}
 async validate(){await this.#account().validate(this.ctx.props.generation);}
 async metadata(){await this.validate();const result=await this.#account().mailMetadata(this.ctx.props.folder,this.ctx.props.generation);await this.validate();return result;}
 async readSelection(input:import('@gadgets/workshop-shared/mail-search').MailReadRequest){await this.validate();const result=await this.#account().readMailSelection(this.ctx.props.folder,this.ctx.props.generation,input);await this.validate();return result;}
}

export class MicrosoftCalendarSource extends WorkerEntrypoint<Env,{account:string;calendar:string;generation:string}> implements CalendarReadSource {
 #account(){return this.ctx.exports.UserAccount.get(this.ctx.exports.UserAccount.idFromString(this.ctx.props.account));}
 async validate(){await this.#account().validate(this.ctx.props.generation);}
 async metadata(){await this.validate();const result=await this.#account().calendarMetadata(this.ctx.props.calendar,this.ctx.props.generation);await this.validate();return result;}
 async readWindow(input:{time_min:string;time_max:string;limit:number}){await this.validate();const result=await this.#account().readCalendarWindow(this.ctx.props.calendar,this.ctx.props.generation,input);await this.validate();return result;}
}

/** Separate send authority; read sources never expose this operation. */
export class MicrosoftMailSendSource extends WorkerEntrypoint<Env,{account:string;generation:string}> implements MailSendSource {
 #account(){return this.ctx.exports.UserAccount.get(this.ctx.exports.UserAccount.idFromString(this.ctx.props.account));}
 async validate(){await this.#account().validateSend(this.ctx.props.generation);}
 async send(content:Parameters<MailSendSource['send']>[0]){await this.validate();return this.#account().sendMail(this.ctx.props.generation,content);}
}

/** Separate creation authority for a single selected calendar and account generation. */
export class MicrosoftCalendarWriteSource extends WorkerEntrypoint<Env,{account:string;calendar:string;generation:string}> implements CalendarWriteSource {
 #account(){return this.ctx.exports.UserAccount.get(this.ctx.exports.UserAccount.idFromString(this.ctx.props.account));}
 async validate(){await this.#account().validateCalendarWrite(this.ctx.props.generation);}
 async create(content:Parameters<CalendarWriteSource['create']>[0]){await this.validate();return this.#account().createCalendar(this.ctx.props.generation,this.ctx.props.calendar,content);}
}
