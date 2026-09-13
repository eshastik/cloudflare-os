import type {AccountStorage} from './account-session.ts';
import type {ConnectionAuditEvent} from './connection-audit-storage.ts';
export interface TelegramAuditOwner {tenant:string;user:string}
interface Connection {
 account:string;request:string;binding:string;accountEpoch:string;token:string;ready:boolean;
 deliveryMode?:string;pairing:{epoch:string;candidate?:number};
 channel?:{id:string;registered:boolean;disabled:boolean};
}
interface Evidence {audit_account_id?:string;telegram_audit_owner?:TelegramAuditOwner;connection_audit?:ConnectionAuditEvent[]}
function phase(record:Connection):ConnectionAuditEvent['phase'] {
 if(record.channel?.disabled)return 'revoked';
 if(!record.token)return 'removed';
 if(record.channel?.registered)return 'enabled';
 if(record.channel)return 'channel-pending';
 if(record.pairing.candidate!==undefined)return 'pairing-candidate';
 return record.ready?'ready':'connecting';
}
function changed(a:Connection,b:Connection){
 return a.account!==b.account||a.request!==b.request||a.binding!==b.binding||a.accountEpoch!==b.accountEpoch||a.token!==b.token||a.ready!==b.ready||a.deliveryMode!==b.deliveryMode||a.pairing.epoch!==b.pairing.epoch||a.pairing.candidate!==b.pairing.candidate||a.channel?.id!==b.channel?.id||a.channel?.registered!==b.channel?.registered||a.channel?.disabled!==b.channel?.disabled;
}
/** The caller supplies a trusted account owner. State and its bounded pending
 * transition history share one canonical write; exported events contain no secrets. */
export function saveTelegramConnection<T extends Connection>(storage:AccountStorage,record:T,owner:TelegramAuditOwner):void {
 if(!owner.tenant||!owner.user)throw Error('Telegram audit owner unavailable');
 const previous=storage.get<Connection&Evidence>('connection');
 if(previous?.account&&previous.account!==record.account||previous?.telegram_audit_owner&&(previous.telegram_audit_owner.tenant!==owner.tenant||previous.telegram_audit_owner.user!==owner.user))throw Error('Telegram audit owner changed');
 const events=previous?.connection_audit??[];
 const id=previous?.audit_account_id??crypto.randomUUID();
 const nextPhase=phase(record),transition=!previous||changed(previous,record);
 if(transition&&events.length>=(nextPhase==='removed'||nextPhase==='revoked'?128:124))throw Error('Telegram audit backlog full');
 const event:ConnectionAuditEvent={event_id:crypto.randomUUID(),protocol:'telegram',account_id:id,tenant_id:owner.tenant,owner_id:owner.user,phase:nextPhase,observed_at:new Date().toISOString()};
 storage.put('connection',{...record,audit_account_id:id,telegram_audit_owner:{...owner},connection_audit:transition?[...events,event]:events});
}
