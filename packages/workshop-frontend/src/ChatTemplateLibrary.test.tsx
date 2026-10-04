// @vitest-environment jsdom
import React from 'react'
import {createRoot} from 'react-dom/client'
import {test,expect,vi} from 'vitest'
import ChatTemplateLibrary from './ChatTemplateLibrary'
const api=vi.hoisted(()=>({listChatTemplateAccounts:vi.fn(),listChatProjects:vi.fn(),listChatTemplateScopes:vi.fn(),listChatTemplates:vi.fn()}))
vi.mock('./AuthContext',()=>({useAuthenticatedApi:()=>({authenticatedApi:api})}))
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

 test('Вход из беседы показывает четыре вида и сохраняет выбор при возврате от приложений',async()=>{
 const entries=[['document','Форма'],['guidance','Методика'],['agent_instructions','Инструкция'],['skill','Навык']].map(([kind,title],index)=>({kind,title,purpose:'Для задачи',reference:{template_id:kind,revision:index+2}}));
 api.listChatTemplateAccounts.mockResolvedValue([{accountId:3,title:'Mnemos'}]);api.listChatProjects.mockResolvedValue([{accountId:3,projectId:'project-a',title:'Проект беседы'}]);api.listChatTemplateScopes.mockResolvedValue({scopes:[],nextCursor:''});api.listChatTemplates.mockResolvedValue({templates:entries,nextCursor:''});
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);const selected=vi.fn<(templates:unknown[])=>void>(),closed=vi.fn<()=>void>(),apply=vi.fn<()=>Promise<void>>(async()=>{});
 const overseer={listChats:async()=>[{id:7,projectContext:{accountId:3,projectId:'project-a',creatorProfileId:'owner'}}]} as never;
 try{
 await React.act(async()=>root.render(<ChatTemplateLibrary overseer={overseer} chatId={7} viewerId="owner" conversation={{key:'chat7',apply}} onSelect={selected} onClose={closed}/>));
 expect(api.listChatTemplates).toHaveBeenCalledWith(3,null,'','project-a');
 for(const item of entries)await React.act(async()=>[...document.querySelectorAll<HTMLButtonElement>('[aria-label="Рабочие шаблоны Mnemos"] button[aria-pressed]')].find(button=>button.textContent?.startsWith(item.title))!.click());
 expect(selected).not.toHaveBeenCalled();expect(apply).not.toHaveBeenCalled();
 await React.act(async()=>[...document.querySelectorAll('button')].find(button=>button.textContent==='Шаблоны приложений')!.click());expect(document.body.textContent).toContain('project-a');
 await React.act(async()=>[...document.querySelectorAll('button')].find(button=>button.textContent==='Назад к рабочим шаблонам')!.click());expect(document.querySelector('[aria-label="Рабочие шаблоны Mnemos"]')?.querySelectorAll('[aria-pressed="true"]')).toHaveLength(4);
 await React.act(async()=>[...document.querySelectorAll('button')].find(button=>button.textContent==='Использовать выбранные (4)')!.click());
 expect(selected).toHaveBeenCalledWith(entries.map(item=>({...item,accountId:3})));expect(apply).not.toHaveBeenCalled();
 await React.act(async()=>document.querySelector<HTMLButtonElement>('[aria-label="Закрыть выбор шаблона"]')!.click());expect(closed).toHaveBeenCalledOnce();
 }finally{await React.act(async()=>root.unmount());host.remove()}
 })

 test('Ошибка чтения проекта предлагает повтор и закрытие вместо скрытого выбора',async()=>{
 const listChats=vi.fn<()=>Promise<unknown[]>>().mockRejectedValueOnce(new Error('offline')).mockResolvedValue([{id:7}]);const closed=vi.fn<()=>void>();const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try{await React.act(async()=>root.render(<ChatTemplateLibrary overseer={{listChats} as never} chatId={7} viewerId="owner" conversation={{key:'chat7',apply:async()=>{}}} onSelect={()=>{}} onClose={closed}/>));expect(document.querySelector('[role="alert"]')?.textContent).toContain('Не удалось прочитать проект');await React.act(async()=>[...document.querySelectorAll('button')].find(button=>button.textContent==='Закрыть')!.click());expect(closed).toHaveBeenCalledOnce();
 await React.act(async()=>[...document.querySelectorAll('button')].find(button=>button.textContent==='Повторить')!.click());expect(listChats).toHaveBeenCalledTimes(2);expect(document.body.textContent).toContain('Шаблоны для задачи');
 }finally{await React.act(async()=>root.unmount());host.remove()}
 })
