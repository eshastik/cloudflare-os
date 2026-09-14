import type { GatekeeperUiFrame } from '@gadgets/workshop-shared/gatekeeper'

/** Release every host-owned capability, including frames delivered after unmount. */
export function disposeGatekeeperFrame(frame: GatekeeperUiFrame | null) {
  for (const capability of [frame?.organizationMetrics, frame?.calendarDraftCreator, frame?.mailDraftSender, frame?.agentConsent, frame?.ui, frame?.inboxUploads?.issuer, frame?.textUploads?.issuer, frame?.textDownloads?.issuer,
    frame?.reviewDownloads?.issuer, frame?.nativeDownloads?.selector, frame?.nativeWrites?.selector]) {
    (capability as { [Symbol.dispose]?(): void } | undefined)?.[Symbol.dispose]?.()
  }
}
