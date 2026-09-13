import {nonce,MicrosoftOAuth,MicrosoftCredentialRejected,type MicrosoftGrant,type MicrosoftIdentity} from './oauth.ts';
interface Storage {get<T>(key:string):T|undefined;put<T>(key:string,value:T):void}
interface Flow {nonce:string;stage:'initiation'|'oauth'|'consumed';expiresAt:number;verifier?:string;epoch:string}
interface State {epoch:string;identity?:MicrosoftIdentity;grant?:MicrosoftGrant;flow?:Flow}

/** Private account lifecycle for the Worker facade. Each state transition writes
 * a single record so identity, credentials and generation cannot diverge. */
export class MicrosoftAccount {
 #storage:Storage;
 #oauth:MicrosoftOAuth;
 #tail:Promise<unknown>=Promise.resolve();
 constructor(storage:Storage,oauth:MicrosoftOAuth){this.#storage=storage;this.#oauth=oauth;if(!storage.get('account'))storage.put<State>('account',{epoch:nonce()});}
 #state(){return this.#storage.get<State>('account')!;}
 #put(state:State){this.#storage.put('account',state);}
 #serial<T>(run:()=>Promise<T>):Promise<T>{const work=this.#tail.catch(()=>{}).then(run);this.#tail=work;return work;}
 start(){const state=this.#state(),value=nonce();this.#put({...state,flow:{nonce:value,stage:'initiation',expiresAt:Date.now()+600000,epoch:state.epoch}});return value;}
 async begin(initiation:string,accountId:string){
  if(!/^[a-f0-9]{64}$/.test(accountId))throw Error('Invalid account.');
  const state=this.#state(),flow=state.flow;
  if(!flow||flow.stage!=='initiation'||flow.nonce!==initiation||flow.expiresAt<=Date.now()||flow.epoch!==state.epoch)throw Error('Authorization link expired.');
  const next:Flow={nonce:nonce(),stage:'oauth',verifier:nonce(),expiresAt:Date.now()+600000,epoch:state.epoch};this.#put({...state,flow:next});
  const url=await this.#oauth.authorize(accountId+':'+next.nonce,next.verifier!);
  this.#current(next);return url;
 }
 #current(flow:Flow){const state=this.#state();if(flow.epoch!==state.epoch||state.flow?.nonce!==flow.nonce)throw Error('Microsoft account changed.');}
 async finish(code:string,nonceValue:string){
  const state=this.#state(),flow=state.flow;
  if(!flow||flow.stage!=='oauth'||flow.nonce!==nonceValue||flow.expiresAt<=Date.now()||flow.epoch!==state.epoch)throw Error('Authorization link expired.');
  this.#put({...state,flow:{...flow,stage:'consumed'}});
  return this.#serial(async()=>{
   this.#current(flow);
   const grant=await this.#oauth.exchange(code,flow.verifier!);
   const identity=await this.#oauth.identity(grant.accessToken);
   this.#current(flow);
   const owner=this.#state().identity;
   if(owner&&owner.id!==identity.id)throw Error('Reconnect must use the same Microsoft account.');
   this.#put({identity,grant,epoch:nonce()});
   return {...identity};
  });
 }
 describe(){const state=this.#state();if(!state.identity||!state.grant)throw Error('Microsoft account disconnected.');return {...state.identity};}
 canCreateCalendar(){this.describe();return this.#state().grant?.calendarWrite===true;}
 canSend(){this.describe();return this.#state().grant?.mailSend===true;}
 generation(){this.describe();return this.#state().epoch;}
 validate(generation:string){if(this.generation()!==generation)throw Error('Microsoft account changed.');}
 token(rejectedToken?:string){return this.#serial(async()=>{
  const epoch=this.generation();let grant=this.#state().grant!;
  if(grant.expiresAt<=Date.now()+60000||grant.accessToken===rejectedToken){
   try{
    const refreshed=await this.#oauth.refresh(grant.refreshToken,grant.mailSend===true,grant.calendarWrite===true);
    const identity=await this.#oauth.identity(refreshed.accessToken);
    this.validate(epoch);
    if(identity.id!==this.describe().id)throw Error('Microsoft refresh account changed.');
    this.#put({...this.#state(),grant:refreshed});grant=refreshed;
   }catch(error){
    if(error instanceof MicrosoftCredentialRejected&&this.#state().epoch===epoch)this.revoke();
    throw error;
   }
  }
  this.validate(epoch);return grant.accessToken;
 });}
 /** Local revocation removes the token pair and invalidates existing sources;
  * it does not revoke unrelated Microsoft sign-in sessions or application grants. */
 revoke(){this.#put({epoch:nonce(),identity:this.#state().identity});}
}
