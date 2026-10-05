import type {ChatWorkTemplate} from '@gadgets/workshop-shared/work-template'
import type {TemplateEditingContext} from './templateEditing'
import {useEffect,useRef,useState} from 'react'
import {useNavigate} from '@tanstack/react-router'
import {Dialog} from '@cloudflare/kumo'
import type {OutputFormatOffer} from '@gadgets/workshop-shared/api'
import type {WorkTemplateKind} from '@gadgets/workshop-shared/work-template'
import {useAuthenticatedApi} from './AuthContext'
import {WorkshopButton} from './components/WorkshopControls'

const kinds:Record<WorkTemplateKind,{title:string;description:string}>={
 document:{title:'Форма документа',description:'Структура и подсказки для нового документа.'},
 guidance:{title:'Методика',description:'Порядок работы и требования к результату.'},
 agent_instructions:{title:'Инструкция агента',description:'Правила поведения агента в задаче.'},
 skill:{title:'Навык',description:'Как выполнить конкретную операцию.'},
}
export default function CreateWorkTemplate({editing}:{editing?:TemplateEditingContext & {item:ChatWorkTemplate}}){
 const {authenticatedApi}=useAuthenticatedApi(),navigate=useNavigate()
 const improving=editing&&'scope_id' in editing.reference
 const [open,setOpen]=useState(false),[kind,setKind]=useState<WorkTemplateKind>(editing?.item.kind??'document')
 const [formats,setFormats]=useState<OutputFormatOffer[]|null>(null),[formatId,setFormatId]=useState('')
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[reload,setReload]=useState(0)
 const starting=useRef(false),workspace=useRef<string|null>(null)
 const editor=useRef<{stub:Awaited<ReturnType<typeof authenticatedApi.newGadgetFromBlueprint>>}|null>(null)
 const active=useRef(true)
 useEffect(()=>{active.current=true;return()=>{active.current=false;const current=editor.current;editor.current=null;current?.stub[Symbol.dispose]()}},[])
 useEffect(()=>{
  if(!open)return
  let loadingActive=true;setFormats(null);setError('')
  void authenticatedApi.listOutputFormats().then(list=>{
   if(!loadingActive)return
   const documents=list.filter(item=>item.output.id==='document'&&!item.requiresSetup)
   setFormats(documents);setFormatId(old=>documents.some(item=>item.blueprintId===old)?old:documents.length===1?documents[0].blueprintId:'')
  },()=>{if(loadingActive)setError('Не удалось загрузить редактор документа. Повторите загрузку.')})
  return()=>{loadingActive=false}
 },[authenticatedApi,open,reload])
 async function create(){
  if(starting.current||!formatId)return
  starting.current=true;setBusy(true);setError('')
  try{
   if(!workspace.current){
    if(!editor.current){
     const stub=await authenticatedApi.newGadgetFromBlueprint(formatId,{})
     if(!active.current){stub[Symbol.dispose]();return}
     editor.current={stub}
    }
    const metadata=await editor.current.stub.getMetadata()
    if(!active.current)return
    workspace.current=metadata.id
   }
   await navigate({to:'/workspace/$id',params:{id:workspace.current},search:{templateKind:kind,...(editing?{templateEdit:{accountId:editing.accountId,projectId:editing.projectId,reference:editing.reference,autoOpen:true}}:{})}})
  }catch{if(active.current){setError('Не удалось открыть редактор. Повторите открытие.');starting.current=false;setBusy(false)}}
 }
 const editorControls=<>
   {formats===null&&!error&&<p role="status" className="mb-3 text-[13px] text-kumo-subtle">Загрузка редактора…</p>}
   {formats?.length===0&&<p role="status" className="mb-3 text-[13px] text-kumo-subtle">Редактор документа недоступен. Для создания шаблона нужен настроенный нативный редактор.</p>}
   {formats&&formats.length>1&&<label className="mb-3 block text-[13px]">Редактор<select aria-label="Редактор нового шаблона" value={formatId} disabled={busy||!!editor.current} onChange={event=>setFormatId(event.target.value)} className="mt-1 block w-full rounded-lg border border-kumo-line bg-kumo-base px-3 py-2"><option value="">Выберите редактор</option>{formats.map(item=><option key={item.blueprintId} value={item.blueprintId}>{item.description||item.blueprintId}</option>)}</select></label>}
   {error&&<p role="alert" className="mb-3 text-[13px] text-kumo-danger">{error}</p>}
   {formats===null&&error&&<WorkshopButton onClick={()=>setReload(value=>value+1)}>Повторить загрузку</WorkshopButton>}

 </>
 const editorActions=<>
   <div className="mt-4 flex justify-end gap-2"><WorkshopButton disabled={busy} onClick={()=>setOpen(false)}>Отмена</WorkshopButton><WorkshopButton tone="primary" disabled={busy||!formatId||formats===null} onClick={()=>void create()}>{busy?'Открываем…':'Открыть редактор'}</WorkshopButton></div>
 </>
 if(editing)return <div className="contents">{!open?<WorkshopButton onClick={()=>setOpen(true)}>{improving?'Предложить улучшение':'Редактировать'}</WorkshopButton>:<section aria-label="Открыть шаблон в редакторе" className="order-last basis-full pt-2"><p className="mb-3 text-[13px] leading-5 text-kumo-subtle">{improving?'Откроется личная копия. Сохраните изменения и объясните их перед отправкой на согласование. Общий шаблон изменится только после согласования.':'Изменения будут сохранены следующей версией этого личного шаблона.'}</p>{editorControls}{editorActions}</section>}</div>
 return <><WorkshopButton onClick={()=>setOpen(true)}>{editing?'Редактировать':'Создать шаблон'}</WorkshopButton>
  <Dialog.Root open={open} onOpenChange={value=>{if(!busy)setOpen(value)}}><Dialog size="base" className="!w-[min(480px,calc(100vw-24px))] bg-kumo-base !p-5">
   <Dialog.Title className="text-[18px] font-medium">{editing?'Редактировать шаблон':'Создать шаблон'}</Dialog.Title>
   <Dialog.Description className="mt-1 text-[13px] leading-5 text-kumo-subtle">{editing?'Откройте выбранную версию в отдельном редакторе. Сохранение создаст следующую версию того же личного шаблона.':'Напишите материал в редакторе документа, затем сохраните личную версию. Отправить её команде можно отдельно.'}</Dialog.Description>
   {!editing&&<fieldset disabled={busy} className="my-5 space-y-2 border-0 p-0"><legend className="sr-only">Вид нового шаблона</legend>{Object.entries(kinds).map(([value,item])=><label key={value} className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2 hover:bg-kumo-tint"><input type="radio" name="template-kind" value={value} checked={kind===value} onChange={()=>setKind(value as WorkTemplateKind)} className="mt-1 accent-kumo-brand"/><span><span className="block text-sm font-medium">{item.title}</span><span className="mt-1 block text-[13px] text-kumo-subtle">{item.description}</span></span></label>)}</fieldset>}
   {editorControls}
   {editorActions}
  </Dialog></Dialog.Root>
 </>
}
