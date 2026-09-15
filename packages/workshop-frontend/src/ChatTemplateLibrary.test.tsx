// @vitest-environment jsdom
import React from 'react'
import {createRoot} from 'react-dom/client'
import {test,expect,vi} from 'vitest'
import ChatTemplateLibrary from './ChatTemplateLibrary'
vi.mock('./SharedTemplateLibrary',()=>({default:({preferredProject}:{preferredProject?:{projectId:string}})=><p>{preferredProject?.projectId??'Выберите проект'}</p>}))
test('не подставляет номер подключения другого участника',async()=>{
 (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
 const overseer={listChats:async()=>[{id:7,projectContext:{accountId:3,projectId:'project-a',creatorProfileId:'owner'}}]} as never
 const conversation={key:'workspace:7',apply:async()=>{}}
 try{
  await React.act(async()=>root.render(<ChatTemplateLibrary overseer={overseer} chatId={7} viewerId="peer" conversation={conversation}/>))
  expect(host.textContent).toBe('Выберите проект')
  await React.act(async()=>root.render(<ChatTemplateLibrary overseer={overseer} chatId={7} viewerId="owner" conversation={conversation}/>))
  expect(host.textContent).toBe('project-a')
 }finally{await React.act(async()=>root.unmount());host.remove()}
})
