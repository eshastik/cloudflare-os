import type {AccountStorage} from './account-session.ts';
import {storedAccountOwner} from './account-identity.ts';
import type {ConnectionAuditEvent} from './connection-audit-storage.ts';

/** Separate key namespaces preserve the purpose of existing encrypted receipts. */
export const recoveryKeyNames = {
  'native-creation-key': 'nativeCreationRecoveryKeyV1',
  'office-update-key': 'nativeOfficeUpdateRecoveryKeyV1',
} as const;
interface KeyRecord {
  bytes: Uint8Array;
  audit_account_id: string;
  owner: {tenant: string; user: string};
  connection_audit: ConnectionAuditEvent[];
}

/** Persist a new key and its creation event together, before encryption awaits.
 * Legacy keys remain readable without inventing a historical creation event. */
export function recoveryKey(storage: AccountStorage, purpose: keyof typeof recoveryKeyNames, create: boolean): Uint8Array {
  const name = recoveryKeyNames[purpose];
  const saved = storage.get<Uint8Array | KeyRecord>(name);
  const owner = storedAccountOwner(storage);
  if (saved instanceof Uint8Array) {
    if (saved.length !== 32) throw Error('Recovery key unavailable');
    return saved;
  }
  if (saved) {
    if (!owner || saved.owner.tenant !== owner.tenant || saved.owner.user !== owner.user || !(saved.bytes instanceof Uint8Array) || saved.bytes.length !== 32) throw Error('Recovery key unavailable');
    return saved.bytes;
  }
  if (!create || !owner) throw Error('Recovery key unavailable');
  const bytes = crypto.getRandomValues(new Uint8Array(32)), id = crypto.randomUUID();
  const event: ConnectionAuditEvent = {event_id: crypto.randomUUID(), protocol: purpose, account_id: id,
    tenant_id: owner.tenant, owner_id: owner.user, phase: 'created', observed_at: new Date().toISOString()};
  storage.put(name, {bytes, owner, audit_account_id: id, connection_audit: [event]} satisfies KeyRecord);
  return bytes;
}
