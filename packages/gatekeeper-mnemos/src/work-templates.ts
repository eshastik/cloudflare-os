/** A working template references immutable document data, not runtime authority. */
export interface WorkTemplateDraft {
 title:string; kind:"document"|"guidance"|"agent_instructions"|"skill"; purpose:string;
 project_id:string; node_id:string; source_head:string;
}
export interface WorkTemplateVersion extends WorkTemplateDraft {
 template_id:string; revision:number; content_type:string; user_id:string; agent_id:string; created_at:string;
}
export interface WorkTemplateSave extends WorkTemplateDraft {expected_revision:number}
export interface WorkTemplateApplication {references?:import("@gadgets/workshop-shared/work-template").WorkTemplateReference[];request_id:string;revision:number;project_id:string;parent_id:string;name:string;expected_head:string;message:string}
export interface WorkTemplateApplied {node_id:string;head:string;template_id:string;template_revision:number;source_head:string}
export interface WorkTemplatePage {templates:WorkTemplateVersion[];next_cursor:string}
export function validWorkTemplate(v:WorkTemplateVersion):boolean {
 return !!v && typeof v.template_id==="string" && !!v.template_id && Number.isSafeInteger(v.revision) && v.revision>0 && typeof v.title==="string" && !!v.title && typeof v.purpose==="string" && !!v.purpose && ["document","guidance","agent_instructions","skill"].includes(v.kind) && typeof v.project_id==="string" && !!v.project_id && typeof v.node_id==="string" && !!v.node_id && /^[0-9a-f]{64}$/.test(v.source_head) && typeof v.content_type==="string" && !!v.content_type && typeof v.user_id==="string" && !!v.user_id && typeof v.agent_id==="string" && Number.isFinite(Date.parse(v.created_at));
}

export interface TemplateReviewRequirement {domain_id:string;approvers:string[]}
export interface TemplateContentDecisionInput {request_id:string;approved:boolean;comment:string}
export interface TemplateContentDecision extends TemplateContentDecisionInput {proposal_id:string;scope_id:string;domain_id:string;reviewer_id:string;created_at:string}
export interface TemplateScope {review_requirements?:TemplateReviewRequirement[];scope_id:string;revision:number;level:"organization"|"department"|"group";parent_id:string;reader_group_id:string;name:string;enabled:boolean;approvers:string[]}
export interface TemplateScopePage {scopes:TemplateScope[];next_cursor?:string}
export interface ScopedWorkTemplateVersion {scope_id:string;template_key:string;revision:number;proposal_id:string;approved_by:string;approved_at:string;source:WorkTemplateVersion}
export interface ScopedWorkTemplatePage {selected_scope_id:string;templates:ScopedWorkTemplateVersion[];next_cursor?:string}
export interface ScopedWorkTemplateApplied {node_id:string;head:string;scope_id:string;template_key:string;template_revision:number;source_head:string}
export function validScopedWorkTemplate(v:ScopedWorkTemplateVersion):boolean{return !!v&&typeof v.scope_id==="string"&&!!v.scope_id&&typeof v.template_key==="string"&&!!v.template_key&&Number.isSafeInteger(v.revision)&&v.revision>0&&typeof v.proposal_id==="string"&&!!v.proposal_id&&typeof v.approved_by==="string"&&!!v.approved_by&&Number.isFinite(Date.parse(v.approved_at))&&validWorkTemplate(v.source);}

export interface TemplatePromotionInput {project_id:string;request_id:string;revision:number;source_scope_id?:string;target_scope_id:string;target_scope_revision:number;template_key:string;expected_catalogue_revision:number;message:string}
export interface TemplatePromotion {proposal_id:string;request_id:string;user_id:string;agent_id:string;source_owner_id:string;source_scope_id?:string;source_scope_revision?:number;template_id:string;template_revision:number;target_scope_id:string;target_scope_revision:number;template_key:string;expected_catalogue_revision:number;message:string;scope_path:TemplateScope[];created_at:string}

export interface TemplatePromotionDecision {publish_snapshot?:boolean;request_id:string;approved:boolean;scope_revision:number;comment:string;proposal_id:string;reviewer_id:string;catalogue_revision:number;created_at:string}
export interface TemplatePromotionReview {proposal:TemplatePromotion;decision?:TemplatePromotionDecision;content_decisions?:TemplateContentDecision[]}
export interface TemplatePromotionPage {proposals:TemplatePromotionReview[];next_cursor?:string}
export function validTemplatePromotionReview(value:TemplatePromotionReview):boolean {
 const p=value?.proposal;if(!p||typeof p.proposal_id!=="string"||!p.proposal_id||typeof p.request_id!=="string"||!p.request_id||typeof p.user_id!=="string"||!p.user_id||typeof p.template_id!=="string"||!p.template_id||!Number.isSafeInteger(p.template_revision)||p.template_revision<1||typeof p.target_scope_id!=="string"||!p.target_scope_id||!Number.isSafeInteger(p.target_scope_revision)||p.target_scope_revision<1||typeof p.template_key!=="string"||!p.template_key||typeof p.message!=="string"||!Array.isArray(p.scope_path)||p.scope_path.length<1||p.scope_path.length>3||p.scope_path[0].scope_id!==p.target_scope_id||!Number.isFinite(Date.parse(p.created_at)))return false;
 if(!p.scope_path.every(s=>validTemplateReviewRequirements(s.review_requirements)))return false;
 if(value.content_decisions!==undefined){if(!Array.isArray(value.content_decisions))return false;const seen=new Set<string>();for(const d of value.content_decisions){if(!validTemplateContentDecision(p,d))return false;const key=JSON.stringify([d.scope_id,d.domain_id,d.reviewer_id]);if(seen.has(key))return false;seen.add(key);}}
 const d=value.decision;return !d||((d.publish_snapshot===undefined||typeof d.publish_snapshot==="boolean"&&(!d.publish_snapshot||d.approved))&&d.proposal_id===p.proposal_id&&typeof d.request_id==="string"&&!!d.request_id&&typeof d.approved==="boolean"&&typeof d.reviewer_id==="string"&&!!d.reviewer_id&&d.reviewer_id!==p.user_id&&Number.isSafeInteger(d.scope_revision)&&d.scope_revision>0&&Number.isSafeInteger(d.catalogue_revision)&&(d.approved?d.catalogue_revision>0:d.catalogue_revision===0)&&typeof d.comment==="string"&&Number.isFinite(Date.parse(d.created_at)));
}

export type TemplateDecisionInput=Pick<TemplatePromotionDecision,"request_id"|"approved"|"scope_revision"|"comment"|"publish_snapshot">;
export interface TemplateProposalSource {proposal_id:string;source:WorkTemplateVersion}

export function validTemplateReviewRequirements(v:TemplateReviewRequirement[]|undefined):boolean {
 if(v===undefined)return true;if(!Array.isArray(v)||v.length>32)return false;const domains=new Set<string>();let total=0;for(const r of v){if(!r||typeof r.domain_id!=="string"||!r.domain_id||r.domain_id.length>255||domains.has(r.domain_id)||!Array.isArray(r.approvers)||!r.approvers.length||r.approvers.some(x=>typeof x!=="string"||!x||x.length>255)||new Set(r.approvers).size!==r.approvers.length)return false;domains.add(r.domain_id);total+=r.approvers.length;}return total<=100;
}
export function validTemplateContentDecision(p:TemplatePromotion,d:TemplateContentDecision):boolean {
 return !!d&&d.proposal_id===p.proposal_id&&typeof d.request_id==="string"&&!!d.request_id&&typeof d.approved==="boolean"&&typeof d.comment==="string"&&Number.isFinite(Date.parse(d.created_at))&&d.reviewer_id!==p.user_id&&d.reviewer_id!==p.source_owner_id&&!!p.scope_path.find(s=>s.scope_id===d.scope_id)?.review_requirements?.find(r=>r.domain_id===d.domain_id)?.approvers.includes(d.reviewer_id);
}
export type TemplateScopeConfig=Omit<TemplateScope,"scope_id"|"revision">;
export function validTemplateScopeConfig(v:TemplateScopeConfig):boolean {
 const id=(x:string)=>typeof x==="string"&&!!x&&x.length<=255;
 return !!v&&validTemplateReviewRequirements(v.review_requirements)&&["organization","department","group"].includes(v.level)&&typeof v.name==="string"&&!!v.name.trim()&&new TextEncoder().encode(v.name).length<=255&&typeof v.enabled==="boolean"&&(v.level==="organization"?v.parent_id===""&&v.reader_group_id==="":id(v.parent_id)&&id(v.reader_group_id))&&Array.isArray(v.approvers)&&v.approvers.length>0&&v.approvers.length<=100&&v.approvers.every(id)&&new Set(v.approvers).size===v.approvers.length;
}

export interface PersonalWorkTemplateSelection {template_id:string;revision:number}
export interface WorkTemplateResolution {selected_scope_id:string;template_key:string;personal?:WorkTemplateVersion;scoped?:ScopedWorkTemplateVersion}

/** Разрешение владельца агенту читать опубликованные шаблоны области. */
export interface TemplateAgentGrant {binding_id:string;scope_id:string;revision:number;enabled:boolean}

/** Страница сохранённых разрешений; список не зависит от нынешнего членства. */
export interface TemplateAgentGrantPage {grants:TemplateAgentGrant[];next_cursor?:string}
