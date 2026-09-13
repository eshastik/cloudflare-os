import type {PlatformSignalInbox} from './mnemos-api.ts';

const id=(v:unknown):v is string=>typeof v==='string'&&/^[1-9][0-9]{0,18}$/.test(v)&&BigInt(v)<=9223372036854775807n;
const date=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v));
export function validSignalInbox(value:unknown):value is PlatformSignalInbox {
 if(!value||typeof value!=='object')return false;
 const page=value as PlatformSignalInbox;
 if(!Array.isArray(page.items)||page.items.length>50||!Number.isSafeInteger(page.unread)||page.unread<0||typeof page.next_before!=='string')return false;
 let previous=9223372036854775808n;
 for(const item of page.items){
  if(!item||!id(item.id)||BigInt(item.id)>=previous||!['dependencies','external.readiness','external.login','external.read','external.save'].includes(item.key)||!date(item.created_at)||(item.read_at!==null&&!date(item.read_at))||(item.observed_at!==null&&!date(item.observed_at)))return false;
  const reasons=item.state==='ok'?['check_passed']:item.state==='firing'?['check_failed']:item.state==='unknown'?['check_unavailable','source_unavailable','observations_missing','observations_stale']:[];
  if(!reasons.includes(item.reason))return false;
  previous=BigInt(item.id);
 }
 return page.next_before===''||(page.items.length===50&&id(page.next_before)&&page.next_before===page.items[49].id);
}
