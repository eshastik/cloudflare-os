import type {PlatformSignalInbox} from './mnemos-api.ts';
import {KNOWN_SIGNALS,knownSignal} from './platform-signals.ts';

const KNOWN_KEYS=new Set(KNOWN_SIGNALS.map(s=>s.split(' ')[0]));
const KNOWN_REASONS=new Set(KNOWN_SIGNALS.map(s=>s.split(' ')[2]));
const id=(v:unknown):v is string=>typeof v==='string'&&/^[1-9][0-9]{0,18}$/.test(v)&&BigInt(v)<=9223372036854775807n;
const date=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v));
export function validSignalInbox(value:unknown):value is PlatformSignalInbox {
 if(!value||typeof value!=='object')return false;
 const page=value as PlatformSignalInbox;
 if(!Array.isArray(page.items)||page.items.length>50||!Number.isSafeInteger(page.unread)||page.unread<0||typeof page.next_before!=='string')return false;
 let previous=9223372036854775808n;
 for(const item of page.items){
  if(!item||!id(item.id)||BigInt(item.id)>=previous||typeof item.key!=='string'||!item.key||item.key.length>64||!date(item.created_at)||(item.read_at!==null&&!date(item.read_at))||(item.observed_at!==null&&!date(item.observed_at)))return false;
  if(!['ok','firing','unknown'].includes(item.state)||typeof item.reason!=='string'||!item.reason||item.reason.length>64)return false;
  // Известное сочетание сверяется со словарём; новый ключ или новая причина сервера — терпится.
  if(KNOWN_KEYS.has(item.key)&&KNOWN_REASONS.has(item.reason)&&!knownSignal(item))return false;
  previous=BigInt(item.id);
 }
 return page.next_before===''||(page.items.length===50&&id(page.next_before)&&page.next_before===page.items[49].id);
}
