// @vitest-environment jsdom
import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {expect,it,vi} from 'vitest'
import PendingActions from './PendingActions'
const api=vi.hoisted(()=>({listGadgets:vi.fn(),openGadget:vi.fn()}))
vi.mock('./AuthContext',()=>({useAuthenticatedApi:()=>({authenticatedApi:api})}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true
it('shows complete proposed text, reports an unread workspace, and releases capabilities on approval',async()=>{
 const approve=vi.fn(),dispose=vi.fn()
 let pending=true
 const full='начало '+ 'строка '.repeat(9000)+' КОНЕЦ'
 api.listGadgets.mockResolvedValue([{id:'one',title:'Проект'},{id:'denied',title:'Закрытый'}])
 api.openGadget.mockImplementation(async(id:string)=>{
  if(id==='denied')throw Error('forbidden')
  return {listActions:async()=>pending?[{id:7,type:'action',state:'pending',description:{title:'Правка',description:full}}]:[],approveAction:async(id:number)=>{approve(id);pending=false},[Symbol.dispose]:dispose}
 })
 const element=document.createElement('div');document.body.append(element);const root=createRoot(element)
 try {
  await act(async()=>{root.render(<PendingActions/>);await new Promise(r=>setTimeout(r,20))})
  await act(async()=>{await vi.waitFor(()=>expect(element.querySelector('pre')?.textContent).toBe(full))})
  expect(element.textContent).toContain('Не прочитано пространств: 1')
  const button=[...element.querySelectorAll('button')].find(b=>b.textContent==='Разрешить')!
  await act(async()=>button.click())
  expect(approve).toHaveBeenCalledWith(7)
  expect(dispose.mock.calls.length).toBeGreaterThanOrEqual(2)
 } finally {await act(async()=>root.unmount());element.remove()}
})
