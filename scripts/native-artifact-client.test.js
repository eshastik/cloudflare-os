import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
const backend = createRequire(new URL('../packages/workshop-backend/package.json', import.meta.url));
const gatekeeper = createRequire(new URL('../packages/gatekeeper-mnemos/package.json', import.meta.url));
const Y = backend('yjs');
const { JSDOM } = gatekeeper('jsdom');

test('Sheets renders frozen intersections and recomputes offsets after resizing or unfreezing', async () => {
  const bytes = await readFile(new URL('../packages/workshop-backend/format-blueprints/workspace-sheets.gadget', import.meta.url));
  const doc = new Y.Doc(); Y.applyUpdateV2(doc, gunzipSync(bytes.subarray(24 + bytes.readUInt32BE(12))));
  const dom = new JSDOM('<!doctype html><body></body>', {runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://editor.example'});
  const w = dom.window;
  const initial = {revision: 1, restoreRevision: 0, title: 'Frozen', sheetOrder: ['sheet'],
    sheets: {sheet: {id: 'sheet', name: 'Sheet', rows: 5, cols: 4, colWidths: {0: 160}, rowHeights: {0: 36}, frozenRows: 2, frozenCols: 2}},
    cells: {sheet: {A1: {value: '10', version: 1, fmt: {bg: '#abcdef'}}, B1: {value: '=A1*2', version: 1, fmt: null}}}};
  w.RpcTarget = class {};
  w.gadget = {async subscribe() {return structuredClone(initial)}, async updatePresence() {}, async leavePresence() {}};
  w.setTimeout = () => 1; w.clearTimeout = () => {}; w.setInterval = () => 1;
  w.requestAnimationFrame = callback => {callback(0); return 1};
  w.ResizeObserver = class {observe() {} disconnect() {}};
  w.matchMedia = () => ({matches: false, addEventListener() {}, removeEventListener() {}});
  try {
    w.eval(doc.getMap().get('client.js').toString() + '\n globalThis.fixture = {model, doRenderGrid};');
    await new Promise(resolve => setImmediate(resolve));
    const cell = ref => w.document.querySelector('[data-ref="' + ref + '"]');
    assert.equal(cell('A1').style.position, 'sticky');
    assert.equal(cell('A1').style.top, '22px');
    assert.equal(cell('A1').style.left, '44px');
    assert.equal(cell('B2').style.top, '58px');
    assert.equal(cell('B2').style.left, '204px');
    assert.equal(cell('C1').style.left, '');
    assert.equal(cell('A3').style.top, '');
    assert.equal(cell('C3').style.position, '');
    assert.equal(cell('A1').style.background, 'rgb(171, 205, 239)');
    assert.equal(cell('B1').textContent, '20');
    const sheet = w.fixture.model.sheets.sheet;
    sheet.colWidths[0] = 200; sheet.rowHeights[0] = 40; w.fixture.doRenderGrid();
    assert.equal(cell('B2').style.left, '244px');
    assert.equal(cell('B2').style.top, '62px');
    sheet.frozenRows = 0; sheet.frozenCols = 0; w.fixture.doRenderGrid();
    assert.equal(w.document.querySelectorAll('td.frozen').length, 0);
    assert.equal(cell('A1').style.position, '');
  } finally { w.close(); doc.destroy(); }
});

test('native Sheets preserves pending edits on restore and ignores an old save acknowledgement', async () => {
  const bytes = await readFile(new URL('../packages/workshop-backend/format-blueprints/workspace-sheets.gadget', import.meta.url));
  const doc = new Y.Doc(); Y.applyUpdateV2(doc, gunzipSync(bytes.subarray(24 + bytes.readUInt32BE(12))));
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://editor.example' });
  const window = dom.window;
  const initial = { revision: 1, restoreRevision: 0, title: 'Budget', sheetOrder: ['sheet'],
    sheets: { sheet: { id: 'sheet', name: 'Sheet', rows: 5, cols: 4, colWidths: {}, rowHeights: {}, frozenRows: 0, frozenCols: 0 } },
    cells: { sheet: { A1: { value: 'saved', version: 1, fmt: null } } } };
  let callbacks, finishSave, sent;
  window.RpcTarget = class {};
  window.gadget = {
    async subscribe(receiver) { callbacks = receiver; return structuredClone(initial); },
    async updatePresence() {}, async leavePresence() {},
    async applyOperation(operation) { sent = operation; return new Promise(resolve => { finishSave = resolve; }); },
  };
  // Drive save explicitly; no timing-dependent autosave or presence loops.
  window.setTimeout = () => 1; window.clearTimeout = () => {};
  window.setInterval = () => 1;
  window.requestAnimationFrame = callback => { callback(0); return 1; };
  window.ResizeObserver = class { observe() {} disconnect() {} };
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { get: () => 800 });
  Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', { get: () => 600 });
  try {
    window.eval(doc.getMap().get('client.js').toString() + '\n globalThis.fixture = {model, queueCellOp, doSave, startEdit, cellEditor};');
    await new Promise(resolve => setImmediate(resolve));
    const f = window.fixture;
    f.model.cells.sheet.A1.value = 'unsaved typing';
    f.queueCellOp('sheet', 'A1', 'unsaved typing', null);
    const saving = f.doSave(); await Promise.resolve();
    assert.equal(sent.restoreRevision, 0);
    f.startEdit('B1', true, 'still editing');
    const restored = structuredClone(initial);
    restored.revision = 2; restored.restoreRevision = 2;
    restored.cells.sheet.A1 = { value: '=SUM(B1:B3)', version: 2, fmt: { b: true } };
    callbacks.operation({ type: 'snapshot', document: structuredClone(restored) });
    assert.equal(f.model.cells.sheet.A1.value, '=SUM(B1:B3)');
    assert.equal(f.model.restoreRevision, 2);
    assert.match(window.document.querySelector('[role=alert]').textContent, /pending edits were not applied/);
    const recover = [...window.document.querySelectorAll('button')].find(b => b.textContent === 'Show copy of your edits');
    recover.click();
    const copy = window.document.querySelector('textarea[aria-label="Pending workbook copy"]');
    assert.equal(window.document.activeElement, copy);
    assert.equal(copy.selectionEnd, copy.value.length);
    const recovery = JSON.parse(copy.value);
    assert.equal(recovery.document.cells.sheet.A1.value, 'unsaved typing');
    assert.equal(recovery.document.cells.sheet.B1.value, 'still editing');
    finishSave({ status: 'applied', revision: 1, upserts: [{ sheetId: 'sheet', ref: 'A1', cell: { value: 'obsolete acknowledgement', version: 2 } }] });
    await saving;
    assert.equal(f.model.cells.sheet.A1.value, '=SUM(B1:B3)');
    assert.equal(window.document.querySelectorAll('[role=alert]').length, 1);
    f.model.cells.sheet.B2 = { value: 'new edit', version: 0 };
    f.queueCellOp('sheet', 'B2', 'new edit', null);
    const nextSave = f.doSave(); await Promise.resolve();
    assert.equal(sent.restoreRevision, 2);
    assert.equal(sent.cellOps.length, 1);
    assert.equal(sent.cellOps[0].ref, 'B2');
    finishSave({ status: 'applied', revision: 3 }); await nextSave;
    // Missed restore callback: the save response itself supplies the new basis.
    f.model.cells.sheet.A3 = { value: 'offline edit', version: 0 };
    f.queueCellOp('sheet', 'A3', 'offline edit', null);
    const offlineSave = f.doSave(); await Promise.resolve();
    const newer = structuredClone(restored);
    newer.revision = 4; newer.restoreRevision = 4;
    finishSave({ status: 'restored', document: newer }); await offlineSave;
    assert.equal(f.model.restoreRevision, 4);
    assert.equal(f.model.cells.sheet.A3, undefined);
    const copies = window.document.querySelectorAll('textarea[aria-label="Pending workbook copy"]');
    assert.equal(copies.length, 2);
    assert.equal(JSON.parse(copies[0].value).document.cells.sheet.A3.value, 'offline edit');
  } finally { dom.window.close(); }
});

for (const kind of ['docs', 'sheets']) test(`${kind} client flush includes edits made during an in-flight save and refuses a failed save`, async () => {
  const bytes = await readFile(new URL(`../packages/workshop-backend/format-blueprints/workspace-${kind}.gadget`, import.meta.url));
  const doc = new Y.Doc(); Y.applyUpdateV2(doc, gunzipSync(bytes.subarray(24 + bytes.readUInt32BE(12))));
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://editor.example' });
  const w = dom.window;
  let current = kind === 'docs'
    ? { revision: 1, title: 'Note', blocks: [{ id: 'one', html: '<p>Before</p>', version: 1 }] }
    : { revision: 1, restoreRevision: 0, title: 'Budget', sheetOrder: ['sheet'],
      sheets: { sheet: { id: 'sheet', name: 'Sheet', rows: 5, cols: 4, colWidths: {}, rowHeights: {}, frozenRows: 0, frozenCols: 0 } },
      cells: { sheet: { A1: { value: 'Before', version: 1, fmt: null } } } };
  let release, calls = 0, exports = 0, fail = false;
  w.RpcTarget = class {};
  w.gadget = {
    async subscribe() { return structuredClone(current); },
    async updatePresence() {}, async leavePresence() {},
    async applyOperation(operation) {
      calls++;
      if (calls === 1) await new Promise(resolve => { release = resolve; });
      if (fail) throw new Error('fixture unavailable');
      current.revision++;
      if (kind === 'docs') {
        current.title = operation.title;
        current.blocks = operation.upserts.map(b => ({ id: b.id, html: b.html, version: current.revision }));
        return { revision: current.revision, title: current.title, upserts: structuredClone(current.blocks), deletedIds: [] };
      }
      const upserts = operation.cellOps.map(op => {
        const cell = { value: op.value, fmt: op.fmt, version: current.revision };
        current.cells[op.sheetId][op.ref] = cell;
        return { sheetId: op.sheetId, ref: op.ref, cell: structuredClone(cell) };
      });
      return { status: 'applied', revision: current.revision, upserts };
    },
    async exportDocumentSnapshot(revision) {
      assert.equal(revision, current.revision); exports++;
      return { format: kind === 'docs' ? 'cloudflareos.document' : 'cloudflareos.spreadsheet', formatVersion: 1, document: structuredClone(current) };
    },
  };
  w.setTimeout = () => 1; w.clearTimeout = () => {}; w.setInterval = () => 1;
  w.requestAnimationFrame = callback => { callback(0); return 1; };
  w.ResizeObserver = class { observe() {} disconnect() {} };
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  w.document.execCommand = () => true;
  w.console.error = () => {};
  Object.defineProperty(w.HTMLElement.prototype, 'clientWidth', { get: () => 800 });
  Object.defineProperty(w.HTMLElement.prototype, 'clientHeight', { get: () => 600 });
  try {
    const fixture = kind === 'docs' ? '{editor, doSave, prepareNativeSnapshot}' : '{model, queueCellOp, startEdit, doSave, prepareNativeSnapshot}';
    w.eval(doc.getMap().get('client.js').toString() + '\n globalThis.fixture = ' + fixture + ';');
    await new Promise(resolve => setImmediate(resolve));
    const f = w.fixture;
    const edit = value => {
      if (kind === 'docs') f.editor.firstElementChild.innerHTML = `<b>${value}</b>`;
      else { f.model.cells.sheet.A1.value = value; f.queueCellOp('sheet', 'A1', value, null); }
    };
    edit('First');
    const firstSave = f.doSave();
    assert.equal(calls, 1);
    if (kind === 'docs') edit('Latest');
    else f.startEdit('B1', true, '=SUM(A1:A3)');
    const pending = f.prepareNativeSnapshot();
    await Promise.resolve(); assert.equal(exports, 0);
    release(); await firstSave;
    const snapshot = await pending;
    assert.equal(calls, 2);
    assert.equal(exports, 1);
    if (kind === 'docs') assert.match(snapshot.document.blocks[0].html, /<b>Latest<\/b>/);
    else {
      assert.equal(snapshot.document.cells.sheet.A1.value, 'First');
      assert.equal(snapshot.document.cells.sheet.B1.value, '=SUM(A1:A3)');
    }
    fail = true; edit('Unsaved');
    await assert.rejects(f.prepareNativeSnapshot(), /Save failed|not ready/);
    assert.equal(exports, 1, 'failed save must not fall back to older server data');
    if (kind === 'docs') {
      // Docs retains its dirty DOM, so a successful subsequent save may export again.
      fail = false; await f.doSave();
      const retried = await f.prepareNativeSnapshot();
      assert.match(retried.document.blocks[0].html, /Unsaved/);
    }
  } finally { dom.window.close(); }
});

test('Sheets retries conflicted cell intents and keeps typing newer than an acknowledgement', async () => {
  const bytes = await readFile(new URL('../packages/workshop-backend/format-blueprints/workspace-sheets.gadget', import.meta.url));
  const doc = new Y.Doc(); Y.applyUpdateV2(doc, gunzipSync(bytes.subarray(24 + bytes.readUInt32BE(12))));
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  const initial = { revision: 1, restoreRevision: 0, title: 'Team budget', sheetOrder: ['sheet'],
    sheets: { sheet: { id: 'sheet', name: 'Sheet', rows: 5, cols: 4, colWidths: {}, rowHeights: {}, frozenRows: 0, frozenCols: 0 } },
    cells: { sheet: { A1: { value: 'before', version: 1, fmt: null }, B1: { value: 'before', version: 1, fmt: null } } } };
  let release, operation;
  w.RpcTarget = class {};
  w.gadget = {
    async subscribe() { return structuredClone(initial); }, async updatePresence() {}, async leavePresence() {},
    async applyOperation(op) { operation = op; return new Promise(resolve => { release = resolve; }); },
  };
  w.setTimeout = () => 1; w.clearTimeout = () => {}; w.setInterval = () => 1;
  w.requestAnimationFrame = callback => { callback(0); return 1; };
  w.ResizeObserver = class { observe() {} disconnect() {} };
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  Object.defineProperty(w.HTMLElement.prototype, 'clientWidth', { get: () => 800 });
  Object.defineProperty(w.HTMLElement.prototype, 'clientHeight', { get: () => 600 });
  try {
    w.eval(doc.getMap().get('client.js').toString() + '\n globalThis.fixture = {model, queueCellOp, doSave};');
    await new Promise(resolve => setImmediate(resolve));
    const f = w.fixture;
    const edit = (ref, value, fmt = null) => {
      const version = f.model.cells.sheet[ref]?.version || 0;
      if (value === null && fmt === null) delete f.model.cells.sheet[ref];
      else f.model.cells.sheet[ref] = { value, fmt, version };
      f.queueCellOp('sheet', ref, value, fmt);
    };
    edit('A1', 'first'); edit('B1', '=A2*2', { b: true });
    const first = f.doSave();
    edit('A1', 'latest');
    release({ status: 'conflict', revision: 2,
      upserts: [{ sheetId: 'sheet', ref: 'A1', cell: { value: 'first', version: 2, fmt: null } }],
      conflicts: [{ sheetId: 'sheet', ref: 'B1', cell: { value: 'remote', version: 7, fmt: null } }] });
    assert.equal(await first, false);
    assert.equal(f.model.cells.sheet.A1.value, 'latest', 'acknowledgement must not replace newer typing');
    assert.equal(f.model.cells.sheet.B1.value, '=A2*2', 'conflict must preserve the local formula');
    const second = f.doSave();
    assert.equal(operation.cellOps.length, 2);
    const a = operation.cellOps.find(op => op.ref === 'A1'), b = operation.cellOps.find(op => op.ref === 'B1');
    assert.equal(a.value, 'latest'); assert.equal(a.baseVersion, 2);
    assert.equal(b.value, '=A2*2'); assert.equal(b.fmt.b, true); assert.equal(b.baseVersion, 7);
    // A newer deletion must survive an older conflicted write to the same cell.
    edit('B1', null);
    release({ status: 'conflict', revision: 3,
      upserts: [{ sheetId: 'sheet', ref: 'A1', cell: { value: 'latest', version: 3, fmt: null } }],
      conflicts: [{ sheetId: 'sheet', ref: 'B1', cell: { value: 'remote again', version: 8, fmt: null } }] });
    await second;
    assert.equal(f.model.cells.sheet.B1, undefined);
    const third = f.doSave();
    assert.equal(operation.cellOps.length, 1);
    assert.equal(operation.cellOps[0].ref, 'B1'); assert.equal(operation.cellOps[0].value, null);
    assert.equal(operation.cellOps[0].baseVersion, 8);
    release({ status: 'applied', revision: 4, deletes: [{ sheetId: 'sheet', ref: 'B1' }] });
    await third;
    assert.equal(f.model.cells.sheet.A1.value, 'latest'); assert.equal(f.model.cells.sheet.B1, undefined);
  } finally { dom.window.close(); }
});

test('Docs keeps a copy of pending edits on restore and ignores pre-restore acknowledgements', async () => {
  const bytes = await readFile(new URL('../packages/workshop-backend/format-blueprints/workspace-docs.gadget', import.meta.url));
  const doc = new Y.Doc(); Y.applyUpdateV2(doc, gunzipSync(bytes.subarray(24 + bytes.readUInt32BE(12))));
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://editor.example' });
  const w = dom.window;
  const initial = { revision: 1, title: 'Note', blocks: [{ id: 'one', html: '<p>Before</p>', version: 1 }] };
  let callbacks, sent, finish;
  w.RpcTarget = class {};
  w.gadget = {
    async subscribe(value) { callbacks = value; return structuredClone(initial); },
    async updatePresence() {}, async leavePresence() {},
    async applyOperation(operation) { sent = operation; return new Promise(resolve => { finish = resolve }); },
  };
  w.setTimeout = () => 1; w.clearTimeout = () => {}; w.setInterval = () => 1;
  w.requestAnimationFrame = callback => { callback(0); return 1; };
  w.ResizeObserver = class { observe() {} disconnect() {} };
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  w.document.execCommand = () => true;
  try {
    w.eval(doc.getMap().get('client.js').toString() + '\n globalThis.fixture = {editor, titleInput, doSave};');
    await new Promise(resolve => setImmediate(resolve));
    const f = w.fixture;
    f.editor.firstElementChild.innerHTML = '<strong>Pending text</strong>';
    f.titleInput.value = 'Pending title';
    const saving = f.doSave(); await Promise.resolve();
    assert.equal(sent.restoreRevision, 0);
    const restored = { revision: 3, restoreRevision: 3, title: 'Restored', blocks: [{ id: 'two', html: '<p>Published</p>', version: 3 }] };
    callbacks.operation({ type: 'snapshot', document: restored });
    const copy = JSON.parse(w.document.querySelector('textarea[aria-label="Pending document copy"]').value);
    assert.equal(copy.document.title, 'Pending title');
    assert.match(copy.document.blocks[0].html, /Pending text/);
    assert.equal(f.titleInput.value, 'Restored');
    assert.equal(f.editor.textContent, 'Published');
    finish({ status: 'applied', revision: 2, title: 'Old acknowledgement', upserts: initial.blocks });
    await saving;
    callbacks.operation({ type: 'operation', revision: 2, title: 'Late old event', upserts: initial.blocks });
    assert.equal(f.titleInput.value, 'Restored');
    assert.equal(f.editor.textContent, 'Published');
    f.titleInput.value = 'New typing';
    const next = f.doSave(); await Promise.resolve();
    assert.equal(sent.restoreRevision, 3);
    finish({ status: 'applied', revision: 4, title: 'New typing', upserts: [] }); await next;
    assert.equal(w.document.querySelectorAll('[role="alert"]').length, 1);
  } finally { w.close(); }
});
