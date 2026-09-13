import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../packages/workshop-backend/package.json',import.meta.url));
const Y=require('yjs');
const {Miniflare}=createRequire(new URL('../packages/gatekeeper-mnemos/package.json',import.meta.url))('miniflare');

test('revision guard preserves peer edits and history on structural conflicts',async()=>{
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
    const staleView=await g.getDeck();
    await g.updateBlockText(id,blockId,'text','base','fresh peer text');
    const fresh=await g.getDeck(),history=await g.getUndoState();
    const rejectedDelete=await g.mutateDocument(staleView.revision,'removeBlock',[id,blockId]);
    const rejectedMove=await g.mutateDocument(staleView.revision,'updateBlock',[id,blockId,{x:200}]);
    const rejectedUndo=await g.mutateDocument(staleView.revision,'undo',[]);
    const unchanged=JSON.stringify(await g.getDeck())===JSON.stringify(fresh)&&JSON.stringify(await g.getUndoState())===JSON.stringify(history);
    const removed=await g.mutateDocument(fresh.revision,'removeBlock',[id,blockId]);
    const restored=await g.mutateDocument(removed.revision,'undo',[]);
    const rejectedRedo=await g.mutateDocument(removed.revision,'redo',[]);
    const restoredDeck=await g.getDeck();
    let unknownRejected=false;try{await g.mutateDocument(restored.revision,'constructor',[]);}catch{unknownRejected=true;}
    return Response.json({staleDeleteRejected:!rejectedDelete.applied,staleMoveRejected:!rejectedMove.applied,staleUndoRejected:!rejectedUndo.applied,unchanged,validDelete:removed.applied,validUndo:restored.applied&&restoredDeck.slides[0].blocks.find(b=>b.id===blockId).props.text==='fresh peer text',staleRedoRejected:!rejectedRedo.applied,unknownRejected});

   }};`},
 ]});
 try{
  const response=await(await mf.getWorker('driver')).fetch('http://check/');assert.equal(response.status,200);
  const result=await response.json(); assert.equal(Object.keys(result).length,8); for(const value of Object.values(result))assert.equal(value,true);
 }finally{await mf.dispose();}
});
