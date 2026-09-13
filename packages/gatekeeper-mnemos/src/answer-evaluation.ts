import type {MnemosAccountSession} from './account-session.ts';
type API=Pick<MnemosAccountSession,'readTeamBudgetMember'|'readTeamMemberInputs'|'readPrivateVersionDigest'>;
type Source={id:string;project_id:string;node_id:string;head:string;sha256:string};
type Context={id:string;source_id:string;kind:'selected_memory'|'tool_output';status:'present'|'missing'|'outdated'|'unknown';call?:{id:string;sha256:string}};
export type AnswerEvaluationSet={format:'mnemos.answer-evaluation';version:1;revision:string;
 target:{project_id:string;proposal_id:string;binding_id:string;request_id:string;result_sha256:string;input_manifest_sha256:string};
 sources:Source[];context:Context[];
 claims:{id:string;quote:string;verdict:'supported'|'contradicted'|'unsupported'|'unknown';source_ids:string[]}[];
 access:{id:string;expected:'allow'|'deny';observed:'allow'|'deny'|'unknown'}[]};
const text=(v:unknown,max=255):v is string=>typeof v==='string'&&v.trim().length>0&&new TextEncoder().encode(v).length<=max;
const hash=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const digest=async(raw:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw))),b=>b.toString(16).padStart(2,'0')).join('');

/** Explicit assessor labels, stored in an ordinary private versioned document. */
export function decodeAnswerEvaluation(raw:string):AnswerEvaluationSet{
 if(new TextEncoder().encode(raw).length>128*1024)throw Error('Evaluation too large');
 const v=JSON.parse(raw);
 if(!v||v.format!=='mnemos.answer-evaluation'||v.version!==1||!text(v.revision,128)||!v.target)throw Error('Invalid evaluation');
 for(const k of ['project_id','proposal_id','binding_id','request_id'])if(!text(v.target[k]))throw Error('Invalid target');
 if(!hash(v.target.result_sha256)||!hash(v.target.input_manifest_sha256))throw Error('Unpinned target');
 for(const k of ['sources','context','claims','access']){
  if(!Array.isArray(v[k])||v[k].length>32||new Set(v[k].map((r:{id:unknown})=>r?.id)).size!==v[k].length||v[k].some((r:{id:unknown})=>!r||!text(r.id)))throw Error('Invalid rows');
 }
 const sources=new Set(v.sources.map((s:Source)=>s.id));
 for(const s of v.sources)if(!text(s.project_id)||!text(s.node_id)||!hash(s.head)||!hash(s.sha256))throw Error('Unpinned source');
 for(const c of v.context){
  if(!sources.has(c.source_id)||!['selected_memory','tool_output'].includes(c.kind)||!['present','missing','outdated','unknown'].includes(c.status))throw Error('Invalid context');
  if(c.call&&(!text(c.call.id)||!hash(c.call.sha256)))throw Error('Unpinned observation');
  if(c.kind==='tool_output'&&['present','outdated'].includes(c.status)&&!c.call)throw Error('Observation required');
 }
 const quotes=new Set<string>();
 for(const c of v.claims){
  if(!text(c.quote,2000)||quotes.has(c.quote)||!['supported','contradicted','unsupported','unknown'].includes(c.verdict)||!Array.isArray(c.source_ids)||c.source_ids.length>32||new Set(c.source_ids).size!==c.source_ids.length||c.source_ids.some((id:string)=>!sources.has(id)))throw Error('Invalid claim');
  quotes.add(c.quote);if(['supported','contradicted'].includes(c.verdict)&&!c.source_ids.length)throw Error('Evidence required');
 }
 for(const a of v.access)if(!['allow','deny'].includes(a.expected)||!['allow','deny','unknown'].includes(a.observed))throw Error('Invalid access label');
 return v;
}

/** Verify identity, retained inputs and current source access before scoring assessor labels. */
export async function evaluateAnswer(api:API,set:AnswerEvaluationSet){
 const t=set.target;
 const outcome=await api.readTeamBudgetMember(t.project_id,t.proposal_id,t.binding_id);
 if(outcome.state!=='completed'||!outcome.result||outcome.request_id!==t.request_id||await digest(outcome.result.content)!==t.result_sha256)throw Error('Result changed');
 const inputs=await api.readTeamMemberInputs(t.project_id,t.proposal_id,t.binding_id);
 if(inputs.request_id!==t.request_id||!inputs.checkpoint_found||inputs.input_manifest_sha256!==t.input_manifest_sha256||!inputs.input_manifest)throw Error('Inputs changed');
 for(const s of set.sources){
  const actual=await api.readPrivateVersionDigest(s.project_id,s.node_id,s.head);
  if(actual.project_id!==s.project_id||actual.node_id!==s.node_id||actual.head!==s.head||actual.sha256!==s.sha256)throw Error('Source unavailable or changed');
 }
 const context=set.context.map((c):Context&{basis:'assessor'|'recorded_memory'}=>{
  if(c.call&&!inputs.model_inputs?.some(i=>i.call_id===c.call!.id&&i.input_sha256===c.call!.sha256))throw Error('Observation changed');
  if(c.kind==='tool_output')return {...c,basis:'assessor' as const};
  const expected=set.sources.find(s=>s.id===c.source_id)!,m=inputs.input_manifest!.memory;
  const status=!m.enabled?'missing':!hash(m.document_sha256)?'unknown':m.project_id!==expected.project_id||m.node_id!==expected.node_id?'missing':m.document_sha256!==expected.sha256?'outdated':'present';
  return {...c,status,basis:'recorded_memory' as const};
 });
 for(const c of set.claims)if(!outcome.result.content.includes(c.quote))throw Error('Claim absent from exact answer');
 const knownClaims=set.claims.filter(c=>c.verdict!=='unknown'),supported=knownClaims.filter(c=>c.verdict==='supported').length;
 const knownAccess=set.access.filter(a=>a.observed!=='unknown');
 const unknownContext=context.filter(c=>c.status==='unknown').length;
 return {target:t,context,claims:set.claims,access:set.access,
  context_present:context.filter(c=>c.status==='present').length,context_total:context.length,context_unknown:unknownContext,
  context_complete:context.some(c=>c.status==='missing'||c.status==='outdated')?false:!context.length||unknownContext?null:true,
  supported_claims:supported,assessed_claims:knownClaims.length,unknown_claims:set.claims.length-knownClaims.length,
  support_rate:knownClaims.length?supported/knownClaims.length:null,
  assessed_access:knownAccess.length,unknown_access:set.access.length-knownAccess.length,
  unexpected_allow:knownAccess.filter(a=>a.expected==='deny'&&a.observed==='allow').length,
  unexpected_deny:knownAccess.filter(a=>a.expected==='allow'&&a.observed==='deny').length};
}
