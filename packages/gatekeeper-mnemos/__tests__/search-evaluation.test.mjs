import {test} from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {JSDOM} from 'jsdom';
const compile=async(entry)=>{const b=await build({entryPoints:[entry],bundle:true,platform:'node',format:'esm',write:false});return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));};
const {decodeSearchEvaluation,evaluateSearch,scoreSearch}=await compile('src/search-evaluation.ts');const {SearchEvaluation}=await compile('app/search-evaluation.ts');
const ref=(node_id,ordinal=0)=>({node_id,ordinal});
const page=(refs,extra={})=>({hits:refs.map(r=>({...r,project_id:'p',name:'doc',text:'authorized text'})),index_pending:false,degraded:false,...extra});
const fixture={format:'mnemos.search-evaluation',version:1,name:'Controlled set',revision:'one',k:2,cases:[{id:'partial',query:'partial',relevant:[ref('a'),ref('b')]},{id:'empty',query:'empty',relevant:[ref('a')]},{id:'no-labels',query:'none',relevant:[]},{id:'pending',query:'pending',relevant:[ref('a')]}]};
test('retrieval scoring has explicit denominators, skips unavailable index and never inflates duplicates',async()=>{
 const set=decodeSearchEvaluation(JSON.stringify(fixture));
 const r=await evaluateSearch('p',set,async q=>q==='partial'?page([ref('a'),ref('irrelevant'),ref('b')]):q==='pending'?page([],{index_pending:true}):page([]));
 assert.equal(r.measured,3);assert.equal(r.unavailable,1);assert.equal(r.recall,.25);assert.equal(r.recall_cases,2);assert.equal(r.precision,.5);assert.equal(r.precision_cases,1);
 assert.deepEqual(r.cases[0].hits,[ref('a'),ref('irrelevant')]);assert.equal(r.cases[1].recall,0);assert.equal(r.cases[1].precision,null);assert.equal(r.cases[2].recall,null);
 assert.throws(()=>scoreSearch('p',[ref('a')],2,page([ref('a'),ref('a')])));
 assert.throws(()=>scoreSearch('other',[ref('a')],2,page([ref('a')])));
 for(const change of [{k:21},{cases:[{id:'bad',query:'x',relevant:[ref('a'),ref('a')]}]},{cases:[...fixture.cases,fixture.cases[0]]}])assert.throws(()=>decodeSearchEvaluation(JSON.stringify({...fixture,...change})));
});
test('UI binds scores to exact source and discards them on changed reference or failed refresh',async()=>{
 const dom=new JSDOM('<main/>');globalThis.document=dom.window.document;let denied=false,changed=false,reads=0;
 try{
  const api={readPublishedHead:async()=>({shared_head:'corpus-version'}),listPrivateDocuments:async()=>({documents:[]}),whoAmI:async()=>({subject:{user_id:'observer'}}),readDraftDocument:async()=>{if(denied)throw Error('denied');reads++;return {exists:true,conflicted:false,content_type:'application/json',head:changed&&reads%2===0?'b':'a'};},searchProject:async()=>page([ref('a')])};
  const root=document.querySelector('main'),view=new SearchEvaluation(root,api,[],()=>{},async()=>JSON.stringify(fixture));await view.load('p');await view.run('node');assert.match(root.textContent,/Recall@2/);
  denied=true;await view.run('node');assert.match(root.textContent,/Проверка недоступна/);assert.doesNotMatch(root.textContent,/Recall@2/);
  denied=false;changed=true;await view.run('node');assert.doesNotMatch(root.textContent,/Recall@2/);
 }finally{dom.window.close();delete globalThis.document;}
});
