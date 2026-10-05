import type {TemplateEditingContext} from './templateEditing'
import type {ChatWorkTemplateChoice} from '@gadgets/workshop-shared/work-template'
import type {ChatWorkTemplate,WorkTemplateKind} from '@gadgets/workshop-shared/work-template'
import {useEffect,useState} from 'react'
import type {RpcStub} from 'capnweb'
import type {GadgetClient} from '@gadgets/workshop-shared/api'
import type {NativeSnapshotSourceRef} from './nativeSnapshotSource'
import {deriveNativeTitle,nativeTitleSource} from '@gadgets/workshop-shared/native-document'
import BlueprintTemplateSave from './BlueprintTemplateSave'
import {WorkshopButton} from './components/WorkshopControls'

type Props={editing?:{context:TemplateEditingContext;material:ChatWorkTemplateChoice};initialKind?:WorkTemplateKind;gadget:RpcStub<GadgetClient>;sourceId:string;title:string;snapshotSource:NativeSnapshotSourceRef;projectChatId?:number;onUse?(template:ChatWorkTemplate):void;onClose():void}
type Context={status:'loading'}|{status:'error'}|{status:'ready';project?:{accountId:number|null;projectId:string}}

export default function DocumentTemplateSave({gadget,sourceId,title,snapshotSource,projectChatId,onClose,onUse,initialKind,editing}:Props){
 const [documentTitle,setDocumentTitle]=useState(title)
 const [context,setContext]=useState<Context>({status:'loading'}),[reload,setReload]=useState(0)
 useEffect(()=>{
  let cancelled=false;const controller=new AbortController();setContext({status:'loading'})
  const fallbackTitle=editing?.material.title??title
  const readTitle=Promise.resolve().then(()=>snapshotSource.current?.('cloudflareos.document',controller.signal)).then(snapshot=>snapshot?.format==='cloudflareos.document'?deriveNativeTitle(nativeTitleSource(snapshot.format,snapshot.document))??fallbackTitle:fallbackTitle).catch(()=>fallbackTitle)
  void Promise.allSettled([gadget.getMnemosDocument(projectChatId),readTitle]).then(([state,name])=>{
   if(cancelled)return
   setDocumentTitle(name.status==='fulfilled'?name.value:fallbackTitle)
   if(state.status==='rejected'){setContext({status:'error'});return}
   const project=state.value.binding?{accountId:state.value.binding.accountId,projectId:state.value.binding.scope}:state.value.project?{accountId:state.value.project.accountId,projectId:state.value.project.projectId}:undefined
   setContext({status:'ready',project})
  })
  return()=>{cancelled=true;controller.abort()}
 },[gadget,projectChatId,reload,snapshotSource,title,editing?.material.title])
 if(context.status==='loading')return <div className="space-y-3"><p role="status">Определяем проект документа…</p><WorkshopButton onClick={onClose}>Закрыть</WorkshopButton></div>
 if(context.status==='error')return <div className="space-y-3"><p role="alert">Не удалось определить проект документа.</p><WorkshopButton onClick={()=>setReload(v=>v+1)}>Повторить</WorkshopButton><WorkshopButton onClick={()=>setContext({status:'ready'})}>Выбрать проект вручную</WorkshopButton><WorkshopButton onClick={onClose}>Закрыть</WorkshopButton></div>
 return <BlueprintTemplateSave initialTemplate={editing} initialKind={editing?.material.kind??initialKind} nativeOnly onUse={onUse} preferredProject={editing?.context??context.project} blueprint={{id:sourceId,title:documentTitle,description:editing?.material.purpose??''}} format="cloudflareos.document" snapshotSource={snapshotSource} onClose={onClose}/>
}
