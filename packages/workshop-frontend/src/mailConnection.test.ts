import {expect,it,vi} from 'vitest'
import {finishMailConnection,mailAttemptKey,readMailAttempt,type MailAttempt} from './mailConnection'

it('recovers a lost registration response with the original selection and request',async()=>{
 const attempt:MailAttempt={source:7,target:8,query:'team',project:'project',request:'stable-request'}
 const receipt={connection_id:'connection',project_id:'project',provider:'google',query_sha256:'team',revision:1,enabled:true}
 let committed=false
 const api={prepareMailConnection:vi.fn(async()=>({selection_id:'selection',query:'label:team'})),registerMailSelection:vi.fn(async()=>{if(!committed){committed=true;throw Error('response lost')}return receipt})}
 await expect(finishMailConnection(api,attempt)).rejects.toThrow('response lost')
 expect(committed).toBe(true)
 await expect(finishMailConnection(api,attempt)).resolves.toEqual(receipt)
 expect(api.prepareMailConnection).toHaveBeenCalledTimes(1)
 expect(api.registerMailSelection.mock.calls).toEqual([[8,'project','stable-request','selection'],[8,'project','stable-request','selection']])
})

it('retries preparation with the same identity and never registers an unconfirmed selection',async()=>{
 const attempt:MailAttempt={source:7,target:8,query:'team',project:'project',request:'stable-request'}
 const api={prepareMailConnection:vi.fn().mockRejectedValueOnce(Error('response lost')).mockResolvedValue({selection_id:'selection',query:'label:team'}),registerMailSelection:vi.fn()}
 await expect(finishMailConnection(api,attempt)).rejects.toThrow('response lost')
 expect(api.registerMailSelection).not.toHaveBeenCalled()
 await finishMailConnection(api,attempt)
 expect(api.prepareMailConnection.mock.calls).toEqual([[7,8,'team','project','stable-request'],[7,8,'team','project','stable-request']])
})

it('persists before remote actions and restores only this user’s request after a storage failure',async()=>{
 const attempt:MailAttempt={source:7,target:8,query:'team',project:'project',request:'stable-request'}
 const records=new Map<string,string>();const storage={getItem:(key:string)=>records.get(key)??null}
 const api={prepareMailConnection:vi.fn(async()=>({selection_id:'selection',query:'label:team'})),registerMailSelection:vi.fn(async()=>({connection_id:'connection',project_id:'project',provider:'google',query_sha256:'team',revision:1,enabled:true}))}
 let writes=0
 const checkpoint=(value:MailAttempt)=>{if(++writes===2)throw Error('storage unavailable');records.set(mailAttemptKey('alice'),JSON.stringify(value))}
 await expect(finishMailConnection(api,attempt,checkpoint)).rejects.toThrow('storage unavailable')
 expect(api.registerMailSelection).not.toHaveBeenCalled()
 expect(readMailAttempt(storage,'bob')).toBeUndefined()
 const restored=readMailAttempt(storage,'alice')!
 expect(restored.selection).toBeUndefined()
 await finishMailConnection(api,restored,checkpoint)
 expect(api.prepareMailConnection.mock.calls[1]).toEqual(api.prepareMailConnection.mock.calls[0])
 expect(readMailAttempt(storage,'alice')?.selection).toBe('selection')
 expect(api.registerMailSelection).toHaveBeenCalledTimes(1)
 records.set(mailAttemptKey('alice'),JSON.stringify({...restored,target:-1}))
 expect(()=>readMailAttempt(storage,'alice')).toThrow('Invalid mail recovery')
})

it('restores an IMAP folder selection sourced from the same Mnemos account',()=>{
 const attempt={source:8,target:8,query:'folder:mailbox',project:'project',request:'request'};
 expect(readMailAttempt({getItem:()=>JSON.stringify(attempt)},'alice')).toEqual(attempt);
})
