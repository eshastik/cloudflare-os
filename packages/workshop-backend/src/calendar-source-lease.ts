import {WorkerEntrypoint} from 'cloudflare:workers';
import type {CalendarReadSource,CalendarWriteSource} from '@gadgets/workshop-shared/gatekeeper';

/** Account coordinates retained by the trusted host, never accepted from an agent. */
export interface CalendarSourceAccounts {
  sourceAccountId: number;
  targetAccountId: number;
  sourceVendor: string;
  targetVendor: string;
  resourcePattern: string;
}

/** Repeat host policy checks around each use of a stored calendar capability. */
export class CalendarSourceGuard {
  constructor(private source: Fetcher<CalendarReadSource>, private check: () => Promise<void>) {}
  async validate() {
    await this.check();
    await this.source.validate();
    await this.check();
  }
  async metadata() {
    await this.validate();
    const result = await this.source.metadata();
    await this.validate();
    return result;
  }
  async readWindow(input: Parameters<CalendarReadSource['readWindow']>[0]) {
    await this.validate();
    const result = await this.source.readWindow(input);
    await this.validate();
    return result;
  }
}

/** Persistent host wrapper that keeps administrative/account checks on the read path. */
export class CalendarSourceLease extends WorkerEntrypoint<Cloudflare.Env, {
  userId: string;
  accounts: CalendarSourceAccounts;
  source: Fetcher<CalendarReadSource>;
}> implements CalendarReadSource {
  #guard() {
    const user = this.ctx.exports.UserDurableObject.get(this.ctx.exports.UserDurableObject.idFromString(this.ctx.props.userId));
    return new CalendarSourceGuard(this.ctx.props.source, () => user.checkCalendarSourceAccounts(this.ctx.props.accounts));
  }
  async validate() { await this.#guard().validate(); }
  async metadata() { return this.#guard().metadata(); }
  async readWindow(input: Parameters<CalendarReadSource['readWindow']>[0]) { return this.#guard().readWindow(input); }
}

/** Temporary write authority bound to the same host accounts as the saved selection. */
export class CalendarWriteLease extends WorkerEntrypoint<Cloudflare.Env,{
 userId:string;accounts:CalendarSourceAccounts;source:Fetcher<CalendarWriteSource>;
}> implements CalendarWriteSource {
 async validate(){
  const user=this.ctx.exports.UserDurableObject.get(this.ctx.exports.UserDurableObject.idFromString(this.ctx.props.userId));
  await user.checkCalendarSourceAccounts(this.ctx.props.accounts);
  await this.ctx.props.source.validate();
  await user.checkCalendarSourceAccounts(this.ctx.props.accounts);
 }
 async create(content:Parameters<CalendarWriteSource['create']>[0]){
  await this.validate();const result=await this.ctx.props.source.create(content);await this.validate();return result;
 }
}

/** Human management action pinned by the host to the selected Mnemos account. */
export class CalendarDraftCreateUI extends WorkerEntrypoint<Cloudflare.Env,{userId:string;accountId:number}> {
 async create(id:string,sha256:string){
  const user=this.ctx.exports.UserDurableObject.get(this.ctx.exports.UserDurableObject.idFromString(this.ctx.props.userId));
  return user.createCalendarDraft(this.ctx.props.accountId,id,sha256);
 }
}
