import type {PlatformSignalOwner,PlatformSignalOwnerPage} from './mnemos-api.ts';
import {CORE_SIGNAL_KEYS} from './platform-signals.ts';
/** Validate the catalog: the fixed checks first, in order; missing configuration is not an unassigned owner.
 * Проверки, добавленные сервером позже (shared_projection и следующие), принимаются, если ключ не повторяется. */
export function validSignalOwners(value:unknown):value is PlatformSignalOwner[]{
 const seen=new Set<string>();
 return Array.isArray(value)&&value.length>=CORE_SIGNAL_KEYS.length&&value.length<=64&&value.every((r,i)=>{
  if(!r||typeof r.signal_key!=='string'||!r.signal_key||r.signal_key.length>64||seen.has(r.signal_key))return false;
  seen.add(r.signal_key);
  if(i<CORE_SIGNAL_KEYS.length&&r.signal_key!==CORE_SIGNAL_KEYS[i])return false;
  return typeof r.owner_id==='string'&&r.owner_id.length<=255&&typeof r.owner_name==='string'&&typeof r.owner_active==='boolean'&&Number.isSafeInteger(r.revision)&&r.revision>=0&&(r.owner_id!==''||!r.owner_active)&&(r.revision!==0||r.owner_id==='');
 });
}
/** Editing is fenced by both catalog authorization generation and per-signal revision. */
export function validSignalOwnerPage(value:unknown):value is PlatformSignalOwnerPage{
 if(!value||typeof value!=='object')return false;const v=value as Partial<PlatformSignalOwnerPage>;
 return Number.isSafeInteger(v.generation)&&Number(v.generation)>=0&&validSignalOwners(v.owners);
}
