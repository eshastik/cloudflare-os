import type { AccountStorage } from './account-session.ts';
/** No credentials, source contents or provider error text are stored here. */
export interface SourceLoadHealth { last_success_at?: string; last_error_at?: string }
export function sourceHealth(storage: AccountStorage, kind: string, id: string, generation: string): SourceLoadHealth {
  return storage.get<SourceLoadHealth>(`sourceHealth:${kind}:${id}:${generation}`) ?? {};
}
/** Call only after validating the selected source; fence again before returning its data. */
export async function observeSourceRead<T>(storage: AccountStorage, kind: string, id: string, generation: string, read: () => Promise<T>): Promise<T> {
  const key = `sourceHealth:${kind}:${id}:${generation}`;
  try {
    const value = await read();
    storage.put(key, { last_success_at: new Date().toISOString() });
    return value;
  } catch (error) {
    storage.put(key, { ...sourceHealth(storage,kind,id,generation), last_error_at: new Date().toISOString() });
    throw error;
  }
}
