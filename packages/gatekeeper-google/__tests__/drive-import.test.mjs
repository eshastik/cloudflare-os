import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {skipRpcValidation} from 'capnweb-validate';
import {readFileSync} from 'node:fs';
const compile=name=>ts.transpileModule(readFileSync(new URL('../src/'+name,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const url=text=>'data:text/javascript;base64,'+Buffer.from(text).toString('base64');
const {GoogleDriveImportReader}=await import(url(compile('drive-import.ts').replace("'./auth-retry'",JSON.stringify(url(compile('auth-retry.ts'))))));
function fixture(t){
 const state={metadata:{id:'file',name:'Team.txt',mimeType:'text/plain',version:'9',size:'3',trashed:false,capabilities:{canDownload:true}},live:true,calls:[],body:()=>new Response('abc',{headers:{'Content-Type':'text/plain'}}),afterRead(){}};
 t.mock.method(globalThis,'fetch',async(input,init)=>{
  const target=new URL(input);state.calls.push(target);assert.equal(target.origin,'https://www.googleapis.com');assert.equal(init.method,'GET');assert.equal(init.redirect,'manual');assert.equal(new Headers(init.headers).get('Authorization'),'Bearer fixture');
  if(target.searchParams.has('fields'))return Response.json(state.metadata);
  const out=state.body();state.afterRead();return out;
 });
 return {state,reader:new GoogleDriveImportReader(async()=> 'fixture',async()=>{if(!state.live)throw Error('revoked')})};
}
test('Drive import copies exact bytes, checks source version twice, and uses GET only',async t=>{
 const {state,reader}=fixture(t);const result=await reader.snapshot('file');
 assert.equal(new TextDecoder().decode(result.bytes),'abc');assert.equal(result.sha256,'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
 assert.equal(result.sourceVersion,'9');assert.equal(result.exported,false);assert.equal(state.calls.length,3);
 assert.equal(state.calls[1].searchParams.get('alt'),'media');assert.equal(state.calls[1].searchParams.get('supportsAllDrives'),'true');
 assert.deepEqual(await reader.snapshot('file'),result);
});
test('Source changes and revocation during download withhold copied bytes',async t=>{
 const {state,reader}=fixture(t);
 state.afterRead=()=>{state.metadata.version='10'};
 await assert.rejects(reader.snapshot('file'),/changed/);
 state.afterRead=()=>{state.live=false};
 await assert.rejects(reader.snapshot('file'),/revoked/);
});
test('Workspace export is explicitly identified; unsupported native types are not flattened',async t=>{
 const {state,reader}=fixture(t);
 state.metadata.mimeType='application/vnd.google-apps.document';delete state.metadata.size;
 const type='application/vnd.openxmlformats-officedocument.wordprocessingml.document';state.body=()=>new Response('fixture-docx',{headers:{'Content-Type':type}});
 const result=await reader.snapshot('file');assert.equal(result.exported,true);assert.equal(result.contentType,type);assert.equal(result.sourceMimeType,state.metadata.mimeType);
 assert.equal(state.calls[1].pathname,'/drive/v3/files/file/export');assert.equal(state.calls[1].searchParams.get('mimeType'),type);
 state.metadata.mimeType='application/vnd.google-apps.shortcut';state.calls=[];
 await assert.rejects(reader.snapshot('file'),/Unsupported/);assert.equal(state.calls.length,1);
});
test('Deleted, download-restricted, malformed or oversized sources fail before copying',async t=>{
 const {state,reader}=fixture(t);const original=structuredClone(state.metadata);
 for(const change of [{trashed:true},{capabilities:{canDownload:false}},{version:''},{id:'other'},{size:'999999999'}]){
  state.metadata={...original,...change};state.calls=[];
  await assert.rejects(reader.snapshot('file'));assert.equal(state.calls.length,1);
 }
 state.calls=[];await assert.rejects(reader.snapshot('../other'));assert.equal(state.calls.length,0);
});
test('Truncated, mismatched, or unbounded response bodies cannot become import snapshots',async t=>{
 const {state,reader}=fixture(t);
 state.body=()=>new Response('ab',{headers:{'Content-Type':'text/plain'}});await assert.rejects(reader.snapshot('file'),/Incomplete/);
 state.body=()=>new Response('<html>denied</html>',{headers:{'Content-Type':'text/html'}});await assert.rejects(reader.snapshot('file'),/content type/);
 let cancelled=false;
 state.body=()=>new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(16*1024*1024+1))},cancel(){cancelled=true}}),{headers:{'Content-Type':'text/plain'}});
 await assert.rejects(reader.snapshot('file'),/size limit/);assert.equal(cancelled,true);
});

test('Trusted account entrypoint requires Drive scope and fences OAuth replacement during capture',async t=>{
 const source=readFileSync(new URL('../src/google.ts',import.meta.url),'utf8');
 const ast=ts.createSourceFile('google.ts',source,ts.ScriptTarget.Latest,true);
 const cls=ast.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='GatekeeperUserImpl');
 const method=cls.members.find(n=>ts.isMethodDeclaration(n)&&n.name.getText(ast)==='readDriveImport').getText(ast);
 const resource=ast.statements.find(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(ast)==='GOOGLE_DRIVE_IMPORT_RESOURCE')).getText(ast);
 const js=ts.transpileModule(`${resource}\nreturn class Account {constructor(ctx){this.ctx=ctx;} ${method}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 const Account=new Function('GoogleDriveImportReader',js)(GoogleDriveImportReader);
 const {state}=fixture(t);let patterns=[],generation='one',tokenCalls=0;
 const owner={getGrantedResourceUrlPatterns:async()=>patterns,calendarSourceGeneration:async()=>generation,getAccessToken:async()=>{tokenCalls++;return {token:'fixture'}}};
 const adapter=new Account({props:{userObjectId:'owner'},exports:{UserAccount:{idFromString:id=>id,get:()=>owner}}});
 await assert.rejects(adapter.readDriveImport('file'),/scope/);assert.equal(tokenCalls,0);assert.equal(state.calls.length,0);
 patterns=['https://drive.google.com/file/:fileId/*'];
 assert.equal((await adapter.readDriveImport('file')).fileId,'file');
 state.afterRead=()=>{generation='two'};
 await assert.rejects(adapter.readDriveImport('file'),/changed/);
 state.afterRead=()=>{patterns=[]};
 await assert.rejects(adapter.readDriveImport('file'),/scope/);
});

test('Drive import authorization is explicit and legacy metadata grants do not imply it',()=>{
 const source=readFileSync(new URL('../src/google.ts',import.meta.url),'utf8');
 const ast=ts.createSourceFile('google.ts',source,ts.ScriptTarget.Latest,true);
 const names=['GMAIL_RESOURCE','GOOGLE_DOC_RESOURCE','GOOGLE_SHEETS_RESOURCE','GOOGLE_CALENDAR_RESOURCE','BIGQUERY_RESOURCE','GOOGLE_DRIVE_IMPORT_RESOURCE','RESOURCE_SCOPES','IDENTITY_SCOPES','BIGQUERY_HOST','LEGACY_GRANTED_RESOURCE_URL_PATTERNS'];
 const declarations=ast.statements.filter(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>names.includes(d.name.getText(ast)))).map(n=>n.getText(ast)).join('\n');
 const functions=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&['validateResourceUrlPatterns','resourceUrlPatternsToOAuthScopes','grantedResourcesFromScopes'].includes(n.name?.text)).map(n=>n.getText(ast)).join('\n');
 const code=ts.transpileModule(declarations+'\n'+functions+'\nreturn {resourceUrlPatternsToOAuthScopes,grantedResourcesFromScopes,LEGACY_GRANTED_RESOURCE_URL_PATTERNS,GOOGLE_DRIVE_IMPORT_RESOURCE};',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 const api=new Function(code)();const pattern=api.GOOGLE_DRIVE_IMPORT_RESOURCE.urlPattern;
 const scopes=api.resourceUrlPatternsToOAuthScopes([pattern]);
 assert.ok(scopes.includes('https://www.googleapis.com/auth/drive.readonly'));
 assert.ok(!scopes.includes('https://www.googleapis.com/auth/documents'));
 assert.ok(!api.LEGACY_GRANTED_RESOURCE_URL_PATTERNS.includes(pattern));
 assert.ok(!api.grantedResourcesFromScopes(['https://www.googleapis.com/auth/drive.metadata.readonly']).includes(pattern));
 assert.ok(api.grantedResourcesFromScopes(['https://www.googleapis.com/auth/drive.readonly']).includes(pattern));
});

test('Drive source factory retains one file and rejects an old account generation before token use',async t=>{
 const sourceText=readFileSync(new URL('../src/google.ts',import.meta.url),'utf8');
 const ast=ts.createSourceFile('google.ts',sourceText,ts.ScriptTarget.Latest,true);
 const cls=ast.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='GatekeeperUserImpl');
 const method=cls.members.find(n=>ts.isMethodDeclaration(n)&&n.name.getText(ast)==='getDriveImportSource').getText(ast);
 const sourceClass=ast.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='GoogleDriveImportSource').getText(ast).replace(/^export /,'');
 const resource=ast.statements.find(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(ast)==='GOOGLE_DRIVE_IMPORT_RESOURCE')).getText(ast);
 const code=ts.transpileModule(`${resource}\n${sourceClass}\nclass Account {constructor(ctx){this.ctx=ctx;} ${method}}\nreturn {Account,GoogleDriveImportSource};`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 // Exercise account authorization here; native Worker RPC serialization is checked in the live import flow.
 const types=new Function('WorkerEntrypoint','GoogleDriveImportReader','skipRpcValidation',code)(class {constructor(ctx){this.ctx=ctx}},GoogleDriveImportReader,skipRpcValidation);
 const {state}=fixture(t);let generation='one',tokenCalls=0,allowed=true;
 const owner={calendarSourceGeneration:async()=>generation,getGrantedResourceUrlPatterns:async()=>allowed?['https://drive.google.com/file/:fileId/*']:[],getAccessToken:async()=>{tokenCalls++;return {token:'fixture'}}};
 const exports={UserAccount:{get:()=>owner,idFromString:id=>id},GoogleDriveImportSource:({props})=>new types.GoogleDriveImportSource({props,exports})};
 const account=new types.Account({props:{userObjectId:'owner'},exports});
 await assert.rejects(account.getDriveImportSource('../other'),/Invalid/);
 allowed=false;await assert.rejects(account.getDriveImportSource('file'),/scope/);assert.equal(tokenCalls,0);
 allowed=true;const selected=await account.getDriveImportSource('file');assert.equal(selected.sourceKey,'["owner","file","one"]');
 assert.equal((await selected.source.read('other')).fileId,'file');assert.ok(state.calls.every(url=>url.pathname==='/drive/v3/files/file'));
 const used=tokenCalls;generation='two';await assert.rejects(selected.source.read(),/changed/);assert.equal(tokenCalls,used);
 const fresh=await account.getDriveImportSource('file');assert.notEqual(fresh.sourceKey,selected.sourceKey);
 allowed=false;await assert.rejects(fresh.source.validate(),/scope/);assert.equal(tokenCalls,used);
});

test('Provider SHA-256 rejects same-size corruption and changing checksum metadata',async t=>{
 const {state,reader}=fixture(t);state.metadata.sha256Checksum='ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
 assert.equal((await reader.snapshot('file')).sha256,state.metadata.sha256Checksum);
 assert.ok(state.calls[0].searchParams.get('fields').includes('sha256Checksum'));
 state.body=()=>new Response('abd',{headers:{'Content-Type':'text/plain'}});
 await assert.rejects(reader.snapshot('file'),/checksum mismatch/);
 state.body=()=>new Response('abc',{headers:{'Content-Type':'text/plain'}});
 state.afterRead=()=>{state.metadata.sha256Checksum='a'.repeat(64)};
 await assert.rejects(reader.snapshot('file'),/changed/);
 state.afterRead=()=>{};state.metadata.sha256Checksum='malformed';state.calls=[];
 await assert.rejects(reader.snapshot('file'),/checksum unavailable/);assert.equal(state.calls.length,1);
});
