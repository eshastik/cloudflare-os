import {documentPreviewSource} from '@gadgets/workshop-shared/document-preview-html'
import {BLUEPRINT_TEMPLATE_MIME, decodeBlueprintTemplate} from '@gadgets/workshop-shared/blueprint-template'
import type {MnemosAccountSession} from "../src/account-session.ts";
type API=Pick<MnemosAccountSession,"readTemplateProposalSource">;
type BaselineAPI=Pick<MnemosAccountSession,"readTemplateProposalBaseline">;
export type TemplateTextDownload=(project:string,node:string,version:string,side:number)=>Promise<string>;
/** Загрузка и проверка целостности остаются у оболочки. */
export type TemplatePreview = {text:string;documentHtml?:string};
export async function readTemplateProposalText(api:API,id:string,download:TemplateTextDownload):Promise<string>{
 return (await readTemplateProposalPreview(api,id,download)).text;
}
export async function readTemplateProposalPreview(api:API,id:string,download:TemplateTextDownload):Promise<TemplatePreview>{
 return readTemplatePreview(()=>api.readTemplateProposalSource(id),id,download,"template-proposal:");
}
export async function readTemplateBaselineText(api:BaselineAPI,id:string,download:TemplateTextDownload):Promise<string|null>{
 return (await readTemplateBaselinePreview(api,id,download))?.text??null;
}
export async function readTemplateBaselinePreview(api:BaselineAPI,id:string,download:TemplateTextDownload):Promise<TemplatePreview|null>{
 const baseline=await api.readTemplateProposalBaseline(id);
 if(!baseline)return null;
 return readTemplatePreview(async()=>{const source=await api.readTemplateProposalBaseline(id);if(!source)throw Error("Исходная версия недоступна");return {proposal_id:id,source};},id,download,"template-baseline:");
}
async function readTemplatePreview(read:()=>ReturnType<API["readTemplateProposalSource"]>,id:string,download:TemplateTextDownload,prefix:string):Promise<TemplatePreview>{
 const source=await read();
 const mime=source.source.content_type;if(!mime.startsWith("text/")&&mime!=="application/json"&&!mime.endsWith("+json"))throw new Error("Source is not a text artifact");
 const text=await download(source.source.project_id,source.source.node_id,prefix+id,0);
 const current=await read();
 if(current.proposal_id!==source.proposal_id||current.source.template_id!==source.source.template_id||current.source.revision!==source.source.revision||current.source.source_head!==source.source.source_head||current.source.project_id!==source.source.project_id||current.source.node_id!==source.source.node_id||current.source.content_type!==mime)throw new Error("Source changed");
 if(mime===BLUEPRINT_TEMPLATE_MIME){
  const snapshot=await decodeBlueprintTemplate(new TextEncoder().encode(text));
  const content=snapshot.nativeDocument;
  const heading=`${snapshot.blueprint.title}\nВерсия шаблона: ${snapshot.blueprint.version}`;
  if(!content)return {text:`${heading}\n\nШаблон приложения без исходных данных документа.`};
  if(content.format==='cloudflareos.document'){const preview=documentTemplatePreview(content.document);return {...preview,text:`${heading}\n\n${preview.text}`};}
  return {text:`${heading}\n\n${JSON.stringify(content.document,null,2)}`};
 }
 if(mime==='application/vnd.cloudflareos.document+json'){
  const snapshot=JSON.parse(text);
  if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot)||snapshot.format!=='cloudflareos.document'||snapshot.formatVersion!==1||Object.keys(snapshot).some(key=>!['format','formatVersion','document'].includes(key)))throw Error('Неподдерживаемый снимок документа');
  return documentTemplatePreview(snapshot.document);
 }
 if(/^application\/vnd\.cloudflareos\./.test(mime))throw Error('Просмотр этого нативного формата пока не поддерживается');
 return {text};
}

function documentTemplateText(value:unknown):string{
 if(!value||typeof value!=='object'||Array.isArray(value)||!('blocks' in value)||!Array.isArray(value.blocks))throw Error('Неподдерживаемая структура документа');
 const paragraphs=value.blocks.map((block:unknown)=>{
  if(!block||typeof block!=='object'||!('html' in block)||typeof block.html!=='string')throw Error('Неподдерживаемая структура документа');
  const fragment=document.createElement('template');fragment.innerHTML=block.html;
  fragment.content.querySelectorAll('script,style,iframe,object,embed,noscript').forEach(element=>element.remove());
  fragment.content.querySelectorAll('p,div,li,tr,td,th,h1,h2,h3,h4,h5,h6,br,hr,pre,blockquote').forEach(element=>{element.before(document.createTextNode('\n'));element.after(document.createTextNode('\n'))});
  return (fragment.content.textContent??'').split('\n').map(line=>line.replace(/\s+/g,' ').trim()).filter(Boolean).join('\n');
 });
 const title='title' in value&&typeof value.title==='string'?value.title.trim():'';
 return [title,...paragraphs].filter(Boolean).join('\n\n');
}

function documentTemplatePreview(value:unknown):TemplatePreview{
 const text=documentTemplateText(value);
 const doc=value as {title?:string;blocks:{html:string}[]};
 const heading=document.createElement("h1");heading.textContent=typeof doc.title==="string"?doc.title:"";
 return {text,documentHtml:documentPreviewSource((heading.textContent?heading.outerHTML:"")+doc.blocks.map(block=>block.html).join("\n"))};
}
