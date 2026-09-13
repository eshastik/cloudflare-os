import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const out=await build({entryPoints:[new URL('../src/webdav-accounts.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'esm',write:false});
const {WebDAVAccounts,webdavServers}=await import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));
const owner={tenant:'team',owner:'alice',epoch:'login1'},input={request:'12345678-1234-1234-1234-123456789abc',server:'corp-fixture',username:'alice',password:'app-password'};
function fixture(){
 const rows=new Map(),state={epoch:owner.epoch,calls:0,after(){},fail:false},servers=webdavServers(JSON.stringify([{id:'corp-fixture',title:'Fixture',url:'https://dav.example/root/'}]));
 const storage={get:key=>structuredClone(rows.get(key)),put:(key,value)=>rows.set(key,structuredClone(value)),delete:key=>rows.delete(key)};
 const fetcher=async(url,init)=>{state.calls++;state.after();if(state.fail)return new Response('denied',{status:401});
  if(init.method==='GET')return new Response('abc',{headers:{etag:'"one"','content-type':'text/plain'}});
  const directory=new URL(url).pathname.endsWith('/');
  return new Response(`<d:multistatus xmlns:d="DAV:"><d:response><d:href>${new URL(url).pathname}</d:href><d:propstat><d:prop><d:resourcetype>${directory?'<d:collection/>':''}</d:resourcetype><d:getetag>"one"</d:getetag><d:getcontentlength>3</d:getcontentlength><d:getcontenttype>text/plain</d:getcontenttype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`,{status:207});
 };return {rows,state,servers,create:()=>new WebDAVAccounts(storage,servers,()=>state.epoch,fetcher)};
}
test('connection checks only root, retries retain identity, and safe summaries omit password',async()=>{
 const f=fixture(),a=f.create();const first=await a.connect(owner,input);assert.equal(f.state.calls,1);assert.deepEqual(await a.connect(owner,input),first);assert.equal(f.state.calls,1);assert.ok(!JSON.stringify(a.list(owner)).includes(input.password));
 assert.deepEqual(f.rows.get('webdavAccount:'+input.request).connection_audit.map(e=>e.phase),['connecting','enabled']);
 const selection=a.select(owner,first.id);assert.equal((await a.read(first.id,selection.generation,'a.txt')).provider,'webdav');
 await assert.rejects(a.connect(owner,{...input,password:'changed'}));assert.throws(()=>a.select({...owner,owner:'bob'},first.id));assert.throws(()=>a.remove({...owner,owner:'bob'},first.id));
 a.remove(owner,first.id);assert.throws(()=>a.validate(first.id,selection.generation));assert.ok(!JSON.stringify([...f.rows]).includes(input.password));
 assert.deepEqual(f.rows.get('webdavAccount:'+input.request).connection_audit.map(e=>e.phase),['connecting','enabled','removed']);
 await a.connect(owner,input);assert.throws(()=>a.validate(first.id,selection.generation));
});
test('epoch, configured root and removal during reads invalidate saved authority',async()=>{
 for(const mode of ['epoch','root','remove']){
  const f=fixture(),a=f.create();await a.connect(owner,input);const selected=a.select(owner,input.request);
  f.state.after=()=>{if(mode==='epoch')f.state.epoch='other';else if(mode==='root')f.servers[0].url='https://other.example/';else a.remove(owner,input.request);};
  await assert.rejects(a.read(input.request,selected.generation,'a.txt'));
 }
});
test('failed or revoked setup deletes password and does not resurrect a removed account',async()=>{
 for(const mode of ['denied','remove','epoch']){
  const f=fixture(),a=f.create();f.state.fail=mode==='denied';f.state.after=()=>{if(mode==='remove')a.remove(owner,input.request);if(mode==='epoch')f.state.epoch='other';};
  await assert.rejects(a.connect(owner,input));assert.ok(!JSON.stringify([...f.rows]).includes(input.password));
 }
 assert.throws(()=>webdavServers('[{"id":"corp-x","title":"X","url":"https://user:secret@foreign.test/"}]'));
});
