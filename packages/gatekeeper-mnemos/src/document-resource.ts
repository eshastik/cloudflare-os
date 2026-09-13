import type { MnemosAccountSession } from "./account-session.ts";

/** Identity of one document selected from a configured Mnemos installation. */
export interface DocumentResource {
  readonly projectId: string;
  readonly nodeId: string;
}

function identifier(value: string): string {
  if (typeof value !== "string" || !value || value.length > 255 || value === "." || value === ".." || /[\\/\u0000-\u0020\u007f]/u.test(value)) throw new Error("Invalid document identifier");
  return value;
}
function installation(origin: string): string {
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("Invalid Mnemos installation");
  return url.origin;
}

/** Canonical resource identity; constructing it does not grant access. */
export function documentResourceUrl(origin: string, resource: DocumentResource): string {
  return `${installation(origin)}/v1/projects/${encodeURIComponent(identifier(resource.projectId))}/nodes/${encodeURIComponent(identifier(resource.nodeId))}`;
}

/** Validate an immutable publication identifier before constructing a source or API request. */
export function publicationIdentifier(value: string): string { return identifier(value); }

/** Accepts only a canonical document URL on the configured installation. */
export function parseDocumentResource(origin: string, raw: string): DocumentResource {
  if (raw.length > 4096) throw new Error("Invalid document resource");
  const url = new URL(raw);
  const parts = url.pathname.split("/");
  if (url.origin !== installation(origin) || url.username || url.password || url.search || url.hash ||
      parts.length !== 6 || parts[1] !== "v1" || parts[2] !== "projects" || parts[4] !== "nodes") throw new Error("Invalid document resource");
  const resource = { projectId: identifier(decodeURIComponent(parts[3])), nodeId: identifier(decodeURIComponent(parts[5])) };
  if (documentResourceUrl(origin, resource) !== raw) throw new Error("Noncanonical document resource");
  return Object.freeze(resource);
}

/** Internal human-side reader for one selected document, not an agent RPC target. */
export class SelectedDocumentReader {
  #session: MnemosAccountSession;
  #project: string;
  #node: string;
  constructor(session: MnemosAccountSession, resource: DocumentResource) {
    this.#session = session;
    this.#project = identifier(resource.projectId);
    this.#node = identifier(resource.nodeId);
  }
  /** Read the published text while verifying project membership and current access. */
  async readPublished() {
    await this.#session.nodeHistory(this.#project, this.#node, "", 1);
    const document = await this.#session.readDocument(this.#node);
    await this.#session.nodeHistory(this.#project, this.#node, "", 1);
    return document;
  }
  /** Issue an immutable publication download for this selected document only. */
  async publicationTicket(eventId: string) {
    return this.#session.downloadPublication(this.#project, this.#node, identifier(eventId));
  }
  /** Check read access to an exact publication without requesting its body or a ticket. */
  async validatePublication(eventId: string): Promise<void> {
    await this.#session.checkPublicationRead(this.#project, this.#node, identifier(eventId));
  }
  /** Recheck current access after transferring immutable publication bytes. */
  async validateRead() {
    await this.#session.nodeHistory(this.#project, this.#node, "", 1);
  }
  /** List this document's publication history; no sibling or project selection is exposed. */
  async history(cursor = "") {
    return this.#session.nodeHistory(this.#project, this.#node, cursor, 50);
  }
}
