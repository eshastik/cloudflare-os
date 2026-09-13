import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
const require = createRequire(new URL('../packages/workshop-backend/package.json', import.meta.url));
const Y = require('yjs');

async function artifact(kind) {
  const bytes = await readFile(new URL(`../packages/workshop-backend/format-blueprints/workspace-${kind}.gadget`, import.meta.url));
  const doc = new Y.Doc();
  Y.applyUpdateV2(doc, gunzipSync(bytes.subarray(24 + bytes.readUInt32BE(12))));
  const source = doc.getMap().get('server.js').toString();
  const Gadget = runInNewContext(source.replace('import { DurableObject } from "cloudflare:workers";', 'class DurableObject {}').replace('export class Gadget', 'class Gadget') + '\nGadget;', { crypto: globalThis.crypto });
  const data = new Map();
  let intercept;
  const storage = {
    async get(key) { return structuredClone(data.get(key)); },
    async put(key, value) { if (intercept) await intercept(key); data.set(key, structuredClone(value)); },
    async delete(key) { data.delete(key); },
    async transaction(fn) {
      const next = new Map(structuredClone([...data]));
      const result = await fn({
        async get(key) { return structuredClone(next.get(key)); },
        async put(key, value) { if (intercept) await intercept(key); next.set(key, structuredClone(value)); },
        async delete(key) { next.delete(key); },
      });
      data.clear(); for (const [key, value] of next) data.set(key, value);
      return result;
    },
  };
  return { gadget: new Gadget({ storage }, {}), pauseWrites(fn) { intercept = fn; } };
}
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }

for (const kind of ['docs', 'sheets']) test(`${kind} native snapshot preserves structured data and waits for the complete edit`, async () => {
  const { gadget, pauseWrites } = await artifact(kind);
  let edit, expected;
  if (kind === 'docs') {
    await gadget.setDocument({ title: 'Original', blocks: [{ id: 'one', html: '<p>Original</p>' }] });
    edit = () => gadget.setDocument({ title: 'Updated', blocks: [{ id: 'one', html: '<p><strong>Formatted</strong> text</p>' }] });
    expected = 2;
  } else {
    const initial = await gadget.getDocument();
    const sheetId = initial.sheetOrder[0];
    edit = () => gadget.applyOperation({ cellOps: [{ sheetId, ref: 'A1', value: '=SUM(B1:B3)', baseVersion: 0 }] });
    expected = 1;
  }
  const entered = deferred(), release = deferred();
  let once = true;
  pauseWrites(async () => { if (once) { once = false; entered.resolve(); await release.promise; } });
  const mutation = edit(); await entered.promise;
  let returned = false;
  const pending = gadget.exportDocumentSnapshot(expected).then(snapshot => { returned = true; return snapshot; });
  await Promise.resolve(); assert.equal(returned, false);
  release.resolve(); await mutation;
  const snapshot = await pending;
  assert.equal(snapshot.format, kind === 'docs' ? 'cloudflareos.document' : 'cloudflareos.spreadsheet');
  assert.equal(snapshot.formatVersion, 1);
  assert.equal(snapshot.document.revision, expected);
  if (kind === 'docs') {
    assert.equal(snapshot.document.title, 'Updated');
    assert.equal(snapshot.document.blocks[0].html, '<p><strong>Formatted</strong> text</p>');
  } else {
    assert.equal(snapshot.document.cells[snapshot.document.sheetOrder[0]].A1.value, '=SUM(B1:B3)');
    assert.ok(snapshot.document.sheets[snapshot.document.sheetOrder[0]]);
  }
  await assert.rejects(gadget.exportDocumentSnapshot(expected - 1), /Document changed/);
  assert.throws(() => gadget.exportDocumentSnapshot(-1), /valid document revision/);
  assert.deepEqual(Object.keys(snapshot).sort(), ['document', 'format', 'formatVersion']);
});

test('Docs restore preserves native blocks and fences concurrent and pre-restore edits', async () => {
  const { gadget, pauseWrites } = await artifact('docs');
  const first = await gadget.setDocument({ title: 'Saved title', blocks: [{ id: 'one', html: '<h2><em>Saved</em></h2>' }] });
  const snapshot = await gadget.exportDocumentSnapshot(first.revision);
  await gadget.setDocument({ title: 'Later edit', blocks: [] });
  const before = await gadget.getDocument();
  const restored = await gadget.restoreDocumentSnapshot(snapshot, before.revision);
  assert.equal(restored.revision, before.revision + 1);
  assert.equal(restored.title, 'Saved title');
  assert.equal(restored.blocks[0].id, 'one');
  assert.equal(restored.blocks[0].html, '<h2><em>Saved</em></h2>');
  assert.ok(restored.blocks[0].version > first.blocks[0].version);
  for (const operation of [
    { title: 'Late title' },
    { order: ['two', 'one'], upserts: [{ id: 'two', html: '<p>Old insert</p>', baseVersion: 0 }] },
    { deletes: [{ id: 'one', baseVersion: restored.blocks[0].version }] },
  ]) {
    const rejected = await gadget.applyOperation({ ...operation, restoreRevision: before.restoreRevision || 0 });
    assert.equal(rejected.status, 'restored');
    assert.equal(JSON.stringify(await gadget.getDocument()), JSON.stringify(restored));
  }
  const staleEdit = await gadget.applyOperation({ upserts: [{ id: 'one', html: 'obsolete typing', baseVersion: first.blocks[0].version }] });
  assert.equal(staleEdit.status, 'restored');
  assert.equal((await gadget.getDocument()).blocks[0].html, '<h2><em>Saved</em></h2>');
  const entered = deferred(), release = deferred();
  let once = true;
  pauseWrites(async () => { if (once) { once = false; entered.resolve(); await release.promise; } });
  const typing = gadget.setDocument({ title: 'Concurrent typing', blocks: [{ id: 'one', html: '<p>Keep my edit</p>' }] });
  await entered.promise;
  const rejected = assert.rejects(gadget.restoreDocumentSnapshot(snapshot, restored.revision), /Document changed/);
  release.resolve(); await typing; await rejected;
  const final = await gadget.getDocument();
  assert.equal(final.title, 'Concurrent typing');
  assert.equal(final.blocks[0].html, '<p>Keep my edit</p>');
  for (const invalid of [
    { ...snapshot, format: 'cloudflareos.spreadsheet' },
    { ...snapshot, formatVersion: 2 },
    { ...snapshot, document: { ...snapshot.document, blocks: [snapshot.document.blocks[0], snapshot.document.blocks[0]] } },
    { ...snapshot, document: { ...snapshot.document, blocks: [{ id: 'one', html: 42 }] } },
  ]) assert.throws(() => gadget.restoreDocumentSnapshot(invalid, final.revision));
  assert.throws(() => gadget.restoreDocumentSnapshot(snapshot, -1));
  assert.equal((await gadget.getDocument()).revision, final.revision);
});

test('Sheets restore retains formulas and formatting, commits atomically and rejects stale revisions', async () => {
  const { gadget, pauseWrites } = await artifact('sheets');
  const initial = await gadget.getDocument(), id = initial.sheetOrder[0];
  await gadget.applyOperation({
    structure: { title: 'Budget', sheetOrder: [id, 'summary'], sheets: {
      [id]: { ...initial.sheets[id], colWidths: { 0: 180 }, rowHeights: { 1: 32 }, frozenRows: 1 },
      summary: { name: 'Summary', rows: 40, cols: 8 },
    } },
    cellOps: [
      { sheetId: id, ref: 'A1', value: '=SUM(B1:B3)', fmt: { b: true, nf: 'currency', d: 2 }, baseVersion: 0 },
      { sheetId: 'summary', ref: 'C2', value: '=A1*2', fmt: { bg: '#abc', wrap: true }, baseVersion: 0 },
    ],
  });
  const saved = await gadget.exportDocumentSnapshot(1);
  await gadget.applyOperation({ structure: { title: 'Edited', sheetOrder: [id], sheets: { [id]: initial.sheets[id] } },
    cellOps: [{ sheetId: id, ref: 'A1', value: '0', baseVersion: 1 }] });
  const before = await gadget.getDocument();
  const restored = await gadget.restoreDocumentSnapshot(saved, before.revision);
  assert.equal(restored.title, 'Budget');
  assert.deepEqual([...restored.sheetOrder], [id, 'summary']);
  assert.equal(restored.sheets[id].colWidths[0], 180);
  assert.equal(restored.sheets[id].rowHeights[1], 32);
  assert.equal(restored.sheets[id].frozenRows, 1);
  assert.equal(restored.cells[id].A1.value, '=SUM(B1:B3)');
  assert.equal(restored.cells[id].A1.fmt.nf, 'currency');
  assert.equal(restored.cells.summary.C2.value, '=A1*2');
  assert.equal(restored.cells.summary.C2.fmt.bg, '#abc');
  assert.equal(restored.cells.summary.C2.fmt.wrap, true);
  assert.ok(restored.cells[id].A1.version > before.cells[id].A1.version);
  const oldEdit = await gadget.applyOperation({ cellOps: [{ sheetId: id, ref: 'A1', value: 'obsolete', baseVersion: 1 }] });
  assert.equal(oldEdit.status, 'restored');
  assert.equal(oldEdit.document.restoreRevision, restored.revision);
  for (const operation of [
    { structure: { title: 'Obsolete delete', sheetOrder: [id], sheets: { [id]: initial.sheets[id] } } },
    { sheetReplacements: [{ sheetId: id, cells: {} }] },
    { cellOps: [{ sheetId: id, ref: 'Z99', value: 'obsolete new cell', baseVersion: 0 }] },
  ]) {
    const rejected = await gadget.applyOperation({ ...operation, restoreRevision: before.restoreRevision });
    assert.equal(rejected.status, 'restored');
    assert.deepEqual(JSON.parse(JSON.stringify(await gadget.getDocument())), JSON.parse(JSON.stringify(restored)));
  }
  const current = await gadget.applyOperation({ restoreRevision: restored.restoreRevision,
    cellOps: [{ sheetId: id, ref: 'A2', value: 'new edit', baseVersion: 0 }] });
  assert.equal(current.status, 'applied');
  assert.equal((await gadget.getDocument()).cells[id].A2.value, 'new edit');
  await assert.rejects(gadget.restoreDocumentSnapshot(saved, before.revision), /Document changed/);
  const stable = JSON.stringify(await gadget.getDocument());
  pauseWrites(async key => { if (key === 'meta') throw new Error('simulated storage failure'); });
  await assert.rejects(gadget.restoreDocumentSnapshot(saved, current.revision), /simulated storage failure/);
  assert.equal(JSON.stringify(await gadget.getDocument()), stable, 'no partial workbook after failed transaction');
  pauseWrites(null);
  for (const invalid of [
    { ...saved, formatVersion: 2 },
    { ...saved, document: { ...saved.document, sheetOrder: [id, id] } },
    { ...saved, document: { ...saved.document, cells: { ...saved.document.cells, summary: { C2: { value: 42, fmt: null, version: 1 } } } } },
    { ...saved, document: { ...saved.document, cells: { ...saved.document.cells, summary: { C2: { value: '=A1', fmt: { unsupported: true }, version: 1 } } } } },
  ]) assert.throws(() => gadget.restoreDocumentSnapshot(invalid, restored.revision));
  assert.equal(JSON.stringify(await gadget.getDocument()), stable);
});
