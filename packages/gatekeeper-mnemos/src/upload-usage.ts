/** Reservations owned by the authenticated user/agent pair. */
export interface RequestRateUsage {limit:number;used:number;resets_at:string;}
export interface UploadUsage {request_rate?:RequestRateUsage;concurrent_limit:number;active:number;cleanup_pending:number;reserved_bytes:number;}
export function validateUploadUsage(raw:unknown):UploadUsage {
 if(!raw||typeof raw!=='object')throw new Error('Invalid upload usage');
 const v=raw as UploadUsage;
 for(const k of ['concurrent_limit','active','cleanup_pending','reserved_bytes'] as const) {
  if(!Number.isSafeInteger(v[k])||v[k]<0)throw new Error('Invalid upload usage');
 }
 if(v.concurrent_limit===0)throw new Error('Invalid upload limit');
 let rate:RequestRateUsage|undefined;
 if(v.request_rate!==undefined){const x=v.request_rate;if(!x||!Number.isSafeInteger(x.limit)||x.limit<=0||!Number.isSafeInteger(x.used)||x.used<0||typeof x.resets_at!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(x.resets_at)||!Number.isFinite(Date.parse(x.resets_at)))throw new Error('Invalid request rate');rate={limit:x.limit,used:x.used,resets_at:x.resets_at};}
 return {...(rate?{request_rate:rate}:{}),concurrent_limit:v.concurrent_limit,active:v.active,cleanup_pending:v.cleanup_pending,reserved_bytes:v.reserved_bytes};
}
