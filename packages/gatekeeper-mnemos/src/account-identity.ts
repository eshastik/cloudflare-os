import type {AccountStorage} from './account-session.ts';

/** Identity pinned by successful Mnemos verification, including after disconnect. */
export interface StoredAccountOwner {tenant: string; user: string}

/** Prefer the atomic credential record; old separate owner records remain readable. */
export function storedAccountOwner(storage: AccountStorage): StoredAccountOwner | undefined {
  return storage.get<{owner?: StoredAccountOwner}>('mnemosCredential')?.owner
    ?? storage.get<StoredAccountOwner>('mnemosAccountOwner');
}
