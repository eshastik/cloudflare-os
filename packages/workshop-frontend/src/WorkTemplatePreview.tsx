import {useEffect,useState} from 'react'
import {Dialog} from '@cloudflare/kumo'
import DOMPurify from 'dompurify'
import {checkedTemplateReferences,type ChatWorkTemplate,type ChatWorkTemplateChoice} from '@gadgets/workshop-shared/work-template'
import type {NativeDocumentSnapshot} from '@gadgets/workshop-shared/native-document'
import {useAuthenticatedApi} from './AuthContext'
import {openBlueprintTemplatesFrame} from './accountCapabilities'
import {disposeGatekeeperFrame} from './disposeGatekeeperFrame'
import {downloadGatekeeperNativeDocument,downloadGatekeeperWorkTemplateText} from './gatekeeperAppDownload'
import {WorkshopButton} from './components/WorkshopControls'

type State={status:'loading'}|{status:'error'}|{status:'ready';material:ChatWorkTemplateChoice;content:string|NativeDocumentSnapshot}
const kinds={document:'Форма документа',guidance:'Методика',agent_instructions:'Инструкция агента',skill:'Навык'}

export default function WorkTemplatePreview({item,selected,atLimit,onToggle,onBack,onClose}:{item:ChatWorkTemplate;selected:boolean;atLimit:boolean;onToggle(item:ChatWorkTemplate):void;onBack():void;onClose():void}){
 const {authenticatedApi}=useAuthenticatedApi(),[state,setState]=useState<State>({status:'loading'}),[reload,setReload]=useState(0)
 const key=JSON.stringify([item.accountId,item.reference])
 useEffect(()=>{
  const abort=new AbortController();setState({status:'loading'})
  void (async()=>{
   let frame:Awaited<ReturnType<typeof openBlueprintTemplatesFrame>>|null=null
   try{
    frame=await openBlueprintTemplatesFrame(authenticatedApi,item.accountId);abort.signal.throwIfAborted()
    const selector=frame.blueprintTemplates.selector,preview=await selector.preview(item.reference);abort.signal.throwIfAborted()
    if(JSON.stringify(checkedTemplateReferences([preview.material.reference])[0])!==JSON.stringify(checkedTemplateReferences([item.reference])[0])||!Number.isSafeInteger(preview.ticket.size_bytes)||preview.ticket.size_bytes<0||preview.ticket.size_bytes>1024*1024)throw Error('Снимок не подтверждён')
    const validate=()=>selector.validatePreview(item.reference,preview.sourceHead)
    let content:string|NativeDocumentSnapshot
    if(preview.ticket.content_type==='application/vnd.cloudflareos.document+json'){
     content=await downloadGatekeeperNativeDocument(frame.blueprintTemplates.storageOrigin,preview.ticket,'cloudflareos.document',abort.signal,validate)
     if(typeof content.document.title!=='string'||!Array.isArray(content.document.blocks)||content.document.blocks.some(block=>!block||typeof block.html!=='string'))throw Error('Форма повреждена')
    }else if(['text/plain','text/markdown'].includes(preview.ticket.content_type))content=await downloadGatekeeperWorkTemplateText(frame.blueprintTemplates.storageOrigin,preview.ticket,abort.signal,validate)
    else throw Error('Формат не поддержан')
    abort.signal.throwIfAborted();setState({status:'ready',material:preview.material,content})
   }catch{if(!abort.signal.aborted)setState({status:'error'})}
   finally{disposeGatekeeperFrame(frame)}
  })()
  return()=>abort.abort()
 },[authenticatedApi,key,reload])
 return <Dialog.Root open onOpenChange={open=>{if(!open)onClose()}}><Dialog size="base" className="!z-[1200] !flex !max-h-[calc(100dvh-24px)] !w-[min(600px,calc(100vw-24px))] !flex-col overflow-hidden bg-kumo-base !p-0">
  <div className="shrink-0 border-b border-kumo-line px-5 py-4"><Dialog.Title className="text-[17px] font-medium">{state.status==='ready'?state.material.title:item.title}</Dialog.Title><Dialog.Description className="mt-1 text-[13px] text-kumo-subtle">{kinds[state.status==='ready'?state.material.kind:item.kind]} · версия {item.reference.revision}. Просмотр не применяет материал к задаче.</Dialog.Description></div>
  <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4" aria-label="Содержимое шаблона" aria-busy={state.status==='loading'}>
   {state.status==='loading'&&<p role="status">Загрузка выбранной версии…</p>}
   {state.status==='error'&&<div className="space-y-3"><p role="alert">Содержимое недоступно. Проверьте доступ и подключение. Просмотр поддерживает текст и нативную форму документа размером до 1 МиБ.</p><WorkshopButton onClick={()=>setReload(v=>v+1)}>Повторить просмотр</WorkshopButton></div>}
   {state.status==='ready'&&<>{state.material.purpose&&<p className="mb-4 text-[13px] text-kumo-subtle">{state.material.purpose}</p>}{typeof state.content==='string'?<pre className="whitespace-pre-wrap break-words font-sans text-[14px] leading-6">{state.content}</pre>:<div className="space-y-3 text-[14px] leading-6"><h2 className="text-[18px] font-medium">{String(state.content.document.title)}</h2>{(state.content.document.blocks as {html:string}[]).map((block,index)=><div key={index} className="break-words [&_h1]:text-xl [&_h2]:text-lg [&_h3]:font-medium [&_table]:w-full [&_td]:border [&_td]:border-kumo-line [&_td]:p-2 [&_th]:border [&_th]:border-kumo-line [&_th]:p-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5" dangerouslySetInnerHTML={{__html:DOMPurify.sanitize(block.html,{ALLOWED_TAGS:['p','div','span','h1','h2','h3','h4','h5','h6','ul','ol','li','strong','em','b','i','u','s','blockquote','table','tr','thead','tbody','td','th','br','hr','pre','code'],ALLOWED_ATTR:['colspan','rowspan']})}}/>)}</div>}</>}
  </div>
  <div className="flex shrink-0 flex-wrap justify-between gap-2 border-t border-kumo-line px-5 py-4"><WorkshopButton onClick={onBack}>Назад к выбору</WorkshopButton><WorkshopButton tone="primary" disabled={state.status!=='ready'||!selected&&atLimit} onClick={()=>{if(state.status==='ready')onToggle({...item,...state.material})}}>{selected?'Убрать из задачи':'Выбрать для задачи'}</WorkshopButton></div>
 </Dialog></Dialog.Root>
}
