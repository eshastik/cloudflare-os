import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {fileURLToPath} from 'node:url';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function freePort(){const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));return port;}
test('версия загруженного Worker читается без аккаунта и не кэшируется',{timeout:20000},async()=>{
 const folder=await mkdtemp(join(tmpdir(),'mnemos-worker-probe-'));let child,log='';
 try{const port=await freePort(),inspector=await freePort();child=spawn(process.execPath,[fileURLToPath(new URL('../../../node_modules/wrangler/bin/wrangler.js',import.meta.url)),'dev','-c','wrangler.jsonc','--ip','127.0.0.1','--port',String(port),'--inspector-port',String(inspector),'--persist-to',folder,'--var','MNEMOS_WORKER_RELEASE:'+ 'a'.repeat(40),'--var','MNEMOS_APP_SHA256:'+ 'b'.repeat(64),'--var','MNEMOS_API_ORIGIN:https://memory.example'],{cwd:fileURLToPath(new URL('..',import.meta.url)),detached:true,env:{PATH:process.env.PATH,WRANGLER_SEND_METRICS:'false',CI:'true'},stdio:['ignore','pipe','pipe']});for(const stream of [child.stdout,child.stderr])stream.on('data',b=>{log=(log+b.toString()).slice(-20000);});
 let response;const start=performance.now();while(performance.now()-start<15000){try{response=await fetch('http://127.0.0.1:'+port+'/gatekeeper/mnemos/runtime-version',{signal:AbortSignal.timeout(250)});if(response.status===200)break;}catch{}if(child.exitCode!==null)throw Error(log);await delay(20);}
 assert.equal(response?.status,200,log.slice(-4000));assert.equal(response.headers.get('cache-control'),'no-store');assert.deepEqual(await response.json(),{worker_release:'a'.repeat(40),app_sha256:'b'.repeat(64)});assert.equal((await fetch('http://127.0.0.1:'+port+'/other')).status,404);
 }finally{if(child?.pid){try{process.kill(-child.pid,'SIGTERM');}catch{}const until=performance.now()+1000;while(child.exitCode===null&&child.signalCode===null&&performance.now()<until)await delay(10);try{process.kill(-child.pid,'SIGKILL');}catch{}}await rm(folder,{recursive:true,force:true});}
});
