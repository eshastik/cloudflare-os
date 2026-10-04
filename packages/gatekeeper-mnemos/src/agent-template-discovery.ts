import type {MnemosAccountSession} from './account-session.ts';
import {templateSelectionChoices} from './work-template-selection.ts';

type Session=Pick<MnemosAccountSession,'listTemplateScopes'|'listScopedWorkTemplates'|'resolveWorkTemplate'>;

/** Метаданные доступных областей. Чтение каталога не даёт права применить шаблон. */
export async function listAgentTemplateScopes(session:Session,cursor:string){
 const page=await session.listTemplateScopes(cursor);
 return {scopes:page.scopes.map(scope=>({scopeId:scope.scope_id,name:scope.name,level:scope.level,parentId:scope.parent_id})),nextCursor:page.next_cursor??''};
}

/** Ближайшие доступные версии выбранной области; права и наследование проверяет Mnemos. */
export async function listAgentTemplates(session:Session,scope:string,cursor:string){
 const page=await session.listScopedWorkTemplates(scope,cursor);
 return {selectedScopeId:page.selected_scope_id,templates:templateSelectionChoices({materials:page.templates.map(scoped=>({reference:{scope_id:scoped.scope_id,template_key:scoped.template_key,revision:scoped.revision},scoped}))}),nextCursor:page.next_cursor??''};
}

/** Разрешение версии делает сервер. Личные замены не выбираются автоматически. */
export async function resolveAgentTemplate(session:Session,scope:string,key:string){
 const resolved=await session.resolveWorkTemplate(scope,key);
 if(!resolved.scoped||resolved.personal)throw new Error('Mnemos не подтвердил общую версию шаблона.');
 const scoped=resolved.scoped;
 return {selectedScopeId:resolved.selected_scope_id,template:templateSelectionChoices({materials:[{reference:{scope_id:scoped.scope_id,template_key:scoped.template_key,revision:scoped.revision},scoped}]})[0]};
}
