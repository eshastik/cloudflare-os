import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

for (const format of ['cloudflareos.document', 'cloudflareos.presentation']) test(`${format} creation replays its exact request after Worker restart and respects revocation`, async () => {
  const persist = await mkdtemp(join(tmpdir(), 'mnemos-native-recovery-'));
  const calls = []; let uploads = 0, denied = false;
  const head = 'a'.repeat(64), result = 'b'.repeat(64);
  const options = {
    resourcePersistencePath: persist,
    workers: [{
      name: 'mnemos', modules: true, modulesRules: [{ type: 'Text', include: ['**/*.txt'] }],
      scriptPath: fileURLToPath(new URL('../dist/mnemos.js', import.meta.url)),
      compatibilityDate: '2026-02-02', compatibilityFlags: ['allow_irrevocable_stub_storage', 'nodejs_compat'],
      bindings: { MNEMOS_API_ORIGIN: 'https://memory.example', MNEMOS_STORAGE_ORIGIN: 'https://objects.example' },
      durableObjects: { ACCOUNTS: { className: 'UserAccount', useSQLite: true } },
      outboundService: async request => {
        assert.equal(request.headers.get('Authorization'), 'Bearer fixture-human-token');
        const path = new URL(request.url).pathname;
        if (path === '/v1/whoami') return Response.json({ subject: { tenant_id: 'org', user_id: 'alice' } });
        if (path === '/v1/projects/project/draft/open') return Response.json({ head });
        if (path === '/v1/uploads') {
          uploads++; const body = await request.json();
          return Response.json({ upload_id: 'upload', url: 'https://objects.example/object', method: 'PUT',
            checksum_header: 'x-amz-checksum-sha256', checksum_value: body.checksum_sha256, content_length: body.size_bytes });
        }
        assert.equal(path, '/v1/projects/project/draft/create');
        if (denied) return new Response(null, { status: 403 });
        calls.push(await request.json());
        // The upstream operation committed, but its response was lost.
        if (calls.length === 1) return new Response(null, { status: 503 });
        return Response.json({ node_id: 'created-doc', head: result });
      },
    }, {
      name: 'driver', modules: true, compatibilityDate: '2026-02-02', compatibilityFlags: ['allow_irrevocable_stub_storage', 'nodejs_compat'],
      durableObjects: { ACCOUNTS: { className: 'UserAccount', scriptName: 'mnemos', useSQLite: true } },
      script: `export default { async fetch(request, env) {
        const account = env.ACCOUNTS.get(env.ACCOUNTS.idFromName('owner'));
        await account.acceptVerifiedCredential('fixture-human-token');
        using frame = await account.startAppUi();
        const format = ${JSON.stringify(format)};
        if (new URL(request.url).pathname === '/prepare') {
          using writer = await frame.nativeWrites.selector.create('project', 'Recovered document', format);
          const head = await writer.head();
          const ticket = await writer.issue(head, 4, 'A'.repeat(43) + '=');
          const receipt = await writer.checkpoint(head, ticket.upload_id);
          let lost = false;
          try { await writer.save(head, ticket.upload_id); } catch { lost = true; }
          return Response.json({ receipt, lost });
        }
        const { receipt } = await request.json();
        using writer = await frame.nativeWrites.selector.resumeCreation(receipt, format);
        const state = await writer.recoveryState();
        if (new URL(request.url).pathname === '/denied') {
          let rejected = false; try { await writer.save(state.head, state.uploadId); } catch { rejected = true; }
          return Response.json({ rejected });
        }
        let changedUpload = false, wrongFormat = false, otherAccount = false;
        try { await writer.save(state.head, 'different-upload'); } catch { changedUpload = true; }
        try { using invalid = await frame.nativeWrites.selector.resumeCreation(receipt, 'cloudflareos.spreadsheet'); } catch { wrongFormat = true; }
        const other = env.ACCOUNTS.get(env.ACCOUNTS.idFromName('other'));
        await other.acceptVerifiedCredential('fixture-human-token');
        using otherFrame = await other.startAppUi();
        try { using invalid = await otherFrame.nativeWrites.selector.resumeCreation(receipt, format); } catch { otherAccount = true; }
        let unsaved = false; try { await writer.document(); } catch { unsaved = true; }
        const head = await writer.save(state.head, state.uploadId);
        const document = await writer.document();
        await account.revoke();
        let revoked = false; try { await writer.save(state.head, state.uploadId); } catch { revoked = true; }
        return Response.json({ head, document, unsaved, changedUpload, wrongFormat, otherAccount, revoked });
      }};`,
    }],
  };
  let mf, stage = "prepare";
  try {
    mf = new Miniflare(options);
    let driver = await mf.getWorker('driver');
    const prepared = await (await driver.fetch('https://driver.example/prepare')).json();
    assert.equal(prepared.lost, true); assert.equal(typeof prepared.receipt, 'string');
    await mf.dispose(); mf = undefined;
    mf = new Miniflare(options); driver = await mf.getWorker('driver');
    stage = "restart-and-resume";
    const replay = await (await driver.fetch('https://driver.example/resume', { method: 'POST', body: JSON.stringify({ receipt: prepared.receipt }) })).json();
    assert.deepEqual(replay, { head: result, document: 'created-doc', unsaved: true, changedUpload: true, wrongFormat: true, otherAccount: true, revoked: true });
    assert.equal(uploads, 1); assert.equal(calls.length, 2); assert.deepEqual(calls[0], calls[1]);
    assert.equal(calls[0].expected_head, head); assert.equal(calls[0].upload_id, 'upload');
    assert.match(calls[0].request_id, /^[0-9a-f-]{36}$/);
    stage = "upstream-revocation";
    denied = true;
    assert.deepEqual(await (await driver.fetch('https://driver.example/denied', { method: 'POST', body: JSON.stringify({ receipt: prepared.receipt }) })).json(), { rejected: true });
    assert.equal(calls.length, 2);
  } catch (error) { throw new Error(stage, { cause: error }); } finally { await mf?.dispose(); await rm(persist, { recursive: true, force: true }); }
});
