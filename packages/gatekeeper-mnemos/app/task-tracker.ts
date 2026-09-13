import {gapReference,gapResolution} from './signal-gap-task.ts';
import type {SignalGapTask} from './signal-gap-task.ts';
import type {TrackerInvitations} from "../src/account-session.ts";
import type {TrackerEditManagement,TrackerEditIntent} from "../src/tracker-edits.ts";
import type {TrackerManagement,TrackerCreationIntent,TrackerSetup} from "../src/tracker-creation.ts";
import type {MnemosAccountSession} from "../src/account-session.ts";
import {trackerAgentHandoff} from "../src/tracker-agent-handoff.ts";
const mime="application/vnd.mnemos.task-tracker+json";
type API=Pick<MnemosAccountSession,"listPrivateDocuments"|"readDraftDocument"|"saveDraftDocument"> & Partial<TrackerManagement & TrackerEditManagement & TrackerInvitations & Pick<MnemosAccountSession,"listAgentConnections"|"checkTrackerAssignee"|"readPublishedProjectSignals">>;
import {changeTrackerTask,decodeTrackerPreview,statuses,type Task,type Tracker} from "../src/tracker-artifact.ts";
export {changeTrackerTask,decodeTrackerPreview} from "../src/tracker-artifact.ts";
/** Task editing uses the document head; task fields grant no permissions. */
export class TaskTrackerView{
 private handoff?:{node:string;head:string;text:string};
 private project="";private busy=false;private closed=false;private notice="";
 private page?:Awaited<ReturnType<API["listPrivateDocuments"]>>;private selected?:{node:string;head:string;source:string;tracker:Tracker;invitation?:boolean};
 private invitedNode="";private invitations?:Awaited<ReturnType<TrackerInvitations["listInvitedTrackers"]>>;
 private creation?:TrackerCreationIntent;private setup?:TrackerSetup;
 private pendingEdit?:TrackerEditIntent;private edit?:Task;private editCreate=false;private uncertain=false;
 constructor(private root:HTMLElement,private api:API,private projects:ReadonlyArray<{id:string;name:string;slug:string}>,private close:()=>void,private download:(project:string,node:string,head:string,side:number)=>Promise<string>,private upload?:(project:string,text:string)=>Promise<string>,private workflow?:(project:string,node:string)=>void,private gapTask?:SignalGapTask){}
 private async run(work:()=>Promise<void>){if(this.closed||this.busy)return;this.busy=true;this.notice="";this.handoff=undefined;this.render();try{await work();}catch{this.selected=undefined;this.notice="Трекер недоступен. Проверьте права, версию и формат; просмотр поддерживает документы до 256 КиБ.";}finally{this.busy=false;if(!this.closed)this.render();}}
 async load(project:string,cursor=""){await this.run(async()=>{this.project=project;this.invitedNode="";this.invitations=undefined;this.pendingEdit=undefined;this.edit=undefined;this.page=undefined;this.selected=undefined;const page=await this.api.listPrivateDocuments(project,cursor);const creation=await this.api.readTrackerCreation?.(project);const invitations=await this.api.listInvitedTrackers?.(project,"");if(!this.closed){this.page=page;this.invitations=invitations;this.creation=creation??undefined;this.setup=undefined;}});}
 async open(node:string){await this.run(async()=>{
  this.selected=undefined;this.edit=undefined;this.pendingEdit=undefined;const project=this.project;const doc=await this.api.readDraftDocument(project,node);
  if(!doc.exists||doc.conflicted||doc.content_type!==mime||doc.terms.length!==1||!doc.terms[0].present||doc.terms[0].negative||doc.terms[0].metadata?.content_type!==mime)throw Error("Unavailable tracker");
  const source=await this.download(project,node,doc.head,0);const current=await this.api.readDraftDocument(project,node);
  if(current.head!==doc.head||!current.exists||current.conflicted||current.content_type!==mime)throw Error("Tracker changed");
  const tracker=decodeTrackerPreview(source);const pending=await this.api.readTrackerEdit?.(project,node);
  if(!this.closed){this.selected={node,head:doc.head,source,tracker};this.pendingEdit=pending??undefined;this.uncertain=!!pending;if(pending){this.edit=structuredClone(pending.task);this.editCreate=pending.create;this.notice="Восстановлена сохранённая правка. Сравните её с текущими задачами перед дальнейшей работой.";}}
 });}
 async prepareExternalHandoff(taskID:string){
  if(this.busy||this.closed||this.uncertain||this.edit||!this.selected||this.selected.invitation||!this.api.listAgentConnections||!this.api.checkTrackerAssignee)return;
  const selected=this.selected,project=this.project,task=selected.tracker.tasks.find(t=>t.id===taskID);
  if(!task?.assignee_id)return;
  await this.run(async()=>{
   let cursor="",agent="";const seen=new Set<string>();
   do{
    if(seen.has(cursor))throw Error("Repeated connection page");seen.add(cursor);
    const page=await this.api.listAgentConnections!(cursor);
    const connection=page.connections.find(c=>c.agent_principal_id===task.assignee_id&&!c.revoked&&!c.managed_runtime);
    if(connection){agent=connection.agent_principal_id;break;}cursor=page.next_cursor??"";
   }while(cursor);
   if(!agent){this.notice="Назначьте задачу своему подключённому внешнему агенту. Действующее внешнее подключение исполнителя не найдено.";return;}
   await this.api.checkTrackerAssignee!(project,selected.node,selected.head,agent);
   const current=await this.api.readDraftDocument(project,selected.node);
   if(current.head!==selected.head||!current.exists||current.conflicted||current.content_type!==mime)throw Error("Tracker changed");
   if(!this.closed)this.handoff={node:selected.node,head:selected.head,text:trackerAgentHandoff(project,selected.node,selected.head,selected.tracker.revision,agent,task)};
  });
 }
 async openInvitation(node:string,head:string){await this.run(async()=>{
  this.selected=undefined;this.edit=undefined;this.pendingEdit=undefined;
  const source=await this.download(this.project,node,"tracker-invitation:"+head,0);
  const tracker=decodeTrackerPreview(source);
  if(!this.closed){this.selected={node,head,source,tracker,invitation:true};this.uncertain=false;this.notice="Приглашённая версия · только просмотр. Личная ветка не изменена.";}
 });}
 async invitedPage(cursor:string,node=""){await this.run(async()=>{this.invitedNode=node;this.invitations=await this.api.listInvitedTrackers?.(this.project,cursor,node);if(!this.invitations?.documents.length)this.notice="Нет доступной приглашённой версии на этой странице.";});}
 async connectInvitation(node:string,source:string){
  if(!this.api.connectInvitedTracker)return;
  await this.run(async()=>{this.invitations=undefined;await this.api.connectInvitedTracker!(this.project,node,source);this.page=await this.api.listPrivateDocuments(this.project);this.notice="Трекер подключён к вашей личной версии. Откройте его из списка.";});
 }
 async createTracker(retry=false){
  if(!this.api.saveTrackerCreation||!this.api.executeTrackerCreation)return;
  await this.run(async()=>{
   try{
    if(!retry){if(!this.setup)throw Error("Missing tracker setup");const setup=structuredClone(this.setup);setup.transitions=setup.stages.slice(1).map((stage,index)=>({from:setup.stages[index].id,to:stage.id}));this.creation=await this.api.saveTrackerCreation!(this.project,setup,this.creation?.id??"");}
    if(!this.creation)throw Error("Missing creation request");this.creation=await this.api.executeTrackerCreation!(this.project,this.creation.id);this.setup=undefined;this.page=await this.api.listPrivateDocuments(this.project);this.notice="Трекер создан. Откройте документ из списка.";
   }catch{try{this.creation=await this.api.readTrackerCreation?.(this.project)??this.creation;}catch{}this.notice="Создание не подтверждено. Сохранённая заявка доступна для точного повтора после восстановления связи.";}
  });
 }
 async checkGap(taskID:string){
  if(this.busy||this.closed||this.uncertain||this.edit||!this.selected||this.selected.invitation||!this.api.readPublishedProjectSignals)return;
  const task=this.selected.tracker.tasks.find(t=>t.id===taskID),reference=task&&gapReference(task.description);
  if(!task||!reference||reference.project!==this.project)return;
  this.busy=true;this.notice='';this.render();
  try{
   const current=await this.api.readPublishedProjectSignals(this.project);
   const result=gapResolution(task.description,current);
   if(!this.closed){this.editCreate=false;this.edit={...structuredClone(task),status:'done',blocker:'',result};this.notice='Новое измерение подтверждено. Проверьте результат и сохраните задачу; остальные пробелы проекта оцениваются отдельно.';}
  }catch{this.notice='Устранение не подтверждено: нужна новая опубликованная оценка с теми же требованиями и свежим измерением этого сигнала. Проверьте также доступ.';}
  finally{this.busy=false;if(!this.closed)this.render();}
 }
 prepareGapTask(){
  if(this.busy||this.closed||this.uncertain||!this.selected||this.selected.invitation||!this.gapTask||this.gapTask.project!==this.project)return;
  const existing=this.selected.tracker.tasks.find(t=>t.id===this.gapTask!.id);
  this.editCreate=!existing;
  this.edit=existing?structuredClone(existing):{id:this.gapTask.id,title:this.gapTask.title,description:this.gapTask.description,next_step:this.gapTask.next_step,stage_id:this.selected.tracker.stages[0].id,status:'todo',assignee_id:'',dependencies:[],blocker:'',result:''};
  this.notice=existing?'Задача этого пробела уже существует.':'Назначьте ответственного и проверьте критерии. После сохранения используйте согласование и публикацию трекера.';
  this.render();
 }
 newTask(){
  if(this.busy||this.closed||this.uncertain||!this.selected||this.selected.invitation)return;
  this.editCreate=true;this.edit={id:crypto.randomUUID(),title:"",description:"",stage_id:this.selected.tracker.stages[0].id,status:"todo",assignee_id:"",dependencies:[],next_step:"",blocker:"",result:""};this.render();
 }
 async saveTask(){
  if(this.busy||this.closed||this.uncertain||!this.selected||this.selected.invitation||!this.edit||!this.upload)return;
  const selected=this.selected,project=this.project,task=structuredClone(this.edit);let writing=false;this.busy=true;this.notice="";this.render();
  try{
   if(this.gapTask?.id===task.id&&!task.assignee_id.trim())throw Error('Gap task requires assignee');
   const content=changeTrackerTask(selected.source,task,this.editCreate);const current=await this.api.readDraftDocument(project,selected.node);
   if(current.head!==selected.head||!current.exists||current.conflicted||current.content_type!==mime)throw Error("Tracker changed");
   if(this.api.prepareTrackerEdit&&this.api.claimTrackerEdit){
    this.pendingEdit=await this.api.prepareTrackerEdit(project,selected.node,{head:selected.head,source:selected.source,task,create:this.editCreate});
    writing=true;this.pendingEdit.attempted=true;await this.api.claimTrackerEdit(project,selected.node,this.pendingEdit.id);
   }
   const uploaded=await this.upload(project,content);if(this.closed)return;
   writing=true;const saved=await this.api.saveDraftDocument(project,selected.node,uploaded,selected.head);
   if(this.pendingEdit&&this.api.clearTrackerEdit){await this.api.clearTrackerEdit(project,selected.node,this.pendingEdit.id,saved.head);this.pendingEdit=undefined;}
   if(!this.closed){this.selected={node:selected.node,head:saved.head,source:content,tracker:decodeTrackerPreview(content)};this.edit=undefined;this.notice="Задача сохранена в личной версии. Общая версия пока не изменена.";}
  }catch{this.uncertain=writing||!!this.pendingEdit;this.notice=writing?"Сохранение не подтверждено. Повторная запись отключена; обновите трекер и проверьте результат. Несохранённые поля ниже можно скопировать.":"Изменение не сохранено. Проверьте поля, зависимости, права и актуальную версию.";}
  finally{this.busy=false;if(!this.closed)this.render();}
 }
 async dismissEdit(){
  if(!this.selected||!this.pendingEdit||!this.api.clearTrackerEdit)return;
  await this.run(async()=>{await this.api.clearTrackerEdit!(this.project,this.selected!.node,this.pendingEdit!.id,this.selected!.head);this.pendingEdit=undefined;this.edit=undefined;this.uncertain=false;this.notice="Сохранённая правка удалена. Текущие задачи не изменены.";});
 }
 async resumeEdit(){
  if(!this.pendingEdit||this.pendingEdit.attempted||!this.selected||this.pendingEdit.head!==this.selected.head)return;
  this.uncertain=false;await this.saveTask();
 }
 render(){
  if(this.closed)return;
  const el=(tag:string,text="")=>{const e=document.createElement(tag);e.textContent=text;return e;};
  const button=(title:string,run:()=>void)=>{const b=document.createElement("button");b.textContent=title;b.disabled=this.busy;b.onclick=run;return b;};
  this.root.replaceChildren(el("h2","Трекер проекта"),el("p",this.busy?"Загрузка…":this.notice));this.root.append(el("p","Трекер необязателен. Показана доступная вам версия документа."));
  for(const p of this.projects)this.root.append(button(p.name||p.slug||p.id,()=>void this.load(p.id)));
  if(this.page){const trackers=this.page.documents.filter(d=>d.content_type===mime);if(!trackers.length)this.root.append(el("p",this.page.next_cursor?"На этой странице трекеров нет.":"На этой странице нет доступных трекеров. Проект может работать без трекера."));for(const item of trackers){this.root.append(button(item.name+(item.conflicted?" · конфликт":""),()=>void this.open(item.node_id)));if(item.conflicted&&this.workflow)this.root.append(button(`Разрешить конфликт трекера: ${item.name}`,()=>{this.closed=true;this.workflow!(this.project,item.node_id);}));if(this.api.listInvitedTrackers)this.root.append(button(`Версия владельца: ${item.name}`,()=>void this.invitedPage("",item.node_id)));}if(this.page.next_cursor)this.root.append(button("Следующая страница",()=>void this.load(this.project,this.page!.next_cursor)));}
  if(this.invitations){
   for(const invited of this.invitations.documents){
    this.root.append(button(`Просмотреть трекер: ${invited.name} · ${invited.owner_id}`,()=>void this.openInvitation(invited.node_id,invited.head)));
    if(!this.page?.documents.some(own=>own.node_id===invited.node_id))this.root.append(button(`Подключить трекер: ${invited.name} · ${invited.owner_id}`,()=>void this.connectInvitation(invited.node_id,invited.head)));
   }
   if(this.invitations.documents.length)this.root.append(el("p","Подключение к личной версии требует права редактирования. Существующий трекер не заменяется."));
   if(this.invitations.next_cursor)this.root.append(button("Следующие приглашения",()=>void this.invitedPage(this.invitations!.next_cursor,this.invitedNode)));
  }
  if(this.project&&this.page&&this.api.saveTrackerCreation){
   if(this.creation&&!this.creation.result){this.root.append(el("p",`Сохранённая заявка: ${this.creation.setup.title}`),button("Повторить создание трекера",()=>void this.createTracker(true)));}
   else this.root.append(button("Создать трекер",()=>{this.setup={title:"Трекер проекта",stages:[{id:crypto.randomUUID(),name:"Работа",department:"Команда"}],transitions:[]};this.render();}));
   if(this.creation?.result)this.root.append(button("Открыть созданный трекер",()=>void this.open(this.creation!.result!.node_id)));
  }
  if(this.setup&&(!this.creation||this.creation.result)){
   const setup=this.setup;const input=(label:string,value:string,change:(v:string)=>void)=>{const box=el("label",label),field=document.createElement("input");field.value=value;field.disabled=this.busy;field.setAttribute("aria-label",label);field.oninput=()=>change(field.value);box.append(field);this.root.append(box);};
   input("Название трекера",setup.title,v=>{setup.title=v;});this.root.append(el("p","Задачи переходят между этапами в указанном порядке."));
   setup.stages.forEach((stage,index)=>{input(`Название этапа ${index+1}`,stage.name,v=>{stage.name=v;});input(`Отдел этапа ${index+1}`,stage.department,v=>{stage.department=v;});});
   if(setup.stages.length<64)this.root.append(button("Добавить этап",()=>{setup.stages.push({id:crypto.randomUUID(),name:"Следующий этап",department:"Команда"});this.render();}));
   this.root.append(button("Сохранить заявку и создать трекер",()=>void this.createTracker()),button("Отменить создание",()=>{this.setup=undefined;this.render();}));
  }
  if(this.gapTask&&this.selected&&!this.selected.invitation&&!this.edit&&!this.uncertain&&this.gapTask.project===this.project)this.root.append(button('Подготовить задачу по пробелу',()=>this.prepareGapTask()));
  if(this.selected){const {tracker,node}=this.selected;if(this.workflow&&!this.selected.invitation&&!this.edit)this.root.append(button("Согласование и публикация трекера",()=>{this.closed=true;this.workflow!(this.project,node);}));if(this.upload&&!this.uncertain&&!this.selected.invitation)this.root.append(button("Новая задача",()=>this.newTask()));this.root.append(el("h3",`${tracker.title} · версия ${tracker.revision}`),button("Обновить трекер",()=>void (this.selected!.invitation?this.openInvitation(node,this.selected!.head):this.open(node))));for(const stage of tracker.stages){this.root.append(el("h4",`${stage.name} · ${stage.department}`));for(const task of tracker.tasks.filter(t=>t.stage_id===stage.id)){const article=el("article");article.append(el("h5",task.title),el("p",`${statuses[task.status]} · Ответственный: ${task.assignee_id||"не назначен"}`),el("p",task.description),el("p",`Следующий шаг: ${task.next_step||"не указан"}`));if(task.dependencies.length)article.append(el("p",`Зависимости: ${task.dependencies.map(id=>tracker.tasks.find(t=>t.id===id)!.title).join(", ")}`));if(task.blocker)article.append(el("p",`Причина блокировки: ${task.blocker}`));if(task.result)article.append(el("p",`Результат: ${task.result}`));if(!this.selected.invitation&&this.api.readPublishedProjectSignals&&gapReference(task.description)?.project===this.project&&!this.edit)article.append(button('Проверить устранение пробела',()=>void this.checkGap(task.id)));if(task.assignee_id&&!this.selected.invitation&&this.api.listAgentConnections&&this.api.checkTrackerAssignee&&!this.edit&&!this.uncertain)article.append(button("Поручение внешнему агенту",()=>void this.prepareExternalHandoff(task.id)));if(this.upload&&!this.selected.invitation)article.append(button("Изменить задачу",()=>{if(this.uncertain)return;this.edit=structuredClone(task);this.editCreate=false;this.render();}));this.root.append(article);}}}
  if(this.handoff&&this.selected&&!this.edit&&this.handoff.node===this.selected.node&&this.handoff.head===this.selected.head){
   this.root.append(el("h3","Поручение для Codex / Claude Code"),el("p","Скопируйте поручение в клиент назначенного агента с подключённым Mnemos. Ответ и изменения проверяйте в трекере."));
   const text=document.createElement("textarea");text.readOnly=true;text.rows=12;text.value=this.handoff.text;text.setAttribute("aria-label","Поручение внешнему агенту");this.root.append(text,button("Выделить поручение",()=>{text.focus();text.select();}));
  }
  if(this.edit&&this.selected){
   const editing=this.edit;this.root.append(el("h3",`Изменение: ${editing.title}`));
   const field=(label:string,key:"title"|"description"|"assignee_id"|"next_step"|"blocker"|"result")=>{const box=el("label",label),input=document.createElement("textarea");input.value=editing[key];input.setAttribute("aria-label",label);input.disabled=this.busy;input.readOnly=this.uncertain;input.oninput=()=>{editing[key]=input.value;};box.append(input);this.root.append(box);};
   field("Название задачи","title");field("Описание задачи","description");field("Ответственный","assignee_id");
   const select=(label:string,key:"status"|"stage_id",items:{id:string;label:string}[])=>{const box=el("label",label),input=document.createElement("select");input.setAttribute("aria-label",label);for(const item of items){const option=document.createElement("option");option.value=item.id;option.textContent=item.label;input.append(option);}input.value=editing[key];input.disabled=this.busy||this.uncertain;input.onchange=()=>{editing[key]=input.value;};box.append(input);this.root.append(box);};
   select("Статус задачи","status",Object.entries(statuses).map(([id,label])=>({id,label})));select("Этап задачи","stage_id",this.selected.tracker.stages.map(s=>({id:s.id,label:`${s.name} · ${s.department}`})));
   const dependencies=el("fieldset");dependencies.append(el("legend","Зависит от задач"));
   for(const other of this.selected.tracker.tasks.filter(t=>t.id!==editing.id)){const label=el("label",other.title),checkbox=document.createElement("input");checkbox.type="checkbox";checkbox.checked=editing.dependencies.includes(other.id);checkbox.disabled=this.busy||this.uncertain;checkbox.setAttribute("aria-label",`Зависимость: ${other.title}`);checkbox.onchange=()=>{editing.dependencies=checkbox.checked?[...new Set([...editing.dependencies,other.id])]:editing.dependencies.filter(id=>id!==other.id);};label.prepend(checkbox);dependencies.append(label);}this.root.append(dependencies);
   field("Следующий шаг","next_step");field("Причина блокировки","blocker");field("Результат задачи","result");
   if(this.pendingEdit){
    this.root.append(el("p",this.pendingEdit.attempted?"Результат прошлой попытки требует проверки. Повторная запись отключена; сохранённые поля доступны для копирования.":"Правка сохранена до отправки."));
    if(!this.pendingEdit.attempted&&this.pendingEdit.head===this.selected.head)this.root.append(button("Продолжить сохранённую правку",()=>void this.resumeEdit()));
    this.root.append(button("Проверил результат — удалить сохранённую правку",()=>void this.dismissEdit()));
   }
   if(!this.uncertain)this.root.append(button("Сохранить задачу",()=>void this.saveTask()),button("Отменить правку",()=>{this.edit=undefined;this.render();}));
  }
  this.root.append(button("Закрыть трекер",()=>{this.closed=true;this.close();}));
 }
}
