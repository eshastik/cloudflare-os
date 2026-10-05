import {useEffect,useRef,useState} from 'react'
import type {RpcStub} from 'capnweb'
import type {GadgetClient} from '@gadgets/workshop-shared/api'
import type {NativeDocumentEditor} from '@gadgets/workshop-shared/native-document'
import {checkedTemplateReferences,type ChatWorkTemplateChoice} from '@gadgets/workshop-shared/work-template'
import {useAuthenticatedApi} from './AuthContext'
import {openBlueprintTemplatesFrame} from './accountCapabilities'
import {disposeGatekeeperFrame} from './disposeGatekeeperFrame'
import {downloadGatekeeperNativeDocument} from './gatekeeperAppDownload'
import {waitForNativeSnapshotSource,type NativeSnapshotSourceRef} from './nativeSnapshotSource'
import type {TemplateEditingContext} from './templateEditing'
import {WorkshopButton} from './components/WorkshopControls'

export default function WorkTemplateEditing({context,gadget,snapshotSource,onReady}:{context:TemplateEditingContext;gadget:Pick<RpcStub<GadgetClient>,'connectToGadget'>;snapshotSource:NativeSnapshotSourceRef;onReady(material:ChatWorkTemplateChoice):void}){
 const {authenticatedApi}=useAuthenticatedApi()
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[material,setMaterial]=useState<ChatWorkTemplateChoice|null>(null)
 const lifetime=useRef(new AbortController()),opening=useRef<symbol|null>(null)
 useEffect(()=>{const owner=new AbortController();lifetime.current=owner;opening.current=null;setMaterial(null);setError('');setBusy(false);return()=>owner.abort()},[gadget])
 async function open(){
  if(opening.current||material)return
  const attempt=Symbol();opening.current=attempt;setBusy(true);setError('')
  const owner=lifetime.current
  const signal=AbortSignal.any([owner.signal,AbortSignal.timeout(20000)])
  const wait=<T,>(operation:PromiseLike<T>,late?:(value:T)=>void)=>new Promise<T>((resolve,reject)=>{
   const cancelled=()=>reject(signal.reason)
   signal.addEventListener('abort',cancelled,{once:true})
   void Promise.resolve(operation).then(value=>{signal.removeEventListener('abort',cancelled);if(signal.aborted){late?.(value);reject(signal.reason)}else resolve(value)},reason=>{signal.removeEventListener('abort',cancelled);reject(reason)})
   if(signal.aborted)cancelled()
  })
  let frame:Awaited<ReturnType<typeof openBlueprintTemplatesFrame>>|null=null,editor:RpcStub<NativeDocumentEditor>|null=null
  try{
   await waitForNativeSnapshotSource(snapshotSource,signal);signal.throwIfAborted()
   editor=await wait(gadget.connectToGadget(),value=>value[Symbol.dispose]()) as RpcStub<NativeDocumentEditor>;signal.throwIfAborted()
   const {revision}=await wait(editor.getDocument());signal.throwIfAborted()
   if(!Number.isSafeInteger(revision)||revision<0)throw Error('Редактор не сообщил ревизию')
   frame=await wait(openBlueprintTemplatesFrame(authenticatedApi,context.accountId),disposeGatekeeperFrame);signal.throwIfAborted()
   const selector=frame.blueprintTemplates.selector,preview=await wait(selector.preview(context.reference));signal.throwIfAborted()
   if(JSON.stringify(checkedTemplateReferences([preview.material.reference])[0])!==JSON.stringify(context.reference)||preview.ticket.content_type!=='application/vnd.cloudflareos.document+json'||preview.ticket.size_bytes>1024*1024)throw Error('Нужен снимок выбранной версии документа')
   const validate=()=>selector.validatePreview(context.reference,preview.sourceHead)
   const snapshot=await wait(downloadGatekeeperNativeDocument(frame.blueprintTemplates.storageOrigin,preview.ticket,'cloudflareos.document',signal,()=>wait(validate())));signal.throwIfAborted()
   await wait(validate());signal.throwIfAborted()
   await wait(editor.restoreDocumentSnapshot(snapshot,revision));signal.throwIfAborted()
   setMaterial(preview.material);onReady(preview.material)
  }catch{if(!owner.signal.aborted&&opening.current===attempt)setError('Открытие не подтверждено. Проверьте текст и доступ. Если вы изменили текст во время открытия, сохраните его перед повтором.')}
  finally{editor?.[Symbol.dispose]();disposeGatekeeperFrame(frame);if(opening.current===attempt){opening.current=null;if(!owner.signal.aborted)setBusy(false)}}
 }
 return <section aria-label="Редактирование версии шаблона" className="shrink-0 border-b border-kumo-line px-4 py-3">
  {material?<p className="m-0 text-[13px] text-kumo-subtle">Открыта версия {context.reference.revision}: {material.title}. {'scope_id' in context.reference?'Сохранение создаст личную правку для согласования.':'Сохранение создаст новую версию.'}</p>:<><p className="m-0 mb-2 text-[13px] leading-5 text-kumo-subtle">Откройте версию {context.reference.revision} для редактирования. Она заменит текущий текст этого черновика. Сохранённый шаблон и прежние задачи сохранят свои версии.</p><WorkshopButton tone="primary" disabled={busy} onClick={()=>void open()}>{busy?'Открываем версию…':'Открыть выбранную версию'}</WorkshopButton></>}
  {error&&<p role="alert" className="mt-2 text-[13px] text-kumo-danger">{error}</p>}
 </section>
}
