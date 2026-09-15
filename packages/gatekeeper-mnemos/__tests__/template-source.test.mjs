import {JSDOM} from 'jsdom';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const compiled=await build({entryPoints:[fileURLToPath(new URL('../app/template-source.ts',import.meta.url))],bundle:true,format:'esm',platform:'node',write:false});
const {readTemplateProposalText}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const source={proposal_id:'proposal',source:{template_id:'template',revision:2,source_head:'a'.repeat(64),project_id:'project',node_id:'node',content_type:'text/plain'}};
test('template preview uses host capability and rechecks source after transfer',async()=>{
 let reads=0;const text='<script>Exact source</script>';
 const result=await readTemplateProposalText({readTemplateProposalSource:async()=>{reads++;return source;}},'proposal',async(...args)=>{assert.deepEqual(args,['project','node','template-proposal:proposal',0]);assert.equal(reads,1);return text;});
 assert.equal(result,text);assert.equal(reads,2);
});
test('template preview withholds host failure, changed source and revoked access',async()=>{
 for(const mode of ['download','changed','revoked']){
  let reads=0;await assert.rejects(readTemplateProposalText({readTemplateProposalSource:async()=>{reads++;if(reads===2&&mode==='revoked')throw new Error('Denied');return reads===2&&mode==='changed'?{...source,source:{...source.source,revision:3}}:source;}},'proposal',async()=>{if(mode==='download')throw new Error('Hash mismatch');return 'content';}));
 }
});

test('предпросмотр Blueprint показывает текст документа без архива и исполняемой разметки',async()=>{
 const dom=new JSDOM('<main></main>');globalThis.document=dom.window.document;
 try{
  const bytes=new TextEncoder().encode('frozen-code');
  const hash=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
  const value={schema:'mnemos.blueprint-template',schemaVersion:1,blueprint:{id:'blueprint',version:4,title:'Договор',archiveSHA256:hash,archiveBase64:Buffer.from(bytes).toString('base64')},nativeDocument:{format:'cloudflareos.document',formatVersion:1,document:{blocks:[{id:'one',html:'<h2>Условия</h2><p>Оплата<br>через месяц</p><script>throw Error("execute")</script>'}]}}};
  const metadata={...source,source:{...source.source,content_type:'application/vnd.mnemos.blueprint-template+json'}};
  const text=await readTemplateProposalText({readTemplateProposalSource:async()=>metadata},'proposal',async()=>JSON.stringify(value));
  assert.match(text,/Договор/);assert.match(text,/Оплата\nчерез месяц/);assert(!text.includes('archiveBase64'));assert(!text.includes('execute'));assert(!text.includes('<h2>'));
  value.blueprint.archiveSHA256='0'.repeat(64);
  await assert.rejects(readTemplateProposalText({readTemplateProposalSource:async()=>metadata},'proposal',async()=>JSON.stringify(value)));
 }finally{dom.window.close();delete globalThis.document}
});
