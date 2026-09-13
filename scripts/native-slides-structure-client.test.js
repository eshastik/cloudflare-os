import {readFile} from 'node:fs/promises';
import {createContext,runInContext} from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {gunzipSync} from 'node:zlib';
import {createRequire} from 'node:module';
const Y=createRequire(new URL('../packages/workshop-backend/package.json',import.meta.url))('yjs');
test('bundled Slides preserves input and gesture revisions and recovers after conflict',async()=>{
const bytes=await readFile(new URL('../packages/workshop-backend/format-blueprints/workspace-slides.gadget',import.meta.url));const doc=new Y.Doc();Y.applyUpdateV2(doc,gunzipSync(bytes.subarray(24+bytes.readUInt32BE(12))));const source=doc.getMap().get('client.js').toString();doc.destroy();
const helper=source.slice(0,source.indexOf('/* ========================================================================='));
const events={},elements=[];let called,exported=0;
const make=()=>{const e={style:{},setAttribute(){},append(){},hidden:false};elements.push(e);return e};
const context=createContext({structuredClone,window:{addEventListener:(k,v)=>events[k]=v},document:{activeElement:null,createElement:make,body:{append(){}}},gadget:{
 mutateDocument:async(revision,method,args)=>{called={revision,method,args};return {applied:false,revision:2}},
 getDeck:async()=>({revision:2,slides:[{id:'s',blocks:[]}]}),exportDocumentSnapshot:async()=>{exported++;return {}},
}});
runInContext(helper+`;let deck={revision:1,slides:[{id:'s',blocks:[]}]},currentIndex=0,selectedBlockId=null;function render(){}function renderSlideList(){}function renderInspector(){}function updateCounter(){}nativeReady=true;`,context);
events.pointerdown({pointerId:1});runInContext('deck.revision=2',context);events.pointerup({pointerId:1});
await assert.rejects(runInContext('nativeWrite("removeSlide","s")',context));
assert.equal(called.revision,1);assert.equal(called.method,'removeSlide');
await assert.rejects(runInContext('prepareNativeSnapshot()',context));assert.equal(exported,0);
assert.equal(runInContext('nativeStructuralIssue',context),true);assert.equal(runInContext('nativeFailed',context),false);
const reload=elements.find(e=>e.textContent==='Перечитать общую версию');assert.ok(reload);await reload.onclick();
assert.equal(runInContext('nativeStructuralIssue',context),false);
await runInContext('prepareNativeSnapshot()',context);assert.equal(exported,1);
runInContext('document.activeElement={isContentEditable:false,matches(){return true}}',context);
events.focusin();
runInContext('deck.revision=3',context);
events.pointerdown({pointerId:2});
await assert.rejects(runInContext('nativeWrite("updateBlock","s","b",{x:42})',context));
assert.equal(called.revision,2,'a new pointer must not replace the revision of unfinished input');
events.pointerup({pointerId:2});
runInContext('document.activeElement=null',context);events.focusout();await Promise.resolve();await reload.onclick();
runInContext(`document.activeElement={isContentEditable:false,matches(){return true}};globalThis.writes=[];gadget.mutateDocument=async(revision)=>{writes.push(revision);return {applied:true,revision:revision+1,result:null}}`,context);
events.focusin();
await runInContext('nativeWrite("updateBlock","s","b",{x:43})',context);
await runInContext('nativeWrite("updateBlock","s","b",{x:44})',context);
assert.deepEqual(Array.from(runInContext('writes',context)),[2,3]);
});
