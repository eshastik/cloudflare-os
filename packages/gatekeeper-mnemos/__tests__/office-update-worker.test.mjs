import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('office update replays its exact request after Worker restart and respects revocation', async () => {
  const persist = await mkdtemp(join(tmpdir(), 'mnemos-office-update-'));
  const calls = []; let uploads = 0, denied = false, auditOffline = true;
  const keyEvents = new Map(), bridgeToken = 's'.repeat(40);
  const head = 'a'.repeat(64), result = 'b'.repeat(64);
 const baseline={source_node_id:'original',source_head:head,source_sha256:'f'.repeat(64),output_sha256:'1'.repeat(64),unsupported:[]};
 const comparison={node_id:'target',head,current_sha256:'e'.repeat(64),outcome:'conflict',baseline,incoming:{preview_id:'converted',source_node_id:'source',source_head:head,source_sha256:'c'.repeat(64),sha256_hex:'d'.repeat(64),content_type:'application/vnd.cloudflareos.document+json',method:'GET',size_bytes:4,unsupported:['styles'],url:'https://objects.example/preview'}};
  const options = {
    resourcePersistencePath: persist,
    workers: [{
      name: 'mnemos', modules: true, modulesRules: [{ type: 'Text', include: ['**/*.txt'] }],
      scriptPath: fileURLToPath(new URL('../dist/mnemos.js', import.meta.url)),
      compatibilityDate: '2026-02-02', compatibilityFlags: ['allow_irrevocable_stub_storage', 'nodejs_compat'],
      bindings: { MNEMOS_CALENDAR_BRIDGE_TOKEN: bridgeToken, MNEMOS_API_ORIGIN: 'https://memory.example', MNEMOS_STORAGE_ORIGIN: 'https://objects.example' },
      durableObjects: { ACCOUNTS: { className: 'UserAccount', useSQLite: true } },
      outboundService: async request => {
        const path = new URL(request.url).pathname;
        if(path.startsWith('/v1/internal/connection-audit/')){
          assert.equal(request.headers.get('Authorization'),'Bearer '+bridgeToken);
          if(auditOffline)return new Response('',{status:503});
          const e=await request.json();
          if(e.protocol==='office-update-key'){
            assert.equal(e.owner_id,'alice');assert.equal(e.tenant_id,'org');assert.equal(e.phase,'created');
            assert.deepEqual(Object.keys(e).sort(),['account_id','event_id','observed_at','owner_id','phase','protocol','tenant_id']);
            if(keyEvents.has(e.event_id))assert.deepEqual(keyEvents.get(e.event_id),e);keyEvents.set(e.event_id,e);
          }else assert.equal(e.protocol,'account');
          return Response.json({event_id:e.event_id});
        }
        assert.equal(request.headers.get('Authorization'), 'Bearer fixture-human-token');
        if (path === '/v1/whoami') return Response.json({ subject: { tenant_id: 'org', user_id: 'alice' } });
        if(path==='/v1/projects/project/draft/nodes/target')return Response.json({node_id:'target',head,terms:[{metadata:{name:'Copy.cfdoc'}}]});
        if(path.endsWith('/office-origin'))return Response.json(baseline);
        if(path.endsWith('/access'))return Response.json({node_id:'source',head});
        if(path.endsWith('/office/update-comparison'))return Response.json(comparison);
        if(path.endsWith('/office/update-prepare')){
          const body=await request.json();assert.equal(body.decision.current_sha256,comparison.current_sha256);assert.equal(body.decision.output_sha256,comparison.incoming.sha256_hex);assert.equal(body.decision.accept_unsupported,true);assert.equal(body.decision.replace_local,true);
          return Response.json({update_id:'frozen',comparison});
        }
        if (path === '/v1/uploads') {
          uploads++; const body = await request.json();
          return Response.json({ upload_id: 'upload', url: 'https://objects.example/object', method: 'PUT',
            checksum_header: 'x-amz-checksum-sha256', checksum_value: body.checksum_sha256, content_length: body.size_bytes });
        }
        assert.equal(path, '/v1/projects/project/draft/nodes/target/office/update');
        if (denied) return new Response(null, { status: 403 });
        calls.push(await request.json());
        // The upstream operation committed, but its response was lost.
        if (calls.length === 1) return new Response(null, { status: 503 });
        return Response.json({ node_id: 'target', head: result });
      },
    }, {
      name: 'driver', modules: true, compatibilityDate: '2026-02-02', compatibilityFlags: ['allow_irrevocable_stub_storage', 'nodejs_compat'],
      durableObjects: { ACCOUNTS: { className: 'UserAccount', scriptName: 'mnemos', useSQLite: true } },
      script: `export default { async fetch(request, env) {
        const account = env.ACCOUNTS.get(env.ACCOUNTS.idFromName('owner'));
        await account.acceptVerifiedCredential('fixture-human-token');
        using frame = await account.startAppUi();
        const format = 'cloudflareos.document';
        if (new URL(request.url).pathname === '/prepare') {
          using review=await frame.nativeWrites.selector.reviewOfficeUpdate('project','target','source',format,'a'.repeat(64),'c'.repeat(64));
          const summary=await review.describe();if(summary.outcome!=='conflict')throw Error('missing comparison');
          using writer = await review.prepare(true,true);
          const head = await writer.head();
          const ticket = await writer.issue(head, 4, 'A'.repeat(43) + '=');
          const receipt = await writer.checkpoint(head, ticket.upload_id);
          let lost = false;
          try { await writer.save(head, ticket.upload_id); } catch { lost = true; }
          return Response.json({ receipt, lost });
        }
        const { receipt } = await request.json();
        using writer = await frame.nativeWrites.selector.resumeOfficeUpdate(receipt, format);
        const state = await writer.recoveryState();
        if (new URL(request.url).pathname === '/denied') {
          let rejected = false; try { await writer.save(state.head, state.uploadId); } catch { rejected = true; }
          return Response.json({ rejected });
        }
        let changedUpload = false, wrongFormat = false, otherAccount = false;
        try { await writer.save(state.head, 'different-upload'); } catch { changedUpload = true; }
        try { using invalid = await frame.nativeWrites.selector.resumeOfficeUpdate(receipt, 'cloudflareos.spreadsheet'); } catch { wrongFormat = true; }
        const other = env.ACCOUNTS.get(env.ACCOUNTS.idFromName('other'));
        await other.acceptVerifiedCredential('fixture-human-token');
        using otherFrame = await other.startAppUi();
        try { using invalid = await otherFrame.nativeWrites.selector.resumeOfficeUpdate(receipt, format); } catch { otherAccount = true; }
        const head = await writer.save(state.head, state.uploadId);
        await account.revoke();
        let revoked = false; try { await writer.save(state.head, state.uploadId); } catch { revoked = true; }
        return Response.json({ head, changedUpload, wrongFormat, otherAccount, revoked });
      }};`,
    }],
  };
  let mf, stage = "prepare";
  try {
    mf = new Miniflare(options);
    let driver = await mf.getWorker('driver');
    const prepared = await (await driver.fetch('https://driver.example/prepare')).json();
    assert.equal(prepared.lost, true); assert.equal(typeof prepared.receipt, 'string');
    await mf.dispose(); mf = undefined; auditOffline = false;
    mf = new Miniflare(options); driver = await mf.getWorker('driver');
    stage = "restart-and-resume";
    const replay = await (await driver.fetch('https://driver.example/resume', { method: 'POST', body: JSON.stringify({ receipt: prepared.receipt }) })).json();
    assert.deepEqual(replay, { head: result, changedUpload: true, wrongFormat: true, otherAccount: true, revoked: true });
    assert.equal(uploads, 1); assert.equal(calls.length, 2); assert.deepEqual(calls[0], calls[1]);
    assert.equal(calls[0].update_id, 'frozen'); assert.equal(calls[0].upload_id, 'upload');
    assert.match(calls[0].request_id, /^[0-9a-f-]{36}$/);
    stage = "upstream-revocation";
    denied = true;
    assert.deepEqual(await (await driver.fetch('https://driver.example/denied', { method: 'POST', body: JSON.stringify({ receipt: prepared.receipt }) })).json(), { rejected: true });
    assert.equal(calls.length, 2);
    for(let i=0;i<100&&keyEvents.size===0;i++)await new Promise(r=>setTimeout(r,50));
    assert.equal(keyEvents.size,1,'one key creation delivered after restart and account revoke');
  } catch (error) { throw new Error(stage, { cause: error }); } finally { await mf?.dispose(); await rm(persist, { recursive: true, force: true }); }
});
