import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const compiled=await build({stdin:{contents:'export {NativeWriteSelector} from "./src/native-writer.ts"',resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'runtime',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'runtime',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export class RpcTarget{};export class RpcStub{constructor(value){return value}}',loader:'js'}))}}]});
const {NativeWriteSelector}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
test('captured office preview pins old source independently of the current head and rejects mismatched bytes before releasing a download',async()=>{
 const head='a'.repeat(64),sha256='b'.repeat(64);let current=head,hash=sha256,conversions=0,allowed=true;
 let args;
 const session={readDraftDocument:async()=>({head:current,terms:[{metadata:{name:'Copy'}}]}),convertOffice:async(...input)=>{args=input;conversions++;return {preview_id:'preview',source_sha256:hash,unsupported:[]}},checkPrivateVersionRead:async()=>{if(!allowed)throw Error('revoked')}};
 const selector=new NativeWriteSelector(session,{});
 current='c'.repeat(64);await assert.rejects(selector.previewOffice('project','node','cloudflareos.document',{head:'invalid',sha256}),/version/);assert.equal(conversions,0);
 hash='d'.repeat(64);await assert.rejects(selector.previewOffice('project','node','cloudflareos.document',{head,sha256}),/checksum/);
 hash=sha256;const preview=await selector.previewOffice('project','node','cloudflareos.document',{head,sha256});assert.equal(preview.head,current);assert.equal(args[2],current);assert.equal(args[6],head);assert.equal((await preview.download.issue()).source_sha256,sha256);
 allowed=false;await assert.rejects(preview.download.issue(),/revoked/);
});
