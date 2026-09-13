# Internal CalDAV protocol client

Provides DAV discovery, selected-calendar REPORT reads with server-side recurrence expansion, and conditional event creation (`If-None-Match: *`). Uses pinned tsdav 2.3.3 and ical.js 2.2.1; it does not implement XML or iCalendar parsing itself.

Credentials and the allowed HTTPS origins come from the trusted account layer. DAV-discovered URLs cannot enlarge that allowlist. Each operation has bounded requests, response sizes and a deadline; account authority is checked around network IO. Transport adds Basic authorization after URL validation, so tsdav never receives the password or authorization headers. Writes are never automatically redirected or retried. The caller must retain the durable Mnemos creation-attempt state.

Meeting creation preserves full approved content and whole-second UTC instants. Attendees require advertised `calendar-auto-schedule`; the organizer comes from the authenticated principal's calendar-user-address-set. Success confirms storage, not invitation delivery. Unsupported scheduling fails before PUT. All-day dates are retained as dates; server-expanded recurrence IDs are preserved. Unexpanded series and floating/unknown-zone times fail rather than being misrepresented.

## Integration

The Mnemos gatekeeper now owns CalDAV credentials, the human connection form, and persistent read/write sources. The CloudflareOS calendar selector can use the same Mnemos account as source and target. Yandex and iCloud destinations are pinned; iCloud discovery can use its `pNN-caldav.icloud.com` shard hosts. Corporate server URLs/origins are deployment-owned. Changing a corporate endpoint invalidates prior stored authority instead of forwarding existing credentials to the new server.

Live provider interoperability remains unverified. The fast tests use fixture HTTP responses. Apple/Yandex acceptance and IMAP/SMTP mail are still open.

## Verification

`pnpm --filter @gadgets/caldav-client types:check`

`pnpm --filter @gadgets/caldav-client test`

The fast tests exercise the actual DAV XML parser, client and iCalendar serializer using a fixture HTTP transport. They cover discovery, event content, conditional creation, wrong calendar, revocation, hostile discovery addresses, bounded XML, missing scheduling, all-day events and expanded recurrence. They are not a live provider test.

## Protocol references

- [tsdav calendar object reads](https://tsdav.vercel.app/docs/caldav/fetchCalendarObjects)
- [tsdav conditional creation](https://tsdav.vercel.app/docs/caldav/createCalendarObject)
- [ical.js parser and timezone behavior](https://github.com/kewisch/ical.js/)
- [Yandex calendar connection instructions](https://yandex.ru/support/yandex-360/customers/calendar/web/ru/data-exchange/synchronization/sync-desktop)
- [Apple application passwords](https://support.apple.com/en-gb/102654)

Invitation availability can be checked with `scheduling(calendarUrl)` without writing: it requires advertised automatic scheduling and an organizer address. Creation repeats these checks. Mnemos uses this owner-only check before offering execution of a proposal with attendees; an unsupported server does not consume the proposal as an unknown write attempt. Confirmed event creation is not proof of invitation delivery.
