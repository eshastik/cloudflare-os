import {useEffect,useRef,useState} from "react";
import {ArrowLeft} from "@phosphor-icons/react";
import type {IntakeAlert} from "../src/intake.ts";
import type {ProjectPage} from "../src/mnemos-api.ts";
import {useHost,useUi} from "./host.ts";
import { Button, Notice,StatusBadge } from "./ui.tsx";

function resultState(alert:IntakeAlert){
 if(alert.status==="declined")return "Отклонено";
 if(alert.placement_state==="personal")return "Личная версия";
 if(alert.placement_state==="shared")return "В материалах проекта";
 return alert.status==="approved"?"Решение принято":"Вопрос закрыт";
}
export default function IntakeHistory({alerts,projects}:{alerts:IntakeAlert[];projects:ProjectPage["projects"]}){
 const host=useHost(),ui=useUi();
 const [opened,setOpened]=useState<{alert:IntakeAlert;text:string|null;error:string}|null>(null);
 const [downloading,setDownloading]=useState(false),[downloadError,setDownloadError]=useState("");
 const generation=useRef(0);
 useEffect(()=>()=>{generation.current++;},[]);
 const name=(alert:IntakeAlert)=>alert.paths[0]?.split("/").pop()||"Материал";
 const canOpen=(alert:IntakeAlert)=>!!alert.result_project_id&&!!alert.result_node_id&&(alert.placement_state==="shared"||alert.placement_state==="personal"&&/^[a-f0-9]{64}$/.test(alert.personal_head||""));
 async function open(alert:IntakeAlert){
  if(downloading)return;
  const request=++generation.current;setDownloadError("");setOpened({alert,text:null,error:""});
  try{
   let text:string;
   if(alert.placement_state==="personal"){
    if(!/\.(txt|md|csv|json|xml|yaml|yml|log)$/i.test(name(alert)))throw new Error("format");
    text=await host.downloadText(alert.result_project_id!,alert.result_node_id!,"private:"+alert.personal_head,0);
   }else{text=(await ui.readProjectDocument(alert.result_project_id!,alert.result_node_id!)).text;}
   if(request===generation.current)setOpened({alert,text,error:""});
  }catch(error){if(request===generation.current)setOpened({alert,text:null,error:error instanceof Error&&error.message==="format"?"Скачайте файл, чтобы открыть его в подходящем приложении.":"Не удалось открыть материал. Повторите попытку."});}
 }
 async function download(alert:IntakeAlert){
  if(downloading)return;const request=generation.current;setDownloading(true);setDownloadError("");
  try{await host.downloadFile(alert.result_project_id!,alert.result_node_id!,"private:"+alert.personal_head,name(alert));}
  catch{if(request===generation.current)setDownloadError("Не удалось скачать файл. Повторите попытку.");}
  finally{if(request===generation.current)setDownloading(false);}
 }
 if(opened){const alert=opened.alert;return <section aria-label="Принятый материал" className="space-y-4">
  <div className="flex flex-wrap items-center justify-between gap-3"><Button size="sm" variant="ghost" onClick={()=>{generation.current++;setOpened(null);setDownloading(false);}}><ArrowLeft size={16}/>К истории</Button>{alert.placement_state==="personal"&&<Button size="sm" variant="secondary" disabled={downloading} onClick={()=>void download(alert)}>{downloading?"Скачивание…":"Скачать файл"}</Button>}</div>
  <div><h3 className="m-0 text-base font-semibold">{name(alert)}</h3><p className="mb-0 mt-1 text-sm text-kumo-subtle">{alert.placement_state==="personal"?"Сохранено в личной версии. Публикация выполняется отдельно.":"Материал проекта"}</p></div>
  {downloadError&&<Notice tone="danger">{downloadError}</Notice>}
  {opened.error?<Notice tone="danger">{opened.error}</Notice>:opened.text===null?<Notice>Открываем материал…</Notice>:<pre className="m-0 whitespace-pre-wrap break-words rounded-[12px] border border-kumo-fill p-4 font-sans text-sm">{opened.text||"Пустой файл"}</pre>}
  {opened.error&&!opened.error.startsWith("Скачайте файл")&&<Button size="sm" variant="ghost" disabled={downloading} onClick={()=>void open(alert)}>Повторить</Button>}
 </section>;}
 return <div className="divide-y divide-kumo-fill">{alerts.map(alert=><div key={alert.id} className="flex flex-wrap items-center gap-3 py-4">
  <div className="min-w-0 flex-1">{canOpen(alert)?<button type="button" className="text-left text-sm font-medium text-kumo-link hover:underline" onClick={()=>void open(alert)}>{alert.paths[0]||"Материал"}</button>:<span className="text-sm font-medium">{alert.paths[0]||"Материал"}</span>}
   <p className="mb-0 mt-1 break-words text-xs text-kumo-subtle">{alert.placement.split("/").map((part,index)=>index===0?projects.find(project=>project.slug===part)?.name||part:part).join(" / ")}</p>
   {alert.note&&<p className="mb-0 mt-1 text-xs text-kumo-subtle">{alert.note}</p>}
  </div><StatusBadge tone={alert.placement_state==="shared"?"success":"neutral"}>{resultState(alert)}</StatusBadge>
 </div>)}</div>;
}
