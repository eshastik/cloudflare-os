import {validateMailReadRequest,matchesMailSearch,type MailReadRequest} from '@gadgets/workshop-shared/mail-search';
import type {MailMessage} from '@gadgets/workshop-shared/mail-message';
import {mailAttachmentChunk,type MailAttachment,type MailAttachmentChunk} from '@gadgets/workshop-shared/mail-attachment';
const GRAPH = "https://graph.microsoft.com/v1.0";
const ID = /^[A-Za-z0-9_+=/-]{1,255}$/;
const unavailable = () => new Error("Selected Outlook messages are unavailable or changed.");
type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw unavailable();
  return value as RecordValue;
}
function text(value: unknown, max: number): string {
  if (typeof value !== "string" || new TextEncoder().encode(value).byteLength > max || value.includes("\0")) throw unavailable();
  return value;
}
function id(value: unknown): string {
  const result = text(value, 255);
  if (!ID.test(result)) throw unavailable();
  return result;
}
async function boundedJSON(response: Response, limit: number): Promise<RecordValue> {
  if (!response.ok || !response.body) { await response.body?.cancel(); throw unavailable(); }
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) { await reader.cancel(); throw unavailable(); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return record(JSON.parse(new TextDecoder("utf-8", {fatal: true, ignoreBOM: false}).decode(bytes)));
}

/** Source held by the account Worker for one concrete folder, never a mailbox
 * supplied by an agent. Token resolution and generation checks stay private.
 * The account ID is the /me ID pinned when the owner connected this account. */
export class SelectedOutlookReader {
  #folder: string;
  #account: string;
  #token: () => Promise<string>;
  #validate: () => Promise<void>;
  constructor(folderId: string, accountId: string, token: () => Promise<string>, validate: () => Promise<void>) {
    this.#folder = id(folderId);
    this.#account = id(accountId);
    this.#token = token;
    this.#validate = validate;
  }
  async validate(): Promise<void> { await this.#validate(); }
  async #get(path: string, limit: number, signal: AbortSignal) {
    await this.validate();
    const token = await this.#token();
    if (!token || token.length > 16384 || /[^\x21-\x7e]/.test(token)) throw unavailable();
    await this.validate();
    const response = await fetch(GRAPH + path, {method: "GET", redirect: "manual", signal,
      headers: {Authorization: "Bearer " + token, Accept: "application/json",
        Prefer: 'IdType="ImmutableId", outlook.body-content-type="text"'}});
    const data = await boundedJSON(response, limit);
    await this.validate();
    return data;
  }
  async #identity(signal: AbortSignal) {
    const identity=await this.#get("/me?$select=id,mail,userPrincipalName",8192,signal);
    if(identity.id!==this.#account)throw unavailable();
    return [identity.mail,identity.userPrincipalName].filter((value):value is string=>typeof value==='string'&&/^[^\s<>@]+@[^\s<>@]+$/.test(value));
  }
  async #folderInfo(signal: AbortSignal) {
    const folder = await this.#get("/me/mailFolders/" + encodeURIComponent(this.#folder) + "?$select=id,displayName", 32768, signal);
    // Well-known aliases must be resolved by the owner's folder picker first.
    if (folder.id !== this.#folder || !text(folder.displayName, 1024)) throw unavailable();
  }
  /** Owner-only folder navigation; this method is not exposed on mail sources. */
  async listFolders(parent = "") {
    const signal = AbortSignal.timeout(30000);
    try {
      const path = parent ? "/me/mailFolders/" + encodeURIComponent(id(parent)) + "/childFolders" : "/me/mailFolders";
      const endpoint = GRAPH + path;
      let next = path + "?" + new URLSearchParams({"$top":"100", "$select":"id,displayName,childFolderCount"});
      const folders: {id:string; name:string; hasChildren:boolean}[] = [], seen = new Set<string>();
      await this.#identity(signal);
      for (let page=0; page<10; page++) {
        const data = await this.#get(next, 256*1024, signal);
        if (!Array.isArray(data.value) || data.value.length>100) throw unavailable();
        for (const value of data.value) {
          const item=record(value), folderId=id(item.id), name=text(item.displayName,1024);
          if (!name || seen.has(folderId) || !Number.isSafeInteger(item.childFolderCount) || Number(item.childFolderCount)<0) throw unavailable();
          seen.add(folderId);
          // Search folders aggregate messages from other folders and cannot be a fixed-folder source.
          if (item["@odata.type"] === "#microsoft.graph.mailSearchFolder") continue;
          folders.push({id:folderId,name,hasChildren:Number(item.childFolderCount)>0});
        }
        next="";
        if (data["@odata.nextLink"] !== undefined) {
          const url=new URL(text(data["@odata.nextLink"],8192));
          if (url.origin!==new URL(GRAPH).origin || url.pathname!==new URL(endpoint).pathname || url.username || url.password || url.hash) throw unavailable();
          next=url.pathname.slice("/v1.0".length)+url.search;
        }
        if (!next) break;
      }
      await this.#identity(signal);
      return {folders,truncated:!!next};
    } catch { throw unavailable(); }
  }
  async metadata() {
    const signal = AbortSignal.timeout(30000);
    try {
      await this.#identity(signal); await this.#folderInfo(signal); await this.#identity(signal);
      return {provider: "microsoft" as const, query: "folder:" + this.#folder};
    } catch { throw unavailable(); }
  }
  async #list(limit: number, signal: AbortSignal,cursor?:string) {
    const params = new URLSearchParams({"$top": String(limit), "$select": "id,parentFolderId,changeKey", "$orderby": "receivedDateTime desc"});
    const path="/me/mailFolders/"+encodeURIComponent(this.#folder)+"/messages";
    const continuation=(value:string)=>{const url=new URL(value);if(url.origin!==new URL(GRAPH).origin||url.pathname!==new URL(GRAPH+path).pathname||url.username||url.password||url.hash)throw unavailable();return url;};
    const data = await this.#get(cursor?continuation(cursor).pathname.slice('/v1.0'.length)+continuation(cursor).search:path+"?"+params,32768,signal);
    if (!Array.isArray(data.value) || data.value.length > limit) throw unavailable();
    const items = data.value.map(value => {
      const item = record(value);
      if (item.parentFolderId !== this.#folder) throw unavailable();
      return {id: id(item.id), version: id(item.changeKey)};
    });
    if (new Set(items.map(item => item.id)).size !== items.length) throw unavailable();
    const next=data['@odata.nextLink'];
    if(next!==undefined){continuation(text(next,8192));if(next===cursor)throw unavailable();}
    return {items,truncated:next!==undefined,...(typeof next==='string'?{next_cursor:next}:{})};
  }
  async readSelection(input: MailReadRequest) {
    const search=validateMailReadRequest(input);
    let attachment:MailAttachmentChunk|undefined;
    const signal = AbortSignal.timeout(30000);
    try {
      const self_addresses=await this.#identity(signal); await this.#folderInfo(signal);
      const selection = await this.#list(input.limit, signal,input.cursor), messages: MailMessage[] = [];
      for (const selected of selection.items) {
        const fields = "id,parentFolderId,changeKey,conversationId,internetMessageId,internetMessageHeaders,replyTo,receivedDateTime,subject,from,toRecipients,ccRecipients,body,hasAttachments";
        const message = await this.#get("/me/messages/" + encodeURIComponent(selected.id) + "?$select=" + fields, 3 * 1024 * 1024, signal);
        if (message.id !== selected.id || message.changeKey !== selected.version || message.parentFolderId !== this.#folder) throw unavailable();
        const received = text(message.receivedDateTime, 64);
        if (!/^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,7})?(?:Z|[+-]\d\d:\d\d)$/.test(received) || !Number.isFinite(Date.parse(received))) throw unavailable();
        const calendarDate = new Date(received.slice(0, 10) + "T00:00:00Z");
        if (!Number.isFinite(calendarDate.valueOf()) || calendarDate.toISOString().slice(0, 10) !== received.slice(0, 10)) throw unavailable();
        const body = record(message.body);
        if (body.contentType !== "text" && body.contentType !== "html") throw unavailable();
        const content = text(body.content, 2 * 1024 * 1024), clipped = Array.from(content).slice(0, 16000).join("");
        const headers = [{key: "subject", value: text(message.subject, 16384)}];
        const address = (value: unknown) => {
          const email = record(record(value).emailAddress);
          return {name: email.name === undefined ? "" : text(email.name, 1024), address: text(email.address, 1024)};
        };
        if (message.from != null) headers.push({key: "from", value: JSON.stringify(address(message.from))});
        for (const [field, key] of [["toRecipients", "to"], ["ccRecipients", "cc"]]) {
          const recipients = message[field];
          if (!Array.isArray(recipients) || recipients.length > 100) throw unavailable();
          headers.push({key, value: JSON.stringify(recipients.map(address))});
        }
        if (typeof message.hasAttachments !== "boolean") throw unavailable();
        const recipients = (value: unknown) => {
          if (!Array.isArray(value) || value.length > 100) throw unavailable();
          return value.map(address);
        };
        if(!matchesMailSearch({subject:text(message.subject,16384),from:message.from==null?[]:[address(message.from)],received_at:new Date(received).toISOString()},content,search))continue;
        const attachments=await this.#attachments(selected.id,signal);
        if(input.attachment?.message_id===selected.id){
          const file=attachments.find(file=>file.attachment_id===input.attachment!.attachment_id);
          if(!file||file.kind==='reference')throw unavailable();
          attachment=await mailAttachmentChunk(file,await this.#attachmentBytes(selected.id,file.attachment_id,signal),input.attachment);
        }
        messages.push({message_id: selected.id, thread_id: id(message.conversationId), received_at: new Date(received).toISOString(),
          internet_message_id: message.internetMessageId == null ? null : text(message.internetMessageId, 16384),
          references: Array.isArray(message.internetMessageHeaders) ? message.internetMessageHeaders.filter(h=>typeof h?.name==='string'&&h.name.toLowerCase()==='references').flatMap(h=>text(h.value,16384).trim().split(/\s+/).filter(Boolean)) : [],
          subject: text(message.subject, 16384), from: message.from == null ? [] : [address(message.from)],
          to: recipients(message.toRecipients), cc: recipients(message.ccRecipients), reply_to: recipients(message.replyTo ?? []),
          headers, body: clipped, body_format: body.contentType, body_truncated: clipped !== content,
          has_attachments: message.hasAttachments||attachments.length>0, attachments, attachment_metadata_included: true, attachment_content_included: false});
      }
      const current = await this.#list(input.limit, signal,input.cursor);
      if (JSON.stringify(current) !== JSON.stringify(selection)) throw unavailable();
      await this.#folderInfo(signal); await this.#identity(signal); await this.validate();
      if(input.attachment&&!attachment)throw unavailable();
      const result = {provider: "microsoft" as const, query: "folder:" + this.#folder, self_addresses, messages:input.attachment?[]:messages,...(attachment?{attachment}:{}), truncated: selection.truncated,...(selection.next_cursor?{next_cursor:selection.next_cursor}:{})};
      if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 512 * 1024) throw unavailable();
      return result;
    } catch { throw unavailable(); }
  }

  async #attachmentBytes(message:string,attachment:string,signal:AbortSignal):Promise<Uint8Array> {
    await this.validate();const token=await this.#token();await this.validate();
    if(!token||token.length>16384||/[^\x21-\x7e]/.test(token))throw unavailable();
    const response=await fetch(GRAPH+'/me/messages/'+encodeURIComponent(message)+'/attachments/'+encodeURIComponent(attachment)+'/$value',{
      method:'GET',redirect:'manual',signal,headers:{Authorization:'Bearer '+token,Prefer:'IdType="ImmutableId"'}});
    if(response.status!==200||response.headers.has('Content-Range')||!response.body){await response.body?.cancel();throw unavailable();}
    const reader=response.body.getReader(),chunks:Uint8Array[]=[];let length=0;
    try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>2*1024*1024){await reader.cancel();throw unavailable();}chunks.push(value);}}
    finally{reader.releaseLock();}
    const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    await this.validate();return bytes;
  }

  async #attachments(message:string,signal:AbortSignal):Promise<MailAttachment[]> {
    const path='/me/messages/'+encodeURIComponent(message)+'/attachments';
    let next=path+'?'+new URLSearchParams({'$top':'50','$select':'id,name,contentType,size,isInline'});
    const attachments:MailAttachment[]=[],seen=new Set<string>(),pages=new Set<string>();
    for(let page=0;page<10;page++){
      if(pages.has(next))throw unavailable();pages.add(next);
      const data=await this.#get(next,256*1024,signal);
      if(!Array.isArray(data.value)||data.value.length>50||attachments.length+data.value.length>50)throw unavailable();
      for(const raw of data.value){
        const item=record(raw),attachment_id=text(item.id,1024);
        if(!/^[A-Za-z0-9_+=/-]+$/.test(attachment_id)||seen.has(attachment_id)||!Number.isSafeInteger(item.size)||Number(item.size)<0||typeof item.isInline!=='boolean')throw unavailable();
        seen.add(attachment_id);
        const type=text(item['@odata.type'],128).replace(/^#/,'');
        const kind=type==='microsoft.graph.fileAttachment'?'file':type==='microsoft.graph.itemAttachment'?'item':type==='microsoft.graph.referenceAttachment'?'reference':undefined;
        if(!kind)throw unavailable();
        attachments.push({attachment_id,filename:item.name==null?null:text(item.name,4096),content_type:item.contentType==null?'application/octet-stream':text(item.contentType,255),size:Number(item.size),is_inline:item.isInline,kind,sha256:null});
      }
      if(data['@odata.nextLink']===undefined)return attachments;
      const url=new URL(text(data['@odata.nextLink'],8192));
      if(url.origin!==new URL(GRAPH).origin||url.pathname!==new URL(GRAPH+path).pathname||url.username||url.password||url.hash)throw unavailable();
      next=url.pathname.slice('/v1.0'.length)+url.search;
    }
    throw unavailable();
  }
}
