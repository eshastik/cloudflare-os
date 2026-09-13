import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';

test('native Worker fetch authenticates the root and captures a fixed file',async()=>{
 const result=await build({stdin:{contents:`import {WebDAVImportReader} from './packages/webdav-client/src/client.ts';
 export default {async fetch(){const reader=new WebDAVImportReader({url:'https://dav.example/root/'},{username:'alice',password:'app-password'},async()=>{});await reader.checkConnection();const result=await reader.snapshot('a.txt');return Response.json({sha256:result.sha256,version:result.sourceVersion});}};`,resolveDir:new URL('../../..',import.meta.url).pathname,loader:'ts'},bundle:true,format:'esm',platform:'browser',write:false});
 const calls=[];
 const mf=new Miniflare({modules:true,script:result.outputFiles[0].text,compatibilityDate:'2026-02-02',compatibilityFlags:['nodejs_compat'],outboundService:async request=>{
  const url=new URL(request.url);assert.equal(url.origin,'https://dav.example');assert.equal(request.headers.get('authorization'),'Basic YWxpY2U6YXBwLXBhc3N3b3Jk');calls.push(request.method);
  if(request.method==='GET'){assert.equal(request.headers.get('if-match'),'"one"');return new Response('abc',{headers:{etag:'"one"','content-type':'text/plain'}});}
  assert.equal(request.method,'PROPFIND');assert.equal(request.headers.get('depth'),'0');
  const collection=url.pathname==='/root/';
  return new Response(`<d:multistatus xmlns:d="DAV:"><d:response><d:href>${url.pathname}</d:href><d:propstat><d:prop><d:resourcetype>${collection?'<d:collection/>':''}</d:resourcetype><d:getetag>one</d:getetag><d:getcontentlength>3</d:getcontentlength><d:getcontenttype>text/plain</d:getcontenttype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`,{status:207});
 }});
 try{
  const response=await mf.dispatchFetch('http://worker/');assert.equal(response.status,200);assert.deepEqual(await response.json(),{sha256:'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',version:'"one"'});assert.deepEqual(calls,['PROPFIND','PROPFIND','GET','PROPFIND']);
 }finally{await mf.dispose();}
});
