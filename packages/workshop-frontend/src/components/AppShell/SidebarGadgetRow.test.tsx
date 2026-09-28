// @vitest-environment jsdom
import * as React from "react";
import {createRoot} from "react-dom/client";
import {createMemoryHistory,createRootRoute,createRoute,createRouter,RouterProvider} from "@tanstack/react-router";
import {expect,it} from "vitest";
import type {GadgetMetadataWithTimestamps} from "@gadgets/workshop-shared/api";
import SidebarGadgetRow from "./SidebarGadgetRow";
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;

const noop=()=>{};
const at=new Date(0);

it("беседа из Telegram помечена и в боковой панели, и в списке «Все беседы»; беседа сайта — нет",async()=>{
 const telegram:GadgetMetadataWithTimestamps={id:"w1",title:"Продажи за сентябрь",channel:"telegram",created:at,lastActive:at};
 const site:GadgetMetadataWithTimestamps={id:"w2",title:"Отчёт",created:at,lastActive:at};
 const row=(gadget:GadgetMetadataWithTimestamps,variant:"sidebar"|"list")=><SidebarGadgetRow key={gadget.id+variant} gadget={gadget} variant={variant} onTogglePin={noop} onRename={noop} onShare={noop} onDelete={noop}/>;
 const route=createRootRoute({component:()=><>{row(telegram,"sidebar")}{row(site,"sidebar")}{row(telegram,"list")}{row(site,"list")}</>});
 const child=createRoute({getParentRoute:()=>route,path:"/workspace/$id"});
 const router=createRouter({history:createMemoryHistory({initialEntries:["/"]}),routeTree:route.addChildren([child])});
 const el=document.createElement("div");document.body.append(el);const root=createRoot(el);
 try{
  await React.act(async()=>root.render(<RouterProvider router={router}/>));
  const links=[...el.querySelectorAll("a")];
  expect(links).toHaveLength(4);
  expect(links[0].textContent).toContain("Беседа из Telegram");
  expect(links[1].textContent).not.toContain("Telegram");
  expect(links[2].textContent).toContain("Telegram");
  expect(links[3].textContent).not.toContain("Telegram");
 }finally{await React.act(async()=>root.unmount());el.remove();}
});

it("архив: у своей беседы — «В архив» / «Вернуть из архива», у чужой пункта нет",async()=>{
 const own:GadgetMetadataWithTimestamps={id:"w1",title:"Смета",created:at,lastActive:at};
 const archived:GadgetMetadataWithTimestamps={...own,id:"w2",archived:true};
 const shared:GadgetMetadataWithTimestamps={...own,id:"w3",owner:{type:"user",id:"bob",name:"Боб"}};
 const toggled:string[]=[];
 const items=async(gadget:GadgetMetadataWithTimestamps)=>{
  const route=createRootRoute({component:()=><SidebarGadgetRow gadget={gadget} onTogglePin={noop} onRename={noop} onShare={noop} onDelete={noop} onToggleArchive={g=>toggled.push(g.id)}/>});
  const router=createRouter({history:createMemoryHistory({initialEntries:["/"]}),routeTree:route.addChildren([createRoute({getParentRoute:()=>route,path:"/workspace/$id"})])});
  const el=document.createElement("div");document.body.append(el);const root=createRoot(el);
  await React.act(async()=>root.render(<RouterProvider router={router}/>));
  await React.act(async()=>{(el.querySelector('button[aria-label="Действия с беседой"]') as HTMLButtonElement).click();});
  const found=[...document.querySelectorAll('[role="menuitem"]')] as HTMLElement[];
  const texts=found.map(node=>node.textContent?.trim());
  const archive=found.find(node=>/архив/.test(node.textContent??""));
  if(archive)await React.act(async()=>archive.click());
  await React.act(async()=>root.unmount());el.remove();document.body.replaceChildren();
  return texts;
 };
 expect(await items(own)).toContain("В архив");
 expect(await items(archived)).toContain("Вернуть из архива");
 expect((await items(shared)).some(text=>/архив/.test(text??""))).toBe(false);
 expect(toggled).toEqual(["w1","w2"]);
});
