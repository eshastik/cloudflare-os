import {checkedTemplateReferences,type WorkTemplateReference} from '@gadgets/workshop-shared/work-template';
import type {MnemosAccountSession} from './account-session';
import {MnemosAPIError} from './mnemos-api.ts';

export type TemplateAgentAccessPlan={bindingId:string;ready:boolean;scopes:{scopeId:string;title:string;revision:number;enabled:boolean}[]};
type Human=Pick<MnemosAccountSession,'readWorkTemplateSelection'|'listTemplateScopes'|'readTemplateAgentGrant'|'setTemplateAgentGrant'>;
type Agent=Pick<MnemosAccountSession,'readWorkTemplateSelection'>;
export async function templateAgentAccess(human:Human,agent:Agent,bindingId:string,references:WorkTemplateReference[]):Promise<TemplateAgentAccessPlan>{
 const refs=checkedTemplateReferences(references);await human.readWorkTemplateSelection(refs);
 const ids=[...new Set(refs.flatMap(ref=>typeof ref.scope_id==='string'?[ref.scope_id]:[]))];
 const scopes:TemplateAgentAccessPlan['scopes']=[];let cursor='';const names=new Map<string,string>();
 if(ids.length)do{const page=await human.listTemplateScopes(cursor);for(const scope of page.scopes)if(scope.enabled)names.set(scope.scope_id,scope.name);cursor=page.next_cursor||'';}while(cursor);
 for(const scopeId of ids){const title=names.get(scopeId);if(!title)throw Error('Область шаблона больше недоступна');const grant=await human.readTemplateAgentGrant(bindingId,scopeId);scopes.push({scopeId,title,revision:grant.revision,enabled:grant.enabled});}
 let ready=true;try{await agent.readWorkTemplateSelection(refs);}catch(error){if(!(error instanceof MnemosAPIError)||error.status!==403)throw error;ready=false;}
 return {bindingId,ready,scopes};
}
export async function allowTemplateAgentAccess(human:Human,agent:Agent,bindingId:string,references:WorkTemplateReference[],scopeId:string,expectedBinding:string,expectedRevision:number){
 if(expectedBinding!==bindingId)throw Error('Подключение агента изменилось');
 const plan=await templateAgentAccess(human,agent,bindingId,references),scope=plan.scopes.find(item=>item.scopeId===scopeId);
 if(!scope||scope.revision!==expectedRevision)throw Error('Разрешение изменилось; повторите проверку');
 if(!scope.enabled)await human.setTemplateAgentGrant(bindingId,scopeId,scope.revision,true);
 return templateAgentAccess(human,agent,bindingId,references);
}
