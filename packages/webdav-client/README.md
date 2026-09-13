# WebDAV file import

Read-only transport for a deployment-approved HTTPS directory, using a human's
username and app password. `WebDAVImportReader.snapshot(relativePath)` returns
original bytes and provenance; it does not create a Mnemos document.

The caller must keep credentials private, bind the directory/account identity to
the stored source, and provide a `validate()` callback that checks the current
owner, account generation and revocation. That callback runs around network
requests and before returning bytes. Account management and the CloudflareOS
import form now call this adapter through an owner-bound source capability.
The complete edit/reimport/revocation flow is verified against a local WsgiDAV
server. See the Mnemos V25 protocol for the provider matrix and its limits.

The reader uses depth-zero PROPFIND, conditional GET and a second PROPFIND. It
requires a file, a strong ETag, bounded size (16 MiB) and matching content type.
Weak/missing ETags are rejected. WsgiDAV's unquoted XML ETag is normalized before
comparison with the quoted HTTP ETag. Original path segments are encoded once;
relative paths containing percent escapes, dot segments or URL query/fragment
syntax are rejected. Redirects and response-provided download destinations are
never followed. No write methods are exposed.

Protocol references:

- [Nextcloud file operations](https://docs.nextcloud.com/server/latest/developer_manual/client_apis/WebDAV/basic.html)
- [WsgiDAV configuration](https://wsgidav.readthedocs.io/en/stable/user_guide_configure.html)

Run `pnpm --filter @gadgets/webdav-client test` and `types:check` for the focused
checks. A real WsgiDAV 4.3.5 HTTPS server is exercised from the Mnemos repository
by `scripts/mocks/webdav.py` and `scripts/mocks/check_webdav.mjs` (run the latter
from the Mnemos root). This verifies a real independent WebDAV implementation;
a Nextcloud installation has not yet been exercised.

The Mnemos gatekeeper reads `MNEMOS_WEBDAV_SERVERS`, a JSON array of
`{id: "corp-team", title: "Team files", url: "https://dav.example/team/"}`.
Roots must be HTTPS directory URLs without credentials, query or fragment.
An administrator configures roots; humans add their credentials in **Аккаунты
WebDAV**, then choose that connection and a relative file path in **Копия файла
с диска**. The local Mnemos runner reads the same array from private
`webdav-servers.json`. Passwords are never returned to the browser or agents.
Disconnect deletes credentials and invalidates retained source generations.
