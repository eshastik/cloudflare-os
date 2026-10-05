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
 return <div className="mx-auto flex h-full w-full max-w-4xl flex-col px-5 sm:px-10">
  <header className="min-w-0 pb-6 pt-8"><h1 className="text-2xl font-semibold tracking-tight text-kumo-default">{composing?'Задача по шаблонам':'Шаблоны'}</h1><p className="mt-1 text-[13px] leading-5 text-kumo-subtle">{composing?'Опишите результат, который нужно получить. Материалы передадутся агенту после отправки.':'Выберите материалы и опишите задачу. Агент применит их вместе.'}</p></header>
  {task&&<div hidden={!composing}><div className="flex flex-wrap gap-2 px-3"><WorkshopButton onClick={()=>setComposing(false)}>Назад к библиотеке</WorkshopButton></div><HomePageContent compact templateSeed={task}/></div>}
  <div hidden={composing} className="min-h-0 flex-1 overflow-y-auto pb-6">
   {task&&<div className="mb-3 px-3"><WorkshopButton onClick={()=>setComposing(true)}>Вернуться к черновику задачи</WorkshopButton></div>}
   <div className="mb-5 flex flex-wrap items-center justify-between gap-2" role="group" aria-label="Разделы библиотеки шаблонов">
    {tab!=='work'?<WorkshopButton onClick={()=>setTab('work')}>Рабочие шаблоны</WorkshopButton>:<span className="text-[13px] text-kumo-subtle">Формы и правила работы</span>}
    <details className="text-[13px] text-kumo-subtle"><summary className="cursor-pointer rounded-lg px-2 py-2 focus-visible:outline-2 focus-visible:outline-kumo-brand">Приложения</summary><div className="flex flex-wrap gap-2 pt-2">{tabs.filter(([value])=>value!=='work').map(([value,label])=><WorkshopButton key={value} onClick={()=>setTab(value)}>{label}</WorkshopButton>)}</div></details>
   </div>
   {tab==='work'?<ChatTemplatePicker embedded initialSelected={draft} onSelectionChange={setDraft} onClose={()=>{}} onOtherTemplates={selected=>{setDraft(selected);setTab('shared')}} onSelect={choice=>{if(choice.mnemos?.length){setDraft(choice.mnemos);setTask({id:crypto.randomUUID(),chatId:null,templates:choice.mnemos});setComposing(true)}}}/>:tab==='shared'?<SharedTemplateLibrary/>:<BlueprintList/>}
  </div>
 </div>
}
