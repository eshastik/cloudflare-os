import type {SmtpCredential} from './smtp-client.ts';
/** Owner input; credentials never become agent arguments or a public receipt. */
export interface ImapSetup {request:string;server:string;username:string;password:string;mailbox:string;smtp?:SmtpCredential;}
/** One selected folder behind a private account credential. */
export interface ImapAccountInfo {id:string;server:string;username:string;mailbox:string;enabled:boolean;send_from?:string;}
/** Human-only management inside the Mnemos app. */
export interface ImapManagement {
  listImapAccounts():Promise<{servers:Array<{id:string;title:string;host:string;port:number}>;accounts:ImapAccountInfo[]}>;
  connectImapAccount(input:ImapSetup):Promise<ImapAccountInfo>;
  removeImapAccount(id:string):Promise<void>;
}
