import { UI_READINESS_SURFACES, type UIReadinessUsage } from "./mnemos-api.ts";
const record=(v:unknown):v is Record<string,unknown>=>typeof v==="object" && v!==null && !Array.isArray(v);
/** Keep pending/unconfirmed attempts separate from measured terminal outcomes. */
export function validUIReadinessUsage(value:unknown):value is UIReadinessUsage[]{
 if(!Array.isArray(value))return false;
 const outcomes=new Set<string>();
 for(const row of value){
  if(!record(row) || !UI_READINESS_SURFACES.some(surface=>surface===row.surface) || typeof row.outcome!=="string" || !["pending","ready","error","timeout","abandoned","unconfirmed"].includes(row.outcome) || outcomes.has(`${row.surface}:${row.outcome}`) || !Number.isSafeInteger(row.samples) || Number(row.samples)<1 || typeof row.last_observed_at!=="string" || !Number.isFinite(Date.parse(row.last_observed_at)))return false;
  outcomes.add(`${row.surface}:${row.outcome}`);
  const values=[row.p50_ms,row.p95_ms,row.p99_ms];
  if(["pending","unconfirmed"].includes(row.outcome)){if(!values.every(v=>v===null))return false;}
  else if(!values.every(v=>typeof v==="number" && Number.isFinite(v) && v>=0 && v<=600000) || Number(row.p50_ms)>Number(row.p95_ms) || Number(row.p95_ms)>Number(row.p99_ms))return false;
 }
 return true;
}

/** Version cardinality is explicit; a shortened response must not pretend to be complete. */
export function validUIReadinessVersions(value: unknown): boolean {
 if(!record(value)||!Array.isArray(value.groups)||!Number.isSafeInteger(value.total_groups)||Number(value.total_groups)<0||value.groups.length!==Math.min(Number(value.total_groups),100)||value.truncated!==(Number(value.total_groups)>100))return false;
 const keys=new Set<string>();
 for(const row of value.groups){
  if(!record(row)||typeof row.client_version!=="string"||(row.client_version!==""&&!/^(sha256:[a-f0-9]{64}|asset:[A-Za-z0-9._-]{1,96})$/.test(row.client_version))||!validUIReadinessUsage([row]))return false;
  const context=row.deployment;
  if(context!=null&&!record(context))return false;
  const contextKey=context==null?null:[context.environment,context.release,context.source_revision,context.source_modified,context.go_version,context.schema_version];
  const key=JSON.stringify([row.client_version,row.surface,row.outcome,contextKey]);if(keys.has(key))return false;keys.add(key);
 }
 return true;
}
