import {VoiceTranscriptionFlow} from './voice-transcription.ts';
import {parseBudgetUSD,formatBudgetUSD} from './budget-money.ts';
import type {VoiceManagement} from '../src/voice-management.ts';
import type {VoiceSource,VoiceTranscript,VoiceEdit,VoiceConfirm,VoiceConfirmation} from '../src/voice-contract.ts';
/** Functional original-audio and text-review surface; no automatic execution. */
export class VoiceView{
 private command?:Awaited<ReturnType<VoiceManagement['prepareVoiceCommandBudget']>>;
 private commandResult?:Awaited<ReturnType<VoiceManagement['runTeamBudgetMember']>>;
 private commandLimit='0.10';private executing=false;
 private telegramChannel='';private loadedTelegramChannel='';private telegramItems:Awaited<ReturnType<VoiceManagement['telegramVoiceInbox']>>=[];
 private commandCriteria='';
 private recognition?:VoiceTranscriptionFlow;private binding='';private budgetLimit='0.10';private budgetID='';
 private reopenID='';private project='';private file?:File;private request=crypto.randomUUID();private source?:VoiceSource;
 private transcript?:VoiceTranscript;private receipt?:VoiceConfirmation;private text='';private uncertain=true;private consent=false;private revision=1;
 private pendingEdit?:VoiceEdit;private pendingConfirm?:VoiceConfirm;private audioURL='';private busy=false;private closed=false;private notice='';
 constructor(private root:HTMLElement,private api:VoiceManagement,private close:()=>void){}
 private cancelRecording?:()=>void;
 private record(){if(this.busy||this.closed||this.source)return;const host=this.root.ownerDocument.defaultView;if(!host)return;this.cancelRecording?.();const requestId=crypto.randomUUID();
 const receive=(event:MessageEvent)=>{if(event.source!==host.parent||event.data?.type!=='gatekeeper-audio-result'||event.data.requestId!==requestId)return;
 cleanup();if(this.closed)return;const {bytes,mediaType}=event.data;
 if(event.data.error||!(bytes instanceof ArrayBuffer)||bytes.byteLength<1||bytes.byteLength>20_000_000||typeof mediaType!=='string'||!mediaType.startsWith('audio/')){this.notice='Запись отменена или микрофон недоступен.';this.render();return;}
 this.file=new File([bytes],'Запись с микрофона',{type:mediaType});this.request=crypto.randomUUID();this.notice='Запись прикреплена. Сохраните оригинал.';this.render();};
 const cleanup=()=>{host.removeEventListener('message',receive);this.cancelRecording=undefined;};
 this.cancelRecording=()=>{cleanup();host.parent.postMessage({type:'gatekeeper-audio-cancel'},'*');};host.addEventListener('message',receive);host.parent.postMessage({type:'gatekeeper-audio-request',requestId},'*');}
 private clearAudio(){if(this.audioURL)URL.revokeObjectURL(this.audioURL);this.audioURL='';}
 private async run(work:()=>Promise<void>){if(this.busy||this.closed)return;this.busy=true;this.notice='';this.render();try{await work();}catch{this.clearAudio();this.transcript=undefined;this.receipt=undefined;this.text='';this.consent=false;this.notice='Результат не подтверждён. Повторите ту же операцию или перечитайте версию текста.';}finally{this.busy=false;if(!this.closed)this.render();}}
 async loadTelegram(){await this.run(async()=>{const channel=this.telegramChannel.trim();const items=await this.api.telegramVoiceInbox(channel);if(!this.closed){this.telegramItems=items;this.loadedTelegramChannel=channel;}});}
 async importTelegram(update:number){await this.run(async()=>{const source=await this.api.importTelegramVoice(this.loadedTelegramChannel,update,this.project);if(this.closed)return;this.source=source;this.project=source.project_id;this.notice='Оригинал из Telegram сохранён. Проверьте распознанный текст перед командой.';});}
 async reopen(){const request=this.reopenID.trim();if(!request)return;this.cancelRecording?.();await this.run(async()=>{const source=await this.api.readVoiceSource(request);if(this.closed)return;this.clearAudio();this.recognition=undefined;this.command=undefined;this.commandResult=undefined;this.source=source;this.project=source.project_id;this.file=undefined;this.transcript=undefined;this.receipt=undefined;this.pendingEdit=undefined;this.pendingConfirm=undefined;this.text='';this.consent=false;this.revision=1;this.notice='Оригинал открыт. Выберите версию текста для проверки.';});}
 async upload(){const file=this.file,project=this.project,request=this.request;if(!file)return;this.cancelRecording?.();
 await this.run(async()=>{if(file.size<1||file.size>20_000_000||!file.type.startsWith('audio/'))throw Error();const bytes=new Uint8Array(await file.arrayBuffer());if(this.closed)return;const source=await this.api.uploadVoice(request,project,file.type,bytes);if(!this.closed){this.source=source;this.notice='Оригинал сохранён.';}});}
 private flow(){if(!this.source)throw Error();return this.recognition??=new VoiceTranscriptionFlow(this.api,this.source,this.transcript?.revision??0);}
 async prepareRecognition(){await this.run(async()=>{const proposal=await this.flow().create(this.binding,parseBudgetUSD(this.budgetLimit));this.budgetID=proposal.id;this.notice='Бюджет распознавания: '+proposal.state;});}
 async resumeRecognition(){await this.run(async()=>{const proposal=await this.flow().resume();this.budgetID=proposal.id;this.binding=proposal.proposal.members[0].binding_id;this.budgetLimit=formatBudgetUSD(proposal.proposal.limit_usd_micros);this.notice='Сохранённая заявка восстановлена: '+proposal.state;});}
 async loadRecognition(){await this.run(async()=>{const proposal=await this.flow().load(this.budgetID.trim());this.notice='Бюджет распознавания: '+proposal.state;});}
 async transcribe(){await this.run(async()=>{const flow=this.flow();await flow.run();const saved=await this.api.readVoiceTranscript(flow.source.request_id,flow.expectedRevision+1);if(this.closed)return;this.transcript=saved;this.revision=saved.revision;this.text=saved.text;this.uncertain=saved.uncertain;this.consent=false;this.receipt=undefined;this.notice='Транскрипт сохранён. Проверьте текст по оригиналу.';});}
 async listen(){const source=this.source;if(!source)return;await this.run(async()=>{this.clearAudio();const bytes=await this.api.readVoiceAudio(source);if(!this.closed)this.audioURL=URL.createObjectURL(new Blob([bytes as BlobPart],{type:source.media_type}));});}
 async read(){const source=this.source,revision=this.revision;if(!source)return;await this.run(async()=>{const text=await this.api.readVoiceTranscript(source.request_id,revision);if(!this.closed){if(this.pendingEdit&&text.revision>=this.pendingEdit.expected_revision+1)this.pendingEdit=undefined;this.transcript=text;this.text=text.text;this.uncertain=text.uncertain;this.consent=false;this.receipt=undefined;}});}
 async save(){const source=this.source;if(!source)return;if(!this.pendingEdit&&!this.text.trim()){this.notice='Введите текст перед сохранением.';this.render();return;}
 const input=this.pendingEdit??={operation_id:crypto.randomUUID(),expected_revision:this.transcript?.revision??0,text:this.text,uncertain:this.uncertain};
 await this.run(async()=>{const saved=await this.api.editVoiceTranscript(source.request_id,input);if(!this.closed){this.pendingEdit=undefined;this.transcript=saved;this.revision=saved.revision;this.text=saved.text;this.uncertain=saved.uncertain;this.consent=false;this.receipt=undefined;}});}
 async confirm(){const source=this.source,text=this.transcript;if(!source)return;
 if(!this.pendingConfirm&&(!text||!this.consent||this.text!==text.text||this.uncertain!==text.uncertain))return;
 await this.run(async()=>{if(!this.pendingConfirm){const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text!.text)));this.pendingConfirm={operation_id:crypto.randomUUID(),revision:text!.revision,text_sha256:[...hash].map(x=>x.toString(16).padStart(2,'0')).join(''),confirmed:true};}
 const receipt=await this.api.confirmVoiceTranscript(source.request_id,this.pendingConfirm);if(!this.closed){this.receipt=receipt;this.pendingConfirm=undefined;this.consent=false;}});}
 async execute(){
  if(this.busy||this.executing||this.closed||this.pendingEdit||!this.transcript||this.text!==this.transcript.text||this.uncertain!==this.transcript.uncertain)return;
  this.executing=true;
  try{
   if(!this.receipt?.current||this.receipt.revision!==this.transcript.revision){this.consent=true;await this.confirm();}
   if(this.closed||!this.transcript||!this.receipt?.current||this.receipt.revision!==this.transcript.revision)return;
   if(!this.command||this.command.proposal.voice?.confirmation_id!==this.receipt.operation_id)await this.prepareCommand();
   if(!this.closed)await this.runCommand();
  }finally{this.executing=false;if(!this.closed)this.render();}
 }
 async prepareCommand(){const source=this.source,receipt=this.receipt,transcript=this.transcript;if(!source||!receipt?.current||!transcript||this.text!==transcript.text||this.uncertain!==transcript.uncertain)return;
 await this.run(async()=>{const proposal=await this.api.prepareVoiceCommandBudget(source.request_id,receipt.operation_id,this.binding.trim(),this.commandCriteria,parseBudgetUSD(this.commandLimit));if(!this.closed){this.command=proposal;this.commandResult=undefined;this.notice='Поручение сохранено.';}});}
 async runCommand(){const command=this.command;if(!command||!this.receipt?.current||command.proposal.voice?.confirmation_id!==this.receipt.operation_id||command.proposal.task!==this.text||this.text!==this.transcript?.text||this.uncertain!==this.transcript.uncertain)return;
  await this.run(async()=>{const current=await this.api.readTeamBudget(command.project_id,command.id);if(this.closed)return;
   if(current.id!==command.id||current.project_id!==command.project_id||JSON.stringify(current.proposal)!==JSON.stringify(command.proposal))throw Error('Command budget changed.');
   this.command=current;if(current.state!=='approved'){this.notice='Выполнение ожидает согласованного бюджета.';return;}
   const result=await this.api.runTeamBudgetMember(current.project_id,current.id,current.proposal.members[0].binding_id);if(!this.closed)this.commandResult=result;
  });
 }
 async resumeCommand(){const source=this.source;if(!source)return;await this.run(async()=>{
  const command=await this.api.resumeVoiceCommandBudget(source.request_id),voice=command.proposal.voice;
  if(!voice||voice.source_request_id!==source.request_id||command.project_id!==source.project_id)throw Error('Voice command unavailable.');
  const receipt=await this.api.readVoiceConfirmation(source.request_id,voice.confirmation_id),transcript=await this.api.readVoiceTranscript(source.request_id,voice.revision);
  if(!receipt.current||receipt.revision!==voice.revision||receipt.text_sha256!==voice.text_sha256||transcript.text!==command.proposal.task)throw Error('Voice command changed.');
  if(this.closed)return;this.command=command;this.commandResult=undefined;this.receipt=receipt;this.transcript=transcript;this.text=transcript.text;this.uncertain=transcript.uncertain;this.revision=transcript.revision;this.binding=command.proposal.members[0].binding_id;this.commandCriteria=command.proposal.criteria;this.commandLimit=formatBudgetUSD(command.proposal.limit_usd_micros);this.consent=false;
 });}
 async status(){const source=this.source,receipt=this.receipt;if(!source||!receipt)return;await this.run(async()=>{const out=await this.api.readVoiceConfirmation(source.request_id,receipt.operation_id);if(!this.closed)this.receipt=out;});}
 render(){if(this.closed)return;this.root.replaceChildren();const text=(value:string,tag='p')=>{const e=document.createElement(tag);e.textContent=value;this.root.append(e);};
 const button=(label:string,action:()=>void)=>{const b=document.createElement('button');b.textContent=label;b.disabled=this.busy||this.executing;b.onclick=action;this.root.append(b);return b;};
 const input=(label:string,value:string,change:(value:string)=>void,type='text')=>{const l=document.createElement('label');l.textContent=label;const e=document.createElement('input');e.type=type;e.value=value;e.setAttribute('aria-label',label);e.disabled=this.busy;e.oninput=()=>change(e.value);l.append(e);this.root.append(l);return e;};
 text('Аудио и поручения','h2');button('Закрыть аудио',()=>{this.closed=true;this.cancelRecording?.();this.clearAudio();this.file=undefined;this.text='';this.transcript=undefined;this.close();}).disabled=false;
 if(this.notice)text(this.notice);
 if(!this.source){input('ID канала Telegram',this.telegramChannel,value=>{this.telegramChannel=value;this.telegramItems=[];});button('Прочитать голосовые из Telegram',()=>void this.loadTelegram());for(const item of this.telegramItems){text('Сообщение '+item.message+' · '+item.duration+' с');button('Импортировать голосовое '+item.message,()=>void this.importTelegram(item.update));}input('ID сохранённой записи',this.reopenID,value=>this.reopenID=value);button('Открыть сохранённую запись',()=>void this.reopen());input('Проект',this.project,value=>this.project=value.trim());button('Записать с микрофона',()=>this.record());const file=document.createElement('input');file.type='file';file.accept='audio/*';file.disabled=this.busy;file.setAttribute('aria-label','Аудиозапись');file.onchange=()=>{if(file.files?.[0]){this.cancelRecording?.();this.file=file.files[0];this.request=crypto.randomUUID();this.render();}};this.root.append(file);if(this.file)text(this.file.name);button('Сохранить оригинал',()=>void this.upload());return;}
 text('Оригинал: '+this.source.request_id);button('Получить аудио для прослушивания',()=>void this.listen());
 button('Восстановить бюджет команды',()=>void this.resumeCommand());
 if(this.audioURL){const audio=document.createElement('audio');audio.controls=true;audio.src=this.audioURL;this.root.append(audio);}
 text('Распознавание');button('Восстановить заявку записи',()=>void this.resumeRecognition());
 input('Подключение агента для распознавания',this.binding,v=>this.binding=v).disabled=this.busy;
 input('Предел распознавания, USD',this.budgetLimit,v=>this.budgetLimit=v).disabled=this.busy;
 button(this.recognition?.creationID?'Повторить сохранение бюджета':'Сохранить бюджет распознавания',()=>void this.prepareRecognition());
 input('ID бюджета распознавания',this.budgetID,v=>this.budgetID=v);button('Прочитать бюджет распознавания',()=>void this.loadRecognition());
 if(this.recognition?.proposal){text('Согласование: '+this.recognition.proposal.state);button('Запустить распознавание',()=>void this.transcribe()).disabled=this.busy||this.recognition.proposal.state!=='approved';}
 text('Прочитайте сохранённый транскрипт или добавьте ручной текст.');
 input('Версия текста',String(this.revision),v=>{this.revision=Number(v);this.consent=false;},'number');button('Прочитать версию',()=>void this.read());
 if(this.transcript)text('Версия '+this.transcript.revision+' · '+(this.transcript.kind==='human'?'ручной текст':'распознавание '+this.transcript.provider));
 let consentCheck:HTMLInputElement|undefined;const area=document.createElement('textarea');area.value=this.text;area.setAttribute('aria-label','Текст аудиозаписи');area.disabled=this.busy||!!this.pendingEdit||!!this.pendingConfirm;area.oninput=()=>{this.text=area.value;this.consent=false;if(consentCheck)consentCheck.checked=false;};this.root.append(area);
 const checkbox=(label:string,value:boolean,change:(value:boolean)=>void)=>{const l=document.createElement('label'),c=document.createElement('input');c.type='checkbox';c.checked=value;c.disabled=this.busy||!!this.pendingEdit||!!this.pendingConfirm;c.onchange=()=>change(c.checked);l.append(c,document.createTextNode(label));this.root.append(l);return c;};
 checkbox('Есть неясные фрагменты',this.uncertain,v=>{this.uncertain=v;this.consent=false;if(consentCheck)consentCheck.checked=false;});
 button(this.pendingEdit?'Повторить сохранение текста':'Сохранить ручной текст',()=>void this.save()).disabled=this.busy||!!this.pendingConfirm;
 if(this.transcript){
  text('Поручение: '+this.transcript.text);
  input('Критерии результата голосовой команды',this.commandCriteria,v=>this.commandCriteria=v);
  input('Лимит выполнения команды, USD',this.commandLimit,v=>this.commandLimit=v);
  button(this.command?'Продолжить выполнение поручения':'Подтвердить и выполнить поручение',()=>void this.execute()).disabled=this.busy||this.executing||!!this.pendingEdit;
 }
 if(this.command){text('Бюджет команды: '+this.command.state+' · '+formatBudgetUSD(this.command.proposal.limit_usd_micros)+' USD');text('Агент: '+this.command.proposal.members[0].binding_id);text('Задача: '+this.command.proposal.task);text('Критерии: '+this.command.proposal.criteria);}
 if(this.commandResult){text('Выполнение: '+this.commandResult.state);if(this.commandResult.result)text(this.commandResult.result.content);}
 }
}
