import {useEffect,useRef,useState} from 'react'
import type {ChatWorkTemplate} from '@gadgets/workshop-shared/work-template'
import type {GatekeeperTemplateAgentAccessPlan} from '@gadgets/workshop-shared/gatekeeper'
import {useAuthenticatedApi} from './AuthContext'
import {openBlueprintTemplatesFrame} from './accountCapabilities'
import {disposeGatekeeperFrame} from './disposeGatekeeperFrame'
import {WorkshopButton} from './components/WorkshopControls'

type Frame=Awaited<ReturnType<typeof openBlueprintTemplatesFrame>>
export default function SelectedTemplateAgentAccess({items,onReady}:{items:ChatWorkTemplate[];onReady(key:string):void}){
 const {authenticatedApi}=useAuthenticatedApi(),[plans,setPlans]=useState<{account:number;plan:GatekeeperTemplateAgentAccessPlan}[]>([]),[busy,setBusy]=useState(true),[error,setError]=useState(''),[reload,setReload]=useState(0)
 const frames=useRef(new Map<number,Frame>()),lifetime=useRef(new AbortController())
 const key=JSON.stringify(items.map(item=>[item.accountId,item.reference]))
 useEffect(()=>{
  const owner=new AbortController();lifetime.current=owner;onReady('');setBusy(true);setError('');setPlans([])
  const groups=new Map<number,typeof items>();for(const item of items)groups.set(item.accountId,[...(groups.get(item.accountId)||[]),item]);
  void (async()=>{
   if(groups.size>1){setError('Совместное применение материалов разных библиотек пока не поддерживается. Выберите материалы одной библиотеки.');return}
   const results=[]
   for(const [account,materials] of groups){
    const frame=await wait(openBlueprintTemplatesFrame(authenticatedApi,account),owner.signal,disposeGatekeeperFrame)
    if(owner.signal.aborted){disposeGatekeeperFrame(frame);return}frames.current.set(account,frame)
    results.push({account,plan:await wait(frame.blueprintTemplates.selector.agentAccess(materials.map(item=>item.reference)),owner.signal)})
   }
   if(!owner.signal.aborted){setPlans(results);if(results.every(item=>item.plan.ready))onReady(key)}
  })().catch(()=>{if(!owner.signal.aborted)setError('Не удалось проверить доступ агента. Повторите проверку перед выбором.')}).finally(()=>{if(!owner.signal.aborted)setBusy(false)})
  return()=>{owner.abort();onReady('');for(const frame of frames.current.values())disposeGatekeeperFrame(frame);frames.current.clear()}
 },[authenticatedApi,key,reload,onReady])
 async function allow(account:number,plan:GatekeeperTemplateAgentAccessPlan,scope:GatekeeperTemplateAgentAccessPlan['scopes'][number]){
  if(busy)return;const frame=frames.current.get(account);if(!frame)return;const owner=lifetime.current;setBusy(true);setError('')
  try{await wait(frame.blueprintTemplates.selector.allowAgentAccess(items.filter(item=>item.accountId===account).map(item=>item.reference),scope.scopeId,plan.bindingId,scope.revision),owner.signal);if(!owner.signal.aborted)setReload(value=>value+1)}
  catch{if(!owner.signal.aborted){setError('Разрешение не подтверждено. Повторная проверка покажет, сохранилось ли оно.');setPlans([])}}
  finally{if(!owner.signal.aborted)setBusy(false)}
 }
 return <section aria-label="Доступ агента к шаблонам" className="mb-3 text-[12px] leading-5 text-kumo-subtle">
  {busy&&<p role="status">Проверяем доступ агента…</p>}
  {!busy&&plans.length>0&&plans.every(item=>item.plan.ready)&&<p role="status">Агент может прочитать выбранные версии.</p>}
  {plans.flatMap(({account,plan})=>plan.scopes.filter(scope=>!scope.enabled).map(scope=><div key={JSON.stringify([account,scope.scopeId])} className="mt-2"><p>Агенту не разрешены шаблоны «{scope.title}». Разрешение откроет ему опубликованные шаблоны этой области в пределах ваших текущих прав. Оно не даёт доступа к личной папке автора и не разрешает публикацию.</p><WorkshopButton disabled={busy} onClick={()=>void allow(account,plan,scope)}>Разрешить чтение шаблонов «{scope.title}»</WorkshopButton></div>))}
  {!busy&&plans.some(({plan})=>!plan.ready&&plan.scopes.every(scope=>scope.enabled))&&<p role="alert">Агент не может прочитать выбранные версии. Проверьте его права на проекты и шаблоны.</p>}
  {error&&<p role="alert">{error}</p>}
  {!busy&&(error||plans.some(item=>!item.plan.ready))&&<WorkshopButton onClick={()=>setReload(value=>value+1)}>Проверить доступ ещё раз</WorkshopButton>}
 </section>
}
async function wait<T>(operation:PromiseLike<T>,owner:AbortSignal,late?:(value:T)=>void):Promise<T>{
 const signal=AbortSignal.any([owner,AbortSignal.timeout(20000)])
 return new Promise((resolve,reject)=>{
  const abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true})
  void Promise.resolve(operation).then(value=>{signal.removeEventListener('abort',abort);if(signal.aborted){late?.(value);reject(signal.reason)}else resolve(value)},error=>{signal.removeEventListener('abort',abort);reject(error)})
  if(signal.aborted)abort()
 })
}
