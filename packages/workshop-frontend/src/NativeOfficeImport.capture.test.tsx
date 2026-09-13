// @vitest-environment jsdom
import {act} from 'react'
import {createRoot} from 'react-dom/client'
import type {ComponentProps} from 'react'
import {expect,it,vi} from 'vitest'
import NativeOfficeImport from './NativeOfficeImport'
vi.mock('./components/WorkshopControls',()=>({WorkshopButton:(props:ComponentProps<'button'>)=><button {...props}/>}))
vi.mock('./gatekeeperAppDownload',()=>({downloadGatekeeperOfficePreview:async(_origin:unknown,_ticket:unknown,format:string)=>JSON.stringify(format==='cloudflareos.presentation'?{format,formatVersion:1,document:{slides:[{blocks:[{props:{text:'Slide title'}}]}]}}:{format:'cloudflareos.document',formatVersion:1,document:{blocks:[{html:'<p>Source text</p><ol start="7"><li>First<ul><li>Nested</li></ul></li><li>Second</li></ol>'}]}})}))
const transfers=vi.hoisted(()=>({upload:vi.fn(async()=> 'upload')}))
vi.mock('./gatekeeperAppUpload',()=>({uploadGatekeeperOfficePreview:transfers.upload}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true
it('previews PPTX text and creates a presentation copy with its own extension',async()=>{
 const head='a'.repeat(64),key='pptx-import';sessionStorage.removeItem(key)
 const saved=vi.fn(async()=>{})
 const writer={recoveryState:async()=>({head}),checkpoint:async()=> 'pptx-receipt',save:saved,[Symbol.dispose]:vi.fn()}
 const selector={previewOffice:vi.fn(async()=>({previewId:'pptx-preview',head,unsupported:[],download:{issue:async()=>({}),validate:async()=>{}},[Symbol.dispose]:vi.fn()})),createOffice:vi.fn(async()=>writer),resumeCreation:vi.fn()}
 const container=document.createElement('div');document.body.append(container);const root=createRoot(container)
 const click=async(label:string)=>{const b=[...container.querySelectorAll('button')].find(b=>b.textContent===label);expect(b).toBeDefined();await act(async()=>b!.click())}
 try {
  await act(async()=>root.render(<NativeOfficeImport selector={selector as unknown as ComponentProps<typeof NativeOfficeImport>['selector']} storageOrigin="https://storage.example" scope="project" resource="source" name="Deck.pptx" format="cloudflareos.presentation" receiptKey={key} onBusy={()=>{}} onCreated={async()=>{}}/>))
  await click('Подготовить импорт PPTX');expect(container.textContent).toContain('Слайд 1');expect(container.textContent).toContain('Slide title')
  await click('Создать нативную копию')
  expect(selector.createOffice).toHaveBeenCalledWith('project','Deck.cfslides','cloudflareos.presentation',head,'pptx-preview',false)
  expect(saved).toHaveBeenCalledOnce()
 } finally {await act(async()=>root.unmount());container.remove();sessionStorage.removeItem(key)}
})
it('uses the captured head/hash and requires explicit acceptance before creating a lossy copy',async()=>{
 const saved=vi.fn(),done=vi.fn(async()=>{}),source={head:'a'.repeat(64),sha256:'b'.repeat(64)}
 const writer={recoveryState:async()=>({head:source.head}),checkpoint:async()=> 'receipt',save:saved,[Symbol.dispose]:vi.fn()}
 const selector={previewOffice:vi.fn(async()=>({previewId:'preview',head:source.head,unsupported:['numbering'],download:{issue:async()=>({}),validate:async()=>{}},[Symbol.dispose]:vi.fn()})),createOffice:vi.fn(async()=>writer)}
 const container=document.createElement('div');document.body.append(container);const root=createRoot(container)
 const button=(label:string)=>[...container.querySelectorAll('button')].find(b=>b.textContent===label)!
 try{
  await act(async()=>root.render(<NativeOfficeImport selector={selector as unknown as ComponentProps<typeof NativeOfficeImport>['selector']} storageOrigin="https://storage.example" scope="project" resource="source" name="Copy" format="cloudflareos.document" receiptKey="capture-test" source={source} onBusy={()=>{}} onCreated={done}/>))
  await act(async()=>button('Подготовить импорт DOCX').click())
  expect(selector.previewOffice).toHaveBeenCalledWith('project','source','cloudflareos.document',source)
  const frame=container.querySelector('iframe')!;expect(frame.getAttribute('sandbox')).toBe('');expect(frame.srcdoc).toContain('Source text');expect(frame.srcdoc).toContain('<ol start="7">');expect(frame.srcdoc).toContain('<ul><li>Nested</li></ul>');expect(container.textContent).toContain('numbering')
  expect(button('Создать нативную копию').disabled).toBe(true);expect(selector.createOffice).not.toHaveBeenCalled()
  await act(async()=>(container.querySelector('input[type="checkbox"]') as HTMLInputElement).click())
  await act(async()=>button('Создать нативную копию').click())
  expect(selector.createOffice).toHaveBeenCalledWith('project','Copy.cfdoc','cloudflareos.document',source.head,'preview',true);expect(saved).toHaveBeenCalledOnce();expect(done).toHaveBeenCalledOnce()
 }finally{await act(async()=>root.unmount());container.remove();sessionStorage.removeItem('capture-test')}
})

it('retains the same creation receipt across lost response, success and another reload',async()=>{
 const key='fixed-drive-request';sessionStorage.removeItem(key);transfers.upload.mockClear()
 const source={head:'a'.repeat(64),sha256:'b'.repeat(64)}
 let committed=false
 const save=vi.fn(async()=>{if(!committed){committed=true;throw Error('lost reply')}})
 const writer={recoveryState:async()=>({head:source.head}),checkpoint:async()=> 'sealed-intent',save,[Symbol.dispose]:vi.fn()}
 const resumed={...writer,recoveryState:async()=>({head:source.head,uploadId:'upload'})}
 const selector={previewOffice:vi.fn(async()=>({previewId:'preview',head:source.head,unsupported:[],download:{issue:async()=>({}),validate:async()=>{}},[Symbol.dispose]:vi.fn()})),createOffice:vi.fn(async()=>writer),resumeCreation:vi.fn(async()=>resumed)}
 const container=document.createElement('div');document.body.append(container);let root=createRoot(container)
 const render=async()=>{await act(async()=>root.render(<NativeOfficeImport selector={selector as unknown as ComponentProps<typeof NativeOfficeImport>['selector']} storageOrigin="https://storage.example" scope="project" resource="source" name="Copy" format="cloudflareos.document" receiptKey={key} source={source} retainReceipt onBusy={()=>{}} onCreated={async()=>{}}/>))}
 const click=async(label:string)=>{const b=[...container.querySelectorAll('button')].find(b=>b.textContent===label);expect(b).toBeDefined();await act(async()=>b!.click())}
 const reload=async()=>{await act(async()=>root.unmount());root=createRoot(container);await render()}
 try{
  await render();await click('Подготовить импорт DOCX');await click('Создать нативную копию')
  expect(committed).toBe(true);expect(sessionStorage.getItem(key)).toBe('sealed-intent')
  await reload();await click('Повторить создание копии');expect(container.textContent).toContain('Создана копия')
  expect(sessionStorage.getItem(key)).toBe('sealed-intent')
  await reload();await click('Повторить создание копии')
  expect(selector.createOffice).toHaveBeenCalledTimes(1);expect(selector.previewOffice).toHaveBeenCalledTimes(1);expect(transfers.upload).toHaveBeenCalledTimes(1)
  expect(selector.resumeCreation.mock.calls).toEqual([['sealed-intent','cloudflareos.document'],['sealed-intent','cloudflareos.document']])
  expect(save.mock.calls).toEqual([[source.head,'upload'],[source.head,'upload'],[source.head,'upload']])
 }finally{await act(async()=>root.unmount());container.remove();sessionStorage.removeItem(key)}
})
it('offers reimport of a stored PPTX using the server-captured source without creating another copy',async()=>{
 const source={head:'b'.repeat(64),sha256:'c'.repeat(64)},head='a'.repeat(64),key='stored-pptx-update'
 const download={issue:async()=>({}),validate:async()=>{},[Symbol.dispose]:vi.fn()}
 const selector={previewOffice:vi.fn(async()=>({previewId:'preview',head,source,unsupported:[],download,[Symbol.dispose]:vi.fn()})),createOffice:vi.fn(),resumeCreation:vi.fn()}
 const review={describe:async()=>({outcome:'source_unchanged',unsupported:[]}),preview:async()=>download,[Symbol.dispose]:vi.fn()}
 const updates={documents:async()=>({documents:[{id:'copy',name:'Deck.cfslides'}],nextCursor:'',truncated:false}),reviewOfficeUpdate:vi.fn(async()=>review),resumeOfficeUpdate:vi.fn()}
 const container=document.createElement('div');document.body.append(container);const root=createRoot(container)
 const click=async(label:string)=>{const b=[...container.querySelectorAll('button')].find(b=>b.textContent===label);expect(b).toBeDefined();await act(async()=>b!.click())}
 try {
  await act(async()=>root.render(<NativeOfficeImport selector={selector as unknown as ComponentProps<typeof NativeOfficeImport>['selector']} updateSelector={updates as unknown as ComponentProps<typeof NativeOfficeImport>['updateSelector']} storageOrigin="https://storage.example" scope="project" resource="source" name="Deck.pptx" format="cloudflareos.presentation" receiptKey={key} onBusy={()=>{}} onCreated={async()=>{}}/>))
  await click('Подготовить импорт PPTX');await click('Обновить существующую копию');await click('Выбрать копию')
  await act(async()=>{const s=container.querySelector('select')!;s.value='copy';s.dispatchEvent(new Event('change',{bubbles:true}))})
  await click('Сравнить обновление')
  expect(updates.reviewOfficeUpdate).toHaveBeenCalledWith('project','copy','source','cloudflareos.presentation',source.head,source.sha256)
  expect(container.textContent).toContain('Источник не изменился');expect(container.textContent).toContain('Slide title');expect(selector.createOffice).not.toHaveBeenCalled()
 }finally{await act(async()=>root.unmount());container.remove();sessionStorage.removeItem(key+':update')}
})
