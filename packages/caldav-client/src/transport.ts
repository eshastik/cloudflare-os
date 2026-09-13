/** Deployment-owned HTTPS destinations, never derived from a DAV response. */
export interface CalDAVServer {url:string;origins:string[];icloud?:true;}
/** Private credentials supplied by the connected human account. */
export interface CalDAVCredential {username:string;password:string;}
const unavailable=()=>Error('CalDAV request unavailable.');
/** Bounds a single operation, checks every destination before adding credentials,
 * and revalidates account authority around each network call. */
export function caldavTransport(server:CalDAVServer,credential:CalDAVCredential,validate:()=>Promise<void>,fetcher:typeof fetch=fetch){
 const origins=new Set(server.origins);
 const check=(input:string)=>{const url=new URL(input);if(url.protocol!=='https:'||url.username||url.password||url.hash||url.href.length>8192||!(origins.has(url.origin)||server.icloud===true&&url.port===''&&/^p\d{1,3}-caldav\.icloud\.com$/.test(url.hostname)))throw unavailable();return url;};
 if(origins.size<1||origins.size>32)throw unavailable();for(const origin of origins)if(check(origin).origin!==origin)throw unavailable();check(server.url);
 if(typeof credential.username!=='string'||!credential.username||credential.username.length>255||/[:\x00-\x1f\x7f]/.test(credential.username)||typeof credential.password!=='string'||!credential.password||credential.password.length>4096||/[\x00\r\n]/.test(credential.password))throw unavailable();
 const authorization='Basic '+btoa(String.fromCharCode(...new TextEncoder().encode(credential.username+':'+credential.password)));
 const signal=AbortSignal.timeout(30000);let calls=0,total=0;
 const transport:typeof fetch=async(input,init={})=>{
  try{
   const url=check(typeof input==='string'?input:input instanceof URL?input.href:input.url);
   if(++calls>64)throw unavailable();const method=(init.method??'GET').toUpperCase();if(!['GET','OPTIONS','PROPFIND','REPORT','PUT'].includes(method))throw unavailable();
   await validate();signal.throwIfAborted();
   const headers=new Headers(init.headers);headers.set('Authorization',authorization);
   const response=await fetcher(url.href,{...init,method,headers,redirect:'manual',signal});
   const reader=response.body?.getReader(),chunks:Uint8Array[]=[];let size=0;
   try{if(reader)for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;total+=part.value.length;if(size>2*1024*1024||total>4*1024*1024){await reader.cancel();throw unavailable();}chunks.push(part.value);}}finally{reader?.releaseLock();}
   await validate();
   // Redirects are returned for DAV discovery only; the next request repeats the
   // destination check. A write is never replayed at its Location header.
   if(method==='PUT'&&response.status>=300&&response.status<400)throw unavailable();
   const body=new Uint8Array(size);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.length;}
   if(['PROPFIND','REPORT'].includes(method)&&response.ok&&/<!DOCTYPE|<!ENTITY/i.test(new TextDecoder().decode(body)))throw unavailable();
   return new Response([204,205,304].includes(response.status)?null:body,{status:response.status,headers:response.headers});
  }catch{throw unavailable();}
 };
 return {fetch:transport,check};
}
