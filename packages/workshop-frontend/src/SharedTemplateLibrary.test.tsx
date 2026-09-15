// @vitest-environment jsdom
import React from 'react'
import {createRoot} from 'react-dom/client'
import {beforeEach,afterEach,test,expect,vi} from 'vitest'
import SharedTemplateLibrary from './SharedTemplateLibrary'
const mocks=vi.hoisted(()=>({promote:vi.fn<(...args:unknown[])=>Promise<unknown>>(),apply:vi.fn<(...args:unknown[])=>Promise<unknown>>(),create:vi.fn<(...args:unknown[])=>Promise<unknown>>(),navigate:vi.fn<(...args:unknown[])=>void>(),download:vi.fn<(...args:unknown[])=>Promise<Uint8Array>>()}))
vi.mock('@tanstack/react-router',()=>({useNavigate:()=>mocks.navigate}))
vi.mock('./AuthContext',()=>({useAuthenticatedApi:()=>({authenticatedApi:api})}))
const api={newGadgetFromTemplateSnapshot:mocks.create}
vi.mock('./accountCapabilities',()=>({listAccounts:async()=>[{id:1,vendorId:'memory',description:{displayName:'Компания'}}],storesDocuments:()=>true,openBlueprintTemplatesFrame:async()=>({blueprintTemplates:{storageOrigin:'https://objects.example',selector:{
 scopes:async()=>({scopes:[{scope_id:'finance',revision:1,level:'group',parent_id:'department',name:'Финансы',enabled:true},{scope_id:'department',revision:2,level:'department',parent_id:'org',name:'Финансовый отдел',enabled:true}]}),
 projects:async()=>({projects:[{id:'project',name:'Клиент'}]}),
 templates:async()=>({templates:[{scope_id:'finance',template_key:'contract',revision:3,source:{title:'Договор',purpose:'Договор клиента',content_type:'application/vnd.mnemos.blueprint-template+json'}}]}),
 promote:(...args:unknown[])=>mocks.promote(...args),apply:(...args:unknown[])=>mocks.apply(...args),validateApplication:async()=>{}
 }}})}))
vi.mock('./disposeGatekeeperFrame',()=>({disposeGatekeeperFrame:()=>{}}))
vi.mock('./gatekeeperAppDownload',()=>({downloadGatekeeperFile:(...args:unknown[])=>mocks.download(...args)}))
vi.mock('@gadgets/workshop-shared/blueprint-template',()=>({BLUEPRINT_TEMPLATE_MIME:'application/vnd.mnemos.blueprint-template+json',decodeBlueprintTemplate:async()=>({})}))
let host:HTMLDivElement,root:ReturnType<typeof createRoot>
beforeEach(()=>{vi.clearAllMocks();sessionStorage.clear();(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');document.body.append(host);root=createRoot(host)
 mocks.apply.mockResolvedValue({ticket:{url:'https://objects.example/copy'},node:'copy',head:'head'});mocks.download.mockResolvedValue(new Uint8Array([1,2]));mocks.create.mockResolvedValue({getMetadata:async()=>({id:'workspace'}),[Symbol.dispose]:()=>{}})
})
afterEach(async()=>{await React.act(async()=>root.unmount());host.remove()})
async function choose(){await React.act(async()=>root.render(<SharedTemplateLibrary/>));const row=[...host.querySelectorAll('button')].find(item=>item.textContent?.includes('Договор'))!;await React.act(async()=>row.click())}
const start=()=>[...host.querySelectorAll('button')].find(item=>item.textContent==='Начать работу')!
test('показывает уровень и создаёт рабочий гаджет из выбранной утверждённой версии',async()=>{
 await choose();expect(host.textContent).toContain('Группа · Финансы');expect(host.textContent).toContain('Утверждённая версия 3')
 await React.act(async()=>start().click())
 expect(mocks.apply).toHaveBeenCalledWith('finance','contract',3,'project','Договор.mnemos-template',expect.any(String))
 expect(mocks.create).toHaveBeenCalledOnce();expect(mocks.navigate).toHaveBeenCalledWith({to:'/workspace/$id',params:{id:'workspace'}})
})
test('повтор использует ту же операцию, а отказ копирования не создаёт пустое окно',async()=>{
 mocks.apply.mockRejectedValueOnce(new Error('connection'))
 await choose();await React.act(async()=>start().click());expect(mocks.create).not.toHaveBeenCalled()
 const first=mocks.apply.mock.calls[0][5];await React.act(async()=>start().click());expect(mocks.apply.mock.calls[1][5]).toBe(first);expect(mocks.create).toHaveBeenCalledOnce()
})

test('общее применение требует отдельного предложения родительскому уровню',async()=>{
 mocks.promote.mockResolvedValue({proposal:{proposal_id:'proposal',target_scope_id:'department'}})
 await choose();expect(host.textContent).toContain('Следующий уровень: Отдел · Финансовый отдел')
 const field=host.querySelector('textarea')!
 await React.act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(field,'Подходит всем');field.dispatchEvent(new Event('input',{bubbles:true}))})
 const submit=[...host.querySelectorAll('button')].find(item=>item.textContent==='Отправить на согласование')!
 await React.act(async()=>submit.click())
 expect(mocks.promote).toHaveBeenCalledWith('finance','contract',3,'Подходит всем',expect.any(String))
 expect(mocks.create).not.toHaveBeenCalled();expect(host.textContent).toContain('после согласования')
})

test('добавляет шаблон в текущую беседу без отдельного рабочего пространства',async()=>{
 const apply=vi.fn<(bytes:Uint8Array,operationId:string,signal:AbortSignal)=>Promise<void>>().mockRejectedValueOnce(new Error('lost')).mockResolvedValue(undefined)
 await React.act(async()=>root.render(<SharedTemplateLibrary conversation={{key:'workspace:7',apply}}/>))
 const row=[...host.querySelectorAll('button')].find(item=>item.textContent?.includes('Договор'))!
 await React.act(async()=>row.click())
 const add=()=>[...host.querySelectorAll('button')].find(item=>item.textContent==='Добавить в беседу')!
 await React.act(async()=>add().click());const operation=apply.mock.calls[0][1]
 await React.act(async()=>add().click())
 expect(apply).toHaveBeenCalledTimes(2);expect(apply.mock.calls[1][1]).toBe(operation)
 expect(apply.mock.calls[1][0]).toEqual(new Uint8Array([1,2]))
 expect(mocks.create).not.toHaveBeenCalled();expect(mocks.navigate).not.toHaveBeenCalled()
})
