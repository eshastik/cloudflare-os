import { expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import type { Gatekeeper } from '@gadgets/workshop-shared/gatekeeper';
import type { OverseerDurableObject } from '../src/overseer.js';

declare module 'cloudflare:workers' {
  interface ProvidedEnv { TEST_OVERSEER: DurableObjectNamespace<OverseerDurableObject>; }
}

it('retains imported source checks without bindings and releases the read barrier only after restart', async () => {
  const stub = env.TEST_OVERSEER.getByName('native-source-provenance');
  await runInDurableObject(stub, async instance => {
    const impl = instance['impl'];
    impl.storage.gadgets.put({ id: 1, title: 'Document', created: new Date(), bindingName: 'DOC', bindings: {} });
    impl.storage.gatekeepers.put({ id: 7, class: {} as DurableObjectClass<Gatekeeper<never>>,
      creationSpec: { type: 'gatekeeper', vendorId: 'mnemos', resourceUrl: 'https://memory.example/document', typeUrlPattern: 'https://memory.example/*' },
      nativeDocumentSource: { gadgetId: 1, userId: 'initiator', accountId: 2, sourceKey: 'org/doc/event', publication: 'event' },
    });
    impl.freshNativeDocumentSources.add(7);
    expect(impl.listObserverRequirements('use').map(r => r.gatekeeperId)).toEqual([7]);
    expect(impl.listObserverRequirements('build').map(r => r.gatekeeperId)).toEqual([7]);
    expect(() => impl.removeGatekeeper(7)).toThrow('cannot be removed');
    expect(() => impl.assertNativeDocumentSourceReady(7, 1, 'initiator')).toThrow('Reconnect');
    expect(() => impl.assertNativeDocumentSourceReady(7, 1, 'another-user')).toThrow('Invalid');
    expect(() => impl.assertNativeDocumentSourceReady(8, 1, 'initiator')).toThrow('Invalid');
  });
  await expect(runInDurableObject(stub, (_instance, state) => { state.abort('fixture reconnect barrier'); })).rejects.toThrow();
  const reconnected = env.TEST_OVERSEER.getByName('native-source-provenance');
  await runInDurableObject(reconnected, async instance => {
    const impl = instance['impl'];
    expect(impl.assertNativeDocumentSourceReady(7, 1, 'initiator').pin.sourceKey).toBe('org/doc/event');
    impl.storage.gadgets.delete(1);
    expect(impl.listObserverRequirements('use').map(r => r.gatekeeperId)).toEqual([7]);
    expect(() => impl.removeGatekeeper(7)).toThrow('cannot be removed');
    expect(() => impl.assertNativeDocumentSourceReady(7, 1, 'initiator')).toThrow();
  });
});
