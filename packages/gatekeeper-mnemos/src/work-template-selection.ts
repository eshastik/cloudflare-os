import {validWorkTemplate,validScopedWorkTemplate,type WorkTemplateVersion,type ScopedWorkTemplateVersion} from './work-templates.ts';

/** Точная личная либо общая версия; ссылка не предоставляет полномочий. */
export type {WorkTemplateReference} from '@gadgets/workshop-shared/work-template';
import type {WorkTemplateReference,ChatWorkTemplateChoice} from '@gadgets/workshop-shared/work-template';
/** Весь проверенный набор входов; ревизия каталога и ревизия источника различаются. */
export interface WorkTemplateSelection {materials:Array<{reference:WorkTemplateReference;personal?:WorkTemplateVersion;scoped?:ScopedWorkTemplateVersion}>}

export {checkedTemplateReferences} from '@gadgets/workshop-shared/work-template';
import {checkedTemplateReferences} from '@gadgets/workshop-shared/work-template';

/** Отвергает частичный ответ, перестановку и подмену выбранных версий. */
export function validTemplateSelection(value:WorkTemplateSelection,refs:WorkTemplateReference[]):boolean{
 if(!value||!Array.isArray(value.materials)||value.materials.length!==refs.length)return false;
 return value.materials.every((item,index)=>{
  if(!item||!item.reference)return false;
  let received:WorkTemplateReference[];try{received=checkedTemplateReferences([item.reference]);}catch{return false;}
  const ref=refs[index];if(JSON.stringify(received[0])!==JSON.stringify(ref))return false;
  if('template_id' in ref)return item.scoped===undefined&&!!item.personal&&validWorkTemplate(item.personal)&&item.personal.template_id===ref.template_id&&item.personal.revision===ref.revision;
  return item.personal===undefined&&!!item.scoped&&validScopedWorkTemplate(item.scoped)&&item.scoped.scope_id===ref.scope_id&&item.scoped.template_key===ref.template_key&&item.scoped.revision===ref.revision;
 });
}

/** Каталог и история используют только необходимые человеку поля снимка. */
export function templateSelectionChoices(selection:WorkTemplateSelection):ChatWorkTemplateChoice[]{
 return selection.materials.map(item=>{const source=item.personal??item.scoped!.source;return {reference:item.reference,title:source.title,purpose:source.purpose,kind:source.kind};});
}
