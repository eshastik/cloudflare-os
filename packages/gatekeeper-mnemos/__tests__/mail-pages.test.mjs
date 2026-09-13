import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';
const result=await build({entryPoints:[new URL('../src/mail-pages.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'esm',write:false});
const {MailPages}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
import {normalizeMailSearch,matchesMailSearch} from '@gadgets/workshop-shared/mail-search';
test('cursor survives storage reconstruction and cannot change owner, folder, limit or search',async()=>{
 const rows=new Map(),storage={get:key=>structuredClone(rows.get(key)),put:(key,v)=>rows.set(key,structuredClone(v))};const pages=new MailPages(storage);
 const scope={selection:'selected',tenant:'tenant',owner:'owner',epoch:'epoch'},request={limit:2,search:{text:'ТЕМА',from:'A@example.test'}};
 const cursor=await pages.save(scope,request,'private-provider-token');assert(!cursor.includes('private'));
 assert.equal(new MailPages(storage).resolve(scope,{...request,cursor}),'private-provider-token');
 assert.equal(await pages.save(scope,{limit:2,search:{from:'a@example.test',text:'тема'}},'private-provider-token'),cursor);
 for(const change of [{selection:'other'},{tenant:'other'},{owner:'other'},{epoch:'other'}])assert.throws(()=>pages.resolve({...scope,...change},{...request,cursor}));
 for(const change of [{limit:3},{search:{text:'other'}}])assert.throws(()=>pages.resolve(scope,{...request,...change,cursor}));
 await assert.rejects(pages.save(scope,{...request,cursor},'private-provider-token'));
});
test('search uses common literal Unicode text, exact sender and inclusive/exclusive UTC dates',()=>{
 const message={subject:'Письмо',from:[{name:'Sender',address:'a@example.test'}],received_at:'2026-09-11T10:00:00.000Z'};
 assert(matchesMailSearch(message,'e\u0301 '+ 'x'.repeat(16010)+' Нужный текст',normalizeMailSearch({text:'é',from:'A@example.test',after:'2026-09-11T13:00:00+03:00',before:'2026-09-11T11:00:00Z'})));
 assert(!matchesMailSearch(message,'text',normalizeMailSearch({before:'2026-09-11T10:00:00Z'})));
 for(const input of [{after:'2026-02-30T10:00:00Z'},{after:'2026-09-11T24:00:00Z'},{text:'bad\ntext'},{folder:'other'},{after:'2026-09-12T00:00:00Z',before:'2026-09-11T00:00:00Z'}])assert.throws(()=>normalizeMailSearch(input));
});
