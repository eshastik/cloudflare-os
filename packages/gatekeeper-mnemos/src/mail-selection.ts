import type {ConnectionAuditEvent} from './connection-audit-storage.ts';
import {mailReplyAll} from '@gadgets/workshop-shared/mail-reply';
import {MailDrafts} from './mail-drafts.ts';
import {MailReplies} from './mail-replies.ts';
import {MailPages} from './mail-pages.ts';
import {validateMailReadRequest} from '@gadgets/workshop-shared/mail-search';
import type {MailBridgeDraft,MailDraftReceipt} from './mail-bridge.ts';
import type {MailBridgeRead, MailBridgeSelection} from "./mail-bridge.ts";
import type {MailReadSource} from "@gadgets/workshop-shared/gatekeeper";
import type {AccountStorage} from "./account-session.ts";

interface MailSelection {
  connection_audit?:ConnectionAuditEvent[];
  id: string;
  tenant: string;
  owner: string;
  epoch: string;
  project: string;
  request: string;
  sourceKey: string;
  source: Fetcher<MailReadSource>;
  provider: string;
  query: string;
  querySHA256: string;
}
function identifier(value: string) {
  if (typeof value !== "string" || !value || value.length > 255 || /[\x00\r\n]/.test(value)) throw Error("Invalid mail selection.");
}
async function queryHash(query: string): Promise<string> {
  if (typeof query !== "string" || !query.trim() || new TextEncoder().encode(query).byteLength > 1024 || /[\x00\r\n]/.test(query)) throw Error("Invalid mail query.");
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(query));
  return Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, "0")).join("");
}

/** Owns provider capabilities behind the verified human's Mnemos account. */
export class MailSelections {
  #storage: AccountStorage;
  constructor(storage: AccountStorage) { this.#storage = storage; }

  async prepare(owner: {tenant: string; owner: string; epoch: string}, project: string, request: string,
      sourceKey: string, source: Fetcher<MailReadSource>, validateOwner: () => Promise<void>) {
    for (const value of [owner.tenant, owner.owner, owner.epoch, project, request]) identifier(value);
    if (typeof sourceKey !== "string" || !sourceKey || sourceKey.length > 8192) throw Error("Invalid mail source.");
    const key = "mailSelectionRequest:" + JSON.stringify([owner.epoch, project, request]);
    const verify = (record: MailSelection) => {
      if (record.tenant !== owner.tenant || record.owner !== owner.owner || record.epoch !== owner.epoch ||
          record.project !== project || record.request !== request || record.sourceKey !== sourceKey) throw Error("Mail selection changed; use a new request.");
    };
    const publish = (record: MailSelection) => {
      const address = 'mailSelection:' + record.id;
      const previous = this.#storage.get<MailSelection>(address);
      if (previous) {
        verify(previous);
        if(previous.id!==record.id||previous.query!==record.query||previous.querySHA256!==record.querySHA256||previous.provider!==record.provider) throw Error('Stored selection changed.');
      } else this.#storage.put(address, {...record,connection_audit:undefined});
      return {selection_id: record.id, query: record.query};
    };
    const resume = async (record: MailSelection) => {
      verify(record);
      await record.source.validate();
      await validateOwner();
      return publish(record);
    };
    await validateOwner();
    const previous = this.#storage.get<MailSelection>(key);
    if (previous) return resume(previous);
    const metadata = await source.metadata();
    if (!metadata || !["google", "microsoft", "apple", "yandex", "imap"].includes(metadata.provider)) throw Error("Invalid mail provider.");
    const hash = await queryHash(metadata.query);
    await source.validate();
    await validateOwner();
    const raced = this.#storage.get<MailSelection>(key);
    if (raced) return resume(raced);
    const record: MailSelection = {id: crypto.randomUUID(), ...owner, project, request, sourceKey, source,
      provider: metadata.provider, query: metadata.query, querySHA256: hash};
    record.connection_audit=[{event_id:crypto.randomUUID(),protocol:'mail-selection',account_id:record.id,project_id:project,tenant_id:owner.tenant,owner_id:owner.owner,phase:'selected',observed_at:new Date().toISOString()}];
    this.#storage.put(key, record);
    return publish(record);
  }

  async resolve(id: string, expected: {tenant: string; owner: string; project: string; request: string}, currentEpoch: () => string | undefined) {
    identifier(id);
    const record = this.#storage.get<MailSelection>("mailSelection:" + id);
    if (!record || record.id !== id || record.tenant !== expected.tenant || record.owner !== expected.owner ||
        record.project !== expected.project || record.request !== expected.request || record.epoch !== currentEpoch()) throw Error("Mail selection unavailable.");
    await record.source.validate();
    if (record.epoch !== currentEpoch()) throw Error("Mail selection unavailable.");
    return record;
  }

  async validateDraftConnection(id:string,tenant:string,owner:string,currentEpoch:()=>string|undefined){
    const stored=this.#storage.get<MailSelection>('mailSelection:'+id);
    if(!stored)throw Error('Mail selection unavailable.');
    return this.resolve(id,{tenant,owner,project:stored.project,request:stored.request},currentEpoch);
  }

  async stageDraft(id:string,input:MailBridgeDraft,currentEpoch:()=>string|undefined):Promise<MailDraftReceipt> {
    const stored=this.#storage.get<MailSelection>('mailSelection:'+id);
    if(!stored||input.connection_id!==id||input.query_sha256!==stored.querySHA256)throw Error('Mail selection unavailable.');
    const validate=async()=>{await this.resolve(id,{tenant:input.tenant_id,owner:input.owner_id,project:input.project_id,request:stored.request},currentEpoch);};
    await validate();
    const reply=input.content?.reply_id===undefined?undefined:new MailReplies(this.#storage).resolve({selection:id,tenant:stored.tenant,owner:stored.owner,epoch:stored.epoch},input.content.reply_id);
    const draft=await new MailDrafts(this.#storage).stage({tenant:stored.tenant,owner:stored.owner,epoch:stored.epoch,connection:id,agent:input.agent_principal_id},input.request_id,input.content,validate,reply);
    return {draft_id:draft.id,connection_id:id,sha256:draft.sha256,state:draft.state,...(draft.delivery?{delivery:structuredClone(draft.delivery)}:{})};
  }

  async readSelection(id: string, input: MailBridgeRead, currentEpoch: () => string | undefined): Promise<MailBridgeSelection> {
    const stored = this.#storage.get<MailSelection>("mailSelection:" + id);
    if (!stored || input.connection_id !== id || input.query_sha256 !== stored.querySHA256 ||
        !Number.isInteger(input.limit) || input.limit < 1 || input.limit > 10) throw Error("Mail selection unavailable.");
    const record = await this.resolve(id, {tenant: input.tenant_id, owner: input.owner_id, project: input.project_id, request: stored.request}, currentEpoch);
    const request={limit:input.limit,...(input.attachment!==undefined?{attachment:input.attachment}:{}),...(input.search!==undefined?{search:input.search}:{}),...(input.cursor!==undefined?{cursor:input.cursor}:{})};
    const search=validateMailReadRequest(request);
    const scope={selection:id,tenant:record.tenant,owner:record.owner,epoch:record.epoch},pages=new MailPages(this.#storage);
    const cursor=pages.resolve(scope,request);
    const result = await record.source.readSelection({limit: input.limit,...(input.attachment?{attachment:input.attachment}:{}),...(Object.keys(search).length?{search}:{}),...(cursor?{cursor}:{})});
    if (!result || result.provider !== record.provider || result.query !== record.query ||
        typeof result.messages_json !== "string" || new TextEncoder().encode(result.messages_json).byteLength > 512 * 1024 ||
        typeof result.truncated !== "boolean") throw Error("Invalid mail response.");
    const messages = JSON.parse(result.messages_json);
    const ids = new Set<string>();
    if (!Array.isArray(messages) || messages.length > input.limit) throw Error("Invalid mail messages.");
    for (const message of messages) {
      if (!message || typeof message !== "object" || Array.isArray(message) || typeof message.message_id !== "string" || !message.message_id || ids.has(message.message_id)) throw Error("Invalid mail messages.");
      identifier(message.message_id);
      ids.add(message.message_id);
    }
    await record.source.validate();
    if (record.epoch !== currentEpoch()) throw Error("Mail selection unavailable.");
    const replies=new MailReplies(this.#storage);
    for(const message of messages){
      // Provider output cannot assert an existing Mnemos reply capability.
      delete message.reply_id;delete message.reply_subject;delete message.reply_all;
      const reply=await replies.capture({selection:id,tenant:record.tenant,owner:record.owner,epoch:record.epoch},message);
      if(reply){Object.assign(message,reply);const recipients=mailReplyAll(message,result.self_addresses);if(recipients)message.reply_all=recipients;}
    }
    await record.source.validate();
    if(record.epoch!==currentEpoch())throw Error('Mail selection unavailable.');
    if(result.next_cursor&&!result.truncated)throw Error('Invalid mail pagination.');
    const next_cursor=result.next_cursor?await pages.save(scope,request,result.next_cursor):undefined;
    await record.source.validate();
    if(record.epoch!==currentEpoch())throw Error('Mail selection unavailable.');
    if(input.attachment){if(!result.attachment||messages.length||result.attachment.message_id!==input.attachment.message_id||result.attachment.attachment_id!==input.attachment.attachment_id||result.attachment.offset!==input.attachment.offset)throw Error('Invalid attachment response.');}else if(result.attachment)throw Error('Unexpected attachment response.');
    const out = {...(result.attachment?{attachment:result.attachment}:{}),provider: record.provider, query_sha256: record.querySHA256, messages, truncated: result.truncated,...(next_cursor?{next_cursor}:{})};
    if (new TextEncoder().encode(JSON.stringify(out)).byteLength > 512 * 1024) throw Error("Mail result too large.");
    return out;
  }
}
