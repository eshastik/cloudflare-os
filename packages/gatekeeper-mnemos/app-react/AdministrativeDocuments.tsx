import { useEffect, useRef, useState } from "react";
import { Button } from "@cloudflare/kumo";
import { ArrowLeft, FileText } from "@phosphor-icons/react";
import type { AdminPerson } from "../src/admin-people.ts";
import type { PrivateDocumentPage } from "../src/mnemos-api.ts";
import type { MemoryData } from "./data.ts";
import { useHost, useUi } from "./host.ts";
import { Notice, Row, RowList, StatusBadge } from "./ui.tsx";

type Document = PrivateDocumentPage["documents"][number];
const selectClass = "h-9 rounded-lg border border-kumo-line bg-kumo-base px-3 text-sm text-kumo-default";

export default function AdministrativeDocuments({data, initialProject, onClose}: {data:MemoryData;initialProject:string;onClose():void}) {
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
 useEffect(()=>{let current=true;void ui.listPeople().then(result=>{if(current)setPeople(result.users);},()=>{if(current)setPeopleError("Не удалось загрузить сотрудников. Вернитесь к материалам и повторите попытку.");});return()=>{current=false;};},[ui]);
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
 const name=people.find(person=>person.userName===owner)?.displayName || owner;
 return <section aria-label="Личные версии сотрудников" className="space-y-4">
  <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={onClose}>К материалам</Button>
  <div><h2 className="m-0 text-lg font-semibold text-kumo-strong">Личные версии сотрудников</h2><p className="mt-1 text-sm text-kumo-subtle">Выберите автора и проект. Просмотр сохраняет исходную версию документа.</p></div>
  <div className="flex flex-wrap items-end gap-3">
   <label className="flex min-w-48 flex-col gap-1 text-sm text-kumo-default">Автор<select aria-label="Автор личных версий" className={selectClass} value={owner} onChange={event=>setOwner(event.target.value)}><option value="">Выберите сотрудника</option>{people.map(person=><option key={person.userName} value={person.userName}>{person.displayName || person.userName}{person.active===false?" · неактивен":""}</option>)}</select></label>
   <label className="flex min-w-48 flex-col gap-1 text-sm text-kumo-default">Проект<select aria-label="Проект личных версий" className={selectClass} value={project} onChange={event=>setProject(event.target.value)}>{!project&&<option value="">Выберите проект</option>}{data.projects.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
   <Button variant="secondary" disabled={loading||!owner||!project} onClick={()=>void load("")}>Обновить список</Button>
  </div>
  {peopleError&&<Notice tone="danger">{peopleError}</Notice>}
  {error&&<Notice tone="danger">{error}</Notice>}
  {loading&&<Notice>Загрузка личных версий…</Notice>}
  {opened?<section aria-label="Просмотр личной версии" className="rounded-xl border border-kumo-line p-4">
   <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={()=>{generation.current++;setOpened(null);}}>К списку автора</Button>
   <h3 className="mb-1 text-base font-semibold text-kumo-strong">{opened.document.name}</h3><p className="mt-0 text-sm text-kumo-subtle">Автор: {name} · {data.projects.find(item=>item.id===project)?.name}</p>
   <Button variant="secondary" disabled={downloading||opened.document.conflicted} onClick={()=>void download(opened.document)}>{downloading?"Скачивание…":"Скачать файл"}</Button>
   {downloadError&&<Notice tone="danger">{downloadError}</Notice>}
   {opened.error?<><Notice tone="danger">{opened.error}</Notice><Button variant="secondary" onClick={()=>void open(opened.document)}>Повторить загрузку</Button></>:opened.text===null?<Notice>Загрузка документа…</Notice>:<pre className="whitespace-pre-wrap break-words font-sans text-sm text-kumo-default">{opened.text||"(Пустой файл)"}</pre>}
  </section>:page&&<>
   {page.documents.length===0&&<Notice>На этой странице нет доступных личных документов{page.next_cursor?". Продолжите просмотр следующей страницы.":"."}</Notice>}
   <RowList>{page.documents.map(document=><Row key={document.node_id}><FileText size={20} className="shrink-0 text-kumo-subtle"/><div className="min-w-0 flex-1"><button type="button" className="text-left text-sm font-medium text-kumo-default" onClick={()=>void open(document)}>{document.name}</button><p className="m-0 text-xs text-kumo-subtle">{name}</p></div><StatusBadge tone={document.conflicted?"danger":"neutral"}>{document.conflicted?"Конфликт":"Личная версия"}</StatusBadge></Row>)}</RowList>
   {page.next_cursor&&<Button variant="secondary" onClick={()=>void load(page.next_cursor)}>Следующая страница</Button>}
  </>}
 </section>;
}
