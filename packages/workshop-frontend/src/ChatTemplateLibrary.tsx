import ChatTemplatePicker from './ChatTemplatePicker'
import type {ChatWorkTemplate} from '@gadgets/workshop-shared/work-template'
import {Dialog} from '@cloudflare/kumo'
import {WorkshopButton} from './components/WorkshopControls'
import {useEffect,useState} from 'react'
import type {Overseer} from '@gadgets/workshop-shared/api'
import SharedTemplateLibrary from './SharedTemplateLibrary'

export default function ChatTemplateLibrary({overseer,chatId,viewerId,conversation,onSelect,onClose}:{overseer:Pick<Overseer,'listChats'>;chatId:number;viewerId:string|undefined;conversation:{key:string;apply(bytes:Uint8Array,operationId:string,signal:AbortSignal):Promise<void>};onSelect?(templates:ChatWorkTemplate[]):void;onClose?():void}){
 const [context,setContext]=useState<{accountId:number;projectId:string}|null|undefined>(undefined)
 const [error,setError]=useState(false)
 const [applications,setApplications]=useState(false)
 const [draft,setDraft]=useState<ChatWorkTemplate[]>([])
 const [reload,setReload]=useState(0)
 useEffect(()=>{let active=true;setContext(undefined);setError(false)
   void overseer.listChats().then(chats=>{
     if(!active)return
     const chat=chats.find(item=>item.id===chatId)
     if(!chat){setError(true);return}
     const project=chat.projectContext
     setContext(project&&project.creatorProfileId===viewerId?{accountId:project.accountId,projectId:project.projectId}:null)
   }).catch(()=>{if(active)setError(true)})
   return()=>{active=false}
 },[overseer,chatId,viewerId,reload])
 if(error||context===undefined){
  const status=error?<div role="alert"><p>Не удалось прочитать проект беседы.</p><WorkshopButton onClick={()=>setReload(value=>value+1)}>Повторить</WorkshopButton></div>:<p role="status">Загрузка проекта беседы…</p>
  if(onClose)return <Dialog.Root open onOpenChange={open=>{if(!open)onClose()}}><Dialog size="base"><Dialog.Title>Шаблоны для задачи</Dialog.Title><Dialog.Description>Проверяем проект и доступные библиотеки.</Dialog.Description><div className="my-4">{status}</div><WorkshopButton onClick={onClose}>Закрыть</WorkshopButton></Dialog></Dialog.Root>
  return status
 }
 if(onSelect&&onClose){
  if(!applications)return <ChatTemplatePicker preferredProject={context??undefined} initialSelected={draft} onClose={onClose} onOtherTemplates={selected=>{setDraft(selected);setApplications(true)}} onSelect={choice=>{if(choice.mnemos?.length)onSelect(choice.mnemos)}}/>
  return <Dialog.Root open onOpenChange={open=>{if(!open)onClose()}}><Dialog size="lg" className="!max-h-[calc(100dvh-24px)] !w-[min(720px,calc(100vw-24px))] overflow-y-auto"><Dialog.Title>Шаблоны приложений</Dialog.Title><Dialog.Description>Создайте рабочее приложение в этой беседе из утверждённого снимка.</Dialog.Description><div className="my-3 flex flex-wrap gap-2"><WorkshopButton onClick={()=>setApplications(false)}>Назад к рабочим шаблонам</WorkshopButton><WorkshopButton onClick={onClose}>Закрыть</WorkshopButton></div><SharedTemplateLibrary preferredProject={context??undefined} conversation={conversation}/></Dialog></Dialog.Root>
 }
 return <SharedTemplateLibrary preferredProject={context??undefined} conversation={conversation}/>
}
