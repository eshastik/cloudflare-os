import assert from 'node:assert/strict';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const root = resolve(process.argv[4] || '.');
const require = createRequire(resolve(root, 'package.json'));
const { build } = require(require.resolve('esbuild', { paths: [resolve(root, 'packages/workshop-backend')] }));
const contents = String.raw`
import { avatarStorage } from './packages/workshop-backend/src/avatar-storage.ts';
import { PostgresBinaryKv } from './packages/backend-utils/src/postgres-binary-kv.ts';
export default {async fetch(request,env){
 const b=await request.json();
 try {
  const settings={...env,SHELL_STATE_TENANT:b.tenant||'probe-a',SHELL_POSTGRES:env.DB};
  if(b.fail) settings.SHELL_AVATAR_S3_SECRET_KEY='invalid';
  if(b.legacy){const kv=new PostgresBinaryKv(env.DB.connectionString,settings.SHELL_STATE_TENANT,'avatars');await kv.put(b.key,new Uint8Array(b.bytes));return Response.json({ok:true});}
  const store=avatarStorage(settings,{});
  if(b.op==='put'){await store.put(b.key,new Uint8Array(b.bytes));return Response.json({ok:true})}
  if(b.op==='delete'){await store.delete(b.key);return Response.json({ok:true})}
  if(b.op==='reference')return Response.json({photo:await store.reference(b.key)});
  const bytes=await store.get(b.key);return Response.json({bytes:bytes===null?null:Array.from(bytes)});
 }catch(error){return Response.json({error:error.name,message:String(error.message).replace(/https?:\/\/\S+/g,'<url>').replaceAll(env.SHELL_AVATAR_S3_ACCESS_KEY,'<key>').replaceAll(env.SHELL_AVATAR_S3_SECRET_KEY,'<secret>')})}
}};`;
const built = process.argv[3] && process.argv[2] !== '--bundle' ? null : await build({stdin:{contents,resolveDir:root,sourcefile:'avatar-probe.ts'},bundle:true,platform:'node',format:'esm',conditions:['workerd','worker','browser'],external:['pg-native'],banner:{js:"import { createRequire } from 'node:module';const require=createRequire('/worker.js');"},write:false});
if(process.argv[2]==='--bundle'){await writeFile(process.argv[3],built.outputFiles[0].text);process.exit(0)}
const { Miniflare } = require(require.resolve('miniflare', {paths:[require.resolve('wrangler')]}));
const path=process.argv[2];
if((await stat(path)).mode&0o077)throw new Error('Настройки проверки должны быть приватными');
const {dsn,settings}=JSON.parse(await readFile(path,'utf8'));
const parsed=new URL(dsn);
if(!parsed.pathname.startsWith('/mnemos_probe_')||!parsed.username.startsWith('mnemos_probe_'))throw new Error('Нужна отдельная тестовая БД и роль');
const script=process.argv[3]?await readFile(process.argv[3],'utf8'):built.outputFiles[0].text;
const worker=new Miniflare({modules:true,script,compatibilityDate:'2026-02-02',compatibilityFlags:['nodejs_compat','global_fetch_strictly_public'],hyperdrives:{DB:dsn},bindings:{...settings,SHELL_STATE_BACKEND:'postgres',SHELL_AVATAR_STATE_BACKEND:'s3'},host:'127.0.0.1',port:0});
const call=async b=>(await worker.dispatchFetch('http://probe',{method:'POST',body:JSON.stringify(b)})).json();
let checks=0;
try{
 const bytes=[255,216,255,...Array.from({length:256},(_,i)=>i)];
 const a={key:'probe-avatar'},b={...a,tenant:'probe-b'};
 assert.deepEqual(await call({...a,op:'put',bytes}),{ok:true});
 assert.deepEqual((await call(a)).bytes,bytes);checks++;
 assert.equal((await call(b)).bytes,null);checks++;
 const ref=(await call({...a,op:'reference'})).photo;
 assert.match(ref.version,/^[0-9a-f]{64}$/);
 const response=await fetch(ref.url);assert.equal(response.status,200);assert.deepEqual([...new Uint8Array(await response.arrayBuffer())],bytes);checks++;
 assert.equal((await call({...a,op:'put',bytes:[255,216,255,99],fail:true})).error,'Error');
 assert.deepEqual((await call(a)).bytes,bytes);checks++;
 await call({...a,op:'delete'});assert.equal((await call(a)).bytes,null);checks++;
 const old={key:'legacy-avatar'};
 await call({...old,legacy:true,bytes});
 const migrated=(await call({...old,op:'reference'})).photo;assert.equal(migrated.version,ref.version);assert.deepEqual((await call(old)).bytes,bytes);checks++;
 const race={key:'race-avatar'};
 await call({...race,legacy:true,bytes});
 await Promise.all([call({...race,op:'reference'}),call({...race,op:'delete'})]);
 assert.equal((await call(race)).bytes,null);checks++;
 console.log(JSON.stringify({checks,pass:true,actual_postgres:true,actual_s3:true}));
}finally{await worker.dispose()}
