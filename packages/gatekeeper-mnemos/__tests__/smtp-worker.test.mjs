import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {execFileSync} from 'node:child_process';import {build} from 'esbuild';import {Miniflare} from 'miniflare';import {smtpFixture} from './smtp-fixture.mjs';
const harness=`import {DurableObject} from 'cloudflare:workers';
import {SmtpClient} from './src/smtp-client.ts';import {connectSmtp} from './src/smtp-sockets.ts';import {MailDrafts} from './src/mail-drafts.ts';
const owner={tenant:'tenant',owner:'owner',epoch:'epoch'};
export class Draft extends DurableObject {
 async fetch(request){const input=await request.json();const drafts=new MailDrafts(this.ctx.storage.kv),validate=async()=>{};
 try{
 let result;
 if(input.action==='stage')result=await drafts.stage({...owner,connection:'mail',agent:'agent'},input.request,input.content,validate);
 if(input.action==='decide')result=await drafts.decide(input.id,owner,input.sha256,true,validate);
 if(input.action==='read')result=await drafts.read(input.id,owner,validate);
 if(input.action==='send')result=await drafts.dispatch(input.id,owner,input.sha256,validate,content=>new SmtpClient(this.env.SERVER,{username:'owner',password:'password',from:'owner@example.test'},connectSmtp,validate).send(content));
 return Response.json(result);
 }catch(error){return new Response(error.message,{status:409})}
 }
}
export default {fetch(request,env){return env.DRAFTS.get(env.DRAFTS.idFromName('draft')).fetch(request)}};`;
test('production Worker socket sends approved mail over TLS/STARTTLS and does not resend after restart or lost ACK',{timeout:30000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mnemos-smtp-worker-'));let mf,server;
 try{
 const certPath=join(dir,'cert.pem'),keyPath=join(dir,'key.pem');execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost','-keyout',keyPath,'-out',certPath],{stdio:'ignore',timeout:5000});
 const cert=await readFile(certPath,'utf8'),key=await readFile(keyPath,'utf8');
 const compiled=await build({stdin:{contents:harness,resolveDir:process.cwd()},bundle:true,format:'esm',platform:'browser',external:['cloudflare:*'],write:false});
 for(const security of ['tls','starttls']){
 server=await smtpFixture(cert,key,security);
 const options={modules:true,script:compiled.outputFiles[0].text,compatibilityDate:'2026-02-02',compatibilityFlags:['nodejs_compat'],durableObjects:{DRAFTS:{className:'Draft',useSQLite:true}},resourcePersistencePath:join(dir,security),bindings:{SERVER:{host:'localhost',port:server.port,security}},outboundService:{network:{allow:['local'],tlsOptions:{trustedCertificates:[cert]}}}};
 mf=new Miniflare(options);
 const call=async body=>mf.dispatchFetch('https://fixture/',{method:'POST',body:JSON.stringify(body)});
 const content={to:['recipient@example.test'],subject:'Проверка Worker',body:'Exact approved body\n.\r\nКонец'};
 let response=await call({action:'stage',request:'first',content});assert.equal(response.status,200);const draft=await response.json();
 assert.equal((await call({action:'send',id:draft.id,sha256:draft.sha256})).status,409);assert.equal(server.messages.length,0);
 assert.equal((await call({action:'decide',id:draft.id,sha256:draft.sha256})).status,200);assert.equal(server.messages.length,0);
 response=await call({action:'send',id:draft.id,sha256:draft.sha256});assert.equal(response.status,200,await response.clone().text());assert.equal((await response.json()).delivery.state,'accepted');assert.equal(server.messages.length,1);
 const raw=server.messages[0];assert.match(raw,/From: owner@example.test\r\nTo: recipient@example.test/);assert.equal(Buffer.from(raw.match(/Subject: =\?UTF-8\?B\?([^?]+)\?=/)[1],'base64').toString(),content.subject);assert.equal(Buffer.from(raw.slice(raw.indexOf('\r\n\r\n')+4).replace(/\s/g,''),'base64').toString(),content.body);
 await mf.dispose();mf=new Miniflare(options);assert.equal((await call({action:'send',id:draft.id,sha256:draft.sha256})).status,200);assert.equal(server.messages.length,1);
 const uncertain=await (await call({action:'stage',request:'uncertain',content})).json();await call({action:'decide',id:uncertain.id,sha256:uncertain.sha256});server.state.dropAck=true;
 assert.equal((await call({action:'send',id:uncertain.id,sha256:uncertain.sha256})).status,409);assert.equal(server.messages.length,2);
 await mf.dispose();mf=new Miniflare(options);assert.equal((await call({action:'send',id:uncertain.id,sha256:uncertain.sha256})).status,409);assert.equal(server.messages.length,2);
 assert.equal((await (await call({action:'read',id:uncertain.id})).json()).delivery.state,'attempted');assert(server.commands.filter(c=>c.name==='AUTH').every(c=>c.secure));if(security==='starttls')assert(server.commands.some(c=>c.name==='STARTTLS'&&!c.secure));
 await mf.dispose();mf=undefined;await server.close();server=undefined;
 }
 }finally{await mf?.dispose();await server?.close();await rm(dir,{recursive:true,force:true});}
});
