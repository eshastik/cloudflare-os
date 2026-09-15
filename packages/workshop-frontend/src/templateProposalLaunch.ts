import type {AuthenticatedApi} from '@gadgets/workshop-shared/api'
import {BLUEPRINT_TEMPLATE_MIME, decodeBlueprintTemplate} from '@gadgets/workshop-shared/blueprint-template'
import type {GatekeeperUiFrame} from '@gadgets/workshop-shared/gatekeeper'
import {downloadGatekeeperTemplateText} from './gatekeeperAppDownload'

type Downloads = NonNullable<GatekeeperUiFrame['textDownloads']>
/** Копия получает код и данные предложенной версии, но не подключения исходного гаджета. */
export async function launchTemplateProposal(api:Pick<AuthenticatedApi,'newGadgetFromTemplateSnapshot'>, downloads:Downloads, project:string, node:string, proposal:string, signal:AbortSignal, navigate:(id:string)=>Promise<void>) {
 if([project,node,proposal].some(value=>typeof value!=='string'||!value||value.length>200))throw Error('Не выбран шаблон')
 signal.throwIfAborted()
 const version='template-proposal:'+proposal
 const ticket=await downloads.issuer.issue(project,node,version,0)
 if(!('content_type' in ticket)||ticket.content_type!==BLUEPRINT_TEMPLATE_MIME)throw Error('Этот шаблон не является гаджетом')
 const text=await downloadGatekeeperTemplateText(downloads.storageOrigin,ticket,signal)
 const bytes=new TextEncoder().encode(text)
 await decodeBlueprintTemplate(bytes)
 await downloads.issuer.validate(project,node,version)
 signal.throwIfAborted()
 const workspace=await api.newGadgetFromTemplateSnapshot(new Response(bytes).body!,{})
 try {
  const metadata=await workspace.getMetadata()
  signal.throwIfAborted()
  await navigate(metadata.id)
 }finally{workspace[Symbol.dispose]()}
}
