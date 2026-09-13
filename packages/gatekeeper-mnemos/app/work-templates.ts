import {TemplateScopeView} from "./template-scopes.ts";
import {readTemplateProposalText,type TemplateTextDownload} from "./template-source.ts";
import type {SavedTemplateDecision} from "../src/template-review-actions.ts";
import type {MnemosAccountSession} from "../src/account-session.ts";
import type {WorkTemplateVersion,WorkTemplatePage,WorkTemplateDraft,TemplateScopePage,ScopedWorkTemplatePage,ScopedWorkTemplateVersion,TemplatePromotionPage,TemplatePromotionReview} from "../src/work-templates.ts";
import type {SavedTemplateAction,TemplateAction} from "../src/template-actions.ts";
type API=Pick<MnemosAccountSession,"resolveWorkTemplate"|"listManagedTemplateScopes"|"setTemplateScope"|"readTemplateProposalSource"|"readSavedTemplateDecision"|"saveTemplateDecision"|"executeSavedTemplateDecision"|"listTemplateReviewScopes"|"listTemplateProposals"|"readTemplateProposal"|"listTemplateScopes"|"listScopedWorkTemplates"|"readScopedWorkTemplate"|"listWorkTemplates"|"readWorkTemplate"|"readSavedTemplateAction"|"saveTemplateAction"|"deferTemplateAction"|"restoreTemplateAction"|"executeSavedTemplateAction"|"listPrivateDocuments"|"draftState">;
export class WorkTemplateView {
 private reviewText?:string;private decisionComment="";private savedDecision?:SavedTemplateDecision;
 private reviewScopes?:TemplateScopePage;private reviewScope="";private queue?:TemplatePromotionPage;private review?:TemplatePromotionReview;private proposalID="";
 private proposing=false;private target="";private proposalKey="";private expectedCatalogue="0";private proposalMessage="";
 private resolveKey="";private personalOverride="";private personalOverrideRevision="";private resolutionNotice="";
 private scope="";private scopes?:TemplateScopePage;private sharedPage?:ScopedWorkTemplatePage;private shared?:ScopedWorkTemplateVersion;
 private project="";private busy=false;private closed=false;private notice="";
 private page?:WorkTemplatePage;private selected?:WorkTemplateVersion;private saved?:SavedTemplateAction;
 private documents?:Awaited<ReturnType<API["listPrivateDocuments"]>>;
 private source?:{node:string;head:string;name:string};private title="";private purpose="";private kind:WorkTemplateDraft["kind"]="document";private name="";private revision="";
 constructor(private root:HTMLElement,private api:API,private projects:ReadonlyArray<{id:string;name:string;slug:string}>,private close:()=>void,private downloadText?:TemplateTextDownload){}
 private async run(work:()=>Promise<void>){if(this.busy||this.closed)return;this.busy=true;this.notice="";this.render();try{await work();}catch{if(this.review){try{this.savedDecision=await this.api.readSavedTemplateDecision(this.review.proposal.proposal_id)??undefined;}catch{this.review=undefined;this.reviewText=undefined;}}this.notice="Действие не подтверждено. Проверьте права и сохранённую операцию перед повтором.";if(this.project){try{this.saved=await this.api.readSavedTemplateAction(this.project)??undefined;}catch{this.page=undefined;this.selected=undefined;}}}finally{this.busy=false;if(!this.closed)this.render();}}
 async load(project:string,cursor=""){await this.run(async()=>{this.project=project;this.proposing=false;this.scope="";this.shared=undefined;this.sharedPage=undefined;this.selected=undefined;this.source=undefined;this.documents=undefined;this.page=undefined;this.saved=undefined;const [page,saved]=await Promise.all([this.api.listWorkTemplates(project,cursor),this.api.readSavedTemplateAction(project)]);if(!this.closed){this.page=page;this.saved=saved??undefined;}});}
 private async choose(id:string,revision=0){await this.run(async()=>{this.proposing=false;this.resolutionNotice="";this.shared=undefined;const v=await this.api.readWorkTemplate(id,revision);if(v.project_id!==this.project)throw new Error("Template project changed");this.selected=v;this.title=v.title;this.purpose=v.purpose;this.kind=v.kind;this.revision=String(v.revision);this.name=v.title;this.source=undefined;this.documents=undefined;});}

 private async loadScopes(cursor=""){await this.run(async()=>{this.scopes=await this.api.listTemplateScopes(cursor);});}
 private async loadShared(scope:string,cursor=""){await this.run(async()=>{this.scope=scope;this.proposing=false;this.selected=undefined;this.shared=undefined;this.source=undefined;this.documents=undefined;this.page=undefined;this.sharedPage=undefined;this.sharedPage=await this.api.listScopedWorkTemplates(scope,cursor);});}
 private async chooseShared(scope:string,key:string,revision:number){await this.run(async()=>{this.proposing=false;this.resolutionNotice="";this.shared=undefined;this.selected=undefined;const v=await this.api.readScopedWorkTemplate(scope,key,revision);this.shared=v;this.selected=v.source;this.revision=String(v.revision);this.name=v.source.title;this.source=undefined;this.documents=undefined;});}

 private async resolveSelection(personal:boolean){await this.run(async()=>{this.selected=undefined;this.shared=undefined;this.resolutionNotice="";if(!this.scope||!this.resolveKey.trim())throw new Error("Select scope and key");
  if(personal&&(!this.personalOverride.trim()||!/^[1-9][0-9]*$/.test(this.personalOverrideRevision)))throw new Error("Select exact personal version");
  const out=await this.api.resolveWorkTemplate(this.scope,this.resolveKey,personal?{template_id:this.personalOverride,revision:Number(this.personalOverrideRevision)}:undefined);
  this.shared=out.scoped;this.selected=out.personal??out.scoped?.source;if(!this.selected)throw new Error("Missing selected source");this.revision=String(out.personal?.revision??out.scoped!.revision);this.name=this.selected.title;this.proposing=false;this.source=undefined;this.documents=undefined;
  this.resolutionNotice=out.personal?`Личное переопределение ключа ${out.template_key}: ${out.personal.template_id}, версия ${out.personal.revision}`:`Ключ ${out.template_key}: наследуется из области ${out.scoped!.scope_id}, версия ${out.scoped!.revision}`;
 });}

 private async startProposal(){await this.run(async()=>{if(!this.selected||this.selected.project_id!==this.project)throw new Error("Select source project");this.scopes=await this.api.listTemplateScopes();this.proposing=true;this.target="";this.proposalKey=this.shared?.template_key??this.selected.template_id;this.expectedCatalogue="0";this.proposalMessage="";});}
 private async propose(){await this.run(async()=>{if(!/^(0|[1-9][0-9]*)$/.test(this.expectedCatalogue))throw new Error("Explicit catalogue revision required");const target=this.scopes?.scopes.find(s=>s.scope_id===this.target);if(!target||!this.selected||this.selected.project_id!==this.project)throw new Error("Select source and target");const input={project_id:this.project,request_id:crypto.randomUUID(),revision:this.shared?.revision??this.selected.revision,...(this.shared?{source_scope_id:this.shared.scope_id}:{}),target_scope_id:target.scope_id,target_scope_revision:target.revision,template_key:this.shared?.template_key??this.proposalKey,expected_catalogue_revision:Number(this.expectedCatalogue),message:this.proposalMessage};this.saved=await this.api.saveTemplateAction(this.project,{kind:"propose",template:this.shared?.template_key??this.selected.template_id,input},this.saved?.id??"");this.saved=await this.api.executeSavedTemplateAction(this.project,this.saved.id);this.proposing=false;this.notice="Предложение отправлено. Оно ожидает независимого человеческого решения.";});}

 private async loadReviewScopes(cursor=""){await this.run(async()=>{this.reviewScopes=undefined;this.queue=undefined;this.review=undefined;this.reviewScopes=await this.api.listTemplateReviewScopes(cursor);});}
 private async loadQueue(scope:string,cursor=""){await this.run(async()=>{this.reviewScope=scope;this.queue=undefined;this.review=undefined;this.queue=await this.api.listTemplateProposals(scope,cursor);});}
 private async inspectProposal(id:string){await this.run(async()=>{this.review=undefined;this.reviewText=undefined;this.savedDecision=undefined;this.decisionComment="";const [review,saved]=await Promise.all([this.api.readTemplateProposal(id),this.api.readSavedTemplateDecision(id)]);this.review=review;this.savedDecision=saved??undefined;this.proposalID=id;if(!this.reviewScopes)this.reviewScopes=await this.api.listTemplateReviewScopes();});}

 private async previewProposal(){await this.run(async()=>{this.reviewText=undefined;if(!this.review)throw new Error("Select proposal");const id=this.review.proposal.proposal_id;if(!this.downloadText)throw new Error("Missing host download capability");const text=await readTemplateProposalText(this.api,id,this.downloadText);if(this.review?.proposal.proposal_id!==id)throw new Error("Selection changed");this.reviewText=text;});}
 private async decide(approved?:boolean){await this.run(async()=>{if(!this.review)throw new Error("Select proposal");const id=this.review.proposal.proposal_id;
  if(approved!==undefined){const scope=this.reviewScopes?.scopes.find(s=>s.scope_id===this.review!.proposal.target_scope_id);if(!scope||(approved&&this.reviewText===undefined))throw new Error("Review source and current scope first");this.savedDecision=await this.api.saveTemplateDecision(id,{request_id:crypto.randomUUID(),approved,scope_revision:scope.revision,comment:this.decisionComment});}
  if(!this.savedDecision)throw new Error("No saved decision");this.savedDecision=await this.api.executeSavedTemplateDecision(id);this.review=await this.api.readTemplateProposal(id);this.notice="Решение подтверждено.";
 });}
 private async sources(cursor=""){await this.run(async()=>{this.source=undefined;this.documents=await this.api.listPrivateDocuments(this.project,cursor);});}
 private async perform(action?:TemplateAction){await this.run(async()=>{if(action)this.saved=await this.api.saveTemplateAction(this.project,action,this.saved?.id??"");if(!this.saved)throw new Error("Missing operation");this.saved=await this.api.executeSavedTemplateAction(this.project,this.saved.id);this.documents=undefined;this.source=undefined;if(this.saved.receipt?.kind==="save"){this.selected=this.saved.receipt.version;this.revision=String(this.selected.revision);}this.notice="Операция подтверждена.";if(this.scope)this.sharedPage=await this.api.listScopedWorkTemplates(this.scope);else this.page=await this.api.listWorkTemplates(this.project);});}
 private async create(){await this.run(async()=>{if(!this.selected||!this.name.trim())throw new Error("Choose template and name");const state=await this.api.draftState(this.project);if(!state.personal_exists)throw new Error("Open project draft first");const action:TemplateAction={kind:"create",template:this.shared?.template_key??this.selected.template_id,...(this.shared?{scope:this.shared.scope_id}:{}),input:{request_id:crypto.randomUUID(),revision:this.shared?.revision??this.selected.revision,project_id:this.project,parent_id:"",name:this.name,expected_head:state.personal_head,message:"Создание по выбранной версии шаблона"}};this.saved=await this.api.saveTemplateAction(this.project,action,this.saved?.id??"");this.saved=await this.api.executeSavedTemplateAction(this.project,this.saved.id);this.notice="Документ создан в личных документах проекта.";});}
 render(){
  if(this.closed)return;
  const el=(tag:string,text="")=>{const e=document.createElement(tag);e.textContent=text;return e;};
  const button=(text:string,run:()=>void)=>{const e=document.createElement("button");e.textContent=text;e.disabled=this.busy;e.onclick=run;return e;};
  const field=(label:string,value:string,change:(v:string)=>void,multiline=false)=>{const box=el("label",label),input=multiline?document.createElement("textarea"):document.createElement("input");input.value=value;input.setAttribute("aria-label",label);input.disabled=this.busy;input.oninput=()=>change(input.value);box.append(input);this.root.append(box);};
  this.root.replaceChildren(el("h2","Рабочие шаблоны"),el("p",this.notice));
  this.root.append(el("p","Содержимое редактируется в обычном документе. Шаблон сохраняет выбранную версию и назначение."));
  this.root.append(button("Настройка областей шаблонов",()=>{const view=new TemplateScopeView(this.root,this.api,()=>{this.reviewScopes=undefined;this.scopes=undefined;this.review=undefined;this.reviewText=undefined;this.render();});void view.load();}));
  this.root.append(button("На согласование",()=>void this.loadReviewScopes()));
  field("ID заявки на шаблон",this.proposalID,v=>{this.proposalID=v;});this.root.append(button("Открыть заявку",()=>void this.inspectProposal(this.proposalID)));
  for(const scope of this.reviewScopes?.scopes??[])this.root.append(button(`Очередь: ${scope.name}`,()=>void this.loadQueue(scope.scope_id)));
  if(this.reviewScopes?.next_cursor)this.root.append(button("Следующие области согласования",()=>void this.loadReviewScopes(this.reviewScopes!.next_cursor)));
  if(this.queue){
   this.root.append(el("h3","Заявки на шаблоны"));
   if(!this.queue.proposals.length)this.root.append(el("p","На этой странице нет доступных заявок."));
   for(const item of this.queue.proposals)this.root.append(button(`${item.proposal.template_key} · ${item.proposal.user_id} · ${item.decision?(item.decision.approved?"одобрено":"отказано"):"ожидает решения"}`,()=>void this.inspectProposal(item.proposal.proposal_id)));
   if(this.queue.next_cursor)this.root.append(button("Следующие заявки",()=>void this.loadQueue(this.reviewScope,this.queue!.next_cursor)));
  }
  if(this.review){
   const p=this.review.proposal,d=this.review.decision;
   this.root.append(el("h3",`Заявка ${p.proposal_id}`),el("p",`Автор: ${p.user_id}${p.agent_id?" / "+p.agent_id:""}`),el("p",`Ключ: ${p.template_key} · целевая область ${p.target_scope_id} · конфигурация ${p.target_scope_revision}`),el("p",p.source_scope_id?`Источник: область ${p.source_scope_id}, версия ${p.source_scope_revision}`:`Источник: личный шаблон ${p.template_id}, версия ${p.template_revision}`),el("p",`Ожидаемая версия целевого каталога: ${p.expected_catalogue_revision}`),el("pre",p.message));
   if(d)this.root.append(el("p",`${d.approved?"Одобрено":"Отказано"} · ${d.reviewer_id} · ${d.created_at}`),el("pre",d.comment));
   else this.root.append(el("p","Решение ещё не принято. Доступ к заявке не означает доступ к её исходному документу."));
   this.root.append(button("Прочитать точный источник",()=>void this.previewProposal()));
   if(this.reviewText!==undefined)this.root.append(el("pre",this.reviewText));
   if(this.savedDecision&&!this.savedDecision.receipt)this.root.append(el("p",`Сохранено решение: ${this.savedDecision.input.approved?"одобрить":"отказать"}. Исход пока не подтверждён.`),el("pre",this.savedDecision.input.comment),button("Повторить сохранённое решение",()=>void this.decide()));
   else if(!d&&this.reviewScopes?.scopes.some(s=>s.scope_id===p.target_scope_id)){
    field("Комментарий согласующего",this.decisionComment,v=>{this.decisionComment=v;},true);
    if(this.reviewText!==undefined)this.root.append(button("Сохранить и одобрить",()=>void this.decide(true)));
    this.root.append(button("Сохранить и отказать",()=>void this.decide(false)));
   }

  }
  for(const p of this.projects)this.root.append(button(p.name||p.slug||p.id,()=>void this.load(p.id)));
  if(this.project){
   this.root.append(button("Личные шаблоны",()=>void this.load(this.project)),button("Общие шаблоны",()=>void this.loadScopes()));
   for(const scope of this.scopes?.scopes??[])this.root.append(button(`${scope.name} · ${scope.level}`,()=>void this.loadShared(scope.scope_id)));
   if(this.scopes?.next_cursor)this.root.append(button("Следующие области",()=>void this.loadScopes(this.scopes!.next_cursor)));
   if(this.scope){this.root.append(button("Обновить общий каталог",()=>void this.loadShared(this.scope)));
    field("Ключ шаблона для применения",this.resolveKey,v=>{this.resolveKey=v;});
    this.root.append(button("Выбрать унаследованную версию",()=>void this.resolveSelection(false)));
    field("ID личного переопределения",this.personalOverride,v=>{this.personalOverride=v;});field("Версия личного переопределения",this.personalOverrideRevision,v=>{this.personalOverrideRevision=v;});
    this.root.append(button("Выбрать личное переопределение",()=>void this.resolveSelection(true)));
   }
   if(this.saved&&!this.saved.receipt){
    this.root.append(el("p","Исход операции не подтверждён. Отложить — не значит отменить: перед новой попыткой проверьте каталог и личные документы, чтобы не создать копию."));
    if(!this.saved.deferred)this.root.append(button("Отложить и вернуться к каталогу",()=>void this.run(async()=>{this.saved=await this.api.deferTemplateAction(this.project,this.saved!.id);this.selected=undefined;this.source=undefined;this.documents=undefined;if(this.scope)this.sharedPage=await this.api.listScopedWorkTemplates(this.scope);else this.page=await this.api.listWorkTemplates(this.project);})));
   }
   for(const entry of this.saved?.history??[])this.root.append(el("p",`Отложено: ${entry.action.kind==="create"?entry.action.input.name:entry.action.kind==="save"?entry.action.input.title:entry.action.input.template_key}. Исход не подтверждён.`),button("Вернуться к операции "+entry.id,()=>void this.run(async()=>{this.saved=await this.api.restoreTemplateAction(this.project,entry.id,this.saved!.id);})));
   if(this.saved&&!this.saved.receipt&&!this.saved.deferred){
    this.root.append(el("p",this.saved.action.kind==="save"?"Сохранена операция изменения шаблона.":this.saved.action.kind==="propose"?"Сохранено предложение на согласование.":"Сохранена операция создания документа."),button("Повторить сохранённую операцию",()=>void this.perform()));
   }else{
    if(this.saved?.deferred&&!this.saved.receipt)this.root.append(button("Повторить сохранённую операцию",()=>void this.perform()));
    for(const v of this.page?.templates??[])this.root.append(button(`${v.title} · версия ${v.revision}`,()=>void this.choose(v.template_id,v.revision)));
    if(this.page?.next_cursor)this.root.append(button("Следующая страница шаблонов",()=>void this.load(this.project,this.page!.next_cursor)));
    for(const v of this.sharedPage?.templates??[])this.root.append(button(`${v.source.title} · ${v.scope_id} · версия ${v.revision}`,()=>void this.chooseShared(v.scope_id,v.template_key,v.revision)));
    if(this.sharedPage?.next_cursor)this.root.append(button("Следующая страница общих шаблонов",()=>void this.loadShared(this.scope,this.sharedPage!.next_cursor)));
    this.root.append(button("Новый шаблон из документа",()=>{this.shared=undefined;this.selected=undefined;this.title="";this.purpose="";this.kind="document";void this.sources();}));
    if(this.selected){
     if(this.resolutionNotice)this.root.append(el("p",this.resolutionNotice));
     this.root.append(el("h3",this.selected.title),el("p",`${this.selected.purpose} · версия ${this.selected.revision} · автор ${this.selected.user_id}${this.selected.agent_id?" / "+this.selected.agent_id:""}`));
     if(this.shared)this.root.append(el("p",`Общий шаблон ${this.shared.template_key} · область ${this.shared.scope_id} · утверждённая версия ${this.shared.revision} · согласовал ${this.shared.approved_by}`));
     field("Номер версии",this.revision,v=>{this.revision=v;});this.root.append(button("Открыть указанную версию",()=>{if(this.shared)void this.chooseShared(this.shared.scope_id,this.shared.template_key,Number(this.revision));else void this.choose(this.selected!.template_id,Number(this.revision));}));
     if(!this.shared)this.root.append(button("Выбрать документ для новой версии",()=>void this.sources()));
     if(this.selected.project_id===this.project)this.root.append(button("Предложить на следующий уровень",()=>void this.startProposal()));
     else this.root.append(el("p","Для предложения выберите проект исходного шаблона."));
     if(this.proposing){
      this.root.append(el("h3","Предложение на согласование"));
      const target=document.createElement("select");target.setAttribute("aria-label","Целевая область");target.disabled=this.busy;const empty=document.createElement("option");empty.value="";empty.textContent="Выберите область";target.append(empty);
      const sourceScope=this.scopes?.scopes.find(s=>s.scope_id===this.shared?.scope_id);
      for(const scope of this.scopes?.scopes??[]){if(this.shared?(sourceScope?scope.scope_id!==sourceScope.parent_id:scope.level==="group"):scope.level!=="group")continue;const option=document.createElement("option");option.value=scope.scope_id;option.textContent=`${scope.name} · конфигурация ${scope.revision}`;option.selected=scope.scope_id===this.target;target.append(option);}target.onchange=()=>{this.target=target.value;};this.root.append(target);
      if(!this.shared)field("Ключ общего шаблона",this.proposalKey,v=>{this.proposalKey=v;});
      field("Текущая версия целевого ключа (0 — новый)",this.expectedCatalogue,v=>{this.expectedCatalogue=v;});
      field("Обоснование предложения",this.proposalMessage,v=>{this.proposalMessage=v;},true);
      this.root.append(button("Сохранить и отправить предложение",()=>void this.propose()));
     }
     field("Имя рабочего документа",this.name,v=>{this.name=v;});this.root.append(button("Создать документ по этой версии",()=>void this.create()));
    }
    if(this.documents){
     this.root.append(el("h3","Исходный документ"));
     for(const d of this.documents.documents.filter(d=>!d.conflicted))this.root.append(button("Выбрать: "+d.name,()=>{this.source={node:d.node_id,head:this.documents!.head,name:d.name};if(!this.title)this.title=d.name;this.render();}));
     if(this.documents.next_cursor)this.root.append(button("Следующие документы",()=>void this.sources(this.documents!.next_cursor)));
    }
    if(this.source){
     this.root.append(el("p","Источник: "+this.source.name));field("Название шаблона",this.title,v=>{this.title=v;});field("Назначение шаблона",this.purpose,v=>{this.purpose=v;},true);
     const kind=document.createElement("select");kind.setAttribute("aria-label","Вид шаблона");kind.disabled=this.busy;
     const kinds:{value:WorkTemplateDraft["kind"];label:string}[]=[{value:"document",label:"Форма документа"},{value:"guidance",label:"Подход к работе"},{value:"agent_instructions",label:"Инструкции агента"},{value:"skill",label:"Навык"}];
     for(const item of kinds){const option=document.createElement("option");option.value=item.value;option.textContent=item.label;option.selected=item.value===this.kind;kind.append(option);}kind.onchange=()=>{const item=kinds.find(k=>k.value===kind.value);if(item)this.kind=item.value;};this.root.append(kind);
     this.root.append(button("Сохранить версию шаблона",()=>void this.perform({kind:"save",template:this.selected?.template_id??crypto.randomUUID(),input:{expected_revision:this.selected?.revision??0,title:this.title,kind:this.kind,purpose:this.purpose,project_id:this.project,node_id:this.source!.node,source_head:this.source!.head}})));
    }
   }
   if(this.saved?.receipt?.kind==="propose")this.root.append(el("p",`Предложение ${this.saved.receipt.proposal.proposal_id} отправлено в область ${this.saved.receipt.proposal.target_scope_id}. Отправка не означает одобрение.`),button("Открыть отправленную заявку",()=>void this.inspectProposal(this.saved!.receipt!.kind==="propose"?this.saved!.receipt!.proposal.proposal_id:"")));
   if(this.saved?.receipt?.kind==="save")this.root.append(el("p",`Сохранена версия ${this.saved.receipt.version.revision}: ${this.saved.receipt.version.title}`));
   if(this.saved?.receipt?.kind==="create")this.root.append(el("p",`Создан рабочий документ по версии ${this.saved.receipt.document.template_revision}. Он доступен в личных документах проекта.`));
  }
  this.root.append(button("Закрыть шаблоны",()=>{this.closed=true;this.close();}));
 }
}
