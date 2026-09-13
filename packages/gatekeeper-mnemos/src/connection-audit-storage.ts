import type {AccountStorage} from './account-session.ts';

/** Metadata of a local connection transition; never contains provider credentials. */
export interface ConnectionAuditEvent {
  event_id:string;
  protocol:'telegram'|'imap'|'caldav'|'webdav'|'mail-selection'|'calendar-selection'|'account'|'native-creation-key'|'office-update-key'|'local-operation';
  project_id?:string;
  operation_kind?:string;
  resource_sha256?:string;
  before_sha256?:string;
  after_sha256?:string;
  account_id:string;
  tenant_id:string;
  owner_id:string;
  phase:'pairing-candidate'|'ready'|'channel-pending'|'revoked'|'connecting'|'enabled'|'removed'|'failed'|'selected'|'connected'|'disconnected'|'epoch-initialized'|'created'|'saved'|'deleted';
  observed_at:string;
}
interface ConnectionRecord {
  id:string;
  owner:{tenant:string;owner:string;epoch:string};
  generation:string;
  enabled:boolean;
}
interface Evidence {connection_owner?:{tenant:string;owner:string};connection_audit?:ConnectionAuditEvent[];connection_deleted?:boolean}

/** Canonical connection state and its history are one KV write. A tombstone
 * removes credentials while retaining evidence for later central delivery. */
export class ConnectionAuditStorage implements AccountStorage {
  private storage:AccountStorage;
  private protocol:'telegram'|'imap'|'caldav'|'webdav';
  constructor(storage:AccountStorage,protocol:'telegram'|'imap'|'caldav'|'webdav'){this.storage=storage;this.protocol=protocol;}
  #connection(key:string){return key.startsWith(this.protocol+'Account:');}
  get<T>(key:string):T|undefined {
    const value=this.storage.get<T & Evidence>(key);
    return this.#connection(key)&&value?.connection_deleted ? undefined : value;
  }
  put<T>(key:string,value:T):void {
    if(!this.#connection(key)){this.storage.put(key,value);return;}
    const record=value as T & ConnectionRecord;
    if(!record?.id||key!==this.protocol+'Account:'+record.id||!record.owner?.tenant||!record.owner.owner||!record.generation||typeof record.enabled!=='boolean')throw Error('Connection audit metadata unavailable.');
    const previous=this.storage.get<Evidence>(key);
    const event=this.#event(record,record.enabled?'enabled':'connecting');
    const events=previous?.connection_audit??[];
    if(previous?.connection_owner&&(previous.connection_owner.tenant!==event.tenant_id||previous.connection_owner.owner!==event.owner_id)||events.some(e=>e.tenant_id!==event.tenant_id||e.owner_id!==event.owner_id))throw Error('Connection audit owner changed.');
    // Reserve room for enable and removal when delivery is unavailable.
    if(events.length>=(record.enabled?127:125))throw Error('Connection audit delivery backlog full.');
    this.storage.put(key,{...value,connection_owner:{tenant:event.tenant_id,owner:event.owner_id},connection_audit:[...events,event],connection_deleted:false});
  }
  delete(key:string):void {this.#remove(key,'removed');}
  /** Failed network validation removes the same generation's credential. */
  discard(key:string):void {this.#remove(key,'failed');}
  #remove(key:string,phase:'removed'|'failed'){
    if(!this.#connection(key)){this.storage.delete(key);return;}
    const previous=this.storage.get<ConnectionRecord & Evidence>(key);
    if(!previous||previous.connection_deleted)return;
    this.storage.put(key,{
      connection_deleted:true,
      connection_owner:{tenant:previous.owner.tenant,owner:previous.owner.owner},
      connection_audit:[...(previous.connection_audit??[]),this.#event(previous,phase)],
    });
  }
  #event(record:ConnectionRecord,phase:ConnectionAuditEvent['phase']):ConnectionAuditEvent {
    return {event_id:crypto.randomUUID(),protocol:this.protocol,account_id:record.id,
      tenant_id:record.owner.tenant,owner_id:record.owner.owner,phase,observed_at:new Date().toISOString()};
  }
}
