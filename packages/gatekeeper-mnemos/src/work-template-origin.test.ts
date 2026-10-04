import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MnemosAPI,MnemosAPIError} from './mnemos-api.ts';
import {readDocumentTemplateOriginView} from './work-template-origin.ts';

const head='a'.repeat(64),sourceHead='b'.repeat(64);
const form={scope_id:'department',template_key:'spec',revision:5};
const origin={project_id:'project',node_id:'document',head,initiated_by:'human',executed_by:'agent',operation_id:'operation',created_at_ms:1791000000000,form,inputs:[{reference:form,source_head:sourceHead}]};
const source={template_id:'private',revision:12,title:'Форма ТЗ',purpose:'Подготовить ТЗ',kind:'document' as const,project_id:'private-folder',node_id:'source',source_head:sourceHead,content_type:'application/vnd.cloudflareos.document+json',user_id:'author',agent_id:'',created_at:'2026-10-03T00:00:00Z'};
function fixture(){
 let reads=0;const calls:unknown[]=[];
 const session={async readDocumentTemplateOrigin(project:string,node:string,version:string){reads++;calls.push(['origin',project,node,version]);return structuredClone(origin);},async readWorkTemplateSelection(refs:unknown){calls.push(['selection',refs]);return {materials:[{reference:form,scoped:{scope_id:'department',template_key:'spec',revision:5,proposal_id:'proposal',approved_by:'reviewer',approved_at:'2026-10-03T00:00:00Z',source}}]};}};
 return {session,calls,reads:()=>reads};
}
test('клиент запрашивает точный результат, принимает null и отвергает подмены происхождения',async()=>{
 let url='';const api=new MnemosAPI('https://memory.example',async()=>'token',async(input)=>{url=String(input);return Response.json(origin);});
 assert.deepEqual(await api.readDocumentTemplateOrigin('project','document',head),origin);
 assert.equal(url,'https://memory.example/v1/projects/project/documents/document/versions/'+head+'/template-origin');
 const absent=new MnemosAPI('https://memory.example',async()=>'token',async()=>Response.json(null));
 assert.equal(await absent.readDocumentTemplateOrigin('project','document',head),null);
 for(const change of [{project_id:'other'},{node_id:'other'},{head:'c'.repeat(64)},{inputs:[]},{inputs:[origin.inputs[0],origin.inputs[0]]},{form:{...form,revision:6}},{inputs:[{reference:form,source_head:'0'.repeat(64)}]},{initiated_by:''},{created_at_ms:-1}]){
  const forged=new MnemosAPI('https://memory.example',async()=>'token',async()=>Response.json({...origin,...change}));
  await assert.rejects(forged.readDocumentTemplateOrigin('project','document',head),e=>e instanceof MnemosAPIError&&e.status===502);
 }
 await assert.rejects(api.readDocumentTemplateOrigin('project','document','0'.repeat(64)),e=>e instanceof MnemosAPIError&&e.status===400);
});
test('подписи сохраняют общую ревизию и повторно проверяют права после чтения метаданных',async()=>{
 const {session,calls}=fixture();const out=await readDocumentTemplateOriginView(session,'project','document',head);
 assert.equal(out?.materials[0].title,'Форма ТЗ');assert.equal(out?.materials[0].reference.revision,5);
 assert.equal(JSON.stringify(out).includes('private-folder'),false);
 assert.deepEqual(calls,[['origin','project','document',head],['selection',[form]],['origin','project','document',head]]);
});
test('отзыв во время чтения названий и несовпадение исходного снимка не дают частичного происхождения',async()=>{
 const revoked=fixture();revoked.session.readWorkTemplateSelection=async()=>{throw Error('denied');};
 await assert.rejects(readDocumentTemplateOriginView(revoked.session,'project','document',head),/denied/);
 const after=fixture();let reads=0;after.session.readDocumentTemplateOrigin=async()=>{if(++reads===2)throw Error('revoked');return origin;};
 await assert.rejects(readDocumentTemplateOriginView(after.session,'project','document',head),/revoked/);
 const changed=fixture();changed.session.readWorkTemplateSelection=async()=>({materials:[{reference:form,scoped:{scope_id:'department',template_key:'spec',revision:5,proposal_id:'proposal',approved_by:'reviewer',approved_at:'2026-10-03T00:00:00Z',source:{...source,source_head:'c'.repeat(64)}}}]});
 await assert.rejects(readDocumentTemplateOriginView(changed.session,'project','document',head),/не совпала/);
});
test('отсутствие записи не читает каталог и не обещает применение шаблонов',async()=>{
 const calls:unknown[]=[];const out=await readDocumentTemplateOriginView({async readDocumentTemplateOrigin(){return null;},async readWorkTemplateSelection(){calls.push('unexpected');throw Error('unexpected');}},'project','document',head);
 assert.equal(out,null);assert.deepEqual(calls,[]);
});
