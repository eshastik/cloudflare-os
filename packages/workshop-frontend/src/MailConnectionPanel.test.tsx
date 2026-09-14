// @vitest-environment jsdom
import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {expect,it,vi} from 'vitest'
import MailConnectionPanel from './MailConnectionPanel'

const api=vi.hoisted(()=>({subscribeConnectedAccounts:vi.fn(),prepareMailConnection:vi.fn(),registerMailSelection:vi.fn(),listMailFolders:vi.fn()}))
const mail=[{urlPattern:'https://memory.example/mail',description:'',title:'',receives:'mail' as const}]
vi.mock('./AuthContext',()=>({useAuthenticatedApi:()=>({authenticatedApi:api,currentUser:{type:'user',id:'alice'}})}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true

it('allows correcting preparation failure and retains a pending registration on retry',async()=>{
 sessionStorage.clear()
 api.listMailFolders.mockResolvedValue({folders:[{id:'team',name:'Team',hasChildren:false},{id:'wrong',name:'Wrong',hasChildren:false}],truncated:false})
 const disposed=vi.fn()
 api.subscribeConnectedAccounts.mockImplementation(async s=>{
  for(const [id,vendor] of [[7,'google'],[8,'memory']] as const)s.add(id,{displayName:vendor},{},vendor==='memory'?mail:[],true,vendor)
  return {[Symbol.dispose]:disposed}
 })
 api.prepareMailConnection.mockRejectedValueOnce(Error('bad mail')).mockResolvedValue({selection_id:'selection',query:'label:team'})
 api.registerMailSelection.mockRejectedValueOnce(Error('response lost')).mockResolvedValue({connection_id:'connection',enabled:true})
 const container=document.createElement('div');document.body.append(container)
 let root=createRoot(container)
 const button=(name:string)=>[...container.querySelectorAll('button')].find(b=>b.textContent===name)!
 const click=async(name:string)=>{expect(button(name)).toBeDefined();await act(async()=>button(name).click())}
 const fill=async(label:string,value:string)=>{
  const el=container.querySelector(`[aria-label="${label}"]`) as HTMLInputElement|HTMLSelectElement
  const prototype=el.tagName==='INPUT'?HTMLInputElement.prototype:HTMLSelectElement.prototype
  await act(async()=>{Object.getOwnPropertyDescriptor(prototype,'value')!.set!.call(el,value);el.dispatchEvent(new Event('change',{bubbles:true}));el.dispatchEvent(new Event('input',{bubbles:true}))})
 }
 try{
  await act(async()=>root.render(<MailConnectionPanel/>))
  await fill('Почтовый аккаунт','7');await fill('Аккаунт-получатель','8');await fill('Проект','project');await act(async()=>container.querySelectorAll<HTMLInputElement>('input[type=radio]')[1].click())
  await click('Подключить почту')
  expect(api.registerMailSelection).not.toHaveBeenCalled()
  await click('Изменить выбор');await act(async()=>container.querySelector<HTMLInputElement>('input[type=radio]')!.click());await click('Подключить почту')
  expect(container.textContent).toContain('Подключение не подтверждено')
  expect(button('Изменить выбор')).toBeUndefined()
  const first=api.registerMailSelection.mock.calls[0]
  expect(first[0]).toBe(8);expect(first[1]).toBe('project');expect(first[3]).toBe('selection')
  await act(async()=>root.unmount());root=createRoot(container);await act(async()=>root.render(<MailConnectionPanel/>))
  expect(container.textContent).toContain('Найдена незавершённая заявка')
  await click('Повторить подключение')
  expect(api.registerMailSelection.mock.calls[1]).toEqual(first)
  expect(api.prepareMailConnection).toHaveBeenCalledTimes(2)
  expect(container.textContent).toContain('ID подключения: connection')
  await click('Подключить ещё почту')
  expect(button('Подключить почту').disabled).toBe(false)
 }finally{await act(async()=>root.unmount());container.remove()}
 expect(disposed).toHaveBeenCalledTimes(2)
})

it('selects a concrete Outlook subfolder before transferring authority',async()=>{
 vi.clearAllMocks();sessionStorage.clear()
 api.subscribeConnectedAccounts.mockImplementation(async s=>{for(const [id,vendor] of [[9,'microsoft'],[8,'memory']] as const)s.add(id,{displayName:vendor},{},vendor==='memory'?mail:[],true,vendor);return {[Symbol.dispose]:()=>{}}})
 api.listMailFolders.mockImplementation(async(_id,parent)=>({folders:parent?[{id:'child',name:'Team',hasChildren:false}]:[{id:'inbox',name:'Inbox',hasChildren:true}],truncated:false}))
 api.prepareMailConnection.mockResolvedValue({selection_id:'outlook-selection',query:'folder:child'})
 api.registerMailSelection.mockResolvedValue({connection_id:'outlook-connection',enabled:true})
 const container=document.createElement('div');document.body.append(container);const root=createRoot(container)
 const button=(name:string)=>[...container.querySelectorAll('button')].find(b=>b.textContent===name)!
 const fill=async(label:string,value:string)=>{const el=container.querySelector(`[aria-label="${label}"]`) as HTMLInputElement;await act(async()=>{Object.getOwnPropertyDescriptor(el.tagName==='INPUT'?HTMLInputElement.prototype:HTMLSelectElement.prototype,'value')!.set!.call(el,value);el.dispatchEvent(new Event('change',{bubbles:true}));el.dispatchEvent(new Event('input',{bubbles:true}))})}
 try{
  await act(async()=>root.render(<MailConnectionPanel/>))
  await fill('Почтовый аккаунт','9');await fill('Аккаунт-получатель','8');await fill('Проект','project')
  expect(button('Подключить почту').disabled).toBe(true)
  await act(async()=>button('Открыть вложенные папки: Inbox').click())
  expect(api.listMailFolders).toHaveBeenLastCalledWith(9,'inbox')
  await act(async()=>container.querySelector<HTMLInputElement>('input[type="radio"]')!.click())
  await act(async()=>button('Подключить почту').click())
  expect(api.prepareMailConnection.mock.calls[0].slice(0,4)).toEqual([9,8,'folder:child','project'])
  expect(container.textContent).toContain('outlook-connection')
 }finally{await act(async()=>root.unmount());container.remove()}
})

it('selects an IMAP folder inside the same Mnemos account',async()=>{
 vi.clearAllMocks();sessionStorage.clear();
 api.subscribeConnectedAccounts.mockImplementation(async s=>{s.add(8,{displayName:'Память'},{},mail,true,'memory');return {[Symbol.dispose]:()=>{}}});
 api.listMailFolders.mockResolvedValue({folders:[{id:'mailbox',name:'owner — INBOX',hasChildren:false}],truncated:false});
 api.prepareMailConnection.mockResolvedValue({selection_id:'imap-selection',query:'folder'});
 api.registerMailSelection.mockResolvedValue({connection_id:'imap-connection',enabled:true});
 const container=document.createElement('div');document.body.append(container);const root=createRoot(container);
 const fill=async(label:string,value:string)=>{const el=container.querySelector(`[aria-label="${label}"]`) as HTMLInputElement;await act(async()=>{Object.getOwnPropertyDescriptor(el.tagName==='INPUT'?HTMLInputElement.prototype:HTMLSelectElement.prototype,'value')!.set!.call(el,value);el.dispatchEvent(new Event('change',{bubbles:true}));el.dispatchEvent(new Event('input',{bubbles:true}));});};
 try{
  await act(async()=>root.render(<MailConnectionPanel/>));
  await fill('Почтовый аккаунт','8');await fill('Аккаунт-получатель','8');await fill('Проект','project');
  expect(container.textContent).toContain('Папка почты');expect(api.listMailFolders).toHaveBeenCalledWith(8,'');
  await act(async()=>container.querySelector<HTMLInputElement>('input[type="radio"]')!.click());
  await act(async()=>[...container.querySelectorAll('button')].find(b=>b.textContent==='Подключить почту')!.click());
  expect(api.prepareMailConnection.mock.calls[0].slice(0,4)).toEqual([8,8,'folder:mailbox','project']);
  expect(container.textContent).toContain('imap-connection');
 }finally{await act(async()=>root.unmount());container.remove();}
});

it('does not read account zero when the source selection is empty', async () => {
 vi.clearAllMocks(); sessionStorage.clear()
 api.subscribeConnectedAccounts.mockImplementation(async s => {
  s.add(0, {displayName:'Memory'}, {}, [{receives:'mail'}], true, 'memory')
  return {[Symbol.dispose]:()=>{}}
 })
 const container=document.createElement('div'); const root=createRoot(container)
 try {
  await act(async()=>root.render(<MailConnectionPanel/>))
  expect(api.listMailFolders).not.toHaveBeenCalled()
  expect(container.querySelector('[role="alert"]')).toBeNull()
 } finally {await act(async()=>root.unmount())}
})
