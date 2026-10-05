// @vitest-environment jsdom
import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {expect,test,vi} from 'vitest'
const mocks=vi.hoisted(()=>({navigate:vi.fn(),metadata:vi.fn(),dispose:vi.fn(),api:{listOutputFormats:vi.fn(),newGadgetFromBlueprint:vi.fn()}}))
vi.mock('./AuthContext',()=>({useAuthenticatedApi:()=>({authenticatedApi:mocks.api})}))
vi.mock('@tanstack/react-router',()=>({useNavigate:()=>mocks.navigate}))
import CreateWorkTemplate from './CreateWorkTemplate'
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true

test('Автор выбирает вид, открывает только нативный редактор; повтор перехода использует тот же черновик',async()=>{
 mocks.api.listOutputFormats.mockResolvedValue([{blueprintId:'sheet',output:{id:'spreadsheet'}},{blueprintId:'setup',output:{id:'document'},requiresSetup:true},{blueprintId:'native-doc',output:{id:'document'}}])
 mocks.api.newGadgetFromBlueprint.mockResolvedValue({getMetadata:mocks.metadata,[Symbol.dispose]:mocks.dispose});mocks.metadata.mockRejectedValueOnce(Error('потерян ответ')).mockResolvedValue({id:'draft'});mocks.navigate.mockResolvedValue(undefined)
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
 const button=(title:string)=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(item=>item.textContent===title)!
 try{
  await act(async()=>root.render(<CreateWorkTemplate/>));expect(mocks.api.newGadgetFromBlueprint).not.toHaveBeenCalled()
  await act(async()=>button('Создать шаблон').click());await act(async()=>document.querySelector<HTMLInputElement>('[value="guidance"]')!.click())
  await act(async()=>{button('Открыть редактор').click();button('Открыть редактор').click()});expect(mocks.api.newGadgetFromBlueprint).toHaveBeenCalledTimes(1);expect(mocks.api.newGadgetFromBlueprint).toHaveBeenCalledWith('native-doc',{});expect(mocks.navigate).not.toHaveBeenCalled();expect(document.querySelector('[role="alert"]')?.textContent).toContain('Повторите открытие')
  await act(async()=>button('Открыть редактор').click());expect(mocks.api.newGadgetFromBlueprint).toHaveBeenCalledTimes(1);expect(mocks.navigate).toHaveBeenCalledWith({to:'/workspace/$id',params:{id:'draft'},search:{templateKind:'guidance'}})
 }finally{await act(async()=>root.unmount());host.remove()}
 expect(mocks.dispose).toHaveBeenCalledTimes(1)
})

test('Выход из библиотеки отменяет переход и освобождает поздний редактор на обоих этапах',async()=>{
 for(const phase of ['creation','metadata']){
  vi.clearAllMocks();mocks.metadata.mockReset();mocks.api.newGadgetFromBlueprint.mockReset()
  let complete!:(value:unknown)=>void;const pending=new Promise(resolve=>{complete=resolve})
  const editor={getMetadata:mocks.metadata,[Symbol.dispose]:mocks.dispose}
  mocks.api.listOutputFormats.mockResolvedValue([{blueprintId:'native-doc',output:{id:'document'}}])
  mocks.api.newGadgetFromBlueprint.mockReturnValue(phase==='creation'?pending:Promise.resolve(editor));mocks.metadata.mockReturnValue(phase==='metadata'?pending:Promise.resolve({id:'draft'}))
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
  const button=(title:string)=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(item=>item.textContent===title)!
  await act(async()=>root.render(<CreateWorkTemplate/>));await act(async()=>button('Создать шаблон').click());await act(async()=>button('Открыть редактор').click())
  await act(async()=>root.unmount());host.remove();await act(async()=>complete(phase==='creation'?editor:{id:'draft'}))
  expect(mocks.navigate).not.toHaveBeenCalled();expect(mocks.dispose).toHaveBeenCalledTimes(1)
 }
})

test('Редактирование из просмотра не открывает вложенный диалог и передаёт точную версию',async()=>{
 vi.clearAllMocks();mocks.metadata.mockReset();mocks.api.newGadgetFromBlueprint.mockReset()
 mocks.api.listOutputFormats.mockResolvedValue([{blueprintId:'native-doc',output:{id:'document'}}]);mocks.api.newGadgetFromBlueprint.mockResolvedValue({getMetadata:mocks.metadata,[Symbol.dispose]:mocks.dispose});mocks.metadata.mockResolvedValue({id:'edit-draft'});mocks.navigate.mockResolvedValue(undefined)
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);const reference={template_id:'template',revision:3}
 const button=(title:string)=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(item=>item.textContent===title)!
 try{
  await act(async()=>root.render(<CreateWorkTemplate editing={{accountId:7,projectId:'project',reference,item:{reference,title:'Методика',purpose:'Проверка',kind:'guidance',accountId:7}}}/>))
  await act(async()=>button('Редактировать').click());expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(0);expect(host.querySelector('[aria-label="Открыть шаблон в редакторе"]')).not.toBeNull()
  await act(async()=>button('Открыть редактор').click());expect(mocks.navigate).toHaveBeenCalledWith({to:'/workspace/$id',params:{id:'edit-draft'},search:{templateKind:'guidance',templateEdit:{accountId:7,projectId:'project',reference,autoOpen:true}}})
 }finally{await act(async()=>root.unmount());host.remove()}
})
