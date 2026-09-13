# Microsoft 365 / Outlook source (V24, in progress)

`src/mail-source.ts` implements account-owned read access to one concrete Outlook folder through the global Microsoft Graph v1.0 endpoint. The deployable Worker facade and persistent UserAccount are implemented. The CloudflareOS mail panel and owner-checked host RPC support root and nested folder selection. The local runtime is active; a real Microsoft account check remains. OAuth transport and the account state machine live in `oauth.ts` and `account.ts`.

The account facade supplies a token for the pinned `/me` account and a callback that verifies current account generation and delegated Mail.Read consent. Resolve well-known folder aliases in the owner's picker; the reader requires the concrete folder ID. The fixed Mnemos selection query is `folder:<id>`. An agent can choose only a limit from 1 through 10.

Reads use immutable message IDs and verify `parentFolderId` and `changeKey` against the chosen folder slice. After message reads, membership/version and account identity are checked again. The reader requests plain text, labels HTML explicitly if returned, and exposes no write/send, attachment-content or mailbox-wide enumeration operation. Content remains untrusted data.

Limits: 30-second fetch signal, 10 messages, 32-KiB listing, 3-MiB individual response, 16,000 body code points, 512-KiB final result. Omitted messages/body are marked explicitly. `nextLink` is neither followed nor exposed; redirects and caller-supplied URLs are refused. No credentials appear in outputs/errors.

Checks use existing workspace TypeScript and Node without new dependencies:

```sh
pnpm exec tsc --noEmit -p packages/gatekeeper-microsoft/tsconfig.json
node --test packages/gatekeeper-microsoft/__tests__/mail-source.test.mjs
```

Primary contracts: [folder messages](https://learn.microsoft.com/en-us/graph/api/mailfolder-list-messages?view=graph-rest-1.0), [message fields](https://learn.microsoft.com/en-us/graph/api/resources/message?view=graph-rest-1.0), [immutable IDs](https://learn.microsoft.com/en-us/graph/outlook-immutable-id), [plain-text message bodies](https://learn.microsoft.com/en-us/graph/api/message-get?view=graph-rest-1.0). No real Microsoft account or mailbox has been used in these checks.


OAuth uses a deployment-selected tenant authority (tenant UUID, organizations, consumers or common), a confidential server-side app credential, PKCE S256 and one-use stored initiation/state. New sign-ins request delegated User.Read, Mail.Read, Calendars.Read, Mail.Send and offline_access. Send authority is recorded only when the provider returns Mail.Send in the granted scope list. Refreshing an existing read-only grant does not request additional send authority. The callback URI must be registered as a web callback, not a browser SPA. Graph /me supplies the bound account identity; access tokens are treated as opaque.

`MicrosoftAccount` writes identity, token pair, generation and pending flow in one private storage record. Reconnect cannot change the original owner; local revoke removes credentials and invalidates old sources, including in-flight exchange/refresh. Concurrent refresh calls are serialized and replace the stored pair without changing the source generation. It does not revoke unrelated Microsoft sessions. The Worker facade keeps storage and credential-returning methods outside user/agent capabilities.

OAuth/state checks: `node --test packages/gatekeeper-microsoft/__tests__/account.test.mjs`. These use provider doubles and a persistent-map storage double; they are not a real Microsoft login or a Durable Object restart test.

Provider contracts: [authorization code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow), [refresh tokens](https://learn.microsoft.com/en-us/entra/identity-platform/refresh-tokens). Microsoft does not invalidate the previous refresh token merely on refresh; the account replaces its stored copy after successful identity verification.

Worker verification: `pnpm --filter @gadgets/gatekeeper-microsoft test:worker` builds the deployable bundle and exercises actual service bindings and SQLite Durable Object persistence in Miniflare. It covers OAuth completion retry without a second code exchange, process restart, selected-mail read, local revoke, wrong-owner reconnect rejection, same-owner reconnect and stale-source rejection. Microsoft responses are fixtures; this is not a real Microsoft account check. `redirect: manual` plus HTTP status validation prevents following redirects and works in Workers. Deployment inputs are CLIENT_ID, CLIENT_SECRET and TENANT_ID; the tenant uses the existing protected input mechanism.

Folder navigation uses [root mailFolders](https://learn.microsoft.com/en-us/graph/api/user-list-mailfolders?view=graph-rest-1.0) and [childFolders](https://learn.microsoft.com/en-us/graph/api/mailfolder-list-childfolders?view=graph-rest-1.0). Only same-collection pagination URLs are followed, up to 10 pages of 100 folders with explicit truncation. Search folders are excluded because their messages belong to other physical folders. Local startup accepts MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET and MICROSOFT_TENANT_ID.

Calendar source: `src/calendar-source.ts` uses [calendarView](https://learn.microsoft.com/en-us/graph/api/calendar-list-calendarview?view=graph-rest-1.0) on one concrete calendar and expands occurrences through Graph. It returns UTC intervals, original time-zone labels and explicit `all_day`; UTC is the transport representation, not a claim about the owner’s preferred zone. No local all-day date is fabricated from UTC. Windows are bounded to 366 days and 100 events; further pages are reported as truncated, never followed. Descriptions retain text/HTML format and clipping. Account identity and generation are checked before and after reads. The persistent Worker test also covers calendar reads after restart and old-source rejection after reconnect. Calendar picker and owner-checked host form are implemented; real Microsoft consent and end-to-end provider verification remain.

The owner picker uses [list calendars](https://learn.microsoft.com/en-us/graph/api/user-list-calendars?view=graph-rest-1.0), with at most ten pages of 100, same-collection continuation URLs and explicit truncation. The host rechecks ownership and admin/resource policy after provider IO. Calendar discovery is not exposed on the selected read capability.


Outgoing mail uses a separate `MicrosoftMailSendSource` capability and the host resource `https://graph.microsoft.com/v1.0/me/sendMail`. It is issued only for the saved account/folder/generation and a confirmed Mail.Send grant. The Mnemos human screen approves the exact recipients, subject and plain text, then explicitly sends the proposal. Tokens and sender identity cannot be provided by the agent or iframe. The existing durable Mnemos queue records an attempt before the provider request and prevents repeat sends after an uncertain response.

[Graph sendMail](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0) returns 202 with no body or message ID. The adapter records explicit acceptance without inventing an ID; this does not prove recipient delivery. POST redirects and failures are never retried. The default saves the message to Sent Items. Tests cover the fixed request, missing consent, legacy refresh, persistent sender capability, and revoke. No real mail has been sent.

Existing read-only accounts need a new Microsoft sign-in granting Mail.Send. Reconnect invalidates old selections, so the owner must create a new Mnemos mail connection and agent draft afterward. `ensureResources` for the send resource returns the existing reconnect URL when consent is missing. Calendar writes and threaded replies remain outside this implemented send path.

### Approved meetings

The Mnemos human review screen can create approved timed meetings in the selected Outlook calendar. This uses delegated `Calendars.ReadWrite` and a separate account-owned writer; calendar read capabilities remain read-only. New sign-ins request this consent. Existing read grants do not request write permission during refresh; reconnect and reselect the calendar before proposing a new meeting. Scope flags come from the token response and are checked again after refresh.

Creation sends one POST to `/me/calendars/{id}/events`, preserving approved UTC instants, plain description, location and attendees. Mnemos owns the durable single-attempt queue. A confirmed event ID is returned to the agent; it does not prove invitation delivery. An unknown outcome cannot be retried automatically.

Provider contract: [Microsoft Graph create event](https://learn.microsoft.com/en-us/graph/api/calendar-post-events?view=graph-rest-1.0), checked 2026-09-11. Local transport/Worker tests use provider doubles. Real Microsoft OAuth and invitations remain unverified.
