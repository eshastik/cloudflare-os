import type { WhoAmI } from "./mnemos-api.ts";
/** Навигация отражает свежие полномочия; каждую операцию по-прежнему проверяет API.
 * approvals — число решений по чужой работе; «Мой отдел» — руководителю отдела или ответственному за проект. */
export function managementSections(identity: WhoAmI, inbox?: number, approvals?: number): {id:string;title:string;group:"work"|"manage";count?:number}[] {
  const sections: {id:string;title:string;group:"work"|"manage";count?:number}[] = [
    {id:"my-work",title:"Входящие",group:"work",...(inbox === undefined ? {} : {count:inbox})},
    {id:"approvals",title:"Согласования",group:"work",...(approvals === undefined ? {} : {count:approvals})},
    {id:"documents",title:"Материалы",group:"work"},
    {id:"projects",title:"Проекты",group:"work"},
    {id:"sources",title:"Источники",group:"work"},
    {id:"agents",title:"Исполнители",group:"work"},
    {id:"templates",title:"Шаблоны работы",group:"work"},
    {id:"analytics",title:"Аналитика",group:"work"},
  ];
  const capabilities = identity.capabilities ?? [];
  const roles = identity.roles;
  if (roles?.department_head || roles?.project_responsible) sections.push({id:"team",title:"Мой отдел",group:"manage"});
  if (capabilities.includes("principal.manage")) sections.push({id:"people",title:"Люди и доступ",group:"manage"});
  if (capabilities.includes("project.create")) sections.push({id:"intake",title:"Приём данных",group:"manage"});
  if (capabilities.includes("principal.manage") || capabilities.includes("platform.metrics.read")) sections.push({id:"organization",title:"Организация",group:"manage"});
  return sections;
}
