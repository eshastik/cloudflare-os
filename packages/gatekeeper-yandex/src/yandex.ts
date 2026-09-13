import {createLogger} from '@gadgets/backend-utils/logger';
import {DurableObject,WorkerEntrypoint} from 'cloudflare:workers';
import type {GatekeeperVendor as Vendor,GatekeeperUser,GatekeeperConnectCallback,GatekeeperUserVerifier,SupportedResource} from '@gadgets/workshop-shared/gatekeeper';
import type {DriveImportSource} from '@gadgets/workshop-shared/drive-import';
import {YandexOAuth,YandexCredentialRejected} from './oauth.ts';
import {YandexAccount} from './account.ts';
import {YandexDiskImportReader} from './drive-import.ts';

type Env={BASE_URL:string;CLIENT_ID:string;CLIENT_SECRET:string};
const logger=createLogger<{event:string;vendorId:string}>({component:'gatekeeper.yandex',vendorId:'yandex'});
const RESOURCE:SupportedResource={urlPattern:'https://disk.yandex.ru/*',title:'Импорт Яндекс Диска',description:'Чтение выбранного файла для копирования в Mnemos.'};
const AVATAR={url:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="8" fill="#fc3f1d"/><text x="20" y="29" text-anchor="middle" font-size="29" fill="white">Я</text></svg>')};
function base(env:Env){const url=new URL(env.BASE_URL);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error('Invalid Yandex public URL.');return url.toString().replace(/\/$/,'');}
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
   return response('Яндекс Диск подключён. Закройте эту вкладку и вернитесь в CloudflareOS.');
  }catch(error){logger.warn('Yandex connection failed',{event:'connection.failed',error});return response('Подключение не подтверждено. Вернитесь в CloudflareOS и повторите вход.',400);}
 }
};

export class GatekeeperVendor extends WorkerEntrypoint<Env> implements Vendor {
 async describe(){return {displayName:'Яндекс Диск',url:'https://disk.yandex.ru',logo:AVATAR,description:'Импорт выбранных файлов в Mnemos. Исходные файлы не изменяются.'};}
 async getSupportedResources(){return [RESOURCE];}
 async getTypeScriptTypes(){return 'export {};';}
 async connectAccount(callback:Fetcher<GatekeeperConnectCallback>){
  const id=this.ctx.exports.UserAccount.newUniqueId();
  const initial=await this.ctx.exports.UserAccount.get(id).initialize(callback);
  return {url:base(this.env)+'/'+id+'/'+initial};
 }
}

export class UserAccount extends DurableObject<Env> {
 #account:YandexAccount;
 constructor(ctx:DurableObjectState,env:Env){super(ctx,env);this.#account=new YandexAccount(ctx.storage.kv,new YandexOAuth({clientId:env.CLIENT_ID,clientSecret:env.CLIENT_SECRET,redirectUri:base(env)+'/oauth'}));}
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
  else await callback.complete(this.ctx.exports.YandexUser({props:{account:this.ctx.id.toString()}}));
  try{this.#account.validate(completion.generation);}catch{await callback.credentialsExpired();throw Error('Account disconnected.');}
  this.ctx.storage.kv.put('connected',true);this.ctx.storage.kv.delete('expiryNotificationPending');await this.ctx.storage.deleteAlarm();
 }
 async describe(){const identity=this.#account.describe();return {uniqueName:identity.id,displayName:identity.displayName,avatar:AVATAR,grantedResourceUrlPatterns:[RESOURCE.urlPattern]};}
 async generation(){return this.#account.generation();}
 async validate(generation:string){this.#account.validate(generation);}
 async read(fileId:string,generation:string){
  const validate=async()=>{this.#account.validate(generation);};
  let usedToken:string|undefined;
  const read=()=>new YandexDiskImportReader(async()=>{usedToken=await this.#account.token();return usedToken;},validate).snapshot(fileId);
  try{return await read();}
  catch(error){
   if(!(error instanceof YandexCredentialRejected))throw error;
   try{
    await validate();await this.#account.token(usedToken);await validate();
    return await read();
   }catch(retryError){
    if(retryError instanceof YandexCredentialRejected){
     await validate();this.#account.revoke();this.ctx.storage.kv.delete('completion');
     this.ctx.storage.kv.put('expiryNotificationPending',crypto.randomUUID());await this.ctx.storage.setAlarm(Date.now()+1000);
    }
    throw retryError;
   }
  }
 }
 async revoke(){this.#account.revoke();this.ctx.storage.kv.delete('completion');this.ctx.storage.kv.delete('expiryNotificationPending');await this.ctx.storage.deleteAlarm();}
 async alarm(){
  const notification=this.ctx.storage.kv.get<string>('expiryNotificationPending');
  if(notification){
   const callback=this.ctx.storage.kv.get<Fetcher<GatekeeperConnectCallback>>('callback')!;
   const connected=!!this.ctx.storage.kv.get('grant');
   try{
    if(connected)await callback.credentialsRestored();else await callback.credentialsExpired();
    if(connected!==!!this.ctx.storage.kv.get('grant')){
     this.ctx.storage.kv.put('expiryNotificationPending',crypto.randomUUID());await this.ctx.storage.setAlarm(Date.now()+1000);
    }else if(this.ctx.storage.kv.get('expiryNotificationPending')===notification)this.ctx.storage.kv.delete('expiryNotificationPending');
   }catch{
    if(this.ctx.storage.kv.get('expiryNotificationPending')||this.ctx.storage.kv.get('grant')){
     this.ctx.storage.kv.put('expiryNotificationPending',crypto.randomUUID());await this.ctx.storage.setAlarm(Date.now()+60000);
    }
   }
  }else if(!this.ctx.storage.kv.get('connected')){this.#account.revoke();await this.ctx.storage.deleteAll();}
 }
}

export class YandexUser extends WorkerEntrypoint<Env,{account:string}> implements GatekeeperUser {
 #account(){return this.ctx.exports.UserAccount.get(this.ctx.exports.UserAccount.idFromString(this.ctx.props.account));}
 async describe(){return this.#account().describe();}
 async getSupportedResources(){return [RESOURCE];}
 async getAuthenticatedEmail(){return null;}
 async ensureResources(patterns:string[]){if(!Array.isArray(patterns)||patterns.some(pattern=>pattern!==RESOURCE.urlPattern))throw Error('Unsupported Yandex resource.');await this.describe();return {};}
 async getVerifier():Promise<Fetcher<GatekeeperUserVerifier>>{return this.ctx.exports.YandexVerifier({props:{account:this.ctx.props.account}});}
 async revoke(){await this.#account().revoke();}
 async reconnect(){return {url:await this.#account().reconnect()};}
 async getGatekeeperClassFor():Promise<never>{throw Error('Use the Mnemos file import form.');}
 async startResourceConfigurator():Promise<never>{throw Error('Use the Mnemos file import form.');}
 async getDriveImportSource(fileId:string){
  if(typeof fileId!=='string'||fileId.length>255||!fileId.startsWith('disk:/'))throw Error('Invalid Disk file.');
  const generation=await this.#account().generation();
  const source=this.ctx.exports.YandexDriveSource({props:{account:this.ctx.props.account,fileId,generation}});
  await source.validate();
  return {source,sourceKey:JSON.stringify([this.ctx.props.account,fileId,generation]),resource:RESOURCE};
 }
}
export class YandexVerifier extends WorkerEntrypoint<Env,{account:string}> implements GatekeeperUserVerifier {}
export class YandexDriveSource extends WorkerEntrypoint<Env,{account:string;fileId:string;generation:string}> implements DriveImportSource {
 #account(){return this.ctx.exports.UserAccount.get(this.ctx.exports.UserAccount.idFromString(this.ctx.props.account));}
 async validate(){await this.#account().validate(this.ctx.props.generation);}
 async read(){await this.validate();const result=await this.#account().read(this.ctx.props.fileId,this.ctx.props.generation);await this.validate();return result;}
}
