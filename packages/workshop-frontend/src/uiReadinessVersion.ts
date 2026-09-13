import { readUIReadinessClientVersion } from "@gadgets/workshop-shared/ui-readiness";

/** Fingerprint this collector entry; dev URLs and missing metadata remain unknown. */
export function collectorClientVersion(): string | undefined {
  if (typeof document === "undefined") return undefined;
  try {
    const policy = document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content");
    const paths = [...document.querySelectorAll('script[type="module"][src]')].map(script => new URL(script.getAttribute("src")!, document.baseURI).pathname);
    return readUIReadinessClientVersion(policy, paths);
  } catch { return undefined; }
}
