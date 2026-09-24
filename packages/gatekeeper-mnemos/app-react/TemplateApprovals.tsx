import {BLUEPRINT_TEMPLATE_MIME} from '@gadgets/workshop-shared/blueprint-template';
import {useState} from "react";
import {Button} from "@cloudflare/kumo";
import {useHost,useUi} from "./host.ts";
import {Notice,Row,RowText,TextInput} from "./ui.tsx";
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
 return <div className="border-b border-kumo-line py-2">
  <Row><RowText title={proposal.message} note={`${scope.name} · версия ${proposal.template_revision} · от ${personName(proposal.user_id)}`}/><Button size="sm" variant="secondary" disabled={busy} onClick={()=>open?setOpen(false):void inspect()}>{open?"Свернуть":"Проверить шаблон"}</Button></Row>
  {open&&<div className="space-y-3 px-3 pb-3 text-sm">
   <p className="text-kumo-subtle">{proposal.expected_catalogue_revision?"Сравните предложение с общей версией, на основе которой оно подготовлено.":"Предлагается сделать шаблон доступным этому подразделению."}</p>
   {error&&<Notice tone="danger">{error}</Notice>}
   {busy&&<p role="status">Проверяем…</p>}
   {gadget&&ready&&<div><Button size="sm" variant="secondary" disabled={busy} onClick={()=>void openGadget()}>Открыть копию в гаджете</Button><p className="mt-1 text-xs text-kumo-subtle">Откроется отдельная рабочая копия. Для решения вернитесь назад; общий шаблон останется прежним.</p></div>}
   {text!==null&&<div className={baseline===null?"":"grid gap-3 lg:grid-cols-2"}>
    {baseline!==null&&<section aria-label="До изменений"><h3 className="mb-2 font-medium">До изменений · общая версия {proposal.expected_catalogue_revision}</h3><pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg border border-kumo-line p-3 font-sans">{baseline}</pre></section>}
    <section aria-label="Предложенная версия"><h3 className="mb-2 font-medium">Предложенная версия</h3><pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg border border-kumo-line p-3 font-sans">{text}</pre></section>
   </div>}
   {!busy&&(!ready||text===null)&&<Button size="sm" variant="secondary" onClick={()=>void inspect()}>Повторить проверку</Button>}
   {saved?<div><p>{saved.receipt?"Решение записано.":`Сохранено решение: ${saved.input.approved?"одобрить":"отклонить"}.`}</p>{!saved.receipt&&ready&&<Button size="sm" disabled={busy} onClick={()=>void decide()}>Повторить сохранённое решение</Button>}</div>:<>
    <label className="flex max-w-xl flex-col gap-1">Комментарий<TextInput className="w-full" aria-label="Комментарий к шаблону" value={comment} disabled={busy||!ready} onChange={e=>setComment(e.target.value)}/></label>
    <div className="flex gap-2"><Button size="sm" variant="secondary" disabled={busy||!ready||!comment.trim()} onClick={()=>void decide(false)}>Отклонить шаблон</Button><Button size="sm" disabled={busy||!ready||text===null||!comment.trim()} onClick={()=>void decide(true)}>Одобрить шаблон</Button></div>
   </>}
  </div>}
 </div>;
}
