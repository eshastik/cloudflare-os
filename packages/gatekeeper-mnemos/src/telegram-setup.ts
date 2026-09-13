import type {AccountStorage} from './account-session.ts';
interface Storage {kv:Pick<AccountStorage,'put'>;transactionSync<T>(callback:()=>T):T}
/** Commit pairing creation, replay marker and canonical connection together.
 * create must contain local writes only; provider calls happen after commit. */
export function saveTelegramSetup<T>(storage:Storage,request:string,create:()=>T):T {
 return storage.transactionSync(()=>{const record=create();storage.kv.put('request:'+request,true);storage.kv.put('connection',record);return record;});
}
