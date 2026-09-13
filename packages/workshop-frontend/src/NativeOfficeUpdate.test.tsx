// @vitest-environment jsdom
import {act,type ComponentProps} from 'react'
import {createRoot} from 'react-dom/client'
import {it,expect,vi} from 'vitest'
import NativeOfficeUpdate from './NativeOfficeUpdate'
vi.mock('./components/WorkshopControls',()=>({WorkshopButton:(props:ComponentProps<'button'>)=><button {...props}/>}))
vi.mock('./gatekeeperAppDownload',()=>({downloadGatekeeperOfficePreview:async(_origin:unknown,_ticket:unknown,format:string)=>JSON.stringify({format,formatVersion:1,document:format==='cloudflareos.presentation'?{slides:[{blocks:[{props:{text:'Incoming source'}}]}]}:{blocks:[{html:'<p>Incoming source</p>'}]}})}))
const transfer=vi.hoisted(()=>({upload:vi.fn(async()=> 'upload')}))
vi.mock('./gatekeeperAppUpload',()=>({uploadGatekeeperOfficePreview:transfer.upload}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true
it.each(['cloudflareos.document','cloudflareos.presentation'] as const)('%s requires both conflict and loss acceptance, then restores the same update after lost reply and reload',async(format)=>{
 const key='office-update-ui-test';sessionStorage.removeItem(key);transfer.upload.mockClear()
 const head='a'.repeat(64),source={node:'source',head:'b'.repeat(64),sha256:'c'.repeat(64)}
 let committed=false
 const save=vi.fn(async()=>{if(!committed){committed=true;throw Error('reply lost')}})
 const writer={recoveryState:async()=>({head,uploadId:''}),issue:vi.fn(),checkpoint:async()=> 'sealed-update',save,[Symbol.dispose]:vi.fn()}
 const restored={...writer,recoveryState:async()=>({head,uploadId:'upload'})}
 const review={describe:async()=>({head,outcome:'conflict',currentSHA256:'d'.repeat(64),sourceSHA256:source.sha256,outputSHA256:'e'.repeat(64),unsupported:['styles']}),preview:async()=>({issue:async()=>({}),validate:async()=>{},[Symbol.dispose]:vi.fn()}),prepare:vi.fn(async()=>writer),[Symbol.dispose]:vi.fn()}
 const selector={documents:vi.fn(async()=>({documents:[{id:'target',name:'Copy.cfdoc'}],nextCursor:'',truncated:false})),reviewOfficeUpdate:vi.fn(async()=>review),resumeOfficeUpdate:vi.fn(async()=>restored)}
 const container=document.createElement('div');document.body.append(container);let root=createRoot(container)
 const render=async()=>{await act(async()=>root.render(<NativeOfficeUpdate selector={selector as unknown as ComponentProps<typeof NativeOfficeUpdate>['selector']} storageOrigin="https://storage.example" scope="project" source={source} format={format} receiptKey={key} onBusy={()=>{}}/>))}
 const button=(label:string)=>{const b=[...container.querySelectorAll('button')].find(b=>b.textContent===label);expect(b).toBeDefined();return b!}
 const click=async(label:string)=>{await act(async()=>button(label).click())}
 const reload=async()=>{await act(async()=>root.unmount());root=createRoot(container);await render()}
 try{
  await render();await click('Выбрать копию')
  await act(async()=>{const select=container.querySelector('select')!;select.value='target';select.dispatchEvent(new Event('change',{bubbles:true}))})
  await click('Сравнить обновление');expect(container.textContent).toContain('Incoming source')
  expect(selector.reviewOfficeUpdate).toHaveBeenCalledWith('project','target','source',format,source.head,source.sha256)
  expect(button('Применить обновление').disabled).toBe(true)
  const boxes=container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
  await act(async()=>boxes[0].click());expect(button('Применить обновление').disabled).toBe(true);expect(review.prepare).not.toHaveBeenCalled()
  await act(async()=>boxes[1].click());await click('Применить обновление')
  expect(committed).toBe(true);expect(review.prepare).toHaveBeenCalledWith(true,true)
  expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual({target:'target',receipt:'sealed-update'})
  await reload();await click('Повторить обновление');expect(container.textContent).toContain('Обновление подтверждено')
  await reload();await click('Повторить обновление')
  expect(transfer.upload).toHaveBeenCalledOnce();expect(review.prepare).toHaveBeenCalledOnce();expect(selector.reviewOfficeUpdate).toHaveBeenCalledOnce();expect(selector.documents).toHaveBeenCalledOnce()
  expect(selector.resumeOfficeUpdate.mock.calls).toEqual([['sealed-update',format],['sealed-update',format]])
  expect(save.mock.calls).toEqual([[head,'upload'],[head,'upload'],[head,'upload']]);expect(sessionStorage.getItem(key)).not.toBeNull()
 }finally{await act(async()=>root.unmount());container.remove();sessionStorage.removeItem(key)}
})
