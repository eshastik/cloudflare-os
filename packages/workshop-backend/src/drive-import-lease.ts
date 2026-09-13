import {WorkerEntrypoint} from 'cloudflare:workers';
import type {DriveImportSource} from '@gadgets/workshop-shared/drive-import';
import type {CalendarSourceAccounts} from './calendar-source-lease';

/** Recheck the same owned-account/category policy used by external calendar sources. */
export class DriveImportGuard {
 constructor(private source:Fetcher<DriveImportSource>,private check:()=>Promise<void>){}
 async validate(){await this.check();await this.source.validate();await this.check()}
 async read(){await this.validate();const result=await this.source.read();await this.validate();return result}
}

/** Retain host authorization around a fixed provider source, without a browser capability. */
export class DriveImportLease extends WorkerEntrypoint<Cloudflare.Env,{
 userId:string;accounts:CalendarSourceAccounts;source:Fetcher<DriveImportSource>;
}> implements DriveImportSource {
 #guard(){
  const user=this.ctx.exports.UserDurableObject.get(this.ctx.exports.UserDurableObject.idFromString(this.ctx.props.userId));
  return new DriveImportGuard(this.ctx.props.source,()=>user.checkCalendarSourceAccounts(this.ctx.props.accounts));
 }
 async validate(){await this.#guard().validate()}
 async read(){return this.#guard().read()}
}
