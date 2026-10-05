import {useEffect,useState} from 'react'
import type {WorkTemplateReference} from '@gadgets/workshop-shared/work-template'
import {useAuthenticatedApi} from './AuthContext'
import {readWorkTemplatePreview,type TemplatePreviewMaterial} from './readWorkTemplatePreview'
import {diffWords,type Piece} from './versionDiff'
import {templatePreviewText} from './templatePreviewContent'
import {WorkshopButton} from './components/WorkshopControls'

function Pieces({pieces}:{pieces:Piece[]}){return <>{pieces.map((piece,index)=>piece.op==='del'?<del key={index} className="bg-red-50 text-red-900">{piece.text}</del>:piece.op==='add'?<ins key={index} className="bg-green-50 text-green-900 no-underline">{piece.text}</ins>:<span key={index}>{piece.text}</span>)}</>}

export default function WorkTemplateComparison({accountId,reference}:{accountId:number;reference:WorkTemplateReference}){
 const {authenticatedApi}=useAuthenticatedApi()
 const [state,setState]=useState<{pair:[TemplatePreviewMaterial,TemplatePreviewMaterial]}|{error:true}|null>(null),[reload,setReload]=useState(0)
 const key=JSON.stringify(reference)
 useEffect(()=>{
  const abort=new AbortController();setState(null)
  void Promise.all([readWorkTemplatePreview(authenticatedApi,accountId,{...reference,revision:reference.revision-1},abort.signal),readWorkTemplatePreview(authenticatedApi,accountId,reference,abort.signal)]).then(pair=>{if(!abort.signal.aborted)setState({pair})},()=>{if(!abort.signal.aborted){setState({error:true});abort.abort()}})
  return()=>abort.abort()
 },[authenticatedApi,accountId,key,reload])
 if(!state)return <p role="status" className="text-[13px] text-kumo-subtle">Читаем обе версии для сравнения…</p>
 if('error' in state)return <div><p role="alert" className="mb-3 text-[13px]">Сравнение недоступно. Не удалось подтвердить доступ и содержимое обеих версий.</p><WorkshopButton onClick={()=>setReload(value=>value+1)}>Повторить сравнение</WorkshopButton></div>
 const [before,after]=state.pair
 const native=typeof before.content!=='string'&&typeof after.content!=='string'
 const beforeText=typeof before.content==='string'?before.content:templatePreviewText(before.content)
 const afterText=typeof after.content==='string'?after.content:templatePreviewText(after.content)
 const textPieces=diffWords(beforeText,afterText)
 const titles:[string,string]=[typeof before.content==='string'?'':String(before.content.document.title),typeof after.content==='string'?'':String(after.content.document.title)]
 const sameText=textPieces.every(piece=>piece.op==='same')&&titles[0]===titles[1]
 const metadata=(['title','purpose','kind'] as const).filter(field=>before.material[field]!==after.material[field])
 const labels={title:'Название шаблона',purpose:'Назначение',kind:'Вид шаблона'}
 return <section aria-label="Сравнение версий шаблона" className="space-y-4 text-[14px] leading-6">
  <div><h2 className="text-[16px] font-medium">Версия {reference.revision-1} → версия {reference.revision}</h2><p className="mt-1 text-[12px] text-kumo-subtle">Добавления выделены цветом, удаления зачёркнуты.{native?' Сравнение показывает текст; оформление и структуру проверяйте в содержимом версий.':''}</p></div>
  {metadata.map(field=><div key={field}><h3 className="mb-1 text-[12px] font-medium text-kumo-subtle">{labels[field]}</h3><Pieces pieces={diffWords(before.material[field],after.material[field])}/></div>)}
  {sameText&&<p className="text-kumo-subtle">Текст содержимого не изменился.</p>}
  {titles[0]!==titles[1]&&<p><Pieces pieces={diffWords(titles[0],titles[1])}/></p>}
  {!sameText&&<p className="whitespace-pre-wrap break-words"><Pieces pieces={textPieces}/></p>}
 </section>
}
