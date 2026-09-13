// Development entrypoint only. run-dev-server.js selects this explicitly on loopback.
// Production wrangler.jsonc always imports the unmodified Yandex worker.
import {createLogger} from '../packages/backend-utils/src/logger.ts';
const logger=createLogger<{event:string;vendorId:string;route?:string}>({component:'dev.drive-fixture',vendorId:'yandex'});
import worker from '../packages/gatekeeper-yandex/src/yandex.ts';
export * from '../packages/gatekeeper-yandex/src/yandex.ts';
const originalFetch=globalThis.fetch.bind(globalThis);
globalThis.fetch=async (input:RequestInfo|URL,init?:RequestInit)=>{
 const request=new Request(input,init),url=new URL(request.url);
 const oauth=['oauth.yandex.ru','login.yandex.ru'].includes(url.hostname);
 const drive=['cloud-api.yandex.net','downloader.disk.yandex.ru'].includes(url.hostname);
 if(url.protocol!=='https:'||url.port||(!oauth&&!drive))throw Error('Local drive fixture rejected destination.');
 const auth=request.headers.get('authorization');
 if(auth&&auth!=='OAuth mock-drive-only')throw Error('Local drive fixture rejected non-fixture credentials.');
 if(request.method==='POST'){
  const body=new URLSearchParams(await request.clone().text());
  if(url.hostname!=='oauth.yandex.ru'||url.pathname!=='/token'||body.get('client_id')!=='mnemos-drive-fixture'||body.get('client_secret')!=='local-fixture-not-a-provider-secret')throw Error('Local drive fixture rejected token request.');
 }else if(request.method!=='GET')throw Error('Local drive fixture is read-only.');
 const target=`https://localhost:${oauth?9457:9456}${url.pathname}${url.search}`;
 try{return await originalFetch(new Request(target,request));}catch(error){logger.warn('Local fixture transport failed',{event:'fixture.transport.failed',route:url.pathname,error});throw error;}
};
export default {
 async fetch(...args:Parameters<typeof worker.fetch>){
  const response=await worker.fetch(...args);
  const location=response.headers.get('location');
  if(response.status===302&&location){
   const url=new URL(location);
   if(url.origin==='https://oauth.yandex.ru'&&url.pathname==='/authorize'){
    const headers=new Headers(response.headers);
    headers.set('location','https://localhost:9457/authorize'+url.search);
    return new Response(response.body,{status:response.status,headers});
   }
  }
  return response;
 }
};
