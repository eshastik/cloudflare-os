import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { fileURLToPath } from 'node:url';

test('native picker pages account-scoped metadata without issuing content and stops after revoke', async () => {
  let calls = 0;
  const mf = new Miniflare({ workers: [{
    name: 'mnemos', modules: true, modulesRules: [{ type: 'Text', include: ['**/*.txt'] }],
    scriptPath: fileURLToPath(new URL('../dist/mnemos.js', import.meta.url)),
    compatibilityDate: '2026-02-02', compatibilityFlags: ['allow_irrevocable_stub_storage', 'nodejs_compat'],
    bindings: { MNEMOS_API_ORIGIN: 'https://memory.example', MNEMOS_STORAGE_ORIGIN: 'https://objects.example' },
    durableObjects: { ACCOUNTS: { className: 'UserAccount', useSQLite: true } },
    outboundService: async request => {
      calls++;
      const url = new URL(request.url);
      assert.equal(url.origin, 'https://memory.example');
      assert.equal(request.headers.get('Authorization'), 'Bearer fixture');
      assert.equal(request.method, 'GET');
      if (url.pathname === '/v1/whoami') return Response.json({ subject: { tenant_id: 'org', user_id: 'human' } });
      if (url.pathname === '/v1/projects') return Response.json({ projects: [{ id: 'project', name: 'Team' }] });
      if (url.pathname.endsWith('/nodes')) {
        assert.equal(url.searchParams.get('cursor'), 'documents-page');
        return Response.json({ nodes: [{ node_id: 'document', name: 'Plan', is_dir: false, shared_deleted: true }, { node_id: 'folder', name: 'Folder', is_dir: true }], next_cursor: 'more-documents', truncated: true });
      }
      if(url.pathname.endsWith('/private-versions'))return Response.json({versions:[]});
      if(url.pathname.endsWith('/draft/invitations'))return Response.json({documents:[],next_cursor:''});
      if (url.pathname.endsWith('/draft/nodes/document')) return Response.json({ head: 'a'.repeat(64), node_id: 'document', exists: false, conflicted: false });
      assert.equal(url.pathname, '/v1/projects/project/nodes/document/history', 'no content or ticket route may be called');
      if (!url.searchParams.get('cursor')) return Response.json({ events: [{ event_id: 'latest-deletion', exists: false }], next_cursor: 'history-page' });
      assert.equal(url.searchParams.get('cursor'), 'history-page');
      return Response.json({ events: [
        { event_id: 'native', exists: true, content_type: 'application/vnd.cloudflareos.document+json', recorded_at: '2026-09-07T12:00:00Z', actor: 'human' },
        { event_id: 'deleted', exists: false, content_type: 'application/vnd.cloudflareos.document+json' },
        { event_id: 'plain', exists: true, content_type: 'text/plain' },
      ], next_cursor: 'more-history' });
    },
  }, {
    name: 'driver', modules: true, compatibilityDate: '2026-02-02', compatibilityFlags: ['allow_irrevocable_stub_storage', 'nodejs_compat'],
    durableObjects: { ACCOUNTS: { className: 'UserAccount', scriptName: 'mnemos', useSQLite: true } },
    script: `export default { async fetch(request, env) {
      const account = env.ACCOUNTS.getByName('fixture'); await account.acceptVerifiedCredential('fixture');
      const frame = await account.startAppUi(), selector = frame.nativeDownloads.selector;
      const scopes = await selector.scopes(), documents = await selector.documents('project', 's:documents-page');
      const current = await selector.publications('project', 'document', '');
      const publications = await selector.publications('project', 'document', 'history-page');
      let invalid = false, revoked = false;
      try { await selector.publications('../project', 'document', ''); } catch { invalid = true; }
      await account.revoke();
      try { await selector.publications('project', 'document', 'history-page'); } catch { revoked = true; }
      selector[Symbol.dispose]();
      return Response.json({ scopes, documents, current, publications, invalid, revoked });
    }};`,
  }] });
  try {
    const response = await (await mf.getWorker('driver')).fetch('https://driver.example/');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      scopes: { scopes: [{ id: 'project', name: 'Team' }] },
      documents: { documents: [{ id: 'document', name: 'Plan', sharedDeleted: true }], nextCursor: 's:more-documents', truncated: true },
      current: { historyLimited:false, resourceUrl: 'https://memory.example/v1/projects/project/nodes/document', sharedDeleted: true, publications: [], nextCursor: 'history-page' },
      publications: { historyLimited:false, resourceUrl: 'https://memory.example/v1/projects/project/nodes/document', publications: [{ id: 'native', recordedAt: '2026-09-07T12:00:00Z', actor: 'human', format: 'cloudflareos.document' }], nextCursor: 'more-history' },
      invalid: true, revoked: true,
    });
    assert.equal(calls, 8);
  } finally { await mf.dispose(); }
});

test('private history continues through an empty page and reaches published history without losing versions', async () => {
  const requests = [];
  const head = i => i.toString(16).padStart(64, '0');
  const mime = 'application/vnd.cloudflareos.document+json';
  const mf = new Miniflare({ workers: [{
    name: 'mnemos', modules: true, modulesRules: [{type: 'Text', include: ['**/*.txt']}],
    scriptPath: fileURLToPath(new URL('../dist/mnemos.js', import.meta.url)),
    compatibilityDate: '2026-02-02', compatibilityFlags: ['allow_irrevocable_stub_storage', 'nodejs_compat'],
    bindings: {MNEMOS_API_ORIGIN: 'https://memory.example', MNEMOS_STORAGE_ORIGIN: 'https://objects.example'},
    durableObjects: {ACCOUNTS: {className: 'UserAccount', useSQLite: true}},
    outboundService: async request => {
      const url = new URL(request.url);
      assert.equal(url.origin, 'https://memory.example');
      assert.equal(request.headers.get('Authorization'), 'Bearer fixture');
      assert.equal(request.method, 'GET');
      requests.push(url.pathname + url.search);
      if (url.pathname === '/v1/whoami') return Response.json({subject: {tenant_id: 'org', user_id: 'human'}});
      if (url.pathname.endsWith('/private-versions')) {
        const cursor = url.searchParams.get('cursor') || '';
        if (!cursor) return Response.json({versions: Array.from({length: 50}, (_, i) => ({head: head(i + 1), content_type: mime, recorded_at: '2026-09-11T12:00:00Z'})), next_cursor: head(50), limited: true});
        if (cursor === head(50)) return Response.json({versions: [], next_cursor: head(100), limited: true});
        assert.equal(cursor, head(100));
        return Response.json({versions: [{head: head(101), content_type: mime, recorded_at: '2026-09-10T12:00:00Z'}], limited: true});
      }
      if (url.pathname.endsWith('/draft/nodes/document')) return Response.json({head: head(1), node_id: 'document', exists: true, conflicted: false, recorded_by: {actor: 'human', on_behalf_of: ''}});
      if (url.pathname.endsWith('/draft/invitations')) return Response.json({documents: [], next_cursor: ''});
      assert.equal(url.pathname, '/v1/projects/project/nodes/document/history', 'history listing must not download content');
      assert.equal(url.searchParams.get('cursor') || '', '', 'the private cursor must never reach published history');
      return Response.json({events: [{event_id: 'published', exists: true, content_type: mime, recorded_at: '2026-09-09T12:00:00Z', actor: 'human'}]});
    },
  }, {
    name: 'driver', modules: true, compatibilityDate: '2026-02-02', compatibilityFlags: ['allow_irrevocable_stub_storage', 'nodejs_compat'],
    durableObjects: {ACCOUNTS: {className: 'UserAccount', scriptName: 'mnemos', useSQLite: true}},
    script: `export default {async fetch(request, env) {
      const account = env.ACCOUNTS.getByName('fixture'); await account.acceptVerifiedCredential('fixture');
      const frame = await account.startAppUi(), selector = frame.nativeDownloads.selector;
      const pages = []; let cursor = '';
      try {
        do { const page = await selector.publications('project', 'document', cursor); pages.push(page); cursor = page.nextCursor; } while (cursor && pages.length < 6);
        return Response.json(pages);
      } finally { selector[Symbol.dispose](); }
    }};`,
  }]});
  try {
    const response = await (await mf.getWorker('driver')).fetch('https://driver.example/');
    assert.equal(response.status, 200);
    const pages = await response.json();
    assert.deepEqual(pages.map(p => p.publications.length), [50, 0, 1, 1]);
    assert.deepEqual(pages.map(p => p.nextCursor), ['private-history:' + head(50), 'private-history:' + head(100), 'published-history:', '']);
    assert.deepEqual(pages.slice(0, 3).map(p => p.historyLimited), [true, true, true]);
    assert.deepEqual(pages[0].publications[0].recordedBy, {actor: 'human', onBehalfOf: ''});
    assert.deepEqual(pages.flatMap(p => p.publications.map(v => v.id)), [...Array.from({length: 50}, (_, i) => 'private:' + head(i + 1)), 'private:' + head(101), 'published']);
    assert.equal(requests.filter(p => p.includes('/draft/invitations')).length, 1);
    assert.equal(requests.filter(p => p.includes('/nodes/document/history')).length, 1);
  } catch (error) {
    throw new Error('Private history requests: ' + JSON.stringify(requests), {cause: error});
  } finally { await mf.dispose(); }
});
