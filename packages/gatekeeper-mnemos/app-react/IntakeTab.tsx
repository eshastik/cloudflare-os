import {useCallback, useEffect, useRef, useState} from "react";
import {Button} from "@cloudflare/kumo";
import {useHost, useUi} from "./host.ts";
import type {MemoryData} from "./data.ts";
import {Block, Notice, Row, RowList, RowText} from "./ui.tsx";
import { type IntakeAlerts, type IntakeStatus, type PickedIntakeFile} from "../src/intake.ts";
import IntakeReview from "./IntakeReview.tsx";
import type {ProjectPage} from "../src/mnemos-api.ts";

const REASONS:Record<string,string>={"project.not_in_registry":"Нужен новый проект", "project.not_determined":"Уточните проект", "role.not_determined":"Уточните предметную область"};

export default function IntakeTab({data}:{data:MemoryData}) {
 const host=useHost(),ui=useUi();
 const requestRevision=useRef(0);
 const [status,setStatus]=useState<IntakeStatus|null>(null),[alerts,setAlerts]=useState<IntakeAlerts|null>(null);
 const [projects,setProjects]=useState<ProjectPage["projects"]>([]);
 const [error,setError]=useState(""),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[decided,setDecided]=useState(false);
 const [files,setFiles]=useState<PickedIntakeFile[]>([]);
 const allowed=data.identity?.capabilities?.includes("project.create");
 const reload=useCallback(async()=>{
  const revision=++requestRevision.current;setLoading(true);setError("");
  try {const [s,a,p]=await Promise.all([ui.inboxStatus(),ui.inboxAlerts(decided),ui.listProjects()]);if(revision===requestRevision.current){setStatus(s);setAlerts(a);setProjects(p.projects);}}
  catch {if(revision===requestRevision.current)setError("Не удалось получить состояние приёмной. Проверьте подключение и повторите обновление.");}
  finally {if(revision===requestRevision.current)setLoading(false);}
 },[ui,decided]);
 useEffect(()=>{if(allowed)void reload();return()=>{requestRevision.current++;};},[allowed,reload]);
 useEffect(()=>{if(!allowed||busy||!(status?.in_queue||status?.awaiting_placement))return;const timer=setTimeout(()=>{if(document.visibilityState!=="hidden")void reload();},2000);return()=>clearTimeout(timer);},[allowed,busy,status,reload]);
 useEffect(()=>{const visible=()=>{if(allowed&&document.visibilityState!=="hidden")void reload();};document.addEventListener("visibilitychange",visible);return()=>document.removeEventListener("visibilitychange",visible);},[allowed,reload]);
 useEffect(()=>{const changed=(event:MessageEvent)=>{if(event.source===window.parent&&event.data?.type==="mnemos-inbox-updated"&&allowed)void reload();};window.addEventListener("message",changed);return()=>window.removeEventListener("message",changed);},[allowed,reload]);
 async function pick(directory:boolean){
  if(busy)return;setBusy(true);setError("");
  try {const result=await host.pickInboxFiles(directory);if(result.length)setFiles(result);await reload();}
  catch {setError("Загрузка не завершена. Файлы, принятые до сбоя, остаются в приёмной; обновите состояние перед повтором.");}
  finally {setBusy(false);}
 }
 if(!allowed)return <Notice>Приём материалов организации доступен администратору с полномочием создания проектов.</Notice>;
 return <section aria-label="Приём данных">
  <Block title="Добавить материалы организации" actions={<Button disabled={loading||busy} variant="secondary" onClick={()=>void reload()}>Обновить</Button>}>
   <p>Загрузите файлы или папку. Mnemos разберёт материалы и предложит размещение. Создавать проекты заранее не нужно.</p>
   <div className="flex flex-wrap gap-2 mb-3">
    <Button disabled={busy} onClick={()=>void pick(false)}>Выбрать файлы</Button>
    <Button disabled={busy} variant="secondary" onClick={()=>void pick(true)}>Выбрать папку</Button>
   </div>
   <Notice>{busy?"Загрузка и приём файлов. Не закрывайте эту страницу.":"До 64 МБ на файл. После разбора проверьте предложенные проекты и предметные области."}</Notice>
   {error&&<Notice tone="danger">{error}</Notice>}
  </Block>
  {!!files.length&&<Block title="Последняя загрузка" count={files.length}><RowList>{files.map((file,i)=><Row key={i}><RowText title={file.path} note={file.error || (file.receipt?.enqueued?"Принят, ожидает разбора":"Приём подтверждён")} />{file.error&&<span className="text-kumo-danger">Не подтверждён</span>}</Row>)}</RowList></Block>}
  {status&&<Block title="Состояние материалов">
   <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
    {[["Всего принято",status.total],["В очереди разбора",status.in_queue],["Ожидают решения",status.awaiting_classification],["Размещены",status.placed_in_tree]].map(([label,value])=><div key={label} className="rounded-xl border border-kumo-line p-3"><div className="text-2xl">{value}</div><div>{label}</div></div>)}
   </div>
   {status.awaiting_placement>0&&<Notice>Ожидают размещения после решения: {status.awaiting_placement}.</Notice>}
  </Block>}
  <Block title={decided?"Решённые вопросы":"Требуют вашего решения"} count={alerts?.alerts.length} actions={<Button variant="secondary" disabled={loading||busy} onClick={()=>setDecided(!decided)}>{decided?"Открытые вопросы":"История решений"}</Button>}>
   {loading&&!alerts&&<Notice>Загружаем вопросы приёмной…</Notice>}
   {alerts?.alerts.length===0&&<Notice>{decided?"Решений пока нет.":"Открытых вопросов нет. После разбора здесь появятся материалы, которым нужно уточнить проект или область."}</Notice>}
   {!decided&&alerts&&<IntakeReview alerts={alerts.alerts} projects={projects} refresh={reload}/>}
   {alerts?.alerts.filter(alert=>decided||!alert.blob_sha256_hex).map(alert=><div key={alert.id} className="rounded-lg border border-kumo-line p-4 mb-3"><h3 className="mt-0">{REASONS[alert.reason]??"Материал требует проверки"}</h3>{alert.paths.map(path=><p key={path}>{path}</p>)}{decided?<Notice>{alert.status==="approved"?"Размещение подтверждено":alert.status==="declined"?"Предложение отклонено":"Вопрос закрыт"}. {alert.placement} {alert.note}</Notice>:<Notice>Вопрос относится к внешней базе. Настройте её в разделе «Источники».</Notice>}</div>)}
   {alerts?.truncated&&<Notice>Показаны первые 200 вопросов. После обработки обновите список, чтобы увидеть остальные.</Notice>}
  </Block>
  {!!status?.dead_lettered&&<Block title="Не удалось обработать" count={status.dead_lettered}><RowList>{status.dead_letters.map(item=><Row key={item.blob_sha256_hex+item.pipeline_version}><RowText title="Файл не обработан" note={`Попыток: ${item.attempts}. Причина: ${item.last_failure}`} /><Button variant="secondary" disabled={busy} onClick={()=>{setBusy(true);void ui.replayInboxItem(item.blob_sha256_hex,item.pipeline_version).then(reload).catch(()=>setError("Не удалось вернуть файл в обработку")).finally(()=>setBusy(false));}}>Повторить обработку</Button></Row>)}</RowList>{status.dead_letters_truncated&&<Notice>Список ошибок неполный. Обновите его после повторной обработки.</Notice>}</Block>}
 </section>;
}
