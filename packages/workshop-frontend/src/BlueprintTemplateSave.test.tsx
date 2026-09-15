// @vitest-environment jsdom
import React from 'react'
import {createRoot} from 'react-dom/client'
import {beforeEach, afterEach, expect, test, vi} from 'vitest'
import BlueprintTemplateSave from './BlueprintTemplateSave'
const mocks=vi.hoisted(()=>({api:{captureBlueprintTemplate:vi.fn<(...args: unknown[]) => Promise<unknown>>()}, creator:{state:vi.fn<(...args: unknown[]) => Promise<unknown>>(),issue:vi.fn<(...args: unknown[]) => Promise<unknown>>(),checkpoint:vi.fn<(...args: unknown[]) => Promise<unknown>>(),save:vi.fn<(...args: unknown[]) => Promise<unknown>>(),propose:vi.fn<(...args: unknown[]) => Promise<unknown>>(),[Symbol.dispose]:vi.fn<(...args: unknown[]) => Promise<unknown>>()}, selector:{projects:vi.fn<(...args: unknown[]) => Promise<unknown>>(),scopes:vi.fn<(...args: unknown[]) => Promise<unknown>>(),prepare:vi.fn<(...args: unknown[]) => Promise<unknown>>(),resume:vi.fn<(...args: unknown[]) => Promise<unknown>>()}, upload:vi.fn<(...args: unknown[]) => Promise<unknown>>()}))
vi.mock('./AuthContext',()=>({useAuthenticatedApi:()=>({authenticatedApi:mocks.api})}))
vi.mock('./accountCapabilities',()=>({listAccounts:async()=>[{id:8,vendorId:'memory',description:{displayName:'Компания'}}],storesDocuments:()=>true,openBlueprintTemplatesFrame:async()=>({blueprintTemplates:{storageOrigin:'https://objects.example',selector:mocks.selector}})}))
vi.mock('./gatekeeperAppUpload',()=>({uploadGatekeeperBlueprintTemplate:(...args:unknown[])=>mocks.upload(...args)}))
vi.mock('./disposeGatekeeperFrame',()=>({disposeGatekeeperFrame:vi.fn<(...args: unknown[]) => Promise<unknown>>()}))
let root:ReturnType<typeof createRoot>, container:HTMLDivElement
beforeEach(()=>{
  vi.clearAllMocks();sessionStorage.clear();(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true
  mocks.selector.projects.mockResolvedValue({projects:[{id:'project',name:'Проект'}]})
  mocks.selector.scopes.mockResolvedValueOnce({scopes:[{scope_id:'company',revision:1,level:'organization',name:'Компания',enabled:true},{scope_id:'department',revision:2,level:'department',name:'Финансовый отдел',enabled:true}],next_cursor:'groups'}).mockResolvedValue({scopes:[{scope_id:'finance',revision:4,level:'group',name:'Финансовая группа',enabled:true}]})
  mocks.selector.prepare.mockResolvedValue({id:'capture',creator:mocks.creator})
  mocks.creator.state.mockResolvedValue({upload:'',version:null})
  mocks.creator.save.mockResolvedValue({template_id:'template',revision:1,title:'Отчёт',purpose:'Финансовый отчёт',project_id:'project'})
  mocks.creator.propose.mockResolvedValue({proposal_id:'proposal',target_scope_id:'finance'})
  mocks.api.captureBlueprintTemplate.mockImplementation(async()=>new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{}'));controller.close()}}))
  mocks.upload.mockResolvedValue('upload')
  container=document.createElement('div');document.body.append(container);root=createRoot(container)
})
afterEach(async()=>{await React.act(async()=>root.unmount());container.remove()})
const button=(text:string)=>[...container.querySelectorAll('button')].find(item=>item.textContent===text)!
test('Шаблон сохраняется личным, а уровень группы требует отдельного предложения',async()=>{
  await React.act(async()=>root.render(<BlueprintTemplateSave blueprint={{id:'bp',title:'Отчёт',description:'Финансовый отчёт'}} onClose={()=>{}}/>))
  await React.act(async()=>button('Сохранить личный шаблон').click())
  expect(mocks.selector.prepare).toHaveBeenCalledWith('project','Отчёт','Финансовый отчёт')
  expect(mocks.creator.checkpoint).toHaveBeenCalledWith('upload')
  expect(mocks.creator.save).toHaveBeenCalledOnce()
  expect(mocks.creator.propose).not.toHaveBeenCalled()
  const scope=container.querySelector('select')!
  expect([...scope.options].map(item=>item.value)).toEqual(['','finance'])
  expect(mocks.selector.scopes).toHaveBeenCalledWith('groups')
  await React.act(async()=>{scope.value='finance';scope.dispatchEvent(new Event('change',{bubbles:true}))})
  await React.act(async()=>button('Предложить для общего применения').click())
  expect(mocks.creator.propose).toHaveBeenCalledWith('finance',4)
  expect(container.textContent).toContain('Общий шаблон появится после одобрения')
})
test('Повтор после потери ответа сохраняет ту же операцию и не загружает снимок заново',async()=>{
  mocks.creator.save.mockRejectedValueOnce(new Error('connection'))
  await React.act(async()=>root.render(<BlueprintTemplateSave blueprint={{id:'bp',title:'Отчёт',description:'Финансовый отчёт'}} onClose={()=>{}}/>))
  await React.act(async()=>button('Сохранить личный шаблон').click())
  mocks.creator.state.mockResolvedValue({upload:'upload',version:null})
  await React.act(async()=>button('Сохранить личный шаблон').click())
  expect(mocks.selector.prepare).toHaveBeenCalledOnce()
  expect(mocks.upload).toHaveBeenCalledOnce()
  expect(mocks.creator.save).toHaveBeenCalledTimes(2)
})
