// @vitest-environment jsdom
import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {expect,it,vi} from 'vitest'
import DriveOfficeImport from './DriveOfficeImport'
const state=vi.hoisted(()=>({api:{getGatekeeperApp:vi.fn()},render:vi.fn(),update:vi.fn()}))
vi.mock('./AuthContext',()=>({useAuthenticatedApi:()=>({authenticatedApi:state.api})}))
vi.mock('./NativeOfficeUpdate',()=>({default:(props:unknown)=>{state.update(props);return <div>Update review</div>}}))
vi.mock('./NativeOfficeImport',()=>({default:(props:unknown)=>{state.render(props);return <div>Import review</div>}}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true
it('opens the selected Mnemos account and passes the captured version to existing import review',async()=>{
 const dispose=vi.fn(),selector={[Symbol.dispose]:dispose}
 state.api.getGatekeeperApp.mockResolvedValue({nativeWrites:{selector,storageOrigin:'https://storage.example'}})
 const source={provider:'google-drive' as const,fileId:'file',sourceVersion:'1',sourceName:'я'.repeat(200),sourceMimeType:'application/vnd.google-apps.document',contentType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',exported:true,sha256:'b'.repeat(64),sizeBytes:3}
 const container=document.createElement('div');const root=createRoot(container)
 try{
  await act(async()=>root.render(<DriveOfficeImport owner="owner" attempt={{source:7,target:8,file:'file',project:'project',request:'request'}} receipt={{node_id:'copy',head:'a'.repeat(64),source}} onBusy={()=>{}}/>))
  expect(state.api.getGatekeeperApp).toHaveBeenCalledWith('mnemos',8)
  const props=state.render.mock.calls.at(-1)![0]
  expect(props.source).toEqual({head:'a'.repeat(64),sha256:source.sha256});expect(props.resource).toBe('copy');expect(props.scope).toBe('project');expect(props.selector).toBe(selector)
  expect(new TextEncoder().encode(props.name).length).toBeLessThanOrEqual(230)
  await act(async()=>{const choice=container.querySelector('select[aria-label="Действие импорта"]') as HTMLSelectElement;choice.value='update';choice.dispatchEvent(new Event('change',{bubbles:true}))})
  const update=state.update.mock.calls.at(-1)![0]
  expect(update.selector).toBe(selector);expect(update.scope).toBe('project');expect(update.source).toEqual({node:'copy',head:'a'.repeat(64),sha256:source.sha256});expect(update.receiptKey).toContain(':update:request')

 }finally{await act(async()=>root.unmount())}
 expect(dispose).toHaveBeenCalledOnce()
})
