import type {DocumentTemplateOriginView} from '@gadgets/workshop-shared/work-template'
// @vitest-environment jsdom
import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {afterEach,expect,it} from 'vitest'
import {RpcStub,RpcTarget} from 'capnweb'
import DocumentTemplateOrigin from './DocumentTemplateOrigin'

;(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true
const head='a'.repeat(64),form={scope_id:'department',template_key:'spec',revision:5}
const origin:DocumentTemplateOriginView={project_id:'project',node_id:'document',head,initiated_by:'human',executed_by:'agent',operation_id:'operation',created_at_ms:1791000000000,form,inputs:[{reference:form,source_head:'b'.repeat(64)},{reference:{scope_id:'department',template_key:'method',revision:3},source_head:'c'.repeat(64)}],materials:[{reference:form,title:'Форма ТЗ',purpose:'Подготовить ТЗ',kind:'document' as const},{reference:{scope_id:'department',template_key:'method',revision:3},title:'Методика разработки',purpose:'Порядок работы',kind:'guidance' as const}]}
let cleanups:Array<()=>Promise<void>>=[]
afterEach(async()=>{for(const cleanup of cleanups)await cleanup();cleanups=[]})
async function mount(read:(project:string,node:string,version:string)=>Promise<typeof origin|null>,onPreview?:Parameters<typeof DocumentTemplateOrigin>[0]["onPreview"]){
 class Source extends RpcTarget {async templateOrigin(project:string,node:string,version:string){return read(project,node,version)}}
 const source=new RpcStub(new Source())
 const container=document.createElement('div');document.body.append(container);const root=createRoot(container)
 const render=async(node='document')=>{await act(async()=>root.render(<DocumentTemplateOrigin key={node} source={source} project="project" node={node} head={head} onPreview={onPreview}/>))}
 cleanups.push(async()=>{await act(async()=>root.unmount());source[Symbol.dispose]();container.remove()})
 await render();return {container,render}
}
it('показывает форму и методику с закреплёнными версиями выбранного снимка',async()=>{
 const calls:unknown[]=[];const {container}=await mount(async(...args)=>{calls.push(args);return origin})
 expect(container.textContent).toContain('Форма: «Форма ТЗ», версия 5');expect(container.textContent).toContain('Методика: «Методика разработки», версия 3')
 expect(calls).toEqual([['project','document',head]])
 expect(container.textContent).toContain('Создан агентом')
 const details=container.querySelector('details')!
 expect(details.open).toBe(false);expect(details.textContent).toContain('Инициаторhuman');expect(details.textContent).toContain('Агентagent');expect(details.textContent).toContain('Операцияoperation')
})
it('отказ доступа не выдаётся за отсутствие шаблонов',async()=>{
 const {container}=await mount(async()=>{throw Error('denied')})
 expect(container.querySelector('[role="alert"]')?.textContent).toContain('Происхождение недоступно')
 expect(container.textContent).not.toContain('без применения шаблонов')
})
it('null обозначает создание без шаблонов',async()=>{
 const {container}=await mount(async()=>null);expect(container.textContent).toContain('Документ создан без применения шаблонов.')
})
it('поздний ответ другого документа не заменяет показанное происхождение',async()=>{
 let answer!:(value:typeof origin)=>void
 const pending=new Promise<typeof origin>(resolve=>{answer=resolve})
 const {container,render}=await mount(async(_project,node)=>node==='document'?pending:null)
 await render('other');expect(container.textContent).toContain('без применения шаблонов')
 await act(async()=>{answer(origin);await pending})
 expect(container.textContent).not.toContain('Форма ТЗ');expect(container.textContent).toContain('без применения шаблонов')
})

it('из результата открывается точная применённая версия, а не последняя',async()=>{
 const seen:unknown[]=[];const {container}=await mount(async()=>origin,material=>seen.push(material));
 const buttons=Array.from(container.querySelectorAll('button'));expect(buttons).toHaveLength(2);
 await act(async()=>buttons[1].click());
 expect(seen).toEqual([origin.materials[1]]);expect((seen[0] as typeof origin.materials[number]).reference.revision).toBe(3);
});
