import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const compiled=await build({entryPoints:[fileURLToPath(new URL('./account-session.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});
const {MnemosAccount}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const human={subject:{tenant_id:'tenant',user_id:'owner'}};
const receipt={connection_id:'connection',project_id:'project',provider:'google',query_sha256:'b'.repeat(64),revision:2,enabled:false};
function storage(){const map=new Map<string,unknown>();return {get:<T>(key:string)=>map.get(key) as T|undefined,put:<T>(key:string,value:T)=>{map.set(key,value);},delete:(key:string)=>{map.delete(key);}};}
test('Mail management uses owner API routes and preserves explicit revoke',async()=>{
 const seen:{path:string;body:any}[]=[];let count=0;
 const account=new MnemosAccount(storage(),'https://memory.example',async(input,init)=>{
  if(++count===1)return Response.json(human);
  const path=new URL(String(input)).pathname;const body=init?.body?JSON.parse(String(init.body)):undefined;seen.push({path,body});
  return Response.json(path.endsWith('/grants')?{revision:3}:path.endsWith('/disable')?{disabled:true}:receipt);
 });
 await account.connect('human-token');const session=account.session();
 assert.deepEqual(await session.readMailConnection('connection'),receipt);
 await session.registerMailConnection('project','request','selection');
 await session.setMailReadGrant('connection',{principal_id:'agent',connection_revision:2,expected_revision:2,enabled:false});
 await session.disableMailConnection('connection',2);
 assert.deepEqual(seen.map(x=>x.path),['/v1/mail-connections/connection','/v1/projects/project/mail','/v1/mail-connections/connection/grants','/v1/mail-connections/connection/disable']);
 assert.deepEqual(seen[1].body,{request_id:'request',selection_id:'selection'});assert.equal(seen[2].body.enabled,false);session.dispose();
});
test('Disconnect during mail receipt read withholds the result',async()=>{
 let finish!:(value:Response)=>void;let count=0;
 const account=new MnemosAccount(storage(),'https://memory.example',async()=>++count===1?Response.json(human):new Promise(resolve=>{finish=resolve;}));
 await account.connect('human-token');const session=account.session();const pending=session.readMailConnection('connection');
 await new Promise(resolve=>setTimeout(resolve,0));account.disconnect();finish(Response.json(receipt));await assert.rejects(pending);session.dispose();
});

test('Saved mail survives expired human login, but disconnect fences pending reads and same-owner reconnect',async t=>{
 const {MailSelections}=await import('./mail-selection.ts');
 let now=Date.now();t.mock.method(Date,'now',()=>now);
 const kv=storage();let user='owner';
 const account=new MnemosAccount(kv,'https://memory.example',async()=>Response.json({subject:{tenant_id:'tenant',user_id:user}}));
 assert.equal(account.calendarEpoch(),undefined);
 await account.connect('human-token',now+1000);
 const epoch=account.calendarEpoch();assert.ok(epoch);
 const selections=new MailSelections(kv);
 let duringRead=()=>{};
 const source={validate:async()=>{},metadata:async()=>({provider:'google',query:'label:team'}),readSelection:async()=>{duringRead();return {provider:'google',query:'label:team',messages_json:'[{"message_id":"message"}]',truncated:false};}};
 const selected=await selections.prepare({tenant:'tenant',owner:'owner',epoch},'project','request','source',source as any,async()=>{});
 const record=await selections.resolve(selected.selection_id,{tenant:'tenant',owner:'owner',project:'project',request:'request'},()=>account.calendarEpoch());
 const read={selection_id:'opaque',tenant_id:'tenant',owner_id:'owner',project_id:'project',connection_id:selected.selection_id,query_sha256:record.querySHA256,limit:1};
 now+=1001;
 assert.throws(()=>account.session());
 // A cancelled browser login must not cancel the independent mail association.
 kv.put('loginRevocationEpoch','cancelled-login');
 assert.equal((await selections.readSelection(selected.selection_id,read,()=>account.calendarEpoch())).messages.length,1);
 await account.connect('renewed-human-token',now+1000);
 assert.equal(account.calendarEpoch(),epoch);
 user='other-owner';await assert.rejects(account.connect('other-token',now+1000));user='owner';
 duringRead=()=>account.disconnect();
 await assert.rejects(selections.readSelection(selected.selection_id,read,()=>account.calendarEpoch()),/unavailable/);
 assert.equal(account.calendarEpoch(),undefined);
 await account.connect('reconnected-human-token',now+1000);
 assert.notEqual(account.calendarEpoch(),epoch);
 await assert.rejects(selections.readSelection(selected.selection_id,read,()=>account.calendarEpoch()),/unavailable/);
});

test('Human message read uses the common authorized route and withholds a pending result after disconnect',async()=>{
 let finish!:(value:Response)=>void;let count=0;const query={limit:5,search:{text:'смета'},cursor:'opaque'};
 const account=new MnemosAccount(storage(),'https://memory.example',async(input,init)=>{
  if(++count===1)return Response.json(human);
  assert.equal(new URL(String(input)).pathname,'/v1/projects/project/mail/connection/messages');assert.equal(init?.method,'POST');assert.deepEqual(JSON.parse(String(init?.body)),query);
  return new Promise(resolve=>{finish=resolve;});
 });
 await account.connect('human-token');const session=account.session();const pending=session.readMailMessages('project','connection',query);
 await new Promise(resolve=>setTimeout(resolve,0));account.disconnect();finish(Response.json({provider:'imap',query_sha256:'b'.repeat(64),messages:[],truncated:false}));await assert.rejects(pending);session.dispose();
});
