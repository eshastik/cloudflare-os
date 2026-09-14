// @vitest-environment jsdom
import * as React from "react";
import {createRoot} from "react-dom/client";
import {createMemoryHistory,createRootRoute,createRoute,createRouter,RouterProvider} from "@tanstack/react-router";
import {expect,it} from "vitest";
import SidebarItem from "./SidebarItem";
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
it("подсвечивает только выбранный раздел одного приложения",async()=>{
 const route=createRootRoute({component:()=> <><SidebarItem to="/gatekeepers/$appId" params={{appId:"mnemos"}} search={{section:"projects"}} section="projects" label="Проекты" icon={null}/><SidebarItem to="/gatekeepers/$appId" params={{appId:"mnemos"}} search={{section:"documents"}} section="documents" label="Материалы" icon={null}/></>});
 const child=createRoute({getParentRoute:()=>route,path:"/gatekeepers/$appId"});
 const router=createRouter({history:createMemoryHistory({initialEntries:["/gatekeepers/mnemos?section=projects"]}),routeTree:route.addChildren([child])});
 const el=document.createElement("div"); document.body.append(el); const root=createRoot(el);
 try {
  await React.act(async()=>root.render(<RouterProvider router={router}/>));
  expect(el.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  expect(el.querySelector('[aria-current="page"]')?.textContent).toBe("Проекты");
  await React.act(async()=>router.navigate({to:"/gatekeepers/$appId",params:{appId:"mnemos"},search:{section:"documents"}}));
  expect(el.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  expect(el.querySelector('[aria-current="page"]')?.textContent).toBe("Материалы");
 }finally{await React.act(async()=>root.unmount());el.remove();}
});

it("одинаковый раздел разных организаций не подсвечивается одновременно",async()=>{
 const route=createRootRoute({component:()=> <>{[7,8].map(account=><SidebarItem key={account} to="/gatekeepers/$appId" params={{appId:"mnemos"}} search={{section:"projects",account}} section="projects" account={account} label={account===7?"Проекты первой":"Проекты второй"} icon={null}/>)}</>});
 const child=createRoute({getParentRoute:()=>route,path:"/gatekeepers/$appId"});
 const router=createRouter({history:createMemoryHistory({initialEntries:["/gatekeepers/mnemos?section=projects&account=8"]}),routeTree:route.addChildren([child])});
 const el=document.createElement("div");document.body.append(el);const root=createRoot(el);
 try{await React.act(async()=>root.render(<RouterProvider router={router}/>));expect(el.querySelectorAll('[aria-current="page"]')).toHaveLength(1);expect(el.querySelector('[aria-current="page"]')?.textContent).toBe("Проекты второй");}
 finally{await React.act(async()=>root.unmount());el.remove();}
});
