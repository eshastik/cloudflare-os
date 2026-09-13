import {test} from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';
const compiled=await build({stdin:{contents:'export {OfficeUpdateRecovery} from "./src/office-update-recovery.ts";export {OfficeUpdateWriter} from "./src/office-update-writer.ts";export {NativeCreationRecovery} from "./src/native-creation-recovery.ts";',resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'runtime',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'runtime',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export class RpcTarget{}',loader:'js'}))}}]});
const {OfficeUpdateRecovery,OfficeUpdateWriter,NativeCreationRecovery}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const storage=()=>{const map=new Map([['mnemosAccountOwner',{tenant:'tenant',user:'human'}]]);return {get:key=>map.get(key),put:(key,value)=>map.set(key,value)}};
test('update receipt restores the same operation and rejects other account, format, creation purpose and changed coordinates',async()=>{
 const account=storage(),recovery=new OfficeUpdateRecovery(account),head='a'.repeat(64),format='cloudflareos.document';
 const intent={project:'project',node:'target',format,head,request:'fixed-request',update:'verified-plan',upload:''};
 let uploads=0,denied=false;const calls=[];
 const session={beginNativeUpload:async()=>({upload_id:'upload-'+(++uploads)}),applyOfficeUpdate:async(...args)=>{if(denied)throw Error('revoked');calls.push(args);if(calls.length===1)throw Error('lost reply after commit');return {head:'b'.repeat(64)}}};
 const writer=new OfficeUpdateWriter(session,recovery,intent);intent.node='changed caller input';
 const ticket=await writer.issue(head,4,'checksum');const receipt=await writer.checkpoint(head,ticket.upload_id);
 await assert.rejects(writer.save(head,ticket.upload_id),/lost reply/);
 const restored=new OfficeUpdateWriter(session,new OfficeUpdateRecovery(account),await new OfficeUpdateRecovery(account).open(receipt,format));
 const state=await restored.recoveryState();assert.equal(state.uploadId,'upload-1');
 assert.equal(await restored.save(state.head,state.uploadId),'b'.repeat(64));assert.equal(uploads,1);assert.deepEqual(calls[0],calls[1]);assert.deepEqual(calls[1],['project','target','fixed-request','verified-plan','upload-1']);
 await assert.rejects(restored.save(head,'another-upload'),/changed/);await assert.rejects(restored.save('c'.repeat(64),state.uploadId),/changed/);
 await assert.rejects(recovery.open(receipt,'cloudflareos.spreadsheet'));await assert.rejects(new OfficeUpdateRecovery(storage()).open(receipt,format));
 const tampered=receipt.slice(0,20)+(receipt[20]==='A'?'B':'A')+receipt.slice(21);await assert.rejects(recovery.open(tampered,format));
 const creation=new NativeCreationRecovery(account);const creationReceipt=await creation.seal({project:'project',name:'Copy',format,head,request:'request',upload:'upload'});
 await assert.rejects(recovery.open(creationReceipt,format));await assert.rejects(creation.open(receipt,format));
 denied=true;await assert.rejects(restored.save(head,state.uploadId),/revoked/);
});
test('parallel upload requests cannot exceed the frozen writer limit',async()=>{
 let release;const pending=new Promise(resolve=>release=resolve);let issued=0;
 const writer=new OfficeUpdateWriter({beginNativeUpload:async()=>{const id=++issued;await pending;return {upload_id:String(id)}}},new OfficeUpdateRecovery(storage()),{project:'p',node:'n',format:'cloudflareos.document',head:'a'.repeat(64),request:'r',update:'u',upload:''});
 const requests=Array.from({length:8},()=>writer.issue('a'.repeat(64),4,'checksum'));
 await assert.rejects(writer.issue('a'.repeat(64),4,'checksum'),/fixed/);release();await Promise.all(requests);assert.equal(issued,8);
});
