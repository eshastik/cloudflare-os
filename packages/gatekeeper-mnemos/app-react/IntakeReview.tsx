import {useEffect,useState} from "react";
import {Button} from "@cloudflare/kumo";
import {FolderOpen,FileText,CheckCircle} from "@phosphor-icons/react";
import type {IntakeAlert} from "../src/intake.ts";
import {buildIntakePlan,selectedFromFolder,type IntakeChoice,type IntakePlanItem} from "../src/intake-review.ts";
import type {ProjectPage} from "../src/mnemos-api.ts";
import {useUi} from "./host.ts";
import {Notice,Select,TextInput} from "./ui.tsx";
const NEW_PROJECT="__new__";
const DOMAINS=["юридический","финансовый","коммерческий","технический","административный","общий"];

export default function IntakeReview({alerts,projects,refresh}:{alerts:IntakeAlert[];projects:ProjectPage["projects"];refresh():Promise<void>}) {
 const ui=useUi();
 const [selected,setSelected]=useState<Set<string>>(new Set());
 const [choices,setChoices]=useState<Record<string,IntakeChoice>>({});
 const [project,setProject]=useState("");
 const [domain,setDomain]=useState("");
 const [newName,setNewName]=useState("");
 const [newSlug,setNewSlug]=useState(()=>"project-"+crypto.randomUUID().slice(0,12));
 const [created,setCreated]=useState(false);
 const [draftProjects,setDraftProjects]=useState<Record<string,{name:string;created:boolean}>>({});
 const [note,setNote]=useState("");
 const [approve,setApprove]=useState(true);
 const [plan,setPlan]=useState<IntakePlanItem[]|null>(null);
 const [error,setError]=useState("");
 const [busy,setBusy]=useState(false);
 const [outcomes,setOutcomes]=useState<Record<string,string>>({});
 const files=alerts.filter(a=>a.status==="open"&&a.blob_sha256_hex);
 useEffect(()=>{
  setChoices(previous=>{
   const next={...previous};
   for(const alert of files)if(!next[alert.id])next[alert.id]={project:alert.proposed_project_slug??"",domain:alert.suggested_domain??"",file:alert.paths[0]??""};
   return next;
  });
 },[alerts]);
 const folders=[...new Set(files.flatMap(a=>a.paths.flatMap(path=>{const parts=path.split("/");return parts.length===1?[""]:parts.slice(0,-1).map((_,i)=>parts.slice(0,i+1).join("/"));})))].toSorted();
 const toggle=(id:string)=>{setPlan(null);setSelected(current=>{const next=new Set(current);if(next.has(id))next.delete(id);else next.add(id);return next;});};
 const change=(id:string,patch:Partial<IntakeChoice>)=>{setPlan(null);setChoices(current=>({...current,[id]:{...current[id],...patch}}));};
 const chooseFolder=(folder:string)=>{setPlan(null);setSelected(current=>new Set([...current,...selectedFromFolder(files,folder)]));};
 function applyGroup(){
  setPlan(null);setError("");
  if(project===NEW_PROJECT)setDraftProjects(current=>({...current,[newSlug]:{name:newName,created}}));
  setChoices(current=>{const next={...current};for(const id of selected)if(next[id])next[id]={...next[id],...(project?{project:project===NEW_PROJECT?newSlug:project}:{}),...(domain.trim()?{domain:domain.trim()}:{})};return next;});
 }
 const draftName=(slug:string)=>slug===newSlug?newName:draftProjects[slug]?.name??"";
 function preview(approve=true){
  setError("");
  try {
   const next=approve?buildIntakePlan(files,selected,choices):files.filter(file=>selected.has(file.id)).map(file=>({id:file.id,paths:file.paths,place:""}));
   if(!next.length)throw Error("Выберите материалы для размещения.");
   for(const item of next){const slug=item.place.split("/")[0];if((slug===newSlug||draftProjects[slug])&&!draftName(slug).trim())throw Error("Укажите название нового проекта.");}
   setApprove(approve);setPlan(next);
  }catch(err){setError(err instanceof Error?err.message:"Проверьте размещение материалов.");}
 }
 async function confirm(){
  if(busy||!plan)return;setBusy(true);setError("");
  const results:Record<string,string>={};
  try {
   const newProjects=[...new Set(plan.map(item=>item.place.split("/")[0]))].filter(slug=>slug===newSlug||draftProjects[slug]);
   for(const slug of newProjects){
    if((slug===newSlug&&created)||draftProjects[slug]?.created)continue;
    // После потерянного ответа восстанавливаем тот же проект по сохранённому slug.
    const existing=await ui.listProjects();
    if(!existing.projects.some(p=>p.slug===slug))await ui.createProject(draftName(slug).trim(),slug);
    if(slug===newSlug)setCreated(true);
    setDraftProjects(current=>({...current,[slug]:{name:draftName(slug),created:true}}));
   }
   for(const item of plan){
    try {await ui.decideInboxAlert(item.id,{approve,...(approve?{place:item.place}:{}),note});results[item.id]=approve?"Размещение подтверждено":"Предложение отклонено";}
    catch {results[item.id]="Не подтверждено — обновите состояние перед повтором";}
    setOutcomes(current=>({...current,...results}));
   }
   setSelected(current=>new Set([...current].filter(id=>!results[id] || results[id].startsWith("Не подтверждено"))));
   setPlan(null);await refresh();
  }catch {setError("Операция не подтверждена. Уже созданный проект и принятые решения сохраняются. Обновите состояние перед повтором.");}
  finally {setBusy(false);}
 }
 const completed=Object.values(outcomes).filter(value=>!value.startsWith("Не подтверждено")).length;
 if(!files.length)return completed?<Notice>Подтверждено решений: {completed}. Материалы переданы в обработку.</Notice>:null;
 const selectedCount=files.filter(file=>selected.has(file.id)).length;
 return <section aria-label="Проверка распределения материалов" className="space-y-4">
  {completed>0&&<Notice>Подтверждено решений: {completed}. Остальные материалы показаны ниже.</Notice>}
  <div className="rounded-xl border border-kumo-line bg-kumo-base p-4">
   <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="m-0 text-base font-semibold">Проверьте распределение</h3><p className="mb-0 mt-1 text-sm text-kumo-subtle">Выберите файлы или папку. Проект и область можно назначить сразу всей группе.</p></div><span className="rounded-full bg-kumo-fill px-3 py-1 text-xs">Выбрано {selectedCount} из {files.length}</span></div>
   <p className="mb-0 mt-2 text-xs text-kumo-subtle">{new Set(files.filter(f=>selected.has(f.id)).map(f=>choices[f.id]?.domain).filter(Boolean)).size>1?"В выбранной группе разные предметные области. Они сохранятся, пока вы не назначите общую.":"Каждый файл сохраняет свою область до явного изменения."}</p>
   <div className="mt-4 flex flex-wrap gap-2">
    <Button size="sm" variant="secondary" disabled={busy} onClick={()=>{setSelected(new Set(files.map(f=>f.id)));setPlan(null);}}>Выбрать все</Button>
    <Button size="sm" variant="ghost" disabled={busy||!selectedCount} onClick={()=>{setSelected(new Set());setPlan(null);}}>Снять выбор</Button>
    {folders.map(folder=><Button key={folder} size="sm" variant="ghost" disabled={busy} onClick={()=>chooseFolder(folder)}><FolderOpen size={15}/>{folder||"Файлы без папки"}</Button>)}
   </div>
  </div>
  <fieldset disabled={busy} className="m-0 min-w-0 space-y-4 border-0 p-0">
   {selectedCount>0&&<div className="grid gap-3 rounded-xl border border-kumo-line bg-kumo-elevated p-4 sm:grid-cols-2">
    <label className="text-sm">Проект для выбранных<Select aria-label="Проект для выбранных" value={project} onChange={e=>{setProject(e.target.value);setPlan(null);}}><option value="">Сохранить индивидуальный выбор</option>{projects.map(p=><option key={p.id} value={p.slug}>{p.name}</option>)}<option value={NEW_PROJECT}>Создать новый проект</option></Select></label>
    <label className="text-sm">Область для выбранных<TextInput aria-label="Область для выбранных" list="intake-domains" value={domain} placeholder="Сохранить индивидуальный выбор" onChange={e=>{setDomain(e.target.value);setPlan(null);}}/></label>
    {project===NEW_PROJECT&&<label className="text-sm">Название нового проекта<TextInput aria-label="Название нового проекта" value={newName} disabled={created} onChange={e=>{setNewName(e.target.value);setPlan(null);}}/></label>}
    {created&&<Notice>Новый проект уже создан. Его имя сохраняется при повторе размещения.</Notice>}
    <div className="flex items-end gap-2"><Button variant="secondary" onClick={applyGroup}>Применить к выбранным</Button>{created&&<Button variant="ghost" onClick={()=>{setNewSlug("project-"+crypto.randomUUID().slice(0,12));setNewName("");setCreated(false);setPlan(null);}}>Другой новый проект</Button>}</div>
   </div>}
   <datalist id="intake-domains">{DOMAINS.map(area=><option key={area} value={area}/>)}</datalist>
   <div className="divide-y divide-kumo-line overflow-hidden rounded-xl border border-kumo-line">
    {files.map(file=>{const choice=choices[file.id];if(!choice)return null;const checked=selected.has(file.id);return <div key={file.id} className={"p-4 "+(checked?"bg-kumo-elevated":"bg-kumo-base")}>
     <label className="flex cursor-pointer items-start gap-3"><input type="checkbox" checked={checked} onChange={()=>toggle(file.id)} aria-label={`Выбрать ${file.paths[0]||"материал"}`} className="mt-1"/><FileText size={18} className="mt-0.5 shrink-0 text-kumo-subtle"/><div className="min-w-0"><strong className="break-words text-sm">{file.paths[0]||"Материал"}</strong>{file.paths.length>1&&<p className="mb-0 mt-1 text-xs text-kumo-subtle">Ещё путей этого содержимого: {file.paths.length-1}</p>}</div></label>
     <p className="mb-0 ml-7 mt-2 text-xs text-kumo-subtle">{file.suggested_project_name?`Предложен новый проект: ${file.suggested_project_name}. `:""}{file.proposed_project_slug?`Предложен проект: ${projects.find(p=>p.slug===file.proposed_project_slug)?.name??file.proposed_project_slug}. `:""}{file.suggested_domain?`Предметная область: ${file.suggested_domain}.`:"Предметная область требует выбора."}</p>
     {file.suggested_project_name&&<Button size="sm" variant="ghost" className="ml-7 mt-2" onClick={()=>{const name=file.suggested_project_name!;const slug=Object.entries(draftProjects).find(([,draft])=>draft.name===name)?.[0]??"project-"+crypto.randomUUID().slice(0,12);setDraftProjects(current=>({...current,[slug]:current[slug]??{name,created:false}}));setSelected(current=>new Set([...current,file.id]));change(file.id,{project:slug});}}>Использовать предложенный проект</Button>}
     {checked&&<div className="ml-7 mt-3 grid gap-3 sm:grid-cols-3">
      <label className="text-xs">Проект<Select aria-label={`Проект: ${file.paths[0]}`} value={choice.project} onChange={e=>change(file.id,{project:e.target.value})}><option value="">Выберите проект</option>{projects.map(p=><option key={p.id} value={p.slug}>{p.name}</option>)}{Object.entries(draftProjects).filter(([slug])=>!projects.some(p=>p.slug===slug)).map(([slug,draft])=><option key={slug} value={slug}>{slug===newSlug?newName:draft.name} · новый проект</option>)}</Select></label>
      <label className="text-xs">Область<TextInput aria-label={`Область: ${file.paths[0]}`} list="intake-domains" value={choice.domain} onChange={e=>change(file.id,{domain:e.target.value})}/></label>
      <label className="text-xs">Путь материала<TextInput aria-label={`Имя: ${file.paths[0]}`} value={choice.file} onChange={e=>change(file.id,{file:e.target.value})}/></label>
     </div>}
     {file.candidates.length>0&&<details className="ml-7 mt-2 text-xs text-kumo-subtle"><summary>Варианты разбора</summary><ul>{file.candidates.map((candidate,i)=><li key={i}>{candidate}</li>)}</ul></details>}
     {outcomes[file.id]&&<p role="status" className="ml-7 mb-0 mt-2 text-sm">{outcomes[file.id]}</p>}
    </div>;})}
   </div>
   {error&&<Notice tone="danger">{error}</Notice>}
   {!plan?<div className="flex flex-wrap gap-2"><Button disabled={!selectedCount} onClick={()=>preview()}>Проверить итог размещения</Button><Button variant="ghost" disabled={!selectedCount} onClick={()=>preview(false)}>Отклонить выбранные</Button></div>:<div className="rounded-xl border border-kumo-line bg-kumo-elevated p-5">
    <h3 className="mt-0 flex items-center gap-2 text-base"><CheckCircle size={20}/>{approve?"Итог перед размещением":"Проверка отклонения"}</h3>
    {[...new Set(plan.map(p=>p.place.split("/")[0]))].filter(slug=>(slug===newSlug||draftProjects[slug])&&!draftProjects[slug]?.created).map(slug=><p key={slug}>Будет создан проект «{draftName(slug)}».</p>)}
    <ul className="space-y-2 pl-4 text-sm">{plan.map(item=><li key={item.id}><span className="text-kumo-subtle">{item.paths[0]}</span><br/><strong>{!approve?"Предложение будет отклонено":item.place.split("/").map((part,i)=>i===0?(draftName(part)||projects.find(p=>p.slug===part)?.name||part):part).join(" / ")}</strong></li>)}</ul>
    <label className="text-sm">Комментарий к размещению<TextInput value={note} onChange={e=>setNote(e.target.value)}/></label>
    <p className="text-xs text-kumo-subtle">Права сотрудников не изменятся. Каждый файл подтверждается отдельно; при частичном сбое принятые решения сохранятся.</p>
    <div className="mt-4 flex flex-wrap gap-2"><Button onClick={()=>void confirm()}>Подтвердить {approve?"размещение":"отклонение"}: {plan.length}</Button><Button variant="ghost" onClick={()=>setPlan(null)}>Вернуться к проверке</Button></div>
   </div>}
  </fieldset>
  {busy&&<Notice>Подтверждаем размещение. Не закрывайте страницу.</Notice>}
 </section>;
}
