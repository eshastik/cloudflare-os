/** Trusted events stored with the canonical draft, ready for idempotent delivery
 * to Mnemos. They contain no message text, recipients, account epoch or secrets. */
export interface DraftAuditEvent {
 event_id:string;
 kind:'mail'|'calendar';
 draft_id:string;
 connection_id:string;
 tenant_id:string;
 owner_id:string;
 actor:string;
 on_behalf_of:string;
 sha256:string;
 phase:'staged'|'approved'|'rejected'|'attempted'|'accepted'|'created';
 observed_at:string;
}
interface DraftAuditSource {
 id:string;sha256:string;
 context:{tenant:string;owner:string;agent:string;connection:string};
 audit_events?:DraftAuditEvent[];
}
/** A retry preserves the first event bytes; a legacy draft gains only the newly
 * observed transition, never invented historical events. Persist the returned
 * value in the same KV record as the state, before performing external IO. */
export function withDraftAudit<T extends DraftAuditSource>(draft:T,kind:DraftAuditEvent['kind'],phase:DraftAuditEvent['phase'],previous:DraftAuditSource|undefined):T {
 const events=previous?.audit_events??[];
 if(events.some(event=>event.phase===phase))return {...draft,audit_events:events};
 const event:DraftAuditEvent={event_id:`${kind}:${draft.id}:${phase}`,kind,draft_id:draft.id,connection_id:draft.context.connection,
  tenant_id:draft.context.tenant,owner_id:draft.context.owner,
  actor:phase==='staged'?draft.context.agent:draft.context.owner,on_behalf_of:phase==='staged'?draft.context.owner:'',
  sha256:draft.sha256,phase,observed_at:new Date().toISOString()};
 return {...draft,audit_events:[...events,event]};
}
