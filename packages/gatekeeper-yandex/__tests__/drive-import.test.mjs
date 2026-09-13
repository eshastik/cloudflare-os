import {createHash} from 'node:crypto';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const compiled=await build({entryPoints:['src/drive-import.ts'],bundle:true,format:'esm',platform:'node',write:false});
const {YandexDiskImportReader}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const digest=crypto.subtle.digest.bind(crypto.subtle);
crypto.subtle.digest=async(algorithm,bytes)=>algorithm==='MD5'?Uint8Array.from(createHash('md5').update(bytes).digest()).buffer:digest(algorithm,bytes);
const path='disk:/Команда/план & бюджет.docx';
function fixture(){
 const state={calls:[],metadata:0,revoked:false,changed:false,corrupt:false,link:'https://downloader.disk.yandex.ru/disk/signed',redirect:false};
 const metadata={path,name:'план & бюджет.docx',type:'file',mime_type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',modified:'2026-09-11T00:00:00Z',size:3,md5:'900150983cd24fb0d6963f7d28e17f72'};
 const fetcher=async(url,init)=>{
  assert.equal(init.method,'GET');assert.equal(init.redirect,'manual');state.calls.push({url,headers:init.headers});
  if(url.hostname==='cloud-api.yandex.net'){
   assert.equal(init.headers.Authorization,'OAuth fixture-token');assert.equal(url.searchParams.get('path'),path);
   if(url.pathname.endsWith('/download'))return Response.json({href:state.link,method:'GET',templated:false});
   state.metadata++;return Response.json({...metadata,...(state.changed&&state.metadata===2?{modified:'2026-09-11T01:00:00Z'}:{})});
  }
  assert.equal(init.headers.Authorization,undefined);
  if(state.redirect)return new Response(null,{status:302,headers:{location:'https://untrusted.example/file'}});
  if(state.revoked)state.denied=true;
  return new Response(state.corrupt?'bad':'abc');
 };
 const reader=new YandexDiskImportReader(async()=>'fixture-token',async()=>{if(state.denied)throw Error('revoked')},fetcher);
 return {state,reader,metadata};
}
test('captures original bytes using GET only, with a separate token-free download and exact provenance',async()=>{
 const {state,reader}=fixture();const out=await reader.snapshot(path);
 assert.equal(out.provider,'yandex-disk');assert.equal(out.fileId,path);assert.equal(out.exported,false);
 assert.equal(new TextDecoder().decode(out.bytes),'abc');assert.equal(out.sha256,'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
 assert.equal(state.calls.length,4);assert.equal(out.sourceVersion,'2026-09-11T00:00:00Z:900150983cd24fb0d6963f7d28e17f72');
 assert.equal(out.href,undefined);
});
test('changed, corrupt, oversized and revoked sources never produce an import snapshot',async()=>{
 for(const flag of ['changed','corrupt','revoked']){const {reader,state}=fixture();state[flag]=true;await assert.rejects(reader.snapshot(path));}
 const {reader,metadata,state}=fixture();metadata.size=17*1024*1024;await assert.rejects(reader.snapshot(path));assert.equal(state.calls.length,1);
});
test('untrusted links, redirects and invalid paths do not send account credentials or follow an external target',async()=>{
 for(const link of ['https://evil.example/file','https://downloader.disk.yandex.ru.evil.example/file','http://downloader.disk.yandex.ru/file','https://user@downloader.disk.yandex.ru/file']){
  const {reader,state}=fixture();state.link=link;await assert.rejects(reader.snapshot(path));assert.equal(state.calls.length,2);
 }
 const {reader,state}=fixture();state.redirect=true;await assert.rejects(reader.snapshot(path));assert.equal(state.calls.length,3);
 for(const invalid of ['https://example.com/file','disk:/../secret','disk:/a//b'])await assert.rejects(reader.snapshot(invalid));
 assert.equal(state.calls.length,3);
});
