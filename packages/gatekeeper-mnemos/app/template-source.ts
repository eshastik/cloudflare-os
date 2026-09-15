import {BLUEPRINT_TEMPLATE_MIME, decodeBlueprintTemplate} from '@gadgets/workshop-shared/blueprint-template'
import type {MnemosAccountSession} from "../src/account-session.ts";
type API=Pick<MnemosAccountSession,"readTemplateProposalSource">;
type BaselineAPI=Pick<MnemosAccountSession,"readTemplateProposalBaseline">;
export type TemplateTextDownload=(project:string,node:string,version:string,side:number)=>Promise<string>;
/** The opaque iframe delegates storage transfer and integrity checks to the human host. */
export async function readTemplateProposalText(api:API,id:string,download:TemplateTextDownload):Promise<string>{
 return readTemplateText(()=>api.readTemplateProposalSource(id),id,download,"template-proposal:");
}
export async function readTemplateBaselineText(api:BaselineAPI,id:string,download:TemplateTextDownload):Promise<string|null>{
 const baseline=await api.readTemplateProposalBaseline(id);
 if(!baseline)return null;
 return readTemplateText(async()=>{const source=await api.readTemplateProposalBaseline(id);if(!source)throw Error("Исходная версия недоступна");return {proposal_id:id,source};},id,download,"template-baseline:");
}
async function readTemplateText(read:()=>ReturnType<API["readTemplateProposalSource"]>,id:string,download:TemplateTextDownload,prefix:string):Promise<string>{
 const source=await read();
 const mime=source.source.content_type;if(!mime.startsWith("text/")&&mime!=="application/json"&&!mime.endsWith("+json"))throw new Error("Source is not a text artifact");
 const text=await download(source.source.project_id,source.source.node_id,prefix+id,0);
 const current=await read();
 if(current.proposal_id!==source.proposal_id||current.source.template_id!==source.source.template_id||current.source.revision!==source.source.revision||current.source.source_head!==source.source.source_head||current.source.project_id!==source.source.project_id||current.source.node_id!==source.source.node_id||current.source.content_type!==mime)throw new Error("Source changed");
 if(mime===BLUEPRINT_TEMPLATE_MIME){
  const snapshot=await decodeBlueprintTemplate(new TextEncoder().encode(text));
  const content=snapshot.nativeDocument;
  const heading=`${snapshot.blueprint.title}\nВерсия шаблона: ${snapshot.blueprint.version}`;
  if(!content)return `${heading}\n\nШаблон приложения без исходных данных документа.`;
  if(content.format==='cloudflareos.document'&&Array.isArray(content.document.blocks)){
   const paragraphs=content.document.blocks.map((block:unknown)=>{
    if(!block||typeof block!=='object'||!('html' in block)||typeof block.html!=='string')throw new Error('Неподдерживаемая структура документа');
    const fragment=document.createElement('template');fragment.innerHTML=block.html;
    fragment.content.querySelectorAll('script,style').forEach(element=>element.remove());
    fragment.content.querySelectorAll('br').forEach(element=>element.replaceWith('\n'));
    fragment.content.querySelectorAll('p,div,li,tr,h1,h2,h3,h4').forEach(element=>element.append('\n'));
    return fragment.content.textContent?.trim()||'';
   });
   return `${heading}\n\n${paragraphs.join('\n\n')}`;
  }
  return `${heading}\n\n${JSON.stringify(content.document,null,2)}`;
 }
 return text;
}
