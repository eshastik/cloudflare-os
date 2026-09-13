import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
const backend = createRequire(new URL('../packages/workshop-backend/package.json', import.meta.url));
const gatekeeper = createRequire(new URL('../packages/gatekeeper-mnemos/package.json', import.meta.url));
const Y = backend('yjs');
const { JSDOM } = gatekeeper('jsdom');

for (const format of ['docs', 'sheets']) for (const failed of [false, true]) {
  test(`native ${format} reports ${failed ? 'error' : 'ready'} only after subscription settles`, async () => {
    const bytes = await readFile(new URL(`../packages/workshop-backend/format-blueprints/workspace-${format}.gadget`, import.meta.url));
    const doc = new Y.Doc(); Y.applyUpdateV2(doc, gunzipSync(bytes.subarray(24 + bytes.readUInt32BE(12))));
    const dom = new JSDOM('<!doctype html><body></body>', {runScripts:'outside-only',pretendToBeVisual:true,url:'https://editor.example'});
    const window = dom.window;
    const signals = [];
    let resolve, reject;
    const loaded = new Promise((yes, no) => { resolve=yes; reject=no; });
    window.RpcTarget = class {};
    window.nativeUIReadinessAttempt = 'fixture-load';
    window.gadget = { subscribe: () => loaded, async updatePresence() {}, async leavePresence() {} };
    window.setTimeout = () => 1; window.clearTimeout = () => {}; window.setInterval = () => 1;
    window.requestAnimationFrame = callback => { callback(0); return 1; };
    window.ResizeObserver = class { observe() {} disconnect() {} };
    window.matchMedia = () => ({matches:false,addEventListener(){},removeEventListener(){}});
    window.postMessage = signal => { if(signal.type==='native-ui-readiness') signals.push(signal); };
    window.console.error = () => {};
    Object.defineProperty(window.HTMLElement.prototype,'clientWidth',{get:()=>800});
    Object.defineProperty(window.HTMLElement.prototype,'clientHeight',{get:()=>600});
    const initial = format==='docs'
      ? {revision:1,restoreRevision:0,title:'Readiness fixture',blocks:[{id:'one',html:'<p>Loaded document content</p>',version:1}]}
      : {revision:1,restoreRevision:0,title:'Readiness fixture',sheetOrder:['sheet'],sheets:{sheet:{id:'sheet',name:'Loaded sheet',rows:5,cols:4,colWidths:{},rowHeights:{},frozenRows:0,frozenCols:0}},cells:{sheet:{A1:{value:'Loaded cell content',version:1,fmt:null}}}};
    try {
      window.eval(doc.getMap().get('client.js').toString());
      await new Promise(done => setImmediate(done));
      assert.equal(signals.length,0,'editor reported before its data arrived');
      if(failed) reject(new Error('fixture unavailable')); else resolve(initial);
      await new Promise(done => setImmediate(done));
      assert.equal(signals.length,1);
      assert.equal(signals[0].attempt,'fixture-load');
      assert.equal(signals[0].outcome,failed?'error':'ready');
      if(!failed) assert.ok(window.document.body.textContent.includes(format==='docs'?'Loaded document content':'Loaded cell content'),'ready preceded data rendering');
    } finally { dom.window.close(); doc.destroy(); }
  });
}
