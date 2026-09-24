import { useEffect, useRef, useState } from "react";
import { FileText } from "@phosphor-icons/react";
import type { AdminPerson } from "../src/admin-people.ts";
import type { PrivateDocumentPage } from "../src/mnemos-api.ts";
import type { MemoryData } from "./data.ts";
import { useHost, useUi } from "./host.ts";
import { Notice, StatusBadge } from "./ui.tsx";
import { Card, CardRow, Pill } from "./admin-ui.tsx";

type Document = PrivateDocumentPage["documents"][number];
const selectClass = "h-9 rounded-full border border-kumo-fill-hover bg-kumo-overlay px-3 text-[14px] text-kumo-default outline-none focus:border-kumo-ring";

/** Личные версии сотрудников — для администратора, раскрытием на странице «Материалы». */
export default function AdministrativeDocuments({data, initialProject}: {data:MemoryData;initialProject:string}) {
 const ui=useUi(), host=useHost();
 const [people,setPeople]=useState<AdminPerson[]>([]);
 const [peopleError,setPeopleError]=useState("");
 const [project,setProject]=useState(initialProject || data.projects[0]?.id || "");
 const [owner,setOwner]=useState("");
 const [page,setPage]=useState<PrivateDocumentPage|null>(null);
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState("");
 const [opened,setOpened]=useState<{document:Document;text:string|null;error:string}|null>(null);
 const [downloading,setDownloading]=useState(false);
 const [downloadError,setDownloadError]=useState("");
 const generation=useRef(0);
 const alive=useRef(true);
 useEffect(()=>()=>{alive.current=false;generation.current++;},[]);
 useEffect(()=>{let current=true;void ui.listPeople().then(result=>{if(current)setPeople(result.users);},()=>{if(current)setPeopleError("Не удалось загрузить сотрудников. Обновите страницу.");});return()=>{current=false;};},[ui]);
 useEffect(()=>{void load("");},[project,owner,ui]);
 async function load(cursor:string) {
  const current=++generation.current;
  setOpened(null);setPage(null);setError("");setDownloadError("");
  if(!project||!owner){setLoading(false);return;}
  setLoading(true);
  try {const result=await ui.listPrivateDocumentsForOwner(project,owner,cursor);if(alive.current&&current===generation.current)setPage(result);}
  catch {if(alive.current&&current===generation.current)setError("Не удалось прочитать личные версии. Проверьте подключение и административный доступ.");}
  finally {if(alive.current&&current===generation.current)setLoading(false);}
 }
 async function open(document:Document) {
  if(!page)return;
  const current=++generation.current;
  setOpened({document,text:null,error:""});
  try {
   if(document.conflicted)throw new Error("В документе конфликт версий. Для его разбора откройте проект вместе с автором.");
   if(!/^(text\/|application\/(json|xml|javascript|x-yaml|yaml)(;|$))/.test(document.content_type))throw new Error("Предпросмотр этого формата пока недоступен. Скачайте файл, чтобы открыть его в подходящем приложении.");
   const text=await host.downloadText(project,document.node_id,"private:"+page.head,0);
   if(alive.current&&current===generation.current)setOpened({document,text,error:""});
  }catch(reason){if(alive.current&&current===generation.current)setOpened({document,text:null,error:reason instanceof Error&&/^(В документе конфликт|Предпросмотр)/.test(reason.message)?reason.message:"Не удалось загрузить документ. Повторите попытку."});}
 }
 async function download(document:Document) {
  if(!page||document.conflicted)return;
  const current=generation.current;
  setDownloading(true);setDownloadError("");
  try{await host.downloadFile(project,document.node_id,"private:"+page.head,document.name);}
  catch{if(alive.current&&generation.current===current)setDownloadError("Не удалось скачать файл. Проверьте подключение и повторите попытку.");}
  finally{if(alive.current)setDownloading(false);}
 }
 const name=people.find(person=>person.userName===owner)?.displayName || "сотрудник";
 return <section aria-label="Личные версии сотрудников" className="space-y-4">
  <p className="m-0 text-sm text-kumo-subtle">Выберите автора и проект. Просмотр не меняет документ.</p>
  <div className="flex flex-wrap items-end gap-3">
   <label className="flex min-w-48 flex-col gap-1 text-sm text-kumo-default">Автор<select aria-label="Автор личных версий" className={selectClass} value={owner} onChange={event=>setOwner(event.target.value)}><option value="">Выберите сотрудника</option>{people.map(person=><option key={person.userName} value={person.userName}>{person.displayName || "Сотрудник без имени"}{person.active===false?" · неактивен":""}</option>)}</select></label>
   <label className="flex min-w-48 flex-col gap-1 text-sm text-kumo-default">Проект<select aria-label="Проект личных версий" className={selectClass} value={project} onChange={event=>setProject(event.target.value)}>{!project&&<option value="">Выберите проект</option>}{data.projects.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
   <Pill disabled={loading||!owner||!project} onClick={()=>void load("")}>Обновить список</Pill>
  </div>
  {peopleError&&<Notice tone="danger">{peopleError}</Notice>}
  {error&&<Notice tone="danger">{error}</Notice>}
  {loading&&<Notice>Загрузка личных версий…</Notice>}
  {opened&&<section aria-label="Просмотр личной версии" className="grid gap-2 rounded-2xl border border-kumo-fill bg-kumo-overlay p-5">
   <div className="flex flex-wrap items-center gap-2"><div className="min-w-0 flex-1"><h3 className="m-0 text-[17px] font-semibold text-kumo-default">{opened.document.name}</h3><p className="m-0 text-[13px] text-kumo-subtle">Автор: {name} · {data.projects.find(item=>item.id===project)?.name}</p></div>
   <Pill disabled={downloading||opened.document.conflicted} onClick={()=>void download(opened.document)}>{downloading?"Скачивание…":"Скачать файл"}</Pill><Pill tone="ghost" onClick={()=>{generation.current++;setOpened(null);}}>Свернуть</Pill></div>
   {downloadError&&<Notice tone="danger">{downloadError}</Notice>}
   {opened.error?<><Notice tone="danger">{opened.error}</Notice><div><Pill onClick={()=>void open(opened.document)}>Повторить загрузку</Pill></div></>:opened.text===null?<Notice>Загрузка документа…</Notice>:<pre className="m-0 whitespace-pre-wrap break-words font-serif text-[15px] leading-relaxed text-kumo-default">{opened.text||"(Пустой файл)"}</pre>}
  </section>}
  {page&&<>
   {page.documents.length===0&&<Notice>На этой странице нет доступных личных документов{page.next_cursor?". Продолжите просмотр следующей страницы.":"."}</Notice>}
   {page.documents.length>0&&<Card>{page.documents.map(document=><CardRow key={document.node_id}><FileText size={20} className="shrink-0 text-kumo-subtle"/><div className="min-w-0 flex-1"><button type="button" className="text-left text-[15px] font-medium text-kumo-default hover:underline" onClick={()=>void open(document)}>{document.name}</button><p className="m-0 text-xs text-kumo-subtle">{name}</p></div><StatusBadge tone={document.conflicted?"danger":"neutral"}>{document.conflicted?"Конфликт":"Личная версия"}</StatusBadge></CardRow>)}</Card>}
   {page.next_cursor&&<div><Pill onClick={()=>void load(page.next_cursor)}>Следующая страница</Pill></div>}
  </>}
 </section>;
}
