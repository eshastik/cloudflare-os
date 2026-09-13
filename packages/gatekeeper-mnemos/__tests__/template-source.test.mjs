import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readTemplateProposalText} from '../app/template-source.ts';
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
