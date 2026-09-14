import type { WhoAmI } from "./mnemos-api.ts";
/** Навигация отражает свежие полномочия; каждую операцию по-прежнему проверяет API. */
export function managementSections(identity: WhoAmI): {id:string;title:string;group:"work"|"manage"}[] {
  const sections: {id:string;title:string;group:"work"|"manage"}[] = [
    {id:"my-work",title:"Входящие",group:"work"},
    {id:"approvals",title:"Согласования",group:"work"},
    {id:"documents",title:"Материалы",group:"work"},
    {id:"projects",title:"Проекты",group:"work"},
    {id:"sources",title:"Источники",group:"work"},
    {id:"agents",title:"Исполнители",group:"work"},
    {id:"templates",title:"Шаблоны работы",group:"work"},
    {id:"analytics",title:"Аналитика",group:"work"},
  ];
  const capabilities = identity.capabilities ?? [];
  if (capabilities.includes("principal.manage")) sections.push({id:"people",title:"Люди и доступ",group:"manage"});
  if (capabilities.includes("project.create")) sections.push({id:"intake",title:"Приём данных",group:"manage"});
  if (capabilities.includes("principal.manage") || capabilities.includes("platform.metrics.read")) sections.push({id:"organization",title:"Организация",group:"manage"});
  return sections;
}
