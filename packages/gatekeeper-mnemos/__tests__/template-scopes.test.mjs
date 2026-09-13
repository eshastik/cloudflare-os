import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {build} from 'esbuild';
const built=await build({stdin:{contents:'export {TemplateScopeView} from "./app/template-scopes.ts";',resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const {TemplateScopeView}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
test('scope UI creates hierarchy and recovers current revision after lost update response',async()=>{
 const dom=new JSDOM('<main></main>');globalThis.document=dom.window.document;const root=document.querySelector('main');const rows=[];const calls=[];let lose=false;
 const api={listManagedTemplateScopes:async()=>({scopes:structuredClone(rows)}),setTemplateScope:async(id,expected,config)=>{calls.push({id,expected,config:structuredClone(config)});const old=rows.findIndex(s=>s.scope_id===id);assert.equal(expected,old<0?0:rows[old].revision);const saved={...config,scope_id:id,revision:expected+1};if(old<0)rows.push(saved);else rows[old]=saved;if(lose)throw new Error('lost response');return structuredClone(saved);}};
 const view=new TemplateScopeView(root,api,()=>{});const button=text=>[...root.querySelectorAll('button')].find(b=>b.textContent===text);
 const settle=async()=>{const deadline=Date.now()+1000;while([...root.querySelectorAll('button')].every(b=>b.disabled)){assert(Date.now()<deadline);await new Promise(r=>setTimeout(r,1));}};
 const input=(label,value)=>{const e=root.querySelector(`[aria-label="${label}"]`);assert(e);e.value=value;e.dispatchEvent(new dom.window.Event(e.tagName==='SELECT'?'change':'input'));};
 try{
  await view.load();
  for(const [id,level,parent] of [['org','organization',''],['dep','department','org'],['team','group','dep']]){
   button('Новая область').click();input('ID области',id);input('Название области',id);input('Уровень области',level);
   if(parent){input('ID родительской области',parent);input('ID группы читателей',id+'-readers');}
   input('ID согласующих через запятую','reviewer-a, reviewer-b');button('Сохранить область').click();await settle();assert(root.textContent.includes('Настройки области сохранены'));assert.equal(calls.at(-1).expected,0);
  }
  await view.load();button('team · team · включена').click();const toggle=root.querySelector('[aria-label="Область включена"]');toggle.checked=false;toggle.dispatchEvent(new dom.window.Event('change'));lose=true;button('Сохранить область').click();await settle();assert.equal(calls.at(-1).expected,1);assert(!button('Сохранить область'));assert(root.textContent.includes('Изменение не подтверждено'));
  button('Перечитать области').click();await settle();button('team · team · выключена').click();assert(root.textContent.includes('Конфигурация 2'));assert.equal(root.querySelector('[aria-label="ID области"]').disabled,true);
  input('ID согласующих через запятую','reviewer-c');lose=false;button('Сохранить область').click();await settle();assert.equal(calls.at(-1).expected,2);assert.deepEqual(rows.at(-1).approvers,['reviewer-c']);assert.equal(rows.at(-1).enabled,false);
 }finally{dom.window.close();delete globalThis.document;}
});
