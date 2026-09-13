/** A definitive provider refusal; never carries provider response text. */
export class YandexCredentialRejected extends Error {constructor(){super('Yandex credentials expired.');}}
const SCOPES=['login:info','cloud_api:disk.read'];
export interface YandexGrant {accessToken:string;refreshToken:string;expiresAt:number}
export interface YandexIdentity {id:string;displayName:string}
export interface YandexOAuthConfig {clientId:string;clientSecret:string;redirectUri:string}
const opaque=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=8192&&!/[\s\x00-\x1f\x7f]/.test(value);
export function nonce(){return [...crypto.getRandomValues(new Uint8Array(32))].map(x=>x.toString(16).padStart(2,'0')).join('');}

/** Provider transport only; the caller owns persistent nonces, account identity and lifecycle. */
export class YandexOAuth {
 #config:YandexOAuthConfig;
 #fetch:typeof fetch;
 constructor(config:YandexOAuthConfig,fetcher:typeof fetch=fetch){
  const redirect=new URL(config.redirectUri);
  if(!opaque(config.clientId)||!opaque(config.clientSecret)||redirect.protocol!=='https:'||redirect.username||redirect.password||redirect.hash||redirect.search)throw Error('Yandex OAuth is not configured.');
  this.#config={...config};this.#fetch=fetcher;
 }
 async authorize(state:string,verifier:string){
  if(!opaque(state)||state.length>1024||!/^[a-f0-9]{64}$/.test(verifier))throw Error('Invalid authorization request.');
  const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)));
  const challenge=btoa(String.fromCharCode(...hash)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const url=new URL('https://oauth.yandex.ru/authorize');
  url.search=new URLSearchParams({response_type:'code',client_id:this.#config.clientId,redirect_uri:this.#config.redirectUri,scope:SCOPES.join(' '),force_confirm:'yes',state,code_challenge:challenge,code_challenge_method:'S256'}).toString();
  return url.toString();
 }
 async #json(url:string,init:RequestInit,refresh=false):Promise<Record<string,unknown>>{
  const fetcher=this.#fetch;let response:Response;
  try{response=await fetcher(url,{...init,redirect:'manual',signal:AbortSignal.timeout(15000)});}catch{throw Error('Yandex authorization request failed.');}
  if(response.status!==200&&!(refresh&&[400,401].includes(response.status))){await response.body?.cancel();throw Error('Yandex authorization was not accepted.');}
  const reader=response.body?.getReader();if(!reader)throw Error('Yandex authorization response unavailable.');
  const chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>65536){await reader.cancel();throw Error('Yandex authorization response too large.');}chunks.push(value);}}
  finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  let value:Record<string,unknown>;
  try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(bytes));if(!value||typeof value!=='object'||Array.isArray(value))throw Error();}catch{throw Error('Invalid Yandex authorization response.');}
  if(response.status!==200){if(value.error==='invalid_grant')throw new YandexCredentialRejected();throw Error('Yandex authorization was not accepted.');}
  return value;
 }
 async #token(fields:Record<string,string>):Promise<YandexGrant>{
  const value=await this.#json('https://oauth.yandex.ru/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...fields,client_id:this.#config.clientId,client_secret:this.#config.clientSecret}).toString()},fields.grant_type==='refresh_token');
  if(value.token_type!=='bearer'||!opaque(value.access_token)||!opaque(value.refresh_token)||!Number.isSafeInteger(value.expires_in)||Number(value.expires_in)<=0)throw Error('Invalid Yandex token response.');
  if(value.scope!==undefined&&(typeof value.scope!=='string'||!SCOPES.every(scope=>(value.scope as string).split(' ').includes(scope))))throw Error('Yandex Disk read access was not granted.');
  const expiresAt=Date.now()+Number(value.expires_in)*1000;
  if(!Number.isSafeInteger(expiresAt))throw Error('Invalid Yandex token lifetime.');
  return {accessToken:value.access_token,refreshToken:value.refresh_token,expiresAt};
 }
 exchange(code:string,verifier:string){if(!opaque(code)||!/^[a-f0-9]{64}$/.test(verifier))throw Error('Invalid authorization code.');return this.#token({grant_type:'authorization_code',code,code_verifier:verifier});}
 refresh(refreshToken:string){if(!opaque(refreshToken))throw Error('Invalid refresh request.');return this.#token({grant_type:'refresh_token',refresh_token:refreshToken});}
 async identity(accessToken:string):Promise<YandexIdentity>{
  if(!opaque(accessToken))throw Error('Yandex identity unavailable.');
  const value=await this.#json('https://login.yandex.ru/info?format=json',{method:'GET',headers:{Authorization:'OAuth '+accessToken}});
  if(typeof value.id!=='string'||!/^\d{1,64}$/.test(value.id))throw Error('Invalid Yandex identity.');
  const name=value.display_name??value.login??value.id;
  if(typeof name!=='string'||!name||name.length>1024||/[\x00-\x1f\x7f]/.test(name))throw Error('Invalid Yandex account name.');
  return {id:value.id,displayName:name};
 }
}
