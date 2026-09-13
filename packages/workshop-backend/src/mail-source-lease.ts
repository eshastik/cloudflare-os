import {WorkerEntrypoint} from 'cloudflare:workers';
import type {MailReadSource,MailSendSource} from '@gadgets/workshop-shared/gatekeeper';

import type {CalendarSourceAccounts} from "./calendar-source-lease";

/** Repeat host policy checks around each use of a stored mail capability. */
export class MailSourceGuard {
  #source: Fetcher<MailReadSource>;
  #check: () => Promise<void>;
  constructor(source: Fetcher<MailReadSource>, check: () => Promise<void>) { this.#source=source; this.#check=check; }
  async validate() {
    await this.#check();
    await this.#source.validate();
    await this.#check();
  }
  async metadata() {
    await this.validate();
    const result = await this.#source.metadata();
    await this.validate();
    return result;
  }
  async readSelection(input: Parameters<MailReadSource['readSelection']>[0]) {
    await this.validate();
    const result = await this.#source.readSelection(input);
    await this.validate();
    return result;
  }
}

/** Persistent host wrapper that keeps administrative/account checks on the read path. */
export class MailSourceLease extends WorkerEntrypoint<Cloudflare.Env, {
  userId: string;
  accounts: CalendarSourceAccounts;
  source: Fetcher<MailReadSource>;
}> implements MailReadSource {
  #guard() {
    const user = this.ctx.exports.UserDurableObject.get(this.ctx.exports.UserDurableObject.idFromString(this.ctx.props.userId));
    return new MailSourceGuard(this.ctx.props.source, () => user.checkCalendarSourceAccounts(this.ctx.props.accounts));
  }
  async validate() { await this.#guard().validate(); }
  async metadata() { return this.#guard().metadata(); }
  async readSelection(input: Parameters<MailReadSource['readSelection']>[0]) { return this.#guard().readSelection(input); }
}

/** Temporary outgoing authority with the same host account-policy checks as reads. */
export class MailSendLease extends WorkerEntrypoint<Cloudflare.Env,{
 userId:string;accounts:CalendarSourceAccounts;source:Fetcher<MailSendSource>;
}> implements MailSendSource {
 async validate(){
  const user=this.ctx.exports.UserDurableObject.get(this.ctx.exports.UserDurableObject.idFromString(this.ctx.props.userId));
  await user.checkCalendarSourceAccounts(this.ctx.props.accounts);
  await this.ctx.props.source.validate();
  await user.checkCalendarSourceAccounts(this.ctx.props.accounts);
 }
 async send(content:Parameters<MailSendSource['send']>[0]){
  await this.validate();const result=await this.ctx.props.source.send(content);await this.validate();return result;
 }
}

/** Host-owned human screen sender, pinned to the selected Mnemos account. */
export class MailDraftSendUI extends WorkerEntrypoint<Cloudflare.Env,{userId:string;accountId:number}> {
 async send(id:string,sha256:string){
  const user=this.ctx.exports.UserDurableObject.get(this.ctx.exports.UserDurableObject.idFromString(this.ctx.props.userId));
  return user.sendMailDraft(this.ctx.props.accountId,id,sha256);
 }
}
