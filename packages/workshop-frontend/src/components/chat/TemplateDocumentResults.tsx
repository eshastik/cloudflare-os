import {useEffect,useRef,useState} from 'react'
import {FileText} from '@phosphor-icons/react'
import {WorkshopButton} from '../WorkshopControls'
import {buildWorkSteps,type FoundItem,type WorkBatch} from './toolDisplay'
import type {OpenDocument} from './WorkSteps'

/** Результаты подтверждённого создания; намерение и найденные документы карточек не получают. */
export function createdTemplateDocuments(batches:readonly WorkBatch[]):FoundItem[]{
 const results=new Map<string,FoundItem>()
 for(const step of buildWorkSteps(batches).steps){
  if(step.kind!=='mnemos.template.created'||step.error||step.detail.type!=='found')continue
  for(const item of step.detail.items)if(item.link?.document)results.set(JSON.stringify([item.link.resourceTitle,item.link.project,item.link.document]),item)
 }
 return [...results.values()]
}

export default function TemplateDocumentResults({batches,openDocument}:{batches:readonly WorkBatch[];openDocument?:OpenDocument}){
 const documents=createdTemplateDocuments(batches)
 const [opening,setOpening]=useState<string|null>(null),[error,setError]=useState('')
 const mounted=useRef(true)
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[])
 if(!documents.length)return null
 return <section aria-label="Документы по шаблонам" className="mt-3 flex flex-col gap-2">
  {documents.map(item=>{
   const link=item.link!,key=JSON.stringify(link),open=openDocument?.({...link,title:item.name,refreshLatest:true})
   return <article key={key} className="flex items-center gap-3 rounded-xl border border-kumo-line bg-kumo-overlay px-4 py-3">
    <FileText size={22} className="shrink-0 text-kumo-subtle" aria-hidden="true"/>
    <div className="min-w-0 flex-1"><h3 className="m-0 text-sm font-medium text-kumo-default [overflow-wrap:anywhere]">{item.name}</h3><p className="m-0 mt-1 text-xs text-kumo-subtle">Создан по шаблону · личная версия</p></div>
    <WorkshopButton disabled={!open||opening!==null} aria-label={'Открыть документ: '+item.name} onClick={()=>{
     if(!open||opening!==null)return
     setOpening(key);setError('')
     void Promise.resolve().then(open).catch(()=>{if(mounted.current)setError('Документ не открылся. Повторите попытку.')}).finally(()=>{if(mounted.current)setOpening(null)})
    }}>{opening===key?'Открываю…':'Открыть'}</WorkshopButton>
   </article>
  })}
  {error&&<p role="alert" className="m-0 text-sm text-kumo-danger">{error}</p>}
 </section>
}
