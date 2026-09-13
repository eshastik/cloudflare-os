/** Operator-visible warning and immutable first review returned by Mnemos. */
export interface PolicyAlert {id:string;kind:string;resource:string;source_path:string;policy_class:string;reason:string;raised_at:string;reviewed_at?:string;reviewed_by?:string;review_note?:string}
export interface PolicyAlertPage {alerts:PolicyAlert[];next:string;truncated:boolean}
export function validPolicyAlertPage(value:unknown):value is PolicyAlertPage {
 if(!value||typeof value!=='object')return false;const p=value as PolicyAlertPage;
 if(!Array.isArray(p.alerts)||p.alerts.length>100||typeof p.truncated!=='boolean'||typeof p.next!=='string'||(p.next!==''&&!/^[a-f0-9]{32}$/.test(p.next)))return false;
 const ids=new Set<string>();
 for(const a of p.alerts){
  if(!a||typeof a.id!=='string'||!/^[a-f0-9]{32}$/.test(a.id)||ids.has(a.id))return false;ids.add(a.id);
  if(!['kind','resource','source_path','policy_class','reason','raised_at'].every(k=>typeof a[k as keyof PolicyAlert]==='string')||!Number.isFinite(Date.parse(a.raised_at)))return false;
  if(a.reviewed_at!==undefined&&(typeof a.reviewed_at!=='string'||!Number.isFinite(Date.parse(a.reviewed_at))||typeof a.reviewed_by!=='string'||(a.review_note!==undefined&&typeof a.review_note!=='string')))return false;
 }
 return !p.truncated||(p.alerts.length>0&&p.next===p.alerts.at(-1)!.id);
}
