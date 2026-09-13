# Yandex Disk import — in progress

This package implements a Worker with OAuth accounts and `YandexDiskImportReader`. It is registered in automatic Worker discovery, the Workshop host transfer path and the CloudflareOS import form.
The reader takes an account-owned credential resolver and revocation check. No token is
accepted as a snapshot argument or returned with the result. It reads an explicitly
selected `disk:/…` path and returns original bytes in the shared DriveImportSnapshot format.

The Mnemos source-copy coordinator accepts this provider, checks SHA-256, and retains
its provenance. The OAuth transport, persistent SQLite account, HTTP callback, Workshop completion callback and fixed source capability are implemented. Host selection accepts Google Drive and Yandex Disk with separate vendor/resource policy checks. No real Yandex account has
been used to verify this implementation.

The adapter issues GET requests only, checks metadata before and after download,
compares exact byte length and provider MD5, and computes SHA-256 for Mnemos. The version
is the observed modification timestamp and MD5 tuple, not a provider historical revision.
File identity is the path: rename-following and shared organization disks are not implemented.

Current bounds: 16 MiB per file, 255-character canonical path, 30-second capture timeout,
64 KiB metadata responses. Download origins are the documented downloader hosts;
redirects and other origins are rejected. A provider deployment that returns other hosts
or redirects requires a verified transport extension, not an arbitrary URL fallback.

References checked on 2026-09-11:

- [Resource metadata](https://yandex.ru/dev/disk-api/doc/ru/reference/meta)
- [Download link and GET request](https://yandex.ru/dev/disk-api/doc/ru/reference/content)
- [Resource response fields](https://yandex.ru/dev/disk-api/doc/ru/reference/response-objects)
- [Yandex 360 network endpoints](https://yandex.ru/support/yandex-360/business/admin/ru/network-settings)

Run `pnpm test` and `pnpm run build`. Tests substitute HTTP responses; they verify the
adapter's behavior, not provider compatibility with a real account.


`YandexOAuth` implements S256 PKCE, code exchange, refresh and provider identity lookup.
`YandexAccount` owns persistent, expiring, one-use initiation/state records and serializes
credential replacement/refresh. Reconnect must resolve to the original provider user ID.
Local revoke clears tokens immediately and prevents in-flight operations from restoring them;
old source generations remain invalid after reconnect. Identity is not used as a verified
CloudflareOS sign-in email. The HTTP callback invokes Workshop complete/restored and retains its receipt so a lost completion ACK can be retried without exchanging the authorization code again. An abandoned new account is cleaned up after one hour. A definitive refresh rejection blocks the account and queues a durable Workshop expiry notification. Temporary failures keep the account connected. Notification retries reflect the current account state, including reconnect during delivery.

OAuth references: [code/PKCE](https://yandex.ru/dev/id/doc/ru/codes/code-url),
[refresh](https://yandex.ru/dev/id/doc/ru/tokens/refresh-client),
[identity](https://yandex.ru/dev/id/doc/ru/user-information).


Build with `pnpm run build`; run the actual Worker/SQLite restart scenario with
`pnpm run test:worker`. Required deployment settings: `BASE_URL` (HTTPS public Worker
route), `CLIENT_ID`, `CLIENT_SECRET`. Register exactly `BASE_URL + /oauth` as the Yandex
redirect URI. The package is currently tested with substituted provider HTTP, not a real
Yandex OAuth application. Local development discovers the Worker automatically and accepts YANDEX_CLIENT_ID/YANDEX_CLIENT_SECRET; PUBLIC_BASE_URL supplies the HTTPS callback origin. Deployment inputs describe both secrets and the redirect URI.

MD5 uses the [Workers Web Crypto implementation](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/),
not runtime WebAssembly compilation. SHA-256 remains the Mnemos content digest.


On the Mnemos local stack, fill the private file
`~/.local/state/mnemos-cloudflareos-local/yandex-oauth.json` with `client_id` and
`client_secret`; the start script requires private file permissions and injects them
without printing values. The callback is `https://localhost:9443/gatekeeper/yandex/oauth`.
After restarting the local UI, connect Yandex in the connector catalog. In Mnemos,
open “Копия файла с диска”, select that account and enter a `disk:/…` path. Capture,
Office parsing and updating the existing copy share the Google import workflow.

The actual local catalog and form have been inspected in a signed-in browser.
A real Yandex OAuth application/account/file remains unverified.
