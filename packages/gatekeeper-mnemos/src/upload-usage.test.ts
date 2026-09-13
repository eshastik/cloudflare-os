import {test} from 'node:test';import assert from 'node:assert/strict';
import {MnemosAccount} from './account-session.ts';
import {validateUploadUsage} from './upload-usage.ts';
test('upload usage rejects invalid counters, accepts reduced limit and fences disposed sessions',async()=>{
 const result={concurrent_limit:2,active:3,cleanup_pending:1,reserved_bytes:12};
 assert.deepEqual(validateUploadUsage(result),result);
 for(const key of Object.keys(result))for(const bad of [-1,0.5,Number.MAX_SAFE_INTEGER+1,'2',null])assert.throws(()=>validateUploadUsage({...result,[key]:bad}));
 assert.throws(()=>validateUploadUsage({...result,concurrent_limit:0}));
 const values=new Map<string,unknown>();const storage={get:<T>(k:string)=>values.get(k) as T|undefined,put:(k:string,v:unknown)=>{values.set(k,v);},delete:(k:string)=>{values.delete(k);}};
 let release:(v:Response)=>void=()=>{};let called:()=>void=()=>{};
 const requested=new Promise<void>(resolve=>{called=resolve;});
 const account=new MnemosAccount(storage,'https://memory.test',async(url,init)=>{
  if(new URL(String(url)).pathname==='/v1/whoami')return Response.json({subject:{tenant_id:'t',user_id:'owner'}});
  assert.equal(new URL(String(url)).pathname,'/v1/uploads/usage');assert.equal(init?.method,'GET');
  called();return new Promise<Response>(resolve=>{release=resolve;});
 });
 await account.connect('private-token');const session=account.session();
 const reading=session.uploadUsage();await requested;session.dispose();release(Response.json(result));
 await assert.rejects(reading);account.disconnect();
});

test('request rate snapshots reject invalid windows and counters',()=>{
 const base={concurrent_limit:32,active:0,cleanup_pending:0,reserved_bytes:0};
 const rate={limit:10,used:3,resets_at:'2026-09-13T06:00:00Z'};
 assert.deepEqual(validateUploadUsage({...base,request_rate:rate}).request_rate,rate);
 for(const bad of [{...rate,used:-1},{...rate,limit:0},{...rate,resets_at:'tomorrow'},null])assert.throws(()=>validateUploadUsage({...base,request_rate:bad}));
});

test('request rate API error survives the client boundary without retry',async()=>{
 const {MnemosAPI,REQUEST_RATE_ERROR}=await import('./mnemos-api.ts');let calls=0;
 const api=new MnemosAPI('https://memory.test',async()=>'private-token',async()=>{calls++;return Response.json({code:'request.rate_limit',message:'private detail ignored'},{status:429});});
 await assert.rejects(api.uploadUsage(),error=>error instanceof Error&&error.message===REQUEST_RATE_ERROR);
 assert.equal(calls,1);
});
