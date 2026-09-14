import NativeOfficeUpdate from './NativeOfficeUpdate'
import {useEffect,useState} from 'react'
import type {DriveImportReceipt} from '@gadgets/workshop-shared/drive-import'
import {useAuthenticatedApi} from './AuthContext'
import {disposeGatekeeperFrame} from './disposeGatekeeperFrame'
import {openNativeWritesFrame} from './accountCapabilities'
import NativeOfficeImport from './NativeOfficeImport'
import {driveAttemptKey,type DriveCaptureAttempt} from './driveCaptureAttempt'

export default function DriveOfficeImport({owner,attempt,receipt,onBusy,onCreated}:{owner:string;attempt:DriveCaptureAttempt;receipt:DriveImportReceipt;onBusy:(busy:boolean)=>void;onCreated?:()=>Promise<void>}){
 const {authenticatedApi}=useAuthenticatedApi()
 const updateKey=driveAttemptKey(owner)+':update:'+attempt.request
 const [mode,setMode]=useState<'create'|'update'>(()=>sessionStorage.getItem(updateKey)?'update':'create'),[busy,setBusy]=useState(false)
 function progress(value:boolean){setBusy(value);onBusy(value)}
 type Frame=Awaited<ReturnType<typeof authenticatedApi.getGatekeeperApp>>
 const [state,setState]=useState<{frame:NonNullable<Frame>}|null>(null),[error,setError]=useState('')
 const format=receipt.source.contentType==='application/vnd.openxmlformats-officedocument.wordprocessingml.document'?'cloudflareos.document':receipt.source.contentType==='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'?'cloudflareos.spreadsheet':receipt.source.contentType==='application/vnd.openxmlformats-officedocument.presentationml.presentation'?'cloudflareos.presentation':null
 useEffect(()=>{
  setState(null);setError('')
  if(!format)return
  let closed=false;let held:Frame=null
  openNativeWritesFrame(authenticatedApi,attempt.target).then(frame=>{
   if(closed){disposeGatekeeperFrame(frame);return}
   held=frame;setState({frame})
  }).catch(()=>{if(!closed)setError('Не удалось открыть разбор файла. Проверьте подключение аккаунта-получателя.')})
  return()=>{closed=true;disposeGatekeeperFrame(held)}
 },[authenticatedApi,attempt.target,format])
 if(!format)return <p>Разбор этого формата здесь пока не поддерживается. Исходная копия сохранена.</p>
 if(error)return <p role="alert">{error}</p>
 if(!state?.frame.nativeWrites)return <p>Открываю разбор копии…</p>
 let name='',length=0
 for(const char of receipt.source.sourceName.replace(/[\/\\\x00-\x1f\x7f]/g,'_')){const n=new TextEncoder().encode(char).length;if(length+n>230)break;name+=char;length+=n}
 return <>
  <label>Действие <select aria-label="Действие импорта" value={mode} disabled={busy} onChange={e=>setMode(e.target.value as 'create'|'update')}><option value="create">Создать новую копию</option><option value="update">Обновить существующую копию</option></select></label>
  {mode==='update'?<NativeOfficeUpdate key={attempt.request} selector={state.frame.nativeWrites.selector} storageOrigin={state.frame.nativeWrites.storageOrigin}
   scope={attempt.project} source={{node:receipt.node_id,head:receipt.head,sha256:receipt.source.sha256}} format={format} receiptKey={updateKey} onBusy={progress}/>:
   <NativeOfficeImport key={attempt.request} selector={state.frame.nativeWrites.selector} storageOrigin={state.frame.nativeWrites.storageOrigin}
    scope={attempt.project} resource={receipt.node_id} name={name} format={format} source={{head:receipt.head,sha256:receipt.source.sha256}}
    retainReceipt receiptKey={driveAttemptKey(owner)+':native:'+attempt.request} onBusy={progress} onCreated={onCreated??(async()=>{})}/>}
 </>
}
