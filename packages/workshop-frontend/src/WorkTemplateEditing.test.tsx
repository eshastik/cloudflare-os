// @vitest-environment jsdom
import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {afterEach,beforeEach,expect,test,vi} from 'vitest'
const mocks=vi.hoisted(()=>({api:{},frame:vi.fn(),preview:vi.fn(),validate:vi.fn(),download:vi.fn(),text:vi.fn(),connect:vi.fn(),revision:vi.fn(),restore:vi.fn(),dispose:vi.fn(),ready:vi.fn()}))
vi.mock('./AuthContext',()=>({useAuthenticatedApi:()=>({authenticatedApi:mocks.api})}))
vi.mock('./accountCapabilities',()=>({openBlueprintTemplatesFrame:(...args:unknown[])=>mocks.frame(...args)}))
vi.mock('./disposeGatekeeperFrame',()=>({disposeGatekeeperFrame:vi.fn()}))
vi.mock('./gatekeeperAppDownload',()=>({downloadGatekeeperNativeDocument:(...args:unknown[])=>mocks.download(...args),downloadGatekeeperWorkTemplateText:(...args:unknown[])=>mocks.text(...args)}))
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

 test('Продолжение после перезагрузки проверяет исходную версию и сохраняет текущую правку без восстановления',async()=>{
 await render();await act(async()=>Array.from(host.querySelectorAll('button')).find(button=>button.textContent==='Продолжить с текущим текстом')!.click());
 expect(mocks.preview).toHaveBeenCalledWith(context.reference);expect(mocks.validate).toHaveBeenCalledWith(context.reference,'a'.repeat(64));expect(mocks.download).not.toHaveBeenCalled();expect(mocks.restore).not.toHaveBeenCalled();expect(mocks.ready).toHaveBeenCalledWith(material);
})
 test('Продолжение с текущим текстом не обходит отзыв доступа',async()=>{
 mocks.validate.mockRejectedValue(Error('denied'));await render();await act(async()=>Array.from(host.querySelectorAll('button')).find(button=>button.textContent==='Продолжить с текущим текстом')!.click());
 expect(mocks.ready).not.toHaveBeenCalled();expect(mocks.restore).not.toHaveBeenCalled();expect(host.querySelector('[role="alert"]')).not.toBeNull();
})

 test('Новый пустой редактор автоматически открывает выбранную версию; изменённый черновик сохраняется',async()=>{
  const gadget={connectToGadget:mocks.connect} as never
  const source={current:async()=>({format:'cloudflareos.document',formatVersion:1,document:{revision:4,title:'Новый документ',blocks:[{html:'<p><br></p>'}]}}) as never}
  await act(async()=>root.render(<WorkTemplateEditing context={{...context,autoOpen:true}} gadget={gadget} snapshotSource={source} onReady={mocks.ready}/>))
  expect(mocks.restore).toHaveBeenCalledWith(snapshot,4);expect(mocks.ready).toHaveBeenCalledWith(material)
  mocks.restore.mockClear();mocks.ready.mockClear()
  const edited={current:async()=>({...snapshot,document:{...snapshot.document,revision:4}}) as never}
  await act(async()=>root.render(<WorkTemplateEditing context={{...context,autoOpen:true,reference:{...context.reference,revision:4}}} gadget={gadget} snapshotSource={edited} onReady={mocks.ready}/>))
  expect(mocks.restore).not.toHaveBeenCalled();expect(mocks.ready).not.toHaveBeenCalled();expect(host.textContent).toContain('В редакторе уже есть правки')
  expect(templateEditingContext({...context,autoOpen:true})).toEqual({...context,autoOpen:true})
  expect(templateEditingContext({...context,autoOpen:'true'})).toBeUndefined()
 })

 test.each(['text/plain','text/markdown'])('Открывает %s как буквальный текст, сохраняя разметку и проверяя доступ перед CAS',async mime=>{
 mocks.preview.mockResolvedValue({material,sourceHead:'a'.repeat(64),ticket:{content_type:mime,size_bytes:200}});mocks.text.mockResolvedValue('\n# Правила\n\n<img src="https://example.test"> & проверка\n');
 await render();await open();
 expect(mocks.download).not.toHaveBeenCalled();expect(mocks.text).toHaveBeenCalledOnce();expect(mocks.validate).toHaveBeenCalledWith(context.reference,'a'.repeat(64));
 const [restored,revision]=mocks.restore.mock.calls[0];expect(revision).toBe(4);expect(restored).toMatchObject({format:'cloudflareos.document',formatVersion:1,document:{title:'Методика'}});
 const wrapper=document.createElement('div');wrapper.innerHTML=restored.document.blocks[0].html;expect(wrapper.querySelector('img')).toBeNull();expect(wrapper.textContent).toBe('\n# Правила\n\n<img src="https://example.test"> & проверка\n');expect(mocks.ready).toHaveBeenCalledWith(material);
 });
 test('Отзыв доступа после чтения текста не восстанавливает его в редакторе',async()=>{
 mocks.preview.mockResolvedValue({material,sourceHead:'a'.repeat(64),ticket:{content_type:'text/plain',size_bytes:200}});mocks.text.mockResolvedValue('Частная инструкция');mocks.validate.mockRejectedValue(Error('revoked'));
 await render();await open();expect(mocks.restore).not.toHaveBeenCalled();expect(mocks.ready).not.toHaveBeenCalled();expect(host.querySelector('[role="alert"]')).not.toBeNull();
 });
