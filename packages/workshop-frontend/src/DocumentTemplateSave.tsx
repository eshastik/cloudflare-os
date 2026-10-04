import {useEffect,useState} from 'react'
import type {RpcStub} from 'capnweb'
import type {GadgetClient} from '@gadgets/workshop-shared/api'
import type {NativeSnapshotSourceRef} from './nativeSnapshotSource'
import BlueprintTemplateSave from './BlueprintTemplateSave'
import {WorkshopButton} from './components/WorkshopControls'

type Props={gadget:RpcStub<GadgetClient>;sourceId:string;title:string;snapshotSource:NativeSnapshotSourceRef;projectChatId?:number;onClose():void}
type Context={status:'loading'}|{status:'error'}|{status:'ready';project?:{accountId:number|null;projectId:string}}

export default function DocumentTemplateSave({gadget,sourceId,title,snapshotSource,projectChatId,onClose}:Props){
 const [context,setContext]=useState<Context>({status:'loading'}),[reload,setReload]=useState(0)
 useEffect(()=>{
  let cancelled=false;setContext({status:'loading'})
  void gadget.getMnemosDocument(projectChatId).then(state=>{
   if(cancelled)return
   const project=state.binding?{accountId:state.binding.accountId,projectId:state.binding.scope}:state.project?{accountId:state.project.accountId,projectId:state.project.projectId}:undefined
   setContext({status:'ready',project})
  }).catch(()=>{if(!cancelled)setContext({status:'error'})})
  return()=>{cancelled=true}
 },[gadget,projectChatId,reload])
 if(context.status==='loading')return <div className="space-y-3"><p role="status">Определяем проект документа…</p><WorkshopButton onClick={onClose}>Закрыть</WorkshopButton></div>
 if(context.status==='error')return <div className="space-y-3"><p role="alert">Не удалось определить проект документа.</p><WorkshopButton onClick={()=>setReload(v=>v+1)}>Повторить</WorkshopButton><WorkshopButton onClick={()=>setContext({status:'ready'})}>Выбрать проект вручную</WorkshopButton><WorkshopButton onClick={onClose}>Закрыть</WorkshopButton></div>
 return <BlueprintTemplateSave nativeOnly preferredProject={context.project} blueprint={{id:sourceId,title,description:''}} format="cloudflareos.document" snapshotSource={snapshotSource} onClose={onClose}/>
}
