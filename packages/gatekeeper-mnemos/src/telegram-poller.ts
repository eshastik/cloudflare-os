import {DurableObject} from 'cloudflare:workers';

interface PollStatus { state:'starting'|'ok'|'error'|'disabled'; checkedAt:number; lastSuccessAt:number|null; consecutiveErrors:number }

/** Poll scheduling is separate from the bot's task alarm, so a running model
 * call cannot prevent receipt of a correction. Credentials remain in TelegramBot. */
export class TelegramPoller extends DurableObject {
  /** Called by the owning TelegramBot after confirmed transport setup. */
  async start(bot:string,epoch:string):Promise<void>{
    if(!/^[1-9][0-9]{0,19}$/.test(bot)||!/^[-a-f0-9]{36}$/.test(epoch))throw Error('Invalid Telegram poll registration.');
    this.ctx.storage.kv.put('registration',{bot,epoch});
    this.ctx.storage.kv.put('status',{state:'starting',checkedAt:Date.now(),lastSuccessAt:null,consecutiveErrors:0} satisfies PollStatus);
    await this.ctx.storage.setAlarm(Date.now()+1);
  }
  /** Internal, content-free transport diagnostic. A timer firing alone is not success. */
  async getStatus():Promise<PollStatus|null>{return this.ctx.storage.kv.get<PollStatus>('status')??null;}
  /** Save the retry alarm before crossing an RPC boundary. Cursor/ACK decisions
   * are owned by TelegramBot and are not inferred from an RPC timeout here. */
  async alarm():Promise<void>{
    const registration=this.ctx.storage.kv.get<{bot:string;epoch:string}>('registration');
    if(!registration)return;
    await this.ctx.storage.setAlarm(Date.now()+5000);
    try{
      const bot=this.ctx.exports.TelegramBot.get(this.ctx.exports.TelegramBot.idFromName(registration.bot));
      const result=await bot.pollInput(registration.epoch);
      const current=this.ctx.storage.kv.get<{bot:string;epoch:string}>('registration');
      if(current?.bot!==registration.bot||current.epoch!==registration.epoch)return;
      const now=Date.now();
      const prior=this.ctx.storage.kv.get<PollStatus>('status');
      this.ctx.storage.kv.put('status',{state:result.enabled?'ok':'disabled',checkedAt:now,lastSuccessAt:result.enabled?now:prior?.lastSuccessAt??null,consecutiveErrors:0} satisfies PollStatus);
      if(!result.enabled){
        this.ctx.storage.kv.delete('registration');
        await this.ctx.storage.deleteAlarm();
      }else if(result.more){await this.ctx.storage.setAlarm(Date.now()+1);}
    }catch{
      // Ignore an old attempt if start() replaced its registration while awaiting RPC.
      const current=this.ctx.storage.kv.get<{bot:string;epoch:string}>('registration');
      if(current?.bot!==registration.bot||current.epoch!==registration.epoch)return;
      const prior=this.ctx.storage.kv.get<PollStatus>('status');
      this.ctx.storage.kv.put('status',{state:'error',checkedAt:Date.now(),lastSuccessAt:prior?.lastSuccessAt??null,consecutiveErrors:Math.min((prior?.consecutiveErrors??0)+1,Number.MAX_SAFE_INTEGER)} satisfies PollStatus);
      // The saved alarm retries. Never persist remote errors containing credentials.
    }
  }
}
