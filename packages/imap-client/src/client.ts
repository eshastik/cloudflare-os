import {mimeMailAttachments,mailAttachmentChunk,type MailAttachmentChunk} from '@gadgets/workshop-shared/mail-attachment';
import {validateMailReadRequest,matchesMailSearch,type MailReadRequest} from '@gadgets/workshop-shared/mail-search';
import {ImapFlow} from "imapflow";
import PostalMime, {type Address} from "postal-mime";
import type {MailAddress, MailMessage} from '@gadgets/workshop-shared/mail-message';

const addresses = (values: Address[] = []): MailAddress[] => values.flatMap(value =>
  value.group ? value.group.map(({name, address}) => ({name, address})) : [{name: value.name, address: value.address!}]);

/** Deployment-selected destination, never supplied by an agent. Implicit TLS only. */
export interface ImapServer {host: string; port: number; provider: "apple" | "yandex" | "imap";}
/** Private account credentials, held by the owning gatekeeper. */
export interface ImapCredential {username: string; password: string;}
const unavailable = () => Error("Selected IMAP messages are unavailable or changed.");
const MAX_SOURCE = 2 * 1024 * 1024;

/** Reads the newest messages of one owner-selected folder. It exposes no mutations,
 * arbitrary IMAP commands, alternate destinations, or credential getters. */
export class SelectedImapReader {
  #server: ImapServer;
  #credential: ImapCredential;
  #mailbox: string;
  #validate: () => Promise<void>;

  constructor(server: ImapServer, credential: ImapCredential, mailbox: string, validate: () => Promise<void>) {
    if (!server || !["apple", "yandex", "imap"].includes(server.provider) ||
        typeof server.host !== "string" || !/^(?=.{1,253}$)[a-zA-Z0-9]+(?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(server.host) ||
        !Number.isInteger(server.port) || server.port < 1 || server.port > 65535 ||
        !credential || typeof credential.username !== "string" || !credential.username || credential.username.length > 255 ||
        typeof credential.password !== "string" || !credential.password || credential.password.length > 4096 ||
        /[\x00\r\n]/.test(credential.username + credential.password) ||
        typeof mailbox !== "string" || !mailbox || new TextEncoder().encode(mailbox).length > 512 || /[\x00-\x1f\x7f]/.test(mailbox)) throw unavailable();
    this.#server = {...server}; this.#credential = {...credential}; this.#mailbox = mailbox; this.#validate = validate;
  }

  async validate() {await this.#validate();}
  async metadata() {
    await this.validate();
    return {provider: this.#server.provider, query: JSON.stringify({mailbox: this.#mailbox, order: "newest"})};
  }

  #client() {
    const client = new ImapFlow({host: this.#server.host, port: this.#server.port, secure: true,
      auth: {user: this.#credential.username, pass: this.#credential.password}, logger: false,
      disableAutoIdle: true, disableAutoEnable: true, disableIMAP4rev2: true, disableCompression: true,
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 10000});
    client.on("error", () => {});
    return client;
  }

  /** Verify the chosen folder without downloading any message bodies. */
  async checkMailbox() {
    await this.validate();
    const client = this.#client();
    let expired = false;
    const timer = setTimeout(() => {expired = true; client.close();}, 30000);
    try {
      await client.connect();
      const mailbox = await client.mailboxOpen(this.#mailbox, {readOnly: true});
      await this.validate();
      if (expired || !mailbox.readOnly) throw unavailable();
    } catch {throw unavailable();}
    finally {clearTimeout(timer); client.close();}
  }

  async readSelection(input: MailReadRequest) {
    const search=validateMailReadRequest(input);
    const cursor=input.cursor?.match(/^([1-9][0-9]*):([1-9][0-9]*)$/);
    if(input.cursor&&!cursor)throw unavailable();
    await this.validate();
    const client = this.#client();
    let expired = false;
    const timer = setTimeout(() => {expired = true; client.close();}, 30000);
    const validate = async () => {await this.validate(); if (expired) throw unavailable();};
    const snapshot = async () => {
      await validate();
      const box = await client.mailboxOpen(this.#mailbox, {readOnly: true});
      if (!box.readOnly || !box.uidValidity || box.uidValidity <= 0n || !Number.isSafeInteger(box.exists) || box.exists < 0) throw unavailable();
      let end=box.exists;
      if(cursor){
        if(String(box.uidValidity)!==cursor[1]||!Number.isSafeInteger(Number(cursor[2])))throw unavailable();
        const anchor=await client.fetchOne(cursor[2],{uid:true},{uid:true});
        if(!anchor||anchor.uid!==Number(cursor[2])||!Number.isSafeInteger(anchor.seq)||anchor.seq<1||anchor.seq>box.exists)throw unavailable();
        end=anchor.seq-1;
      }
      const start = Math.max(1, end - input.limit + 1);
      const rows = end ? await client.fetchAll(`${start}:${end}`, {uid: true, size: true, internalDate: true}) : [];
      if (rows.length !== Math.min(end, input.limit) || new Set(rows.map(row => row.uid)).size !== rows.length) throw unavailable();
      const messages = rows.map(row => {
        if (!Number.isSafeInteger(row.uid) || row.uid < 1 || !Number.isSafeInteger(row.size) || row.size! < 0 ||
            !(row.internalDate instanceof Date) || !Number.isFinite(row.internalDate.valueOf())) throw unavailable();
        return {uid: row.uid, size: row.size!, date: row.internalDate.toISOString()};
      }).sort((a, b) => b.uid - a.uid);
      return {validity: String(box.uidValidity), messages, truncated: start>1,...(start>1?{next_cursor:String(box.uidValidity)+':'+messages.at(-1)!.uid}:{})};
    };
    try {
      await client.connect();
      const selected = await snapshot();
      const messages: MailMessage[] = [];let attachment:MailAttachmentChunk|undefined;
      for (const item of selected.messages) {
        await validate();
        if (item.size > MAX_SOURCE) throw unavailable();
        const data = await client.fetchOne(String(item.uid), {uid: true, source: {start: 0, maxLength: MAX_SOURCE + 1}}, {uid: true});
        if (!data || data.uid !== item.uid || !data.source || data.source.length !== item.size || data.source.length > MAX_SOURCE) throw unavailable();
        const mime = await PostalMime.parse(data.source);
        const text = mime.text ?? mime.html ?? "", body = Array.from(text).slice(0, 16000).join("");
        if (mime.attachments.length > 50) throw unavailable();
        if(!matchesMailSearch({subject:mime.subject??'',from:addresses(mime.from?[mime.from]:[]),received_at:item.date},text,search))continue;
        const attachments=await mimeMailAttachments(mime.attachments);
        if(input.attachment?.message_id===`${selected.validity}:${item.uid}`){const index=attachments.findIndex(file=>file.attachment_id===input.attachment!.attachment_id);if(index<0)throw unavailable();attachment=await mailAttachmentChunk(attachments[index],mime.attachments[index].content,input.attachment);}
        messages.push({message_id: `${selected.validity}:${item.uid}`, received_at: item.date,
          internet_message_id: mime.messageId ?? null, subject: mime.subject ?? '', references: mime.references?.trim().split(/\s+/).filter(Boolean) ?? [],
          from: addresses(mime.from ? [mime.from] : []), to: addresses(mime.to), cc: addresses(mime.cc), reply_to: addresses(mime.replyTo),
          headers: mime.headers.filter(header => ["from", "to", "cc", "subject", "date", "message-id"].includes(header.key)),
          body, body_format: mime.text !== undefined ? "text" : "html", body_truncated: body.length !== text.length,
          has_attachments: mime.attachments.length > 0, attachment_metadata_included: true,
          attachments, attachment_content_included: false});
      }
      if (JSON.stringify(await snapshot()) !== JSON.stringify(selected)) throw unavailable();
      await validate();
      if(input.attachment&&!attachment)throw unavailable();
      const metadata = await this.metadata(), result = {...metadata, messages:input.attachment?[]:messages,...(attachment?{attachment}:{}), truncated: selected.truncated,...(selected.next_cursor?{next_cursor:selected.next_cursor}:{})};
      if (new TextEncoder().encode(JSON.stringify(result)).length > 512 * 1024) throw unavailable();
      await validate();
      return result;
    } catch {throw unavailable();}
    finally {clearTimeout(timer); client.close();}
  }
}
