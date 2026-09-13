import type {MnemosAccountSession} from "../src/account-session.ts";
import type {BitrixDepartmentPreview,BitrixDepartmentSelection} from "../src/corporate-import.ts";
type API=Pick<MnemosAccountSession,"listOrganizationRoles"|"previewBitrixDepartmentMembership"|"applyBitrixDepartmentMembership">;
/** An explicit human decision linking one saved department relationship to Mnemos. */
export class BitrixDepartmentView {
 private roles?:Awaited<ReturnType<API["listOrganizationRoles"]>>;
 private shown?:{selection:BitrixDepartmentSelection;value:BitrixDepartmentPreview};
 private role="";private member="";private busy=false;private closed=false;private notice="";
 constructor(private root:HTMLElement,private api:API,private source:{project:string;node:string;head:string;sha256:string;person:string;department:string},private close:()=>void){}
 private async run(work:()=>Promise<void>){if(this.closed||this.busy)return;this.busy=true;this.shown=undefined;this.notice="";this.render();try{await work();}catch{this.roles=undefined;this.notice="Результат не подтверждён. Перечитайте сопоставление: проверьте права и актуальность выгрузки. Автоматического повтора изменения нет.";}finally{this.busy=false;if(!this.closed)this.render();}}
 async list(cursor=""){await this.run(async()=>{const value=await this.api.listOrganizationRoles(cursor);if(!this.closed)this.roles=value;});}
 async preview(role=this.role,member=this.member){if(!role||!member)return;this.role=role;this.member=member;const s=this.source;const selection:BitrixDepartmentSelection={source_sha256:s.sha256,person_id:s.person,department_id:s.department,role_id:role,member_id:member};await this.run(async()=>{const value=await this.api.previewBitrixDepartmentMembership(s.project,s.node,s.head,selection);if(!this.closed)this.shown={selection,value};});}
 async apply(enabled:boolean){const shown=this.shown;if(!shown)return;const s=this.source;await this.run(async()=>{const value=await this.api.applyBitrixDepartmentMembership(s.project,s.node,s.head,shown.selection,{expected_generation:shown.value.membership.generation,expected_enabled:shown.value.membership.enabled,enabled});if(!this.closed){this.shown={selection:shown.selection,value};this.notice=enabled?"Участник добавлен в роль. Происхождение решения сохранено.":"Участник удалён из роли. Решение сохранено.";}});}
 render(){if(this.closed)return;this.root.replaceChildren();const text=(value:string)=>{const p=document.createElement("p");p.textContent=value;this.root.append(p);};const button=(label:string,action:()=>void)=>{const b=document.createElement("button");b.textContent=label;b.disabled=this.busy;b.onclick=action;this.root.append(b);return b;};
 text("Сопоставление сотрудника и отдела Bitrix");button("Вернуться к выгрузке",()=>{this.closed=true;this.shown=undefined;this.roles=undefined;this.root.replaceChildren();this.close();}).disabled=false;
 text(`Bitrix: сотрудник ${this.source.person}, отдел ${this.source.department}. Выберите существующую роль и пользователя Mnemos.`);
 text("Добавление даст пользователю права выбранной роли, в том числе в других проектах. Удаление членства сохранит его независимые права. Новую роль можно создать в разделе «Состав групп и ролей». Совпадение имени не подтверждает личность.");
 if(this.notice)text(this.notice);if(this.busy)text("Проверка…");
 button("Показать роли Mnemos",()=>void this.list());
 for(const role of this.roles?.roles??[])if(role.active)button(`${role.name||role.id} (${role.id})`,()=>{this.role=role.id;this.shown=undefined;this.render();});
 if(this.roles?.next_cursor)button("Следующая страница ролей",()=>void this.list(this.roles!.next_cursor));
 const input=(label:string,value:string,change:(v:string)=>void)=>{const el=document.createElement("input");el.setAttribute("aria-label",label);el.placeholder=label;el.value=value;el.disabled=this.busy;el.oninput=()=>{change(el.value);this.shown=undefined;this.root.querySelector('[data-department-decision]')?.remove();};this.root.append(el);return el;};
 const role=input("ID роли Mnemos",this.role,v=>this.role=v),member=input("ID пользователя Mnemos",this.member,v=>this.member=v);
 button("Проверить сопоставление отдела",()=>void this.preview(role.value,member.value));
 if(this.shown){const {value,selection}=this.shown;const m=value.membership;const decision=document.createElement("section");decision.dataset.departmentDecision="";const p=document.createElement("p");p.textContent=`${value.person_name} (Bitrix ${selection.person_id}) → ${m.member_name||m.member_id} (${m.member_id}); ${value.department_name} (Bitrix ${selection.department_id}) → ${m.container_name||m.container_id} (${m.container_id}). Членство: ${m.enabled?"есть":"нет"}.`;decision.append(p);this.root.append(decision);
 const action=document.createElement("button");action.disabled=this.busy||(!m.enabled&&(!value.source_person_active||!m.container_active||!m.member_active));action.textContent=m.enabled?"Удалить сопоставленное членство":"Подтвердить добавление в роль";action.onclick=()=>void this.apply(!m.enabled);decision.append(action);
 if(!value.source_person_active){const warning=document.createElement("p");warning.textContent="Источник не подтверждает активность сотрудника. Добавление недоступно.";decision.append(warning);}
 }
 }
}
