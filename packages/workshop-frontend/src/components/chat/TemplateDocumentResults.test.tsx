// @vitest-environment jsdom
import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {expect,it,vi} from 'vitest'
import TemplateDocumentResults,{createdTemplateDocuments} from './TemplateDocumentResults'
import type {WorkBatch} from './toolDisplay'
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true

it('карточка подтверждённого результата видна без раскрытия шагов и открывает точный узел без повторного вызова',async()=>{
 const created={chatId:0,sequence:2,resourceTitle:'Mnemos',title:'Документ создан',description:'Учебное ТЗ',activity:{kind:'mnemos.template.created',scopeId:'project',items:[{name:'Учебное ТЗ',projectId:'project',documentId:'result'}]}}
 const batches:WorkBatch[]=[{calls:[],observations:[{...created,sequence:1,activity:{...created.activity,kind:'mnemos.template.create'}},created,{...created,sequence:3}]}]
 expect(createdTemplateDocuments(batches)).toHaveLength(1)
 expect(createdTemplateDocuments([{calls:[],observations:[{...created,activity:{...created.activity,kind:'mnemos.search'}}]}])).toHaveLength(0)
 let finish!:()=>void
 const opened=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve})),openDocument=vi.fn(()=>opened)
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
 try{
  await act(async()=>root.render(<TemplateDocumentResults batches={batches} openDocument={openDocument}/>))
  expect(host.textContent).toContain('Создан по шаблону · личная версия')
  const button=host.querySelector('button')!
  await act(async()=>button.click())
  expect(openDocument).toHaveBeenCalledWith({project:'project',document:'result',resourceTitle:'Mnemos',title:'Учебное ТЗ',refreshLatest:true})
  expect(button.textContent).toBe('Открываю…');expect(button.disabled).toBe(true)
  await act(async()=>button.click());expect(opened).toHaveBeenCalledTimes(1)
  await act(async()=>finish());expect(button.disabled).toBe(false)
  opened.mockImplementationOnce(async()=>{throw Error('denied')})
  await act(async()=>button.click());expect(host.querySelector('[role=alert]')?.textContent).toContain('не открылся')
  await act(async()=>root.render(<TemplateDocumentResults batches={batches}/>));expect(host.querySelector('button')?.disabled).toBe(true)
 }finally{await act(async()=>root.unmount());host.remove()}
})
