import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createRequire} from 'node:module';
import {createContext,runInContext} from 'node:vm';
const Y=createRequire(new URL('../packages/workshop-backend/package.json',import.meta.url))('yjs');
test('bundled Slides flushes blur edits, waits for writes and refuses failed or active gestures',async()=>{
 const bytes=await readFile(new URL('../packages/workshop-backend/format-blueprints/workspace-slides.gadget',import.meta.url));
 const doc=new Y.Doc();Y.applyUpdateV2(doc,gunzipSync(bytes.subarray(24+bytes.readUInt32BE(12))));
 const client=doc.getMap().get('client.js').toString();
 const helper=client.slice(0,client.indexOf('/* ========================================================================='));
 assert.ok(helper.includes('prepareNativeSnapshot'));
 let release, revision=0, value='old', exported=0;
 const events={};
 const context=createContext({structuredClone,window:{addEventListener:(name,fn)=>events[name]=fn},document:{},gadget:{
  mutateDocument:async(expected,method,[_slide,_block,patch])=>{assert.equal(expected,revision);assert.equal(method,"updateBlock");await new Promise(r=>release=r);value=patch.props.text;revision++;return {applied:true,revision,result:null};},
  getDeck:async()=>({revision}),exportDocumentSnapshot:async r=>{assert.equal(r,revision);exported++;return {value,revision};},
 }});
 runInContext(helper+'\nlet deck={revision:0};nativeReady=true;',context);
 runInContext('document.activeElement={blur(){nativeWrite("updateBlock","s","b",{props:{text:"new"}})}};',context);
 const pending=runInContext('prepareNativeSnapshot()',context);
 await Promise.resolve();assert.equal(exported,0);release();
 assert.equal((await pending).value,'new');
 runInContext('document.activeElement=null',context);
 runInContext('nativeTextEdits.set("pending",{value:"retained local text"})',context);
 await assert.rejects(runInContext('prepareNativeSnapshot()',context));assert.equal(exported,1);
 runInContext('nativeTextEdits.clear()',context);
 events.pointerdown({pointerId:1});await assert.rejects(runInContext('prepareNativeSnapshot()',context));events.pointerup({pointerId:1});
 await assert.rejects(runInContext('trackNativeOperation(()=>Promise.reject(Error("save failed")))',context));
 await assert.rejects(runInContext('prepareNativeSnapshot()',context));assert.equal(exported,1);
 doc.destroy();
});
