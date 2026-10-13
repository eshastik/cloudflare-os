import {useState} from 'react'
import {nativeTemplatePreview} from '@gadgets/workshop-shared/native-template-preview'
import type {NativeDocumentSnapshot} from '@gadgets/workshop-shared/native-document'
import {templatePreviewHtml} from './templatePreviewContent'

const record=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{}

export function checkNativeTemplate(snapshot:NativeDocumentSnapshot):void{
 const data=snapshot.document
 if(typeof data.title!=='string'&&snapshot.format!=='cloudflareos.presentation')throw Error('Повреждено название шаблона')
 if(snapshot.format==='cloudflareos.document'){
  if(!Array.isArray(data.blocks)||data.blocks.some(block=>typeof record(block).html!=='string'))throw Error('Повреждена форма документа')
 }else nativeTemplatePreview(snapshot)
}

/** Предпросмотр читает данные; полное оформление и вычисления открываются в редакторе. */
export default function NativeTemplatePreview({snapshot}:{snapshot:NativeDocumentSnapshot}){
 const data=snapshot.document
 if(snapshot.format==='cloudflareos.document')return <div className="space-y-3 text-[14px] leading-6"><h2 className="text-[18px] font-medium">{String(data.title)}</h2>{(data.blocks as {html:string}[]).map((block,index)=><div key={index} className="break-words [&_h1]:text-xl [&_h2]:text-lg [&_h3]:font-medium [&_table]:w-full [&_td]:border [&_td]:border-kumo-line [&_td]:p-2 [&_th]:border [&_th]:border-kumo-line [&_th]:p-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5" dangerouslySetInnerHTML={{__html:templatePreviewHtml(block.html)}}/>)}</div>
 return <StructuredTemplatePreview snapshot={snapshot}/>
}
function StructuredTemplatePreview({snapshot}:{snapshot:NativeDocumentSnapshot}){
 const [index,setIndex]=useState(0),[sheet,setSheet]=useState('');
 const order=Array.isArray(snapshot.document.sheetOrder)?snapshot.document.sheetOrder as string[]:[];
 const view=nativeTemplatePreview(snapshot,snapshot.format==='cloudflareos.presentation'?{slide:index}:{sheet:sheet||order[0]});
 const count=view.labels.length;
 return <div className="space-y-3">
  <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-[13px] font-medium">{view.format==='presentation'?'Слайд '+(index+1)+' из '+count:'Листы · '+count}</span>{view.format==='presentation'?<div className="flex gap-2"><button className="rounded-lg border border-kumo-line px-3 py-1.5 disabled:opacity-40" aria-label="Предыдущий слайд" disabled={!index} onClick={()=>setIndex(v=>v-1)}>←</button><button className="rounded-lg border border-kumo-line px-3 py-1.5 disabled:opacity-40" aria-label="Следующий слайд" disabled={index>=count-1} onClick={()=>setIndex(v=>v+1)}>→</button></div>:<select className="rounded-lg border border-kumo-line bg-kumo-base px-3 py-1.5 text-[13px]" aria-label="Лист шаблона" value={sheet||order[0]} onChange={e=>setSheet(e.target.value)}>{view.labels.map((label,i)=><option key={order[i]} value={order[i]}>{label}</option>)}</select>}</div>
  <iframe title={view.format==='presentation'?'Предпросмотр слайда':'Предпросмотр таблицы'} sandbox="" srcDoc={view.html} className="block w-full rounded-xl border border-kumo-line bg-white" style={view.format==='presentation'?{aspectRatio:'16 / 9',height:'auto'}:{height:340}}/>
  {view.format==='presentation'&&<div className="flex flex-wrap gap-2" role="group" aria-label="Слайды шаблона">{view.labels.map((label,i)=><button key={i} type="button" aria-pressed={i===index} onClick={()=>setIndex(i)} className={'rounded-lg border px-3 py-2 text-[12px] '+(i===index?'border-kumo-brand bg-kumo-tint text-kumo-brand':'border-kumo-line text-kumo-subtle')}>{label}</button>)}</div>}
  <p className="text-[12px] text-kumo-subtle">{view.format==='presentation'?'Макет и текст слайдов. Внешние изображения не загружаются.':'Сохранённые значения и формулы. Пересчёт доступен в редакторе.'}</p>
  <details><summary className="cursor-pointer text-[13px] text-kumo-subtle">{view.format==='presentation'?'Текст всех слайдов':'Значения и формулы'}</summary><pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-kumo-tint p-3 font-sans text-[13px]">{view.text}</pre></details>
 </div>
}
