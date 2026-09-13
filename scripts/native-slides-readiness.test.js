import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createRequire} from 'node:module';
import {createContext,runInContext} from 'node:vm';

const Y=createRequire(new URL('../packages/workshop-backend/package.json',import.meta.url))('yjs');
const bytes=await readFile(new URL('../packages/workshop-backend/format-blueprints/workspace-slides.gadget',import.meta.url));
const doc=new Y.Doc();
Y.applyUpdateV2(doc,gunzipSync(bytes.subarray(24+bytes.readUInt32BE(12))));
const client=doc.getMap().get('client.js').toString();
const boot=client.slice(client.indexOf('/* ====================== Boot '));
doc.destroy();

function start(overrides={}) {
  const messages=[];
  const context=createContext({
    nativeUIReadinessAttempt:'current-load',nativeReady:false,nativeFailed:false,
    Subscriber:class {},mountShell(){},updateCounter(){},render(){},renderSlideList(){},updateUndoButtons(){},
    ...overrides,
    gadget:{getDeck:async()=>({revision:7,slides:[]}),subscribe:async()=>{},getUndoState:async()=>({}),...overrides.gadget},
    window:{parent:{postMessage(message){messages.push(message)}}},
  });
  return {messages,context,done:runInContext(boot,context)};
}

test('Slides reports ready only after data, rendering and initial history arrive',async()=>{
  let releaseDeck,releaseHistory,rendered=false;
  const deck=new Promise(r=>releaseDeck=r),history=new Promise(r=>releaseHistory=r);
  const run=start({gadget:{getDeck:()=>deck,getUndoState:()=>history},render(){rendered=true}});
  assert.equal(run.messages.length,0);
  releaseDeck({revision:7,slides:[]});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(rendered,true);
  assert.equal(run.messages.length,0);
  releaseHistory({canUndo:false});await run.done;
  assert.equal(run.messages.length,1);
  assert.equal(run.messages[0].outcome,'ready');
  assert.equal(run.messages[0].attempt,'current-load');
});

test('Slides reports load and render failures instead of successful readiness',async()=>{
  for(const overrides of [
    {gadget:{getDeck:async()=>{throw Error('unavailable')}}},
    {gadget:{getDeck:async()=>({slides:[]})}},
    {gadget:{subscribe:async()=>{throw Error('disconnected')}}},
    {gadget:{getUndoState:async()=>{throw Error('unavailable')}}},
    {render(){throw Error('render failed')}},
  ]) {
    const run=start(overrides);await run.done;
    assert.equal(run.messages.length,1);
    assert.equal(run.messages[0].outcome,'error');
    assert.equal(run.messages[0].attempt,'current-load');
  }
});
