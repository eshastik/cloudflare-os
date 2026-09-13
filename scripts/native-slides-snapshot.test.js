import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../packages/workshop-backend/package.json',import.meta.url));
const Y=require('yjs');
const {Miniflare}=createRequire(new URL('../packages/gatekeeper-mnemos/package.json',import.meta.url))('miniflare');

test('bundled Slides preserves concurrent edits, fenced snapshots, history and failed writes in real storage',async()=>{
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
    const edits=[{type:'text',x:10,y:20,props:{text:'first'}},{type:'text',x:30,y:40,props:{text:'second'}}];
    const attempts=await Promise.all(edits.map(block=>g.mutateDocument(initial.revision,'addBlock',[id,block])));
    if(attempts.filter(r=>r.applied).length!==1)throw Error('Expected one conflict');
    const rejected=attempts.findIndex(r=>!r.applied);
    const retry=await g.mutateDocument((await g.getDeck()).revision,'addBlock',[id,edits[rejected]]);
    if(!retry.applied)throw Error('Fresh retry failed');
    const edited=await g.getDeck(),snapshot=await g.exportDocumentSnapshot(edited.revision);
    await g.mutateDocument(edited.revision,'removeSlide',[id]);const removed=await g.getDeck();
    const restored=await g.restoreDocumentSnapshot(snapshot,removed.revision);
    let stale=false;try{await g.restoreDocumentSnapshot(snapshot,removed.revision);}catch{stale=true;}
    const invalid=structuredClone(snapshot);invalid.document.slides.push(invalid.document.slides[0]);
    let duplicate=false;try{await g.restoreDocumentSnapshot(invalid,restored.revision);}catch{duplicate=true;}
    await g.mutateDocument(restored.revision,'undo',[]);const undone=await g.getDeck();await g.mutateDocument(undone.revision,'redo',[]);const redone=await g.getDeck();
    const beforeHistory=await g.getUndoState();
    const oversized=structuredClone(snapshot);oversized.document.slides[0].blocks[0].props.text='x'.repeat(3*1024*1024);
    let storageRejected=false;try{await g.restoreDocumentSnapshot(oversized,redone.revision);}catch(error){storageRejected=String(error).includes('SQLITE_TOOBIG');}
    const after=await g.getDeck(),afterHistory=await g.getUndoState();
    const legacy=env.SLIDES.get(env.SLIDES.idFromName('legacy'));await legacy.seedLegacy();
    const original=await legacy.readStored();let unknownRejected=false;try{await legacy.getDeck();}catch{unknownRejected=true;}
    return Response.json({
     format:snapshot.format,concurrent:edited.revision===2&&edited.slides[0].blocks.length===initial.slides[0].blocks.length+2,
     structure:JSON.stringify(restored.slides)===JSON.stringify(edited.slides),stale,duplicate,
     history:JSON.stringify(undone.slides)===JSON.stringify(removed.slides)&&JSON.stringify(redone.slides)===JSON.stringify(edited.slides)&&redone.revision>undone.revision&&undone.revision>restored.revision,
     storageRejected,rolledBack:JSON.stringify(after)===JSON.stringify(redone)&&JSON.stringify(afterHistory)===JSON.stringify(beforeHistory),
     legacyPreserved:unknownRejected&&JSON.stringify(await legacy.readStored())===JSON.stringify(original),
    });
   }};`},
 ]});
 try{
  const response=await(await mf.getWorker('driver')).fetch('http://check/');assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{format:'cloudflareos.presentation',concurrent:true,structure:true,stale:true,duplicate:true,history:true,storageRejected:true,rolledBack:true,legacyPreserved:true});
 }finally{await mf.dispose();}
});
