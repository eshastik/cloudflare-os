import {BLUEPRINT_TEMPLATE_MIME} from '@gadgets/workshop-shared/blueprint-template';
import {useState} from "react";
import {useHost,useUi} from "./host.ts";
import {Notice} from "./ui.tsx";
import {Field,FieldInput,Pill,RowTitle} from "./admin-ui.tsx";
import {personName} from "./data.ts";
import {readTemplateProposalText,readTemplateBaselineText} from "../app/template-source.ts";
import type {TemplatePromotionReview,TemplateScope} from "../src/work-templates.ts";
import type {SavedTemplateDecision} from "../src/template-review-actions.ts";

/** Первая страница предложений каждой области, где человек согласует шаблоны. */
export async function loadTemplateReviews(ui:ReturnType<typeof useUi>):Promise<{scope:TemplateScope;review:TemplatePromotionReview}[]>{
 const scopes:TemplateScope[]=[];let cursor="";
 do{const page=await ui.listTemplateReviewScopes(cursor);scopes.push(...page.scopes);cursor=page.next_cursor||"";}while(cursor);
 const pages=await Promise.all(scopes.map(async scope=>(await ui.listTemplateProposals(scope.scope_id,"")).proposals.map(review=>({scope,review}))));
 return pages.flat();
}
export function TemplateProposal({item,scope,onDone}:{item:TemplatePromotionReview;scope:TemplateScope;onDone():void}){
 const ui=useUi(),host=useHost();const [open,setOpen]=useState(false),[text,setText]=useState<string|null>(null),[error,setError]=useState(""),[comment,setComment]=useState(""),[busy,setBusy]=useState(false),[saved,setSaved]=useState<SavedTemplateDecision|null>(null),[ready,setReady]=useState(false);
 const [baseline,setBaseline]=useState<string|null>(null);
 const [gadget,setGadget]=useState<{project:string;node:string}|null>(null);
 const proposal=item.proposal,id=proposal.proposal_id;
 async function inspect(){setOpen(true);setBusy(true);setError("");setReady(false);setText(null);setBaseline(null);setGadget(null);
  try{const current=await ui.readTemplateProposal(id);const decision=await ui.readSavedTemplateDecision(id);setSaved(decision);if(current.decision){onDone();return;}const source=await ui.readTemplateProposalSource(id);if(source.source.content_type===BLUEPRINT_TEMPLATE_MIME)setGadget({project:source.source.project_id,node:source.source.node_id});setReady(true);const preview=await readTemplateProposalText(ui,id,(...args)=>host.downloadText(...args));const before=await readTemplateBaselineText(ui,id,(...args)=>host.downloadText(...args));setBaseline(before);setText(preview);}
  catch{setError("Не удалось открыть предложенную версию. Проверьте доступ и повторите.");}finally{setBusy(false);}
 }
 async function openGadget(){if(!gadget||busy)return;setBusy(true);setError("");try{await host.openTemplateProposal(gadget.project,gadget.node,id);}catch{setError("Копия шаблона не открылась. Повторите проверку предложенной версии.");}finally{setBusy(false);}}
 async function decide(approved?:boolean){if(busy||!ready)return;setBusy(true);setError("");
  try{
   if(approved!==undefined){if(saved||!comment.trim()||(approved&&text===null))return;const decision=await ui.saveTemplateDecision(id,{request_id:crypto.randomUUID(),approved,scope_revision:scope.revision,comment:comment.trim()});setSaved(decision);}
   const result=await ui.executeSavedTemplateDecision(id);setSaved(result);if(!result.receipt)throw Error("Нет подтверждения");onDone();
  }catch{setReady(false);setError("Решение не подтверждено. Сначала проверьте его состояние.");}finally{setBusy(false);}
 }
 return <div className="border-t border-kumo-fill first:border-t-0" data-template-proposal="">
  <div className="flex items-center gap-3 px-4 py-3"><RowTitle title={proposal.message||"Шаблон работы"} note={`${scope.name} · версия ${proposal.template_revision} · от ${personName(proposal.user_id)}`}/><Pill disabled={busy} aria-expanded={open} onClick={()=>open?setOpen(false):void inspect()}>{open?"Свернуть":"Проверить шаблон"}</Pill></div>
  {open&&<div className="grid gap-3 px-4 pb-4 text-[14px]">
   <p className="m-0 text-kumo-subtle">{proposal.expected_catalogue_revision?"Сравните предложение с общей версией, на основе которой оно подготовлено.":"Предлагается сделать шаблон доступным этому подразделению."}</p>
   {error&&<Notice tone="danger">{error}</Notice>}
   {busy&&<p role="status" className="m-0 text-kumo-subtle">Проверяем…</p>}
   {gadget&&ready&&<div><Pill disabled={busy} onClick={()=>void openGadget()}>Открыть копию рядом</Pill><p className="mt-1 mb-0 text-[12px] text-kumo-subtle">Откроется отдельная рабочая копия. Для решения вернитесь сюда; общий шаблон останется прежним.</p></div>}
   {text!==null&&<div className={baseline===null?"":"grid gap-3 lg:grid-cols-2"}>
    {baseline!==null&&<section aria-label="До изменений"><h3 className="m-0 mb-2 text-[14px] font-medium">До изменений · общая версия {proposal.expected_catalogue_revision}</h3><pre className="m-0 max-h-80 overflow-auto whitespace-pre-wrap rounded-xl border border-kumo-fill bg-kumo-overlay p-3 font-serif text-[14px]">{baseline}</pre></section>}
    <section aria-label="Предложенная версия"><h3 className="m-0 mb-2 text-[14px] font-medium">Предложенная версия</h3><pre className="m-0 max-h-80 overflow-auto whitespace-pre-wrap rounded-xl border border-kumo-fill bg-kumo-overlay p-3 font-serif text-[14px]">{text}</pre></section>
   </div>}
   {!busy&&(!ready||text===null)&&<div><Pill onClick={()=>void inspect()}>Повторить проверку</Pill></div>}
   {saved?<div><p className="m-0">{saved.receipt?"Решение записано.":`Сохранено решение: ${saved.input.approved?"одобрить":"отклонить"}.`}</p>{!saved.receipt&&ready&&<Pill tone="primary" className="mt-2" disabled={busy} onClick={()=>void decide()}>Повторить сохранённое решение</Pill>}</div>:<>
    <Field label="Комментарий" className="max-w-xl"><FieldInput aria-label="Комментарий к шаблону" value={comment} disabled={busy||!ready} onChange={e=>setComment(e.target.value)}/></Field>
    <div className="flex gap-2"><Pill disabled={busy||!ready||!comment.trim()} onClick={()=>void decide(false)}>Отклонить шаблон</Pill><Pill tone="primary" disabled={busy||!ready||text===null||!comment.trim()} onClick={()=>void decide(true)}>Одобрить шаблон</Pill></div>
   </>}
  </div>}
 </div>;
}
