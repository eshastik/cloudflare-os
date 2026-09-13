import {nonce,YandexOAuth,type YandexGrant,type YandexIdentity} from './oauth.ts';
interface Storage {get<T>(key:string):T|undefined;put<T>(key:string,value:T):void;delete(key:string):unknown}
interface Flow {nonce:string;stage:'initiation'|'oauth'|'consumed';expiresAt:number;verifier?:string;epoch:string}

/** Account-owned persistent credential state. Keep this object behind a trusted Worker facade. */
export class YandexAccount {
 #storage:Storage;
 #oauth:YandexOAuth;
 #tail:Promise<unknown>=Promise.resolve();
 constructor(storage:Storage,oauth:YandexOAuth){this.#storage=storage;this.#oauth=oauth;if(!storage.get('epoch'))storage.put('epoch',nonce());}
 #epoch(){return this.#storage.get<string>('epoch')!;}
 #serial<T>(run:()=>Promise<T>):Promise<T>{const work=this.#tail.catch(()=>{}).then(run);this.#tail=work;return work;}
 start(){const value=nonce();this.#storage.put<Flow>('flow',{nonce:value,stage:'initiation',expiresAt:Date.now()+600000,epoch:this.#epoch()});return value;}
 async begin(initiation:string,accountId:string){
  if(!/^[a-f0-9]{64}$/.test(accountId))throw Error('Invalid account.');
  const flow=this.#storage.get<Flow>('flow');
  if(!flow||flow.stage!=='initiation'||flow.nonce!==initiation||flow.expiresAt<=Date.now()||flow.epoch!==this.#epoch())throw Error('Authorization link expired.');
  const next:Flow={nonce:nonce(),stage:'oauth',verifier:nonce(),expiresAt:Date.now()+600000,epoch:flow.epoch};this.#storage.put('flow',next);
  const url=await this.#oauth.authorize(accountId+':'+next.nonce,next.verifier!);
  this.#current(next);return url;
 }
 #current(flow:Flow){if(flow.epoch!==this.#epoch()||this.#storage.get<Flow>('flow')?.nonce!==flow.nonce)throw Error('Yandex account changed.');}
 async finish(code:string,state:string){
  const flow=this.#storage.get<Flow>('flow');
  if(!flow||flow.stage!=='oauth'||flow.nonce!==state||flow.expiresAt<=Date.now()||flow.epoch!==this.#epoch())throw Error('Authorization link expired.');
  this.#storage.put('flow',{...flow,stage:'consumed'});
  return this.#serial(async()=>{
   this.#current(flow);
   const grant=await this.#oauth.exchange(code,flow.verifier!);
   const identity=await this.#oauth.identity(grant.accessToken);
   this.#current(flow);
   const owner=this.#storage.get<YandexIdentity>('identity');
   if(owner&&owner.id!==identity.id)throw Error('Reconnect must use the same Yandex account.');
   this.#storage.put('identity',identity);this.#storage.put('grant',grant);this.#storage.put('epoch',nonce());this.#storage.delete('flow');
   return identity;
  });
 }
 describe(){const identity=this.#storage.get<YandexIdentity>('identity');if(!identity||!this.#storage.get('grant'))throw Error('Yandex account disconnected.');return identity;}
 generation(){this.describe();return this.#epoch();}
 validate(generation:string){if(this.generation()!==generation)throw Error('Yandex account changed.');}
 token(rejectedToken?:string){return this.#serial(async()=>{
  const epoch=this.generation();let grant=this.#storage.get<YandexGrant>('grant')!;
  if(grant.expiresAt<=Date.now()+60000||grant.accessToken===rejectedToken){
   const refreshed=await this.#oauth.refresh(grant.refreshToken);
   const identity=await this.#oauth.identity(refreshed.accessToken);
   this.validate(epoch);
   if(identity.id!==this.describe().id)throw Error('Yandex refresh account changed.');
   this.#storage.put('grant',refreshed);grant=refreshed;
  }
  this.validate(epoch);return grant.accessToken;
 });}
 revoke(){this.#storage.put('epoch',nonce());this.#storage.delete('grant');this.#storage.delete('flow');}
}
