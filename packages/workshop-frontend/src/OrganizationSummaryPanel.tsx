import IntegrationForm from './IntegrationForm'
import { Button } from '@cloudflare/kumo'
import {useEffect,useRef,useState} from 'react'
import type {OrganizationMetrics} from '@gadgets/workshop-shared/organization-metrics'
import {useAuthenticatedApi} from './AuthContext'
import {AccountsSubscriberAdapter} from './accountsSubscriber'
import {disposeGatekeeperFrame} from './disposeGatekeeperFrame'
import {summarizeOrganizations} from './organizationSummary'

/** Свод по аккаунтам этого приложения гейткипера; каждый аккаунт читается отдельно и только с правом на метрики. */
export default function OrganizationSummaryPanel({appId}:{appId:string}) {
  const {authenticatedApi}=useAuthenticatedApi()
  const [accounts,setAccounts]=useState(new Map<number,string>())
  const [busy,setBusy]=useState(false),[notice,setNotice]=useState('')
  const [result,setResult]=useState<ReturnType<typeof summarizeOrganizations>>()
  const [unavailable,setUnavailable]=useState<string[]>([])
  const generation=useRef(0)
  useEffect(()=>{
    let closed=false
    let subscription:Awaited<ReturnType<typeof authenticatedApi.subscribeConnectedAccounts>>|undefined
    function invalidate(){generation.current++;setResult(undefined);setUnavailable([]);setBusy(false)}
    invalidate();setAccounts(new Map())
    const subscriber=new AccountsSubscriberAdapter({
      add({id,vendorId,description}){if(closed||vendorId!==appId||!description.providesUi)return;invalidate();setAccounts(old=>new Map(old).set(id,description.displayName||description.uniqueName||vendorId))},
      remove(id){if(closed)return;invalidate();setAccounts(old=>{const next=new Map(old);next.delete(id);return next})},ready(){},
    })
    authenticatedApi.subscribeConnectedAccounts(subscriber).then(value=>{if(closed)value[Symbol.dispose]();else subscription=value}).catch(()=>{if(!closed)setNotice('Не удалось получить подключения.')})
    return()=>{closed=true;generation.current++;subscription?.[Symbol.dispose]()}
  },[authenticatedApi,appId])
  async function refresh(){
    const started=++generation.current
    setResult(undefined);setUnavailable([]);setNotice('');setBusy(true)
    const readings:OrganizationMetrics[]=[],failed:string[]=[]
    try {
      for(const [id,name] of accounts){
        if(generation.current!==started)return
        let frame:Awaited<ReturnType<typeof authenticatedApi.getGatekeeperApp>>=null
        try {
          frame=await authenticatedApi.getGatekeeperApp(appId,id)
          if(!frame?.organizationMetrics)throw Error('Unavailable')
          const value=await frame.organizationMetrics.read()
          summarizeOrganizations([value]);readings.push(value)
        }catch{failed.push(name)}finally{disposeGatekeeperFrame(frame)}
      }
      if(generation.current===started){setResult(summarizeOrganizations(readings));setUnavailable(failed)}
    }catch{if(generation.current===started)setNotice('Свод не подтверждён. Обновите подключения и повторите чтение.')}
    finally{if(generation.current===started)setBusy(false)}
  }
  return <IntegrationForm title="Свод организаций">
    <p>Метрики ваших подключений этого приложения. Для каждой организации требуется право просмотра метрик; повторные подключения учитываются один раз.</p>
    <Button disabled={busy||accounts.size===0} onClick={()=>void refresh()}>{busy?'Чтение организаций…':'Обновить свод организаций'}</Button>
    {notice&&<p role="status">{notice}</p>}
    {result&&<>
      <p>Прочитано организаций: {result.organizations.length}; повторных подключений: {result.duplicateConnections}.</p>
      {result.organizations.length>0?result.periods.map(p=><p key={p.days}>За {p.days} дн.: организаций с завершённой работой — {p.completedOrganizations}.</p>):<p>Данные организаций недоступны; число завершивших работу неизвестно.</p>}
      {unavailable.length>0&&<p role="status">Свод неполный. Недоступны подключения: {unavailable.join(', ')}. Их результаты неизвестны.</p>}
      {result.organizations.map(o=><p key={JSON.stringify([o.origin,o.tenantId])}>{o.name} ({o.origin}): {o.periods.map(p=>`${p.days} дн. — ${p.completedProjects} проектов`).join('; ')}. На {new Date(o.observedAt).toLocaleString()}.</p>)}
      <p>Окна отсчитываются от времени наблюдения каждой организации. Завершение — публикация или первая приёмка поручения; это не сумма уникальных задач и не рейтинг сотрудников.</p>
    </>}
  </IntegrationForm>
}
