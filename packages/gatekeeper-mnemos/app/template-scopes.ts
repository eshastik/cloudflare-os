import type {MnemosAccountSession} from "../src/account-session.ts";
import {validTemplateScopeConfig,type TemplateScope,type TemplateScopeConfig,type TemplateScopePage} from "../src/work-templates.ts";
type API=Pick<MnemosAccountSession,"listManagedTemplateScopes"|"setTemplateScope">;
/** Configuration authority is checked by Mnemos, independently of workshop admin status. */
export class TemplateScopeView {
 private page?:TemplateScopePage;private cursor="";private busy=false;private closed=false;private notice="";private uncertain=false;
 private selected?:TemplateScope;private id="";private config?:TemplateScopeConfig;
 constructor(private root:HTMLElement,private api:API,private close:()=>void){}
 async load(cursor=""){
  if(this.busy||this.closed)return;this.busy=true;this.notice="";this.page=undefined;this.config=undefined;this.selected=undefined;this.render();
  try{this.page=await this.api.listManagedTemplateScopes(cursor);this.cursor=cursor;this.uncertain=false;}catch{this.notice="Области недоступны. Для настройки необходимо право управления политикой шаблонов.";}finally{this.busy=false;this.render();}
 }
 private edit(scope?:TemplateScope){this.selected=scope?structuredClone(scope):undefined;this.id=scope?.scope_id??"";this.config=scope?{level:scope.level,parent_id:scope.parent_id,reader_group_id:scope.reader_group_id,name:scope.name,enabled:scope.enabled,approvers:[...scope.approvers]}:{level:"organization",parent_id:"",reader_group_id:"",name:"",enabled:true,approvers:[]};this.notice="";this.render();}
 private async save(){
  if(this.busy||this.closed||this.uncertain||!this.config)return;
  if(!this.id.trim()||this.id!==this.id.trim()||!validTemplateScopeConfig(this.config)){this.notice="Проверьте ID, название, родительскую область, группу читателей и ID согласующих.";this.render();return;}
  this.busy=true;this.notice="";this.render();
  try{const saved=await this.api.setTemplateScope(this.id,this.selected?.revision??0,structuredClone(this.config));this.selected=saved;this.config={level:saved.level,parent_id:saved.parent_id,reader_group_id:saved.reader_group_id,name:saved.name,enabled:saved.enabled,approvers:[...saved.approvers]};if(this.page){const index=this.page.scopes.findIndex(s=>s.scope_id===saved.scope_id);if(index>=0)this.page.scopes[index]=saved;}this.notice="Настройки области сохранены.";}
  catch{this.uncertain=true;this.notice="Изменение не подтверждено. Перечитайте области и откройте актуальную конфигурацию перед следующей правкой.";}
  finally{this.busy=false;this.render();}
 }
 render(){
  if(this.closed)return;
  const el=(tag:string,text="")=>{const e=document.createElement(tag);e.textContent=text;return e;};
  const button=(text:string,run:()=>void)=>{const b=el("button",text) as HTMLButtonElement;b.disabled=this.busy;b.onclick=run;return b;};
  const field=(label:string,value:string,change:(v:string)=>void,locked=false)=>{const box=el("label",label),input=document.createElement("input");input.setAttribute("aria-label",label);input.value=value;input.disabled=this.busy||this.uncertain||locked;input.oninput=()=>change(input.value);box.append(input);this.root.append(box);};
  this.root.replaceChildren(el("h2","Области шаблонов"),el("p",this.notice),el("p","Организация → отдел → группа. Укажите существующую группу читателей и пользователей, которым поручено согласование шаблонов."));
  this.root.append(button("Перечитать области",()=>void this.load(this.cursor)));
  for(const scope of this.page?.scopes??[])this.root.append(button(`${scope.name} · ${scope.scope_id} · ${scope.enabled?"включена":"выключена"}`,()=>this.edit(scope)));
  if(this.page?.next_cursor)this.root.append(button("Следующие области настроек",()=>void this.load(this.page!.next_cursor)));
  if(this.cursor)this.root.append(button("В начало списка областей",()=>void this.load()));
  if(this.page&&!this.uncertain)this.root.append(button("Новая область",()=>this.edit()));
  if(this.config){
   const config=this.config;this.root.append(el("h3",this.selected?`Конфигурация ${this.selected.revision}`:"Новая область"));
   field("ID области",this.id,v=>{this.id=v;},!!this.selected);
   field("Название области",config.name,v=>{config.name=v;});
   const label=el("label","Уровень области"),level=document.createElement("select");level.setAttribute("aria-label","Уровень области");level.disabled=this.busy||this.uncertain||!!this.selected;
   for(const [value,text] of [["organization","Организация"],["department","Отдел"],["group","Группа"]]){const o=document.createElement("option");o.value=value;o.textContent=text;o.selected=value===config.level;level.append(o);}
   level.onchange=()=>{const value=level.value;if(value!=="organization"&&value!=="department"&&value!=="group")return;config.level=value;if(value==="organization"){config.parent_id="";config.reader_group_id="";}this.render();};label.append(level);this.root.append(label);
   if(config.level!=="organization"){field("ID родительской области",config.parent_id,v=>{config.parent_id=v;});field("ID группы читателей",config.reader_group_id,v=>{config.reader_group_id=v;});}
   field("ID согласующих через запятую",config.approvers.join(", "),v=>{config.approvers=v.split(",").map(s=>s.trim()).filter(Boolean);});
   const enabled=el("label","Область включена"),check=document.createElement("input");check.type="checkbox";check.setAttribute("aria-label","Область включена");check.checked=config.enabled;check.disabled=this.busy||this.uncertain;check.onchange=()=>{config.enabled=check.checked;};enabled.append(check);this.root.append(enabled);
   if(!this.uncertain)this.root.append(button("Сохранить область",()=>void this.save()));
  }
  this.root.append(button("Закрыть настройки областей",()=>{this.closed=true;this.close();}));
 }
}
