/** Persisted, bounded accounting of trusted-shell activity for one user. */
export interface WorkspaceActivityState {
  sessions: number;
  activeMs: number;
  sessionElapsedMs: number;
  lastActiveAt: number | null;
  sessionStartedAt: number | null;
  accountedUntil: number;
  streams: Record<string, { sequence: number; at: number; active: boolean }>;
}

const SESSION_IDLE_MS = 30 * 60_000;
const MAX_SAMPLE_GAP_MS = 30_000;

/** Empty state means no observed workspace activity, irrespective of login age. */
export function emptyWorkspaceActivity(): WorkspaceActivityState {
  return { sessions: 0, activeMs: 0, sessionElapsedMs: 0, lastActiveAt: null, sessionStartedAt: null, accountedUntil: 0, streams: {} };
}

/** Apply a sequenced heartbeat using server time; retries and overlapping tabs add no duplicate time.
 * This is diagnostic activity reporting, never an authorization or employee-ranking input.
 */
export function recordWorkspaceActivity(previous: WorkspaceActivityState, stream: string, sequence: number, active: boolean, now: number): WorkspaceActivityState {
  if (!/^[a-f0-9]{32}$/.test(stream) || !Number.isSafeInteger(sequence) || sequence < 1 || typeof active !== "boolean" || !Number.isSafeInteger(now) || now < 0) throw new Error("Invalid activity sample");
  const old = previous.streams[stream];
  if (old && (sequence <= old.sequence || now < old.at)) return previous;
  const state = { ...previous, streams: { ...previous.streams } };
  for (const [id, sample] of Object.entries(state.streams)) {
    if (now - sample.at > SESSION_IDLE_MS) delete state.streams[id];
  }
  if (!state.streams[stream] && Object.keys(state.streams).length >= 32) return previous;
  state.streams[stream] = { sequence, at: now, active };
  if (!active) return state;
  if (state.lastActiveAt === null || now - state.lastActiveAt > SESSION_IDLE_MS) {
    state.sessions++;
    state.sessionStartedAt = now;
  } else {
    state.sessionElapsedMs += Math.max(0, now - state.lastActiveAt);
  }
  state.lastActiveAt = Math.max(state.lastActiveAt ?? now, now);
  // Count only continuously observed active intervals; reconnect/sleep gaps add nothing.
  if (old?.active && now - old.at <= MAX_SAMPLE_GAP_MS) {
    state.activeMs += Math.max(0, now - Math.max(old.at, state.accountedUntil));
  }
  state.accountedUntil = Math.max(state.accountedUntil, now);
  return state;
}
