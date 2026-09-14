// @vitest-environment jsdom
import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {expect,it,vi} from 'vitest'
import DriveImportPanel from './DriveImportPanel'
import {driveAttemptKey,readDriveAttempt} from './driveCaptureAttempt'
const state=vi.hoisted(()=>({owner:'owner',api:{subscribeConnectedAccounts:vi.fn(),captureDriveImport:vi.fn(),listDriveImportAccounts:vi.fn()}}))
const drive=[{urlPattern:'https://memory.example/drive',description:'',title:'',receives:'drive' as const}]
vi.mock('./AuthContext',()=>({useAuthenticatedApi:()=>({authenticatedApi:state.api,currentUser:{id:state.owner,type:'user'}})}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true

it.each(['google','yandex','memory'])('%s restores an unconfirmed capture after remount without mixing owners',async(vendor)=>{
 sessionStorage.clear();state.owner='owner'
 const webdav='12345678-1234-1234-1234-123456789abc'
 state.api.listDriveImportAccounts.mockResolvedValue([{id:webdav,name:'Local DAV'}])
 const disposed=vi.fn()
 state.api.subscribeConnectedAccounts.mockImplementation(async s=>{for(const [id,accountVendor] of [[7,vendor],[8,'memory']] as const)s.add(id,{displayName:accountVendor},{},accountVendor==='memory'?drive:[],true,accountVendor);return {[Symbol.dispose]:disposed}})
 state.api.captureDriveImport.mockReset().mockRejectedValueOnce(Error('lost')).mockResolvedValue({node_id:'source-node',head:'head',source:{sourceVersion:'9',sha256:'hash'}})
 const container=document.createElement('div');document.body.append(container);let root=createRoot(container)
 const click=async(label:string)=>{const b=[...container.querySelectorAll('button')].find(b=>b.textContent===label);expect(b).toBeDefined();await act(async()=>b!.click())}
 const fill=async(label:string,value:string)=>{const el=container.querySelector(`[aria-label="${label}"]`) as HTMLInputElement|HTMLSelectElement;const prototype=el.tagName==='INPUT'?HTMLInputElement.prototype:HTMLSelectElement.prototype;await act(async()=>{Object.getOwnPropertyDescriptor(prototype,'value')!.set!.call(el,value);el.dispatchEvent(new Event('change',{bubbles:true}));el.dispatchEvent(new Event('input',{bubbles:true}))})}
 try{
  await act(async()=>root.render(<DriveImportPanel/>));await fill('Drive source account','7');await fill('Аккаунт-получатель диска',vendor==='memory'?'7':'8');await fill('Drive project','project');await fill('Drive file','file')
  if(vendor==='memory')await fill('Drive WebDAV account',webdav)
  await click('Сохранить копию');expect(container.textContent).toContain('Сохранение не подтверждено')
  const original=state.api.captureDriveImport.mock.calls[0];expect(original.slice(0,4)).toEqual([7,vendor==='memory'?7:8,vendor==='memory'?webdav+':file':'file','project']);expect(readDriveAttempt(sessionStorage,'owner')?.request).toBe(original[4])
  await act(async()=>root.unmount());root=createRoot(container);await act(async()=>root.render(<DriveImportPanel/>))
  expect(state.api.captureDriveImport).toHaveBeenCalledTimes(1)
  await click('Повторить сохранение');expect(state.api.captureDriveImport.mock.calls[1]).toEqual(original);expect(container.textContent).toContain('source-node')
  state.owner='other';await act(async()=>root.render(<DriveImportPanel/>));expect(container.textContent).not.toContain(original[4]);expect(container.textContent).not.toContain('source-node');expect((container.querySelector('[aria-label="Drive file"]') as HTMLInputElement).value).toBe('')
  expect(sessionStorage.getItem(driveAttemptKey('owner'))).not.toBeNull();expect(sessionStorage.getItem(driveAttemptKey('other'))).toBeNull()
 }finally{await act(async()=>root.unmount());container.remove();sessionStorage.clear()}
 expect(disposed).toHaveBeenCalledTimes(3)
})

it('rejects malformed saved recovery rather than silently starting a different request',()=>{
 const storage={getItem:()=>JSON.stringify({source:7,target:7,file:'file',project:'project',request:'request'})}
 expect(()=>readDriveAttempt(storage,'owner')).toThrow('Invalid import recovery')
})
