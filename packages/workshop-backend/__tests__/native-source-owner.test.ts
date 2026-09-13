import { expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { RpcStub, RpcTarget } from 'capnweb';
import type { ObserverConfigCallback } from '@gadgets/workshop-shared/api';
import type { Gatekeeper } from '@gadgets/workshop-shared/gatekeeper';
import type { OverseerDurableObject } from '../src/overseer.js';
import type { UserDurableObject } from '../src/user.js';

declare module 'cloudflare:workers' {
  interface ProvidedEnv { TEST_OVERSEER: DurableObjectNamespace<OverseerDurableObject>; }
}

it('verifies native data for the workspace owner and requires another participant’s own account', async () => {
  const stub = env.TEST_OVERSEER.getByName('native-owner-observer');
  await runInDurableObject(stub, async instance => {
    const impl = instance['impl'];
    const ownerId = env.TEST_OVERSEER.idFromName('owner'), peerId = env.TEST_OVERSEER.idFromName('peer');
    impl.ownerId = ownerId.toString(); impl.ownerProfileId = 'owner-profile';
    for (const id of [7, 8]) impl.storage.gatekeepers.put({ id,
      class: {} as DurableObjectClass<Gatekeeper<never>>,
      creationSpec: { type: 'gatekeeper', vendorId: 'mnemos', resourceUrl: 'https://memory.example/document', typeUrlPattern: 'https://memory.example/*' },
      ...(id === 7 ? { nativeDocumentSource: { gadgetId: 1, userId: ownerId.toString(), accountId: 3, sourceKey: 'org/document/event', publication: 'event' } } : {}),
    });
    let allowed = true;
    const verify = vi.fn(async (_observer: string, verifier: object) => { if (!allowed) throw new Error('Read revoked'); expect(verifier).toBeDefined(); });
    const facet = vi.spyOn(impl, 'getGatekeeperFacet').mockImplementation(id => {
      expect(id).toBe(7); // The owner's unrelated ordinary connection remains exempt.
      return { addObserver: verify, removeObserver: async () => {} } as Fetcher<Gatekeeper<never>>;
    });
    const ownerVerifier = vi.fn(async (account: number) => { expect(account).toBe(3); return {}; });
    const peerVerifier = vi.fn(async (account: number) => { expect(account).toBe(99); return {}; });
    const owner = { id: ownerId, getVerifier: ownerVerifier, describeConnectedAccount: async () => ({ displayName: 'Owner account' }) } as DurableObjectStub<UserDurableObject>;
    const peer = { id: peerId, getVerifier: peerVerifier, describeConnectedAccount: async () => ({ displayName: 'Peer account' }) } as DurableObjectStub<UserDurableObject>;
    class Choose extends RpcTarget implements ObserverConfigCallback {
      async configure(needs: Parameters<ObserverConfigCallback['configure']>[0]) {
        expect(needs.map(n => n.gatekeeperId)).toEqual([7]);
        return [{ gatekeeperId: 7, accountId: 99 }];
      }
    }
    const choose = new RpcStub(new Choose());
    try {
      await impl.ensureObserver('owner-profile', owner, 'build');
      expect(ownerVerifier).toHaveBeenCalledOnce();
      expect(ownerVerifier).toHaveBeenCalledWith(3, 'mnemos', 'https://memory.example/*');
      const ownerObserver = impl.storage.observers.get('owner-profile')!;
      expect(ownerObserver.accountChoices[7]).toBe(3);
      await expect(impl.authorizeObservation(7, { excludeObservers: [ownerObserver.observerId] }, { from: 'user' })).rejects.toThrow('not permitted');
      await expect(impl.ensureObserver('peer-profile', peer, 'use')).rejects.toThrow('choose connected accounts');
      expect(peerVerifier).not.toHaveBeenCalled();
      await impl.ensureObserver('peer-profile', peer, 'use', choose);
      expect(peerVerifier).toHaveBeenCalledWith(99, 'mnemos', 'https://memory.example/*');
      expect(impl.storage.observers.get('peer-profile')!.accountChoices[7]).toBe(99);
      peerVerifier.mockRejectedValueOnce(new Error('Source disabled by administrator'));
      await expect(impl.ensureObserver('peer-profile', peer, 'use')).rejects.toThrow('could not confirm');
      allowed = false;
      await expect(impl.ensureObserver('owner-profile', owner, 'build')).rejects.toThrow('could not confirm');
      await expect(impl.ensureObserver('peer-profile', peer, 'use')).rejects.toThrow('could not confirm');
    } finally { choose[Symbol.dispose](); facet.mockRestore(); }
  });
});
