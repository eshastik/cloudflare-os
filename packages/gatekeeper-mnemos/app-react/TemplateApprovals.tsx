import {templateTextChanges} from "../app/template-text-diff.ts";
import {BLUEPRINT_TEMPLATE_MIME} from '@gadgets/workshop-shared/blueprint-template';
import {useEffect,useState} from "react";
import {useHost,useUi} from "./host.ts";
import {Notice} from "./ui.tsx";
import {Field,FieldInput,Pill,RowTitle} from "./admin-ui.tsx";
import {personName} from "./data.ts";
import {readTemplateProposalText,readTemplateBaselineText} from "../app/template-source.ts";
import type {TemplatePromotionReview,TemplateScope,TemplateReviewRequirement} from "../src/work-templates.ts";
import type {SavedTemplateDecision,SavedTemplateContentDecision} from "../src/template-review-actions.ts";

/** Все предложения областей, где человек согласует шаблоны. */
export async function loadTemplateReviews(ui:ReturnType<typeof useUi>):Promise<{scope:TemplateScope;review:TemplatePromotionReview}[]>{
 const scopes:TemplateScope[]=[];let cursor="";
 do{const page=await ui.listTemplateReviewScopes(cursor);scopes.push(...page.scopes);cursor=page.next_cursor||"";}while(cursor);
 const pages=await Promise.all(scopes.map(async scope=>{const reviews:TemplatePromotionReview[]=[];let pageCursor="";do{const page=await ui.listTemplateProposals(scope.scope_id,pageCursor);reviews.push(...page.proposals);pageCursor=page.next_cursor||"";}while(pageCursor);return reviews.map(review=>({scope,review}));}));
 return pages.flat();
}
export function TemplateProposal({item,scope,userId,onDone}:{userId:string;item:TemplatePromotionReview;scope:TemplateScope;onDone():void}){
 const ui=useUi(),host=useHost();const [open,setOpen]=useState(false),[text,setText]=useState<string|null>(null),[error,setError]=useState(""),[comment,setComment]=useState(""),[busy,setBusy]=useState(false),[saved,setSaved]=useState<SavedTemplateDecision|null>(null),[ready,setReady]=useState(false);
 const [baseline,setBaseline]=useState<string|null>(null);
 const changes=baseline!==null&&text!==null?templateTextChanges(baseline,text):null;
 const [gadget,setGadget]=useState<{project:string;node:string}|null>(null);
 const [review,setReview]=useState(item);
 const proposal=review.proposal,id=proposal.proposal_id;
 const requirements=proposal.scope_path.flatMap(s=>(s.review_requirements??[]).map(r=>({scope:s,requirement:r})));
 const mayPublish=scope.approvers.includes(userId)&&userId!==proposal.user_id&&userId!==proposal.source_owner_id;
 const contentApproved=requirements.every(({scope:s,requirement:r})=>r.approvers.every(u=>review.content_decisions?.some(d=>d.scope_id===s.scope_id&&d.domain_id===r.domain_id&&d.reviewer_id===u&&d.approved)));
 async function inspect(){setOpen(true);setBusy(true);setError("");setReady(false);setText(null);setBaseline(null);setGadget(null);
  try{const current=await ui.readTemplateProposal(id);setReview(current);const decision=await ui.readSavedTemplateDecision(id);setSaved(decision);if(current.decision){onDone();return;}setReady(true);const source=await ui.readTemplateProposalSource(id);if(source.source.content_type===BLUEPRINT_TEMPLATE_MIME)setGadget({project:source.source.project_id,node:source.source.node_id});setReady(true);const preview=await readTemplateProposalText(ui,id,(...args)=>host.downloadText(...args));const before=await readTemplateBaselineText(ui,id,(...args)=>host.downloadText(...args));setBaseline(before);setText(preview);}
  catch{setError("Не удалось открыть предложенную версию. Проверьте доступ и повторите.");}finally{setBusy(false);}
 }
 async function openGadget(){if(!gadget||busy)return;setBusy(true);setError("");try{await host.openTemplateProposal(gadget.project,gadget.node,id);}catch{setError("Копия шаблона не открылась. Повторите проверку предложенной версии.");}finally{setBusy(false);}}
 async function decide(approved?:boolean){if(busy||!ready||!mayPublish||(approved===true||approved===undefined&&saved?.input.approved)&&(!contentApproved||text===null))return;setBusy(true);setError("");
  try{
   if(approved!==undefined){if(saved||!comment.trim()||(approved&&text===null))return;const decision=await ui.saveTemplateDecision(id,{request_id:crypto.randomUUID(),approved,publish_snapshot:approved,scope_revision:proposal.target_scope_revision,comment:comment.trim()});setSaved(decision);}
   const result=await ui.executeSavedTemplateDecision(id);setSaved(result);if(!result.receipt)throw Error("Нет подтверждения");onDone();
  }catch{setReady(false);setError("Решение не подтверждено. Сначала проверьте его состояние.");}finally{setBusy(false);}
 }
 return <div className="border-t border-kumo-fill first:border-t-0" data-template-proposal="">
  <div className="flex items-center gap-3 px-4 py-3"><RowTitle title={proposal.message||"Шаблон работы"} note={`${scope.name} · версия ${proposal.template_revision} · от ${personName(proposal.user_id)}`}/><Pill disabled={busy} aria-expanded={open} onClick={()=>open?setOpen(false):void inspect()}>{open?"Свернуть":"Проверить шаблон"}</Pill></div>
  {open&&<div className="grid gap-3 px-4 pb-4 text-[14px]">
   <p className="m-0 text-kumo-subtle">{proposal.expected_catalogue_revision?"Сравните текст предложения с закреплённой общей версией. Просмотр текста не проверяет оформление и структуру документа.":"Прочитайте предложенный текст. После согласования эта точная версия станет доступна участникам области."}</p>
   {error&&<Notice tone="danger">{error}</Notice>}
   {busy&&<p role="status" className="m-0 text-kumo-subtle">Проверяем…</p>}
   {gadget&&ready&&<div><Pill disabled={busy} onClick={()=>void openGadget()}>Открыть копию рядом</Pill><p className="mt-1 mb-0 text-[12px] text-kumo-subtle">Откроется отдельная рабочая копия. Для решения вернитесь сюда; общий шаблон останется прежним.</p></div>}
   {text!==null&&baseline!==null&&<section aria-label="Изменения текста" className="grid gap-2">
    <h3 className="m-0 text-[14px] font-medium">Что изменилось</h3>
    {changes===null?<p className="m-0 text-kumo-subtle">Текст слишком длинный для краткого сравнения. Проверьте полные версии ниже.</p>:changes.length===0?<p className="m-0 text-kumo-subtle">Текст совпадает. Оформление и структуру нужно проверить отдельно.</p>:<ul className="m-0 grid list-none gap-2 p-0">{changes.map((change,index)=><li key={index} className="rounded-lg border border-kumo-fill px-3 py-2"><span className="mb-1 block text-[12px] font-medium text-kumo-subtle">{change.kind==='removed'?'Удалено':'Добавлено'}</span><p className="m-0 whitespace-pre-wrap break-words leading-6">{change.text||'Пустая строка'}</p></li>)}</ul>}
   </section>}
   {text!==null&&<details open={baseline===null}><summary className="cursor-pointer text-[13px] text-kumo-subtle">{baseline===null?'Текст предложенной версии':'Полные тексты версий'}</summary><div className={baseline===null?"":"grid gap-3 lg:grid-cols-2"}>
    {baseline!==null&&<section aria-label="До изменений"><h3 className="m-0 mb-2 text-[14px] font-medium">До изменений · общая версия {proposal.expected_catalogue_revision}</h3><pre className="m-0 max-h-80 overflow-auto whitespace-pre-wrap break-words border-t border-kumo-fill pt-3 font-sans text-[14px] leading-6">{baseline}</pre></section>}
    <section aria-label="Предложенная версия"><h3 className="m-0 mb-2 text-[14px] font-medium">Предложенная версия</h3><pre className="m-0 max-h-80 overflow-auto whitespace-pre-wrap break-words border-t border-kumo-fill pt-3 font-sans text-[14px] leading-6">{text}</pre></section>
   </div></details>}
   {!busy&&(!ready||text===null)&&<div><Pill onClick={()=>void inspect()}>Повторить проверку</Pill></div>}
   {requirements.map(({scope:s,requirement:r})=><TemplateContentReview key={JSON.stringify([s.scope_id,r.domain_id])} review={review} scope={s} requirement={r} userId={userId} ready={ready&&!busy} verified={text!==null} onDone={()=>void inspect()}/>)}
   {mayPublish&&<p className="m-0 text-kumo-subtle">Публикация откроет участникам области эту версию шаблона. Исходный личный документ останется доступен по своим правам. Необходимы все согласования по направлениям.</p>}
   {mayPublish&&(saved?<div><p className="m-0">{saved.receipt?"Решение записано.":`Сохранено решение: ${saved.input.approved?"одобрить":"отклонить"}.`}</p>{!saved.receipt&&ready&&<Pill tone="primary" className="mt-2" disabled={busy||saved.input.approved&&(text===null||!contentApproved)} onClick={()=>void decide()}>Повторить сохранённое решение</Pill>}</div>:<>
    <Field label="Комментарий" className="max-w-xl"><FieldInput aria-label="Комментарий к шаблону" value={comment} disabled={busy||!ready} onChange={e=>setComment(e.target.value)}/></Field>
    <div className="flex gap-2"><Pill disabled={busy||!ready||!comment.trim()} onClick={()=>void decide(false)}>Отклонить шаблон</Pill><Pill tone="primary" disabled={busy||!ready||text===null||!contentApproved||!comment.trim()} onClick={()=>void decide(true)}>Опубликовать шаблон</Pill></div>
   </>)}
  </div>}
 </div>;
}

function TemplateContentReview({review,scope,requirement,userId,ready,verified,onDone}:{review:TemplatePromotionReview;scope:TemplateScope;requirement:TemplateReviewRequirement;userId:string;ready:boolean;verified:boolean;onDone():void}){
 const ui=useUi(),id=review.proposal.proposal_id,domain=requirement.domain_id;
 const [saved,setSaved]=useState<SavedTemplateContentDecision|null>(null),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[comment,setComment]=useState('');
 const mayDecide=requirement.approvers.includes(userId)&&userId!==review.proposal.user_id&&userId!==review.proposal.source_owner_id;
 const mine=review.content_decisions?.find(d=>d.scope_id===scope.scope_id&&d.domain_id===domain&&d.reviewer_id===userId);
 async function load(){setLoaded(false);setError('');try{setSaved(await ui.readSavedTemplateContentDecision(id,scope.scope_id,domain));setLoaded(true);}catch{setError('Не удалось проверить сохранённое решение.');}}
 useEffect(()=>{if(mayDecide)void load();},[id,scope.scope_id,domain,mayDecide]);
 async function decide(approved?:boolean){if(busy||!ready||!loaded||!mayDecide||mine||approved===true&&!verified)return;setBusy(true);setError('');try{if(approved!==undefined){if(saved||!comment.trim())return;setSaved(await ui.saveTemplateContentDecision(id,scope.scope_id,domain,{request_id:crypto.randomUUID(),approved,comment:comment.trim()}));}const result=await ui.executeSavedTemplateContentDecision(id,scope.scope_id,domain);setSaved(result);if(!result.receipt)throw Error('Нет подтверждения');onDone();}catch{setLoaded(false);setError('Решение не подтверждено. Проверьте состояние перед повтором.');}finally{setBusy(false);}}
 return <section className="grid gap-2 rounded-xl border border-kumo-fill p-3" aria-label={'Согласование '+domain}>
  <h3 className="m-0 text-[14px] font-medium">{scope.name} · {domain}</h3>
  {requirement.approvers.map(u=>{const d=review.content_decisions?.find(v=>v.scope_id===scope.scope_id&&v.domain_id===domain&&v.reviewer_id===u);return <p key={u} className="m-0">{personName(u)}: {d?(d.approved?'согласовано':'отклонено'):'ожидается решение'}{d?.comment?' · '+d.comment:''}</p>;})}
  {error&&<Notice tone="danger">{error}</Notice>}
  {mayDecide&&!mine&&(!loaded?<div><Pill disabled={busy} onClick={()=>void load()}>Проверить решение по направлению</Pill></div>:saved?<div><p className="m-0">Сохранено решение: {saved.input.approved?'согласовать':'отклонить'}.</p>{!saved.receipt&&<Pill disabled={busy||!ready||saved.input.approved&&!verified} onClick={()=>void decide()}>Повторить решение по направлению</Pill>}</div>:<>
   <Field label="Комментарий"><FieldInput aria-label={'Комментарий по направлению '+domain} value={comment} disabled={busy||!ready} onChange={e=>setComment(e.target.value)}/></Field>
   <div className="flex gap-2"><Pill disabled={busy||!ready||!comment.trim()} onClick={()=>void decide(false)}>Отклонить по направлению</Pill><Pill disabled={busy||!ready||!verified||!comment.trim()} onClick={()=>void decide(true)}>Согласовать по направлению</Pill></div>
  </>)}
 </section>;
}
