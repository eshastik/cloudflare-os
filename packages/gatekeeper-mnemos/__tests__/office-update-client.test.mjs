import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const compiled=await build({stdin:{contents:'export {MnemosAPI} from "./src/mnemos-api.ts"; export {MnemosAccountSession} from "./src/account-session.ts";',resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const {MnemosAPI,MnemosAccountSession}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const hash=n=>String(n).repeat(64);
const input=()=>({expected_head:hash(1),source_node_id:'source',source_head:hash(2),format:'docx',title:'Copy'});
const comparison=()=>({node_id:'target',head:hash(1),current_sha256:hash(3),outcome:'conflict',baseline:{source_node_id:'original',source_head:hash(4),source_sha256:hash(5),output_sha256:hash(6),unsupported:[]},incoming:{preview_id:'converted',source_node_id:'source',source_head:hash(2),source_sha256:hash(7),sha256_hex:hash(8),content_type:'application/vnd.cloudflareos.document+json',method:'GET',size_bytes:100,unsupported:['styles'],url:'https://storage.example/result'}});
const decision=()=>({current_sha256:hash(3),source_sha256:hash(7),output_sha256:hash(8),accept_unsupported:true,replace_local:true});
test('uses exact update routes and frozen input, and withholds mismatched or revoked responses',async()=>{
 let allowed=true,alter=x=>x,after=()=>{};const requests=[];
 const api=new MnemosAPI('https://mnemos.example',async()=> 'fixture',async(url,request)=>{
  requests.push({url,body:JSON.parse(request.body),method:request.method});
  const c=comparison();let value=url.endsWith('update-comparison')?c:url.endsWith('update-prepare')?{update_id:'frozen',comparison:c}:{node_id:'target',head:hash(9)};
  value=alter(value);after();return Response.json(value);
 });
 const session=new MnemosAccountSession(api,()=>allowed);
 const selected=input(),pending=session.compareOfficeUpdate('project','target',selected);selected.source_head=hash(0);
 assert.equal((await pending).incoming.source_head,hash(2));assert.equal(requests[0].body.source_head,hash(2));
 const choice=decision(),preparing=session.prepareOfficeUpdate('project','target',input(),choice);choice.replace_local=false;
 assert.equal((await preparing).update_id,'frozen');assert.equal(requests[1].body.decision.replace_local,true);
 assert.deepEqual(await session.applyOfficeUpdate('project','target','request','frozen','upload'),{node_id:'target',head:hash(9)});
 assert.deepEqual(requests[2].body,{request_id:'request',update_id:'frozen',upload_id:'upload'});
 assert(requests.every(r=>r.method==='POST'&&r.url.startsWith('https://mnemos.example/v1/projects/project/draft/nodes/target/office/')));
 for(const mutate of [c=>{c.head=hash(0)},c=>{c.incoming.source_head=hash(0)},c=>{c.outcome='update_available'},c=>{c.incoming.size_bytes=5*1024*1024},c=>{c.baseline.revision_head='bad'},c=>{c.incoming.unsupported=[123]}]){
  alter=c=>{mutate(c);return c};await assert.rejects(session.compareOfficeUpdate('project','target',input()),e=>e.status===502);
 }
 alter=x=>x;after=()=>{allowed=false};await assert.rejects(session.compareOfficeUpdate('project','target',input()),e=>e.status===401);
 const count=requests.length;await assert.rejects(session.applyOfficeUpdate('project','target','request','frozen','upload'),e=>e.status===401);assert.equal(requests.length,count);
});
