import {expect,it,vi} from 'vitest'
import {openNativeWritesContext,openNativeWritesFrame} from './accountCapabilities'

function catalog(){
 const dispose=vi.fn(),calls:number[]=[]
 const frame={ui:{[Symbol.dispose]:dispose},nativeWrites:{selector:{},storageOrigin:'https://objects.example'}}
 const api={async subscribeConnectedAccounts(subscriber:any){
   for(const id of [1,2])subscriber.add(id,{providesUi:{title:'Память'}},{url:'https://memory.example'},[{receives:'drive'}],true,'memory')
   subscriber.ready();return {[Symbol.dispose](){}}
 },async getGatekeeperApp(_vendor:string,id:number){calls.push(id);return id===2?frame:{ui:{[Symbol.dispose]:dispose}}}}
 return {api:api as any,frame,calls,dispose}
}
it('автоматический выбор сохраняет перебор и возвращает фактический аккаунт',async()=>{
 const {api,frame,calls,dispose}=catalog();const opened=await openNativeWritesContext(api)
 expect(opened.accountId).toBe(2);expect(opened.frame).toBe(frame);expect(calls).toEqual([1,2]);expect(dispose).toHaveBeenCalledOnce()
})
it('явный аккаунт без нужной возможности не заменяется другим',async()=>{
 const {api,calls}=catalog();await expect(openNativeWritesContext(api,1)).rejects.toThrow();expect(calls).toEqual([1])
})
it('прежний helper возвращает тот же фрейм без изменения контракта',async()=>{
 const {api,frame,calls}=catalog();expect(await openNativeWritesFrame(api)).toBe(frame);expect(calls).toEqual([1,2])
})
