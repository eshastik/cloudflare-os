import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { fileURLToPath } from 'node:url';

test('native conflict keeps head and metadata, refuses base choice and stale capability', async () => {
  let head = 'a'.repeat(64), writes = 0, downloads = 0, updates = 0, locations = 0, locationHead = 'a'.repeat(64);
  const mf = new Miniflare({ workers: [{
    name: 'mnemos', modules: true, modulesRules: [{ type: 'Text', include: ['**/*.txt'] }],
    scriptPath: fileURLToPath(new URL('../dist/mnemos.js', import.meta.url)),
    compatibilityDate: '2026-02-02', compatibilityFlags: ['allow_irrevocable_stub_storage', 'nodejs_compat'],
    bindings: { MNEMOS_API_ORIGIN: 'https://memory.example', MNEMOS_STORAGE_ORIGIN: 'https://objects.example' },
    durableObjects: { ACCOUNTS: { className: 'UserAccount', useSQLite: true } },
    outboundService: async request => {
      const url = new URL(request.url);
      assert.equal(url.origin, 'https://memory.example');
      assert.equal(request.headers.get('Authorization'), 'Bearer fixture');
      if (url.pathname === '/v1/whoami') return Response.json({ subject: { tenant_id: 'org', user_id: 'human' } });
      if (url.pathname.endsWith('/draft/nodes/location-doc/location')) {
        locations++; assert.deepEqual(await request.json(), { expected_head: 'a'.repeat(64), name: 'Renamed', parent_id: 'target' });
        locationHead = 'b'.repeat(64); return Response.json({ head: locationHead });
      }
      if (url.pathname.endsWith('/draft/nodes/location-doc')) return Response.json({ head: locationHead, node_id: 'location-doc', content_type: 'application/vnd.cloudflareos.document+json', exists: true, conflicted: false, terms: [{ present: true, negative: false, metadata: { name: 'Original', parent_id: '', content_type: 'application/vnd.cloudflareos.document+json' } }] });
      if (url.pathname.endsWith('/draft/update')) {
        updates++; assert.deepEqual(await request.json(), { expected_head: 'a'.repeat(64) });
        return updates === 1 ? Response.json({ head }) : new Response(null, { status: 409 });
      }
      if (url.pathname.endsWith('/resolve')) {
        writes++; assert.deepEqual(await request.json(), { expected_head: 'a'.repeat(64), term_index: 2 });
        head = 'b'.repeat(64); return Response.json({ head });
      }
      if (url.pathname.endsWith('/download')) { downloads++; return new Response(null, { status: 500 }); }
      if (url.pathname.endsWith('/draft/nodes/doc')) return Response.json({ head, node_id: 'doc', content_type: 'application/vnd.cloudflareos.document+json', exists: true, conflicted: true, terms: [
        { present: true, negative: false, manifest: 'private-address', metadata: { name: 'Draft', parent_id: 'folder', content_type: 'application/vnd.cloudflareos.document+json' } },
        { present: true, negative: true }, { present: false, negative: false },
      ] });
      throw new Error('Unexpected request');
    },
  }, {
    name: 'driver', modules: true, compatibilityDate: '2026-02-02', compatibilityFlags: ['allow_irrevocable_stub_storage', 'nodejs_compat'],
    durableObjects: { ACCOUNTS: { className: 'UserAccount', scriptName: 'mnemos', useSQLite: true } },
    script: `export default { async fetch(request, env) {
      const account = env.ACCOUNTS.getByName('fixture'); await account.acceptVerifiedCredential('fixture');
      const frame = await account.startAppUi(), selector = frame.nativeWrites.selector;
      const location = await selector.documentLocation('project', 'location-doc', 'cloudflareos.document');
      const moved = await selector.saveLocation('project', 'location-doc', location.head, 'Renamed', 'target', 'cloudflareos.document');
      let locationStale = false;
      try { await selector.saveLocation('project', 'location-doc', location.head, 'Renamed', 'target', 'cloudflareos.document'); } catch { locationStale = true; }
      const updated = await selector.updateDraft('project', 'a'.repeat(64));
      let updateDenied = false;
      try { await selector.updateDraft('project', 'a'.repeat(64)); } catch { updateDenied = true; }
      const conflict = await selector.selectConflict('project','doc','cloudflareos.document');
      const view = await conflict.describe(), deletion = await conflict.download(2);
      let baseDenied=false, staleDenied=false, revoked=false, updateRevoked=false;
      try { await conflict.resolve(1); } catch { baseDenied=true; }
      const saved=await conflict.resolve(2);
      try { await conflict.describe(); } catch { staleDenied=true; }
      await account.revoke();
      try { await conflict.download(0); } catch { revoked=true; }
      try { await selector.updateDraft('project', 'a'.repeat(64)); } catch { updateRevoked = true; }
      conflict[Symbol.dispose](); selector[Symbol.dispose]();
      return Response.json({view,deletion,saved,baseDenied,staleDenied,revoked,updated,updateDenied,updateRevoked,location,moved,locationStale});
    }};`,
  }] });
  try {
    const response = await (await mf.getWorker('driver')).fetch('https://driver.example/');
    assert.equal(response.status, 200);
    const out = await response.json();
    assert.equal(out.view.terms[0].metadata.name, 'Draft');
    assert.equal(out.view.terms[0].manifest, undefined);
    assert.equal(out.deletion, null);
    assert.equal(out.saved.head, 'b'.repeat(64));
    assert.ok(out.baseDenied && out.staleDenied && out.revoked);
    assert.equal(out.updated.head, 'a'.repeat(64));
    assert.ok(out.updateDenied && out.updateRevoked);
    assert.equal(updates, 2);
    assert.equal(locations, 1);
    assert.equal(out.location.name, 'Original');
    assert.equal(out.moved.head, 'b'.repeat(64));
    assert.ok(out.locationStale);
    assert.equal(writes, 1); assert.equal(downloads, 0);
  } finally { await mf.dispose(); }
});
