// Explicit loopback development transport; retains the validated Google entrypoints.
import worker from '../packages/gatekeeper-google/.wrangler/validate/src/google.ts';
export * from '../packages/gatekeeper-google/.wrangler/validate/src/google.ts';
const originalFetch=globalThis.fetch.bind(globalThis);
globalThis.fetch=async(input:RequestInfo|URL,init?:RequestInit)=>{
 const request=new Request(input,init),url=new URL(request.url);
 const token=url.hostname==='oauth2.googleapis.com'&&['/token','/revoke'].includes(url.pathname);
 const profile=url.hostname==='www.googleapis.com'&&url.pathname==='/oauth2/v3/userinfo';
 const drive=url.hostname==='www.googleapis.com'&&url.pathname.startsWith('/drive/v3/files/');
 if(url.protocol!=='https:'||url.port||(!token&&!profile&&!drive))throw Error('Local Google fixture rejected destination.');
 const auth=request.headers.get('authorization');
 if(auth&&auth!=='Bearer mock-drive-only')throw Error('Local Google fixture rejected credentials.');
 if(token){
  if(request.method!=='POST')throw Error('Invalid fixture token method.');
  const body=new URLSearchParams(await request.clone().text());
  if(url.pathname==='/revoke'){
   if(!body.get('token')?.startsWith('mock-google-refresh-'))throw Error('Not a fixture refresh token.');
  }else{
   if(body.get('client_id')!=='mnemos-drive-fixture'||body.get('client_secret')!=='local-fixture-not-a-provider-secret')throw Error('Not fixture client credentials.');
   if(body.get('grant_type')==='refresh_token'&&!body.get('refresh_token')?.startsWith('mock-google-refresh-'))throw Error('Not a fixture refresh token.');
  }
 }else if(request.method!=='GET')throw Error('Local Google Drive fixture is read-only.');
 return originalFetch(new Request(`https://localhost:${drive?9456:9458}${url.pathname}${url.search}`,request));
};
export default {
 async fetch(...args:Parameters<typeof worker.fetch>){
  const response=await worker.fetch(...args),location=response.headers.get('location');
  if(response.status===302&&location){
   const url=new URL(location);
   if(url.origin==='https://accounts.google.com'&&url.pathname==='/o/oauth2/v2/auth'){
    const headers=new Headers(response.headers);headers.set('location','https://localhost:9458'+url.pathname+url.search);
    return new Response(response.body,{status:response.status,headers});
   }
  }
  return response;
 }
};
