import type {RpcStub} from 'capnweb'
import type {AuthenticatedApi,Overseer,WorkpieceSummary} from '@gadgets/workshop-shared/api'
import {isNativeDocumentFormat,nativeFormatForOutput,type NativeDocumentEditor} from '@gadgets/workshop-shared/native-document'
import {openNativeDownloadsFrame} from './accountCapabilities'
import {disposeGatekeeperFrame} from './disposeGatekeeperFrame'
import {rememberNativeDocumentLaunch} from './nativeDocumentLaunch'
import type {AppTarget} from './mnemosAppInChat'

type Api=Pick<RpcStub<AuthenticatedApi>,'subscribeConnectedAccounts'|'getGatekeeperApp'>
export type NativeWorkspace={id:string;chatId:number;overseer:Pick<RpcStub<Overseer>,'getGadget'|'createNativeEditor'>;gadgets:readonly Pick<WorkpieceSummary,'id'|'output'>[]}
const running=new Map<string,Promise<number|null>>()

/** Открывает документ, таблицу или презентацию в текущем рабочем месте. Уже открытые правки не заменяются. */
export function openNativeInWorkspace(api:Api,workspace:NativeWorkspace,target:AppTarget):Promise<number|null>{
 const key='mnemos-native-chat:'+JSON.stringify([workspace.id,target.accountId,target.scope,target.resource])
 const pending=running.get(key);if(pending)return pending
 const job=(async()=>{
  const frame=await openNativeDownloadsFrame(api,target.accountId)
  try{
   const history=await frame.nativeDownloads.selector.publications(target.scope,target.resource,'')
   const version=history.publications[0];if(!version||!isNativeDocumentFormat(version.format))return null
   for(const item of workspace.gadgets){
    if(nativeFormatForOutput(item.output?.id)!==version.format)continue
    const gadget=workspace.overseer.getGadget(item.id)
    try{const binding=(await gadget.getMnemosDocument()).binding;if(binding?.accountId===target.accountId&&binding.scope===target.scope&&binding.resource===target.resource)return item.id}finally{gadget[Symbol.dispose]()}
   }
   let stored:{operationId?:string;gadgetId?:number}|null=null
   try{stored=JSON.parse(localStorage.getItem(key)||'null')}catch{}
   let id:number|undefined
   if(Number.isSafeInteger(stored?.gadgetId)){
    const gadget=workspace.overseer.getGadget(stored!.gadgetId!)
    try{
     id=await gadget.getId()
     const binding=(await gadget.getMnemosDocument()).binding
     if(binding){
      if(binding.accountId!==target.accountId||binding.scope!==target.scope||binding.resource!==target.resource)throw Error('Редактор открывает другой документ')
      return id
     }
     const editor=await gadget.connectToGadget() as RpcStub<NativeDocumentEditor>
     try{if((await editor.getDocument()).revision>0)throw Error('В редакторе есть правки. Откройте его и выберите версию вручную.')}finally{editor[Symbol.dispose]()}
    }catch(error){if(id!==undefined)throw error;stored=null}finally{gadget[Symbol.dispose]()}
   }
   const operationId=stored?.operationId??crypto.randomUUID()
   if(id===undefined){
    try{localStorage.setItem(key,JSON.stringify({operationId}))}catch{}
    id=await workspace.overseer.createNativeEditor(version.format,target.title?.trim().slice(0,120)||'Документ',workspace.chatId,operationId)
    try{localStorage.setItem(key,JSON.stringify({operationId,gadgetId:id}))}catch{}
   }
   // Квитанция может вернуть прежний редактор после потери ответа. Его правки проверяем и в этом случае.
   const accepted=workspace.overseer.getGadget(id)
   try{
    const binding=(await accepted.getMnemosDocument()).binding
    if(binding){
     if(binding.accountId!==target.accountId||binding.scope!==target.scope||binding.resource!==target.resource)throw Error('Редактор открывает другой документ')
     return id
    }
    const editor=await accepted.connectToGadget() as RpcStub<NativeDocumentEditor>
    try{if((await editor.getDocument()).revision>0)throw Error('В редакторе есть правки. Откройте его и выберите версию вручную.')}finally{editor[Symbol.dispose]()}
   }finally{accepted[Symbol.dispose]()}
   rememberNativeDocumentLaunch(workspace.id,{accountId:target.accountId,scope:target.scope,resource:target.resource,format:version.format,publication:version.id,gadgetId:id})
   return id
  }finally{disposeGatekeeperFrame(frame)}
 })()
 running.set(key,job);void job.finally(()=>{if(running.get(key)===job)running.delete(key)}).catch(()=>{})
 return job
}
