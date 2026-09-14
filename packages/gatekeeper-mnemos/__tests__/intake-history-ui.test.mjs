import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'https://ui.example'});
for(const key of ['window','document','HTMLElement','Node','MutationObserver'])globalThis[key]=dom.window[key];
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const channels=[]; const OriginalMessageChannel=globalThis.MessageChannel;
globalThis.MessageChannel=class extends OriginalMessageChannel {constructor(){super();channels.push(this);}};
const bundle=await build({stdin:{contents:'export {default as IntakeHistory} from "./app-react/IntakeHistory.tsx"; export {HostProvider} from "./app-react/host.ts"; export {createElement,act} from "react"; export {createRoot} from "react-dom/client";',resolveDir:process.cwd()},bundle:true,jsx:'automatic',platform:'node',format:'esm',write:false,define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'ui-controls',setup(b){b.onResolve({filter:/^@cloudflare\/kumo$/},()=>({path:'controls',namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'import {createElement} from "react"; export function Button({variant,size,...props}){return createElement("button",props)};export function Empty(){return null}',resolveDir:process.cwd()}));}}]});
const {IntakeHistory,HostProvider,createElement:h,act,createRoot}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const project={id:'p',slug:'project',name:'Рабочий проект'};
const head='a'.repeat(64);
const personal={id:'one',paths:['папка/Документ.txt'],placement:'project/финансы/Документ.txt',status:'approved',placement_state:'personal',personal_head:head,result_project_id:'p',result_node_id:'n',note:''};
async function render(alerts,host){const el=document.createElement('div');document.body.append(el);const root=createRoot(el);await act(async()=>root.render(h(HostProvider,{value:{host,ui:host.ui||{},legacy:document.createElement('div')}},h(IntakeHistory,{alerts,projects:[project]}))));return {el,async close(){await act(async()=>root.unmount());el.remove();}};}
async function click(el,text){const button=[...el.querySelectorAll('button')].find(b=>b.textContent===text);assert.ok(button,text);await act(async()=>button.click());}
test('история отличает решение от размещения и читает точную личную версию',async()=>{
 const calls=[];const host={downloadText:async(...args)=>{calls.push(args);return 'Личный текст';},downloadFile:async(...args)=>calls.push(args)};
 const view=await render([personal,{...personal,id:'pending',paths:['Ожидает.txt'],placement_state:undefined,personal_head:undefined,result_node_id:undefined}],host);
 assert.match(view.el.textContent,/Личная версия/);assert.match(view.el.textContent,/Решение принято/);assert.equal([...view.el.querySelectorAll('button')].some(b=>b.textContent==='Ожидает.txt'),false);
 await click(view.el,'папка/Документ.txt');assert.deepEqual(calls[0],['p','n','private:'+head,0]);assert.match(view.el.textContent,/Личный текст/);assert.match(view.el.textContent,/Публикация выполняется отдельно/);
 await click(view.el,'Скачать файл');assert.deepEqual(calls[1],['p','n','private:'+head,'Документ.txt']);await view.close();
});
test('поздний ответ закрытого документа не возвращает его текст на экран',async()=>{
 let resolve;const promise=new Promise(r=>{resolve=r;});const view=await render([personal],{downloadText:()=>promise});
 await click(view.el,'папка/Документ.txt');await click(view.el,'К истории');await act(async()=>resolve('Запоздалый текст'));
 assert.doesNotMatch(view.el.textContent,/Запоздалый текст/);assert.match(view.el.textContent,/Личная версия/);await view.close();
});
test('ошибка чтения не подменяется общим документом',async()=>{
 let shared=0;const view=await render([personal],{downloadText:async()=>{throw Error('403');},ui:{readProjectDocument:()=>{shared++;}}});
 await click(view.el,'папка/Документ.txt');assert.match(view.el.textContent,/Не удалось открыть материал/);assert.equal(shared,0);await view.close();
});
test('повтор предпросмотра блокируется до окончания скачивания',async()=>{
 let finish;let reads=0;const file=new Promise(resolve=>{finish=resolve;});
 const view=await render([personal],{downloadText:async()=>{reads++;throw Error('temporary');},downloadFile:()=>file});
 try{
  await click(view.el,'папка/Документ.txt');await click(view.el,'Скачать файл');
  const retry=[...view.el.querySelectorAll('button')].find(button=>button.textContent==='Повторить');
  assert.ok(retry);assert.equal(retry.disabled,true);
  await act(async()=>retry.click());assert.equal(reads,1);
  await act(async()=>finish());
  const download=[...view.el.querySelectorAll('button')].find(button=>button.textContent==='Скачать файл');
  assert.ok(download);assert.equal(download.disabled,false);assert.equal(retry.disabled,false);
 }finally{await view.close();}
 const binary=await render([{...personal,paths:['Документ.pdf']}],{});
 try{await click(binary.el,'Документ.pdf');assert.equal([...binary.el.querySelectorAll('button')].some(button=>button.textContent==='Повторить'),false);}
 finally{await binary.close();}
});
after(()=>{dom.window.close();for(const channel of channels){channel.port1.close();channel.port2.close();}globalThis.MessageChannel=OriginalMessageChannel;});
