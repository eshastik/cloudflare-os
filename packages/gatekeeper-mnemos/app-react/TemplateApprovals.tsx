import {useEffect,useState} from "react";
import {Button} from "@cloudflare/kumo";
import {useHost,useUi} from "./host.ts";
import {Block,Notice,Row,RowText,TextInput} from "./ui.tsx";
import {readTemplateProposalText} from "../app/template-source.ts";
import type {TemplatePromotionReview,TemplateScope} from "../src/work-templates.ts";
import type {SavedTemplateDecision} from "../src/template-review-actions.ts";

type Page={scope:TemplateScope;items:TemplatePromotionReview[];cursor:string};
export default function TemplateApprovals({userId}:{userId:string}){
 const ui=useUi();const [pages,setPages]=useState<Page[]>([]),[error,setError]=useState(""),[revision,setRevision]=useState(0);
 useEffect(()=>{let cancelled=false;void(async()=>{
  try{
   const scopes:TemplateScope[]=[];let cursor="";
   do{const page=await ui.listTemplateReviewScopes(cursor);if(cancelled)return;scopes.push(...page.scopes);cursor=page.next_cursor||"";}while(cursor);
   const result=await Promise.all(scopes.map(async scope=>{const page=await ui.listTemplateProposals(scope.scope_id,"");return {scope,items:page.proposals,cursor:page.next_cursor||""};}));
   if(!cancelled){setPages(result);setError("");}
  }catch{if(!cancelled)setError("Не удалось прочитать согласования шаблонов.");}
 })();return()=>{cancelled=true;};},[ui,revision]);
 async function more(scope:string){try{const current=pages.find(p=>p.scope.scope_id===scope);if(!current?.cursor)return;const next=await ui.listTemplateProposals(scope,current.cursor);setPages(all=>all.map(p=>p.scope.scope_id===scope?{...p,items:[...new Map([...p.items,...next.proposals].map(item=>[item.proposal.proposal_id,item])).values()],cursor:next.next_cursor||""}:p));}catch{setError("Не удалось загрузить следующие предложения.");}}
 const pending=(page:Page)=>page.items.filter(item=>!item.decision&&item.proposal.user_id!==userId);
 const count=pages.reduce((n,p)=>n+pending(p).length,0);
 if(!count&&!error&&!pages.some(p=>p.cursor))return null;
 return <div className="mt-6"><Block title="Шаблоны на согласовании" count={count} actions={<Button size="sm" variant="ghost" onClick={()=>setRevision(v=>v+1)}>Обновить шаблоны</Button>}>
  {error&&<Notice tone="danger">{error}</Notice>}
  {pages.map(page=><div key={page.scope.scope_id}>{pending(page).map(item=><TemplateProposal key={item.proposal.proposal_id} item={item} scope={page.scope} onDone={()=>setRevision(v=>v+1)}/>)}
   {page.cursor&&<Button size="sm" variant="ghost" onClick={()=>void more(page.scope.scope_id)}>Ещё предложения · {page.scope.name}</Button>}
  </div>)}
 </Block></div>;
}
function TemplateProposal({item,scope,onDone}:{item:TemplatePromotionReview;scope:TemplateScope;onDone():void}){
 const ui=useUi(),host=useHost();const [open,setOpen]=useState(false),[text,setText]=useState<string|null>(null),[error,setError]=useState(""),[comment,setComment]=useState(""),[busy,setBusy]=useState(false),[saved,setSaved]=useState<SavedTemplateDecision|null>(null),[ready,setReady]=useState(false);
 const proposal=item.proposal,id=proposal.proposal_id;
 async function inspect(){setOpen(true);setBusy(true);setError("");setReady(false);setText(null);
  try{const current=await ui.readTemplateProposal(id);const decision=await ui.readSavedTemplateDecision(id);setSaved(decision);if(current.decision){onDone();return;}setReady(true);const preview=await readTemplateProposalText(ui,id,(...args)=>host.downloadText(...args));setText(preview);}
  catch{setError("Не удалось открыть предложенную версию. Проверьте доступ и повторите.");}finally{setBusy(false);}
 }
 async function decide(approved?:boolean){if(busy||!ready)return;setBusy(true);setError("");
  try{
   if(approved!==undefined){if(saved||!comment.trim()||(approved&&text===null))return;const decision=await ui.saveTemplateDecision(id,{request_id:crypto.randomUUID(),approved,scope_revision:scope.revision,comment:comment.trim()});setSaved(decision);}
   const result=await ui.executeSavedTemplateDecision(id);setSaved(result);if(!result.receipt)throw Error("Нет подтверждения");onDone();
  }catch{setReady(false);setError("Решение не подтверждено. Сначала проверьте его состояние.");}finally{setBusy(false);}
 }
 return <div className="border-b border-kumo-line py-2">
  <Row><RowText title={proposal.message} note={`${scope.name} · версия ${proposal.template_revision} · от ${proposal.user_id}`}/><Button size="sm" variant="secondary" disabled={busy} onClick={()=>open?setOpen(false):void inspect()}>{open?"Свернуть":"Проверить шаблон"}</Button></Row>
  {open&&<div className="space-y-3 px-3 pb-3 text-sm">
   <p className="text-kumo-subtle">{proposal.expected_catalogue_revision?"Предлагается обновить общий шаблон. До одобрения действует прежняя версия.":"Предлагается сделать шаблон доступным этому подразделению."}</p>
   {error&&<Notice tone="danger">{error}</Notice>}
   {busy&&<p role="status">Проверяем…</p>}
   {text!==null&&<pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg border border-kumo-line p-3 font-sans">{text}</pre>}
   {!busy&&(!ready||text===null)&&<Button size="sm" variant="secondary" onClick={()=>void inspect()}>Повторить проверку</Button>}
   {saved?<div><p>{saved.receipt?"Решение записано.":`Сохранено решение: ${saved.input.approved?"одобрить":"отклонить"}.`}</p>{!saved.receipt&&ready&&<Button size="sm" disabled={busy} onClick={()=>void decide()}>Повторить сохранённое решение</Button>}</div>:<>
    <label className="flex max-w-xl flex-col gap-1">Комментарий<TextInput className="w-full" aria-label="Комментарий к шаблону" value={comment} disabled={busy||!ready} onChange={e=>setComment(e.target.value)}/></label>
    <div className="flex gap-2"><Button size="sm" variant="secondary" disabled={busy||!ready||!comment.trim()} onClick={()=>void decide(false)}>Отклонить шаблон</Button><Button size="sm" disabled={busy||!ready||text===null||!comment.trim()} onClick={()=>void decide(true)}>Одобрить шаблон</Button></div>
   </>}
  </div>}
 </div>;
}
