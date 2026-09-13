import DriveOfficeImport from "./DriveOfficeImport"
import {useEffect,useRef,useState} from 'react'
import type {DriveImportReceipt} from '@gadgets/workshop-shared/drive-import'
import {useAuthenticatedApi} from './AuthContext'
import {AccountsSubscriberAdapter} from './accountsSubscriber'
import {driveAttemptKey,readDriveAttempt,type DriveCaptureAttempt} from './driveCaptureAttempt'

export default function DriveImportPanel(){
 const {currentUser}=useAuthenticatedApi()
 return currentUser?.type==='user'?<CaptureForm key={currentUser.id} owner={currentUser.id}/>:null
}
function CaptureForm({owner}:{owner:string}){
 const {authenticatedApi}=useAuthenticatedApi()
 const [accounts,setAccounts]=useState<Map<number,{vendor:string;name:string}>>(new Map())
 const [source,setSource]=useState(''),[target,setTarget]=useState(''),[file,setFile]=useState(''),[project,setProject]=useState('')
 const [webdav,setWebdav]=useState(''),[webdavAccounts,setWebdavAccounts]=useState<Array<{id:string;name:string}>>([])
 const isWebdav=accounts.get(Number(source))?.vendor==='mnemos'
 useEffect(()=>{
  setWebdavAccounts([])
  if(!isWebdav)return
  let closed=false
  authenticatedApi.listDriveImportAccounts(Number(source)).then(value=>{if(!closed)setWebdavAccounts(value)}).catch(()=>{if(!closed)setNotice('Не удалось прочитать аккаунты WebDAV. Проверьте подключение Mnemos.')})
  return()=>{closed=true}
 },[authenticatedApi,source,isWebdav])
 const [pending,setPending]=useState<DriveCaptureAttempt|null>(null),[receipt,setReceipt]=useState<DriveImportReceipt|null>(null)
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[storageError,setStorageError]=useState(false)
 const running=useRef(false),generation=useRef(0)
 useEffect(()=>{
  generation.current++;running.current=false;setBusy(false);setReceipt(null);setNotice('');setAccounts(new Map())
  try{const saved=readDriveAttempt(sessionStorage,owner);setPending(saved);setStorageError(false);setSource(saved?String(saved.source):'');setTarget(saved?String(saved.target):'');setFile(saved&&/^[-a-f0-9]{36}:/.test(saved.file)?saved.file.slice(37):saved?.file??'');setWebdav(saved&&/^[-a-f0-9]{36}:/.test(saved.file)?saved.file.slice(0,36):'');setProject(saved?.project??'')}
  catch{setStorageError(true);setNotice('Не удалось прочитать сохранённый запрос этой вкладки.')}
  let closed=false;let subscription:Awaited<ReturnType<typeof authenticatedApi.subscribeConnectedAccounts>>|undefined
  const subscriber=new AccountsSubscriberAdapter({add({id,vendorId,description}){if(!closed)setAccounts(previous=>new Map(previous).set(id,{vendor:vendorId,name:description.displayName||description.uniqueName||vendorId}))},remove(id){if(!closed)setAccounts(previous=>{const next=new Map(previous);next.delete(id);return next})}})
  authenticatedApi.subscribeConnectedAccounts(subscriber).then(value=>{if(closed)value[Symbol.dispose]();else subscription=value}).catch(()=>{if(!closed)setNotice('Не удалось прочитать аккаунты. Обновите подключение.')})
  return()=>{closed=true;generation.current++;subscription?.[Symbol.dispose]()}
 },[authenticatedApi,owner])
 async function capture(){
  if(running.current||receipt||storageError)return
  const selected=pending??{source:Number(source),target:Number(target),file:isWebdav?webdav+':'+file.trim():file.trim(),project:project.trim(),request:crypto.randomUUID()}
  if(!pending&&isWebdav&&(!webdav||!file.trim())){setNotice('Выберите аккаунт WebDAV и путь файла.');return}
  if(!selected.source||!selected.target||!selected.file||!selected.project){setNotice('Выберите аккаунты, проект и файл.');return}
  try{sessionStorage.setItem(driveAttemptKey(owner),JSON.stringify(selected))}catch{setStorageError(true);setNotice('Не удалось сохранить запрос для повтора.');return}
  setPending(selected);running.current=true;setBusy(true);setNotice('');const started=generation.current
  try{
   const result=await authenticatedApi.captureDriveImport(selected.source,selected.target,selected.file,selected.project,selected.request)
   if(generation.current===started){setReceipt(result);setNotice('Исходная копия сохранена в личной ветке. Разбор в редактируемый документ ещё не выполнен.')}
  }catch{if(generation.current===started)setNotice('Сохранение не подтверждено. Повтор использует прежний запрос; проверьте доступ к выбранному диску и подключение Mnemos.')}
  finally{if(generation.current===started){running.current=false;setBusy(false)}}
 }
 function reset(){
  if(running.current)return
  try{sessionStorage.removeItem(driveAttemptKey(owner))}catch{setNotice('Не удалось очистить сохранённый запрос.');return}
  setPending(null);setReceipt(null);setStorageError(false);setNotice('Новый запрос создаст отдельную копию.');
 }
 const frozen=busy||!!pending
 return <details className="p-3 border-b"><summary>Копия файла с диска</summary>
  <p>Выберите Google Drive, Яндекс Диск или WebDAV и проект Mnemos. Для Google укажите ID файла, для Яндекса — путь вида disk:/Папка/Документ.docx, для WebDAV — путь относительно подключённой папки. Внешний оригинал остаётся без изменений.</p>
  <label>Диск <select aria-label="Drive source account" value={source} disabled={frozen} onChange={e=>setSource(e.target.value)}><option value="">Выберите аккаунт</option>{[...accounts].filter(([,a])=>['google','yandex','mnemos'].includes(a.vendor)).map(([id,a])=><option key={id} value={id}>{a.vendor==='yandex'?'Яндекс Диск':a.vendor==='mnemos'?'WebDAV':'Google Drive'} — {a.name}</option>)}</select></label>
  {isWebdav&&<label>Аккаунт WebDAV <select aria-label="Drive WebDAV account" value={webdav} disabled={frozen} onChange={e=>setWebdav(e.target.value)}><option value="">Выберите аккаунт WebDAV</option>{webdavAccounts.map(account=><option key={account.id} value={account.id}>{account.name}</option>)}</select></label>}
  {isWebdav&&!webdavAccounts.length&&<p>Добавьте аккаунт через «Аккаунты WebDAV» в подключении Mnemos.</p>}
  <label>Mnemos <select aria-label="Drive Mnemos account" value={target} disabled={frozen} onChange={e=>setTarget(e.target.value)}><option value="">Выберите аккаунт</option>{[...accounts].filter(([,a])=>a.vendor==='mnemos').map(([id,a])=><option key={id} value={id}>{a.name}</option>)}</select></label>
  <label>Проект <input aria-label="Drive project" value={project} disabled={frozen} onChange={e=>setProject(e.target.value)}/></label>
  <label>ID или путь файла <input aria-label="Drive file" value={file} disabled={frozen} onChange={e=>setFile(e.target.value)}/></label>
  <button disabled={busy||!!receipt||storageError} onClick={()=>void capture()}>{pending?'Повторить сохранение':'Сохранить копию'}</button>
  {pending&&<p>Запрос: <code>{pending.request}</code>. Он сохраняется при обновлении этой вкладки. Для нового запроса сохраните этот ID, если результат ещё не подтверждён.</p>}
  {(pending||storageError)&&<button disabled={busy} onClick={reset}>Новый запрос</button>}
  {notice&&<p role="status">{notice}</p>}
  {receipt&&<p>Исходная копия: <code>{receipt.node_id}</code>. Версия источника: {receipt.source.sourceVersion}. SHA-256: <code>{receipt.source.sha256}</code>.</p>}
  {receipt&&pending&&<DriveOfficeImport key={pending.request} owner={owner} attempt={pending} receipt={receipt} onBusy={setBusy} onCreated={async()=>{setNotice("Нативная копия создана в выбранном аккаунте Mnemos. Исходный файл сохранён отдельно.")}}/>}
 </details>
}
