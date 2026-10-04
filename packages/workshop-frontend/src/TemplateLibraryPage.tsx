import {useState} from 'react'
import SharedTemplateLibrary from './SharedTemplateLibrary'
import ChatTemplatePicker from './ChatTemplatePicker'
import type {ChatWorkTemplate} from '@gadgets/workshop-shared/work-template'
import type {ChatTemplateSeed} from './chatTemplateSeed'
import {HomePageContent} from './routes/index'
import {WorkshopButton} from './components/WorkshopControls'
import BlueprintList from './components/BlueprintList'
import { useDocumentTitle } from './useDocumentTitle'

export default function TemplateLibraryPage(){
 useDocumentTitle('Шаблоны')
 const [tab,setTab]=useState<'work'|'own'|'shared'>('work')
 const [draft,setDraft]=useState<ChatWorkTemplate[]>([])
 const [task,setTask]=useState<ChatTemplateSeed|null>(null)
 const [composing,setComposing]=useState(false)
 const tabs=[['work','Рабочие шаблоны'],['own','Мои приложения'],['shared','Общие приложения']] as const
 return <div className="mx-auto flex h-full w-full max-w-4xl flex-col px-4 sm:px-10">
  <header className="min-w-0 px-3 pb-4 pt-8"><h1 className="text-2xl font-semibold tracking-tight text-kumo-default">{composing?'Задача по шаблонам':'Шаблоны'}</h1><p className="mt-1 text-[13px] leading-5 text-kumo-subtle">{composing?'Опишите результат, который нужно получить. Материалы передадутся агенту после отправки.':'Формы, методики, инструкции и навыки для работы. Можно использовать несколько материалов вместе.'}</p></header>
  {task&&<div hidden={!composing}><div className="flex flex-wrap gap-2 px-3"><WorkshopButton onClick={()=>setComposing(false)}>Назад к библиотеке</WorkshopButton></div><HomePageContent compact templateSeed={task}/></div>}
  <div hidden={composing} className="min-h-0 flex-1 overflow-y-auto pb-6">
   {task&&<div className="mb-3 px-3"><WorkshopButton onClick={()=>setComposing(true)}>Вернуться к черновику задачи</WorkshopButton></div>}
   <div className="mb-3 flex flex-wrap gap-2 px-3" role="group" aria-label="Разделы библиотеки шаблонов">{tabs.map(([value,label])=><button type="button" key={value} aria-pressed={tab===value} onClick={()=>setTab(value)} className={'rounded-lg px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-kumo-brand '+(tab===value?'bg-kumo-tint font-medium':'text-kumo-subtle')}>{label}</button>)}</div>
   {tab==='work'?<ChatTemplatePicker embedded initialSelected={draft} onSelectionChange={setDraft} onClose={()=>{}} onOtherTemplates={selected=>{setDraft(selected);setTab('shared')}} onSelect={choice=>{if(choice.mnemos?.length){setDraft(choice.mnemos);setTask({id:crypto.randomUUID(),chatId:null,templates:choice.mnemos});setComposing(true)}}}/>:tab==='shared'?<SharedTemplateLibrary/>:<BlueprintList/>}
  </div>
 </div>
}
