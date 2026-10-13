import {useEffect,useRef,useState} from 'react'
import type {GatekeeperTemplateReviewAccess} from '@gadgets/workshop-shared/gatekeeper'
import type {ChatWorkTemplate} from '@gadgets/workshop-shared/work-template'
import {useAuthenticatedApi} from './AuthContext'
import {openBlueprintTemplatesFrame} from './accountCapabilities'
import {disposeGatekeeperFrame} from './disposeGatekeeperFrame'
import {WorkshopButton} from './components/WorkshopControls'

type Proposal=Awaited<ReturnType<Awaited<ReturnType<typeof openBlueprintTemplatesFrame>>['blueprintTemplates']['selector']['prepareSharing']>>
type Group={scope_id:string;revision:number;name:string}
export default function WorkTemplateSharing({item,onVisibilityChange}:{item:ChatWorkTemplate;onVisibilityChange?(open:boolean):void}){
 const {authenticatedApi}=useAuthenticatedApi(),[open,setOpen]=useState(false),[groups,setGroups]=useState<Group[]>([]),[group,setGroup]=useState(''),[reason,setReason]=useState(''),[plan,setPlan]=useState<GatekeeperTemplateReviewAccess|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[sent,setSent]=useState(false),[reload,setReload]=useState(0),[frozen,setFrozen]=useState(false)
 const operation=useRef<Proposal|null>(null),lifetime=useRef<AbortController|null>(null)
 const key='mnemos-template-sharing:'+JSON.stringify([item.accountId,item.reference])
 useEffect(()=>{
  if(!open)return
  const abort=new AbortController();lifetime.current=abort;setBusy(true);setError('');setPlan(null)
  let frame:Awaited<ReturnType<typeof openBlueprintTemplatesFrame>>|null=null
  void (async()=>{
   frame=await openBlueprintTemplatesFrame(authenticatedApi,item.accountId);if(abort.signal.aborted)return
   let saved:{id:string;reason?:string;group?:string;sent?:boolean}|null=null
   try{saved=JSON.parse(localStorage.getItem(key)||'null')}catch{}
   const id=saved?.id??crypto.randomUUID();if(!saved)localStorage.setItem(key,JSON.stringify({id}))
   const creator=await frame.blueprintTemplates.selector.prepareSharing(item.reference,id)
   if(abort.signal.aborted){creator[Symbol.dispose]();return}operation.current=creator
   const scopes:Group[]=[];let cursor=''
   do{const page=await frame.blueprintTemplates.selector.scopes(cursor);scopes.push(...page.scopes.filter(s=>s.enabled&&s.level==='group'));cursor=page.next_cursor||''}while(cursor)
   if(abort.signal.aborted)return
   setGroups(scopes);setSent(saved?.sent===true);if(!saved?.group&&scopes.length===1)setGroup(scopes[0].scope_id);if(saved?.reason!==undefined){setReason(saved.reason);setGroup(saved.group??'');setFrozen(true)}
  })().catch(()=>{if(!abort.signal.aborted)setError('Не удалось подготовить предложение. Проверьте доступ и повторите.')}).finally(()=>{if(abort.signal.aborted)disposeGatekeeperFrame(frame);else setBusy(false)})
  return()=>{abort.abort();operation.current?.[Symbol.dispose]();operation.current=null;disposeGatekeeperFrame(frame)}
 },[authenticatedApi,key,open,reload])
 useEffect(()=>{
  const current=operation.current,selected=groups.find(s=>s.scope_id===group),abort=new AbortController();setPlan(null)
  if(!current||!selected)return
  setBusy(true);setError('')
  void current.reviewAccess(selected.scope_id,selected.revision).then(value=>{if(!abort.signal.aborted)setPlan(value)},()=>{if(!abort.signal.aborted)setError('Не удалось проверить согласующих. Повторите проверку.')}).finally(()=>{if(!abort.signal.aborted)setBusy(false)})
  return()=>abort.abort()
 },[group,groups,reload])
 async function act(share:boolean){
  const current=operation.current,selected=groups.find(s=>s.scope_id===group),signal=lifetime.current?.signal
  if(!current||!selected||!plan||busy||!signal||signal.aborted)return
  setBusy(true);setError('')
  try{
   if(share){const next=await current.shareForReview(group,selected.revision,plan.key);if(!signal.aborted)setPlan(next)}
   else{
    if(!reason.trim()||plan.reviewers.some(p=>!p.canRead))return
    const saved=JSON.parse(localStorage.getItem(key)||'null');if(!saved?.id)throw Error('Нет операции')
    localStorage.setItem(key,JSON.stringify({...saved,reason:reason.trim(),group}));setFrozen(true)
    const result=await current.propose(group,selected.revision,reason.trim(),plan.key)
    if(result.target_scope_id!==group)throw Error('Другая область')
    localStorage.setItem(key,JSON.stringify({...saved,reason:reason.trim(),group,sent:true}));if(!signal.aborted)setSent(true)
   }
  }catch{if(!signal.aborted){setPlan(null);setError('Действие не подтверждено. Проверьте состояние и продолжите прежнее предложение.')}}finally{if(!signal.aborted)setBusy(false)}
 }
 return <section className={open?'min-h-0 flex-1 overflow-y-auto px-5 py-5':'shrink-0 border-t border-kumo-line px-5 py-3'} aria-label="Предложение общего шаблона">
  {!open?<WorkshopButton onClick={()=>{setOpen(true);onVisibilityChange?.(true)}}>Предложить команде</WorkshopButton>:<div className="space-y-3 text-[13px] leading-5">
   <div><WorkshopButton onClick={()=>{setOpen(false);onVisibilityChange?.(false)}}>Назад к шаблону</WorkshopButton><h3 className="mt-5 mb-0 text-[18px] font-medium">Предложить команде</h3><p className="mt-1 mb-0 text-kumo-subtle">Отправится версия {item.reference.revision}. После согласования и публикации она появится в общей библиотеке.</p></div>
   <ol aria-label="Путь общего шаблона" className="grid grid-cols-3 gap-2 rounded-xl bg-kumo-tint p-3 text-[12px]"><li className="font-medium">1. Предложение{sent?" · отправлено":""}</li><li>2. Согласование</li><li>3. Публикация</li></ol>
   {sent?<div className="rounded-xl border border-kumo-line p-4"><p role="status" className="m-0 text-[15px] font-medium">Предложение отправлено.</p><p className="mt-2 mb-0 text-kumo-subtle">Согласующие получат эту версию во «Входящих». Личный шаблон сохранён. После публикации материал будет доступен в общей библиотеке.</p></div>:<>
    <label className="block">Команда<select aria-label="Команда для шаблона" className="mt-1 block w-full rounded-lg border border-kumo-line bg-kumo-base p-2" value={group} disabled={busy||frozen} onChange={e=>setGroup(e.target.value)}><option value="">Выберите команду</option>{groups.map(s=><option key={s.scope_id} value={s.scope_id}>{s.name}</option>)}</select></label>
    <label className="block">Для чего нужен общий шаблон<textarea aria-label="Объяснение общего шаблона" className="mt-1 block w-full rounded-lg border border-kumo-line bg-kumo-base p-2" rows={2} maxLength={4096} disabled={busy||frozen} value={reason} onChange={e=>setReason(e.target.value)}/></label>
    {plan&&<><p className="m-0 text-kumo-subtle">Согласующие: {plan.reviewers.map(p=>p.name).join(', ')}.</p>{plan.reviewers.some(p=>!p.canRead)?<div><p className="m-0 text-kumo-subtle">Для проверки им нужно чтение этого документа. Другие документы проекта не откроются.</p><WorkshopButton className="mt-2" disabled={busy} onClick={()=>void act(true)}>Открыть согласующим этот шаблон</WorkshopButton></div>:<p role="status" className="m-0 text-kumo-subtle">Доступ к предложенной версии проверен.</p>}</>}
    {busy&&<p role="status">Проверяем…</p>}
    {error&&<div><p role="alert" className="m-0 text-kumo-danger">{error}</p><WorkshopButton onClick={()=>setReload(v=>v+1)}>Повторить проверку</WorkshopButton></div>}
    {!busy&&!groups.length&&!error&&<p className="text-kumo-subtle">Нет доступной команды для согласования. Шаблон остаётся личным.</p>}
    <WorkshopButton tone="primary" disabled={busy||!plan||plan.reviewers.some(p=>!p.canRead)||!reason.trim()} onClick={()=>void act(false)}>{frozen?'Продолжить отправку':'Отправить на согласование'}</WorkshopButton>
   </>}
  </div>}
 </section>
}
