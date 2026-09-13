import type {PlatformSignalOwner,PlatformSignalOwnerPage} from './mnemos-api.ts';
/** Validate the entire fixed catalog; missing configuration is not an unassigned owner. */
export function validSignalOwners(value:unknown):value is PlatformSignalOwner[]{
 const keys=['dependencies','external.readiness','external.login','external.read','external.save'];
 return Array.isArray(value)&&value.length===5&&value.every((r,i)=>r&&r.signal_key===keys[i]&&typeof r.owner_id==='string'&&r.owner_id.length<=255&&typeof r.owner_name==='string'&&typeof r.owner_active==='boolean'&&Number.isSafeInteger(r.revision)&&r.revision>=0&&(r.owner_id!==''||!r.owner_active)&&(r.revision!==0||r.owner_id===''));
}
/** Editing is fenced by both catalog authorization generation and per-signal revision. */
export function validSignalOwnerPage(value:unknown):value is PlatformSignalOwnerPage{
 if(!value||typeof value!=='object')return false;const v=value as Partial<PlatformSignalOwnerPage>;
 return Number.isSafeInteger(v.generation)&&Number(v.generation)>=0&&validSignalOwners(v.owners);
}
