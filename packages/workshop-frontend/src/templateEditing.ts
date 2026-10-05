import {checkedTemplateReferences,type WorkTemplateReference} from '@gadgets/workshop-shared/work-template'

export type TemplateEditingContext={accountId:number;projectId:string;reference:WorkTemplateReference;autoOpen?:boolean}
export function templateEditingContext(value:unknown):TemplateEditingContext|undefined{
 try{
  if(typeof value==='string')value=JSON.parse(value)
  if(!value||typeof value!=='object')return
  const item=value as Partial<TemplateEditingContext>
  if(!Number.isSafeInteger(item.accountId)||item.accountId!<0||typeof item.projectId!=='string'||!item.projectId.trim()||item.projectId.length>255)return
  const reference=checkedTemplateReferences([item.reference])[0]
  if(!('template_id' in reference)&&!('scope_id' in reference))return
  if(item.autoOpen!==undefined&&typeof item.autoOpen!=='boolean')return
  return {accountId:item.accountId!,projectId:item.projectId,reference,...(item.autoOpen?{autoOpen:true}:{})}
 }catch{return}
}
