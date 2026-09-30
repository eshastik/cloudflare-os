import {test} from 'node:test';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('Документ Telegram применяет тёмную тему и меняет её без перезагрузки', {timeout:60000}, async () => {
const root=fileURLToPath(new URL('..',import.meta.url));
const work=await mkdtemp(join(tmpdir(),'mnemos-native-theme-code-'));
const artifacts=process.env.MNEMOS_BROWSER_ARTIFACT_DIR || work;
await mkdir(artifacts,{recursive:true});
const require=createRequire(root+'/packages/gatekeeper-mnemos/package.json');
const {build}=require('esbuild');
await promisify(execFile)(process.execPath,[root+'/packages/workshop-backend/scripts/build-format-blueprints.mjs'],{cwd:root+'/packages/workshop-backend'});
await build({entryPoints:[root+'/packages/workshop-backend/src/native-editor-update.ts'],bundle:true,platform:'node',format:'esm',outfile:join(work,'native-code.mjs')});
const {nativeEditorCode}=await import(pathToFileURL(join(work,'native-code.mjs')).href);
const bundle=await nativeEditorCode('document');
if(!bundle)throw new Error('Нет встроенного редактора документа');
const client=bundle.files.get('client.js');
const shared=await build({entryPoints:[root+'/packages/workshop-shared/src/telegram-mini-app.ts'],bundle:true,platform:'node',format:'esm',write:false});
await writeFile(join(work,'mini-app-shared.mjs'),shared.outputFiles[0].text);
const {MINI_APP_EDITOR_FRAME_HTML,MINI_APP_EDITOR_FRAME_CSP,MINI_APP_EDITOR_FRAME_PATH}=await import(pathToFileURL(join(work,'mini-app-shared.mjs')).href);
const compiled=await build({stdin:{loader:'jsx',resolveDir:root+'/packages/workshop-frontend',contents:`
import React from 'react';
import {createRoot} from 'react-dom/client';
import {RpcTarget,RpcStub} from 'capnweb';
import DocumentScreen from './src/telegram-app/DocumentScreen';
const documentSnapshot={title:'План аудита',revision:3,restoreRevision:0,blocks:[
 {id:'heading',html:'<h1>Проверка тёмной темы</h1>',version:1},
 {id:'paragraph',html:'<p>Документ открыт в настоящем редакторе Telegram. Текст, кнопки и фон должны оставаться читаемыми.</p>',version:1},
 {id:'list',html:'<ul><li>Проверить сохранение</li><li>Проверить версии</li></ul>',version:1}
]};
window.fixture={connects:0,errors:[],themes:[],messages:[]};
class Editor extends RpcTarget {
 async subscribe(){return documentSnapshot;}
 async getDocument(){return documentSnapshot;}
 async updatePresence(){} async leavePresence(){}
 async exportDocumentSnapshot(){return {format:'cloudflareos.document',formatVersion:1,document:documentSnapshot};}
}
const api={
 async describe(){return {title:'План аудита',format:'cloudflareos.document',accent:'#176b9a',storageOrigin:location.origin,sitePath:'/workspace/demo',mnemos:{kind:'bound',access:'owner',savedHead:'a'.repeat(64),savedRevision:3}};},
 async getUiBundle(){return {jsCode:${JSON.stringify(client)}};},
 async connectEditor(){window.fixture.connects++;return new RpcStub(new Editor());},
 async close(){}
};
const handlers=new Set();
const webApp={initData:'fixture',colorScheme:'dark',themeParams:{bg_color:'#17212b',text_color:'#f5f5f5',secondary_bg_color:'#232e3c',hint_color:'#8899aa'},ready(){},close(){},enableClosingConfirmation(){},disableClosingConfirmation(){},onEvent(event,cb){if(event==='themeChanged')handlers.add(cb);},offEvent(event,cb){handlers.delete(cb);}};
window.changeTheme=mode=>{webApp.colorScheme=mode;webApp.themeParams=mode==='dark'?{bg_color:'#17212b',text_color:'#f5f5f5',secondary_bg_color:'#232e3c',hint_color:'#8899aa'}:{bg_color:'#ffffff',text_color:'#18222d',secondary_bg_color:'#f2f4f6',hint_color:'#627485'};for(const cb of handlers)cb();};
window.addEventListener('message',e=>{window.fixture.messages.push({origin:e.origin,type:typeof e.data==='string'?e.data:e.data?.type});if(e.data?.type==='native-ui-readiness')window.fixture.ready=e.data.outcome;if(e.data?.type==='console'&&e.data.level==='error')window.fixture.errors.push(e.data.message);});
createRoot(document.getElementById('root')).render(<DocumentScreen session={'a'.repeat(64)+'.'+'b'.repeat(43)} title='План аудита' siteUrl={null} webApp={webApp} pollMs={10} connect={()=>({api,close(){}})} />);
`},loader:{'.tsx':'tsx'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',plugins:[{name:'capnweb-raw',setup(b){b.onResolve({filter:/^capnweb\?raw$/},()=>({path:require.resolve('capnweb').replace(/\.cjs$/,'.js'),namespace:'raw'}));b.onLoad({filter:/.*/,namespace:'raw'},async a=>({contents:await readFile(a.path,'utf8'),loader:'text'}));}}]});
const css=await readFile(root+'/packages/workshop-frontend/src/telegram-app/mini-app.css','utf8');
const script=compiled.outputFiles[0].text.replaceAll('</script','<\\/script');
const page=`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script>${script}</script></body></html>`;
const server=createServer((req,res)=>{if(req.url===MINI_APP_EDITOR_FRAME_PATH){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':MINI_APP_EDITOR_FRAME_CSP});res.end(MINI_APP_EDITOR_FRAME_HTML);}else{res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(page);}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}/`;
const dir=await mkdtemp(join(tmpdir(),'mnemos-native-dark-'));
let child,socket;
try {
 child=spawn(process.env.CHROME_BINARY || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless','--disable-background-networking','--disable-component-update','--disable-sync','--disable-extensions','--no-first-run','--no-default-browser-check',`--user-data-dir=${dir}`,'--remote-debugging-port=0',url],{detached:true,stdio:['ignore','ignore','pipe']});
 const endpoint=await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(new Error('Chrome не открыл CDP')),10000);child.stderr.on('data',chunk=>{text+=chunk;const m=text.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(timer);resolve(m[1]);}});child.once('error',reject);});
 socket=new WebSocket(endpoint);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
 let seq=0;const pending=new Map();
 socket.addEventListener('message',event=>{const x=JSON.parse(String(event.data));const p=pending.get(x.id);if(p){clearTimeout(p.timer);pending.delete(x.id);if(x.error)p.reject(new Error(x.error.message));else p.resolve(x.result);}});
 socket.addEventListener('close',()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('Соединение CDP закрыто'));}pending.clear();});
 const call=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Тайм-аут CDP: '+method));},5000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
 const {targetInfos}=await call('Target.getTargets');const target=targetInfos.find(t=>t.type==='page'&&t.url===url);if(!target)throw new Error('Нет страницы');
 const session=(await call('Target.attachToTarget',{targetId:target.targetId,flatten:true})).sessionId;
 await call('Page.enable',{},session);await call('Runtime.enable',{},session);await call('Log.enable',{},session);
 await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true},session);
 const evaluate=async(expression,contextId)=>(await call('Runtime.evaluate',{expression,returnByValue:true,...(contextId?{contextId}:{})},session)).result.value;
 const deadline=Date.now()+15000;let fixture;
 do{fixture=await evaluate('window.fixture');if(fixture?.ready==='ready')break;await new Promise(resolve=>setTimeout(resolve,50));}while(Date.now()<deadline);
 if(fixture?.ready!=='ready'){const ts=await call('Target.getTargets');console.log('TARGETS',JSON.stringify(ts));const it=ts.targetInfos.find(t=>t.type==='iframe');if(it){const ins=(await call('Target.attachToTarget',{targetId:it.targetId,flatten:true})).sessionId;await call('Runtime.enable',{},ins);await call('Log.enable',{},ins);console.log('OOPIF_BODY',JSON.stringify(await call('Runtime.evaluate',{expression:'({html:document.documentElement.outerHTML.slice(0,4000),text:document.body.innerText})',returnByValue:true},ins)));}const frameState=await call('Page.getFrameTree',{},session);console.log('FRAME_TREE',JSON.stringify(frameState));const cf=frameState.frameTree.childFrames?.[0]?.frame;if(cf){const cx=await call('Page.createIsolatedWorld',{frameId:cf.id,worldName:'failure-inspection'},session);console.log('FRAME_BODY',await evaluate('document.documentElement.outerHTML.slice(0,3000)',cx.executionContextId));}const details=await evaluate('({fixture:window.fixture,body:document.body.innerText,frames:[...document.querySelectorAll("iframe")].map(f=>({src:f.src,sandbox:f.sandbox.value})),html:document.body.outerHTML.slice(0,4000)})');const picture=await call('Page.captureScreenshot',{format:"png"},session);await writeFile(join(artifacts,'telegram-document-not-ready.png'),Buffer.from(picture.data,'base64'));throw new Error('Редактор не готов: '+JSON.stringify(details));}
 const targets=await call('Target.getTargets');const frame=targets.targetInfos.find(t=>t.type==='iframe'&&t.url.endsWith(MINI_APP_EDITOR_FRAME_PATH));if(!frame)throw new Error('Нет фрейма редактора');
 const frameSession=(await call('Target.attachToTarget',{targetId:frame.targetId,flatten:true})).sessionId;
 await call('Runtime.enable',{},frameSession);
 const inspect=async()=>(await call('Runtime.evaluate',{expression:`(()=>{const e=document.querySelector('[contenteditable]');return {mode:document.documentElement.dataset.mode,text:document.body.innerText,title:document.querySelector('input')?.value,bodyBackground:getComputedStyle(document.body).backgroundColor,editorBackground:e?getComputedStyle(e).backgroundColor:null,editorColor:e?getComputedStyle(e).color:null,width:innerWidth,scrollWidth:document.documentElement.scrollWidth};})()`,returnByValue:true},frameSession)).result.value;
 let dark=await inspect();if(dark.mode!=='dark'||!dark.text.includes('Проверка тёмной темы'))throw new Error('Неверный тёмный редактор: '+JSON.stringify(dark));
 const initialConnects=fixture.connects;
 const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},session);await writeFile(join(artifacts,'telegram-document-dark.png'),Buffer.from(shot.data,'base64'));
 await evaluate('window.changeTheme("light")');await new Promise(resolve=>setTimeout(resolve,150));const light=await inspect();
 await evaluate('window.changeTheme("dark")');await new Promise(resolve=>setTimeout(resolve,150));dark=await inspect();fixture=await evaluate('window.fixture');
 if(light.mode!=='light'||dark.mode!=='dark'||light.bodyBackground===dark.bodyBackground||light.editorBackground===dark.editorBackground||light.editorColor===dark.editorColor||fixture.connects!==initialConnects||fixture.errors.length)throw new Error('Ошибка смены темы: '+JSON.stringify({light,dark,fixture}));
 for(const state of [light,dark])if(state.width>390||state.scrollWidth>state.width)throw new Error('Редактор выходит за ширину экрана: '+JSON.stringify(state));
 const shell=await evaluate('({width:innerWidth,scrollWidth:document.documentElement.scrollWidth})');
 if(shell.width>390||shell.scrollWidth>shell.width)throw new Error('Оболочка выходит за ширину экрана: '+JSON.stringify(shell));
 const proof={pass:1,fail:0,scope:'Настоящие DocumentScreen и EditorFrame; подставные API документа и Telegram',revision:bundle.revision,dark,light,fixture,frameId:frame.targetId,screenshot:join(artifacts,'telegram-document-dark.png')};
 await writeFile(join(artifacts,'telegram-document-dark-proof.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));
} finally {
 socket?.close();if(child){try{process.kill(-child.pid,'SIGTERM');}catch{}child.stderr.destroy();}
 await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});await rm(work,{recursive:true,force:true});
}
});
