import {useEffect,useRef,useState} from 'react'
import type {ChatWorkTemplate} from '@gadgets/workshop-shared/work-template'
import {useAuthenticatedApi} from './AuthContext'
import {openBlueprintTemplatesFrame} from './accountCapabilities'
import {disposeGatekeeperFrame} from './disposeGatekeeperFrame'
import {WorkshopButton} from './components/WorkshopControls'

type Target={scope_id:string;revision:number;name:string;level:'department'|'organization'}
export default function WorkTemplatePromotion({item,target}:{item:ChatWorkTemplate;target:Target}){
 const {authenticatedApi}=useAuthenticatedApi(),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[sent,setSent]=useState(false),[pending,setPending]=useState<{id:string;reason:string}|null>(null)
 const owner=useRef(new AbortController()),running=useRef<symbol|null>(null)
 const key='mnemos-work-template-promotion:'+JSON.stringify([item.accountId,item.reference,target.scope_id,target.revision])
 useEffect(()=>{owner.current=new AbortController();running.current=null;setReason('');setPending(null);setSent(false);setError('');setBusy(false);try{const saved=JSON.parse(sessionStorage.getItem(key)||'null');if(saved&&typeof saved.id==='string'&&typeof saved.reason==='string'){setPending(saved);setReason(saved.reason)}}catch{}return()=>owner.current.abort()},[key])
 async function send(){
  if(running.current||!reason.trim()||!item.reference.scope_id)return
  const attempt=Symbol(),lifetime=owner.current;running.current=attempt;setBusy(true);setError('')
  const signal=AbortSignal.any([lifetime.signal,AbortSignal.timeout(20000)])
  const wait=<T,>(operation:PromiseLike<T>,late?:(value:T)=>void)=>new Promise<T>((resolve,reject)=>{const cancelled=()=>reject(signal.reason);signal.addEventListener('abort',cancelled,{once:true});void Promise.resolve(operation).then(value=>{signal.removeEventListener('abort',cancelled);if(signal.aborted){late?.(value);reject(signal.reason)}else resolve(value)},error=>{signal.removeEventListener('abort',cancelled);reject(error)});if(signal.aborted)cancelled()})
  let frame:Awaited<ReturnType<typeof openBlueprintTemplatesFrame>>|null=null
  try{
   const operation=pending??{id:crypto.randomUUID(),reason:reason.trim()}
   if(!pending){sessionStorage.setItem(key,JSON.stringify(operation));setPending(operation)}
   frame=await wait(openBlueprintTemplatesFrame(authenticatedApi,item.accountId),disposeGatekeeperFrame);signal.throwIfAborted()
   const result=await wait(frame.blueprintTemplates.selector.promote(item.reference.scope_id,item.reference.template_key!,item.reference.revision,operation.reason,operation.id,{scope_id:target.scope_id,revision:target.revision}));signal.throwIfAborted()
   if(result.proposal.target_scope_id!==target.scope_id)throw Error('Уровень назначения не подтверждён')
   sessionStorage.removeItem(key);setSent(true)
  }catch{if(!lifetime.signal.aborted)setError('Отправка не подтверждена. Повтор продолжит то же предложение. Если правила области изменились, проверьте состояние во «Входящих».')}
  finally{disposeGatekeeperFrame(frame);if(running.current===attempt){running.current=null;if(!lifetime.signal.aborted)setBusy(false)}}
 }
 return <details className="shrink-0 border-t border-kumo-line px-5 py-3">
  <summary className="cursor-pointer text-[13px] text-kumo-subtle">{target.level==='department'?'Предложить отделу':'Предложить организации'}</summary>
  <div className="mt-3 space-y-3 text-[13px] leading-5">
   <p className="m-0">Следующий уровень: {target.name}. Версия {item.reference.revision} станет доступна там после отдельного согласования.</p>
   {sent?<p role="status" className="m-0">Предложение отправлено. Исходная версия сохранена. Решение появится во «Входящих».</p>:<>
    <label className="block">Почему материал нужен на следующем уровне<textarea aria-label="Причина общего применения" rows={2} maxLength={4096} disabled={busy||!!pending} value={reason} onChange={event=>setReason(event.target.value)} className="mt-1 block w-full rounded-lg border border-kumo-line bg-kumo-base px-3 py-2"/></label>
    {error&&<p role="alert" className="m-0 text-kumo-danger">{error}</p>}
    <WorkshopButton tone="primary" disabled={busy||!reason.trim()} onClick={()=>void send()}>{busy?'Отправляем…':pending?'Повторить отправку':'Отправить на согласование'}</WorkshopButton>
   </>}
  </div>
 </details>
}
