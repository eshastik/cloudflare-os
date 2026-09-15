import {useEffect,useState} from 'react'
import type {Overseer} from '@gadgets/workshop-shared/api'
import SharedTemplateLibrary from './SharedTemplateLibrary'

export default function ChatTemplateLibrary({overseer,chatId,viewerId,conversation}:{overseer:Pick<Overseer,'listChats'>;chatId:number;viewerId:string|undefined;conversation:{key:string;apply(bytes:Uint8Array,operationId:string,signal:AbortSignal):Promise<void>}}){
 const [context,setContext]=useState<{accountId:number;projectId:string}|null|undefined>(undefined)
 const [error,setError]=useState(false)
 useEffect(()=>{let active=true;setContext(undefined);setError(false)
   void overseer.listChats().then(chats=>{
     if(!active)return
     const chat=chats.find(item=>item.id===chatId)
     if(!chat){setError(true);return}
     const project=chat.projectContext
     setContext(project&&project.creatorProfileId===viewerId?{accountId:project.accountId,projectId:project.projectId}:null)
   }).catch(()=>{if(active)setError(true)})
   return()=>{active=false}
 },[overseer,chatId,viewerId])
 if(error)return <p role="alert">Не удалось прочитать проект беседы. Закройте окно и попробуйте снова.</p>
 if(context===undefined)return <p role="status">Загрузка проекта беседы…</p>
 return <SharedTemplateLibrary preferredProject={context??undefined} conversation={conversation}/>
}
