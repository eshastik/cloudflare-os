// Описание аккаунта Mnemos для меню оболочки. Оно запрашивается при каждом открытии меню, поэтому
// не должно ходить в Mnemos лишний раз и не должно ждать долгих подсчётов.

export type SourceKind = "mail" | "calendar" | "drive";
export type SourceOwner = { tenant: string; owner: string; epoch: string };
type Health = { enabled: boolean; last_error_at?: string | null };

/**
 * Источники с ошибкой под уже проверенной личностью. Прежде каждый локальный источник проверял личность
 * сам, до и после чтения: семь whoAmI подряд на каждое описание. owner = null — личности для источников
 * нет (агент или подключение снято), все локальные источники считаются неисправными. Смену подключения
 * за время чтения ловит epochChanged: тогда неисправны все, как раньше при провале повторной проверки.
 * Порядок как прежде: локальные по порядку, затем удалённые, если их вида ещё нет.
 */
export async function sourceErrorsFor(input: {
  owner: SourceOwner | null;
  local: ReadonlyArray<readonly [SourceKind, (owner: SourceOwner) => { accounts: Health[] } | Promise<{ accounts: Health[] }>]>;
  remote: ReadonlyArray<readonly [SourceKind, () => Promise<{ connections: Health[] }>]>;
  epochChanged: () => boolean;
}): Promise<SourceKind[]> {
  const errors = new Set<SourceKind>();
  const broken = (item: Health) => !item.enabled || !!item.last_error_at;
  for (const [kind, read] of input.local) {
    try { if (!input.owner || (await read(input.owner)).accounts.some(broken)) errors.add(kind); }
    catch { errors.add(kind); }
  }
  const remote = await Promise.allSettled(input.remote.map(([, read]) => read()));
  remote.forEach((result, index) => {
    if (result.status === "rejected" || result.value.connections.some(broken)) errors.add(input.remote[index][0]);
  });
  if (input.epochChanged()) for (const kind of ["mail", "calendar", "drive"] as const) errors.add(kind);
  return [...errors];
}

/** Посчитанный в фоне счётчик «Входящих» для меню оболочки. */
export const MENU_INBOX_KEY = "menuInboxCount";
/** Счётчик старше этого пересчитывается в фоне, а оболочка перечитывает меню один раз. */
export const MENU_COUNT_REFRESH_MS = 30_000;
/** Счётчик старше этого не показывается совсем. */
export const MENU_COUNT_MAX_AGE_MS = 10 * 60_000;

type SavedCount = { userId: string; inbox: number; at: number };

/**
 * Счётчик «Входящих» считается до 1,5 с и раньше держал всё описание. Теперь меню получает последнее
 * посчитанное значение сразу, а пересчёт идёт в фоне (один на аккаунт). pending — значения нет или оно
 * старое: оболочка перечитает меню один раз позже и увидит свежее.
 */
export function menuInboxCount(input: {
  storage: { get<T>(key: string): T | undefined; put<T>(key: string, value: T): void };
  userId: string;
  now: number;
  count: () => Promise<{ inbox: number } | undefined>;
  refresh: { current?: Promise<void> };
  keepAlive: (work: Promise<void>) => void;
}): { inbox?: number; pending: boolean } {
  const saved = input.storage.get<SavedCount>(MENU_INBOX_KEY);
  const mine = saved?.userId === input.userId ? saved : undefined;
  const age = mine ? input.now - mine.at : Infinity;
  const pending = age > MENU_COUNT_REFRESH_MS;
  if (pending && !input.refresh.current) {
    const work = input.count()
      .then(counts => { if (counts) input.storage.put<SavedCount>(MENU_INBOX_KEY, { userId: input.userId, inbox: counts.inbox, at: Date.now() }); })
      .catch(() => {})
      .finally(() => { if (input.refresh.current === work) input.refresh.current = undefined; });
    input.refresh.current = work;
    input.keepAlive(work);
  }
  return { inbox: mine && age <= MENU_COUNT_MAX_AGE_MS ? mine.inbox : undefined, pending };
}
