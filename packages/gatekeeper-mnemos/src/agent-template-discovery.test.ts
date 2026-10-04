import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MnemosAPI,MnemosAPIError} from './mnemos-api.ts';
import {listAgentTemplateScopes,listAgentTemplates,resolveAgentTemplate} from './agent-template-discovery.ts';
const source={template_id:'private',revision:12,title:'Форма ТЗ',purpose:'Подготовить техническое задание',kind:'document' as const,project_id:'private-folder',node_id:'private-node',source_head:'a'.repeat(64),content_type:'application/vnd.cloudflareos.document+json',user_id:'author',agent_id:'author-agent',created_at:'2026-10-03T12:00:00Z'};
const scoped={scope_id:'department',template_key:'spec',revision:5,proposal_id:'proposal',approved_by:'reviewer',approved_at:'2026-10-03T12:00:00Z',source};
function fixture(){
 const calls:unknown[]=[];
 const session={
  async listTemplateScopes(cursor:string){calls.push(['scopes',cursor]);return {scopes:[{scope_id:'team',name:'Команда',level:'group' as const,parent_id:'department',approvers:['secret-reviewer']}],next_cursor:'team'};},
  async listScopedWorkTemplates(scope:string,cursor:string){calls.push(['templates',scope,cursor]);return {selected_scope_id:scope,templates:[scoped],next_cursor:'50'};},
  async resolveWorkTemplate(scope:string,key:string){calls.push(['resolve',scope,key]);return {selected_scope_id:scope,template_key:key,scoped};},
 } as Parameters<typeof listAgentTemplates>[0];
 return {session,calls};
}
test('страница областей не раскрывает согласующих и не теряет курсор',async()=>{
 const {session,calls}=fixture();const out=await listAgentTemplateScopes(session,'previous');
 assert.deepEqual(out,{scopes:[{scopeId:'team',name:'Команда',level:'group',parentId:'department'}],nextCursor:'team'});assert.deepEqual(calls,[['scopes','previous']]);
});
test('ближайшая версия берётся из ответа сервера, а не из выбранной области',async()=>{
 const {session,calls}=fixture();const out=await listAgentTemplates(session,'team','');
 assert.equal(out.selectedScopeId,'team');assert.equal(out.nextCursor,'50');assert.deepEqual(out.templates[0].reference,{scope_id:'department',template_key:'spec',revision:5});
 assert.equal(out.templates[0].title,'Форма ТЗ');assert.equal(out.templates[0].kind,'document');
 for(const secret of ['private-folder','private-node','author-agent','secret-reviewer','proposal'])assert.ok(!JSON.stringify(out).includes(secret));
 assert.deepEqual(calls,[['templates','team','']]);
});
test('разрешение точной общей версии не заменяет её личной ревизией источника',async()=>{
 const {session,calls}=fixture();const out=await resolveAgentTemplate(session,'team','spec');
 assert.deepEqual(out.template.reference,{scope_id:'department',template_key:'spec',revision:5});assert.deepEqual(calls,[['resolve','team','spec']]);
});
test('отказ ближайшей области не вызывает родительский или личный fallback',async()=>{
 const {session,calls}=fixture();session.resolveWorkTemplate=async(scope,key)=>{calls.push(['denied',scope,key]);throw Error('Нет доступа');};
 await assert.rejects(resolveAgentTemplate(session,'team','spec'),/Нет доступа/);assert.deepEqual(calls,[['denied','team','spec']]);
});
test('пустая страница продолжает просмотр и не означает отсутствие материала',async()=>{
 const {session}=fixture();session.listScopedWorkTemplates=async scope=>({selected_scope_id:scope,templates:[],next_cursor:'100'});
 assert.deepEqual(await listAgentTemplates(session,'team','50'),{selectedScopeId:'team',templates:[],nextCursor:'100'});
});
test('личная подмена вместо серверной общей версии отвергается',async()=>{
 const {session}=fixture();session.resolveWorkTemplate=async()=>({selected_scope_id:'team',template_key:'spec',personal:source});
 await assert.rejects(resolveAgentTemplate(session,'team','spec'),/общую версию/);
});

test('каталог принимает порядок UTF-8 сервера и отвергает перестановку и дубли',async()=>{
 const templates=['\uE000','😀'].map(template_key=>({...scoped,template_key}));
 const api=new MnemosAPI('https://memory.example',async()=>'agent-token',async()=>Response.json({selected_scope_id:'team',templates}));
 const out=await listAgentTemplates(api,'team','');
 assert.deepEqual(out.templates.map(v=>v.reference.template_key),['\uE000','😀']);
 for(const invalid of [[...templates].reverse(),[templates[0],templates[0]]]){
  const broken=new MnemosAPI('https://memory.example',async()=>'agent-token',async()=>Response.json({selected_scope_id:'team',templates:invalid}));
  await assert.rejects(listAgentTemplates(broken,'team',''),e=>e instanceof MnemosAPIError&&e.status===502);
 }
});
