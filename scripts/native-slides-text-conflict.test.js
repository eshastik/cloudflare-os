import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../packages/workshop-backend/package.json',import.meta.url));
const Y=require('yjs');
const {Miniflare}=createRequire(new URL('../packages/gatekeeper-mnemos/package.json',import.meta.url))('miniflare');

test('bundled Slides rejects stale text, preserves unrelated edits and requires a new conflict decision',async()=>{
 const bytes=await readFile(new URL('../packages/workshop-backend/format-blueprints/workspace-slides.gadget',import.meta.url));
 const doc=new Y.Doc();Y.applyUpdateV2(doc,gunzipSync(bytes.subarray(24+bytes.readUInt32BE(12))));
 const server=doc.getMap().get('server.js').toString();
 const mf=new Miniflare({host:'127.0.0.1',port:0,workers:[
  {name:'slides',modules:true,script:server+`
   export class TestGadget extends Gadget {
    async seedLegacy(){await this.state.storage.put('deck',{themeVersion:'legacy',slides:[],retained:'original'});}
    async readStored(){return this.state.storage.get('deck');}
   }`,compatibilityDate:'2026-02-02',durableObjects:{SLIDES:{className:'TestGadget',useSQLite:true}}},
  {name:'driver',modules:true,compatibilityDate:'2026-02-02',durableObjects:{SLIDES:{className:'TestGadget',scriptName:'slides',useSQLite:true}},script:`
   export default {async fetch(request,env){
    const g=env.SLIDES.get(env.SLIDES.idFromName('deck'));
    const initial=await g.getDeck(),id=initial.slides[0].id;
    const blockId=(await g.mutateDocument(initial.revision,'addBlock',[id,{type:'text',x:10,y:20,props:{text:'base',color:'black'}}])).result;
    const readerA=await g.getDeck(),readerB=await g.getDeck();
    const results=await Promise.all([
      g.updateBlockText(id,blockId,'text','base','edit A'),
      g.updateBlockText(id,blockId,'text','base','edit B')
    ]);
    const winners=results.filter(r=>r.saved),losers=results.filter(r=>!r.saved);
    const current=(await g.getDeck()).slides[0].blocks.find(b=>b.id===blockId).props.text;
    const before=await g.getDeck();
    const stale=await g.updateBlockText(id,blockId,'text','base','late overwrite');
    const after=await g.getDeck();
    await g.mutateDocument((await g.getDeck()).revision,'updateBlock',[id,blockId,{props:{color:'blue'}}]);
    const retry=await g.updateBlockText(id,blockId,'text',current,'resolved');
    const resolved=(await g.getDeck()).slides[0].blocks.find(b=>b.id===blockId);
    await g.mutateDocument((await g.getDeck()).revision,'removeBlock',[id,blockId]);
    const deleted=await g.updateBlockText(id,blockId,'text','resolved','resurrected');
    return Response.json({oneWinner:winners.length===1&&losers.length===1,conflictHasCurrent:losers[0].current===current,staleRejected:!stale.saved,unchangedAfterConflict:JSON.stringify(before)===JSON.stringify(after),retryPreservesOtherField:retry.saved&&resolved.props.text==='resolved'&&resolved.props.color==='blue',deletedRejected:!deleted.saved&&deleted.deleted});

   }};`},
 ]});
 try{
  const response=await(await mf.getWorker('driver')).fetch('http://check/');assert.equal(response.status,200);
  const result=await response.json(); assert.deepEqual(result,{oneWinner:true,conflictHasCurrent:true,staleRejected:true,unchangedAfterConflict:true,retryPreservesOtherField:true,deletedRejected:true});
 }finally{await mf.dispose();}
});
