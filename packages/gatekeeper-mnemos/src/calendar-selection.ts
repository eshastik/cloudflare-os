import type {ConnectionAuditEvent} from './connection-audit-storage.ts';
import {CalendarDrafts} from './calendar-drafts.ts';
import type {CalendarBridgeDraft,CalendarDraftReceipt} from './calendar-bridge.ts';
import type {CalendarBridgeRead, CalendarBridgeWindow} from "./calendar-bridge.ts";
import type {CalendarReadSource} from '@gadgets/workshop-shared/gatekeeper';
import type {AccountStorage} from './account-session.ts';

type CalendarMetadata = Awaited<ReturnType<CalendarReadSource['metadata']>>;
export interface CalendarSelection {
  connection_audit?:ConnectionAuditEvent[];
  id: string;
  project: string;
  request: string;
  tenant: string;
  owner: string;
  epoch: string;
  sourceKey: string;
  source: Fetcher<CalendarReadSource>;
  metadata: CalendarMetadata;
}
function identifier(value: string) {
  if (typeof value !== 'string' || !value || value.length > 255 || /[\x00\r\n]/.test(value)) throw Error('Invalid calendar selection.');
}
/** Server-only preparation store. The owning Mnemos account supplies identity and
 * a revocation epoch; callers must obtain the source through the trusted host. */
export class CalendarSelections {
  private storage: AccountStorage;
  constructor(storage: AccountStorage) { this.storage = storage; }
  async prepare(owner: {tenant: string; owner: string; epoch: string}, project: string,
      request: string, sourceKey: string, source: Fetcher<CalendarReadSource>, validateOwner: () => Promise<void>) {
    for (const value of [owner.tenant,owner.owner,owner.epoch,project,request]) identifier(value);
    if (typeof sourceKey !== 'string' || !sourceKey || sourceKey.length > 8192) throw Error('Invalid calendar source identity.');
    const key = 'calendarSelectionRequest:' + JSON.stringify([owner.epoch, project, request]);
    const verify = (record: CalendarSelection) => {
      if (record.tenant !== owner.tenant || record.owner !== owner.owner || record.epoch !== owner.epoch ||
          record.project !== project || record.request !== request || record.sourceKey !== sourceKey) throw Error('Calendar selection changed; use a new request.');
    };
    const publish = (record: CalendarSelection) => {
      const address = 'calendarSelection:' + record.id;
      const previous = this.storage.get<CalendarSelection>(address);
      if (previous) {
        verify(previous);
        if(previous.id!==record.id||JSON.stringify(previous.metadata)!==JSON.stringify(record.metadata)) throw Error('Stored selection changed.');
      } else this.storage.put(address, {...record,connection_audit:undefined});
      return {selection_id: record.id, title: record.metadata.title};
    };
    const resume = async (record: CalendarSelection) => {
      verify(record);
      await record.source.validate();
      await validateOwner();
      return publish(record);
    };
    await validateOwner();
    const previous = this.storage.get<CalendarSelection>(key);
    if (previous) return resume(previous);
    const metadata = await source.metadata();
    if (!metadata || !['google','microsoft','apple','yandex','caldav'].includes(metadata.provider) ||
        typeof metadata.title !== 'string' || metadata.title.length > 4096 || !metadata.time_zone || metadata.time_zone.length > 255) throw Error('Invalid calendar metadata.');
    identifier(metadata.calendar_id);
    await source.validate();
    await validateOwner();
    // No await between the second check and both durable writes: concurrent
    // identical requests converge, changed requests never replace a source.
    const raced = this.storage.get<CalendarSelection>(key);
    if (raced) return resume(raced);
    const record: CalendarSelection = {id: crypto.randomUUID(), ...owner, project, request, sourceKey, source, metadata};
    record.connection_audit=[{event_id:crypto.randomUUID(),protocol:'calendar-selection',account_id:record.id,project_id:project,tenant_id:owner.tenant,owner_id:owner.owner,phase:'selected',observed_at:new Date().toISOString()}];
    this.storage.put(key, record);
    return publish(record);
  }
  /** Bridge-only lookup: identifiers are matched to the owner-bound stored selection. */
  async resolve(id: string, expected: {tenant: string; owner: string; project: string; request: string}, currentEpoch: () => string | undefined) {
    identifier(id);
    const record = this.storage.get<CalendarSelection>('calendarSelection:' + id);
    if (!record || record.id !== id || record.tenant !== expected.tenant || record.owner !== expected.owner ||
        record.project !== expected.project || record.request !== expected.request || record.epoch !== currentEpoch()) throw Error('Calendar selection unavailable.');
    await record.source.validate();
    if (record.epoch !== currentEpoch()) throw Error('Calendar selection unavailable.');
    return record;
  }

  async validateDraftConnection(id:string,tenant:string,owner:string,currentEpoch:()=>string|undefined){
    const stored=this.storage.get<CalendarSelection>('calendarSelection:'+id);
    if(!stored)throw Error('Calendar selection unavailable.');
    return this.resolve(id,{tenant,owner,project:stored.project,request:stored.request},currentEpoch);
  }
  async stageDraft(id:string,input:CalendarBridgeDraft,currentEpoch:()=>string|undefined):Promise<CalendarDraftReceipt>{
    const stored=this.storage.get<CalendarSelection>('calendarSelection:'+id);
    if(!stored||input.connection_id!==id||input.calendar_id!==stored.metadata.calendar_id)throw Error('Calendar selection unavailable.');
    const validate=async()=>{await this.resolve(id,{tenant:input.tenant_id,owner:input.owner_id,project:input.project_id,request:stored.request},currentEpoch);};
    const draft=await new CalendarDrafts(this.storage).stage({tenant:stored.tenant,owner:stored.owner,epoch:stored.epoch,connection:id,agent:input.agent_principal_id},input.request_id,input.content,validate);
    return {draft_id:draft.id,connection_id:id,sha256:draft.sha256,state:draft.state,...(draft.execution?{execution:structuredClone(draft.execution)}:{})};
  }

  /** Read only the exact connection checked by Mnemos; recheck revocation after I/O. */
  async readWindow(id: string, input: CalendarBridgeRead, currentEpoch: () => string | undefined): Promise<CalendarBridgeWindow> {
    const stored = this.storage.get<CalendarSelection>('calendarSelection:' + id);
    if (!stored || input.connection_id !== id || input.calendar_id !== stored.metadata.calendar_id ||
        !Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) throw Error('Calendar selection unavailable.');
    const record = await this.resolve(id,{tenant:input.tenant_id,owner:input.owner_id,project:input.project_id,request:stored.request},currentEpoch);
    const result = await record.source.readWindow({time_min:input.time_min,time_max:input.time_max,limit:input.limit});
    if (result.calendar_id !== record.metadata.calendar_id || typeof result.time_zone !== 'string' || !result.time_zone || result.time_zone.length > 255 ||
        typeof result.events_json !== 'string' || new TextEncoder().encode(result.events_json).byteLength > 2*1024*1024 || typeof result.truncated !== 'boolean') throw Error('Invalid calendar response.');
    const events = JSON.parse(result.events_json);
    if (!Array.isArray(events) || events.length > input.limit || events.some(event=>!event || typeof event !== 'object' || Array.isArray(event) || typeof event.id !== 'string' || !event.id)) throw Error('Invalid calendar events.');
    await record.source.validate();
    if (record.epoch !== currentEpoch()) throw Error('Calendar selection unavailable.');
    return {calendar_id:result.calendar_id,time_zone:result.time_zone,events,truncated:result.truncated};
  }

}
