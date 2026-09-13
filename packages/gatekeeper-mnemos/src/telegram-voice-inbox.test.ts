import {test} from 'node:test';import assert from 'node:assert/strict';
import {TelegramVoiceInbox} from './telegram-voice-inbox.ts';
function store(){const data=new Map<string,unknown>();return {get:<T>(key:string)=>structuredClone(data.get(key)) as T|undefined,put:<T>(key:string,value:T)=>{data.set(key,structuredClone(value));},delete:(key:string)=>{data.delete(key);},list:<T>(options:{prefix:string;limit?:number})=>[...data].filter(([key])=>key.startsWith(options.prefix)).slice(0,options.limit).map(([k,v])=>[k,structuredClone(v)] as [string,T])};}
const input={update:7,message:8,sender:42,voice:{file_id:'voice_id',file_unique_id:'unique_voice',duration:4,mime_type:'audio/ogg',file_size:3},caption:'spoken request'};
test('Voice inbox keeps immutable update identity across restart and rejects changed delivery',async()=>{
 const storage=store();let active=true;const authorize=async()=>{if(!active)throw Error('revoked');};
 let inbox=new TelegramVoiceInbox(storage,'channel','epoch',42);const first=await inbox.accept(input,authorize);
 inbox=new TelegramVoiceInbox(storage,'channel','epoch',42);assert.deepEqual(await inbox.accept(input,authorize),first);assert.deepEqual(await inbox.read(7,authorize),first);
 await assert.rejects(inbox.accept({...input,voice:{...input.voice,file_id:'other'}},authorize));
 await assert.rejects(inbox.accept({...input,sender:43},authorize));
 await assert.rejects(new TelegramVoiceInbox(storage,'channel','other-epoch',42).read(7,authorize));
 active=false;await assert.rejects(inbox.accept(input,authorize));await assert.rejects(inbox.read(7,authorize));
 assert.equal([...storage.list({prefix:'telegramVoice:'})].length,1);
});
test('Voice inbox bounds pending metadata and denies new input without silently dropping it',async()=>{
 const storage=store(),inbox=new TelegramVoiceInbox(storage,'channel','epoch',42),authorize=async()=>{};
 for(let update=0;update<100;update++)await inbox.accept({...input,update},authorize);
 await assert.rejects(inbox.accept({...input,update:100},authorize));assert.equal((await inbox.accept(input,authorize)).input.update,7);
});

test('Imported originals free pending capacity while retaining immutable replay receipts after restart',async()=>{
 const storage=store(),authorize=async()=>{};
 let inbox=new TelegramVoiceInbox(storage,'channel','epoch',42);
 for(let update=0;update<100;update++)await inbox.accept({...input,update},authorize);
 const first=await inbox.read(0,authorize),source={request:first.request,project:'project',sha256:'a'.repeat(64)};
 await assert.rejects(inbox.imported(0,source,async()=>{throw Error('revoked')}));
 assert.equal((await inbox.list(authorize)).length,100);
 await assert.rejects(inbox.imported(0,{...source,request:'foreign'},authorize));
 await inbox.imported(0,source,authorize);
 inbox=new TelegramVoiceInbox(storage,'channel','epoch',42);
 assert.equal((await inbox.list(authorize)).length,99);
 const replay=await inbox.accept({...input,update:0},authorize);assert.equal(replay.state,'imported');assert.deepEqual(replay.imported,source);
 await inbox.imported(0,source,authorize);
 await assert.rejects(inbox.imported(0,{...source,project:'other'},authorize));
 await inbox.accept({...input,update:100},authorize);assert.equal((await inbox.list(authorize)).length,100);
 await assert.rejects(inbox.accept({...input,update:101},authorize));
});

test('Legacy pending entries migrate without losing their original request IDs',async()=>{
 const storage=store(),authorize=async()=>{};
 const first=await new TelegramVoiceInbox(storage,'channel','epoch',42).accept(input,authorize);
 storage.delete('telegramVoiceIndexed:'+JSON.stringify(['channel','epoch']));
 for(const [key] of storage.list({prefix:'telegramVoicePending:'}))storage.delete(key);
 const inbox=new TelegramVoiceInbox(storage,'channel','epoch',42);
 assert.equal((await inbox.list(authorize))[0].request,first.request);
 await inbox.imported(input.update,{request:first.request,project:'project',sha256:'b'.repeat(64)},authorize);
 assert.equal((await inbox.list(authorize)).length,0);
 assert.equal((await inbox.accept(input,authorize)).request,first.request);
});
