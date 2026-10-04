import {checkedTemplateReferences,type WorkTemplateReference} from '@gadgets/workshop-shared/work-template';
import type {MnemosAccountSession} from './account-session.ts';

/** Один запрос создания; requestId сохраняется при повторе после потери ответа. */
export interface TemplateDocumentInput {project:string;form:WorkTemplateReference;references:WorkTemplateReference[];requestId:string;name:string;parentId?:string}

/** Использует существующее сохранённое намерение и агентскую сессию. */
export async function createTemplateDocument(session:Pick<MnemosAccountSession,'readWorkTemplateSelection'|'draftState'|'openDraft'|'readSavedTemplateAction'|'saveTemplateAction'|'executeSavedTemplateAction'>,input:TemplateDocumentInput){
 const refs=checkedTemplateReferences(input.references);const form=checkedTemplateReferences([input.form])[0];
 const key=JSON.stringify(form);
 if(!refs.some(r=>JSON.stringify(r)===key))throw new Error('Форма должна входить в выбранный набор.');
 const {project,requestId,name}=input;const parentId=input.parentId??'';
 if([project,requestId].some(v=>typeof v!=='string'||!v.trim()||new TextEncoder().encode(v).length>255||v.includes('\0'))||typeof name!=='string'||!name.trim()||new TextEncoder().encode(name).length>255||name.includes('\0')||typeof parentId!=='string'||new TextEncoder().encode(parentId).length>255||parentId.includes('\0'))throw new Error('Некорректные параметры документа.');
 const selected=await session.readWorkTemplateSelection(refs);
 const chosen=selected.materials.find(m=>JSON.stringify(m.reference)===key);const source=chosen?.personal??chosen?.scoped?.source;
 if(!source||source.kind!=='document'||!['text/plain','text/markdown','application/vnd.cloudflareos.document+json'].includes(source.content_type))throw new Error('Выберите поддерживаемую форму документа.');
 const previous=await session.readSavedTemplateAction(project);
 let saved;
 if(previous?.action.kind==='create'&&previous.action.input.request_id===requestId){
  const action=previous.action;const oldForm=action.scope?{scope_id:action.scope,template_key:action.template,revision:action.input.revision}:{template_id:action.template,revision:action.input.revision};
  if(JSON.stringify(oldForm)!==key||JSON.stringify(action.input.references)!==JSON.stringify(refs)||action.input.name!==name||action.input.parent_id!==parentId)throw new Error('Запрос уже сохранён с другими входами.');
  saved=previous;
 }else{
  if(previous&&!previous.receipt&&!previous.deferred)throw new Error('Сначала завершите сохранённую операцию шаблона в этом проекте.');
  let state=await session.draftState(project);
  if(!state.personal_exists){await session.openDraft(project);state=await session.draftState(project);}
  if(!state.personal_exists||!state.personal_head)throw new Error('Личная ветка проекта недоступна.');
  saved=await session.saveTemplateAction(project,{kind:'create',template:form.template_id??form.template_key,...(form.scope_id?{scope:form.scope_id}:{}),input:{references:refs,request_id:requestId,revision:form.revision,project_id:project,parent_id:parentId,name,expected_head:state.personal_head,message:'Создание документа по выбранным шаблонам'}},previous?.id??'');
 }
 const completed=await session.executeSavedTemplateAction(project,saved.id,true);
 if(completed.receipt?.kind!=='create')throw new Error('Mnemos не подтвердил создание документа.');
 return {project,name,operationId:requestId,document:completed.receipt.document,references:refs,contentType:source.content_type};
}
