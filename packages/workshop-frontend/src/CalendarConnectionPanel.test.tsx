// @vitest-environment jsdom
import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {expect,it,vi} from 'vitest'
import CalendarConnectionPanel from './CalendarConnectionPanel'

const api=vi.hoisted(()=>({subscribeConnectedAccounts:vi.fn(),prepareCalendarConnection:vi.fn(),registerCalendarSelection:vi.fn(),listCalendars:vi.fn()}))
const calendar=[{urlPattern:'https://memory.example/calendar',description:'',title:'',receives:'calendar' as const}]
vi.mock('./AuthContext',()=>({useAuthenticatedApi:()=>({authenticatedApi:api,currentUser:{type:'user',id:'alice'}})}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true

it('allows correcting preparation failure and retains a pending registration on retry',async()=>{
 sessionStorage.clear()
 const disposed=vi.fn()
 api.subscribeConnectedAccounts.mockImplementation(async s=>{
  for(const [id,vendor] of [[7,'google'],[8,'memory']] as const)s.add(id,{displayName:vendor},{},vendor==='memory'?calendar:[],true,vendor)
  return {[Symbol.dispose]:disposed}
 })
 api.prepareCalendarConnection.mockRejectedValueOnce(Error('bad calendar')).mockResolvedValue({selection_id:'selection',title:'Team'})
 api.registerCalendarSelection.mockRejectedValueOnce(Error('response lost')).mockResolvedValue({connection_id:'connection',enabled:true})
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
  await act(async()=>root.render(<CalendarConnectionPanel/>))
  await fill('Аккаунт календаря','7');await fill('Аккаунт-получатель','8');await fill('Проект','project');await fill('ID календаря','wrong')
  await click('Подключить календарь')
  expect(api.registerCalendarSelection).not.toHaveBeenCalled()
  await click('Изменить выбор');await fill('ID календаря','team');await click('Подключить календарь')
  expect(container.textContent).toContain('Подключение не подтверждено')
  expect(button('Изменить выбор')).toBeUndefined()
  const first=api.registerCalendarSelection.mock.calls[0]
  expect(first[0]).toBe(8);expect(first[1]).toBe('project');expect(first[3]).toBe('selection')
  await act(async()=>root.unmount());root=createRoot(container);await act(async()=>root.render(<CalendarConnectionPanel/>))
  expect(container.textContent).toContain('Найдена незавершённая заявка')
  await click('Повторить подключение')
  expect(api.registerCalendarSelection.mock.calls[1]).toEqual(first)
  expect(api.prepareCalendarConnection).toHaveBeenCalledTimes(2)
  expect(container.textContent).toContain('ID подключения: connection')
  await click('Подключить ещё календарь')
  expect(button('Подключить календарь').disabled).toBe(false)
 }finally{await act(async()=>root.unmount());container.remove()}
 expect(disposed).toHaveBeenCalledTimes(2)
})

it.each(['microsoft','memory'])('selects an owned %s calendar before transferring authority',async(sourceVendor)=>{
 vi.clearAllMocks();sessionStorage.clear()
 api.subscribeConnectedAccounts.mockImplementation(async s=>{for(const [id,vendor] of [[9,sourceVendor],[8,'memory']] as const)s.add(id,{displayName:vendor},{},vendor==='memory'?calendar:[],true,vendor);return {[Symbol.dispose]:()=>{}}})
 api.listCalendars.mockResolvedValue({calendars:[{id:'team-calendar',name:'Team'}],truncated:false})
 api.prepareCalendarConnection.mockResolvedValue({selection_id:'outlook-selection',title:'Team'})
 api.registerCalendarSelection.mockResolvedValue({connection_id:'outlook-connection',enabled:true})
 const container=document.createElement('div');document.body.append(container);let root=createRoot(container)
 const button=(name:string)=>[...container.querySelectorAll('button')].find(b=>b.textContent===name)!
 const fill=async(label:string,value:string)=>{const el=container.querySelector(`[aria-label="${label}"]`) as HTMLInputElement;await act(async()=>{Object.getOwnPropertyDescriptor(el.tagName==='INPUT'?HTMLInputElement.prototype:HTMLSelectElement.prototype,'value')!.set!.call(el,value);el.dispatchEvent(new Event('change',{bubbles:true}));el.dispatchEvent(new Event('input',{bubbles:true}))})}
 try{
  await act(async()=>root.render(<CalendarConnectionPanel/>))
  await fill('Аккаунт календаря','9');await fill('Аккаунт-получатель',sourceVendor==='memory'?'9':'8');await fill('Проект','project')
  expect(button('Подключить календарь').disabled).toBe(true)
  expect(api.listCalendars).toHaveBeenCalledWith(9)
  await fill('Календарь Outlook / CalDAV','team-calendar')
  await act(async()=>button('Подключить календарь').click())
  expect(api.prepareCalendarConnection.mock.calls[0].slice(0,4)).toEqual([9,sourceVendor==='memory'?9:8,'team-calendar','project'])
  expect(container.textContent).toContain('outlook-connection')
  const registered=api.registerCalendarSelection.mock.calls.at(-1)
  await act(async()=>root.unmount());root=createRoot(container);await act(async()=>root.render(<CalendarConnectionPanel/>))
  expect(container.textContent).toContain('Найдена незавершённая заявка')
  await act(async()=>button('Повторить подключение').click())
  expect(api.registerCalendarSelection.mock.calls.at(-1)).toEqual(registered)
  expect(api.prepareCalendarConnection).toHaveBeenCalledTimes(1)
  expect(container.textContent).toContain('outlook-connection')
 }finally{await act(async()=>root.unmount());container.remove()}
})

it('does not read account zero when the source selection is empty', async () => {
 vi.clearAllMocks(); sessionStorage.clear()
 api.subscribeConnectedAccounts.mockImplementation(async s => {
  s.add(0, {displayName:'Memory'}, {}, [{receives:'calendar'}], true, 'memory')
  return {[Symbol.dispose]:()=>{}}
 })
 const container=document.createElement('div'); const root=createRoot(container)
 try {
  await act(async()=>root.render(<CalendarConnectionPanel/>))
  expect(api.listCalendars).not.toHaveBeenCalled()
  expect(container.querySelector('[role="alert"]')).toBeNull()
 } finally {await act(async()=>root.unmount())}
})
