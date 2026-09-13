import {mimeMailAttachments,mailAttachmentChunk,type MailAttachmentChunk} from '@gadgets/workshop-shared/mail-attachment';
import {validateMailReadRequest,matchesMailSearch,type MailReadRequest} from '@gadgets/workshop-shared/mail-search';
import {fetchWithAuthRetry, type AccessTokenProvider} from "./auth-retry";
import PostalMime, {type Address} from "postal-mime";
import type {MailAddress, MailMessage} from '@gadgets/workshop-shared/mail-message';

const addresses = (values: Address[] = []): MailAddress[] => values.flatMap(value =>
  value.group ? value.group.map(({name, address}) => ({name, address})) : [{name: value.name, address: value.address!}]);

const BASE = "https://gmail.googleapis.com/gmail/v1/users/me/messages";
const ID = /^[a-zA-Z0-9_-]{1,128}$/;
const unavailable = () => new Error("Selected Gmail messages are unavailable or changed.");

async function readJSON(response: Response, limit: number): Promise<unknown> {
  if (!response.ok || !response.body) { await response.body?.cancel(); throw unavailable(); }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) { await reader.cancel(); throw unavailable(); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder("utf-8", {fatal: true, ignoreBOM: false}).decode(bytes));
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw unavailable();
  return value as Record<string, unknown>;
}

/** Read capability for the owner's fixed Gmail query; exposes no mailbox mutations.
 * Matching messages are read individually: a matching thread does not authorize
 * unrelated messages in that thread. Mail content is always untrusted data. */
export class SelectedGmailReader {
  #token: AccessTokenProvider;
  #query: string;
  #folder?: string;
  #validate: () => Promise<void>;

  constructor(token: AccessTokenProvider, query: string, validate: () => Promise<void>) {
    if (typeof query !== "string" || !query.trim() || new TextEncoder().encode(query).byteLength > 1024 || /[\x00\r\n]/.test(query)) {
      throw new Error("Select a non-empty Gmail query of at most 1024 bytes.");
    }
    this.#token = token;
    this.#query = query;
    if(query.startsWith('folder:')){
      this.#folder=query.slice(7);
      if(!/^[A-Za-z0-9_-]{1,255}$/.test(this.#folder))throw new Error('Invalid Gmail folder.');
    }
    this.#validate = validate;
  }

  async validate(): Promise<void> { await this.#validate(); }
  async metadata() {
    await this.validate();
    await this.#checkFolder(AbortSignal.timeout(15000));
    return {provider: "google" as const, query: this.#query};
  }

  async #checkFolder(signal:AbortSignal){
    if(!this.#folder)return;
    const label=await this.#get('https://gmail.googleapis.com/gmail/v1/users/me/labels/'+encodeURIComponent(this.#folder),32768,signal);
    if(label.id!==this.#folder||typeof label.name!=='string'||!label.name)throw unavailable();
  }

  /** Gmail labels share the mailbox picker contract; label IDs survive renaming. */
  async listFolders(parent=''){
    if(parent!=='')throw new Error('Gmail labels have no folder navigation parent.');
    const result=await this.#get('https://gmail.googleapis.com/gmail/v1/users/me/labels',1024*1024,AbortSignal.timeout(15000));
    const labels=result.labels??[];
    if(!Array.isArray(labels)||labels.length>10000)throw unavailable();
    const seen=new Set<string>();
    const folders=labels.map(value=>{
      const label=record(value);
      if(typeof label.id!=='string'||!/^[A-Za-z0-9_-]{1,255}$/.test(label.id)||seen.has(label.id)||typeof label.name!=='string'||!label.name||new TextEncoder().encode(label.name).length>1024||/[\x00\r\n]/.test(label.name))throw unavailable();
      seen.add(label.id);return {id:label.id,name:label.name,hasChildren:false};
    });
    await this.validate();return {folders:folders.slice(0,500),truncated:folders.length>500};
  }

  async #get(url: string, limit: number, signal: AbortSignal) {
    await this.validate();
    const response = await fetchWithAuthRetry(url, {method: "GET", redirect: "error", signal}, this.#token);
    const result = await readJSON(response, limit);
    await this.validate();
    return record(result);
  }

  async #list(limit: number, signal: AbortSignal, cursor?:string) {
    const params=new URLSearchParams({maxResults:String(limit),includeSpamTrash:this.#folder?'true':'false'});
    if(this.#folder)params.set('labelIds',this.#folder);else params.set('q',this.#query);
    if(cursor)params.set('pageToken',cursor);
    const data = await this.#get(BASE + "?" + params, 32768, signal);
    const messages = data.messages === undefined ? [] : data.messages;
    if (!Array.isArray(messages) || messages.length > limit || (data.nextPageToken !== undefined && typeof data.nextPageToken !== "string")) throw unavailable();
    const ids = messages.map(value => {
      const item = record(value);
      if (typeof item.id !== "string" || !ID.test(item.id) || typeof item.threadId !== "string" || !ID.test(item.threadId)) throw unavailable();
      return {id: item.id, threadId: item.threadId};
    });
    if (new Set(ids.map(item => item.id)).size !== ids.length) throw unavailable();
    if(data.nextPageToken!==undefined&&(typeof data.nextPageToken!=='string'||!data.nextPageToken||data.nextPageToken.length>8192||/[\x00-\x20\x7f]/.test(data.nextPageToken)||data.nextPageToken===cursor))throw unavailable();
    return {ids, truncated: Boolean(data.nextPageToken),...(data.nextPageToken?{next_cursor:data.nextPageToken as string}:{})};
  }

  async readSelection(input: MailReadRequest) {
    const search=validateMailReadRequest(input);
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), 30000);
    try {
      await this.#checkFolder(timeout.signal);
      const selected = await this.#list(input.limit, timeout.signal,input.cursor);
      const messages: MailMessage[] = [];let attachment:MailAttachmentChunk|undefined;
      for (const item of selected.ids) {
        const data = await this.#get(BASE + "/" + item.id + "?format=raw", 3 * 1024 * 1024, timeout.signal);
        if (data.id !== item.id || data.threadId !== item.threadId || typeof data.raw !== "string" || !/^[A-Za-z0-9_-]*={0,2}$/.test(data.raw) || data.raw.length > 2800000 || typeof data.internalDate !== "string" || !/^\d{1,16}$/.test(data.internalDate)) throw unavailable();
        if(this.#folder&&(!Array.isArray(data.labelIds)||!data.labelIds.includes(this.#folder)))throw unavailable();
        const received = new Date(Number(data.internalDate));
        if (!Number.isFinite(received.valueOf())) throw unavailable();
        const binary = atob(data.raw.replace(/-/g, "+").replace(/_/g, "/"));
        if (binary.length > 2 * 1024 * 1024) throw unavailable();
        const mime = await PostalMime.parse(Uint8Array.from(binary, c => c.charCodeAt(0)));
        const text = mime.text ?? mime.html ?? "";
        const body = Array.from(text).slice(0, 16000).join("");
        const headers = mime.headers.filter(header => ["from", "to", "cc", "subject", "date", "message-id"].includes(header.key));
        if (mime.attachments.length > 50) throw unavailable();
        if(!matchesMailSearch({subject:mime.subject??'',from:addresses(mime.from?[mime.from]:[]),received_at:received.toISOString()},text,search))continue;
        const attachments=await mimeMailAttachments(mime.attachments);
        if(input.attachment?.message_id===item.id){const index=attachments.findIndex(file=>file.attachment_id===input.attachment!.attachment_id);if(index<0)throw unavailable();attachment=await mailAttachmentChunk(attachments[index],mime.attachments[index].content,input.attachment);}
        messages.push({message_id: item.id, thread_id: item.threadId, received_at: received.toISOString(),
          internet_message_id: mime.messageId ?? null, subject: mime.subject ?? '', references: mime.references?.trim().split(/\s+/).filter(Boolean) ?? [],
          from: addresses(mime.from ? [mime.from] : []), to: addresses(mime.to), cc: addresses(mime.cc), reply_to: addresses(mime.replyTo),
          headers, body, body_format: mime.text !== undefined ? "text" as const : "html" as const,
          body_truncated: body.length !== text.length,
          attachments,
          has_attachments: mime.attachments.length > 0, attachment_metadata_included: true,
          attachment_content_included: false as const});
      }
      // Conservative fresh membership check: even a new message changing the
      // first page asks the caller to retry, rather than returning a stale scope.
      const current = await this.#list(input.limit, timeout.signal,input.cursor);
      if (JSON.stringify(current) !== JSON.stringify(selected)) throw unavailable();
      await this.#checkFolder(timeout.signal);
      await this.validate();
      if(input.attachment&&!attachment)throw unavailable();
      const result = {provider: "google" as const, query: this.#query, messages:input.attachment?[]:messages,...(attachment?{attachment}:{}), truncated: selected.truncated,...(selected.next_cursor?{next_cursor:selected.next_cursor}:{})};
      if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 512 * 1024) throw unavailable();
      return result;
    } catch { throw unavailable(); }
    finally { clearTimeout(timer); }
  }
}
