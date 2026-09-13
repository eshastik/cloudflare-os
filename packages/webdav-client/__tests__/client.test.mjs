import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const output = await build({entryPoints:[new URL('../src/client.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'esm',write:false});
const {WebDAVImportReader} = await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
const root='https://dav.example.test/remote.php/dav/files/alice/';
function fixture(){
 const state={live:true,calls:[],version:'"one"',bytes:'abc',afterRead(){},mutateXml:x=>x,getHeaders:{},status:200};
 const reader=new WebDAVImportReader({url:root},{username:'alice',password:'app-password'},async()=>{if(!state.live)throw Error('revoked')},async(url,init)=>{
  state.calls.push({url:String(url),method:init.method});assert.equal(init.redirect,'manual');assert.equal(new Headers(init.headers).get('Authorization'),'Basic YWxpY2U6YXBwLXBhc3N3b3Jk');
  if(init.method==='PROPFIND'){
   assert.equal(init.headers.Depth,'0');
   const xml=`<d:multistatus xmlns:d="DAV:"><d:response><d:href>${new URL(url).pathname}</d:href><d:propstat><d:prop><d:resourcetype/><d:getetag>${state.version}</d:getetag><d:getcontentlength>3</d:getcontentlength><d:getcontenttype>text/plain</d:getcontenttype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat><d:propstat><d:prop><d:displayname/></d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat></d:response></d:multistatus>`;
   return new Response(state.mutateXml(xml),{status:207,headers:{'content-type':'application/xml'}});
  }
  assert.equal(init.method,'GET');assert.equal(init.headers['If-Match'],state.version);
  const response=new Response(state.bytes,{status:state.status,headers:{etag:state.version,'content-type':'text/plain',...state.getHeaders}});state.afterRead();return response;
 });return {state,reader};
}
test('captures UTF-8 path with exact bytes, strong version and read-only methods',async()=>{
 const {reader,state}=fixture();const result=await reader.snapshot('Команда/План.txt');
 assert.equal(result.provider,'webdav');assert.equal(result.fileId,'Команда/План.txt');assert.equal(result.sourceName,'План.txt');assert.equal(result.sourceVersion,'"one"');assert.equal(new TextDecoder().decode(result.bytes),'abc');
 assert.equal(result.sha256,'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');assert.deepEqual(state.calls.map(c=>c.method),['PROPFIND','GET','PROPFIND']);assert.ok(state.calls.every(c=>c.url===root+encodeURIComponent('Команда')+'/'+encodeURIComponent('План.txt')));
});
test('account revocation and concurrent source changes withhold bytes',async()=>{
 for(const scenario of ['revoked','changed']){const {reader,state}=fixture();state.afterRead=()=>scenario==='revoked'?state.live=false:state.version='"two"';await assert.rejects(reader.snapshot('a.txt'));}
 const {reader,state}=fixture();state.live=false;await assert.rejects(reader.snapshot('a.txt'));assert.equal(state.calls.length,0);
});
test('selection cannot escape root or inject URL components',async()=>{
 const {reader,state}=fixture();for(const path of ['../a','/a','//evil.test/a','a/../b','a//b','a%2fb','a\\b','a?x=y','a#x','a\n'])await assert.rejects(reader.snapshot(path));assert.equal(state.calls.length,0);
});
test('directories, weak revisions, foreign hrefs, namespaces, duplicate properties and DTDs are rejected',async()=>{
 const mutations=[
  x=>x.replace('<d:resourcetype/>','<d:resourcetype><d:collection/></d:resourcetype>'),
  x=>x.replace('"one"','W/"one"'),
  x=>x.replace(/<d:href>.*?<\/d:href>/,'<d:href>https://foreign.test/a.txt</d:href>'),
  x=>x.replace('xmlns:d="DAV:"','xmlns:d="urn:foreign"'),
  x=>x.replace('<d:getcontentlength>3</d:getcontentlength>','<d:getcontentlength>3</d:getcontentlength><d:getcontentlength>3</d:getcontentlength>'),
  x=>'<!DOCTYPE x [<!ENTITY x SYSTEM "file:///private">]>'+x,
  x=>x.replace('<d:getcontentlength>3','<d:getcontentlength>999999999'),
 ];
 for(const change of mutations){const {reader,state}=fixture();state.mutateXml=change;await assert.rejects(reader.snapshot('a.txt'));assert.equal(state.calls.length,1);}
});
test('namespace prefixes and 404 optional properties do not affect DAV identity',async()=>{
 const {reader,state}=fixture();state.mutateXml=x=>x.replaceAll('d:','z:').replace('xmlns:d','xmlns:z');assert.equal((await reader.snapshot('a.txt')).sourceVersion,'"one"');
});
test('unquoted XML etag from WsgiDAV matches the quoted HTTP representation',async()=>{
 const {reader,state}=fixture();state.mutateXml=x=>x.replace('<d:getetag>"one"</d:getetag>','<d:getetag>one</d:getetag>');assert.equal((await reader.snapshot('a.txt')).sourceVersion,'"one"');
});
test('redirects, truncated responses, changed ETag and wrong content type fail closed',async()=>{
 for(const change of [{status:302,getHeaders:{location:'https://foreign.test/a'}},{status:412},{bytes:'ab'},{getHeaders:{etag:'"other"'}},{getHeaders:{'content-type':'text/html'}},{getHeaders:{'content-length':'4'}},{getHeaders:{'content-encoding':'gzip'}}]){
  const {reader,state}=fixture();Object.assign(state,change);await assert.rejects(reader.snapshot('a.txt'));assert.equal(state.calls.length,2);
 }
});
