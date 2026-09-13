import {test} from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {JSDOM} from 'jsdom';import {webcrypto} from 'node:crypto';
const compiled=await build({stdin:{contents:'export {VoiceView} from "./app/voice.ts";export {VoiceTransfer} from "./src/voice-transfer.ts";',resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const {VoiceView,VoiceTransfer}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
test('Reviewed voice command has its own immutable budget and does not overwrite another task',async()=>{
 const values=new Map([['mnemosManagedTaskRequest',{request_id:'existing',submitted:true}]]),storage={get:k=>structuredClone(values.get(k)),put:(k,v)=>values.set(k,structuredClone(v))};
 const before=structuredClone(values.get('mnemosManagedTaskRequest')),text='Prepare a report',hash=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(text))).toString('hex');
 const source={request_id:'source',project_id:'project',media_type:'audio/wav',size_bytes:3,sha256:'a'.repeat(64)};let current=true,live=true,lose=true;const writes=[];
 const api={whoAmI:async()=>{if(!live)throw Error('revoked')},readVoiceSource:async()=>source,readVoiceConfirmation:async()=>({current,revision:2,text_sha256:hash}),readVoiceTranscript:async()=>({revision:2,text}),readProjectBudget:async()=>({project_id:'project',revision:3}),createTeamBudget:async(project,input)=>{writes.push(structuredClone(input));if(lose){lose=false;throw Error('lost reply')}return {id:'budget',project_id:project,proposal:input,state:'approved'}}};
 let transfer=new VoiceTransfer(storage,'https://objects.example');await assert.rejects(transfer.prepareCommandBudget(api,'source','review','agent','Ask for source figures','700000'));
 transfer=new VoiceTransfer(storage,'https://objects.example');const budget=await transfer.resumeCommandBudget(api,'source');
 assert.deepEqual(writes[0],writes[1]);assert.equal(budget.proposal.task,text);assert.deepEqual(budget.proposal.voice,{source_request_id:'source',confirmation_id:'review',revision:2,text_sha256:hash});assert.deepEqual(values.get('mnemosManagedTaskRequest'),before);
 await assert.rejects(transfer.prepareCommandBudget(api,'source','review','other','Ask for source figures','700000'));assert.equal(writes.length,2);
 current=false;await assert.rejects(transfer.prepareCommandBudget(api,'source','review','agent','Ask for source figures','700000'));assert.equal(writes.length,2);
 current=true;live=false;await assert.rejects(transfer.prepareCommandBudget(api,'source','review','agent','Ask for source figures','700000'));assert.equal(writes.length,2);
});

test('Voice UI separates budget creation and execution and rechecks approval before running',async()=>{
 const dom=new JSDOM('<main></main>');globalThis.document=dom.window.document;let runs=0,state='pending';
 const proposal={id:'budget',project_id:'project',state,proposal:{voice:{source_request_id:'source',confirmation_id:'review',revision:1,text_sha256:'a'.repeat(64)},task:'Reviewed instruction',criteria:'Return an answer',limit_usd_micros:'700000',members:[{binding_id:'agent',role:'voice command executor'}]}};
 const api={prepareVoiceCommandBudget:async(...args)=>{assert.deepEqual(args,['source','review','agent','Return an answer','700000']);return structuredClone(proposal)},readTeamBudget:async()=>({...structuredClone(proposal),state}),runTeamBudgetMember:async(...args)=>{assert.deepEqual(args,['project','budget','agent']);runs++;return {request_id:'run',state:'completed',result:{content:'<script>literal answer</script>'}}}};
 try{const root=document.querySelector('main'),view=new VoiceView(root,api,()=>{});view.source={request_id:'source'};view.receipt={operation_id:'review',current:true};view.transcript={text:'Reviewed instruction',uncertain:false};view.text='Reviewed instruction';view.uncertain=false;view.binding='agent';view.commandCriteria='Return an answer';view.commandLimit='0.70';await view.prepareCommand();assert.equal(runs,0);await view.runCommand();assert.equal(runs,0);state='approved';await view.runCommand();assert.equal(runs,1);assert.match(root.textContent,/literal answer/);assert.equal(root.querySelector('script'),null);view.text='Unsaved correction';await view.runCommand();assert.equal(runs,1);}finally{dom.window.close();delete globalThis.document;}
});
test('Voice transfers pin bytes and resume import after lost acknowledgement without another PUT',async()=>{
 const values=new Map(),storage={get:k=>structuredClone(values.get(k)),put:(k,v)=>values.set(k,structuredClone(v))};const bytes=new Uint8Array([1,2,3]);const sum=new Uint8Array(await webcrypto.subtle.digest('SHA-256',bytes));const hash=Buffer.from(sum).toString('hex');let puts=0,imports=0,live=true,lose=true;
 const source={request_id:'source',project_id:'project',media_type:'audio/wav',size_bytes:3,sha256:hash};
 const api={whoAmI:async()=>{if(!live)throw Error('expired');},beginVoiceUpload:async(p,size,checksum)=>({upload_id:'upload',url:'https://objects.example/upload',method:'PUT',content_length:size,checksum_header:'x-amz-checksum-sha256',checksum_value:checksum}),importVoiceSource:async()=>{imports++;if(lose){lose=false;throw Error('lost reply');}return source;},downloadVoiceSource:async()=>({url:'https://objects.example/download'})};
 const fetcher=async(u,init)=>{assert.equal(new URL(u).origin,'https://objects.example');assert.equal(init.redirect,'manual');if(init.method==='PUT'){puts++;return new Response(null,{status:200});}return new Response(bytes);};
 let transfer=new VoiceTransfer(storage,'https://objects.example',fetcher);await assert.rejects(transfer.upload(api,'source','project','audio/wav',bytes));
 transfer=new VoiceTransfer(storage,'https://objects.example',fetcher);assert.deepEqual(await transfer.upload(api,'source','project','audio/wav',bytes),source);assert.equal(puts,1);assert.equal(imports,2);
 await assert.rejects(transfer.upload(api,'source','project','audio/wav',new Uint8Array([4])));assert.equal(puts,1);
 assert.deepEqual(await transfer.read(api,source),bytes);live=false;await assert.rejects(transfer.read(api,source));
});
test('Voice view requires saved text review, preserves retry operation and releases original audio',async()=>{
 const dom=new JSDOM('<main></main>');globalThis.document=dom.window.document;let revoked=0;const originalCreate=URL.createObjectURL,originalRevoke=URL.revokeObjectURL;URL.createObjectURL=()=> 'blob:voice';URL.revokeObjectURL=()=>{revoked++;};
 const calls=[];let lose=true;const source={request_id:'source',project_id:'project',media_type:'audio/wav',size_bytes:3,sha256:'ab'.repeat(32)};
 const api={uploadVoice:async()=>source,readVoiceAudio:async()=>new Uint8Array([1,2,3]),editVoiceTranscript:async(s,incoming)=>{calls.push(structuredClone(incoming));if(lose){lose=false;throw Error('lost reply');}return {source_request_id:s,revision:1,operation_id:incoming.operation_id,kind:'human',text:incoming.text,provider:'',model_id:'',provider_request_id:'',uncertain:incoming.uncertain};},confirmVoiceTranscript:async(s,input)=>{calls.push(input);return {source_request_id:s,operation_id:input.operation_id,revision:1,text_sha256:input.text_sha256,current:true};}};
 try{const root=document.querySelector('main'),view=new VoiceView(root,api,()=>{});view.project='project';view.file={size:3,type:'audio/wav',arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer};await view.upload();await view.listen();assert.ok(root.querySelector('audio'));view.text='ручной текст';await view.save();await view.save();assert.deepEqual(calls[0],calls[1]);
 await view.confirm();assert.equal(calls.length,2);view.consent=true;await view.confirm();assert.equal(calls.length,3);assert.equal(calls[2].confirmed,true);
 const close=[...root.querySelectorAll('button')].find(b=>b.textContent==='Закрыть аудио');close.click();assert.ok(revoked>=1);assert.equal(view.text,'');
 }finally{URL.createObjectURL=originalCreate;URL.revokeObjectURL=originalRevoke;dom.window.close();}
});
test('Microphone attachment accepts only its parent reply and cancels on close',()=>{
 const dom=new JSDOM('<main></main>');globalThis.document=dom.window.document;
 const root=document.querySelector('main'),view=new VoiceView(root,{},()=>{}),messages=[];
 dom.window.postMessage=value=>messages.push(value);
 try{
  view.render();[...root.querySelectorAll('button')].find(b=>b.textContent==='Записать с микрофона').click();
  const request=messages[0];assert.equal(request.type,'gatekeeper-audio-request');
  const data={type:'gatekeeper-audio-result',requestId:request.requestId,mediaType:'audio/webm',bytes:new Uint8Array([1,2,3]).buffer};
  dom.window.dispatchEvent(new dom.window.MessageEvent('message',{source:null,data}));assert.equal(view.file,undefined);
  dom.window.dispatchEvent(new dom.window.MessageEvent('message',{source:dom.window,data:{...data,requestId:'wrong'}}));assert.equal(view.file,undefined);
  dom.window.dispatchEvent(new dom.window.MessageEvent('message',{source:dom.window,data}));assert.equal(view.file.size,3);assert.equal(view.file.type,'audio/webm');
  [...root.querySelectorAll('button')].find(b=>b.textContent==='Записать с микрофона').click();
  [...root.querySelectorAll('button')].find(b=>b.textContent==='Закрыть аудио').click();assert.equal(messages.at(-1).type,'gatekeeper-audio-cancel');assert.equal(view.file,undefined);
 }finally{dom.window.close();}
});
test('Reopen reads owned metadata again and never carries old text or consent',async()=>{
 const dom=new JSDOM('<main></main>');globalThis.document=dom.window.document;
 const source={request_id:'saved',project_id:'project',media_type:'audio/wav',size_bytes:3,sha256:'ab'.repeat(32)};
 let calls=0;const api={readVoiceSource:async id=>{calls++;assert.equal(id,'saved');return source;}};
 try{const root=document.querySelector('main'),view=new VoiceView(root,api,()=>{});view.render();assert.ok(root.querySelector('[aria-label="ID сохранённой записи"]'));
 view.reopenID='saved';view.text='stale';view.consent=true;await view.reopen();assert.equal(calls,1);assert.deepEqual(view.source,source);assert.equal(view.text,'');assert.equal(view.consent,false);assert.ok(root.textContent.includes('Оригинал: saved'));
 }finally{dom.window.close();}
});

test('One task confirmation creates a budget; pending approval never executes',async()=>{
 const dom=new JSDOM('<main></main>');globalThis.document=dom.window.document;
 let confirms=0,creates=0,runs=0,state='pending',proposal;
 const api={confirmVoiceTranscript:async(source,input)=>{confirms++;return {source_request_id:source,operation_id:input.operation_id,revision:1,text_sha256:input.text_sha256,current:true};},prepareVoiceCommandBudget:async(source,review)=>{creates++;proposal={id:'budget',project_id:'project',state,proposal:{voice:{source_request_id:source,confirmation_id:review,revision:1},task:'Say done',criteria:'',limit_usd_micros:'100000',members:[{binding_id:'agent'}]}};return structuredClone(proposal);},readTeamBudget:async()=>({...structuredClone(proposal),state}),runTeamBudgetMember:async()=>{runs++;return {state:'completed',result:{content:'done'}};}};
 try{const root=document.querySelector('main'),view=new VoiceView(root,api,()=>{});view.source={request_id:'source'};view.transcript={revision:1,text:'Say done',uncertain:true};view.text='Say done';view.uncertain=true;view.binding='agent';view.render();
 assert.ok([...root.querySelectorAll('button')].some(b=>b.textContent==='Подтвердить и выполнить поручение'));assert.ok(!root.textContent.includes('Я проверил точный сохранённый текст'));
 await Promise.all([view.execute(),view.execute()]);assert.equal(confirms,1);assert.equal(creates,1);assert.equal(runs,0);
 state='approved';await view.execute();assert.equal(confirms,1);assert.equal(creates,1);assert.equal(runs,1);assert.match(root.textContent,/done/);
 view.text='Unsaved change';await view.execute();assert.equal(runs,1);
 }finally{dom.window.close();delete globalThis.document;}
});
