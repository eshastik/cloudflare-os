# Selected IMAP reader

`SelectedImapReader` is the transport for an owner-selected IMAP folder. It is
intended to run inside the CloudflareOS gatekeeper, independently of the owner's
choice of AgenticOS, Codex or Claude Code. The Mnemos gatekeeper uses it for human-owned IMAP account/folder selections.

The constructor takes an administrator-selected destination, private account
credentials, one folder and a callback that revalidates the owning capability.
`metadata()` describes the folder and newest-first ordering; `readSelection()`
scans 1–10 messages, newest first, in the same normalized format as the Gmail reader.
Optional common `search` filters match decoded subject/body, exact sender and
received time. Filtering uses the complete decoded body before preview clipping.
An empty page may still have `next_cursor`; retain the same filters and limit
when continuing. The transport cursor contains UIDVALIDITY and the last scanned
UID; Mnemos exposes a private-storage-backed opaque alias instead. A changed
UIDVALIDITY or missing anchor requires a fresh search. This is sequential scanning,
not a mailbox index or arbitrary IMAP command interface.

Connections use implicit TLS with certificate verification. There is no plaintext,
STARTTLS fallback, proxy argument or public command executor. The library disables
protocol logging, automatic IDLE, compression and IMAP4rev2 negotiation. Version
2.0.0 satisfies the workspace release-age policy; rev2 remains disabled because
later fixes concern servers advertising rev2 but rejecting ENABLE.

The reader uses EXAMINE and BODY.PEEK. UIDs are qualified by UIDVALIDITY; metadata
and membership are rechecked after reading. Revocation or a changed selection
withholds the result. Raw messages above 2 MiB fail explicitly; returned body text
is limited to 16,000 code points with a truncation flag. Attachment bytes are not
returned. The complete result is limited to 512 KiB and an operation to 30 seconds.

`pnpm test` exercises the actual client against a local TLS IMAP server, trusting
only the generated test CA in a child process. It verifies content, read-only
commands, UIDVALIDITY changes and revocation. TLS verification is not disabled.
Separate local Wrangler probes verified the library's protocol operation and the
package's import/metadata in Workers; the protocol probe used local plaintext.
An actual external TLS mailbox in Workers remains unverified.

The gatekeeper now supplies per-human credential storage and disconnect, an admin
destination allowlist, folder choice in CloudflareOS and a generation-fenced
`MailReadSource` through the existing Mnemos grant flow. The real menu and owner
folder listing were checked locally. A real MCP agent, granted access in CloudflareOS,
read and searched the two-user local TLS mock, including a match beyond the preview
and older than two empty pages. Revocation denied subsequent reads. This verifies
the local end-to-end path; it is not external-provider acceptance.
SMTP and human-approved sending are implemented in gatekeeper-mnemos,
with its production Worker socket tested against a local TLS/STARTTLS server.
External account delivery remains unverified. This package does not close V24.

References: [ImapFlow API](https://imapflow.com/docs/api/imapflow-client/),
[Workers transport limitations](https://github.com/postalsys/imapflow#readme),
[Cloudflare TCP sockets](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/).
