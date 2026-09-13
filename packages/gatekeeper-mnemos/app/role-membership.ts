import type {MnemosAccountSession} from '../src/account-session.ts';
type API=Pick<MnemosAccountSession,'readPrincipalMembership'|'setPrincipalMembership'|'listOrganizationRoles'|'createOrganizationRole'>;
/** Explicit owner administration of existing groups/roles and principals. */
export class RoleMembershipView {
 private catalog?:Awaited<ReturnType<API['listOrganizationRoles']>>;
 private state?:Awaited<ReturnType<API['readPrincipalMembership']>>;
 private container='';private member='';private busy=false;private closed=false;private notice='';
 constructor(private root:HTMLElement,private api:API,private close:()=>void){}
 private async run(work:()=>Promise<void>){if(this.closed||this.busy)return;this.busy=true;this.state=undefined;this.catalog=undefined;this.notice='';this.render();try{await work();}catch{this.state=undefined;this.notice='Изменение не подтверждено. Перечитайте состояние; нужны административные права, существующая роль и участник.';}finally{this.busy=false;if(!this.closed)this.render();}}
 async list(cursor=""){await this.run(async()=>{const result=await this.api.listOrganizationRoles(cursor);if(!this.closed)this.catalog=result;});}
 async create(id:string,kind:"group"|"functional_role",name:string){const catalog=this.catalog;if(!catalog)return;await this.run(async()=>{const role=await this.api.createOrganizationRole({id,kind,name,expected_generation:catalog.generation});if(!this.closed){this.container=role.id;this.notice='Роль создана без участников и прав. Состав и доступ назначаются отдельно.';}});}
 async load(container:string,member:string){await this.run(async()=>{this.container=container;this.member=member;const state=await this.api.readPrincipalMembership(container,member);if(!this.closed)this.state=state;});}
 async change(enabled:boolean){const state=this.state;if(!state)return;await this.run(async()=>{const result=await this.api.setPrincipalMembership(state.container_id,state.member_id,{expected_generation:state.generation,expected_enabled:state.enabled,enabled});if(!this.closed){this.state=result;this.notice='Состав роли обновлён.';}});}
 render(){if(this.closed)return;this.root.replaceChildren();const text=(value:string)=>{const p=document.createElement('p');p.textContent=value;this.root.append(p);};const button=(name:string,action:()=>void)=>{const b=document.createElement('button');b.textContent=name;b.disabled=this.busy;b.onclick=action;this.root.append(b);return b;};
 text('Состав групп и функциональных ролей');button('Закрыть состав ролей',()=>{this.closed=true;this.state=undefined;this.root.replaceChildren();this.close();}).disabled=false;
 const input=(name:string,value:string)=>{const label=document.createElement('label');label.textContent=name;const e=document.createElement('input');e.setAttribute('aria-label',name);e.value=value;e.maxLength=255;e.disabled=this.busy;label.append(e);this.root.append(label);return e;};
 const container=input('ID группы или роли',this.container),member=input('ID участника',this.member);button('Прочитать состав роли',()=>void this.load(container.value.trim(),member.value.trim()));
 button('Показать группы и роли',()=>void this.list());
 const catalog=this.catalog;if(catalog){for(const role of catalog.roles)button(`${role.name||role.id} (${role.id})${role.active?'':' — неактивна'}`,()=>{this.container=role.id;this.state=undefined;this.render();});if(catalog.next_cursor)button('Следующая страница ролей',()=>void this.list(catalog.next_cursor));
 text('Создать новую группу или функциональную роль без участников и прав. Занятый ID не перезаписывается.');
 const id=input('ID новой роли',''),name=input('Название новой роли','');const kind=document.createElement('select');kind.setAttribute('aria-label','Тип новой роли');for(const [value,label] of [['functional_role','Функциональная роль'],['group','Группа']]){const o=document.createElement('option');o.value=value;o.textContent=label;kind.append(o);}kind.disabled=this.busy;this.root.append(kind);button('Создать роль без прав',()=>void this.create(id.value.trim(),kind.value==='group'?'group':'functional_role',name.value.trim()));}
 if(this.notice)text(this.notice);const s=this.state;if(!s)return;
 text(`Группа/роль: ${s.container_name||s.container_id} (${s.container_id}). Участник: ${s.member_name||s.member_id} (${s.member_id}).`);
 text(s.enabled?'Участник входит в роль.':'Участник не входит в роль.');
 text('Членство даёт уже назначенные группе или роли права, в том числе в других проектах. Удаление снимает только эту связь: права из других ролей и личные разрешения сохраняются.');
 if(s.enabled)button('Удалить участника из роли',()=>void this.change(false));else if(s.container_active&&s.member_active)button('Добавить участника в роль',()=>void this.change(true));else text('Неактивную роль или участника нельзя включить в новую связь.');
 }
}
