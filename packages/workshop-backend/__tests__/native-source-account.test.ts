import { expect, it } from 'vitest';
import type { GatekeeperUser, NativeDocumentSource } from '@gadgets/workshop-shared/gatekeeper';
import { UserDurableObject } from '../src/user.js';
import { DEFAULT_ADMIN_CONFIG, serializeAdminConfig } from '../src/admin-config.js';

it('resolves the native source only from the selected live account and rechecks administrative policy', async () => {
  const resource = { urlPattern: 'https://memory.example/v1/projects/*/nodes/*', title: 'Document', description: '' };
  const source = { class: {} as DurableObjectClass<NativeDocumentSource>, sourceKey: '["org","doc","event"]', resource };
  let live = true, expired = false, calls = 0, config = DEFAULT_ADMIN_CONFIG;
  let duringCall = () => {};
  const account = {
    async getNativeDocumentSource(url: string, publication: string) {
      expect([url, publication]).toEqual(['document-url', 'event']); calls++; duringCall(); return source;
    },
  } as Fetcher<GatekeeperUser>;
  const user = Object.create(UserDurableObject.prototype) as UserDurableObject;
  Object.assign(user, {
    env: { BLUEPRINTS: { get: async () => serializeAdminConfig(config) } },
    storage: { connectedAccounts: { get: (id: number) => id === 7 && live ? { id, account, vendorId: 'mnemos', credentialsExpired: expired } : undefined } },
  });
  await expect(user.getNativeDocumentSource(99, 'document-url', 'event')).rejects.toThrow('unavailable');
  config = { ...DEFAULT_ADMIN_CONFIG, disabledGatekeepers: ['mnemos'] };
  await expect(user.getNativeDocumentSource(7, 'document-url', 'event')).rejects.toThrow('disabled');
  expect(calls).toBe(0);
  config = DEFAULT_ADMIN_CONFIG;
  await expect(user.getNativeDocumentSource(7, 'document-url', 'event')).resolves.toEqual({ ...source, accountId: 7, vendorId: 'mnemos' });
  duringCall = () => { live = false; };
  await expect(user.getNativeDocumentSource(7, 'document-url', 'event')).rejects.toThrow('unavailable');
  live = true; duringCall = () => { expired = true; };
  await expect(user.getNativeDocumentSource(7, 'document-url', 'event')).rejects.toThrow('unavailable');
  expired = false; duringCall = () => { config = { ...DEFAULT_ADMIN_CONFIG, disabledResources: { mnemos: [resource.urlPattern] } }; };
  await expect(user.getNativeDocumentSource(7, 'document-url', 'event')).rejects.toThrow('disabled');
  config = DEFAULT_ADMIN_CONFIG; duringCall = () => { config = { ...DEFAULT_ADMIN_CONFIG, disabledGatekeepers: ['mnemos'] }; };
  await expect(user.getNativeDocumentSource(7, 'document-url', 'event')).rejects.toThrow('disabled');
});
