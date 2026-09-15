import type {CalendarDraftContent,CalendarDraftExecution} from './calendar-draft';
/** Plain calendar outcome shared with human and agent clients. */
export type {CalendarDraftExecution} from './calendar-draft';
import type {DriveImportSnapshot,DriveImportSource,DriveImportReceipt} from "./drive-import.js";
import type { UIReadinessSample } from "./ui-readiness.js";
// This file defines the API that the AI Gadgets Workshop uses to talk to Adapters. Each Adapter
// provides connectivity to some external service which AI Gadgets can then manipulate. Each
// installation of the Gadgets Workshop may have access to different adapters, typically based on
// the set of internal services used at the particular company.
//
// For instance, there might be adapters for Google Workspace, GitHub, Jira, etc.
//
// Adapters provide access to resources. For instance, a Google Workspace adapter might provide
// access to Google Docs, Spreadsheets, Gmail mailboxes, etc. Each Google Doc, for example, is a
// separate "resource". Adapters are designed to provide object-oriented, capability-based access
// to such resources, enabling the Gadget Workshop to grant a particular Gadget fine-grained
// access to just the things the user wants that Gadget to access.
//
// Each adapter is deployed as a completely independent Workers application from the Gadgets
// Workshop itself, and is provided to the Workshop as a service binding. The Workshop communicates
// with the adapter over JavaScript RPC. The types in this file define that RPC interface. The
// `Adapter` type is the root interface implemented by the service binding.

import type { WorkerEntrypoint, DurableObject, RpcTarget, RpcStub } from "cloudflare:workers";
import type { NativeDocumentFormat } from "./native-document";

/**
 * A pagination cursor.
 *
 * This is an RPC object. Call `next()` repeatedly on the same cursor to fetch
 * subsequent batches of results. `next()` returns `null` once exhausted. Dispose the
 * cursor when finished.
 */
export interface Cursor<T> {
  next(): Promise<T[] | null>;
}

// A small image used to identify a vendor, account, or resource type in the UI.
export type AvatarImage = {
  url: string;
}

// Describes a connected GatekeeperVendor, for display purposes.
export type VendorDescription = {
  // Human-readable name of the service, e.g. "Google", "GitHub", etc.
  displayName: string;

  // URL of the service's home page.
  url: string;

  // Logo for the service.
  logo?: AvatarImage;

  // Background color used behind the logo in connector UI.
  color?: string;

  // Short tagline shown beneath the name on cards on the Connectors page.
  // E.g., "Draft replies, edit docs, and analyze data"
  tagline?: string;

  // 2-3 sentence description of what this Gatekeeper does and enables users to build.
  // This is shown in detail modals on the Connectors page.
  // E.g. "Connect your Google account to give Gadgets access to Gmail, Google Docs, and BigQuery.
  // Build agents that triage email, draft and edit documents, or run analytics queries on your data."
  description?: string;

  // True if this vendor can authenticate a user for sign-in: i.e. its connect flow yields a
  // provider-verified email (via GatekeeperUser.getAuthenticatedEmail()). The Workshop may offer
  // such a vendor as a login method, subject to its own auth allowlist. Defaults to false.
  providesAuth?: boolean;

  // If set, this vendor can mint a connected account with no OAuth flow (see
  // GatekeeperVendor.createAccount) and recommends the Workshop auto-provision one account per user.
  // The account — not the vendor — declares whether it provides an agent singleton and/or a
  // management UI (see AccountDescription.singleton / .providesUi).
  autoProvisionsAccount?: boolean;

  /** Offers a human account management UI even without grantable agent resources.
   * Keeps the vendor discoverable for explicit account connection; grants no account,
   * singleton, or resource authority. The connected account must still declare providesUi. */
  providesAccountUi?: boolean;
}

// Per-open context the Workshop passes to GatekeeperUser.startAppUi(). `isAdmin` is supplied fresh
// each time rather than baked into the account, since a user's admin status can change over time.
export type AppUiContext = {
  isAdmin: boolean;
}

// The agent catalog is bounded discovery metadata a gatekeeper exposes via
// Gatekeeper.getAgentCatalog() so the agent can see *what* is reachable through a session (e.g. the
// titles of the Context Library collections it can search) without first reading everything. It is
// shown to the agent as untrusted data, so entries carry no authority and are size-capped.

// One discoverable item within a gatekeeper's session.
export type AgentCatalogEntry = {
  // Opaque, gatekeeper-defined identifier the agent passes back to the session to act on this item.
  id: string;
  // Short human/agent-readable label (e.g. a collection name).
  title: string;
  // One-line description of what the item is, to help the agent decide if it's relevant.
  description: string;
};

// The discovery metadata returned for one gatekeeper session.
export type AgentCatalog = {
  // The discoverable items, already truncated to the requested/maximum count.
  entries: AgentCatalogEntry[];
  // True if entries were dropped to fit the limit, so the agent knows the list is partial.
  truncated?: boolean;
};

// Parameters the Workshop passes when requesting a catalog.
export type AgentCatalogRequest = {
  // Maximum number of entries to return. The gatekeeper must also enforce AGENT_CATALOG_MAX_ENTRIES.
  limit: number;
};

// Hard caps the Workshop enforces on any catalog, regardless of what the gatekeeper returns, since
// the catalog is injected into the agent's context as untrusted data and must stay bounded.
export const AGENT_CATALOG_MAX_ENTRIES = 25;
export const AGENT_CATALOG_MAX_ID_LENGTH = 256;
export const AGENT_CATALOG_MAX_TITLE_LENGTH = 100;
export const AGENT_CATALOG_MAX_DESCRIPTION_LENGTH = 400;

// Helper for gatekeepers to produce a well-formed AgentCatalog: clamps the entry count to the
// smaller of the request's limit and AGENT_CATALOG_MAX_ENTRIES, truncates each field to its cap, and
// sets `truncated` when entries were dropped. Gatekeepers should call this rather than hand-rolling
// the limits.
export function boundAgentCatalog(
    entries: AgentCatalogEntry[], request: AgentCatalogRequest): AgentCatalog {
  let requestedLimit = Number.isFinite(request.limit) ? Math.max(0, Math.floor(request.limit)) : 0;
  let limit = Math.min(requestedLimit, AGENT_CATALOG_MAX_ENTRIES);
  return {
    entries: entries.slice(0, limit).map(entry => ({
      id: entry.id.slice(0, AGENT_CATALOG_MAX_ID_LENGTH),
      title: entry.title.slice(0, AGENT_CATALOG_MAX_TITLE_LENGTH),
      description: entry.description.slice(0, AGENT_CATALOG_MAX_DESCRIPTION_LENGTH),
    })),
    truncated: entries.length > limit,
  };
}

// Describes a connected user account on an external service, for display purposes.
export type AccountDescription = {
  /** Provider-reported source read failures; these are diagnostics, never access grants. */
  sourceErrors?: Array<"mail" | "calendar" | "drive">;
  /** Supports diagnostic activity delivery only after the user selects this account as the recipient. */
  receivesWorkspaceActivity?: boolean;
  // User's display name, e.g. "John Doe". This is a non-unique name that is human-readable.
  displayName?: string;

  // Unique, canonical name for this user account. Typically this is what the user would type into
  // the login form when logging in. This may an email address or a Unix-style username.
  uniqueName?: string;

  // User's avatar image.
  avatar: AvatarImage;

  // `urlPattern`s of the grantable resource types (those with `grantable`; see
  // `SupportedResource`) currently enabled on this account. Used to show which resources are
  // usable and which need an additional grant. If omitted, treat the account as having every
  // resource granted (legacy accounts, or gatekeepers with no grantable resource types).
  grantedResourceUrlPatterns?: string[];

  // If set, this account provides an agent singleton: a gatekeeper (see
  // GatekeeperUser.getSingletonGatekeeperClass) that the Workshop installs into the owner's gadgets
  // and whose session it auto-provides as an unnamed capsule. `tsType` names the session's interface
  // as returned by the gatekeeper's getTypeScriptTypes().
  singleton?: { tsType: string };

  // If set, this account has a full-page management UI (see GatekeeperUser.startAppUi). The Workshop
  // surfaces it as a nav entry / page using this title.
  providesUi?: { title: string; icon?: AvatarImage; sections?: GatekeeperUiSection[] };
}

// Describes metadata about a specific instance of a resource. Returned by Gatekeeper.describe().
export type ResourceDescription = {
  // The resource's canonical URL. This can differ from the one passed to `newGatekeeper()`, if the
  // resource has more than one possible URL. Visiting this URL in a browser should actually open
  // the resource's natural UI.
  url: string;

  // Metadata for display.
  title: string;
  snippet: string;

  // TODO: Other display metadata? Thumbnail, icon, etc?

  // When the binding is first created, it will be given this name (but the user can change it).
  // This is just a convenience so that the user doesn't have to type their own name, although
  // they are free to rename it.
  //
  // This name should usually be based on the binding's type, not the specific resource title,
  // since the coding agent will be able to see the name and the user may or may not intend to
  // reveal the resource title to the agent, or may intend the same Gadget to be connected to
  // different resources (of the same type) at different times.
  suggestedBindingName: string;

  // TODO: Metadata about whether the gatekeeper itself has sufficient authorization to interact
  //   with this resource, and what the user should do if it doesn't. E.g. if the user's OAuth
  //   grant doesn't cover the necessary scopes, this could direct the user to expand their grant.

  // TypeScript type name. Must be the name of one of the exports returned by this gatekeeper's
  // `getTypeScriptTypes()` method.
  tsType: string;

  // Indicates that getSlashCommandProvider() is available.
  hasSlashCommands?: true;

  // Some resources implement the ability for the client to subscribe to events. The application
  // implements a "hook", which is a WorkerEntrypoint that implements the TypeScript interface
  // named by `hookTsType` (which must be one of the exports from `getTypescriptTypes()`).
  hookTsType?: string;
}

// Describes a kind of resource that a vendor can provide access to (e.g. "Jira Issue", "Gmail
// Mailbox") rather than a specific instance.
export type SupportedResource = {
  // URLPattern string for matching URLs, e.g. "https://jira.cfdata.org/*"
  urlPattern: string;

  // Human-readable title for this resource type, e.g. "Jira Issue"
  title: string;

  // Short description of what this resource provides.
  description: string;

  // Optional icon for display in Workshop UI.
  icon?: AvatarImage;

  // If true, this resource type is independently grantable. The user can enable or disable it at
  // account-connection time, and the Workshop will request only the underlying authorization (e.g.
  // OAuth scopes) needed for the resource types they enable.
  //
  // If omitted/false, the resource type is not separately grantable.
  grantable?: boolean;

  /** Declares this resource type as the account's inbound side for host-transferred sources of one
   * kind. The Workshop hands mail, calendar or drive sources from other accounts only to an account
   * declaring the matching kind (see GatekeeperUser.acceptMailReadSource, acceptCalendarReadSource,
   * captureDriveImport and their registration and draft counterparts), issues the human draft
   * sender or creator to that account's management UI, and checks admin policy against this
   * urlPattern when the account lists or transfers its own mailboxes, calendars or files. The
   * Workshop names no vendor: whichever account declares a kind is its receiver. Declare at most
   * one resource per kind: when several resources declare the same kind, the last one listed wins. */
  receives?: 'mail' | 'calendar' | 'drive';
}

/** Removes every trailing slash from a string in linear time. */
export function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) --end;
  return end === value.length ? value : value.slice(0, end);
}

// Tests whether a resource URL matches a SupportedResource `urlPattern` (a URLPattern string).
//
// This is deliberately tolerant of trivial URL variations that a strict URLPattern test would
// reject but that humans and LLMs routinely produce — most importantly a trailing slash, since
// URLPattern treats "/owner/repo" and "/owner/repo/" as different paths. Without this, an agent
// asking to connect "https://github.com/owner/repo/" would match no resource and the accept modal
// would open with nothing pre-selected.
//
// Callers are responsible for handling the whole-instance catch-all ("https://*") separately
// (e.g. as a fallback) — this function does not special-case it.
//
// Returns false if URLPattern is unavailable in the current runtime or the pattern is invalid.
export function matchesResourceUrlPattern(pattern: string, url: string): boolean {
  const URLPatternCtor = (globalThis as { URLPattern?: new (p: string) => { test(u: string): boolean } }).URLPattern;
  if (!URLPatternCtor) return false;
  let compiled: { test(u: string): boolean };
  try {
    compiled = new URLPatternCtor(pattern);
  } catch {
    return false;
  }
  // Try the URL as given plus the trailing-slash-toggled variant, since URLPattern distinguishes
  // them and we don't know which form the pattern expects.
  const candidates = url.endsWith('/') ? [url, stripTrailingSlashes(url)] : [url, url + '/'];
  return candidates.some(candidate => {
    try {
      return compiled.test(candidate);
    } catch {
      return false;
    }
  });
}

export type ResolveRequestedResourceResult =
  | { ok: true; resource: SupportedResource }
  | { ok: false; reason: string };

// Determines which SupportedResource an agent connection request would pre-select in the accept
// modal, using the exact same precedence the modal uses:
//   1. the resource whose urlPattern matches `resourceUrl` (ignoring the catch-all), else
//   2. the whole-instance catch-all ("https://*") if the vendor offers one, else
//   3. the sole resource, if the vendor offers exactly one.
//
// If none of those apply, the modal would open with nothing pre-selected (a bare "create new
// connection" screen). Rather than let that happen, this returns { ok: false } with a
// human-readable `reason` the backend surfaces to the agent so it can correct the request (e.g.
// supply a resourceUrl matching one of the listed patterns) and retry.
//
// This is the single source of truth shared by the backend (which enforces it at request time)
// and the frontend (which pre-seeds from the resolved resource), so the two cannot diverge.
export function resolveRequestedResource(
    supportedResources: SupportedResource[],
    resourceUrl: string | undefined): ResolveRequestedResourceResult {
  if (resourceUrl) {
    const matched = supportedResources.find(
      r => r.urlPattern !== 'https://*' && matchesResourceUrlPattern(r.urlPattern, resourceUrl));
    if (matched) return { ok: true, resource: matched };
  }
  const catchAll = supportedResources.find(r => r.urlPattern === 'https://*');
  if (catchAll) return { ok: true, resource: catchAll };
  if (supportedResources.length === 1) return { ok: true, resource: supportedResources[0] };

  const available = supportedResources.length > 0
    ? supportedResources.map(r => `  * ${r.title} — urlPattern: ${r.urlPattern}`).join('\n')
    : '  (this vendor offers no connectable resources)';
  const lead = resourceUrl
    ? `resourceUrl "${resourceUrl}" does not match any resource type this vendor offers, ` +
      `and the vendor has no whole-instance ("https://*") option.`
    : `this vendor offers multiple resource types and has no whole-instance ("https://*") ` +
      `option, so a resourceUrl is required to identify which one.`;
  return {
    ok: false,
    reason: `${lead} Call listConnectableResources to see the patterns, then retry with a ` +
      `resourceUrl matching one of:\n${available}`,
  };
}

// RPC interface exposed by the resource selection/configuration iframe to Workshop.
export interface ResourceConfiguratorIframe extends RpcTarget {
  // Return the resource URL chosen by iframe. Workshop calls this when user selects
  // `Add connection`.
  collectResourceUrl(): Promise<string>;

  // Tell the iframe where it sits in parent viewport. This is used by some configuration UIs
  // to determine height of dropdowns.
  //
  // `iframeTop` is the iframe's top edge in the parent viewport.
  // `viewportHeight` is the visible height of the parent window.
  updateViewport(iframeTop: number, viewportHeight: number): void;

  // Tell the iframe that the parent window was resized. This is used by some configuration UIs
  // to close open autocomplete dropdowns.
  windowResized(): void;
}

// RPC interface exposed by Workshop to the selection/configuration iframe.
export interface ResourceConfiguratorHost extends RpcTarget {
  gatekeeper: RpcStub<RpcTarget>;

  // The concrete resource URL the configurator should pre-fill to (e.g. supplied by an AI agent's
  // connection request), together with this resource's urlPattern, or null for a fresh/manual
  // configuration. The iframe runtime uses this to seed the form's initial values so it opens
  // pre-filled and editable.
  getInitialResource(): Promise<{ resourceUrl: string; resourceUrlPattern: string } | null>;

  // Update the parent's iframe sizing to match content in selection/configuration UI.
  // This lets iframe behave like part of the modal while still rendering floating UI naturally.
  //
  // `layoutHeight` is the height reserved for the configuration UI in the connections modal.
  // `height` is the full iframe height, which may be larger when floating UI like autocomplete
  // dropdowns need to render over the modal footer without pushing layout down.
  resize(height: number, layoutHeight: number): void;

  // Tell Workshop whether the current selection is ready to submit.
  // Workshop uses this to determine whether `Add connection` button should be enabled/disabled.
  setSelectionReady(ready: boolean): void;

  // Forward scroll gestures from iframe to parent.
  // Otherwise, when the cursor is over the configuration UI, scroll gestures are swallowed by the iframe
  // when user expects the connections modal to scroll.
  forwardScroll(deltaX: number, deltaY: number): void;
}

// A self-contained sandboxed UI served by a gatekeeper: complete HTML hosted in a
// sandbox="allow-scripts" iframe, plus an arbitrary gatekeeper-defined capability exposed to the
// iframe over a MessagePort RPC session. Used both for the small resource-configurator form
// (startResourceConfigurator, hosted in the connect modal) and for full-page gatekeeper management
// apps (startAppUi, e.g. the Context Library file manager, hosted on its own Workshop page).
/** A service-issued ticket for one direct browser-to-storage text upload. */
export interface GatekeeperUploadTicket {
  /** Receipt to pass to the service's separate save operation. */
  upload_id: string;
  /** Signed storage destination; never provided by the sandboxed app. */
  url: string;
  /** Must be PUT. */
  method: string;
  /** Must be x-amz-checksum-sha256. */
  checksum_header: string;
  /** Base64 SHA-256 of the exact uploaded UTF-8 bytes. */
  checksum_value: string;
  /** Exact uploaded byte count. */
  content_length: number;
}

/** Host-only capability; the service authenticates and authorizes each scope. */
export interface GatekeeperTextUploadIssuer extends RpcTarget {
  /** Issue a ticket for at most 256 KiB, with the host-computed size and checksum. */
  issue(scope: string, size: number, checksum: string): Promise<GatekeeperUploadTicket>;
}

/** Приём файлов организации до выбора проекта; доступен только доверенному хосту. */
export interface GatekeeperTemplateVersion {
  template_id: string; revision: number; title: string; purpose: string; project_id: string;
}
export interface GatekeeperBlueprintTemplateCreator extends RpcTarget {
  state(): Promise<{upload: string; project: string; title: string; purpose: string; version: GatekeeperTemplateVersion | null}>;
  propose(scope: string, scopeRevision: number): Promise<{proposal_id: string; target_scope_id: string}>;
  issue(size: number, checksum: string): Promise<GatekeeperUploadTicket>;
  checkpoint(upload: string): Promise<void>;
  save(): Promise<GatekeeperTemplateVersion>;
}
/** Настройки области общего применения шаблонов. */
export interface GatekeeperTemplateScopeConfig {
  /** Место в иерархии. */
  level: 'organization' | 'department' | 'group';
  /** Непосредственный родитель; пусто у организации. */
  parent_id: string;
  /** Существующая группа читателей; пусто у организации. */
  reader_group_id: string;
  /** Название для пользователей. */
  name: string;
  /** Применяется ли область. */
  enabled: boolean;
  /** Согласующие — пользователи организации. */
  approvers: string[];
}
export interface GatekeeperBlueprintTemplates extends RpcTarget {
  /** Читает доступные для управления уровни и разрешённые администратору справочники. */
  configuration(): Promise<{scopes: (GatekeeperTemplateScopeConfig & {scope_id:string;revision:number})[]; people:{id:string;name:string}[]; groups:{id:string;name:string}[]}>;
  /** Сохраняет область с проверкой текущей ревизии и полномочий на сервере. */
  configure(id: string, expected: number, config: GatekeeperTemplateScopeConfig): Promise<GatekeeperTemplateScopeConfig & {scope_id:string;revision:number}>;

  /** Предлагает выбранную общую версию непосредственному родительскому уровню с отдельным согласованием. */
  promote(scope: string, template: string, revision: number, message: string, operation: string): Promise<{proposal: {proposal_id: string; target_scope_id: string}}>;

  /** Утверждённые версии выбранного уровня; возвращается курсор следующей страницы. */
  templates(scope: string, cursor?: string): Promise<{templates: {scope_id: string; template_key: string; revision: number; source: {title: string; purpose: string; content_type: string}}[]; next_cursor?: string}>;
  /** Создаёт личную копию утверждённой версии в выбранном проекте. Повтор использует тот же идентификатор операции. */
  apply(scope: string, template: string, revision: number, project: string, name: string, operation: string): Promise<{ticket: GatekeeperDownloadTicket; node: string; head: string}>;
  /** Повторно проверяет чтение копии после загрузки её содержимого. */
  validateApplication(project: string, node: string, head: string): Promise<void>;

  scopes(cursor?: string): Promise<{scopes: {scope_id: string; revision: number; level: "organization" | "department" | "group"; parent_id: string; name: string; enabled: boolean}[]; next_cursor?: string}>;
  projects(): Promise<{projects: {id: string; name: string}[]}>;
  latest(blueprint:string): Promise<GatekeeperTemplateVersion|null>;
  prepare(project: string, title: string, purpose: string, previous?: {template_id:string;revision:number}, blueprint?:string): Promise<{id: string; creator: RpcStub<GatekeeperBlueprintTemplateCreator>}>;
  resume(id: string): Promise<RpcStub<GatekeeperBlueprintTemplateCreator>>;
}

export interface GatekeeperInboxUploadIssuer extends RpcTarget {
  /** Выдать билет после проверки полномочия, размера, квоты и контрольной суммы. */
  issue(size: number, checksum: string, project?: string): Promise<GatekeeperUploadTicket>;
  /** Передать метаданные приёмной сразу после загрузки и освободить квоту билетов. */
  submit(uploadId: string, sourcePath: string, modifiedAt: number, project?: string): Promise<{ outcome: string; enqueued: boolean; placement_state?: string }>;
}

/** Integrity metadata for one service-authorized text download. */
export interface GatekeeperDownloadTicket {
  /** Signed HTTPS storage URL retained by the host. */
  url: string;
  /** Must be GET. */
  method: string;
  /** Exact byte count; the consuming host enforces its format-specific limit. */
  size_bytes: number;
  /** SHA-256 of the complete body, in lowercase hexadecimal. */
  sha256_hex: string;
}

/** Host-only access to a specific resource version and conflict side. */
export interface GatekeeperTextDownloadIssuer extends RpcTarget {
  /** Authorize and issue a ticket for the requested version and side. */
  issue(scope: string, resource: string, version: string, side: number): Promise<GatekeeperDownloadTicket>;
  /** Recheck live access and version after transfer, before revealing the text. */
  validate(scope: string, resource: string, version: string): Promise<void>;
}

/** Host-only downloads of immutable document sides in an approval review. */
export interface GatekeeperReviewDownloadIssuer extends RpcTarget {
  /** Issue a file ticket, or null when the requested side is absent. */
  issue(review: string, node: string, version: number, side: "before" | "after"): Promise<GatekeeperDownloadTicket | null>;
  /** Recheck participation, document access and decision version after transfer. */
  validate(review: string, node: string, version: number): Promise<void>;
}

/** Host-only access to one immutable native document publication. */
export interface GatekeeperNativeDocumentDownload extends RpcTarget {
  /** Authorize a signed download; includes the service's declared content type. */
  issue(): Promise<GatekeeperDownloadTicket & { content_type: string }>;
  /** Recheck current access before the host reveals downloaded content. */
  validate(): Promise<void>;
}

/** Human-side selector; selected capabilities cannot switch documents or versions. */
export interface GatekeeperNativeDocumentSelector extends RpcTarget {
  /** Bind a native approval preview to one immutable review side and decision version. */
  selectReview(review: string, resource: string, version: number, side: 'before' | 'after', format: NativeDocumentFormat): Promise<RpcStub<GatekeeperNativeReviewDownload>>;
  /** List readable service scopes from this connected account. */
  scopes(): Promise<{ scopes: { id: string; name: string }[] }>;
  /** List non-directory documents in the selected scope, preserving pagination. */
  documents(scope: string, cursor: string): Promise<{ documents: { id: string; name: string;
    /** Current shared deletion state, omitted when unknown or for a private-only choice. */
    sharedDeleted?: boolean }[]; nextCursor: string; truncated: boolean }>;
  /** List native publications and the server's canonical resource URL, without downloading content. */
  publications(scope: string, resource: string, cursor: string): Promise<{
    /** True when older private snapshots exceed the bounded ancestry walk. */
    historyLimited?: boolean;
    /** Present only when the first history page establishes the current shared deletion state. */
    sharedDeleted?: boolean;
    /** Canonical document identity to pass to the Workshop's source registration. */
    resourceUrl: string;
    /** Immutable, non-deleted native versions available to this account. */
    publications: { id: string; recordedAt: string; actor: string;
      /** Verified human owner when the publication actor is an agent; absent for older services. */
      onBehalfOf?: string;
      /** Recorder of this project snapshot, not the last edit of every document. */
      recordedBy?: {
        /** Authenticated actor that recorded the snapshot. */
        actor: string;
        /** Human owner when the recorder was an agent. */
        onBehalfOf: string;
      };
      format: NativeDocumentFormat }[];
    /** Cursor for the next history page; empty means the end. */
    nextCursor: string;
  }>;

  /** Authorize one publication within the selected service scope and resource. */
  select(scope: string, resource: string, publication: string): Promise<RpcStub<GatekeeperNativeDocumentDownload>>;
}

/** Immutable location belonging to a reviewed document revision. */
export interface GatekeeperNativeReviewMetadata {
  /** Immutable filename on this reviewed side. */
  name: string;
  /** Immutable parent identifier; empty is the project root. */
  parent_id: string;
}

/** A download bound to one side of the reviewed proposal. */
export interface GatekeeperNativeReviewDownload extends RpcTarget {
  /** Authorize the selected side and issue a ticket, or return null for an absent side. */
  issue(): Promise<(GatekeeperDownloadTicket & { content_type: string;
    /** Immutable location on this side, omitted for legacy documents. */
    metadata?: GatekeeperNativeReviewMetadata }) | null>;
  /** Recheck live access and the decision version before revealing content or absence. */
  validate(): Promise<void>;
}

/** Human-side saving of one native document in a personal draft. */
export interface GatekeeperNativeDocumentWriter extends RpcTarget {
  /** Return the selected existing head or the frozen base of a new document. */
  head(): Promise<string>;
  /** Prepare an upload of at most 4 MiB against the displayed draft head. */
  issue(expectedHead: string, size: number, checksum: string): Promise<GatekeeperUploadTicket>;
  /** Save this document only; a new-document retry returns its first result. Never publishes. */
  save(expectedHead: string, uploadId: string): Promise<string>;
}

/** A new-document writer whose frozen request can survive a browser reload. */
export interface GatekeeperNativeDocumentCreator extends GatekeeperNativeDocumentWriter {
  /** Freeze an issued upload and return an account-bound receipt before attempting creation. */
  checkpoint(expectedHead: string, uploadId: string): Promise<string>;
  /** Return the frozen base and upload of a recovered creation. */
  recoveryState(): Promise<{ head: string; uploadId: string }>;
}

/** Frozen office update, authorized again whenever save is retried. */
export interface GatekeeperOfficeUpdateWriter extends GatekeeperNativeDocumentWriter {
  /** Freeze the issued upload and return an account-bound update receipt. */
  checkpoint(expectedHead:string,uploadId:string):Promise<string>;
  /** Recover the original target head and upload without creating a new request. */
  recoveryState():Promise<{head:string;uploadId:string}>;
}
/** Immutable comparison displayed before an update decision. */
export interface GatekeeperOfficeUpdateSummary {
  /** Current target head to which the decision applies. */
  head:string;
  /** Whether the selected source changes the copy or conflicts with local edits. */
  outcome:'source_unchanged'|'already_current'|'update_available'|'conflict';
  /** Checksum of the current native copy. */
  currentSHA256:string;
  /** Checksum of the captured incoming archive. */
  sourceSHA256:string;
  /** Checksum of the exact converted incoming bytes. */
  outputSHA256:string;
  /** Conversion properties requiring explicit acceptance. */
  unsupported:string[];
}
/** Human-side review bound to one target and captured source. */
export interface GatekeeperOfficeUpdateReview extends RpcTarget {
  /** Recheck the frozen target and source before revealing the comparison. */
  describe():Promise<GatekeeperOfficeUpdateSummary>;
  /** Download the converted incoming version through live access checks. */
  preview():Promise<RpcStub<GatekeeperNativeDocumentDownload>>;
  /** Freeze the reviewed update, with separate acceptance of losses and replacement. */
  prepare(acceptUnsupported:boolean,replaceLocal:boolean):Promise<RpcStub<GatekeeperOfficeUpdateWriter>>;
}

/** Human-only conflict selection bound to one document and immutable personal head. */
export interface GatekeeperNativeConflict extends RpcTarget {
  /** Recheck access and list the exact sides; indices retain base/positive ordering. */
  describe(): Promise<{ head: string; terms: { present: boolean; negative: boolean; metadata?: { name: string; parent_id: string; content_type: string } }[] }>;
  /** Issue a checked side download; null explicitly denotes deletion. */
  download(termIndex: number): Promise<GatekeeperDownloadTicket | null>;
  /** Recheck the same document/head and current access after a download. */
  validate(): Promise<void>;
  /** Choose one positive side at the frozen head; never publish or retry at a newer head. */
  resolve(termIndex: number): Promise<{ head: string }>;
}

/** Human-only picker for saving a native editor into a new or existing document. */
export interface GatekeeperNativeDocumentWriteSelector extends RpcTarget {
  /** Bind an update comparison to the current copy and a captured archive/hash. */
  reviewOfficeUpdate(scope:string,target:string,source:string,format:NativeDocumentFormat,sourceHead:string,sourceSHA256:string):Promise<RpcStub<GatekeeperOfficeUpdateReview>>;
  /** Restore the same update request through a freshly authorized account session. */
  resumeOfficeUpdate(receipt:string,format:NativeDocumentFormat):Promise<RpcStub<GatekeeperOfficeUpdateWriter>>;

  /** Download the retained original of an imported copy, requiring access to both versions; null means no recorded original. */
  originalOffice(scope: string, resource: string, expectedHead: string): Promise<RpcStub<GatekeeperNativeDocumentDownload> | null>;
  /** Convert a stored personal original; retain source/head and report unsupported properties before creation. */
  previewOffice(scope: string, resource: string, format: NativeDocumentFormat, source?: {
    /** Exact captured personal head, read independently of the current creation head. */
    head: string;
    /** SHA-256 of the captured original bytes. */
    sha256: string;
  }): Promise<{ previewId: string; head: string; unsupported: string[];
    /** Immutable source version and checksum returned by the server conversion. */
    source: { head: string; sha256: string };
    download: RpcStub<GatekeeperNativeDocumentDownload> }>;
  /** Freeze a separate native copy from server-verified preview bytes, with explicit acceptance of conversion losses. */
  createOffice(scope: string, name: string, format: NativeDocumentFormat, expectedHead: string, previewId: string, acceptUnsupported: boolean): Promise<RpcStub<GatekeeperNativeDocumentCreator>>;
  /** Export a pinned personal version to DOCX/XLSX/PPTX; the returned download rechecks access. */
  exportOffice(scope: string, resource: string, expectedHead: string, format: NativeDocumentFormat): Promise<RpcStub<GatekeeperNativeDocumentDownload>>;
  /** Read the exact name/folder of an unconflicted native document with versioned metadata. */
  documentLocation(scope: string, resource: string, format: NativeDocumentFormat): Promise<{ head: string; name: string; parent: string }>;
  /** Save name/folder at the selected head with current source/destination rights; never publish or retry. */
  saveLocation(scope: string, resource: string, expectedHead: string, name: string, parent: string, format: NativeDocumentFormat): Promise<{ head: string }>;
  /** Page through currently visible destination folders; visibility does not grant write authority. */
  folders(scope: string, cursor: string): Promise<{ folders: { id: string; name: string; parent: string }[]; nextCursor: string }>;
  /** Select an existing native conflict without lending authority to gadget code. */
  selectConflict(scope: string, resource: string, format: NativeDocumentFormat): Promise<RpcStub<GatekeeperNativeConflict>>;
  /** Current human identity for displaying which decisions they may record. */
  reviewerIdentity(): Promise<string>;
  /** List proposals visible to the current human, preserving server pagination. */
  reviewInbox(cursor: string): Promise<{ reviews: import('./publication-review').PublicationReview[]; next_cursor: string }>;
  /** Record one explicit domain decision against its displayed version; server rights remain authoritative. */
  decideReview(id: string, domain: string, version: number, approved: boolean): Promise<void>;
  /** Merge the current shared project into the exact personal head; preserve conflicts and never publish or retry. */
  updateDraft(scope: string, expectedHead: string): Promise<{ head: string }>;
  /** Read current heads without creating or publishing a draft. */
  publicationState(scope: string): Promise<{ personal_head: string; shared_head: string; personal_exists: boolean }>;
  /** Delete one existing resolved native document at the explicitly confirmed personal head; never publish or retry. */
  deleteDocument(scope: string, resource: string, expectedHead: string, format: NativeDocumentFormat): Promise<{ head: string }>;
  /** Inspect the exact personal target before explicitly choosing content replacement or deleted-document restoration. */
  restorationState(scope: string, resource: string, format: NativeDocumentFormat): Promise<{ head: string; deleted: boolean }>;
  /** Restore one published document's content into the exact personal head; never publish or retry with a newer head. */
  restorePublication(scope: string, resource: string, publication: string, expectedHead: string, format: NativeDocumentFormat, deleted?: boolean): Promise<{ head: string }>;
  /** Submit all saved project changes at the displayed immutable heads. */
  requestReview(scope: string, personalHead: string, sharedHead: string): Promise<{ candidate_id: string }>;
  /** Read an authorized proposal, including current required decisions. */
  review(id: string): Promise<import('./publication-review').PublicationReview>;
  /** Publish only this author's ready proposal at its exact heads; the service rechecks authorization atomically. */
  /** Withdraw an unpublished review on the server; only its human author may cancel it. */
  withdrawReview(id: string): Promise<void>;
  publishReview(scope: string, id: string): Promise<{ personal_head: string; shared_head: string; published: boolean; conflicted: boolean }>;
  /** List service scopes currently accessible to this account. */
  scopes(): Promise<{ scopes: { id: string; name: string }[] }>;
  /** List document choices, with an explicit cursor and truncation indication. */
  documents(scope: string, cursor: string): Promise<{ documents: { id: string; name: string;
    /** Current shared deletion state, omitted when unknown or for a private-only choice. */
    sharedDeleted?: boolean }[]; nextCursor: string; truncated: boolean }>;
  /** List invitation choices and current modes for an owned private document at this head. */
  participants(scope: string, resource: string, head: string, cursor: string): Promise<{ head: string; nextCursor: string; participants: { id: string; name: string; mode: '' | 'read' | 'write'; canRead: boolean; canWrite: boolean }[] }>;
  /** Change one invitation using the displayed mode; current ownership, folder rights and head are rechecked. */
  setParticipant(scope: string, resource: string, head: string, participant: string, expected: '' | 'read' | 'write', mode: '' | 'read' | 'write'): Promise<void>;
  /** Open the user's personal draft and bind editing to one document and format. */
  select(scope: string, resource: string, format: NativeDocumentFormat): Promise<RpcStub<GatekeeperNativeDocumentWriter>>;
  /** Bind one creation in the scope root; retries through this writer retain the operation identity. */
  create(scope: string, name: string, format: NativeDocumentFormat): Promise<RpcStub<GatekeeperNativeDocumentCreator>>;
  /** Restore the exact creation request from this account's receipt; saving rechecks current rights. */
  resumeCreation(receipt: string, format: NativeDocumentFormat): Promise<RpcStub<GatekeeperNativeDocumentCreator>>;
}

/** A human-only, account-bound authorization flow for an external agent. */
export interface GatekeeperAgentConsent extends RpcTarget {
  /** Preview the opaque request; the returned selection is single-use in this session. */
  preview(request: string): Promise<{
    /** Opaque session-bound selection, never a credential. */
    selection: string;
    /** Authenticated account identity shown before consent. */
    account: string;
    /** Registered client requesting access. */
    client_id: string;
    /** Requested resource audience. */
    resource: string;
    /** Exact requested scopes. */
    scopes: string[];
    /** Server expiry in ISO 8601 format. */
    expires_at: string;
  }>;
  /** Decide only the previously displayed request, using the account's current authority. */
  decide(selection: string, approved: boolean): Promise<{
    /** Registered callback with saved state and code or denial; never log or persist it. */
    redirect_uri: string;
  }>;
}

/** Account-bound execution available only to the human mail review screen. */
export interface GatekeeperMailDraftSender extends WorkerEntrypoint {
  /** Submit the exact approved draft; no account or content can be substituted. */
  send(id:string,sha256:string):ReturnType<NonNullable<GatekeeperUser['sendMailDraft']>>;
}

/** Host-issued creator bound to the Mnemos account of the human screen. */
export interface GatekeeperCalendarDraftCreator extends WorkerEntrypoint {
  /** Create one exact approved meeting; the caller cannot change its account or content. */
  create(id:string,sha256:string):Promise<CalendarDraftExecution>;
}

/** Complete HTML and the capabilities for a sandboxed gatekeeper screen. */
export type GatekeeperUiFrame = {
  /** Optional organization summary, retained by the human host and never given to gadgets. */
  organizationMetrics?: RpcStub<import("./organization-metrics").OrganizationMetricsReader>;
  /** Host-issued creator retained by the human review screen. */
  calendarDraftCreator?:Fetcher<GatekeeperCalendarDraftCreator>;
  /** Host-issued sender bound to this Mnemos account; never supplied to agents. */
  mailDraftSender?:Fetcher<GatekeeperMailDraftSender>;
  /** Optional human authorization capability retained by the trusted host, never forwarded to gadgets. */
  agentConsent?: RpcStub<GatekeeperAgentConsent>;
  // Complete HTML for the UI. Workshop hosts it in a sandboxed iframe.
  iframeHtml: string;

  // Capability exposed to the iframe for any RPCs needed by the UI.
  ui: RpcStub<RpcTarget>;

  /** Optional native personal-draft editing, retained by the trusted human host. */
  nativeWrites?: {
    /** Exact trusted HTTPS storage origin. */
    storageOrigin: string;
    /** Authenticated picker; never injected into gadget or agent code. */
    selector: RpcStub<GatekeeperNativeDocumentWriteSelector>;
  };

  /** Optional native document transfers, retained only by the human UI host. */
  nativeDownloads?: {
    /** Exact trusted HTTPS storage origin. */
    storageOrigin: string;
    /** Authenticated selector; never forwarded to the sandboxed UI. */
    selector: RpcStub<GatekeeperNativeDocumentSelector>;
  };

  /** Optional direct comparison downloads, retained only by the human UI host. */
  reviewDownloads?: {
    /** Exact trusted HTTPS storage origin. */
    storageOrigin: string;
    /** Authenticated issuer; never exposed through the iframe's ui object. */
    issuer: RpcStub<GatekeeperReviewDownloadIssuer>;
  };

  /** Optional direct text reading, retained by the management-app host only. */
  textDownloads?: {
    /** Exact HTTPS storage origin from deployment configuration. */
    storageOrigin: string;
    /** Authenticated issuer; never forwarded through host.ui. */
    issuer: RpcStub<GatekeeperTextDownloadIssuer>;
  };

  /** Загрузка файлов организации по выбору человека без участия чата. */
  /** Версионирование кода Blueprint вместе с нативными данными документа. */
  blueprintTemplates?: { storageOrigin: string; selector: RpcStub<GatekeeperBlueprintTemplates> };
  inboxUploads?: {
    /** Разрешённый адрес хранилища из конфигурации установки. */
    storageOrigin: string;
    /** Проверяет полномочия при выдаче билета и передаче в приёмную. */
    issuer: RpcStub<GatekeeperInboxUploadIssuer>;
  };

  /** Optional direct text upload, retained by the management-app host only. */
  textUploads?: {
    /** Exact HTTPS storage origin from trusted deployment configuration. */
    storageOrigin: string;
    /** Authenticated issuer, never forwarded through host.ui to the iframe. */
    issuer: RpcStub<GatekeeperTextUploadIssuer>;
  };
}

// Legacy alias for GatekeeperUiFrame: the established return type of startResourceConfigurator,
// referenced by every gatekeeper implementation. Kept to avoid a repo-wide rename.
export type ResourceConfiguratorFrame = GatekeeperUiFrame;

// The root interface of an Adapter, as provided to the Gadget Workshop.
//
// An installation of the Gadget Workshop is provided with a set of Adapters to allow it to
// interface with other services.
// Options for GatekeeperVendor.connectAccount(). `scopes` selects the access tier (see that
// method). `resourceUrlPatterns`, if given, limits the connection to the authorization needed for
// those grantable resource types; if omitted, authorization for all the vendor's resource types
// is requested.
export type GatekeeperConnectOptions = {
  scopes?: "auth" | "full";
  resourceUrlPatterns?: string[];
};

export interface GatekeeperVendor extends WorkerEntrypoint {
  // Get display info for the service, suitable for display to a user.
  describe(): Promise<VendorDescription>;

  // Start the auth flow to connect to the user's remote account. Returns the URL which the user
  // should open in their browser in order to complete the flow. This URL will be opened in a new
  // tab; when it completes, it should close itself using window.close().
  //
  // When the flow completes, `callback.complete()` should be called to add the connection to the
  // user's list of authorizations. (`callback` can be stored.)
  //
  // A typical implementation creates a UserAccount Durable Object to manage the authorization
  // flow, storing the callback in its storage, then directing the user to a URL that references
  // the DO. Once the user completes the flow, the DO invokes the callback. The DO should set an
  // alarm to delete itself after some timeout if the user fails to complete the flow.
  //
  // SECURITY: The returned URL must include a cryptographic nonce (in addition to the DO ID) to
  // prevent replay attacks. The nonce should be stored in the DO and verified when the user visits
  // the URL. See gatekeeper-google for a reference implementation.
  //
  // `options.scopes` selects how much access to request (default "full"):
  //   - "full": the gatekeeper's full capability scopes (repos, docs, etc.). The resulting
  //     connection is persisted as a usable connected account.
  //   - "auth": only the minimal scopes needed to verify the user's email for sign-in. The grant is
  //     transient — after `complete()` lets the caller read getAuthenticatedEmail(), the gatekeeper
  //     discards it. Vendors without `providesAuth` ignore this and always use their full scopes.
  //
  // `options.resourceUrlPatterns`, if given, limits the connection to the authorization needed for
  // those grantable resource types. If omitted, authorization for all of the vendor's resource
  // types is requested.
  connectAccount(callback: Fetcher<GatekeeperConnectCallback>,
                 options?: GatekeeperConnectOptions): Promise<{url: string}>;

  // Get the list of resource types this vendor supports. Each entry describes a category of
  // resource the vendor can provide access to, along with a URL pattern for matching.
  //
  // `options.userId` specifies the user ID (usually, email address) of the user who is driving the
  // query, which the gatekeeper can consider in deciding what resources are available. If it
  // returns an empty list, then the gatekeeper will be totally hidden from the user.
  //
  // TODO: Providing the user ID here is a temporary hack to enable a hidden internal gatekeeper.
  //   Later on we should come up with a better way to manage which users see which gatekeepers.
  //
  // TODO: How does the Gadget Workshop know when the supported URLs have changed, without polling?
  getSupportedResources(options?: {userId?: string}): Promise<SupportedResource[]>;

  // Returns TypeScript source code defining all types covering APIs defined by this Gatekeeper.
  // The returned string is the content of a `.d.ts` file. All types refereced by
  // `ResourceDescription` must be exported by this file. The types should ideally have complete
  // JSDoc comments describing them.
  //
  // The Gadgets system will parse this file to construct a type database, which will be made
  // available to the coding agent in a way that supports progressive discovery.
  //
  // TODO: Define exactly what global types and imports are available. I suppose capnweb should be
  // importable, but is anything else needed?
  // TODO: How does the Gadget Workshop know when the types have changed, without polling?
  // TODO: Should we somehow distinguish stable vs. unstable types? Unstable are safe to use in
  //   one-off situations only.
  getTypeScriptTypes(): Promise<string>;

  // Mint a NEW connected account, with no OAuth flow. Safe to expose on this public interface: it
  // only *creates* accounts — it cannot look up or return an existing account — and it takes no
  // arguments, so it carries no user identity. The Workshop persists the returned account (like an
  // OAuth-connected account) and treats it as the authority thereafter. Present only on vendors that
  // set VendorDescription.autoProvisionsAccount; callers gate on that flag rather than probing, since
  // RPC stubs cannot report optional-method presence.
  createAccount?(): Promise<Fetcher<GatekeeperUser>>;
}

export interface GatekeeperConnectCallback extends WorkerEntrypoint {
  // Indicates the connection completed successfully.
  //
  // `expiresAt`, if provided, indicates when the credentials are expected to stop being
  // refreshable. Do not pass the expiry of a short-lived access token if the gatekeeper can
  // refresh it transparently; that token-cache expiry is internal to the gatekeeper. This allows
  // the Workshop to proactively show the account as expired in the UI without waiting for an
  // operation to fail. If not provided, the system relies on the gatekeeper calling
  // `credentialsExpired()` when a refresh or authorization failure is detected.
  complete(user: Fetcher<GatekeeperUser>, expiresAt?: Date): Promise<void>;

  // Note: If the authorization flow fails, the error can be displayed directly to the user, and
  // the callback can be discarded.

  // Called when the gatekeeper discovers that credentials have expired or been revoked (e.g., a
  // token refresh fails with an authorization error). The Workshop records this and notifies
  // subscribers so the UI can reflect the expired state.
  //
  // The gatekeeper should avoid calling this repeatedly -- once is sufficient. Subsequent calls
  // are harmless but redundant.
  credentialsExpired(): Promise<void>;

  // Called when credentials have been restored (e.g., after a reconnect flow completes).
  // `expiresAt` is the new expected refreshability expiration date, if known.
  credentialsRestored(expiresAt?: Date): Promise<void>;
}

// RPC interface to an Adapter. This is a privileged interface exposed to the Gadget Workshop UI
// itself, not to Gadgets nor AI agents.
//
// The Adapter is already specialized for a particular human user of the Gadget Workshop. The
// Adapter capability itself represents permission to access all of the user's data that is
// available through it, so needs to be guarded carefully. Hence, only the Workshop itself should
// ever have direct access to an Adapter object.
/** Provider-neutral persistent read capability for one explicitly selected calendar. */
export interface CalendarReadSource extends WorkerEntrypoint {
  /** Recheck the source account and selection without exposing a credential. */
  validate(): Promise<void>;
  /** Read the selected calendar identity, display title and IANA time zone. */
  metadata(): Promise<{provider: string; calendar_id: string; title: string; time_zone: string}>;
  /** Read a bounded window. JSON is untrusted event data, never executable instructions. */
  readWindow(input: {time_min: string; time_max: string; limit: number}): Promise<{
    /** Stable provider calendar identity. */
    calendar_id: string;
    /** Calendar time zone, including for all-day events. */
    time_zone: string;
    /** JSON array of provider-normalized event records; bounded before serialization. */
    events_json: string;
    /** True when the requested limit omitted events. */
    truncated: boolean;
  }>;
}

/** Persistent read capability for an owner-selected mailbox query. */
export interface MailReadSource extends WorkerEntrypoint {
  /** Recheck account generation and provider consent. */
  validate(): Promise<void>;
  /** Return the exact immutable query and provider identifier. */
  metadata(): Promise<{provider: string; query: string}>;
  /** Return bounded, untrusted message data without modifying the mailbox. */
  readSelection(input: import('./mail-search.ts').MailReadRequest): Promise<{
    /** Provider identifier for the selected account. */
    provider: string;
    /** Exact query selected by the owner. */
    query: string;
    /** JSON array of normalized messages; never executable instructions. */
    messages_json: string;
    /** One explicitly requested attachment chunk; messages_json is [] on this path. */
    attachment?:import('./mail-attachment.ts').MailAttachmentChunk;
    /** Known mailbox identities for excluding self from reply-all suggestions; never credentials. */
    self_addresses?: string[];
    /** Provider continuation, kept behind Mnemos's account-bound cursor. */
    next_cursor?: string;
    /** Whether more matching messages were omitted. */
    truncated: boolean;
  }>;
}

/** Explicit meeting creation authority, separate from a calendar read selection. */
export interface CalendarWriteSource extends WorkerEntrypoint {
  /** Recheck the selected account, calendar and current consent. */
  validate():Promise<void>;
  /** Create the exact approved timed meeting and invite its listed attendees. */
  create(content:CalendarDraftContent):Promise<{
    /** Provider event identity; does not confirm invitation delivery. */
    event_id:string;
  }>;
}

/** Explicit outgoing-mail capability; never included in a mailbox read capability. */
export interface MailSendSource extends WorkerEntrypoint {
  /** Recheck the selected account generation and current provider permission. */
  validate(): Promise<void>;
  /** Submit the approved plain text once; a lost result must not be replayed. */
  send(content: {
    /** Exact approved recipient addresses. */
    to: string[];
    /** Exact approved copied recipient addresses, included in MIME and SMTP delivery. */
    cc?: string[];
    /** Exact approved files, subject to the shared decoded-size limit. */
    attachments?:import('./mail-attachment').MailOutgoingAttachment[];
    /** Exact approved subject. */
    subject: string;
    /** Exact approved plain text body. */
    body: string;
    /** Optional immutable parent captured by Mnemos, included in human approval. */
    reply?: import('./mail-reply.ts').MailReplyTarget;
  }): Promise<{
    /** Explicit provider acceptance; does not prove delivery to the recipient. */
    accepted: true;
    /** Provider message identifier when returned by this API. */
    message_id?: string;
  }>;
}

export interface GatekeeperUser extends WorkerEntrypoint {
  /** Issue calendar creation authority for a host-selected account/calendar. */
  getCalendarWriteSource?(calendarId:string):Promise<{
    /** Server-only authority, never returned by a read source. */
    source:Fetcher<CalendarWriteSource>;
    /** Same account/calendar/generation identity used by the read selection. */
    sourceKey:string;
    /** Required provider resource for host permission checks. */
    resource:SupportedResource;
  }>;
  /** Resolve the saved selection of an exact approved meeting proposal. */
  prepareCalendarDraftCreate?(id:string,sha256:string):Promise<{
    /** Saved host account and provider selection identity. */
    sourceKey:string;
    /** Selected provider calendar ID. */
    calendar_id:string;
  }>;
  /** Human execution through a separately selected calendar writer. */
  createCalendarDraft?(id:string,sha256:string,sourceKey:string,source:Fetcher<CalendarWriteSource>):Promise<CalendarDraftExecution>;

  /** Resolve the owned, approved proposal's saved mail selection for an explicit send. */
  prepareMailDraftSend?(id:string,sha256:string):Promise<{
    /** Host-owned source account and provider selection identity. */
    sourceKey:string;
    /** Original mailbox query, used to reproduce the provider selection identity. */
    query:string;
  }>;
  /** Execute one exact approved proposal using the separately selected sender. */
  sendMailDraft?(id:string,sha256:string,sourceKey:string,source:Fetcher<MailSendSource>):Promise<{
    /** Provider acceptance or an attempt with unknown outcome. */
    state:'attempted'|'accepted';
    /** Provider acceptance ID when known. */
    message_id?:string;
  }>;

  /** Host-only, explicit send factory for an existing account/query selection. */
  getMailSendSource?(query: string): Promise<{
    /** Outgoing authority retained only by trusted server code. */
    source: Fetcher<MailSendSource>;
    /** Same account/query/generation identity used by the read selection. */
    sourceKey: string;
    /** Provider resource required by host policy checks. */
    resource: SupportedResource;
  }>;

  /** List calendars for the connected account owner; no event content or credentials. */
  listCalendars?(): Promise<{
    /** Concrete calendar choices. */
    calendars: {
      /** Provider ID used when selecting a calendar. */
      id: string;
      /** Provider display name, rendered as text. */
      name: string;
    }[];
    /** More calendars exist beyond the bounded listing. */
    truncated: boolean;
  }>;

  /** List concrete folders for the account owner; empty parent selects the root. */
  listMailFolders?(parent: string): Promise<{
    /** Readable folder choices; no message bodies or credentials. */
    folders: {
      /** Provider folder ID used for the fixed mail selection. */
      id: string;
      /** Provider folder name, rendered as text. */
      name: string;
      /** Whether the owner may navigate into this folder. */
      hasChildren: boolean;
    }[];
    /** More folders exist beyond the bounded listing. */
    truncated: boolean;
  }>;

  /** Create a fixed-query read capability; only the trusted host receives it. */
  getMailReadSource?(query: string): Promise<{
    /** Server-only reading authority. */
    source: Fetcher<MailReadSource>;
    /** Account/query/generation identity, not an OAuth token. */
    sourceKey: string;
    /** Required provider resource for host permission checks. */
    resource: SupportedResource;
  }>;
  /** Persist a host-selected mail source under the current Mnemos owner. */
  acceptMailReadSource?(project: string, request: string, sourceKey: string, source: Fetcher<MailReadSource>): Promise<{
    /** Owner-bound preparation ID, not an authorization credential. */
    selection_id: string;
    /** Exact selected query for human review. */
    query: string;
  }>;

  /** List safe identifiers for this human's enabled WebDAV connections. */
  listDriveImportAccounts?(): Promise<Array<{
    /** Account-local connection identifier, not a credential. */
    id: string;
    /** Human-readable account label. */
    name: string;
  }>>;
  /** Select a fixed Drive file and account generation for a trusted host import. */
  getDriveImportSource?(fileId: string): Promise<{
    /** Read authority retained only on the server. */
    source: Fetcher<DriveImportSource>;
    /** Stable source/account generation identity, not a credential. */
    sourceKey: string;
    /** Resource category for current host policy checks. */
    resource: SupportedResource;
  }>;
  /** Receive a host-selected source into this human's personal branch, preserving request identity on retry. */
  captureDriveImport?(project: string, request: string, sourceKey: string, fileId: string, source: Fetcher<DriveImportSource>): Promise<DriveImportReceipt>;
  /** Host-only capture of an explicitly selected Drive file from this account.
   * Does not grant an agent access or create a Mnemos document. */
  readDriveImport?(fileId: string): Promise<DriveImportSnapshot>;
  /** Complete the explicitly prepared mail registration using this human account. */
  registerMailSelection?(project: string, request: string, selection: string): Promise<{
    /** Registered connection ID for management and agent use. */
    connection_id: string;
    /** Project bound to the connection. */
    project_id: string;
    /** Provider of the selected mail. */
    provider: string;
    /** SHA-256 of the immutable owner-selected query. */
    query_sha256: string;
    /** Current connection version for conditional changes. */
    revision: number;
    /** Saved connection state, not proof of effective agent access. */
    enabled: boolean;
  }>;

  /** Complete the explicitly prepared calendar registration using this human account. */
  registerCalendarSelection?(project: string, request: string, selection: string): Promise<{
    /** Registered connection ID for management and agent use. */
    connection_id: string;
    /** Project bound to the connection. */
    project_id: string;
    /** Provider of the selected calendar. */
    provider: string;
    /** Stable provider calendar ID. */
    calendar_id: string;
    /** Current connection version for conditional changes. */
    revision: number;
    /** Saved connection state, not proof of effective agent access. */
    enabled: boolean;
  }>;

  /** Host-only factory for an explicit calendar selection from this connected account. */
  getCalendarReadSource?(calendarId: string): Promise<{
    /** Persistent read authority; retained on the server, never sent to an iframe. */
    source: Fetcher<CalendarReadSource>;
    /** Stable account/calendar/generation identity used to reject changed retries. */
    sourceKey: string;
    /** Administrator-controlled category of the selected resource. */
    resource: SupportedResource;
  }>;
  /** Host-only receiver for a selected calendar. Browser input cannot supply source authority. */
  acceptCalendarReadSource?(project: string, request: string, sourceKey: string, source: Fetcher<CalendarReadSource>): Promise<{
    /** Stable identifier of this preparation, not a bearer credential. */
    selection_id: string;
    /** Display title of the selected calendar. */
    title: string;
  }>;
  /** Receive a diagnostic heartbeat using this account identity, never a caller-supplied user. */
  recordWorkspaceActivity?(stream: string, sequence: number, active: boolean): Promise<void>;
  /** Receive UI load timings through the explicitly selected workspace diagnostic account. */
  recordUIReadiness?(sample: UIReadinessSample): Promise<void>;
  /** Mint a persistent source for an explicit human import of one immutable native document publication.
   * This grants no agent session; the Workshop must retain the source for future observer checks. */
  getNativeDocumentSource?(resourceUrl: string, publication: string): Promise<{
    /** Observer-enforcing source class bound to this account and exact publication. */
    class: DurableObjectClass<NativeDocumentSource>;
    /** Canonical source identity, including its organization. */
    sourceKey: string;
    /** Administrator-controlled resource category for this source. */
    resource: SupportedResource;
  }>;

  // Get display info for an account, suitable for display to a user.
  describe(): Promise<AccountDescription>;

  // Typically returns the same as GatekeeperVendor.getSupportedResources(), though an
  // implementation could choose to return a narrower set if the specific account does not support
  // every resource that the vendor supports generally.
  getSupportedResources(): Promise<SupportedResource[]>;

  // Get a Durable Object class that can implement a gatekeeper for the given resource. This class
  // can be used to instantiate a Facet which implements the Gatekeeper interface.
  //
  // Note that the Overseer of a Gadget will call this immediately when the user pastes in a URL,
  // *before* the user has actually chosen to grant the Gadget any permissions on the resource.
  // Permissions are requested by instantiating the Gatekeeper and calling setPermissions() on it,
  // usually after first calling describe() to find out what the resource can do.
  //
  // The returned class is imbued (via `ctx.props`) with the user's credentials and the resource
  // ID. The returned `resource` indicates which SupportedResource matched the URL.
  getGatekeeperClassFor(url: string): Promise<{
    class: DurableObjectClass<Gatekeeper<any>>;
    resource: SupportedResource;
  }>;

  // Get the UI used to choose a specific resource.
  // `resourceUrlPattern` is the `urlPattern` associated with the supported resource.
  startResourceConfigurator(
    resourceUrlPattern: string,
  ): Promise<ResourceConfiguratorFrame>;

  // Revoke this account connection. The GatekeeperUser, and all Gatekeepers created through it,
  // become broken.
  revoke(): Promise<void>;

  // Start the flow to refresh/replace credentials on this account. Returns the URL for the user
  // to visit in a new tab to complete re-authentication. When the flow completes, the
  // GatekeeperConnectCallback (provided during the original connectAccount() flow) will be
  // notified via credentialsRestored(). The existing account Fetcher and all gatekeeper bindings
  // created through it continue to work with the new credentials.
  //
  // SECURITY: As with connectAccount(), the returned URL must include a cryptographic nonce to
  // prevent replay attacks.
  reconnect(): Promise<{url: string}>;

  // For vendors that advertise `providesAuth`, returns the account's email address for use as the
  // user's sign-in identity. The email MUST be verified by the provider (e.g. Google
  // `email_verified`, a GitHub primary+verified email, or a Cloudflare account email) — the
  // Workshop keys accounts by email, so an unverified address would allow account takeover.
  // Returns null when the account has no verified email or the vendor does not support auth.
  getAuthenticatedEmail(): Promise<string | null>;

  // Get a `GatekeeperUserVerifier` representing this user.
  getVerifier(): Promise<Fetcher<GatekeeperUserVerifier>>;

  // Ensure the authorization for the listed grantable resource types (by `urlPattern`) is granted
  // on this account, expanding the grant if needed.
  //
  // Returns the URL for the user to visit to authorize them, or no URL if nothing was needed.
  // Gatekeepers with no grantable resource types should return no URL.
  //
  // SECURITY: As with connectAccount(), any returned URL must include a cryptographic nonce.
  ensureResources(resourceUrlPatterns: string[]): Promise<{url?: string}>;

  // ---------------------------------------------------------------------------
  // Singleton / management-UI capabilities. Present only on accounts created by
  // GatekeeperVendor.createAccount() whose describe() sets AccountDescription.singleton and/or
  // .providesUi. The Workshop gates calls on those declaration flags rather than probing the stub,
  // since RPC stubs cannot reliably report whether an optional method exists.

  // Get a Durable Object class implementing the account's agent singleton, for accounts whose
  // describe() sets AccountDescription.singleton. The Workshop installs this gatekeeper into the
  // owner's gadgets like any other gatekeeper — as a Facet under the Overseer — and auto-provides
  // its session to the agent as an unnamed capsule. Because it is a normal Gatekeeper, the session
  // (Gatekeeper.startSession) and catalog (Gatekeeper.getAgentCatalog) run gadget-side in the
  // gatekeeper's own worker with no round-trip back through this account DO; every read is still
  // authorized as an observation via the ApprovalQueue, exactly like any gatekeeper.
  //
  // The returned class is imbued (via `ctx.props`) with whatever the account needs to serve the
  // singleton (e.g. the account id and sharing domain).
  getSingletonGatekeeperClass?(): Promise<DurableObjectClass<Gatekeeper<any>>>;

  // The account's full-page management UI (iframe HTML + ui capability). `context.isAdmin` is passed
  // fresh per open (not baked into the account) so admin-gated features reflect current status.
  startAppUi?(context: AppUiContext): Promise<GatekeeperUiFrame>;

  // TODO:
  // - Query whether account has scope to access a particular URL.
}

// Opaque object representing the capability to verify whether a particular user is able to access
// a particular Gatekeeper. Minted by `GatekeeperUser`, and then passed to
// `Gatekeeper.addObserver()` and possibly other future interfaces.
//
// At present, this interface has no methods, because it is merely meant to be passed back to the
// Gatekeeper that created it.
//
// IMPLEMENTATION NOTE: As of this writing, there is no runtime-supported way to "unwrap" a
// `Fetcher` passed back to its implementer in order to extract the underlying `props`. This will
// be added eventually. For now, we recommend that the `GatekeeperUserVerifier` implement a public
// but non-standard method which the same gatekeeper's `addObserver()` implementations can call.
// The overseer promises only to pass a `GatekeeperUserVerifier` object back to the same gatekeeper
// that created it, so addObserver() can then call that non-standard method and trust the results.
export interface GatekeeperUserVerifier extends WorkerEntrypoint {}

// Interface exposed by a Gatekeeper instance implementing a specific resource binding on a
// specific Gadget.
//
// The Gatekeeper executes as a Durable Object Facet, where it is a child of the Overseer. This
// interface is exposed to the Overseer, not directly to the Gadget.
export interface Gatekeeper<Session> extends DurableObject {
  // Get more info on the specific resource without actually granting access. This information is
  // to be presented to the user in the UI, before the user actually confirms they want to grant
  // access.
  describe(): Promise<ResourceDescription>;

  // Returns the a subset of the type definitions returned by
  // GatekeeperVendor.getTypeScriptTypes(), specifically covering types used by this Gatekeeper.
  // This allows the agent to be provided with only types relevant to them rather than the entire
  // API space of the vendor, which may support many kinds of resources.
  getTypeScriptTypes(): Promise<string>;

  // Catalog of action kinds this gatekeeper MAY auto-apply without per-action review, for
  // pre-approval UIs that must list them before any action has been submitted. Each entry is the
  // {tag, label} an action of that kind carries on its ActionDescription.actionKind. This is the
  // *potential* set; the per-action `autoApprovable` verdict is still the binding gate at apply
  // time. Gatekeepers with no auto-approvable actions return [].
  getAutoApprovableActions(): Promise<ActionKind[]>;

  // Get the capability representing this resource's RPC interface which will be provided to the
  // Gadget.
  //
  // Every operation performed through this session must be submitted to the approval queue.
  // Observations (read-only operations) must be authorized before data is returned to the caller.
  // Side-effecting actions must not actually be performed until they are approved.
  //
  // It is suggested that the gatekeeper "simulate" actions that have not been approved yet, that
  // is, the `Session` interface should reflect the state of the resource as if all actions had
  // been applied. This allows the Gadget to keep working, potentially queuing up additional
  // dependent actions. That said, there is no strict requirement that a gatekeeper does such
  // simulation -- it is really up to the gatekeeper author to decide what is appropriate for the
  // particular API.
  startSession(approvalQueue: RpcStub<ApprovalQueue>): Promise<Session>;

  // Bounded, user-specific metadata the agent uses to discover entries reachable through this
  // gatekeeper's session, without paging the full session API. Implemented only by gatekeepers
  // whose session benefits from a discovery index (e.g. an agent singleton like the Context
  // Library); most gatekeepers omit it. Catalog access is an observation, so the implementation
  // must authorize it via `authorizer.authorizeObservation()` before returning metadata. Returns
  // null when there is no catalog. Use `boundAgentCatalog()` to enforce the size limits.
  getAgentCatalog?(
    request: AgentCatalogRequest,
    authorizer: RpcStub<ObservationAuthorizer>,
  ): Promise<AgentCatalog | null>;

  // Informs the gatekeeper that a new user is being added to the Gadget with the potential to see
  // all data that was read from this Gatekeeper in the past.
  //
  // `id` is a unique, stable, but opaque string chosen by the overseer to identify this user in
  // the context of this gadget.
  //
  // The gatekeeper must verify that the given user is allowed to directly observe everything that
  // has been observed through this gatekeeper in the past. If this is not the case, addObserver()
  // must throw an exception.
  //
  // If this returns without throwing, the Gatekeeper must remember that this user is now an
  // observer. If any future observation must be hidden from this observer, then the
  // `ObservationDescription` must include the `excludeObservers` property to indicate who is not
  // permitted to see the observation.
  //
  // `addObserver()` may be called again with the same user ID. If so, the gatekeeper should re-run
  // the same verifications it would have done if the user were newly-added. The overseer may run
  // this periodically to check if the user's access to the resource may have been revoked.
  //
  // For most gatekeepers, addObserver() should simply check that the user is allowed to read the
  // target resource in general -- there's no actual need to check against a log of past
  // observations. For gatekeepers that provide broad access to a user's resources, though, it may
  // be unlikely that any other user could possibly have access to everything the gatekeeper provides.
  // In these cases, logging what was actually observed makes things more useful.
  //
  // For example, imagine a gatekeeper that grants access to a user's email inbox. Full access to
  // an inbox is extremely personal and usually no other user can possibly be permitted such broad
  // access. However, if the Gadget itself carefully reads only emails addressed to a particular
  // mailing list, then it is OK to reveal those observations to any member of the mailing list.
  // The gatekeeper should ideally permit observers who are mailing list members.
  addObserver(id: string, user: Fetcher<GatekeeperUserVerifier>): Promise<void>;

  // Notifies the gatekeeper that it can stop tracking the given observer, who was previously
  // added using `addObserver()`. The gatekeeper no longer needs to verify whether each observation
  // is safe for this observer.
  //
  // This method must be idempotent: If the gatekeeper is unaware that this user was ever added, it
  // should just ignore the call rather than throw.
  removeObserver(id: string): Promise<void>;

  // Returns the provider for describe().hasSlashCommands, if supported.
  getSlashCommandProvider?(): Promise<SlashCommandProvider>;

  // ---------------------------------------------------------------------------
  // Callbacks invoked by the overseer to apply (or reject) actions that were previously queued
  // for approval via the ApprovalQueue.
  //
  // Each action is identified by a sequential integer action ID, assigned by the gatekeeper when
  // it submits the action for approval. The action ID is passed back to these methods so the
  // gatekeeper can look up the action details in its own storage.

  // Action was approved. This call should apply the action (or schedule it to be applied).
  //
  // If this throws an exception, the user will be informed that the action failed and given the
  // opportunity to retry or discard.
  //
  // Depending on policy conditions, an action may be approved and applied automatically. However,
  // the gatekeeper is nevertheless expected to submit all actions for approval; there is no mode
  // in which it's OK to skip the check.
  applyAction(action: number): Promise<void>;

  // Indicates that an action was rejected by the user. The gatekeeper should clean up any
  // associated storage.
  //
  // If the returned `restart` flag is true, rejecting this action requires restarting the Gadget.
  // This is sometimes needed by gatekeepers that simulate actions as if they had been approved --
  // the session may be in a state that is difficult to roll back without confusing the Gadget.
  // The Overseer will take care of the restart, possibly after rejecting other actions.
  rejectAction(action: number): Promise<void | {restart?: boolean}>;

  // Attempts to revert an action that was already applied.
  //
  // Gatekeepers are not required to implement this. If unimplemented, the user will be instructed
  // that they need to perform the revert manually based on the action description. High-quality
  // gatekeepers should almost always implement this, though.
  //
  // If the returned `message` is non-null, it is Markdown to be displayed to the user. This may
  // be used, for example:
  // - To give the user additional instructions on how to complete the revert, if not all of it
  //   could be done automatically.
  // - To explain to the user why a revert is not possible, e.g. if other stacked modifications
  //   have been made on top which must be reverted first. (`canRetry` may be true in this case.)
  //
  // `canRetry` should be true if the revert failed (for a reason described in `message`), but
  // it could make sense to retry later. In this case the UI will continue to give the user the
  // option to revert.
  //
  // `restart` has the same meaning as for `rejectAction()`.
  revertAction(action: number):
      Promise<void | {message?: string, canRetry?: boolean, restart?: boolean}>;
}

/** Persistent provenance for a human-imported native document, independently of agent bindings. */
export interface NativeDocumentSource extends Gatekeeper<never> {
  /** Open a fixed publication after checking current observers and authorizing the observation. */
  openDocument(authorizer: RpcStub<ObservationAuthorizer>): Promise<{
    /** Allowed origin for the direct storage transfer. */
    storageOrigin: string;
    /** Read-only capability fixed to this publication, with post-transfer access validation. */
    download: RpcStub<GatekeeperNativeDocumentDownload>;
  }>;
}

export interface ObservationAuthorizer extends RpcTarget {
  // Check whether the gadget should be permitted to make an observation (that is, to read some
  // data from an external service). The gatekeeper calls this on every read operation, and must
  // wait for the response before returning anything to the gadget. The method will return normally
  // if the operation is permitted, or throw an exception if not; the exception should propagate
  // through to the gadget.
  //
  // In many cases, the gatekeeper should actually call this *after* fetching the data from the
  // remote service, so that the description can include details about the actual data. As long
  // as the operation is strictly read-only, and the call is made before actually returning any
  // data to the gadget, this is OK.
  authorizeObservation(description: ObservationDescription): Promise<void>;
}

// Macro expansion produced by a slash command. An absent message suppresses the generated
// agent-visible message and agent turn; the visible command event remains in chat history.
export type SlashCommandResult = {
  // Optional skill name for the display badge. Commands that do not represent skills omit it.
  skillName?: string;

  // Final text to insert into chat as if the user had sent it. The provider owns all formatting and
  // argument handling; Workshop stores this as an ordinary generated user message.
  message?: string;
};

// One slash command offered by a Gatekeeper. This is picker metadata only.
export type SlashCommandDescriptor = {
  // Opaque ID local to this provider. Passed back to invoke().
  id: string;

  // Name shown after `/` in the picker.
  name: string;

  // Short description shown in the picker.
  description: string;

  // Optional label for the underlying resource (e.g. a collection path), used when names collide.
  resourceLabel?: string;
};

// Optional API for a Gatekeeper that offers slash commands.
//
// list() returns non-sensitive picker metadata. Before invoke() returns expansion text derived from
// protected data, it must use `authorizer` to authorize and audit the read. The provider cannot
// submit actions or bind hooks.
export interface SlashCommandProvider extends RpcTarget {
  // Complete catalog of commands offered by this provider. Providers should keep this reasonably
  // small.
  list(): Promise<SlashCommandDescriptor[]>;

  // Runs the command identified by `id`, which must be an ID previously returned by list().
  // `args` is the unparsed natural-language text following the command. The provider owns all
  // expansion semantics and may return final text to insert as an ordinary user message.
  // `authorizer` remains authorization and audit only. The provider must reject unknown IDs.
  invoke(
    id: string,
    args: string,
    authorizer: RpcStub<ObservationAuthorizer>,
  ): Promise<SlashCommandResult>;
}

// Used by a gatekeeper to request an action that has side effects (is not read-only). Any such
// action may be subject to human-in-the-loop approval and audit logging. Whether or not review is
// actually required, the gatekeeper must still submit all actions and wait for apply() to be
// called before applying them.
export interface ApprovalQueue extends ObservationAuthorizer {
  // TODO: Method to indicate that the gadget tried to perform an action that the gatekeeper itself
  //   hasn't been authorized to do (e.g. the user hasn't authorized the right OAuth scopes). The
  //   system should direct the user to the right UI to authorize the action.

  // Submit an action for approval.
  //
  // Unlike `authorizeObservation()`, `submitAction()` is fully asynchronous. It returns
  // immediately (that is, the returned Promise resolves quickly), but the action may not actually
  // be carried out until much later. It's intended that the user might not approve actions until
  // hours or days later, but this shouldn't cause any problems.
  //
  // `action` is a sequential integer action ID assigned by the gatekeeper. It will be passed back
  // to the Gatekeeper's applyAction() or rejectAction() when the action is later approved or
  // rejected.
  //
  // `description` describes the action in a way that can direct UI representation and policy
  // enforcement details.
  //
  // TODO: It would be nice if we can link this with the output gate so that if the submission
  //   does not complete, any SQL writes performed just before submit() are rolled back...
  submitAction(action: number, description: ActionDescription): Promise<void>;

  // Notifies the overseer that the gadget (or an agent) has requested to register a persistent
  // callback hook.
  //
  // `callback` is the stub received from the Gadget, which is intended to be called whenever some
  // event occurs. Although `callback` is always a persistent stub (see below), the gatekeeper
  // should NOT try to store it on its own; it should always pass it to `bindHook` for the overseer
  // to store. Why? Because the callback needs to be bound to a particular gatekeeper *session*.
  // At the time you are calling `bindHook()`, the callback is tied to the session that is tied
  // to the `ApprovalQueue`. But that session will end at some point, after which the callback stub
  // you received is revoked. When you call HookInitiator.startHook() later on, that actually
  // initiates a *new* session (returning a new `ApprovalQueue`), and the callback returned then
  // is tied to that session instead.
  //
  // `controller` is an object implemented by the gatekeeper which allows the overseer to enable
  // or disable the hook.
  //
  // The hook is not immediately enabled, as the user may need to approve it first. If and when
  // the user has approved, the overseer will call controller.enable() to request that the the
  // gatekeeper begin delivering hook events. If the user never approves, no call will ever be
  // made. Therefore, the gatekeeper should avoid storing any state until the hook is enabled.
  // Typically, the `HookController` implementation should capture all information it needs to
  // register the hook into `props` so that it doesn't need to store anything elsewhere.
  //
  // In a typical implementation, the gatekeeper may expose an API to the gadget like:
  //
  //     onSomeEvent(callback: RpcStub<SomeInterface>)
  //
  // Where `SomeInterface` can be either an RpcTarget-derived interface, or a function type, but
  // either way the stub must be a persistent stub (see below). The gadget could call `onSomeEvent`
  // directly, but more commonly an agent will call it in a one-off `executeCode` tool call, since
  // this is usually one-time setup, not something that happens programmatically. The
  // implementation of `onSomeEvent` constructs a `HookController` implementation whose `props`
  // specify the details of the event to be hooked, then calls `bindHook()` to register the hook.
  // When the user approves, the overseer calls `controller.enable()`, which takes the provided
  // `HookInitiator` object and stores it somewhere where it can be invoked whenever "SomeEvent"
  // occurs. When the event occurs, first the gatekeeper calls `hookInitiator.startHook()` to
  // notify the overseer that a hook is incoming. The overseer returns back the original `callback`
  // stub along with an `ApprovalQueue`. Next the gatekeeper calls `authorizeObservation()` on the
  // `ApprovalQueue` -- since a hook invocation is almost always an observation of some sort.
  // Finally, it invokes the `callback` object to deliver the event to the gadget.
  //
  // Persistent stubs are (as of this writing) a relatively new feature of the Workers Runtime.
  // A worker can construct an `RpcStub` that is "persistent", meaning it can be stored into
  // Durable Object storage, as well as be used as part of the `props` for a WorkerEntrypoint. To
  // create such a stub, the worker:
  // 1. Implements a `[restore](params)` method, then
  // 2. Calls `ctx.restore(params)` to invoke that method.
  //
  //     import {restore, RpcTarget, DurableObject} from "cloudflare:workers";
  //
  //     class Gadget extends DurableObject {
  //       [restore]({type: string, greeting: string}) {
  //         switch (type) {
  //           case "greeter":
  //             return new Greeter(greeting);
  //           default:
  //             throw new Error("unknown restore params");
  //         }
  //       }
  //
  //       async registerSomeHook() {
  //         // Create a persistent stub.
  //         let callback = await this.ctx.restore({type: "greeter", greeting: "Hello"});
  //
  //         // Register it against a hook offered by some gatekeeper API.
  //         await this.env.SOME_GATEKEEPER.onSomeEventHook(callback);
  //       }
  //     }
  //
  //     // Some sort of RpcTarget implementation (just an example).
  //     class Greeter extends RpcTarget {
  //       constructor(greeting) {
  //         super();
  //         this.greeting = greeting;
  //       }
  //       greet(name) {
  //         return `${this.greeting}, ${name}!`;
  //       }
  //     }
  //
  // The idea here is that `ctx.restore(params)` creates a *persistent* stub which can be
  // re-created any time it is needed by calling the `[restore]()` method with the same params
  // again. The params themselves also have to be persistable.
  bindHook<Hook extends RpcTarget>(
        controller: Fetcher<HookController<Hook>>, callback: RpcStub<Hook>,
        description: HookDescription): Promise<void>;
}

export type ObservationDescription = {
  /** Личные данные владельца: запрещает совместный доступ к этой беседе, сохраняя действия владельца. */
  ownerOnly?: boolean;
  /** Подтверждённый контекст прочитанных данных для интерфейса чата. Не выдаёт права и не меняет привязки. */
  workContext?: {
    /** Имя проекта из разрешённого каталога источника. */
    projectName: string;
    /** Имя фактически прочитанного ресурса; отсутствует при поиске по проекту. */
    resourceName?: string;
  };

  // Brief one-line summary of the observation, like an email subject line, to display in a list.
  title: string;

  // A complete description of the action to be taken, in Markdown-formatted natural language.
  // This will be displayed to the approver. It must include all details that might be relevant to
  // consider before approving.
  description: string;

  // ----------------------------------------------------------------------------
  // Policy hints
  //
  // TODO: Define policy hints that might allow a policy engine to make better decisions. A policy
  // engine might want to know things like:
  // - Does the observation include free-form content (that could include prompt injection
  //   attacks)?
  // - Who are the users who may have contributed to such free-from content (to judge if they are
  //   prompt injection risks).
  // - If this content may contain secrets, who are the users that are allowed to view it? This
  //   can help detect situations where the gadget could leak information.

  // If true, then this observation contains sensitive information that MUST NOT be shared with
  // ANYONE except the account owner. This means:
  // - If the gadget is shared already, authorizeObservation() must throw an exception to block
  //   the observation.
  // - All future sharing of the gadget is prohibited.
  // - Once observed, the gadget goes into "lockdown mode" where it can no longer perform any
  //   actions, only make observations. This prevents the gadget from leaking data through other
  //   gatekeepers.
  //
  // TODO(someday): This was added as a stopgap in order to be able to make certain sensitive data
  //   sources available to internal users. In the longer-term, it should be possible to share
  //   sensitive data as long as the recipients also have access to that same data, but this
  //   requires a more complex policy framework to compute.
  prohibitAllSharing?: boolean;

  // If present, then this observation includes data that must not be revealed to the given
  // observer IDs, who were previously added via `Gatekeeper.addObserver()`.
  //
  // If the call to authorizeObservation() succeeds, then the overseer is promising to ensure that
  // these users will not see this observation. How it does this is up to the overseer, but in
  // practice it may be one of:
  // - The user had already been removed.
  // - The overseer revoked the user's access synchronously (however, in practice, we don't do
  //   this, because it would be weird UX).
  // - The observation occurred in a specific agent thread, and the overseer can prevent the
  //   observer from viewing that thread.
  //
  // If authorizeObservation() throws, then the gatekeeper should allow the exception to propagate
  // out to the caller, blocking the observation from taking place at all. The overseer will
  // throw in cases where it would not otherwise be able to prevent the given observer from seeing
  // the observation.
  excludeObservers?: string[];
}

// A stable, machine-readable tag for an action paired with its human-readable display name; the two
// always travel together. Policy decisions key on `tag` (auto-approval rules group on it today, and
// the future policy / danger-level engine will too -- treat it as a stable enum; multiple action
// kinds MAY share a tag to be governed as one group). `label` is shown in the auto-approval UI in
// place of the raw tag, which is not meant for display.
export type ActionKind = {
  tag: string;
  label: string;
};

// Describes an action submitted to the action approval queue. This contains all the information
// needed to:
// - Decide whether the action needs to be approved and who can approve it.
// - Display the action to the approver for review.
// - Store the action in an audit log.
export type ActionDescription = {
  // Brief one-line summary of the action, like an email subject line, to display in a list.
  title: string;

  // A complete description of the action to be taken, in Markdown-formatted natural language.
  // This will be displayed to the approver. It must include all details that might be relevant to
  // consider before approving.
  description: string;

  // Does the Gatekeeper implement `revertAction()` for this action?
  //
  // It is recommended that all actions implement automatic revert. But, if an action is not able
  // to do so, it should at least use this flag to let the UI know not to offer the option to the
  // user.
  //
  // Note that this being true doesn't necessarily mean that reverting will always work. E.g. by
  // the time the user tries to revert, too many other changes may have been made, making it hard
  // to revert cleanly.
  implementsRevert: boolean;

  /** Только владелец workspace может подтвердить или отклонить это действие.
   * Допустимо только у ambient-ресурса владельца; автоматическое одобрение запрещено. */
  ownerApprovalRequired?: boolean;

  // Hint that an agent should not keep working until this action has been approved or denied.
  //
  // Set this for actions whose effects the gatekeeper does NOT simulate. Because a not-yet-approved
  // action isn't reflected by later reads, an agent that keeps going would observe a world where
  // its action "didn't happen" — and tends to get confused: re-trying, second-guessing, or undoing
  // its own work. When this is set, the harness driving the agent should suspend the current turn
  // once the action is submitted and resume it after the user decides (or leave it ended on deny),
  // rather than letting the agent proceed against state the action hasn't been applied to.
  //
  // This is an advisory hint, not an enforcement mechanism: the action is still submitted and the
  // approval/security semantics are unchanged. Gatekeepers that fully simulate their actions (so
  // reads already reflect pending changes) should leave this unset, so the agent keeps working
  // seamlessly.
  awaitDecision?: boolean;

  // Author's verdict that this specific action is safe to auto-apply without human review, IF the
  // user has opted in to auto-approving this action's kind (see `actionKind`). Only the gatekeeper
  // author knows whether a given edit is benign vs. destructive, so this gate is set per-action.
  // Absent -> never auto-approvable, even if a matching rule exists.
  //
  // TODO: A single opaque boolean isn't the ideal long-term shape. Eventually the gatekeeper should
  // describe the *nature* of the action -- e.g. destructive vs. additive, reversible vs. not,
  // posting arbitrary content (possible data leak) vs. flipping a switch -- and let a security
  // policy decide whether auto-approval is allowed, rather than the gatekeeper author hard-coding
  // that judgement here.
  autoApprovable?: boolean;

  // ----------------------------------------------------------------------------
  // Policy hints
  //
  // TODO: Define policy hints that might allow a policy engine to make better decisions. A policy
  // engine might want to know things like:
  // - Which human users are allowed to perform this action directly? Can be used to detect if
  //   the gadget might be influenced by humans to perform actions that said humans couldn't
  //   perform directly.
  // - Which human users might observe the effects of this action? Can be used to track possibility
  //   of leaking secrets.
  // - Is this action reversible? Does reversing require manual intervention or is it fully
  //   automatic?
  // - Does this action strictly create content to be viewed (e.g. creating a Jira ticket), or does
  //   it actively manipulate the world (e.g. flipping a light switch, or deploying a release)?
  // - Does this action include writing free-form content (e.g. text), or only boolean/numeric
  //   content (e.g. flipping a light switch)? Affects the risk of data leaks.
  // - Does this action modify existing content or only create new content? The former is somewhat
  //   riskier since it could damage existing information whereas posting new content is at worst
  //   an annoyance.

  // The action's kind (stable tag + display label), or absent for actions that can't be matched by
  // any tag-keyed rule -- those always require manual approval. `actionKind.tag` is what auto-
  // approval rules and the future policy engine key on; `actionKind.label` is shown in the UI.
  actionKind?: ActionKind;
}

// Describes a registered hook, for display purposes (e.g. so the user can see what hooks are
// registered and choose whether to enable / disable a hook).
export type HookDescription = {
  title: string;
  description: string;
}

// Identifies where a hook delivers its events, for display and navigation by a gatekeeper that
// surfaces its hooks in a UI. Passed to `HookController.enable()`.
//
// Both fields are fixed when the hook is bound, so a gatekeeper may persist them alongside the
// initiator and never needs to refresh them. They are opaque display/routing identifiers: they
// must not be used for authorization, identity, or storage scoping.
export type HookTargetMetadata = {
  // The workspace the hook delivers into.
  workspaceId: string;

  // The specific gadget within that workspace, when the hook is pinned to one. Absent means the
  // workspace's current default gadget.
  gadgetId?: number;
}

// Object passed to `ApprovalQueue.bindHook()`, providing the overseer with callbacks to enable
// or disable a hook.
export interface HookController<Hook extends RpcTarget> extends WorkerEntrypoint {
  // Called to enable this hook. When a hook event is to be delivered, initiator.startHook() must
  // be called first, before actually invoking the hook.
  //
  // If the hook was already enabled, the previously-registered `initiator` should be replaced.
  //
  // `target` identifies where the hook delivers, for gatekeepers that display or link to it. A
  // gatekeeper that doesn't need it may ignore the value, but must still *declare* the parameter:
  // RPC argument validation is generated from the declared signature, and a call carrying an
  // argument the receiver does not declare is rejected.
  enable(initiator: Fetcher<HookInitiator<Hook>>, target: HookTargetMetadata): Promise<void>;

  // Unregister the hook, so that future events stop being delivered. The gatekeeper should forget
  // the `initiator` previously registered by `enable()`.
  //
  // This must permanently clean up all state related to the hook, as it may never be called again.
  // However, the overseer can also call enable() again in the future.
  disable(): Promise<void>;
}

// Object passed to HookController.enable(), used to inform the overseer when a hook event occurs.
// A gatekeeper MUST use a HookInitiator to obtain a fresh version of the callback stub any time
// it wants to deliver an event. It must not store the callback in its own storage.
export interface HookInitiator<Hook extends RpcTarget> extends WorkerEntrypoint {
  // Indicates that the hook is about to be invoked.
  //
  // This returns an ApprovalQueue which the gatekeeper may use to register observations and
  // actions resulting from this hook invocation. Most (but not necessarily all) hooks involve an
  // observation. Some hooks may even pass callbacks or interpret the return value in a way that
  // causes side effects, which should be registered as actions.
  startHook(): Promise<{callback: RpcStub<Hook>, approvalQueue: RpcStub<ApprovalQueue>}>;
}

/** Раздел интерфейса, объявленный подключённым аккаунтом; не предоставляет прав на операции. */
export interface GatekeeperUiSection {
  /** Стабильный идентификатор раздела для прямой ссылки. */
  id: string;
  /** Название раздела в основной навигации. */
  title: string;
  /** Группа повседневной работы или управления. */
  group?: "work" | "manage";
}
