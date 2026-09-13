/** A definitive provider refusal; never carries provider response text. */
export class MicrosoftCredentialRejected extends Error {constructor(){super('Microsoft credentials expired.');}}
const SCOPES=['https://graph.microsoft.com/User.Read','https://graph.microsoft.com/Mail.Read','https://graph.microsoft.com/Calendars.Read','offline_access'];
const scopes=(send:boolean,calendarWrite=false)=>[...SCOPES.map(scope=>calendarWrite&&scope==='https://graph.microsoft.com/Calendars.Read'?'https://graph.microsoft.com/Calendars.ReadWrite':scope),...(send?['https://graph.microsoft.com/Mail.Send']:[])];
const TENANT=/^(?:common|organizations|consumers|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/;
export interface MicrosoftGrant {accessToken:string;refreshToken:string;expiresAt:number;mailSend?:true;calendarWrite?:true}
export interface MicrosoftIdentity {id:string;displayName:string}
export interface MicrosoftOAuthConfig {clientId:string;clientSecret:string;redirectUri:string;tenant:string}
const opaque=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=16384&&!/[\s\x00-\x1f\x7f]/.test(value);
export function nonce(){return [...crypto.getRandomValues(new Uint8Array(32))].map(x=>x.toString(16).padStart(2,'0')).join('');}

/** Provider transport only; the caller owns persistent nonces, account identity and lifecycle. */
export class MicrosoftOAuth {
 #config:MicrosoftOAuthConfig;
 #fetch:typeof fetch;
 constructor(config:MicrosoftOAuthConfig,fetcher:typeof fetch=fetch){
  const redirect=new URL(config.redirectUri);
  if(!TENANT.test(config.tenant)||!opaque(config.clientId)||!opaque(config.clientSecret)||redirect.protocol!=='https:'||redirect.username||redirect.password||redirect.hash||redirect.search)throw Error('Microsoft OAuth is not configured.');
  this.#config={...config};this.#fetch=fetcher;
 }
 async authorize(state:string,verifier:string){
  if(!opaque(state)||state.length>1024||!/^[a-f0-9]{64}$/.test(verifier))throw Error('Invalid authorization request.');
  const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)));
  const challenge=btoa(String.fromCharCode(...hash)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const url=new URL('https://login.microsoftonline.com/'+this.#config.tenant+'/oauth2/v2.0/authorize');
  url.search=new URLSearchParams({response_type:'code',client_id:this.#config.clientId,redirect_uri:this.#config.redirectUri,scope:scopes(true,true).join(' '),response_mode:'query',prompt:'select_account',state,code_challenge:challenge,code_challenge_method:'S256'}).toString();
  return url.toString();
 }
 async #json(url:string,init:RequestInit,refresh=false):Promise<Record<string,unknown>>{
  const fetcher=this.#fetch;let response:Response;
  try{response=await fetcher(url,{...init,redirect:'manual',signal:AbortSignal.timeout(15000)});}catch{throw Error('Microsoft authorization request failed.');}
  if(response.status!==200&&!(refresh&&[400,401].includes(response.status))){await response.body?.cancel();throw Error('Microsoft authorization was not accepted.');}
  const reader=response.body?.getReader();if(!reader)throw Error('Microsoft authorization response unavailable.');
  const chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>65536){await reader.cancel();throw Error('Microsoft authorization response too large.');}chunks.push(value);}}
  catch{throw Error('Microsoft authorization response unavailable.');}
  finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  let value:Record<string,unknown>;
  try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(bytes));if(!value||typeof value!=='object'||Array.isArray(value))throw Error();}catch{throw Error('Invalid Microsoft authorization response.');}
  if(response.status!==200){if(value.error==='invalid_grant')throw new MicrosoftCredentialRejected();throw Error('Microsoft authorization was not accepted.');}
  return value;
 }
 async #token(fields:Record<string,string>,send=false,calendarWrite=false):Promise<MicrosoftGrant>{
  const value=await this.#json('https://login.microsoftonline.com/'+this.#config.tenant+'/oauth2/v2.0/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...fields,client_id:this.#config.clientId,client_secret:this.#config.clientSecret,scope:scopes(send,calendarWrite).join(' ')}).toString()},fields.grant_type==='refresh_token');
  if(value.token_type!=='Bearer'||!opaque(value.access_token)||!opaque(value.refresh_token)||!Number.isSafeInteger(value.expires_in)||Number(value.expires_in)<60||Number(value.expires_in)>86400)throw Error('Invalid Microsoft token response.');
  let mailSend=false,calendarGranted=false;
  if(value.scope!==undefined){
   if(typeof value.scope!=='string'||value.scope.length>8192)throw Error('Invalid Microsoft scope response.');
   let scopes:string[];
   try{scopes=value.scope.split(' ').map(scope=>decodeURIComponent(scope).toLowerCase().replace(/^https:\/\/graph\.microsoft\.com\//,''));}catch{throw Error('Invalid Microsoft scope response.');}
   if(!['user.read','mail.read'].every(scope=>scopes.includes(scope))||!scopes.some(scope=>['calendars.read','calendars.readwrite'].includes(scope)))throw Error('Outlook read access was not granted.');
   mailSend=scopes.includes('mail.send');calendarGranted=scopes.includes('calendars.readwrite');
  }
  const expiresAt=Date.now()+Number(value.expires_in)*1000;
  if(!Number.isSafeInteger(expiresAt))throw Error('Invalid Microsoft token lifetime.');
  return {accessToken:value.access_token,refreshToken:value.refresh_token,expiresAt,...(mailSend?{mailSend:true as const}:{}),...(calendarGranted?{calendarWrite:true as const}:{})};
 }
 exchange(code:string,verifier:string){if(!opaque(code)||!/^[a-f0-9]{64}$/.test(verifier))throw Error('Invalid authorization code.');return this.#token({grant_type:'authorization_code',code,code_verifier:verifier,redirect_uri:this.#config.redirectUri},true,true);}
 refresh(refreshToken:string,send=false,calendarWrite=false){if(!opaque(refreshToken))throw Error('Invalid refresh request.');return this.#token({grant_type:'refresh_token',refresh_token:refreshToken},send,calendarWrite);}
 async identity(accessToken:string):Promise<MicrosoftIdentity>{
  if(!opaque(accessToken))throw Error('Microsoft identity unavailable.');
  const value=await this.#json('https://graph.microsoft.com/v1.0/me?$select=id,displayName',{method:'GET',headers:{Authorization:'Bearer '+accessToken}});
  if(typeof value.id!=='string'||!/^[A-Za-z0-9_+=/-]{1,255}$/.test(value.id))throw Error('Invalid Microsoft identity.');
  const name=value.displayName??value.id;
  if(typeof name!=='string'||!name||name.length>1024||/[\x00-\x1f\x7f]/.test(name))throw Error('Invalid Microsoft account name.');
  return {id:value.id,displayName:name};
 }
}
