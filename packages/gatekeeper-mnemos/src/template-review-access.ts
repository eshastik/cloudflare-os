import type {MnemosAccountSession} from './account-session.ts';
import type {TemplateScope,WorkTemplateVersion} from './work-templates.ts';

export interface TemplateReviewAccess {
 key:string;
 reviewers:{id:string;name:string;canRead:boolean}[];
}

export async function templateReviewAccess(session:MnemosAccountSession,version:WorkTemplateVersion,scopeId:string,revision:number){
 const identity=await session.whoAmI();
 if(identity.subject.user_id!==version.user_id)throw Error('Пригласить согласующих может автор личного шаблона');
 const scopes:TemplateScope[]=[];let cursor='';
 do{const page=await session.listTemplateScopes(cursor);scopes.push(...page.scopes);cursor=page.next_cursor||'';}while(cursor);
 const path:TemplateScope[]=[];let id=scopeId;
 const levels=['group','department','organization'];
 const first=scopes.find(s=>s.scope_id===scopeId&&s.enabled),start=levels.indexOf(first?.level??'');
 if(start<0)throw Error('Область согласования недоступна');
 for(const level of levels.slice(start)){
  const scope=scopes.find(s=>s.scope_id===id&&s.enabled&&s.level===level);
  if(!scope||path.some(s=>s.scope_id===id))throw Error('Область согласования недоступна');
  path.push(scope);id=scope.parent_id;
 }
 if(id||path[0].revision!==revision)throw Error('Правила согласования изменились');
 const author=identity.subject.user_id;
 const reviewers=new Set(path[0].approvers.filter(u=>u!==author));
 if(!reviewers.size)throw Error('Нужен другой сотрудник для согласования');
 for(const scope of path)for(const requirement of scope.review_requirements??[])for(const user of requirement.approvers){
  if(user===author)throw Error('Автор не может согласовать содержание своего предложения');
  reviewers.add(user);
 }
 const {head}=await session.openDraft(version.project_id);
 const source=await session.downloadPrivateVersion(version.project_id,version.node_id,version.source_head);
 const current=await session.downloadPrivateVersion(version.project_id,version.node_id,head);
 if(source.sha256_hex!==current.sha256_hex||source.size_bytes!==current.size_bytes||source.content_type!==current.content_type||source.content_type!==version.content_type)throw Error('Личный документ изменился после сохранения шаблона');
 const participants:Awaited<ReturnType<MnemosAccountSession['listPrivateDraftParticipants']>>['participants']=[];cursor='';
 do{const page=await session.listPrivateDraftParticipants(version.project_id,version.node_id,head,cursor);participants.push(...page.participants);cursor=page.next_cursor||'';}while(cursor);
 const people=[...reviewers].sort().map(id=>{
  const person=participants.find(p=>p.principal_id===id);
  if(!person)throw Error('Назначенный согласующий недоступен');
  return {id,name:person.display_name||id,canRead:person.can_read&&(person.mode==='read'||person.mode==='write'),mode:person.mode};
 });
 const key=JSON.stringify([version.template_id,version.revision,version.node_id,version.source_head,source.sha256_hex,path.map(s=>[s.scope_id,s.revision]),people.map(p=>p.id)]);
 return {path:path.map(s=>[s.scope_id,s.revision]),key,reviewers:people.map(({id,name,canRead})=>({id,name,canRead})),people,head};
}

export async function shareTemplateForReview(session:MnemosAccountSession,version:WorkTemplateVersion,scope:string,revision:number,key:string):Promise<TemplateReviewAccess>{
 let plan=await templateReviewAccess(session,version,scope,revision);
 if(plan.key!==key)throw Error('Состав согласующих или версия изменились');
 for(const id of plan.reviewers.map(p=>p.id)){
  plan=await templateReviewAccess(session,version,scope,revision);
  if(plan.key!==key)throw Error('Состав согласующих или версия изменились');
  const person=plan.people.find(p=>p.id===id)!;
  if(person.canRead)continue;
  if(person.mode==='write')throw Error('Существующее право записи не изменено. Проверьте доступ согласующего');
  await session.setPrivateDraftParticipant(version.project_id,version.node_id,plan.head,id,person.mode,'read');
 }
 plan=await templateReviewAccess(session,version,scope,revision);
 if(plan.key!==key||plan.reviewers.some(p=>!p.canRead))throw Error('Доступ согласующих не подтверждён');
 return {key:plan.key,reviewers:plan.reviewers};
}
