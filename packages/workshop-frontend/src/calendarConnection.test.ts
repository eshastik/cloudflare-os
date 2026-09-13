import {expect,it,vi} from 'vitest'
import {finishCalendarConnection,calendarAttemptKey,readCalendarAttempt,type CalendarAttempt} from './calendarConnection'

it('recovers a lost registration response with the original selection and request',async()=>{
 const attempt:CalendarAttempt={source:7,target:8,calendar:'team',project:'project',request:'stable-request'}
 const receipt={connection_id:'connection',project_id:'project',provider:'google',calendar_id:'team',revision:1,enabled:true}
 let committed=false
 const api={prepareCalendarConnection:vi.fn(async()=>({selection_id:'selection',title:'Team'})),registerCalendarSelection:vi.fn(async()=>{if(!committed){committed=true;throw Error('response lost')}return receipt})}
 await expect(finishCalendarConnection(api,attempt)).rejects.toThrow('response lost')
 expect(committed).toBe(true)
 await expect(finishCalendarConnection(api,attempt)).resolves.toEqual(receipt)
 expect(api.prepareCalendarConnection).toHaveBeenCalledTimes(1)
 expect(api.registerCalendarSelection.mock.calls).toEqual([[8,'project','stable-request','selection'],[8,'project','stable-request','selection']])
})

it('retries preparation with the same identity and never registers an unconfirmed selection',async()=>{
 const attempt:CalendarAttempt={source:7,target:8,calendar:'team',project:'project',request:'stable-request'}
 const api={prepareCalendarConnection:vi.fn().mockRejectedValueOnce(Error('response lost')).mockResolvedValue({selection_id:'selection',title:'Team'}),registerCalendarSelection:vi.fn()}
 await expect(finishCalendarConnection(api,attempt)).rejects.toThrow('response lost')
 expect(api.registerCalendarSelection).not.toHaveBeenCalled()
 await finishCalendarConnection(api,attempt)
 expect(api.prepareCalendarConnection.mock.calls).toEqual([[7,8,'team','project','stable-request'],[7,8,'team','project','stable-request']])
})

it('persists before remote actions and restores only this user’s request after a storage failure',async()=>{
 const attempt:CalendarAttempt={source:7,target:8,calendar:'team',project:'project',request:'stable-request'}
 const records=new Map<string,string>();const storage={getItem:(key:string)=>records.get(key)??null}
 const api={prepareCalendarConnection:vi.fn(async()=>({selection_id:'selection',title:'Team'})),registerCalendarSelection:vi.fn(async()=>({connection_id:'connection',project_id:'project',provider:'google',calendar_id:'team',revision:1,enabled:true}))}
 let writes=0
 const checkpoint=(value:CalendarAttempt)=>{if(++writes===2)throw Error('storage unavailable');records.set(calendarAttemptKey('alice'),JSON.stringify(value))}
 await expect(finishCalendarConnection(api,attempt,checkpoint)).rejects.toThrow('storage unavailable')
 expect(api.registerCalendarSelection).not.toHaveBeenCalled()
 expect(readCalendarAttempt(storage,'bob')).toBeUndefined()
 const restored=readCalendarAttempt(storage,'alice')!
 expect(restored.selection).toBeUndefined()
 await finishCalendarConnection(api,restored,checkpoint)
 expect(api.prepareCalendarConnection.mock.calls[1]).toEqual(api.prepareCalendarConnection.mock.calls[0])
 expect(readCalendarAttempt(storage,'alice')?.selection).toBe('selection')
 expect(api.registerCalendarSelection).toHaveBeenCalledTimes(1)
 records.set(calendarAttemptKey('alice'),JSON.stringify({...restored,target:-1}))
 expect(()=>readCalendarAttempt(storage,'alice')).toThrow('Invalid calendar recovery')
})
