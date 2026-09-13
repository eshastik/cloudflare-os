import { isNativeDocumentFormat } from "@gadgets/workshop-shared/native-document";
import type {DriveImportCapture} from './drive-import-capture.ts';
import {OfficeUpdateRecovery} from "./office-update-recovery.ts";
import {OfficeUpdateWriter} from "./office-update-writer.ts";
import {reviewOfficeUpdate} from "./office-update-review.ts";
import { RpcStub, RpcTarget } from "cloudflare:workers";
import { MnemosAPIError, type PrivateParticipantMode } from "./mnemos-api.ts";
import type { NativeDocumentFormat } from "@gadgets/workshop-shared/native-document";
import { NativeCreationRecovery, type NativeCreationIntent } from "./native-creation-recovery.ts";
import type { MnemosAccountSession } from "./account-session.ts";

/** Trusted human UI only; no agent or gadget session is issued here. */
export class NativeWriteSelector extends RpcTarget {
  #session: MnemosAccountSession;
  #recovery: NativeCreationRecovery;
  #updateRecovery?: OfficeUpdateRecovery;
  #driveImports?: DriveImportCapture;
  constructor(session: MnemosAccountSession, recovery: NativeCreationRecovery, updateRecovery?:OfficeUpdateRecovery, driveImports?:DriveImportCapture) { super(); this.#session = session; this.#recovery = recovery; this.#updateRecovery=updateRecovery; this.#driveImports=driveImports; }
  async reviewOfficeUpdate(project:string,target:string,source:string,format:NativeDocumentFormat,head:string,hash:string){
    if(!this.#updateRecovery)throw Error("Office updates unavailable");
    return reviewOfficeUpdate(this.#session,this.#updateRecovery,project,target,source,format,head,hash,this.#driveImports);
  }
  async resumeOfficeUpdate(receipt:string,format:NativeDocumentFormat){
    if(!this.#updateRecovery)throw Error("Office updates unavailable");
    return new RpcStub(new OfficeUpdateWriter(this.#session,this.#updateRecovery,await this.#updateRecovery.open(receipt,format)));
  }
  async previewOffice(project: string, node: string, format: NativeDocumentFormat, source?: {head:string;sha256:string}) {
    if (!isNativeDocumentFormat(format)) throw new Error("Unsupported document format");
    const session = this.#session;
    const doc = await session.readDraftDocument(project, node);
    if(source && (!/^[a-f0-9]{64}$/.test(source.head)||!/^[a-f0-9]{64}$/.test(source.sha256)))throw new Error("Captured source version changed");
    const title = (doc.terms[0]?.metadata?.name || "Document").replace(/\.(docx|xlsx|pptx)$/i, "");
    const ticket = await session.convertOffice(project, node, doc.head, format === "cloudflareos.document" ? "docx" : format === "cloudflareos.presentation" ? "pptx" : "xlsx", true, title, source?.head);
    if(source && ticket.source_sha256!==source.sha256)throw new Error("Captured source checksum changed");
    return { previewId: ticket.preview_id!, head: doc.head, unsupported: ticket.unsupported,
      source: {head: ticket.source_head, sha256: ticket.source_sha256},
      download: new RpcStub(new class extends RpcTarget {
        async issue() { await session.checkPrivateVersionRead(project,node,source?.head||doc.head); return ticket; }
        async validate() { await session.checkPrivateVersionRead(project,node,source?.head||doc.head); }
      }()) };
  }
  async createOffice(project: string, name: string, format: NativeDocumentFormat, head: string, preview: string, acceptUnsupported: boolean) {
    if (!isNativeDocumentFormat(format)) throw new Error("Unsupported document format");
    if (!name.trim() || /[/\\\0]/.test(name) || new TextEncoder().encode(name).length > 255 || !/^[a-f0-9]{64}$/.test(head) || !preview || preview.length > 255 || typeof acceptUnsupported !== "boolean") throw new Error("Invalid import creation");
    return new RpcStub(new NativeCreator(this.#session, this.#recovery, {project,name,format,head,request:crypto.randomUUID(),upload:"",officePreview:preview,acceptUnsupported}));
  }
  async originalOffice(project: string, node: string, head: string) {
    const session = this.#session;
    const origin = await session.officeOrigin(project,node,head);
    if (!origin) return null;
    async function validate() {
      const current = await session.officeOrigin(project,node,head);
      if (!current || current.source_node_id !== origin!.source_node_id || current.source_head !== origin!.source_head || current.source_sha256 !== origin!.source_sha256) throw new Error("Original unavailable");
    }
    return new RpcStub(new class extends RpcTarget {
      async issue() {
        await validate();
        const ticket = await session.downloadPrivateVersion(project,origin.source_node_id,origin.source_head);
        if (ticket.sha256_hex !== origin.source_sha256) throw new Error("Original checksum mismatch");
        await validate();
        return ticket;
      }
      async validate() { await validate(); }
    }());
  }
  async exportOffice(project: string, node: string, expectedHead: string, format: NativeDocumentFormat) {
    if (!isNativeDocumentFormat(format)) throw new Error("Unsupported document format");
    const session = this.#session;
    const document = await session.readDraftDocument(project, node);
    if (document.head !== expectedHead || !document.exists || document.conflicted || document.content_type !== `application/vnd.${format}+json`) throw new Error("Select the current personal version");
    return new RpcStub(new class extends RpcTarget {
      async issue() { return session.convertOffice(project, node, expectedHead, format === "cloudflareos.document" ? "docx" : format === "cloudflareos.presentation" ? "pptx" : "xlsx", false); }
      async validate() { await session.checkPrivateVersionRead(project, node, expectedHead); }
    }());
  }
  async documentLocation(project: string, node: string, format: NativeDocumentFormat) {
    if (!isNativeDocumentFormat(format)) throw new Error("Unsupported document format");
    const doc = await this.#session.readDraftDocument(project, node);
    const metadata = doc.terms[0]?.metadata;
    if (!doc.exists || doc.conflicted || doc.content_type !== `application/vnd.${format}+json` || !metadata) throw new Error("Select a document with versioned metadata");
    return { head: doc.head, name: metadata.name, parent: metadata.parent_id };
  }
  async saveLocation(project: string, node: string, expectedHead: string, name: string, parent: string, format: NativeDocumentFormat) {
    if ((await this.documentLocation(project, node, format)).head !== expectedHead) throw new Error("Draft changed; reread location");
    return this.#session.saveDraftLocation(project, node, expectedHead, name, parent);
  }
  async folders(project: string, cursor: string) {
    const page = await this.#session.browseProject(project, cursor);
    if (page.truncated && !page.next_cursor) throw new Error("Folder listing truncated");
    return { folders: page.nodes.filter(n => n.is_dir).map(n => ({ id: n.node_id, name: n.name, parent: n.parent_id || "" })), nextCursor: page.next_cursor || "" };
  }
  async selectConflict(project: string, node: string, format: NativeDocumentFormat) {
    if (!isNativeDocumentFormat(format)) throw new Error("Unsupported document format");
    const document = await this.#session.readDraftDocument(project, node);
    const conflict = new NativeConflict(this.#session, project, node, format, document.head);
    await conflict.validate();
    return new RpcStub(conflict);
  }
  async reviewerIdentity() { return (await this.#session.whoAmI()).subject.user_id; }
  async reviewInbox(cursor: string) { return this.#session.listPublicationReviews(cursor); }
  async decideReview(id: string, domain: string, version: number, approved: boolean) { await this.#session.recordReviewDecision(id, domain, version, approved); }
  async updateDraft(project: string, expectedHead: string) { return this.#session.updateDraft(project, expectedHead); }
  async publicationState(project: string) { return this.#session.draftState(project); }
  async deleteDocument(project: string, node: string, expectedHead: string, format: NativeDocumentFormat) {
    const state = await this.restorationState(project, node, format);
    if (state.deleted || state.head !== expectedHead) throw new Error("Draft changed; prepare deletion again");
    return this.#session.deleteDraftDocument(project, node, expectedHead);
  }
  async restorationState(project: string, node: string, format: NativeDocumentFormat) {
    if (!isNativeDocumentFormat(format)) throw new Error("Unsupported document format");
    const doc = await this.#session.readDraftDocument(project, node);
    if (doc.conflicted || (doc.exists && doc.content_type !== `application/vnd.${format}+json`)) throw new Error("Select a compatible resolved document");
    return { head: doc.head, deleted: !doc.exists };
  }
  async restorePublication(project: string, node: string, publication: string, expectedHead: string, format: NativeDocumentFormat, deleted = false) {

    const state = await this.restorationState(project, node, format);
    if (state.head !== expectedHead || state.deleted !== deleted) throw new Error("Draft changed; prepare restoration again");
    if(publication.startsWith("private:")){
      if(deleted)throw new Error("Private version restoration requires an existing document");
      return this.#session.restorePrivateDraftContent(project,node,publication.slice(8),expectedHead);
    }
    if (deleted) {
      const source = await this.#session.downloadPublication(project, node, publication);
      if (source.content_type !== `application/vnd.${format}+json`) throw new Error("Publication format mismatch");
      return this.#session.restoreDeletedDraft(project, node, publication, expectedHead);
    }
    return this.#session.restoreDraftContent(project, node, publication, expectedHead);
  }
  async requestReview(project: string, personal: string, shared: string) { return this.#session.requestPublicationReview(project, personal, shared); }
  async review(id: string) { return this.#session.readPublicationReview(id); }
  async publishReview(project: string, id: string) { return this.#session.publishReview(project, id); }
  async scopes() {
    return { scopes: (await this.#session.listProjects()).projects.map(p => ({ id: p.id, name: p.name })) };
  }
  async documents(project: string, cursor: string) { return listNativeDocuments(this.#session, project, cursor); }
  async participants(project: string, node: string, head: string, cursor: string) {
    const page = await this.#session.listPrivateDraftParticipants(project,node,head,cursor);
    return { head: page.head, nextCursor: page.next_cursor, participants: page.participants.map(p => ({id:p.principal_id,name:p.display_name,mode:p.mode,canRead:p.can_read,canWrite:p.can_write})) };
  }
  async setParticipant(project: string, node: string, head: string, participant: string, expected: PrivateParticipantMode, mode: PrivateParticipantMode) {
    await this.#session.setPrivateDraftParticipant(project,node,head,participant,expected,mode);
  }
  async select(project: string, node: string, format: NativeDocumentFormat) {
    if (!isNativeDocumentFormat(format)) throw new Error("Unsupported document format");
    await this.#session.openDraft(project);
    let source = "";
    let own;
    try { own = await this.#session.readDraftDocument(project, node); }
    catch (error) { if (!(error instanceof MnemosAPIError && [403, 404].includes(error.status))) throw error; }
    if (!own?.exists && !own?.conflicted) {
      const invited = (await this.#session.listInvitedDocuments(project, "", node)).documents;
      if (invited.length !== 1 || invited[0].content_type !== `application/vnd.${format}+json`) throw new Error("Select an accessible document of the same format");
      source = invited[0].head;
    }
    const writer = new NativeWriter(this.#session, project, node, format, source);
    await writer.head();
    return new RpcStub(writer);
  }
  async create(project: string, name: string, format: NativeDocumentFormat) {
    if (!isNativeDocumentFormat(format)) throw new Error("Unsupported document format");
    if (!name.trim() || /[/\\\0]/.test(name) || new TextEncoder().encode(name).length > 255) throw new Error("Invalid document name");
    const { head } = await this.#session.openDraft(project);
    return new RpcStub(new NativeCreator(this.#session, this.#recovery, { project, name, format, head, request: crypto.randomUUID(), upload: "" }));
  }
  async resumeCreation(receipt: string, format: NativeDocumentFormat) {
    const intent = await this.#recovery.open(receipt, format);
    return new RpcStub(new NativeCreator(this.#session, this.#recovery, intent));
  }
  [Symbol.dispose]() { this.#session.dispose(); }
}

/** Frozen conflict authority retained by the trusted host; no arbitrary manifest inputs. */
class NativeConflict extends RpcTarget {
  #session: MnemosAccountSession;
  #project: string;
  #node: string;
  #mime: string;
  #head: string;
  constructor(session: MnemosAccountSession, project: string, node: string, format: NativeDocumentFormat, head: string) {
    super(); this.#session=session; this.#project=project; this.#node=node; this.#mime=`application/vnd.${format}+json`; this.#head=head;
  }
  async describe() {
    const doc=await this.#session.readDraftDocument(this.#project,this.#node);
    if (doc.head!==this.#head || !doc.conflicted || doc.content_type!==this.#mime || !doc.terms.length) throw new Error("Conflict changed or unavailable");
    return {head:doc.head,terms:doc.terms.map(t=>({present:t.present,negative:t.negative,metadata:t.metadata}))};
  }
  async validate() { await this.describe(); }
  async download(index: number) {
    const doc=await this.describe();
    if (!Number.isSafeInteger(index) || index<0 || index>=doc.terms.length) throw new Error("Invalid side");
    if (!doc.terms[index].present) return null;
    const ticket=await this.#session.beginDraftDownload(this.#project,this.#node,this.#head,index);
    return { url: ticket.url, method: ticket.method, size_bytes: ticket.size_bytes, sha256_hex: ticket.sha256_hex };
  }
  async resolve(index: number) {
    const doc=await this.describe();
    if (!Number.isSafeInteger(index) || index<0 || index>=doc.terms.length || index%2!==0 || doc.terms[index].negative) throw new Error("Select a positive conflict side");
    return this.#session.resolveDraftConflict(this.#project,this.#node,this.#head,index);
  }
}

class NativeWriter extends RpcTarget {
  #session: MnemosAccountSession;
  #project: string;
  #node: string;
  #mime: string;
  #source: string;
  constructor(session: MnemosAccountSession, project: string, node: string, format: NativeDocumentFormat, source = "") {
    super(); this.#session = session; this.#project = project; this.#node = node;
    this.#source = source;
    this.#mime = `application/vnd.${format}+json`;
  }
  async head() {
    if (this.#source) {
      await this.#session.checkPrivateVersionRead(this.#project, this.#node, this.#source);
      const state = await this.#session.draftState(this.#project);
      if (!state.personal_exists || !/^[a-f0-9]{64}$/.test(state.personal_head)) throw new Error("Personal draft unavailable");
      return state.personal_head;
    }
    const doc = await this.#session.readDraftDocument(this.#project, this.#node);
    // Do not silently replace arbitrary JSON/text with a different native format.
    if (!doc.exists || doc.conflicted || doc.content_type !== this.#mime) throw new Error("Select an existing document of the same native format");
    return doc.head;
  }
  async issue(expectedHead: string, size: number, checksum: string) {
    if (await this.head() !== expectedHead) throw new Error("Draft changed; select the document again");
    return this.#session.beginNativeUpload(this.#project, size, checksum);
  }
  async save(expectedHead: string, uploadId: string) {
    if (await this.head() !== expectedHead) throw new Error("Draft changed; select the document again");
    if (this.#source) {
      expectedHead = (await this.#session.adoptPrivateVersion(this.#project, this.#node, expectedHead, this.#source)).head;
      // Adoption may succeed before saving fails. A retry must reread the new head.
      this.#source = "";
    }
    return (await this.#session.saveDraftDocument(this.#project, this.#node, uploadId, expectedHead)).head;
  }
}

/** One frozen creation capability. A receipt restores the same server-minted identity. */
class NativeCreator extends RpcTarget {
  #issued = new Set<string>();
  #session: MnemosAccountSession;
  #recovery: NativeCreationRecovery;
  #intent: NativeCreationIntent;
  constructor(session: MnemosAccountSession, recovery: NativeCreationRecovery, intent: NativeCreationIntent) {
    super(); this.#session = session; this.#recovery = recovery; this.#intent = intent;
    if (intent.upload) this.#issued.add(intent.upload);
  }
  async head() { return this.#intent.head; }
  async recoveryState() { return { head: this.#intent.head, uploadId: this.#intent.upload }; }
  async issue(expectedHead: string, size: number, checksum: string) {
    if (expectedHead !== this.#intent.head || this.#intent.upload || this.#issued.size >= 8) throw new Error("Creation upload is already fixed");
    const ticket = await this.#session.beginNativeUpload(this.#intent.project, size, checksum);
    this.#issued.add(ticket.upload_id); return ticket;
  }
  #freeze(expectedHead: string, uploadId: string) {
    if (expectedHead !== this.#intent.head || !this.#issued.has(uploadId) || (this.#intent.upload && this.#intent.upload !== uploadId)) throw new Error("Creation request changed");
    this.#intent.upload = uploadId;
  }
  async checkpoint(expectedHead: string, uploadId: string) {
    this.#freeze(expectedHead, uploadId);
    return this.#recovery.seal(this.#intent);
  }
  async save(expectedHead: string, uploadId: string) {
    this.#freeze(expectedHead, uploadId);
    const i = this.#intent;
    return (await this.#session.createPrivateDocument(i.project, {
      ...(i.officePreview ? {office_preview_id:i.officePreview,accept_unsupported:i.acceptUnsupported} : {}),
      request_id: i.request, expected_head: i.head, parent_id: "", name: i.name,
      content_type: `application/vnd.${i.format}+json`, upload_id: i.upload, message: "Create native document",
    })).head;
  }
}

/** Own drafts, invited versions, then the shared catalog. */
export async function listNativeDocuments(session: MnemosAccountSession, project: string, cursor: string) {
    if (cursor && !cursor.startsWith("p:") && !cursor.startsWith("i:") && !cursor.startsWith("s:")) throw new Error("Invalid document cursor");
    if (!cursor || cursor.startsWith("p:")) {
      const page = await session.listPrivateDocuments(project, cursor ? cursor.slice(2) : "");
      if (page.documents.length || page.next_cursor) return {
        documents: page.documents.map(n => ({ id: n.node_id, name: n.name })),
        nextCursor: page.next_cursor ? `p:${page.next_cursor}` : "i:", truncated: false,
      };
    }
    if (!cursor.startsWith("s:")) {
      const invited = await session.listInvitedDocuments(project, cursor.startsWith("i:") ? cursor.slice(2) : "");
      if (invited.documents.length || invited.next_cursor) return {
        documents: invited.documents.map(n => ({id: n.node_id, name: n.name})),
        nextCursor: invited.next_cursor ? `i:${invited.next_cursor}` : "s:", truncated: false,
      };
    }
    const page = await session.browseProject(project, cursor.startsWith("s:") ? cursor.slice(2) : "");
    return { documents: page.nodes.filter(n => !n.is_dir).map(n => ({ id: n.node_id, name: n.name, ...(typeof n.shared_deleted === "boolean" ? { sharedDeleted: n.shared_deleted } : {}) })),
      nextCursor: page.next_cursor ? `s:${page.next_cursor}` : "", truncated: page.truncated };
  }
