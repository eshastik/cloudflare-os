import {xml2js, type Element} from 'xml-js';

/** Deployment-approved directory URL. The user selects files below this root. */
export interface WebDAVServer {url: string;}
/** Stored by the owning account; never exposed through a source capability. */
export interface WebDAVCredential {username: string; password: string;}
const LIMIT = 16 * 1024 * 1024;
const PROPERTIES = '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getetag/><d:getcontentlength/><d:getcontenttype/></d:prop></d:propfind>';
const fail = () => Error('WebDAV source unavailable or changed.');
const clean = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\x00-\x1f\x7f]/.test(v);
const etag = (v: unknown): v is string => typeof v === 'string' && /^"[\x21\x23-\x7e\x80-\xff]{1,240}"$/.test(v);
const mime = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(v) && v.length <= 255;

interface Node {name: string; text: string; children: Node[];}
// Resolve namespace URIs, not arbitrary prefixes. DTDs/entities are rejected before parsing.
function tree(element: Element, inherited: Record<string, string> = {}, depth = 0): Node {
  if (depth > 20) throw fail();
  const namespaces = {...inherited};
  for (const [key, value] of Object.entries(element.attributes ?? {})) {
    if (key === 'xmlns') namespaces[''] = String(value);
    else if (key.startsWith('xmlns:')) namespaces[key.slice(6)] = String(value);
  }
  const parts = (element.name ?? '').split(':');
  const prefix = parts.length === 1 ? '' : parts[0];
  return {
    name: (namespaces[prefix] ?? '') + ':' + parts.at(-1),
    text: (element.elements ?? []).filter(e => e.type === 'text' || e.type === 'cdata').map(e => e.text ?? e.cdata ?? '').join(''),
    children: (element.elements ?? []).filter(e => e.type === 'element').map(e => tree(e, namespaces, depth + 1)),
  };
}
function one(node: Node, name: string): Node {
  const children = node.children.filter(child => child.name === 'DAV::' + name);
  if (children.length !== 1) throw fail();
  return children[0];
}
function value(node: Node, name: string): string {
  const child = one(node, name);
  if (child.children.length) throw fail();
  return child.text;
}
async function body(response: Response, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) {await response.body?.cancel(); throw fail();}
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    if (reader) for (;;) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.length;
      if (size > limit) {await reader.cancel(); throw fail();}
      chunks.push(next.value);
    }
  } finally {reader?.releaseLock();}
  if (length !== null && Number(length) !== size) throw fail();
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.length;}
  return bytes;
}

/** Read-only file adapter. Requests never follow redirects, write files, or use response-provided URLs. */
export class WebDAVImportReader {
  #root: URL;
  #authorization: string;
  constructor(server: WebDAVServer, credential: WebDAVCredential, private validate: () => Promise<void>, private fetcher: typeof fetch = fetch) {
    this.#root = new URL(server.url);
    if (this.#root.protocol !== 'https:' || this.#root.username || this.#root.password || this.#root.search || this.#root.hash || !this.#root.pathname.endsWith('/') || this.#root.href.length > 4096) throw fail();
    if (!clean(credential.username, 255) || credential.username.includes(':') || !clean(credential.password, 4096)) throw fail();
    this.#authorization = 'Basic ' + btoa(String.fromCharCode(...new TextEncoder().encode(credential.username + ':' + credential.password)));
  }
  #file(fileId: string): URL {
    // File selection is decoded, relative text. Encode each segment once; percent escapes and URL syntax are not accepted.
    if (!clean(fileId, 255) || /[%\\?#]/.test(fileId) || fileId.split('/').some(part => !part || part === '.' || part === '..')) throw fail();
    const url = new URL(fileId.split('/').map(encodeURIComponent).join('/'), this.#root);
    if (url.origin !== this.#root.origin || !url.pathname.startsWith(this.#root.pathname)) throw fail();
    return url;
  }
  async #request(url: URL, method: 'PROPFIND' | 'GET', signal: AbortSignal, version?: string): Promise<Response> {
    await this.validate(); signal.throwIfAborted();
    const headers: Record<string, string> = {Authorization: this.#authorization, 'Accept-Encoding': 'identity'};
    if (method === 'PROPFIND') {headers.Depth = '0'; headers['Content-Type'] = 'application/xml; charset=utf-8';}
    if (version) headers['If-Match'] = version;
    const fetcher = this.fetcher;
    const response = await fetcher(url, {method, headers, redirect: 'manual', signal, ...(method === 'PROPFIND' ? {body: PROPERTIES} : {})});
    if (response.status !== (method === 'PROPFIND' ? 207 : 200)) {await response.body?.cancel(); throw fail();}
    try {await this.validate();} catch {await response.body?.cancel(); throw fail();}
    return response;
  }
  async #properties(url: URL, signal: AbortSignal) {
    const bytes = await body(await this.#request(url, 'PROPFIND', signal), 64 * 1024);
    const xml = new TextDecoder('utf-8', {fatal: true, ignoreBOM: false}).decode(bytes);
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw fail();
    const roots = (xml2js(xml, {compact: false}) as Element).elements?.filter(e => e.type === 'element');
    if (roots?.length !== 1) throw fail();
    const root = tree(roots[0]); if (root.name !== 'DAV::multistatus') throw fail();
    const response = one(root, 'response');
    const href = new URL(value(response, 'href'), url);
    if (href.username || href.password || href.search || href.hash || href.origin !== url.origin || decodeURIComponent(href.pathname) !== decodeURIComponent(url.pathname)) throw fail();
    const props = response.children.filter(child => child.name === 'DAV::propstat')
      .filter(child => /^HTTP\/1\.[01] 200(?: |$)/.test(value(child, 'status'))).map(child => one(child, 'prop'));
    return {name: '', text: '', children: props.flatMap(p => p.children)};
  }
  async #metadata(url: URL, signal: AbortSignal) {
    const properties = await this.#properties(url, signal);
    if (one(properties, 'resourcetype').children.length) throw fail();
    const propertyTag = value(properties, 'getetag');
    // WsgiDAV emits the opaque tag without HTTP quotes in this XML property.
    // Normalize that representation; the GET must still return the same strong HTTP ETag.
    const version = !propertyTag.startsWith('W/') && /^[\x21\x23-\x7e\x80-\xff]{1,240}$/.test(propertyTag) ? '"' + propertyTag + '"' : propertyTag;
    const size = value(properties, 'getcontentlength'), type = value(properties, 'getcontenttype').split(';')[0].trim();
    if (!etag(version) || !/^\d+$/.test(size) || !Number.isSafeInteger(Number(size)) || Number(size) > LIMIT || !mime(type)) throw fail();
    return {version, size: Number(size), type};
  }
  /** Authenticate the configured directory without downloading or enumerating its files. */
  async checkConnection(): Promise<void> {
    try {
      const properties = await this.#properties(this.#root, AbortSignal.timeout(30000));
      one(one(properties, 'resourcetype'), 'collection');
      await this.validate();
    } catch {throw fail();}
  }
  /** Capture one current representation, fenced by a strong ETag and account checks. */
  async snapshot(fileId: string) {
    try {
      const url = this.#file(fileId), signal = AbortSignal.timeout(30000);
      const before = await this.#metadata(url, signal);
      const response = await this.#request(url, 'GET', signal, before.version);
      if (response.headers.get('etag') !== before.version || (response.headers.get('content-type') ?? '').split(';')[0].trim() !== before.type || ![null, 'identity'].includes(response.headers.get('content-encoding'))) {await response.body?.cancel(); throw fail();}
      const bytes = await body(response, LIMIT);
      if (bytes.length !== before.size) throw fail();
      const after = await this.#metadata(url, signal);
      if (JSON.stringify(before) !== JSON.stringify(after)) throw fail();
      const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('');
      await this.validate();
      return {provider: 'webdav' as const, fileId, sourceVersion: before.version, sourceName: fileId.split('/').at(-1)!, sourceMimeType: before.type, contentType: before.type, exported: false, bytes, sha256};
    } catch {throw fail();}
  }
}
