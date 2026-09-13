import type {ResourceMapManagement,ResourceMapCreationIntent} from "../src/resource-map-creation.ts";
import type {ResourceMapEditManagement,ResourceMapEditIntent} from "../src/resource-map-edits.ts";
import type {MnemosAccountSession} from "../src/account-session.ts";
import type {ObservabilityInquiry} from '../src/observability-inquiry.ts';
import {changeResourceMap,decodeResourceMap,resourceMapMime,resourceKinds,resourceRelations,type ResourceMap} from "../src/resource-map-artifact.ts";
type API=Pick<MnemosAccountSession,"listPrivateDocuments"|"readDraftDocument"> & Partial<Pick<MnemosAccountSession,"saveDraftDocument"> & ResourceMapManagement & ResourceMapEditManagement & {browseProject:(project:string,cursor:string)=>ReturnType<MnemosAccountSession["browseProject"]>;nodeHistory:(project:string,node:string,cursor:string)=>ReturnType<MnemosAccountSession["nodeHistory"]>}>;

/** Show only the selected document after checking its version and access again. */
export class ResourceMapView {
 private project="";private busy=false;private closed=false;private notice="";
 private page?:Awaited<ReturnType<API["listPrivateDocuments"]>>;
 private selected?:{node:string;head:string;source:string;map:ResourceMap;published?:boolean};
 private shared?:{documents:{node:string;name:string}[];cursor:string};
 private creation?:ResourceMapCreationIntent;private newTitle:string|undefined;private edit?:ResourceMap;private pending?:ResourceMapEditIntent;private uncertain=false;
 constructor(private root:HTMLElement,private api:API,private projects:ReadonlyArray<{id:string;name:string;slug:string}>,private close:()=>void,private download:(project:string,node:string,head:string,side:number)=>Promise<string>,private upload?:(project:string,text:string)=>Promise<string>,private workflow?:(project:string,node:string)=>void,private assess?:(source:ObservabilityInquiry)=>void){}
 async prepareAssessment(){await this.run(async()=>{
  const selected=this.selected;
  if(!selected||!this.assess||this.edit||this.pending)throw Error('Map not selected');
  if(selected.published){
   if(!this.api.nodeHistory)throw Error('History unavailable');
   const current=(await this.api.nodeHistory(this.project,selected.node,'')).events[0];
   if(!current?.exists||current.head!==selected.head||current.content_type!==resourceMapMime)throw Error('Map changed');
  }else{
   const current=await this.api.readDraftDocument(this.project,selected.node);
   if(!current.exists||current.conflicted||current.head!==selected.head||current.content_type!==resourceMapMime)throw Error('Map changed');
  }
  if(!this.closed){this.assess({project:this.project,node:selected.node,head:selected.head,source:selected.published?'published':'draft'});this.closed=true;}
 });}
 private async run(work:()=>Promise<void>){if(this.closed||this.busy)return;this.busy=true;this.notice="";this.render();try{await work();}catch{this.selected=undefined;this.notice="Карта недоступна. Проверьте права, версию и формат документа.";}finally{this.busy=false;if(!this.closed)this.render();}}
 async load(project:string,cursor=""){await this.run(async()=>{this.project=project;this.page=undefined;this.shared=undefined;this.selected=undefined;this.edit=undefined;this.pending=undefined;this.newTitle=undefined;const page=await this.api.listPrivateDocuments(project,cursor);const creation=await this.api.readResourceMapCreation?.(project);if(!this.closed){this.page=page;this.creation=creation??undefined;this.shared=await this.publishedPage(project,"");}});}

 private async publishedPage(project:string,cursor:string){
  if(!this.api.browseProject||!this.api.nodeHistory)return undefined;
  const page=await this.api.browseProject(project,cursor),documents:{node:string;name:string}[]=[];
  // Browse is already authorized and paginated. Do not probe hidden node IDs.
  for(const node of page.nodes){if(node.is_dir||node.shared_deleted)continue;const history=await this.api.nodeHistory(project,node.node_id,""),latest=history.events[0];if(latest?.exists&&latest.content_type===resourceMapMime)documents.push({node:node.node_id,name:node.name});}
  return {documents,cursor:page.next_cursor??""};
 }
 async sharedPage(cursor:string){await this.run(async()=>{this.selected=undefined;this.edit=undefined;this.pending=undefined;this.shared=undefined;this.shared=await this.publishedPage(this.project,cursor);});}
 async openPublished(node:string){await this.run(async()=>{
  this.selected=undefined;this.edit=undefined;this.pending=undefined;this.uncertain=false;
  if(!this.api.nodeHistory)throw Error("History unavailable");
  const project=this.project,latest=(await this.api.nodeHistory(project,node,"")).events[0];
  if(!latest?.exists||latest.content_type!==resourceMapMime)throw Error("Published map unavailable");
  const source=await this.download(project,node,"publication:"+latest.event_id,0),current=(await this.api.nodeHistory(project,node,"")).events[0];
  if(!current?.exists||current.content_type!==resourceMapMime||current.event_id!==latest.event_id||current.head!==latest.head)throw Error("Publication changed");
  const map=decodeResourceMap(source);if(!this.closed)this.selected={node,head:latest.head,source,map,published:true};
 });}
 async open(node:string){await this.run(async()=>{
  this.selected=undefined;this.edit=undefined;this.pending=undefined;const project=this.project,doc=await this.api.readDraftDocument(project,node);
  const valid=(d:typeof doc)=>d.exists&&!d.conflicted&&d.content_type===resourceMapMime&&d.terms.length===1&&d.terms[0].present&&!d.terms[0].negative&&d.terms[0].metadata?.content_type===resourceMapMime;
  if(!valid(doc))throw Error("Unavailable map");
  const source=await this.download(project,node,doc.head,0),current=await this.api.readDraftDocument(project,node);
  if(!valid(current)||current.head!==doc.head)throw Error("Map changed");
  const map=decodeResourceMap(source),pending=await this.api.readResourceMapEdit?.(project,node);if(!this.closed){this.selected={node,head:doc.head,source,map};this.pending=pending??undefined;this.uncertain=!!pending;if(pending){this.edit=structuredClone(pending.map);this.notice="Восстановлена сохранённая правка. Сравните её с текущей картой перед дальнейшей записью.";}}
 });}

 async create(retry=false){await this.run(async()=>{
  try{
   if(!this.api.saveResourceMapCreation||!this.api.executeResourceMapCreation)throw Error("Creation unavailable");
   if(!retry){if(this.newTitle===undefined)throw Error("Missing title");this.creation=await this.api.saveResourceMapCreation(this.project,{title:this.newTitle},this.creation?.id??"");}
   if(!this.creation)throw Error("Missing creation intent");this.creation=await this.api.executeResourceMapCreation(this.project,this.creation.id);this.newTitle=undefined;this.page=await this.api.listPrivateDocuments(this.project);this.notice="Карта создана в личной версии проекта.";
  }catch{try{this.creation=await this.api.readResourceMapCreation?.(this.project)??this.creation;}catch{}this.notice="Создание не подтверждено. Сохранённую заявку можно повторить без создания дубликата.";}
 });}
 async save(){
  if(this.busy||this.closed||this.uncertain||!this.edit||!this.selected||this.selected.published||!this.upload||!this.api.prepareResourceMapEdit||!this.api.claimResourceMapEdit||!this.api.clearResourceMapEdit||!this.api.saveDraftDocument)return;
  const selected=this.selected,project=this.project,edited=structuredClone(this.edit);let writing=false;this.busy=true;this.notice="";this.render();
  try{
   const content=changeResourceMap(selected.source,edited);
   this.pending=await this.api.prepareResourceMapEdit(project,selected.node,{head:selected.head,source:selected.source,map:edited});
   writing=true;this.pending.attempted=true;await this.api.claimResourceMapEdit(project,selected.node,this.pending.id);
   const uploaded=await this.upload(project,content);if(this.closed)return;
   const saved=await this.api.saveDraftDocument(project,selected.node,uploaded,selected.head);
   await this.api.clearResourceMapEdit(project,selected.node,this.pending.id,saved.head);this.pending=undefined;
   if(!this.closed){this.selected={node:selected.node,head:saved.head,source:content,map:decodeResourceMap(content)};this.edit=undefined;this.notice="Карта сохранена в личной версии. Общая версия пока не изменена.";}
  }catch{this.uncertain=writing||!!this.pending;this.notice=writing?"Сохранение не подтверждено. Обновите карту и сравните результат; повторная запись отключена.":"Изменение не сохранено. Проверьте поля, связи, права и актуальность версии.";}
  finally{this.busy=false;if(!this.closed)this.render();}
 }
 async dismiss(){if(!this.selected||!this.pending||!this.api.clearResourceMapEdit)return;await this.run(async()=>{await this.api.clearResourceMapEdit!(this.project,this.selected!.node,this.pending!.id,this.selected!.head);this.pending=undefined;this.edit=undefined;this.uncertain=false;this.notice="Сохранённая правка удалена из журнала. Содержимое карты не изменено.";});}
 async resume(){if(!this.pending||this.pending.attempted||!this.selected||this.pending.head!==this.selected.head)return;this.uncertain=false;await this.save();}
 render(){
  if(this.closed)return;
  const el=(tag:string,value="")=>{const e=document.createElement(tag);e.textContent=value;return e;};
  const button=(label:string,action:()=>void)=>{const b=document.createElement("button");b.textContent=label;b.disabled=this.busy;b.onclick=action;return b;};
  this.root.replaceChildren(el("h2","Ресурсы проекта"),el("p",this.busy?"Загрузка…":this.notice));
  for(const p of this.projects)this.root.append(button(p.name||p.slug,()=>void this.load(p.id)));
  if(this.page){
   const maps=this.page.documents.filter(d=>d.content_type===resourceMapMime);
   for(const d of maps)this.root.append(button(d.name+(d.conflicted?" · конфликт":""),()=>void this.open(d.node_id)));
   if(!maps.length)this.root.append(el("p","На этой странице нет доступных карт ресурсов."));
   if(this.page.next_cursor)this.root.append(button("Следующая страница карт",()=>void this.load(this.project,this.page!.next_cursor)));
  }

  if(this.shared){this.root.append(el("h3","Опубликованные карты"));for(const d of this.shared.documents)this.root.append(button("Общая карта: "+d.name,()=>void this.openPublished(d.node)));if(!this.shared.documents.length)this.root.append(el("p","На этой странице нет доступных опубликованных карт."));if(this.shared.cursor)this.root.append(button("Следующая страница опубликованных карт",()=>void this.sharedPage(this.shared!.cursor)));}
  if(this.page&&this.api.saveResourceMapCreation){
   if(this.creation&&!this.creation.result)this.root.append(button("Повторить создание карты",()=>void this.create(true)));
   else if(this.newTitle===undefined)this.root.append(button("Создать карту",()=>{this.newTitle="Карта ресурсов проекта";this.render();}));
   if(this.creation?.result)this.root.append(button("Открыть созданную карту",()=>void this.open(this.creation!.result!.node_id)));
   if(this.newTitle!==undefined){const label=el("label","Название новой карты"),input=document.createElement("input");input.setAttribute("aria-label","Название новой карты");input.value=this.newTitle;input.disabled=this.busy;input.oninput=()=>{this.newTitle=input.value;};label.append(input);this.root.append(label,button("Сохранить заявку и создать карту",()=>void this.create()),button("Отменить создание карты",()=>{this.newTitle=undefined;this.render();}));}
  }
  if(this.selected){
   if(this.assess&&!this.edit&&!this.pending)this.root.append(button('Подготовить оценку наблюдаемости агентом',()=>void this.prepareAssessment()));
   const {map,node}=this.selected;const published=!!this.selected.published;if(this.workflow&&!this.edit&&!this.pending&&!this.selected.published)this.root.append(button("Согласование и публикация карты",()=>{this.closed=true;this.workflow!(this.project,node);}));if(this.upload&&!this.edit&&!this.uncertain&&!this.selected.published)this.root.append(button("Изменить карту",()=>{this.edit=structuredClone(map);this.render();}));this.root.append(el("h3",`${map.title} · версия ${map.revision}`),el("p",(published?"Общая опубликованная версия. ":"Личная версия. ")+"Показана доступная вам версия карты. Наличие ресурса в карте не подтверждает его работоспособность или доступ к нему."),button("Обновить карту",()=>void (published?this.openPublished(node):this.open(node))));
   for(const r of map.resources){
    const card=el("article");card.append(el("h4",r.name),el("p",resourceKinds[r.kind]),el("p",r.description),el("p",`Окружение: ${r.environment||"не указано"}`),el("p",`Ответственные: ${r.owner_ids.join(", ")||"не указаны"}`));
    if(r.url){const link=document.createElement("a");link.href=r.url;link.textContent=r.url;link.target="_blank";link.rel="noopener noreferrer";card.append(link);}else card.append(el("p","Адрес не указан"));
    for(const l of map.links.filter(l=>l.from===r.id))card.append(el("p",`${resourceRelations[l.relation]}: ${map.resources.find(other=>other.id===l.to)!.name}`));
    this.root.append(card);
   }
  }

  if(this.edit){
   const edited=this.edit,locked=this.busy||this.uncertain;
   this.root.append(el("h3","Изменение карты"));
   const field=(parent:HTMLElement,label:string,value:string,set:(v:string)=>void)=>{const box=el("label",label),input=document.createElement("textarea");input.value=value;input.setAttribute("aria-label",label);input.disabled=this.busy;input.readOnly=this.uncertain;input.oninput=()=>set(input.value);box.append(input);parent.append(box);};
   const select=(parent:HTMLElement,label:string,value:string,options:Record<string,string>,set:(v:string)=>void)=>{const box=el("label",label),input=document.createElement("select");input.setAttribute("aria-label",label);for(const [id,name] of Object.entries(options)){const option=document.createElement("option");option.value=id;option.textContent=name;input.append(option);}input.value=value;input.disabled=locked;input.onchange=()=>set(input.value);box.append(input);parent.append(box);};
   field(this.root,"Название карты",edited.title,v=>{edited.title=v;});
   edited.resources.forEach((r,index)=>{const card=el("fieldset");card.append(el("legend",`Ресурс ${index+1}`));field(card,`Название ресурса ${index+1}`,r.name,v=>{r.name=v;});select(card,`Тип ресурса ${index+1}`,r.kind,resourceKinds,v=>{r.kind=v;});field(card,`Описание ресурса ${index+1}`,r.description,v=>{r.description=v;});field(card,`Адрес ресурса ${index+1}`,r.url,v=>{r.url=v;});field(card,`Окружение ресурса ${index+1}`,r.environment,v=>{r.environment=v;});field(card,`Ответственные ресурса ${index+1}`,r.owner_ids.join(", "),v=>{r.owner_ids=v.split(",").map(s=>s.trim()).filter(Boolean);});if(!locked)card.append(button(`Удалить ресурс ${index+1} и его связи`,()=>{edited.resources=edited.resources.filter(other=>other.id!==r.id);edited.links=edited.links.filter(l=>l.from!==r.id&&l.to!==r.id);this.render();}));this.root.append(card);});
   if(!locked&&edited.resources.length<1000)this.root.append(button("Добавить ресурс",()=>{edited.resources.push({id:crypto.randomUUID(),kind:"service",name:"",description:"",url:"",owner_ids:[],environment:""});this.render();}));
   const names=Object.fromEntries(edited.resources.map(r=>[r.id,r.name||"Ресурс без названия"]));
   edited.links.forEach((link,index)=>{const row=el("fieldset");row.append(el("legend",`Связь ${index+1}`));select(row,`Источник связи ${index+1}`,link.from,names,v=>{link.from=v;});select(row,`Отношение связи ${index+1}`,link.relation,resourceRelations,v=>{link.relation=v;});select(row,`Цель связи ${index+1}`,link.to,names,v=>{link.to=v;});if(!locked)row.append(button(`Удалить связь ${index+1}`,()=>{edited.links.splice(index,1);this.render();}));this.root.append(row);});
   if(!locked&&edited.resources.length>1&&edited.links.length<5000)this.root.append(button("Добавить связь",()=>{edited.links.push({from:edited.resources[0].id,to:edited.resources[1].id,relation:"depends_on"});this.render();}));
   if(!this.uncertain)this.root.append(button("Сохранить карту",()=>void this.save()),button("Отменить правку карты",()=>{this.edit=undefined;this.render();}));
   if(this.pending){if(!this.pending.attempted&&this.selected?.head===this.pending.head)this.root.append(button("Продолжить сохранённую правку",()=>void this.resume()));this.root.append(button("Сверено с текущей картой — убрать сохранённую правку",()=>void this.dismiss()));}
  }
  this.root.append(button("Закрыть ресурсы",()=>{this.closed=true;this.selected=undefined;this.page=undefined;this.close();}));
 }
}
