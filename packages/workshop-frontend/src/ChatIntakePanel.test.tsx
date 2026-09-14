// @vitest-environment jsdom
import {act,useEffect} from "react";
import {createRoot} from "react-dom/client";
import {expect,it,vi} from "vitest";
import ChatIntakePanel from "./ChatIntakePanel";
const transfer=vi.hoisted(()=>vi.fn());
vi.mock("./GatekeeperAppPage",()=>({default:({embeddedIntake,onIntakeDropReady}:{embeddedIntake?:boolean;onIntakeDropReady?:(handler:((value:DataTransfer)=>void)|null)=>void})=>{useEffect(()=>{onIntakeDropReady?.(transfer);return()=>onIntakeDropReady?.(null);},[onIntakeDropReady]);return <div>{embeddedIntake?"Проверка материалов":"Страница организации"}</div>;}}));
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
it("панель доступна с клавиатуры и оставляет черновик беседы на месте",async()=>{
 const host=document.createElement("div");document.body.append(host);const root=createRoot(host);const close=vi.fn();
 try{
  await act(async()=>root.render(<><textarea defaultValue="Неотправленная мысль"/><ChatIntakePanel onClose={close}/></>));
  expect(document.querySelector('[aria-label="Материалы организации"]')).not.toBeNull();
  expect(document.body.textContent).toContain("Проверка материалов");
  const button=document.querySelector<HTMLButtonElement>('[aria-label="Закрыть материалы организации"]')!;
  expect(document.activeElement).toBe(button);
  await act(async()=>button.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true})));
  expect(close).toHaveBeenCalledOnce();
  expect(host.querySelector("textarea")!.value).toBe("Неотправленная мысль");
  await act(async()=>button.click());expect(close).toHaveBeenCalledTimes(2);
 }finally{await act(async()=>root.unmount());host.remove();}
});

it("drop панели направляется в приёмную и не всплывает в чат-вложения",async()=>{
 const host=document.createElement("div");document.body.append(host);const root=createRoot(host);const chatDrop=vi.fn();const data={files:[new File(["document"],"договор.txt")],types:["Files"]};
 try{
  await act(async()=>root.render(<div onDrop={chatDrop}><ChatIntakePanel onClose={()=>{}}/></div>));
  const event=new Event("drop",{bubbles:true,cancelable:true});Object.defineProperty(event,"dataTransfer",{value:data});
  await act(async()=>document.querySelector('[aria-label="Материалы организации"]')!.dispatchEvent(event));
  expect(transfer).toHaveBeenCalledWith(data);expect(chatDrop).not.toHaveBeenCalled();expect(event.defaultPrevented).toBe(true);
 }finally{await act(async()=>root.unmount());host.remove();}
});
