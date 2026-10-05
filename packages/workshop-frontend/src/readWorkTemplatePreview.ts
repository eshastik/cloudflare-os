import {checkedTemplateReferences,type WorkTemplateReference,type ChatWorkTemplateChoice} from '@gadgets/workshop-shared/work-template'
import type {NativeDocumentSnapshot} from '@gadgets/workshop-shared/native-document'
import {openBlueprintTemplatesFrame} from './accountCapabilities'
import {disposeGatekeeperFrame} from './disposeGatekeeperFrame'
import {downloadGatekeeperNativeDocument,downloadGatekeeperWorkTemplateText} from './gatekeeperAppDownload'

export type TemplatePreviewMaterial={sourceProjectId?:string;improvement?:{scope_id:string;revision:number;name:string};promotion?:{scope_id:string;revision:number;name:string;level:'department'|'organization'};material:ChatWorkTemplateChoice;content:string|NativeDocumentSnapshot}

/** Отличает ограничения просмотра от ошибок доступа, сети и целостности. */
export class TemplatePreviewUnavailable extends Error {
 constructor(readonly reason:'format'|'size'){super(reason==='format'?'Формат не поддержан':'Снимок слишком большой')}
}

/** Читает точную версию через объектный путь и освобождает RPC при отказе или отмене. */
export async function readWorkTemplatePreview(api:Parameters<typeof openBlueprintTemplatesFrame>[0],accountId:number,reference:WorkTemplateReference,cancel:AbortSignal):Promise<TemplatePreviewMaterial>{
 const signal=AbortSignal.any([cancel,AbortSignal.timeout(20000)])
 const wait=<T,>(operation:PromiseLike<T>,late?:(value:T)=>void)=>new Promise<T>((resolve,reject)=>{
  const aborted=()=>reject(signal.reason);signal.addEventListener('abort',aborted,{once:true})
  void Promise.resolve(operation).then(value=>{signal.removeEventListener('abort',aborted);if(signal.aborted){late?.(value);reject(signal.reason)}else resolve(value)},error=>{signal.removeEventListener('abort',aborted);reject(error)})
  if(signal.aborted)aborted()
 })
 let frame:Awaited<ReturnType<typeof openBlueprintTemplatesFrame>>|null=null
 try{
  frame=await wait(openBlueprintTemplatesFrame(api,accountId),disposeGatekeeperFrame);signal.throwIfAborted()
  const selector=frame.blueprintTemplates.selector,preview=await wait<Awaited<ReturnType<typeof selector.preview>>>(selector.preview(reference));signal.throwIfAborted()
  if(JSON.stringify(checkedTemplateReferences([preview.material.reference])[0])!==JSON.stringify(checkedTemplateReferences([reference])[0]))throw Error('Снимок не подтверждён')
  const validate=()=>wait(selector.validatePreview(reference,preview.sourceHead))
  if(preview.unavailable){await validate();signal.throwIfAborted();throw new TemplatePreviewUnavailable(preview.unavailable)}
  if(!Number.isSafeInteger(preview.ticket.size_bytes)||preview.ticket.size_bytes<0)throw Error('Снимок не подтверждён')
  if(preview.ticket.size_bytes>1024*1024){await validate();signal.throwIfAborted();throw new TemplatePreviewUnavailable('size')}
  let content:string|NativeDocumentSnapshot
  if(preview.ticket.content_type==='application/vnd.cloudflareos.document+json'){
   content=await wait(downloadGatekeeperNativeDocument(frame.blueprintTemplates.storageOrigin,preview.ticket,'cloudflareos.document',signal,validate))
   if(typeof content.document.title!=='string'||!Array.isArray(content.document.blocks)||content.document.blocks.some(block=>!block||typeof block.html!=='string'))throw Error('Форма повреждена')
  }else if(['text/plain','text/markdown'].includes(preview.ticket.content_type))content=await wait(downloadGatekeeperWorkTemplateText(frame.blueprintTemplates.storageOrigin,preview.ticket,signal,validate))
  else {await validate();signal.throwIfAborted();throw new TemplatePreviewUnavailable('format')}
  signal.throwIfAborted();return {material:preview.material,content,sourceProjectId:typeof preview.sourceProjectId==='string'&&preview.sourceProjectId.trim()?preview.sourceProjectId:undefined,improvement:preview.improvement,promotion:preview.promotion}
 }finally{disposeGatekeeperFrame(frame)}
}
