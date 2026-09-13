/** Renew access while a session is alive; failure or an overdue check expires it once. */
export function maintainAccessLease(check: () => Promise<void>, expire: () => void,
    renewAfterMs = 15_000, expiresAfterMs = 30_000): () => void {
  let stopped = false;
  let renewal: ReturnType<typeof setTimeout>;
  let deadline: ReturnType<typeof setTimeout>;
  function stop() {
    stopped = true;
    clearTimeout(renewal); clearTimeout(deadline);
  }
  function expired() {
    if (stopped) return;
    stop(); expire();
  }
  function schedule() {
    deadline = setTimeout(expired, expiresAfterMs);
    renewal = setTimeout(() => {
      void Promise.resolve().then(check).then(() => {
        if (stopped) return;
        clearTimeout(deadline); schedule();
      }, expired);
    }, renewAfterMs);
  }
  schedule();
  return stop;
}
