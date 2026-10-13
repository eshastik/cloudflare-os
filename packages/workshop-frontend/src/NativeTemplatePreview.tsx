import type {NativeDocumentSnapshot} from '@gadgets/workshop-shared/native-document'
import {templatePreviewHtml} from './templatePreviewContent'

const record=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{}
const text=(value:unknown)=>typeof value==='string'?value:''

export function checkNativeTemplate(snapshot:NativeDocumentSnapshot):void{
 const data=snapshot.document
 if(typeof data.title!=='string'&&snapshot.format!=='cloudflareos.presentation')throw Error('Повреждено название шаблона')
 if(snapshot.format==='cloudflareos.document'){
  if(!Array.isArray(data.blocks)||data.blocks.some(block=>typeof record(block).html!=='string'))throw Error('Повреждена форма документа')
 }else if(snapshot.format==='cloudflareos.spreadsheet'){
  const sheets=record(data.sheets),cells=record(data.cells)
  if(!Array.isArray(data.sheetOrder)||!data.sheetOrder.length||data.sheetOrder.some(id=>typeof id!=='string'||!Object.hasOwn(sheets,id)||!Object.hasOwn(cells,id)||Object.values(record(cells[id])).some(cell=>typeof record(cell).value!=='string')))throw Error('Повреждена форма таблицы')
 }else if(data.themeVersion!=='workspace.1'||!Array.isArray(data.slides)||!data.slides.length||data.slides.some(slide=>!Array.isArray(record(slide).blocks)))throw Error('Повреждена форма презентации')
}

/** Предпросмотр читает данные; полное оформление и вычисления открываются в редакторе. */
export default function NativeTemplatePreview({snapshot}:{snapshot:NativeDocumentSnapshot}){
 const data=snapshot.document
 if(snapshot.format==='cloudflareos.document')return <div className="space-y-3 text-[14px] leading-6"><h2 className="text-[18px] font-medium">{String(data.title)}</h2>{(data.blocks as {html:string}[]).map((block,index)=><div key={index} className="break-words [&_h1]:text-xl [&_h2]:text-lg [&_h3]:font-medium [&_table]:w-full [&_td]:border [&_td]:border-kumo-line [&_td]:p-2 [&_th]:border [&_th]:border-kumo-line [&_th]:p-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5" dangerouslySetInnerHTML={{__html:templatePreviewHtml(block.html)}}/>)}</div>
 if(snapshot.format==='cloudflareos.spreadsheet'){
  const order=data.sheetOrder as string[],sheets=record(data.sheets),cells=record(data.cells)
  return <div className="space-y-4 text-[14px] leading-6"><p className="text-[13px] text-kumo-subtle">Предпросмотр значений и формул. Полная таблица с оформлением откроется в редакторе.</p>{order.slice(0,10).map(id=>{
   const entries=Object.entries(record(cells[id])).filter(([,cell])=>text(record(cell).value)).toSorted(([a],[b])=>a.localeCompare(b,undefined,{numeric:true}))
   return <section key={id}><h2 className="mb-2 font-medium">{text(record(sheets[id]).name)||'Лист'}</h2>{entries.length?<table className="w-full table-fixed text-left text-[13px]"><thead><tr><th className="w-20 border-b border-kumo-line py-1">Ячейка</th><th className="border-b border-kumo-line py-1">Значение или формула</th></tr></thead><tbody>{entries.slice(0,20).map(([ref,cell])=><tr key={ref}><td className="border-b border-kumo-line py-1 align-top">{ref}</td><td className="break-words border-b border-kumo-line py-1">{text(record(cell).value)}</td></tr>)}</tbody></table>:<p className="text-kumo-subtle">Пустой лист.</p>}{entries.length>20&&<p className="mt-2 text-[12px] text-kumo-subtle">Ещё {entries.length-20} заполненных ячеек в редакторе.</p>}</section>
  })}{order.length>10&&<p className="text-kumo-subtle">Ещё {order.length-10} листов в редакторе.</p>}</div>
 }
 const slides=data.slides as unknown[]
 return <div className="space-y-4 text-[14px] leading-6"><p className="text-[13px] text-kumo-subtle">Предпросмотр текста слайдов. Полное оформление и изображения откроются в редакторе.</p>{slides.slice(0,10).map((slide,index)=>{const blocks=record(slide).blocks as unknown[];return <section key={index} className="rounded-xl border border-kumo-line p-3"><h2 className="mb-2 text-[12px] font-medium text-kumo-subtle">Слайд {index+1}</h2>{blocks.slice(0,50).map((block,n)=>{const props=record(record(block).props);const lines=['eyebrow','title','text','body','label','alt'].map(key=>text(props[key])).filter(Boolean);return lines.length?<p key={n} className="whitespace-pre-wrap break-words">{lines.join('\n')}</p>:null})}</section>})}{slides.length>10&&<p className="text-kumo-subtle">Ещё {slides.length-10} слайдов в редакторе.</p>}</div>
}
