// @vitest-environment jsdom
import {beforeEach,expect,it,vi} from 'vitest'
import {openNativeInWorkspace,type NativeWorkspace} from './mnemosNativeInChat'
import {readNativeDocumentLaunch,clearNativeDocumentLaunch} from './nativeDocumentLaunch'
const state=vi.hoisted(()=>({format:'cloudflareos.presentation',denied:false}))
vi.mock('./accountCapabilities',()=>({openNativeDownloadsFrame:async()=>({nativeDownloads:{selector:{publications:async()=>{if(state.denied)throw Error('Нет доступа');return {publications:[{id:'private:head',format:state.format}],nextCursor:''}}}}})}))
vi.mock('./disposeGatekeeperFrame',()=>({disposeGatekeeperFrame:()=>{}}))
const target={accountId:3,scope:'project',resource:'node',title:'Результат'}
const api={} as never
beforeEach(()=>{localStorage.clear();sessionStorage.clear();history.replaceState(null,'','/workspace/current');state.format='cloudflareos.presentation';state.denied=false})
function fixture(){
 let binding:unknown=null,revision=0
 const create=vi.fn(async(_format:string,_title:string,_chat:number,_operation:string)=>8)
 const getGadget=()=>({getId:async()=>8,getMnemosDocument:async()=>({binding}),connectToGadget:async()=>({getDocument:async()=>({revision}),[Symbol.dispose]:()=>{}}),[Symbol.dispose]:()=>{}})
 const workspace={id:'current',chatId:0,overseer:{createNativeEditor:create,getGadget},gadgets:[]} as unknown as NativeWorkspace
 return {workspace,create,setBinding:()=>{binding={accountId:3,scope:'project',resource:'node'};workspace.gadgets=[{id:8,output:{id:'presentation'} as never}]},edit:()=>{revision=1}}
}
it.each(['cloudflareos.document','cloudflareos.spreadsheet','cloudflareos.presentation'] as const)('открывает %s в том же рабочем месте и только в нужном редакторе',async format=>{
 state.format=format;const f=fixture()
 expect(await openNativeInWorkspace(api,f.workspace,target)).toBe(8)
 expect(f.create).toHaveBeenCalledWith(format,'Результат',0,expect.any(String))
 expect(readNativeDocumentLaunch(format,8)).toMatchObject({accountId:3,scope:'project',resource:'node',publication:'private:head',gadgetId:8})
 expect(readNativeDocumentLaunch(format,9)).toBeNull()
 expect(location.pathname).toBe('/workspace/current')
})
it('повтор и одновременные нажатия не создают второй редактор и не заменяют открытые правки',async()=>{
 const f=fixture();expect(await Promise.all([openNativeInWorkspace(api,f.workspace,target),openNativeInWorkspace(api,f.workspace,target)])).toEqual([8,8]);expect(f.create).toHaveBeenCalledOnce()
 f.setBinding();f.edit();clearNativeDocumentLaunch()
 expect(await openNativeInWorkspace(api,f.workspace,{...target,refreshLatest:true})).toBe(8)
 expect(f.create).toHaveBeenCalledOnce();expect(readNativeDocumentLaunch('cloudflareos.presentation',8)).toBeNull()
})
it('после неудачного открытия не перезаписывает правки неподключённого редактора',async()=>{
 const f=fixture();await openNativeInWorkspace(api,f.workspace,target);f.edit();clearNativeDocumentLaunch()
 await expect(openNativeInWorkspace(api,f.workspace,target)).rejects.toThrow('есть правки')
 expect(f.create).toHaveBeenCalledOnce();expect(readNativeDocumentLaunch('cloudflareos.presentation',8)).toBeNull()
})
it('отзыв доступа отказывает до создания, приложение идёт прежним путём',async()=>{
 const f=fixture();state.denied=true;await expect(openNativeInWorkspace(api,f.workspace,target)).rejects.toThrow('Нет доступа');expect(f.create).not.toHaveBeenCalled()
 state.denied=false;state.format='cloudflareos.app';expect(await openNativeInWorkspace(api,f.workspace,target)).toBeNull();expect(f.create).not.toHaveBeenCalled()
})

it('потеря ответа создания не разрешает заменить правки при повторе по квитанции',async()=>{
 const f=fixture();f.create.mockRejectedValueOnce(Error('Ответ потерян'));await expect(openNativeInWorkspace(api,f.workspace,target)).rejects.toThrow('Ответ потерян');f.edit()
 await expect(openNativeInWorkspace(api,f.workspace,target)).rejects.toThrow('есть правки')
 expect(f.create).toHaveBeenCalledTimes(2);expect(f.create.mock.calls[1][3]).toBe(f.create.mock.calls[0][3]);expect(readNativeDocumentLaunch('cloudflareos.presentation',8)).toBeNull()
});
