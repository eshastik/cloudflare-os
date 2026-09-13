import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { newWebSocketRpcSession } from 'capnweb';

test('native source retains observer checks across facet restart and never grants an agent session', async () => {
  let tickets = 0;
  const mf = new Miniflare({ workers: [{
    name: 'mnemos', modules: true, modulesRules: [{ type: 'Text', include: ['**/*.txt'] }],
    scriptPath: fileURLToPath(new URL('../dist/mnemos.js', import.meta.url)),
    compatibilityDate: '2026-02-02', compatibilityFlags: ['experimental', 'allow_irrevocable_stub_storage'],
    bindings: { MNEMOS_API_ORIGIN: 'https://memory.example', MNEMOS_STORAGE_ORIGIN: 'https://objects.example' },
    durableObjects: { ACCOUNTS: { className: 'UserAccount', useSQLite: true } },
    outboundService: async request => {
      const path = new URL(request.url).pathname, token = request.headers.get('Authorization');
      if (path === '/v1/whoami') return Response.json({ subject: { tenant_id: token === 'Bearer foreign' ? 'foreign' : 'org', user_id: token === 'Bearer owner' ? 'owner' : 'observer' } });
      if (path.endsWith('/access')) return Response.json({ node_id: 'document', event_id: 'event' }, { status: token === 'Bearer denied' ? 403 : 200 });
      assert.equal(token, 'Bearer owner', 'only the initiating human requests the file');
      if (path.endsWith('/history')) return Response.json({ events: [] });
      assert.equal(path, '/v1/projects/project/nodes/document/history/event/download');
      tickets++;
      return Response.json({ node_id: 'document', event_id: 'event', url: 'https://objects.example/file', method: 'GET', content_type: 'application/vnd.cloudflareos.document+json', size_bytes: 5, sha256_hex: 'a'.repeat(64) });
    },
  }, {
    name: 'driver', modules: true, compatibilityDate: '2026-02-02', compatibilityFlags: ['experimental', 'allow_irrevocable_stub_storage'],
    durableObjects: { ACCOUNTS: { className: 'UserAccount', scriptName: 'mnemos', useSQLite: true }, DRIVER: { className: 'Driver', useSQLite: true } },
    script: (await build({bundle:true,write:false,format:'esm',platform:'browser',conditions:['workerd'],external:['cloudflare:workers'],stdin:{resolveDir:fileURLToPath(new URL('../../workshop-backend',import.meta.url)),contents:`import { DurableObject, RpcTarget } from 'cloudflare:workers';
      import { newWorkersRpcResponse, RpcTarget as WebTarget, RpcStub as WebStub } from 'capnweb';
      import { __validateRpcClass, wrapServerTarget, v } from 'capnweb-validate/internal';
      const downloadSchema={serviceName:'GatekeeperNativeDocumentDownload',methods:{issue:{args:[],returns:v.object({url:v.string,method:v.string,size_bytes:v.number,sha256_hex:v.string,content_type:v.string})},validate:{args:[],returns:v.undefined_}}};
      const schema={serviceName:'GadgetClient',methods:{read:{args:[],returns:v.object({storageOrigin:v.string,download:v.stubOf(downloadSchema)})}}};
      class Bridge extends WebTarget {
        constructor(driver){super();this.driver=driver;}
        async read(){return this.driver.read();}
      }
      class Shell extends WebTarget { constructor(driver){super();this.driver=driver;} async getClient(){return this.driver.getClient();} }
      const shellSchema={serviceName:'Shell',methods:{getClient:{args:[],returns:v.stubOf(schema)}}};
      const ValidatedBridge = __validateRpcClass(schema)(Bridge);
      class Authorizer extends RpcTarget {
        async authorizeObservation(d) { if (d.excludeObservers?.length) throw new Error('Observer is still authorized in workspace'); }
      }
      export class Driver extends DurableObject {
        async getClient() { return new WebStub(new ValidatedBridge(this)); }
        async read() {
          const owner = this.env.ACCOUNTS.getByName('owner');
          await owner.acceptVerifiedCredential('owner');
          const factory = await owner.nativeDocumentSource('https://memory.example/v1/projects/project/nodes/document', 'event');
          const source = this.ctx.facets.get('browser-source', () => ({class:factory.class,id:'browser-source'}));
          return source.openDocument(new Authorizer());
        }
        async run() {
          let phase = 'setup'; try {
          const owner = this.env.ACCOUNTS.getByName('owner'), observer = this.env.ACCOUNTS.getByName('observer'), foreign = this.env.ACCOUNTS.getByName('foreign');
          await owner.acceptVerifiedCredential('owner'); await observer.acceptVerifiedCredential('allowed'); await foreign.acceptVerifiedCredential('foreign');
          const factory = await owner.nativeDocumentSource('https://memory.example/v1/projects/project/nodes/document', 'event');
          const get = () => this.ctx.facets.get('source', () => ({ class: factory.class, id: 'source' }));
          let source = get();
          let foreignDenied = false, agentDenied = false;
          try { await source.addObserver('foreign', await foreign.getVerifier()); } catch { foreignDenied = true; }
          try { await source.startSession(); } catch { agentDenied = true; }
          await source.addObserver('observer', await observer.getVerifier());
          phase = 'open'; const read = await source.openDocument(new Authorizer());
          phase = 'issue'; const ticket = await read.download.issue();
          phase = 'validate'; await read.download.validate();
          await observer.acceptVerifiedCredential('denied');
          let postTransferDenied = false;
          try { await read.download.validate(); } catch { postTransferDenied = true; }
          read.download[Symbol.dispose]();
          phase = 'restart'; this.ctx.facets.abort('source', new Error('fixture restart'));
          source = get();
          let persistedDenied = false;
          try { await source.openDocument(new Authorizer()); } catch { persistedDenied = true; }
          phase = 'remove'; await source.removeObserver('observer'); await source.removeObserver('observer');
          phase = 'reopen'; const afterRemoval = await source.openDocument(new Authorizer());
          await afterRemoval.download.issue(); afterRemoval.download[Symbol.dispose]();
          return { foreignDenied, agentDenied, postTransferDenied, persistedDenied, storage: read.storageOrigin, native: ticket.content_type === 'application/vnd.cloudflareos.document+json', organizationBound: factory.sourceKey.includes('org') };
          } catch (error) { throw new Error(phase + ': ' + error.message); }
        }
      }
      export default { async fetch(request, env) {
        if(new URL(request.url).pathname==='/rpc') return newWorkersRpcResponse(request, wrapServerTarget(new Shell(env.DRIVER.getByName('fixture')),shellSchema));
        return Response.json(await env.DRIVER.getByName('fixture').run());
      } };`}})).outputFiles[0].text,
  }] });
  try {
    const worker = await mf.getWorker('driver');
    const response = await worker.fetch('https://driver.example/');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { foreignDenied: true, agentDenied: true, postTransferDenied: true, persistedDenied: true, storage: 'https://objects.example', native: true, organizationBound: true });
    assert.equal(tickets, 2, 'denied observations must not issue download tickets');
    const socketResponse = await worker.fetch('https://driver.example/rpc', {headers:{Upgrade:'websocket'}});
    const socket = socketResponse.webSocket;
    socket.accept();
    const client = newWebSocketRpcSession(socket);
    try {
      const gadget = await client.getClient();
      const read = await gadget.read();
      const ticket = await read.download.issue();
      assert.equal(ticket.content_type, 'application/vnd.cloudflareos.document+json');
      await read.download.validate();
      read[Symbol.dispose]();
      assert.equal(tickets, 3);
    } finally { client[Symbol.dispose](); }

  } finally { await mf.dispose(); }
});
