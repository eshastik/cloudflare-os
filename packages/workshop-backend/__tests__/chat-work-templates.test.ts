import {test} from 'vitest';
import assert from 'node:assert/strict';
import {prepareChatWorkTemplates} from '../src/chat-work-templates.js';
import type {ChatWorkTemplateReference,WorkTemplateReference} from '@gadgets/workshop-shared/work-template';
const personal={template_id:'method',revision:3};
const scoped={scope_id:'department',template_key:'form',revision:5};
const choice=(reference:WorkTemplateReference)=>({reference,title:'Проверенное название',purpose:'Подготовка ТЗ',kind:'guidance' as const});

test('сохраняет порядок точных версий разных подключений и серверные названия',async()=>{
 const refs=[{accountId:7,reference:personal},{accountId:8,reference:scoped},{accountId:7,reference:{template_id:'criteria',revision:2}}];
 const calls:unknown[]=[];
 const result=await prepareChatWorkTemplates(refs,async(id,versions)=>{calls.push({id,versions});return versions.map(choice);});
 assert.deepEqual(result,refs.map(r=>({...choice(r.reference),accountId:r.accountId})));
 assert.deepEqual(calls,[{id:7,versions:[personal,refs[2].reference]},{id:8,versions:[scoped]}]);
});

test('неполный набор, перестановка и подмена ревизии не дают результата',async()=>{
 const refs=[{accountId:7,reference:personal},{accountId:7,reference:scoped}];
 for(const changed of [[choice(personal)],[choice(scoped),choice(personal)],[choice(personal),choice({...scoped,revision:6})]]){
  await assert.rejects(prepareChatWorkTemplates(refs,async()=>changed));
 }
});

test('отказ одного собственного подключения отвергает весь набор',async()=>{
 await assert.rejects(prepareChatWorkTemplates([{accountId:7,reference:personal},{accountId:8,reference:scoped}],async(id,refs)=>{if(id===8)throw Error('Нет доступа');return refs.map(choice);}),/Нет доступа/);
});

test('пустой, разреженный, повторный или поддельный выбор не вызывает чтение',async()=>{
 let calls=0;const item={accountId:7,reference:personal};
 for(const refs of [[],new Array(1),[item,item],[{...item,accountId:-1}],[{...item,title:'Название клиента'}],[{...item,reference:{...personal,revision:0}}],Array.from({length:17},(_,i)=>({accountId:7,reference:{template_id:String(i),revision:1}}))])await assert.rejects(prepareChatWorkTemplates(refs as ChatWorkTemplateReference[],async()=>{calls++;return [];}));
 assert.equal(calls,0);
 assert.equal(await prepareChatWorkTemplates(undefined,async()=>{calls++;return [];}),undefined);
});

test('изменение ссылок во время запроса не меняет закреплённую версию',async()=>{
 let finish!:(value:ReturnType<typeof choice>[])=>void;let begin!:()=>void;const started=new Promise<void>(r=>{begin=r;});
 const refs=[{accountId:7,reference:{...personal}}];
 const pending=prepareChatWorkTemplates(refs,async()=>{begin();return new Promise(r=>{finish=r;});});
 await started;refs[0].reference.revision=99;refs[0].accountId=8;
 finish([choice(personal)]);assert.deepEqual(await pending,[{...choice(personal),accountId:7}]);
});
