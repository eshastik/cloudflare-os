import DOMPurify from 'dompurify'
import type {NativeDocumentSnapshot} from '@gadgets/workshop-shared/native-document'

/** Просмотр допускает оформление текста без внешних ресурсов и исполняемых элементов. */
export function templatePreviewHtml(html:string):string{return DOMPurify.sanitize(html,{ALLOWED_TAGS:['p','div','span','h1','h2','h3','h4','h5','h6','ul','ol','li','strong','em','b','i','u','s','blockquote','table','tr','thead','tbody','td','th','br','hr','pre','code'],ALLOWED_ATTR:['colspan','rowspan']})}

/** Сравнение включает весь видимый текст, включая текст рядом с вложенными абзацами. */
export function templatePreviewText(snapshot:NativeDocumentSnapshot):string{
 return (snapshot.document.blocks as {html:string}[]).map(block=>{
  const template=document.createElement('template');template.innerHTML=templatePreviewHtml(block.html)
  for(const element of template.content.querySelectorAll('p,div,h1,h2,h3,h4,h5,h6,li,blockquote,pre,td,th,br,hr')){element.before(document.createTextNode('\n'));element.after(document.createTextNode('\n'))}
  return (template.content.textContent??'').split('\n').map(line=>line.replace(/\s+/g,' ').trim()).filter(Boolean).join('\n')
 }).filter(Boolean).join('\n')
}
