import {useEffect,useRef,useState} from 'react'
import type {AuthenticatedApi} from '@gadgets/workshop-shared/api'
import {useAuthenticatedApi} from './AuthContext'
import {AccountsSubscriberAdapter} from './accountsSubscriber'

import {finishMailConnection,mailAttemptKey,readMailAttempt,type MailAttempt} from './mailConnection'

export default function MailConnectionPanel(){
 const {currentUser}=useAuthenticatedApi()
 return currentUser?.type==='user'?<MailForm key={currentUser.id} owner={currentUser.id}/>:null
}

function MailForm({owner}:{owner:string}){
 const {authenticatedApi}=useAuthenticatedApi()
 const [accounts,setAccounts]=useState<Map<number,{vendor:string;name:string}>>(new Map())
 const [source,setSource]=useState(''),[target,setTarget]=useState(''),[query,setQuery]=useState(''),[project,setProject]=useState('')
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[result,setResult]=useState('')
 const [storageError,setStorageError]=useState(false)
 const [folderPath,setFolderPath]=useState<string[]>([])
 const [folderListing,setFolderListing]=useState<Awaited<ReturnType<AuthenticatedApi['listMailFolders']>>>()
 const [foldersBusy,setFoldersBusy]=useState(false),[folderError,setFolderError]=useState('')
 const sourceVendor=accounts.get(Number(source))?.vendor
 const parentFolder=folderPath.at(-1)??''
 useEffect(()=>{
  setFolderListing(undefined);setFolderError('')
  if(!['google','microsoft','mnemos'].includes(sourceVendor??'')){setFoldersBusy(false);return}
  let closed=false;setFoldersBusy(true)
  authenticatedApi.listMailFolders(Number(source),parentFolder).then(value=>{if(!closed)setFolderListing(value)}).catch(()=>{if(!closed)setFolderError('Не удалось прочитать папки почты. Проверьте подключение аккаунта.')}).finally(()=>{if(!closed)setFoldersBusy(false)})
  return()=>{closed=true}
 },[authenticatedApi,source,sourceVendor,parentFolder])
 const attempt=useRef<MailAttempt|undefined>(undefined),running=useRef(false),generation=useRef(0)
 useEffect(()=>{generation.current++;attempt.current=undefined;running.current=false;setBusy(false);setResult('');setNotice('');setSource('');setTarget('');setAccounts(new Map());try{const saved=readMailAttempt(sessionStorage,owner);attempt.current=saved;setSource(saved?String(saved.source):'');setTarget(saved?String(saved.target):'');setQuery(saved?.query??'');setProject(saved?.project??'');setStorageError(false);if(saved)setNotice('Найдена незавершённая заявка. Повторите подключение для проверки результата.')}catch{setStorageError(true);setNotice('Не удалось прочитать сохранённую заявку почты. Подключение приостановлено.')}
  let closed=false;let subscription:Awaited<ReturnType<typeof authenticatedApi.subscribeConnectedAccounts>>|undefined
  const subscriber=new AccountsSubscriberAdapter({add({id,vendorId,description}){if(closed)return;setAccounts(previous=>new Map(previous).set(id,{vendor:vendorId,name:description.displayName||description.uniqueName||vendorId}))},remove(id){if(!closed)setAccounts(previous=>{const next=new Map(previous);next.delete(id);return next})},ready(){}})
  authenticatedApi.subscribeConnectedAccounts(subscriber).then(value=>{if(closed)value[Symbol.dispose]();else subscription=value}).catch(()=>{if(!closed)setNotice('Не удалось прочитать подключённые аккаунты.')})
  return()=>{closed=true;generation.current++;subscription?.[Symbol.dispose]()}
 },[authenticatedApi,owner])
 async function connect(){if(running.current||result||storageError)return;running.current=true;const started=generation.current;setBusy(true);setNotice('')
  try{const selected=attempt.current??{source:Number(source),target:Number(target),query:query.trim(),project:project.trim(),request:crypto.randomUUID()}
   if(!selected.source||!selected.target||!selected.query||!selected.project)throw Error('incomplete')
   attempt.current=selected
   const out=await finishMailConnection(authenticatedApi,selected,value=>{
    if(generation.current!==started)throw Error('Session changed')
    sessionStorage.setItem(mailAttemptKey(owner),JSON.stringify(value))
   })
   if(generation.current===started){setResult(out.connection_id);setNotice(out.enabled?'Почта подключена. Права агентам выдаются отдельно.':'Подключение существует, но отключено.')}
  }catch{if(generation.current===started)setNotice('Подключение не подтверждено. Проверьте аккаунты и права проекта; повтор использует тот же запрос.')}
  finally{if(generation.current===started){running.current=false;setBusy(false)}}
 }
 function reset(){if(running.current)return;try{sessionStorage.removeItem(mailAttemptKey(owner))}catch{setNotice('Не удалось очистить сохранённую заявку.');return}attempt.current=undefined;setResult('');setNotice('')}
 const frozen=storageError||busy||!!attempt.current
 return <details className="p-3 border-b"><summary>Подключить почту к Mnemos</summary>
  <p>Выберите свои подключённые аккаунты. Укажите проект Mnemos. Выберите папку почты. В Gmail в этом списке показаны ярлыки. Аккаунт собственного сервера, Яндекса или iCloud сначала добавьте в приложении Mnemos.</p>
  <label>Почтовый аккаунт <select aria-label="Почтовый аккаунт" value={source} disabled={frozen} onChange={e=>{setSource(e.target.value);setQuery('');setFolderPath([])}}><option value="">Выберите аккаунт</option>{[...accounts].filter(([,a])=>['google','microsoft','mnemos'].includes(a.vendor)).map(([id,a])=><option key={id} value={id}>{a.name}</option>)}</select></label>
  <label>Аккаунт Mnemos <select aria-label="Аккаунт Mnemos" value={target} disabled={frozen} onChange={e=>setTarget(e.target.value)}><option value="">Выберите аккаунт</option>{[...accounts].filter(([,a])=>a.vendor==='mnemos').map(([id,a])=><option key={id} value={id}>{a.name}</option>)}</select></label>
  <label>Проект Mnemos <input aria-label="Проект Mnemos" value={project} disabled={frozen} onChange={e=>setProject(e.target.value)}/></label>
  {['google','microsoft','mnemos'].includes(sourceVendor??'')?<fieldset disabled={frozen}>
   <legend>Папка почты</legend>
   {frozen?<p>Сохранённая выборка: {query}</p>:<>
    {folderPath.length>0&&<button onClick={()=>setFolderPath(path=>path.slice(0,-1))}>На уровень выше</button>}
    {foldersBusy&&<p>Загрузка папок…</p>}
    {folderError&&<p role="alert">{folderError}</p>}
    {folderListing?.folders.map(folder=><div key={folder.id}>
     <label><input type="radio" name="mail-folder" checked={query==='folder:'+folder.id} onChange={()=>setQuery('folder:'+folder.id)}/>{folder.name}</label>
     {folder.hasChildren&&<button onClick={()=>setFolderPath(path=>[...path,folder.id])}>Открыть вложенные папки: {folder.name}</button>}
    </div>)}
    {folderListing?.truncated&&<p>Список слишком большой; показана только часть папок.</p>}
    {folderListing&&!folderListing.folders.length&&<p>Папок нет. Для IMAP сначала добавьте аккаунт и папку в приложении Mnemos.</p>}
    {query&&<p>Выбрано: {query}</p>}
   </>}
  </fieldset>:null}
  <button disabled={storageError||busy||!!result||!source||!target||!query||!project} onClick={()=>void connect()}>{attempt.current?'Повторить подключение':'Подключить почту'}</button>
  {!busy&&attempt.current&&(!attempt.current.selection||result)&&<button onClick={reset}>{result?'Подключить ещё почту':'Изменить выбор'}</button>}
  {attempt.current?.selection&&!result&&<p>Если ответ не получен, повторите подключение здесь. Заявка сохранится при перезагрузке этой вкладки.</p>}
  {notice&&<p role="status">{notice}</p>}{result&&<p>ID подключения: <code>{result}</code>. Откройте «Доступ к почте» ниже для выдачи прав агенту.</p>}
 </details>
}
