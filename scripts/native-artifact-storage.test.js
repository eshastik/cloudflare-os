import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
const backendRequire = createRequire(new URL('../packages/workshop-backend/package.json', import.meta.url));
const workerRequire = createRequire(new URL('../packages/gatekeeper-mnemos/package.json', import.meta.url));
const Y = backendRequire('yjs');
const { Miniflare } = workerRequire('miniflare');

test('native Sheets restores through real Durable Object storage and rolls back an oversized workbook', async () => {
  const bytes = await readFile(new URL('../packages/workshop-backend/format-blueprints/workspace-sheets.gadget', import.meta.url));
  const doc = new Y.Doc();
  Y.applyUpdateV2(doc, gunzipSync(bytes.subarray(24 + bytes.readUInt32BE(12))));
  const mf = new Miniflare({ host: '127.0.0.1', port: 0, workers: [
    { name: 'sheets', modules: true, script: doc.getMap().get('server.js').toString(), compatibilityDate: '2026-02-02',
      durableObjects: { SHEETS: { className: 'Gadget', useSQLite: true } } },
    { name: 'driver', modules: true, compatibilityDate: '2026-02-02',
      durableObjects: { SHEETS: { className: 'Gadget', scriptName: 'sheets', useSQLite: true } },
      script: `export default { async fetch(request, env) {
        const sheets = env.SHEETS.get(env.SHEETS.idFromName('local-check'));
        const initial = await sheets.getDocument(), id = initial.sheetOrder[0];
        await sheets.applyOperation({cellOps:[{sheetId:id,ref:'A1',value:'=SUM(B1:B3)',fmt:{b:true},baseVersion:0}]});
        const saved = await sheets.exportDocumentSnapshot(1);
        await sheets.applyOperation({cellOps:[{sheetId:id,ref:'A1',value:'edit',baseVersion:1}]});
        const restored = await sheets.restoreDocumentSnapshot(saved,2);
        const stable = await sheets.getDocument();
        const oversized = structuredClone(saved);
        oversized.document.sheetOrder.push('large');
        oversized.document.sheets.large = {...initial.sheets[id],id:'large',name:'Large'};
        oversized.document.cells[id].A1.value = 'must roll back';
        oversized.document.cells.large = {};
        for(let n=1;n<=600;n++) oversized.document.cells.large['A'+n]={value:'x'.repeat(8192),fmt:null,version:1};
        let rejected=false;
        try { await sheets.restoreDocumentSnapshot(oversized,restored.revision); } catch (error) { rejected=String(error).includes("SQLITE_TOOBIG"); }
        const after = await sheets.getDocument();
        return Response.json({formulaPreserved:stable.cells[id].A1.value==='=SUM(B1:B3)',formatPreserved:stable.cells[id].A1.fmt.b===true,
          oversizedRejected:rejected,rolledBack:JSON.stringify(after)===JSON.stringify(stable)});
      }};` },
  ] });
  try {
    const response = await (await mf.getWorker('driver')).fetch('http://local/check');
    assert.deepEqual(await response.json(), { formulaPreserved: true, formatPreserved: true, oversizedRejected: true, rolledBack: true });
  } finally { await mf.dispose(); }
});
