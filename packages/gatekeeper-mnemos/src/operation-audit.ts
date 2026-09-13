export interface OperationAuditEvent {id:string;tenant_id:string;actor:string;on_behalf_of:string;action:string;resource:string;subject:string;allowed:boolean;reason:string;at:string;prev_hash:string;hash:string}
export interface OperationAuditPage {events:OperationAuditEvent[];checkpoint:{sequence:number;hash:string};next:number;truncated:boolean}
