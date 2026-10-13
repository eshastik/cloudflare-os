import WorkTemplatePromotion from './WorkTemplatePromotion'
import CreateWorkTemplate from './CreateWorkTemplate'
import {useEffect,useState} from 'react'
import {Dialog} from '@cloudflare/kumo'
import NativeTemplatePreview from './NativeTemplatePreview'
import {type ChatWorkTemplate} from '@gadgets/workshop-shared/work-template'
import {useAuthenticatedApi} from './AuthContext'
import {readWorkTemplatePreview,TemplatePreviewUnavailable,type TemplatePreviewMaterial} from './readWorkTemplatePreview'
import WorkTemplateComparison from './WorkTemplateComparison'
import {WorkshopButton} from './components/WorkshopControls'

type State={status:'loading'}|{status:'error';reason?:'format'|'size'}|({status:'ready';key:string}&TemplatePreviewMaterial)
const kinds={document:'Форма документа',guidance:'Методика',agent_instructions:'Инструкция агента',skill:'Навык'}

export default function WorkTemplatePreview({item,selected,atLimit,onToggle,onBack,onClose,backLabel="Назад к выбору",editingProject,isSelected,readOnly=false}:{readOnly?:boolean;isSelected?(item:ChatWorkTemplate):boolean;editingProject?:{accountId:number;projectId:string};item:ChatWorkTemplate;selected:boolean;atLimit:boolean;onToggle(item:ChatWorkTemplate):void;onBack():void;onClose():void;backLabel?:string}){
 const {authenticatedApi}=useAuthenticatedApi(),[state,setState]=useState<State>({status:'loading'}),[reload,setReload]=useState(0)
 const [revision,setRevision]=useState(item.reference.revision),[history,setHistory]=useState(false),[comparison,setComparison]=useState(false)
 const reference={...item.reference,revision}
 const key=JSON.stringify([item.accountId,reference])
 const ready=state.status==='ready'&&state.key===key&&JSON.stringify(state.material.reference)===JSON.stringify(reference)
 const kind=ready&&state.status==='ready'?state.material.kind:item.kind
 const kindLabel=kind==='document'&&ready&&state.status==='ready'&&typeof state.content!=='string'&&state.content.format!=='cloudflareos.document'?state.content.format==='cloudflareos.spreadsheet'?'Форма таблицы':'Форма презентации':kinds[kind]
 const viewedSelected=isSelected?isSelected({...item,reference}):revision===item.reference.revision&&selected
 useEffect(()=>{
  const abort=new AbortController();setState({status:'loading'})
  void readWorkTemplatePreview(authenticatedApi,item.accountId,reference,abort.signal).then(value=>{if(!abort.signal.aborted)setState({status:'ready',key,...value})},error=>{if(!abort.signal.aborted)setState({status:'error',reason:error instanceof TemplatePreviewUnavailable?error.reason:undefined})})
  return()=>abort.abort()
 },[authenticatedApi,key,reload])
 return <Dialog.Root open onOpenChange={open=>{if(!open)onClose()}}><Dialog size="base" className="!z-[1200] !flex !max-h-[calc(100dvh-24px)] !w-[min(600px,calc(100vw-24px))] !flex-col overflow-hidden bg-kumo-base !p-0">
  <div className="shrink-0 border-b border-kumo-line px-5 py-4"><Dialog.Title className="text-[17px] font-medium">{ready&&state.status==='ready'?state.material.title:item.title}</Dialog.Title><Dialog.Description className="mt-1 text-[13px] text-kumo-subtle">{kindLabel} · версия {revision}. {readOnly?"Просмотр не меняет созданный документ.":"Просмотр не применяет материал к задаче."}</Dialog.Description></div>
  {item.reference.revision>1&&<div className="shrink-0 border-b border-kumo-line px-5 py-2"><WorkshopButton onClick={()=>{setHistory(value=>!value);setComparison(false)}} aria-expanded={history}>Версии</WorkshopButton>{history&&<div className="mt-2 flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><WorkshopButton disabled={revision<=1} onClick={()=>{setRevision(value=>value-1);setComparison(false)}}>Предыдущая</WorkshopButton><span className="text-[13px]">Версия {revision}</span><WorkshopButton disabled={revision>=item.reference.revision} onClick={()=>{setRevision(value=>value+1);setComparison(false)}}>Следующая</WorkshopButton></div><WorkshopButton disabled={!ready||revision<=1} onClick={()=>setComparison(value=>!value)} aria-pressed={comparison}>{comparison?'Содержимое':'Что изменилось'}</WorkshopButton></div>}</div>}
  <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4" aria-label="Содержимое шаблона" aria-busy={state.status==='loading'}>
   {state.status==='loading'&&<p role="status">Загрузка выбранной версии…</p>}
   {state.status==='error'&&<div className="space-y-3"><p role="alert">{state.reason==='format'?'Просмотр этого формата пока не поддерживается. Доступны текст, Markdown, документы, таблицы и презентации.':state.reason==='size'?'Шаблон превышает предел просмотра — 1 МиБ. Содержимое не загружено.':'Не удалось открыть содержимое. Проверьте доступ и подключение, затем повторите просмотр.'}</p>{!state.reason&&<WorkshopButton onClick={()=>setReload(v=>v+1)}>Повторить просмотр</WorkshopButton>}</div>}
   {comparison&&ready?<WorkTemplateComparison key={key} accountId={item.accountId} reference={reference}/>:ready&&state.status==='ready'&&<>{state.material.purpose&&<p className="mb-4 text-[13px] text-kumo-subtle">{state.material.purpose}</p>}{typeof state.content==='string'?<pre className="whitespace-pre-wrap break-words font-sans text-[14px] leading-6">{state.content}</pre>:<NativeTemplatePreview snapshot={state.content}/>}</>}
  </div>
  {!readOnly&&!comparison&&ready&&state.status==='ready'&&state.promotion&&<WorkTemplatePromotion key={key} item={{...item,...state.material}} target={state.promotion}/>}
  <div className="flex shrink-0 flex-wrap justify-between gap-2 border-t border-kumo-line px-5 py-4"><WorkshopButton onClick={onBack}>{backLabel}</WorkshopButton>{!comparison&&editingProject&&ready&&state.status==='ready'&&('template_id' in reference?!!state.sourceProjectId:!!state.improvement)&&<CreateWorkTemplate format={typeof state.content==='string'?'cloudflareos.document':state.content.format} textSource={typeof state.content==='string'} editing={{...editingProject,projectId:'template_id' in reference?state.sourceProjectId!:editingProject.projectId,reference,item:{...item,...state.material}}}/>}{!readOnly&&<WorkshopButton tone="primary" disabled={!ready||!viewedSelected&&atLimit} onClick={()=>{if(ready&&state.status==='ready')onToggle({...item,...state.material})}}>{viewedSelected?'Убрать из задачи':'Выбрать для задачи'}</WorkshopButton>}</div>
 </Dialog></Dialog.Root>
}
