import {useEffect,useState} from 'react'
import type {RpcStub} from 'capnweb'
import type {GatekeeperNativeDocumentSelector} from '@gadgets/workshop-shared/gatekeeper'
import type {DocumentTemplateOriginView,WorkTemplateKind} from '@gadgets/workshop-shared/work-template'

const kinds:Record<WorkTemplateKind,string>={document:'Форма',guidance:'Методика',agent_instructions:'Инструкции агента',skill:'Навык'}

/** Происхождение выбранной сохранённой версии; отказ не означает отсутствие шаблонов. */
export default function DocumentTemplateOrigin({source,project,node,head}:{source:Pick<RpcStub<GatekeeperNativeDocumentSelector>,'templateOrigin'>;project:string;node:string;head:string}) {
 const [state,setState]=useState<{loading:boolean;origin?:DocumentTemplateOriginView|null;error?:string}>({loading:true})
 useEffect(()=>{
  let cancelled=false
  setState({loading:true})
  void (async()=>{
   if(typeof source.templateOrigin!=='function')throw Error('Метод недоступен')
   const origin=await source.templateOrigin(project,node,head)
   if(!cancelled)setState({loading:false,origin})
  })().catch(()=>{if(!cancelled)setState({loading:false,error:'Происхождение недоступно. Проверьте доступ к документу и использованным шаблонам.'})})
  return ()=>{cancelled=true}
 },[source,project,node,head])
 return <section aria-label="Шаблоны документа" className="flex flex-col gap-2 text-[14px] leading-5 text-kumo-default">
  <h3 className="m-0 text-[15px] font-semibold">Шаблоны документа</h3>
  {state.loading&&<p role="status" className="m-0 text-kumo-subtle">Читаю использованные версии…</p>}
  {state.error&&<p role="alert" className="m-0 text-kumo-subtle">{state.error}</p>}
  {state.origin===null&&<p className="m-0 text-kumo-subtle">Документ создан без применения шаблонов.</p>}
  {state.origin&&<>
   <ul className="m-0 flex list-none flex-col gap-2 p-0">{state.origin.materials.map((material,index)=><li key={index} className="[overflow-wrap:anywhere]">
    <span>{kinds[material.kind]}: «{material.title}», версия {material.reference.revision}</span>
    <span className="block text-[13px] text-kumo-subtle">{'template_id' in material.reference?'Личный шаблон':'Общий шаблон'}</span>
   </li>)}</ul>
   <p className="m-0 text-[13px] text-kumo-subtle">{state.origin.executed_by?'Создан агентом':'Создан человеком'} · {new Date(state.origin.created_at_ms).toLocaleString('ru-RU')}</p>
   <details className="text-[13px] text-kumo-subtle">
    <summary className="cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kumo-ring">Сведения об операции</summary>
    <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 [overflow-wrap:anywhere]">
     <dt>Инициатор</dt><dd className="m-0">{state.origin.initiated_by}</dd>
     {state.origin.executed_by&&<><dt>Агент</dt><dd className="m-0">{state.origin.executed_by}</dd></>}
     <dt>Операция</dt><dd className="m-0">{state.origin.operation_id}</dd>
    </dl>
   </details>
  </>}
 </section>
}
