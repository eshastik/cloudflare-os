import {useCallback,useEffect,useRef,useState} from "react";
import {createPortal} from "react-dom";
import {X} from "@phosphor-icons/react";
import GatekeeperAppPage from "./GatekeeperAppPage";

/** Приём организации живёт отдельно от вложений и черновика беседы. */
export default function ChatIntakePanel({onClose}:{onClose:()=>void}) {
 const close=useRef<HTMLButtonElement>(null);
 const drop=useRef<((transfer:DataTransfer)=>void)|null>(null);
 const registerDrop=useCallback((handler:((transfer:DataTransfer)=>void)|null)=>{drop.current=handler;},[]);
 const [dragging,setDragging]=useState(false),[notice,setNotice]=useState("");
 useEffect(()=>{
  const entered=(event:DragEvent)=>{if(Array.from(event.dataTransfer?.types??[]).includes("Files"))setDragging(true);};
  const ended=()=>setDragging(false);
  window.addEventListener("dragenter",entered);window.addEventListener("dragend",ended);window.addEventListener("drop",ended);
  return()=>{window.removeEventListener("dragenter",entered);window.removeEventListener("dragend",ended);window.removeEventListener("drop",ended);};
 },[]);
 useEffect(()=>{close.current?.focus();},[]);
 return createPortal(<aside aria-label="Материалы организации" onDragOver={event=>{event.preventDefault();event.stopPropagation();}} onDragLeave={event=>{if(!(event.relatedTarget instanceof Node)||!event.currentTarget.contains(event.relatedTarget))setDragging(false);}} onDrop={event=>{event.preventDefault();event.stopPropagation();setDragging(false);if(drop.current){setNotice("");drop.current(event.dataTransfer);}else setNotice("Приёмная ещё загружается. Дождитесь выбора файлов и повторите перетаскивание.");}} onKeyDown={event=>{if(event.key==="Escape"){event.preventDefault();event.stopPropagation();onClose();}}} className="fixed inset-y-0 right-0 z-[1200] flex w-full max-w-[600px] flex-col border-l border-kumo-line bg-kumo-base shadow-2xl">
  <header className="flex shrink-0 items-start justify-between gap-3 border-b border-kumo-line px-5 py-4">
   <div><h2 className="m-0 text-base font-medium">Материалы организации</h2><p className="mb-0 mt-1 text-xs text-kumo-subtle">Загрузите документы и проверьте размещение. Беседа остаётся открытой.</p><p className="mb-0 mt-1 text-xs text-kumo-subtle">При закрытии загрузка остановится. Принятые файлы останутся в приёмной.</p></div>
   <button ref={close} type="button" aria-label="Закрыть материалы организации" onClick={onClose} className="rounded-md p-1.5 text-kumo-subtle hover:bg-kumo-tint"><X size={18}/></button>
  </header>
  {notice&&<p role="alert" className="mx-5 text-sm text-kumo-danger">{notice}</p>}
  <div className="flex min-h-0 flex-1 flex-col overflow-y-auto"><GatekeeperAppPage appId="mnemos" section="intake" embeddedIntake onClosePanel={onClose} onIntakeDropReady={registerDrop}/></div>
  {dragging&&<div className="absolute inset-2 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-kumo-brand bg-kumo-base/95 text-sm">Отпустите файлы или папку для приёма</div>}
 </aside>,document.body);
}
