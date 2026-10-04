import {checkedTemplateReferences,type WorkTemplateDocumentOrigin,type DocumentTemplateOriginView} from '@gadgets/workshop-shared/work-template';
import type {MnemosAccountSession} from './account-session.ts';
import {templateSelectionChoices} from './work-template-selection.ts';

/** Отвергает подмену результата, неполный набор входов и неподтверждённую форму. */
export function checkedDocumentTemplateOrigin(value:unknown,project:string,node:string,head:string):WorkTemplateDocumentOrigin|null {
 if(value===null)return null;
 const out=value as WorkTemplateDocumentOrigin;
 const id=(v:unknown,empty=false):v is string=>typeof v==='string'&&(empty||!!v.trim())&&new TextEncoder().encode(v).length<=255&&!v.includes('\0');
 if(!out||out.project_id!==project||out.node_id!==node||out.head!==head||!id(out.initiated_by)||!id(out.executed_by,true)||!id(out.operation_id)||!Number.isSafeInteger(out.created_at_ms)||out.created_at_ms<0||!Array.isArray(out.inputs))throw Error('Происхождение документа не подтверждено');
 const form=checkedTemplateReferences([out.form])[0];
 const refs=checkedTemplateReferences(out.inputs.map(v=>v?.reference));
 if(!refs.some(ref=>JSON.stringify(ref)===JSON.stringify(form))||out.inputs.some(v=>!v||typeof v.source_head!=='string'||!/^[a-f0-9]{64}$/.test(v.source_head)||/^0+$/.test(v.source_head)))throw Error('Происхождение документа не подтверждено');
 return {project_id:project,node_id:node,head,initiated_by:out.initiated_by,executed_by:out.executed_by,operation_id:out.operation_id,created_at_ms:out.created_at_ms,form,inputs:refs.map((reference,i)=>({reference,source_head:out.inputs[i].source_head}))};
}

/** Названия берутся из закреплённых версий; последний запрос повторно проверяет актуальные права. */
export async function readDocumentTemplateOriginView(session:Pick<MnemosAccountSession,'readDocumentTemplateOrigin'|'readWorkTemplateSelection'>,project:string,node:string,head:string):Promise<DocumentTemplateOriginView|null> {
 const origin=await session.readDocumentTemplateOrigin(project,node,head);
 if(!origin)return null;
 const selection=await session.readWorkTemplateSelection(origin.inputs.map(v=>v.reference));
 const materials=templateSelectionChoices(selection);
 if(selection.materials.some((v,i)=>(v.personal??v.scoped!.source).source_head!==origin.inputs[i].source_head))throw Error('Исходная версия шаблона не совпала');
 const current=await session.readDocumentTemplateOrigin(project,node,head);
 if(JSON.stringify(current)!==JSON.stringify(origin))throw Error('Происхождение документа недоступно');
 return {...origin,materials};
}
