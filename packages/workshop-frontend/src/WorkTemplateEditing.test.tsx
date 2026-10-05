// @vitest-environment jsdom
import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {afterEach,beforeEach,expect,test,vi} from 'vitest'
const mocks=vi.hoisted(()=>({api:{},frame:vi.fn(),preview:vi.fn(),validate:vi.fn(),download:vi.fn(),connect:vi.fn(),revision:vi.fn(),restore:vi.fn(),dispose:vi.fn(),ready:vi.fn()}))
vi.mock('./AuthContext',()=>({useAuthenticatedApi:()=>({authenticatedApi:mocks.api})}))
vi.mock('./accountCapabilities',()=>({openBlueprintTemplatesFrame:(...args:unknown[])=>mocks.frame(...args)}))
vi.mock('./disposeGatekeeperFrame',()=>({disposeGatekeeperFrame:vi.fn()}))
vi.mock('./gatekeeperAppDownload',()=>({downloadGatekeeperNativeDocument:(...args:unknown[])=>mocks.download(...args)}))
import WorkTemplateEditing from './WorkTemplateEditing'
import {templateEditingContext} from './templateEditing'
const context={accountId:7,projectId:'project',reference:{template_id:'template',revision:3}}
const material={reference:context.reference,title:'Методика',purpose:'Проверять ТЗ',kind:'guidance' as const}
const snapshot={format:'cloudflareos.document',formatVersion:1,document:{title:'Методика',blocks:[{html:'<p>Требования</p>'}]}}
let host:HTMLDivElement,root:ReturnType<typeof createRoot>
beforeEach(()=>{
 vi.resetAllMocks();(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true
 mocks.frame.mockResolvedValue({blueprintTemplates:{storageOrigin:'https://objects.example',selector:{preview:mocks.preview,validatePreview:mocks.validate}}})
 mocks.preview.mockResolvedValue({material,sourceHead:'a'.repeat(64),ticket:{content_type:'application/vnd.cloudflareos.document+json',size_bytes:200}})
 mocks.download.mockResolvedValue(snapshot);mocks.validate.mockResolvedValue(undefined);mocks.revision.mockResolvedValue({revision:4});mocks.restore.mockResolvedValue({revision:5})
 mocks.connect.mockResolvedValue({getDocument:mocks.revision,restoreDocumentSnapshot:mocks.restore,[Symbol.dispose]:mocks.dispose})
 host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove()})
async function render(){await act(async()=>root.render(<WorkTemplateEditing context={context} gadget={{connectToGadget:mocks.connect} as never} snapshotSource={{current:async()=>snapshot as never}} onReady={mocks.ready}/>))}
async function open(){await act(async()=>host.querySelector('button')!.click())}
test('Открывает точную версию через проверенный объектный путь и CAS редактора',async()=>{
 await render();expect(mocks.restore).not.toHaveBeenCalled();await open()
 expect(mocks.frame).toHaveBeenCalledWith(mocks.api,7);expect(mocks.preview).toHaveBeenCalledWith(context.reference)
 expect(mocks.validate).toHaveBeenCalledWith(context.reference,'a'.repeat(64));expect(mocks.restore).toHaveBeenCalledWith(snapshot,4);expect(mocks.ready).toHaveBeenCalledWith(material);expect(mocks.dispose).toHaveBeenCalledTimes(1)
 expect(templateEditingContext({...context,reference:{scope_id:'team',template_key:'template',revision:3}})?.reference).toEqual({scope_id:'team',template_key:'template',revision:3})
})
test('Отказ доступа и подмена версии не меняют текст редактора',async()=>{
 await render();mocks.preview.mockRejectedValueOnce(Error('denied'));await open();expect(mocks.restore).not.toHaveBeenCalled();expect(mocks.ready).not.toHaveBeenCalled();expect(host.querySelector('[role="alert"]')).not.toBeNull()
 mocks.preview.mockResolvedValue({material:{...material,reference:{template_id:'other',revision:3}},ticket:{content_type:'application/vnd.cloudflareos.document+json',size_bytes:200}});await open();expect(mocks.restore).not.toHaveBeenCalled()
})
test('Правка во время чтения даёт явный отказ; повтор не считается открытием',async()=>{
 await render();mocks.restore.mockRejectedValue(Error('revision changed'));await open();expect(mocks.restore).toHaveBeenCalledWith(snapshot,4);expect(mocks.ready).not.toHaveBeenCalled();expect(host.querySelector('[role="alert"]')?.textContent).toContain('изменили текст')
})

test('Выход из редактора до ответа не восстанавливает документ и освобождает поздний RPC',async()=>{
 let complete!:(value:unknown)=>void;const pending=new Promise(resolve=>{complete=resolve})
 mocks.connect.mockReturnValue(pending);await render();await act(async()=>host.querySelector('button')!.click());await act(async()=>root.unmount())
 await act(async()=>complete({getDocument:mocks.revision,restoreDocumentSnapshot:mocks.restore,[Symbol.dispose]:mocks.dispose}))
 expect(mocks.restore).not.toHaveBeenCalled();expect(mocks.ready).not.toHaveBeenCalled();expect(mocks.dispose).toHaveBeenCalledTimes(1)
})

test('Смена редактора отменяет старое открытие и требует открыть версию заново',async()=>{
 let complete!:(value:unknown)=>void;mocks.connect.mockReturnValueOnce(new Promise(resolve=>{complete=resolve}))
 await render();await act(async()=>host.querySelector('button')!.click())
 await render();await act(async()=>complete({getDocument:mocks.revision,restoreDocumentSnapshot:mocks.restore,[Symbol.dispose]:mocks.dispose}))
 expect(mocks.restore).not.toHaveBeenCalled();expect(mocks.ready).not.toHaveBeenCalled();expect(mocks.dispose).toHaveBeenCalledTimes(1)
 await open();expect(mocks.restore).toHaveBeenCalledTimes(1);expect(mocks.ready).toHaveBeenCalledTimes(1)
 await render();expect(host.textContent).toContain('Открыть выбранную версию')
})

test('Зависшее скачивание освобождает редактор по сроку ожидания',async()=>{
 const timer=vi.spyOn(AbortSignal,'timeout');const deadline=new AbortController();timer.mockReturnValue(deadline.signal)
 try{
  mocks.download.mockReturnValue(new Promise(()=>{}));await render();await act(async()=>host.querySelector('button')!.click());
  await act(async()=>deadline.abort(Error('timeout')))
  expect(mocks.restore).not.toHaveBeenCalled();expect(mocks.ready).not.toHaveBeenCalled();expect(mocks.dispose).toHaveBeenCalledTimes(1)
  expect(host.querySelector('button')!.disabled).toBe(false);expect(host.querySelector('[role="alert"]')).not.toBeNull()
 }finally{timer.mockRestore()}
})
