import type {PlatformSignal} from "./mnemos-api.ts";
/** A complete ordered snapshot distinguishes failures from missing observations. */
export function validPlatformSignals(value:unknown):value is PlatformSignal[]{
 if(!Array.isArray(value)||value.length!==5)return false;
 const keys=["dependencies","external.readiness","external.login","external.read","external.save"];
 return value.every((row,i)=>{
  if(!row||typeof row!=="object"||row.key!==keys[i]||!["ok","firing","unknown"].includes(row.state))return false;
  if(row.observed_at!==null&&(typeof row.observed_at!=="string"||!Number.isFinite(Date.parse(row.observed_at))))return false;
  if(row.state==="ok"||row.state==="firing")return row.observed_at!==null&&row.reason===(row.state==="ok"?"check_passed":"check_failed");
  return i===0?row.reason==="check_unavailable":["source_unavailable","observations_missing","observations_stale"].includes(row.reason);
 });
}
