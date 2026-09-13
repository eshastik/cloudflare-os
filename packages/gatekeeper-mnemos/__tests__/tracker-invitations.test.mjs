import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const built=await build({stdin:{contents:'export {MnemosAccountSession} from "./src/account-session.ts";',resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
const {MnemosAccountSession}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
test('tracker invitation uses exact source and current destination, refuses overwrite, changed head and stale invitation',async()=>{
 const head='a'.repeat(64),source='b'.repeat(64);let mode='ok',adopts=0,opens=0;
 const api={checkPrivateVersionRead:async()=>({node_id:"tracker",head:source}),listInvitedDocuments:async()=>({documents:mode==='stale'?[]:[{node_id:'tracker',name:'Team tracker',content_type:'application/vnd.mnemos.task-tracker+json',head:source,owner_id:'owner'}],next_cursor:''}),openDraft:async()=>{opens++;return {head};},readDraftDocument:async()=>({node_id:'tracker',head:mode==='race'?'c'.repeat(64):head,exists:mode==='exists'}),adoptPrivateVersion:async(p,n,expected,from)=>{adopts++;assert.equal(expected,head);assert.equal(from,source);if(['lost','exists','race'].includes(mode))throw Error('server refused or reply lost');return {head:'d'.repeat(64)};}};
 const session=new MnemosAccountSession(api,()=>true);
 assert.equal((await session.listInvitedTrackers('project','')).documents.length,1);
 await session.connectInvitedTracker('project','tracker',source);assert.equal(adopts,1);
 for(mode of ['exists','race','stale'])await assert.rejects(()=>session.connectInvitedTracker('project','tracker',source));assert.equal(adopts,3);assert.equal(opens,3);
 mode='lost';await assert.rejects(()=>session.connectInvitedTracker('project','tracker',source));assert.equal(adopts,4);
});

test('invited tracker download reauthorizes exact source and rejects wrong MIME and revoked invitation',async()=>{
 const source='b'.repeat(64);let revoked=false,wrong=false,checks=0,downloads=0;
 const api={listInvitedDocuments:async()=>({documents:revoked?[]:[{node_id:'tracker',name:'Team',owner_id:'owner',head:source,content_type:'application/vnd.mnemos.task-tracker+json'}],next_cursor:''}),checkPrivateVersionRead:async(p,n,h)=>{checks++;assert.equal(h,source);return {node_id:n,head:h};},downloadPrivateVersion:async(p,n,h)=>{downloads++;return {node_id:n,head:h,term_index:0,content_type:wrong?'application/json':'application/vnd.mnemos.task-tracker+json'};}};
 const session=new MnemosAccountSession(api,()=>true);await session.downloadInvitedTracker('project','tracker',source);assert.equal(checks,1);assert.equal(downloads,1);
 wrong=true;await assert.rejects(()=>session.downloadInvitedTracker('project','tracker',source));revoked=true;await assert.rejects(()=>session.validateInvitedTracker('project','tracker',source));await assert.rejects(()=>session.downloadInvitedTracker('project','tracker',source));assert.equal(downloads,2);
});

test('text review accepts exact tracker MIME while native review remains format-specific',async()=>{
 const mime='application/vnd.mnemos.task-tracker+json';let ticket={review_id:'review',node_id:'tracker',decision_version:1,side:'after',present:true,content_type:mime,url:'https://storage.example/object',method:'GET',size_bytes:2,sha256_hex:'a'.repeat(64),metadata:{name:'Tracker',parent_id:'',content_type:mime}};
 const session=new MnemosAccountSession({beginReviewDownload:async()=>ticket},()=>true);
 assert.equal((await session.beginReviewDownload('review','tracker',1,'after')).content_type,mime);
 await assert.rejects(()=>session.beginNativeReviewDownload('review','tracker',1,'after','cloudflareos.document'));
 ticket={...ticket,decision_version:2};await assert.rejects(()=>session.beginReviewDownload('review','tracker',1,'after'));
 ticket={...ticket,decision_version:1,content_type:'application/json'};await assert.rejects(()=>session.beginReviewDownload('review','tracker',1,'after'));
 ticket={...ticket,side:'before',present:false};assert.equal(await session.beginReviewDownload('review','tracker',1,'before'),null);
});
