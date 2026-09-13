import {test} from 'node:test';
import assert from 'node:assert/strict';
import {saveTelegramSetup} from './telegram-setup.ts';

test('A failed setup preserves prior connection and leaves its request reusable',()=>{
 for(const failedKey of ['pairing','request:new','connection']){
  const previous={token:'old-private-token',ready:true};
  const values=new Map<string,unknown>([['connection',previous],['unrelated',17]]);
  let fail=true,inside=false;
  const storage={kv:{put<T>(key:string,value:T){assert.ok(inside,'all setup writes must share the transaction');if(fail&&key===failedKey)throw Error('injected write failure');values.set(key,value);}},transactionSync<T>(work:()=>T):T{const before=new Map(values);inside=true;try{return work();}catch(error){values.clear();for(const [k,v] of before)values.set(k,v);throw error;}finally{inside=false;}}};
  const create=()=>{storage.kv.put('pairing',{epoch:'new'});return {token:'new-private-token',ready:false};};
  assert.throws(()=>saveTelegramSetup(storage,'new',create),/injected write failure/);
  assert.deepEqual([...values],[['connection',previous],['unrelated',17]]);
  fail=false;const result=saveTelegramSetup(storage,'new',create);
  assert.deepEqual(values.get('connection'),result);assert.equal(values.get('request:new'),true);assert.deepEqual(values.get('pairing'),{epoch:'new'});assert.equal(values.get('unrelated'),17);
 }
});
