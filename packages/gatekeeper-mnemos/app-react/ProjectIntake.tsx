import {useEffect, useRef, useState} from "react";
import {Button} from "@cloudflare/kumo";
import {useUi} from "./host.ts";
import {Block, Notice, TextInput} from "./ui.tsx";
import {intakePlacement, type IntakeAlert, type IntakeStatus} from "../src/intake.ts";

export default function ProjectIntake({projectId, onPlaced}:{projectId:string;onPlaced():Promise<void>}) {
 const ui=useUi();
 const placed=useRef(new Set<string>());
 const onPlacedRef=useRef(onPlaced);onPlacedRef.current=onPlaced;
 const [status,setStatus]=useState<IntakeStatus|null>(null);
 const [ready,setReady]=useState(false);
 const [alerts,setAlerts]=useState<IntakeAlert[]>([]),[slug,setSlug]=useState("");
 const [bulkDomain,setBulkDomain]=useState("");
 const [domains,setDomains]=useState<Record<string,string>>({});
 const [excluded,setExcluded]=useState<Set<string>>(new Set());
 const [error,setError]=useState(""),[message,setMessage]=useState("");
 const [busy,setBusy]=useState(false),[revision,setRevision]=useState(0),[truncated,setTruncated]=useState(false);
 useEffect(()=>{
  let disposed=false;let timer:ReturnType<typeof setTimeout>|undefined;
  async function load(){
   try {
    const [questions,projects,history,currentStatus]=await Promise.all([ui.inboxAlerts(false,projectId),ui.listProjects(),ui.inboxAlerts(true,projectId),ui.inboxStatus(projectId)]);
    if(disposed)return;
    setStatus(currentStatus);setAlerts(questions.alerts);setTruncated(questions.truncated);
    setSlug(projects.projects.find(p=>p.id===projectId)?.slug??"");
    setDomains(previous=>Object.fromEntries(questions.alerts.map(a=>[a.id,previous[a.id]??a.suggested_domain??""])));
    const completed=history.alerts.filter(a=>a.result_node_id&&a.result_project_id===projectId);
    const newResults=completed.filter(a=>!placed.current.has(a.id));
    if(newResults.length){
     await onPlacedRef.current();
     if(disposed)return;
     newResults.forEach(a=>placed.current.add(a.id));
     setMessage("Материалы обработаны. Список документов обновлён.");
    }
    setReady(true);setError("");
   }catch {if(!disposed){setReady(false);setError("Не удалось прочитать поступления проекта. Проверьте доступ и обновите список.");}}
   finally {if(!disposed)timer=setTimeout(()=>{if(document.visibilityState!=="hidden")void load();},5000);}
  }
  if(!busy)void load();
  const refresh=()=>{if(document.visibilityState!=="hidden")setRevision(v=>v+1);};
  document.addEventListener("visibilitychange",refresh);
  return()=>{disposed=true;clearTimeout(timer);document.removeEventListener("visibilitychange",refresh);};
 },[ui,projectId,busy,revision]);
 const files=alerts.filter(a=>a.blob_sha256_hex&&a.status==="open");
 const selected=files.filter(a=>!excluded.has(a.id));
 async function confirm(){
  if(busy||!ready||!selected.length)return;
  let plan:Array<{id:string;place:string}>;
  try {plan=selected.map(a=>({id:a.id,place:intakePlacement(slug,domains[a.id]??"",a.paths[0]??"")}));}
  catch {setError("Укажите предметную область для каждого выбранного файла.");return;}
  setReady(false);setBusy(true);setError("");setMessage("");let accepted=0;
  try {
   for(const item of plan){await ui.decideInboxAlert(item.id,{approve:true,place:item.place,intake_project_id:projectId});accepted++;}
   setMessage(`Подтверждено: ${accepted}. Документы появятся после обработки.`);

  }catch {setMessage(`Подтверждено: ${accepted}. Остальные решения проверяем по серверу.`);}
  finally {setBusy(false);setRevision(v=>v+1);}
 }
 const processing=status?(status.in_queue+status.awaiting_placement+Math.max(0,status.awaiting_classification-files.length)):0;
 const failed=status?.dead_lettered??0;
 if(!files.length&&!processing&&!failed&&!error&&!message)return null;
 return <Block title="Проверьте загруженные материалы" count={files.length} actions={<Button size="sm" variant="ghost" disabled={busy} onClick={()=>setRevision(v=>v+1)}>Обновить</Button>}>
  {processing>0&&<p role="status" className="text-sm text-kumo-subtle">В обработке: {processing}. Обновляем состояние автоматически.</p>}
  {failed>0&&<Notice tone="danger">Не удалось обработать файлов: {failed}. Исходные файлы сохранены.</Notice>}
  {error&&<Notice tone="danger">{error}</Notice>}
  {message&&<Notice>{message}</Notice>}
  {!ready&&!busy&&files.length>0&&<p role="status" className="text-sm text-kumo-subtle">Проверяем актуальные решения…</p>}
  <fieldset disabled={busy||!ready} className="m-0 border-0 p-0">
   {selected.length>1&&<div className="mb-2 flex flex-wrap items-end gap-2">
    <label className="w-48 text-xs text-kumo-subtle">Область выбранных файлов<TextInput aria-label="Область выбранных файлов" value={bulkDomain} onChange={e=>setBulkDomain(e.target.value)}/></label>
    <Button size="sm" variant="secondary" disabled={!bulkDomain.trim()} onClick={()=>{setDomains(previous=>({...previous,...Object.fromEntries(selected.map(a=>[a.id,bulkDomain.trim()]))}));setError("");}}>Применить к выбранным</Button>
   </div>}
   <div className="divide-y divide-kumo-line">{files.map(file=><div key={file.id} className="flex flex-wrap items-center gap-3 py-3">
    <label className="flex min-w-0 flex-1 items-center gap-3 text-sm"><input type="checkbox" checked={!excluded.has(file.id)} onChange={()=>setExcluded(previous=>{const next=new Set(previous);if(next.has(file.id))next.delete(file.id);else next.add(file.id);return next;})}/><span className="break-all">{file.paths[0]||"Материал"}</span></label>
    <label className="w-48 text-xs text-kumo-subtle">Предметная область<TextInput aria-label={`Область: ${file.paths[0]}`} value={domains[file.id]??""} onChange={e=>setDomains(previous=>({...previous,[file.id]:e.target.value}))}/></label>
   </div>)}</div>
   {files.length>0&&<Button size="sm" disabled={!selected.length||!slug||Boolean(error)} onClick={()=>void confirm()}>{busy?"Подтверждаем…":`Подтвердить: ${selected.length}`}</Button>}
  </fieldset>
  {truncated&&<Notice>После подтверждения появятся следующие материалы.</Notice>}
 </Block>;
}
