import {useEffect,useRef,useState} from 'react'
import type {AuthenticatedApi} from '@gadgets/workshop-shared/api'
import {useAuthenticatedApi} from './AuthContext'
import {AccountsSubscriberAdapter} from './accountsSubscriber'

import {finishCalendarConnection,calendarAttemptKey,readCalendarAttempt,type CalendarAttempt} from './calendarConnection'

export default function CalendarConnectionPanel(){
 const {currentUser}=useAuthenticatedApi()
 return currentUser?.type==='user'?<CalendarForm key={currentUser.id} owner={currentUser.id}/>:null
}

function CalendarForm({owner}:{owner:string}){
 const {authenticatedApi}=useAuthenticatedApi()
 const [accounts,setAccounts]=useState<Map<number,{vendor:string;name:string}>>(new Map())
 const [source,setSource]=useState(''),[target,setTarget]=useState(''),[calendar,setCalendar]=useState(''),[project,setProject]=useState('')
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[result,setResult]=useState('')
 const [storageError,setStorageError]=useState(false)
 const [listing,setListing]=useState<Awaited<ReturnType<AuthenticatedApi['listCalendars']>>>()
 const [loading,setLoading]=useState(false),[listingError,setListingError]=useState('')
 const sourceVendor=accounts.get(Number(source))?.vendor
 useEffect(()=>{
  setListing(undefined);setListingError('')
  if(!['microsoft','mnemos'].includes(sourceVendor??'')){setLoading(false);return}
  let closed=false;setLoading(true)
  authenticatedApi.listCalendars(Number(source)).then(value=>{if(!closed)setListing(value)}).catch(()=>{if(!closed)setListingError('Не удалось прочитать календари. Проверьте подключение аккаунта.')}).finally(()=>{if(!closed)setLoading(false)})
  return()=>{closed=true}
 },[authenticatedApi,source,sourceVendor])
 const attempt=useRef<CalendarAttempt|undefined>(undefined),running=useRef(false),generation=useRef(0)
 useEffect(()=>{generation.current++;attempt.current=undefined;running.current=false;setBusy(false);setResult('');setNotice('');setSource('');setTarget('');setAccounts(new Map());try{const saved=readCalendarAttempt(sessionStorage,owner);attempt.current=saved;setSource(saved?String(saved.source):'');setTarget(saved?String(saved.target):'');setCalendar(saved?.calendar??'');setProject(saved?.project??'');setStorageError(false);if(saved)setNotice('Найдена незавершённая заявка. Повторите подключение для проверки результата.')}catch{setStorageError(true);setNotice('Не удалось прочитать сохранённую заявку календаря. Подключение приостановлено.')}
  let closed=false;let subscription:Awaited<ReturnType<typeof authenticatedApi.subscribeConnectedAccounts>>|undefined
  const subscriber=new AccountsSubscriberAdapter({add({id,vendorId,description}){if(closed)return;setAccounts(previous=>new Map(previous).set(id,{vendor:vendorId,name:description.displayName||description.uniqueName||vendorId}))},remove(id){if(!closed)setAccounts(previous=>{const next=new Map(previous);next.delete(id);return next})},ready(){}})
  authenticatedApi.subscribeConnectedAccounts(subscriber).then(value=>{if(closed)value[Symbol.dispose]();else subscription=value}).catch(()=>{if(!closed)setNotice('Не удалось прочитать подключённые аккаунты.')})
  return()=>{closed=true;generation.current++;subscription?.[Symbol.dispose]()}
 },[authenticatedApi,owner])
 async function connect(){if(running.current||result||storageError)return;running.current=true;const started=generation.current;setBusy(true);setNotice('')
  try{const selected=attempt.current??{source:Number(source),target:Number(target),calendar:calendar.trim(),project:project.trim(),request:crypto.randomUUID()}
   if(!selected.source||!selected.target||!selected.calendar||!selected.project)throw Error('incomplete')
   attempt.current=selected
   const out=await finishCalendarConnection(authenticatedApi,selected,value=>{
    if(generation.current!==started)throw Error('Session changed')
    sessionStorage.setItem(calendarAttemptKey(owner),JSON.stringify(value))
   })
   if(generation.current===started){setResult(out.connection_id);setNotice(out.enabled?'Календарь подключён. Права агентам выдаются отдельно.':'Подключение существует, но отключено.')}
  }catch{if(generation.current===started)setNotice('Подключение не подтверждено. Проверьте аккаунты и права проекта; повтор использует тот же запрос.')}
  finally{if(generation.current===started){running.current=false;setBusy(false)}}
 }
 function reset(){if(running.current)return;try{sessionStorage.removeItem(calendarAttemptKey(owner))}catch{setNotice('Не удалось очистить сохранённую заявку.');return}attempt.current=undefined;setResult('');setNotice('')}
 const frozen=storageError||busy||!!attempt.current
 return <details className="p-3 border-b"><summary>Подключить календарь к Mnemos</summary>
  <p>Выберите свои подключённые аккаунты. Укажите проект Mnemos. Для Google введите ID календаря, для Outlook и CalDAV выберите его из списка. CalDAV-аккаунт сначала добавьте в приложении Mnemos.</p>
  <label>Аккаунт календаря <select aria-label="Аккаунт календаря" value={source} disabled={frozen} onChange={e=>{setSource(e.target.value);setCalendar('')}}><option value="">Выберите аккаунт</option>{[...accounts].filter(([,a])=>['google','microsoft','mnemos'].includes(a.vendor)).map(([id,a])=><option key={id} value={id}>{a.name}</option>)}</select></label>
  <label>Аккаунт Mnemos <select aria-label="Аккаунт Mnemos" value={target} disabled={frozen} onChange={e=>setTarget(e.target.value)}><option value="">Выберите аккаунт</option>{[...accounts].filter(([,a])=>a.vendor==='mnemos').map(([id,a])=><option key={id} value={id}>{a.name}</option>)}</select></label>
  <label>Проект Mnemos <input aria-label="Проект Mnemos" value={project} disabled={frozen} onChange={e=>setProject(e.target.value)}/></label>
  {['microsoft','mnemos'].includes(sourceVendor??'')?<>
   <label>Календарь Outlook / CalDAV <select aria-label="Календарь Outlook / CalDAV" value={calendar} disabled={frozen||loading} onChange={e=>setCalendar(e.target.value)}>
    <option value="">Выберите календарь</option>
    {calendar&&!listing?.calendars.some(c=>c.id===calendar)&&<option value={calendar}>Сохранённый выбор</option>}
    {listing?.calendars.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
   </select></label>
   {loading&&<p>Загрузка календарей…</p>}{listingError&&<p role="alert">{listingError}</p>}
   {listing?.truncated&&<p>Список слишком большой; показана только часть календарей.</p>}
  </>:<label>ID календаря <input aria-label="ID календаря" value={calendar} disabled={frozen} onChange={e=>setCalendar(e.target.value)}/></label>}
  <button disabled={storageError||busy||!!result||!source||!target||!calendar||!project} onClick={()=>void connect()}>{attempt.current?'Повторить подключение':'Подключить календарь'}</button>
  {!busy&&attempt.current&&(!attempt.current.selection||result)&&<button onClick={reset}>{result?'Подключить ещё календарь':'Изменить выбор'}</button>}
  {attempt.current?.selection&&!result&&<p>Если ответ не получен, повторите подключение здесь. Заявка сохранится при перезагрузке этой вкладки.</p>}
  {notice&&<p role="status">{notice}</p>}{result&&<p>ID подключения: <code>{result}</code>. Откройте «Доступ к календарю» ниже для выдачи прав агенту.</p>}
 </details>
}
