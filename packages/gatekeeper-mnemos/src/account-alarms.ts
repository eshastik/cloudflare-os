import type {AccountStorage} from './account-session.ts';
interface AlarmStorage {setAlarm(time:number):Promise<void>;deleteAlarm():Promise<void>}
type Purpose='login'|'audit'|'workspace';
const PURPOSES:Purpose[]=['login','audit','workspace'];
/** One DO alarm, separate durable deadlines. Audit retries never cancel login; workspace refresh never cancels either. */
export class AccountAlarms {
 constructor(private kv:AccountStorage,private alarms:AlarmStorage){}
 async schedule(purpose:Purpose,at:number){const previous=this.kv.get<number>('accountAlarm:'+purpose);this.kv.put('accountAlarm:'+purpose,purpose==='audit'&&previous!==undefined?Math.min(previous,at):at);await this.#arm();}
 async reschedule(purpose:Purpose,at:number){this.kv.put('accountAlarm:'+purpose,at);await this.#arm();}
 async clear(purpose:Purpose){this.kv.delete('accountAlarm:'+purpose);await this.#arm();}
 due(purpose:Purpose,now=Date.now()){const at=this.kv.get<number>('accountAlarm:'+purpose);return at!==undefined&&at<=now;}
 hasDeadlines(){return PURPOSES.some(p=>this.kv.get('accountAlarm:'+p)!==undefined);}
 async #arm(){
  const times=PURPOSES.map(p=>this.kv.get<number>('accountAlarm:'+p)).filter((n):n is number=>n!==undefined);
  if(times.length)await this.alarms.setAlarm(Math.min(...times));else await this.alarms.deleteAlarm();
 }
}
