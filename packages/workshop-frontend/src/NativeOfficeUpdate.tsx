import {useEffect,useRef,useState} from 'react'
import type {RpcStub} from 'capnweb'
import type {GatekeeperNativeDocumentWriteSelector,GatekeeperOfficeUpdateSummary} from '@gadgets/workshop-shared/gatekeeper'
import type {NativeDocumentFormat} from '@gadgets/workshop-shared/native-document'
import {downloadGatekeeperOfficePreview} from './gatekeeperAppDownload'
import {uploadGatekeeperOfficePreview} from './gatekeeperAppUpload'
import {WorkshopButton} from './components/WorkshopControls'

type Selector=Pick<RpcStub<GatekeeperNativeDocumentWriteSelector>,'documents'|'reviewOfficeUpdate'|'resumeOfficeUpdate'>
type Choice=Awaited<ReturnType<Selector['documents']>>['documents'][number]
type Review=Awaited<ReturnType<Selector['reviewOfficeUpdate']>>
type Writer=Awaited<ReturnType<Selector['resumeOfficeUpdate']>>
function retained(key:string):{target:string;receipt:string}|null{
 try{const text=sessionStorage.getItem(key);if(!text||text.length>10000)return null;const value=JSON.parse(text);return typeof value.target==='string'&&value.target.length>0&&value.target.length<=255&&typeof value.receipt==='string'&&value.receipt.length<=8192&&/^[A-Za-z0-9_-]+$/.test(value.receipt)?value:null}catch{return null}
}

/** Minimal review and recoverable update of an existing native copy. */
export default function NativeOfficeUpdate({selector,storageOrigin,scope,source,format,receiptKey,onBusy}:{selector:Selector;storageOrigin:string;scope:string;source:{node:string;head:string;sha256:string};format:NativeDocumentFormat;receiptKey:string;onBusy(busy:boolean):void}){
 const [saved,setSaved]=useState(()=>retained(receiptKey)),[target,setTarget]=useState(()=>retained(receiptKey)?.target||'')
 const [choices,setChoices]=useState<Choice[]>([]),[cursor,setCursor]=useState(''),[listed,setListed]=useState(false),[truncated,setTruncated]=useState(false)
 const [summary,setSummary]=useState<GatekeeperOfficeUpdateSummary|null>(null),[text,setText]=useState(''),[snippet,setSnippet]=useState('')
 const [accept,setAccept]=useState(false),[replace,setReplace]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[done,setDone]=useState(false)
 const working=useRef(false)
 const review=useRef<Review|null>(null),writer=useRef<{cap:Writer;head:string;upload:string}|null>(null),lifetime=useRef(new AbortController())
 useEffect(()=>{const abort=new AbortController();lifetime.current=abort;return()=>{abort.abort();review.current?.[Symbol.dispose]();writer.current?.cap[Symbol.dispose]()}},[])
 function progress(value:boolean){setBusy(value);onBusy(value)}
 async function run(action:(signal:AbortSignal)=>Promise<void>){const signal=lifetime.current.signal;if(working.current||signal.aborted)return;working.current=true;progress(true);setError('');try{await action(signal)}catch{if(!signal.aborted)setError('Операция не подтверждена. Проверьте доступ и выбранную версию. Если заявка сохранена, повторите её; последующие правки документа не будут перезаписаны повтором.')}finally{working.current=false;if(!signal.aborted)progress(false)}}
 async function list(signal:AbortSignal){const page=await selector.documents(scope,cursor);signal.throwIfAborted();setChoices(old=>[...new Map([...old,...page.documents].filter(d=>d.id!==source.node&&!d.sharedDeleted).map(d=>[d.id,d])).values()]);setCursor(page.nextCursor);setListed(true);setTruncated(page.truncated)}
 async function compare(signal:AbortSignal){
  const cap=await selector.reviewOfficeUpdate(scope,target,source.node,format,source.head,source.sha256)
  try{
   signal.throwIfAborted();const info=await cap.describe();using download=await cap.preview();
   const body=await downloadGatekeeperOfficePreview(storageOrigin,await download.issue(),format,signal,()=>download.validate());signal.throwIfAborted()
   const snapshot=JSON.parse(body);let rendered=''
   if(format==='cloudflareos.document')rendered=snapshot.document.blocks.slice(0,20).map((block:{html:string})=>new DOMParser().parseFromString(block.html,'text/html').body.textContent||'').join('\n')
   else if(format==='cloudflareos.presentation')rendered=snapshot.document.slides.slice(0,20).map((slide:{blocks:{props:{text?:string}}[]},index:number)=>`Слайд ${index+1}\n${slide.blocks.map(block=>block.props.text||'').filter(Boolean).join('\n')}`).join('\n\n')
   else rendered=snapshot.document.sheetOrder.map((id:string)=>`${snapshot.document.sheets[id].name}\n${Object.entries(snapshot.document.cells[id]||{}).slice(0,20).map(([address,cell])=>`${address}: ${(cell as {value:string}).value}`).join('\n')}`).join('\n\n')
   review.current?.[Symbol.dispose]();review.current=cap;setSummary(info);setText(body);setSnippet(rendered)
  }catch(error){cap[Symbol.dispose]();throw error}
 }
 async function apply(signal:AbortSignal){
  if(!saved&&(!summary||!review.current||!['update_available','conflict'].includes(summary.outcome)||(summary.unsupported.length>0&&!accept)||(summary.outcome==='conflict'&&!replace)))return
  if(!writer.current){
   const cap=saved?await selector.resumeOfficeUpdate(saved.receipt,format):await review.current!.prepare(accept,replace)
   try{signal.throwIfAborted();const state=await cap.recoveryState();signal.throwIfAborted();writer.current={cap,head:state.head,upload:state.uploadId}}catch(error){cap[Symbol.dispose]();throw error}
  }
  const held=writer.current
  if(!held.upload)held.upload=await uploadGatekeeperOfficePreview(text,storageOrigin,(size,checksum)=>held.cap.issue(held.head,size,checksum),signal)
  signal.throwIfAborted();const receipt=await held.cap.checkpoint(held.head,held.upload);signal.throwIfAborted()
  const checkpoint={target,receipt};sessionStorage.setItem(receiptKey,JSON.stringify(checkpoint));setSaved(checkpoint)
  await held.cap.save(held.head,held.upload);signal.throwIfAborted();setDone(true)
 }
 if(done)return <p role="status">Обновление подтверждено. История документа сохранена.</p>
 const pending=!!saved,canApply=pending||!!summary&&['update_available','conflict'].includes(summary.outcome)
 return <div className="my-3 border rounded p-3">
  <p>Обновить существующую нативную копию из выбранного файла.</p>
  {!pending&&!summary&&<>
   <WorkshopButton disabled={busy||(listed&&!cursor)} onClick={()=>{void run(list)}}>{listed?'Ещё документы':'Выбрать копию'}</WorkshopButton>
   {truncated&&<p>Показана часть документов.</p>}
   {listed&&<label>Документ <select aria-label="Документ для обновления" value={target} disabled={busy} onChange={e=>setTarget(e.target.value)}><option value="">Выберите ранее импортированную копию</option>{choices.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label>}
   <WorkshopButton disabled={busy||!target} onClick={()=>{void run(compare)}}>Сравнить обновление</WorkshopButton>
  </>}
  {summary&&<>
   <p>{summary.outcome==='source_unchanged'?'Источник не изменился. Правки копии сохранятся.':summary.outcome==='already_current'?'Копия уже содержит это содержимое.':summary.outcome==='conflict'?'Изменились и источник, и копия. Для замены нужно отдельное подтверждение.':'Новая версия источника готова к обновлению копии.'}</p>
   <p>Начало входящего документа:</p><pre className="max-h-48 overflow-auto whitespace-pre-wrap">{snippet}</pre>
   {summary.unsupported.length>0&&<><p>Не будут перенесены:</p><ul>{summary.unsupported.map((item,i)=><li key={i}>{item}</li>)}</ul><label><input type="checkbox" disabled={busy||pending} checked={accept} onChange={e=>setAccept(e.target.checked)}/> Принять указанные потери</label></>}
   {summary.outcome==='conflict'&&<label><input type="checkbox" disabled={busy||pending} checked={replace} onChange={e=>setReplace(e.target.checked)}/> Заменить текущие правки содержимым источника; прежняя версия останется в истории</label>}
   {!pending&&<WorkshopButton disabled={busy} onClick={()=>{review.current?.[Symbol.dispose]();review.current=null;setSummary(null);setText('');setAccept(false);setReplace(false)}}>Изменить выбор</WorkshopButton>}
  </>}
  {canApply&&<WorkshopButton disabled={busy||(!pending&&((!!summary?.unsupported.length&&!accept)||(summary?.outcome==='conflict'&&!replace)))} onClick={()=>{void run(apply)}}>{pending?'Повторить обновление':'Применить обновление'}</WorkshopButton>}
  {busy&&<p role="status">Обновление…</p>}{error&&<p role="alert">{error}</p>}
 </div>
}
