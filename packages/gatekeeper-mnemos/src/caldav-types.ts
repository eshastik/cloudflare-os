/** Human input. The password is never returned or persisted by the browser. */
export interface CalDAVSetup {request:string;server:string;username:string;password:string;}
/** Safe account summary, without credentials or provider resource URLs. */
export interface CalDAVAccountInfo {id:string;server:string;username:string;enabled:boolean;calendars:Array<{id:string;title:string}>;}
/** Owner-only management surface within the Mnemos screen. */
export interface CalDAVManagement {
 /** Check invitation support for one calendar owned by the current human, without writing. */
 checkCalDAVScheduling(calendarId:string):Promise<{calendar_id:string;available:boolean}>;
 listCalDAVAccounts():Promise<{servers:Array<{id:string;title:string;url:string}>;accounts:CalDAVAccountInfo[]}>;
 connectCalDAVAccount(input:CalDAVSetup):Promise<CalDAVAccountInfo>;
 removeCalDAVAccount(id:string):Promise<void>;
}
