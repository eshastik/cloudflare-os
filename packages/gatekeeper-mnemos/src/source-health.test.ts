import {test} from 'node:test';
import assert from 'node:assert/strict';
import {observeSourceRead,sourceHealth} from './source-health.ts';
test('source health preserves the last success across failure, clears recovery errors and separates generations',async()=>{
 const values=new Map<string,unknown>();
 const storage={get:<T>(key:string)=>values.get(key) as T|undefined,put:<T>(key:string,v:T)=>{values.set(key,v)},delete:(key:string)=>{values.delete(key)}};
 await observeSourceRead(storage,'imap','one','g1',async()=>42);
 const first=sourceHealth(storage,'imap','one','g1').last_success_at;
 await assert.rejects(observeSourceRead(storage,'imap','one','g1',async()=>{throw Error('private provider error')}));
 assert.equal(sourceHealth(storage,'imap','one','g1').last_success_at,first);
 assert.ok(sourceHealth(storage,'imap','one','g1').last_error_at);
 assert.ok(!JSON.stringify([...values]).includes('private provider'));
 assert.deepEqual(sourceHealth(storage,'imap','one','g2'),{});
 await observeSourceRead(storage,'imap','one','g1',async()=>43);
 assert.equal(sourceHealth(storage,'imap','one','g1').last_error_at,undefined);
});
