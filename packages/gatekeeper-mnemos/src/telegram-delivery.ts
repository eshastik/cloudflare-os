import type {TelegramVoiceRecognition} from './telegram-voice-transfer.ts';
import type {VoiceConfirmation,VoiceTranscript} from './voice-contract.ts';
import type {AccountStorage} from './account-session.ts';
import {TelegramTaskError, TelegramCorrectionClosed, type TelegramCorrectionReply, type TelegramTaskClient, type TelegramTaskReply, type TelegramTaskSource,type TelegramVoiceCommandReply} from './telegram-task-client.ts';

type Incoming = {update:number;message:number;sender:number;text:string;replyTo?:number};
interface Storage extends AccountStorage {
  list<T>(options:{prefix:string;limit?:number;startAfter?:string}):Iterable<[string,T]>;
  transactionSync?<T>(callback:()=>T):T;
}
type VoiceDeliverySource={request:string;project:string;sha256:string;recognition?:TelegramVoiceRecognition};
interface Ports {
  voice?(update:number):Promise<VoiceDeliverySource|null>;
  client:Pick<TelegramTaskClient,'submit'|'read'|'correct'> & Partial<Pick<TelegramTaskClient,'confirmVoice'|'editVoice'|'runVoice'>>;
  authorize():Promise<void>;
  send(text:string):Promise<number>;
  arm(at:number):Promise<void>;
  now?():number;
}
type Job = {
  hash:string;source:TelegramTaskSource;mode:'task'|'status'|'correction'|'closed'|'rejected'|'voice'|'voice_confirm'|'voice_edit'|'voice_run';target:number|null;
  executeOnConfirmation?:boolean;
  voiceRun?:{review:VoiceConfirmation;project:string;budgetRevision:number};voiceOutcome?:TelegramVoiceCommandReply;
  voiceText?:VoiceTranscript;voiceEdit?:{revision:number;text:string;source:string};
  voiceReview?:{revision:number;hash:string;source:string};voiceConfirmation?:VoiceConfirmation;
  voiceRequest?:string;voiceReceipt?:boolean;voiceSource?:VoiceDeliverySource;
  correction?:TelegramCorrectionReply;request?:string;state:'pending'|'done'|'blocked';attempts:number;next:number;
  budget?:TelegramTaskReply['budget'];
  finishedAt?:number;compacted?:boolean;
  delivery:Record<string,'sending'|'delivered'|'uncertain'>;
};
const LOCAL_TEXT_RETENTION=30*24*60*60*1000;
const CLEANUP_INTERVAL=24*60*60*1000;
const CRITERIA='Выполни исходный запрос пользователя, соблюдая заданные им язык, формат и длину ответа. Не добавляй отчёт о действиях, если пользователь просит только ответ. Если задача требует действий, выполни их; не заявляй о неподтверждённых результатах. Если выполнить запрос нельзя, кратко объясни причину.';

/** Durable inbox/outbox for one confirmed channel. A receipt is saved before
 * sendMessage; a lost acknowledgement never causes an automatic duplicate send. */
export class TelegramDelivery {
  #storage:Storage; #prefix:string; #sender:number; #ports:Ports; #running=false;#correcting=false;#active=new Set<number>();
  constructor(storage:Storage,channel:string,sender:number,ports:Ports){
    if(!channel||channel.length>255||!Number.isSafeInteger(sender)||sender<1)throw new TelegramTaskError(400);
    this.#storage=storage;this.#prefix='telegramDelivery:'+channel+':';this.#sender=sender;this.#ports=ports;
  }
  #now(){return this.#ports.now?.()??Date.now();}
  #key(update:number){return this.#prefix+'job:'+String(update).padStart(16,'0');}
  #pendingKey(update:number){return this.#prefix+'pending:'+String(update).padStart(16,'0');}
  #transaction<T>(callback:()=>T):T{return this.#storage.transactionSync?this.#storage.transactionSync(callback):callback();}
  #save(job:Job){
    return this.#transaction(()=>{
    if(job.state!=='pending'&&job.finishedAt===undefined)job.finishedAt=this.#now();
    this.#storage.put(this.#key(job.source.update_id),job);
    if(job.state==='pending')this.#storage.put(this.#pendingKey(job.source.update_id),{update:job.source.update_id,at:job.next});
    else this.#storage.delete(this.#pendingKey(job.source.update_id));
    });
  }
  #pending(){return [...this.#storage.list<{update:number;at:number}>({prefix:this.#prefix+'pending:',limit:101})].map(([,item])=>item);}
  async #arm(){
    const cleanup=compactTelegramLocalText(this.#storage,this.#now());
    const pending=this.#pending().filter(item=>!this.#active.has(item.update));
    await this.#ports.arm(Math.max(this.#now()+1,Math.min(cleanup,...pending.map(item=>item.at))));
  }

  /** The webhook may acknowledge only after both the durable job and alarm exist. */
  async enqueue(incoming:Incoming):Promise<void>{
    return this.#enqueue(incoming);
  }

  /** Acknowledges durable voice intake without treating audio metadata as a model task. */
  async enqueueVoiceReceipt(input:{update:number;message:number;sender:number;request:string}):Promise<void>{
    if(typeof input.request!=='string'||!/^[A-Za-z0-9_-]{1,255}$/.test(input.request))throw new TelegramTaskError(400);
    return this.#enqueue({update:input.update,message:input.message,sender:input.sender,text:'Голосовое сообщение: '+input.request},input.request);
  }

  async #enqueue(incoming:Incoming,voiceRequest?:string):Promise<void>{
    incoming={...incoming};
    if(incoming.sender!==this.#sender||!Number.isSafeInteger(incoming.update)||incoming.update<0||
      !Number.isSafeInteger(incoming.message)||incoming.message<1||typeof incoming.text!=='string'||!incoming.text.trim()||
      new TextEncoder().encode(incoming.text).length>16384||incoming.replyTo!==undefined&&(!Number.isSafeInteger(incoming.replyTo)||incoming.replyTo<1))throw new TelegramTaskError(400);
    const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(voiceRequest?{...incoming,voiceRequest}:incoming))));
    const hash=[...digest].map(byte=>byte.toString(16).padStart(2,'0')).join('');
    await this.#ports.authorize();
    const previous=this.#storage.get<Job>(this.#key(incoming.update));
    if(previous){if(previous.hash!==hash)throw new TelegramTaskError(409);await this.#arm();return;}
    if(this.#pending().length>=100)throw new TelegramTaskError(503);
    const status=/^\/status(?:\s+([0-9]+))?$/.exec(incoming.text.trim());
    const correction=/^\/correct\s+([0-9]+)\s+([\s\S]+)$/.exec(incoming.text.trim());
    const voiceReply=incoming.replyTo===undefined?undefined:this.#storage.get<{target:number;revision:number;hash:string}>(this.#prefix+'voiceMessage:'+incoming.replyTo);
    const replyParent=voiceReply?this.#storage.get<Job>(this.#key(voiceReply.target)):undefined;
    const replyCurrent=!!voiceReply&&replyParent?.voiceReview?.revision===voiceReply.revision&&replyParent.voiceReview.hash===voiceReply.hash;
    const affirm=voiceReply&&/^(да|выполнить|подтверждаю)[.!]?$/i.test(incoming.text.trim());
    const execute=/^\/voice_execute (0|[1-9][0-9]*) ([1-9][0-9]*) ([a-f0-9]{64})$/.exec(incoming.text.trim());
    let voiceConfirm:string[]|null=/^\/voice_confirm (0|[1-9][0-9]*) ([1-9][0-9]*) ([a-f0-9]{64})$/.exec(incoming.text.trim());
    let voiceEdit:string[]|null=/^\/voice_edit (0|[1-9][0-9]*) ([1-9][0-9]*) ([\s\S]+)$/.exec(incoming.text.trim());
    if(execute)voiceConfirm=execute;
    if(voiceReply&&replyCurrent){
      if(affirm)voiceConfirm=['',String(voiceReply.target),String(voiceReply.revision),voiceReply.hash];
      else if(!incoming.text.trim().startsWith('/'))voiceEdit=['',String(voiceReply.target),String(voiceReply.revision),incoming.text];
    }
    const voiceRun=/^\/voice_run (0|[1-9][0-9]*)$/.exec(incoming.text.trim());
    let mode:Job['mode']=status?'status':'task';
    let target=status?(status[1]===undefined?this.#storage.get<number>(this.#prefix+'latest')??null:Number(status[1])):incoming.update;
    if(correction){mode='correction';target=Number(correction[1]);}
    else if(voiceConfirm){mode='voice_confirm';target=Number(voiceConfirm[1]);}
    else if(voiceEdit){mode='voice_edit';target=Number(voiceEdit[1]);}
    else if(voiceRun){mode='voice_run';target=Number(voiceRun[1]);}
    else if(/^\/voice_(confirm|execute|edit|run)(?:\s|$)/.test(incoming.text.trim())){mode='rejected';target=null;}
    else if(!status&&incoming.replyTo!==undefined){target=this.#storage.get<number>(this.#prefix+'message:'+incoming.replyTo)??null;mode=target===null?'rejected':'correction';}
    else if(/^\/(correct|status)(?:\s|$)/.test(incoming.text.trim())&&!status){mode='rejected';target=null;}
    if(target!==null&&(!Number.isSafeInteger(target)||target<0)){mode='rejected';target=null;}
    // Match Go's JSON escaping when checking the runtime payload ceiling.
    const payload=JSON.stringify({task:incoming.text,acceptance_criteria:CRITERIA}).replace(/[<>&\u2028\u2029]/g,char=>'\\u'+char.charCodeAt(0).toString(16).padStart(4,'0'));
    if(new TextEncoder().encode(mode==='correction'?incoming.text:payload).length>12000||incoming.text.includes('\0'))mode='rejected';
    const job:Job={hash,source:{update_id:incoming.update,message_id:incoming.message,sender_id:incoming.sender,message:incoming.text,criteria:CRITERIA},
      mode,target,state:'pending',attempts:0,next:this.#now(),delivery:{}};
    if(voiceReply&&!replyCurrent&&!status){job.mode='rejected';mode='rejected';}
    if(mode==='voice_confirm'){
      job.executeOnConfirmation=!!execute||!!affirm;
      const parent=target===null?undefined:this.#storage.get<Job>(this.#key(target));
      const review=parent?.voiceReview;
      if(!voiceConfirm||!review||review.revision!==Number(voiceConfirm[2])||review.hash!==voiceConfirm[3]||parent?.mode!=='voice'||parent.compacted)job.mode='rejected';
      else job.voiceReview={...review};
    }
    if(mode==='voice_edit'){
      const parent=target===null?undefined:this.#storage.get<Job>(this.#key(target));
      const transcript=parent?.voiceText??parent?.voiceSource?.recognition?.transcript;
      if(!voiceEdit||parent?.mode!=='voice'||parent.state!=='done'||parent.compacted||!transcript||transcript.revision!==Number(voiceEdit[2])||!parent.voiceSource)job.mode='rejected';
      else job.voiceEdit={revision:transcript.revision,text:voiceEdit[3],source:parent.voiceSource.request};
    }
    if(mode==='voice_run'){
      const confirmation=target===null?undefined:this.#storage.get<Job>(this.#key(target));
      const review=confirmation?.voiceConfirmation;
      const parent=confirmation?.target===null||confirmation?.target===undefined?undefined:this.#storage.get<Job>(this.#key(confirmation.target));
      const recognition=parent?.voiceSource?.recognition;
      if(confirmation?.mode!=='voice_confirm'||confirmation.state!=='done'||!review?.current||review.operation_id!=='telegram-review-'+target||!parent?.voiceReview||parent.compacted||parent.voiceReview.revision!==review.revision||parent.voiceReview.hash!==review.text_sha256||!recognition)job.mode='rejected';
      else{job.target=confirmation.target;job.voiceRun={review:{...review},project:recognition.project_id,budgetRevision:recognition.budget_revision};}
    }
    if(voiceRequest){job.mode='voice';job.voiceRequest=voiceRequest;job.voiceReceipt=true;job.target=null;}
    this.#transaction(()=>{
    if(job.mode==='voice_confirm'&&job.executeOnConfirmation&&job.voiceReview&&job.target!==null){
      const key=this.#prefix+'voiceExecution:'+job.target+':'+job.voiceReview.revision+':'+job.voiceReview.hash;
      const existing=this.#storage.get<number>(key);
      if(existing!==undefined){job.mode='status';job.target=existing;delete job.voiceReview;delete job.executeOnConfirmation;}
      else this.#storage.put(key,incoming.update);
    }
    this.#save(job);
    if(job.mode==='task')this.#storage.put(this.#prefix+'latest',incoming.update);
    if((job.mode==='task'||job.mode==='correction')&&target!==null)this.#storage.put(this.#prefix+'message:'+incoming.message,target);
    });
    await this.#arm();
  }

  /** One bounded operation per alarm; subsequent work is durably rearmed. */
  async drain(correctionsOnly=false):Promise<void>{
    if(correctionsOnly?this.#correcting:this.#running)return;
    if(correctionsOnly)this.#correcting=true;else this.#running=true;
    let active:number|undefined;
    try{
      const pending=this.#pending().filter(item=>(this.#storage.get<Job>(this.#key(item.update))?.mode==='correction')===correctionsOnly).sort((a,b)=>a.at-b.at||a.update-b.update);
      if(!pending.length)return;
      if(pending[0].at>this.#now()){await this.#arm();return;}
      const job=this.#storage.get<Job>(this.#key(pending[0].update));
      if(!job||job.state!=='pending'){this.#storage.delete(this.#pendingKey(pending[0].update));await this.#arm();return;}
      active=job.source.update_id;this.#active.add(active);
      let recovered=false;
      for(const phase of Object.keys(job.delivery))if(job.delivery[phase]==='sending'){job.delivery[phase]='uncertain';recovered=true;}
      if(recovered)this.#save(job);
      try{
        await this.#ports.authorize();
        let result:TelegramTaskReply|undefined;
        if(job.mode==='voice'&&job.voiceReceipt&&this.#ports.voice){
          const source=await this.#ports.voice(job.source.update_id);
          if(source){
            job.voiceSource=source;
            const transcript=source.recognition?.transcript;
            if(source.recognition?.state==='completed'&&transcript&&[...transcript.text].length<=1400){
              const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(transcript.text)));
              job.voiceReview={revision:transcript.revision,hash:[...digest].map(byte=>byte.toString(16).padStart(2,'0')).join(''),source:source.request};
            }
            this.#save(job);
          }
        }else if(job.mode==='voice_run'&&job.target!==null&&job.voiceRun){
          if(!this.#ports.client.runVoice)throw new TelegramTaskError(503);
          try{
            job.voiceOutcome=await this.#ports.client.runVoice(job.target,job.voiceRun.review,{project:job.voiceRun.project,budgetRevision:job.voiceRun.budgetRevision},job.voiceOutcome);
            this.#save(job);
          }catch(error){if(error instanceof TelegramTaskError&&error.status===409)job.mode='rejected';else throw error;}
        }else if(job.mode==='voice_edit'&&job.target!==null&&job.voiceEdit){
          if(!this.#ports.client.editVoice)throw new TelegramTaskError(503);
          try{
            const edit=job.voiceEdit;
            const transcript=await this.#ports.client.editVoice(job.target,job.source.update_id,edit.revision,edit.text,edit.source);
            await this.#ports.authorize();
            const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(transcript.text)));
            const review={revision:transcript.revision,hash:[...digest].map(byte=>byte.toString(16).padStart(2,'0')).join(''),source:edit.source};
            job.voiceText=transcript;if([...transcript.text].length<=1400)job.voiceReview=review;
            const parent=this.#storage.get<Job>(this.#key(job.target));
            if(parent&&!parent.compacted&&(!parent.voiceText||parent.voiceText.revision<=transcript.revision)){
              parent.voiceText=transcript;delete parent.voiceReview;
              if(job.voiceReview)parent.voiceReview=review;
              this.#save(parent);
            }
            this.#save(job);
          }catch(error){if(error instanceof TelegramTaskError&&error.status===409)job.mode='rejected';else throw error;}
        }else if(job.mode==='voice_confirm'&&job.target!==null&&job.voiceReview){
          if(!this.#ports.client.confirmVoice)throw new TelegramTaskError(503);
          const review=job.voiceReview;
          try{
            job.voiceConfirmation=await this.#ports.client.confirmVoice(job.target,job.source.update_id,review.revision,review.hash,review.source);
            this.#save(job);
            if(job.executeOnConfirmation){
              const parent=this.#storage.get<Job>(this.#key(job.target));
              const recognition=parent?.voiceSource?.recognition;
              if(!job.voiceConfirmation.current||!recognition||parent?.voiceReview?.revision!==review.revision||parent.voiceReview.hash!==review.hash)throw new TelegramTaskError(409);
              job.voiceRun={review:{...job.voiceConfirmation},project:recognition.project_id,budgetRevision:recognition.budget_revision};
              job.mode='voice_run';this.#save(job);
              if(!this.#ports.client.runVoice)throw new TelegramTaskError(503);
              job.voiceOutcome=await this.#ports.client.runVoice(job.target,job.voiceRun.review,{project:job.voiceRun.project,budgetRevision:job.voiceRun.budgetRevision},job.voiceOutcome);
              this.#save(job);
            }
          }catch(error){if(error instanceof TelegramTaskError&&error.status===409)job.mode='rejected';else throw error;}
        }else if(job.mode==='correction'&&job.target!==null){
          const parent=this.#storage.get<Job>(this.#key(job.target));
          if(!job.correction){
            try{job.correction=await this.#ports.client.correct({update_id:job.source.update_id,message_id:job.source.message_id,sender_id:job.source.sender_id,target_update_id:job.target,message:job.source.message},parent?.request);this.#save(job);}
            catch(error){
              if(error instanceof TelegramCorrectionClosed)job.mode='closed';
              else if(error instanceof TelegramTaskError&&error.status===409){
                if(parent?.mode==='task'&&parent.state==='pending'&&!parent.request)throw new TelegramTaskError(503);
                job.mode='rejected';
              }else throw error;
            }
          }
        }else if(job.mode==='task'){
          result=job.request?await this.#ports.client.read(job.source.update_id,job.request):await this.#ports.client.submit(job.source);
          if(result.outcome.receipt_present===false)result=await this.#ports.client.submit(job.source,result.request_id);
        }else if(job.mode==='status'&&job.target!==null){
          const target=this.#storage.get<Job>(this.#key(job.target));
          if(target?.mode==='voice'){job.mode='voice';job.voiceRequest=target.voiceRequest;job.voiceSource=target.voiceSource;job.voiceReview=target.voiceReview;job.voiceText=target.voiceText;}
          else if(target?.mode==='voice_edit'){job.mode='voice_edit';job.voiceText=target.voiceText;job.voiceReview=target.voiceReview;job.target=target.target;}
          else if(target?.mode==='voice_confirm'){job.mode='voice_confirm';job.voiceConfirmation=target.voiceConfirmation;}
          else if(target?.mode==='voice_run'){job.mode='voice_run';job.voiceOutcome=target.voiceOutcome;}
          else if(!(target?.state==='pending'&&!target.request)){
            try{result=await this.#ports.client.read(job.target,job.request);}
            catch(error){if(error instanceof TelegramTaskError&&error.status===409)job.mode='rejected';else throw error;}
          }
        }
        if(result){job.request=result.request_id;job.budget=result.budget;this.#save(job);}
        await this.#ports.authorize();
        const phase=job.mode==='voice_run'&&job.voiceOutcome?'voice_run_'+job.voiceOutcome.state:result?.budget&&result.budget.state!=='approved'?'budget_'+result.budget.state:result?.outcome.state??(job.mode==='voice'&&job.voiceSource?'voice_'+(job.voiceSource.recognition?.state??'saved'):job.mode);
        if(job.delivery[phase]==='sending')job.delivery[phase]='uncertain';
        if(!job.delivery[phase]){
          job.delivery[phase]='sending';this.#save(job);
          try{const message=await this.#ports.send(replyText(job,result));if(job.target!==null&&(result||job.correction))this.#storage.put(this.#prefix+'message:'+message,job.target);if((job.mode==='voice'||job.mode==='voice_edit')&&job.voiceReview){const target=job.mode==='voice'&&job.voiceReceipt?job.source.update_id:job.target;if(target!==null)this.#storage.put(this.#prefix+'voiceMessage:'+message,{target,revision:job.voiceReview.revision,hash:job.voiceReview.hash});}job.delivery[phase]='delivered';}
          catch{job.delivery[phase]='uncertain';}
          this.#save(job);
        }
        if(job.mode==='voice_run'&&job.voiceRun&&['awaiting_approval','unconfirmed'].includes(job.voiceOutcome?.state??'')||job.mode==='task'&&result?.outcome.state==='unconfirmed'&&(!result.budget||['approved','awaiting_approval'].includes(result.budget.state))||job.mode==='voice'&&job.voiceReceipt&&['awaiting_approval','unconfirmed'].includes(job.voiceSource?.recognition?.state??'')){
          job.next=this.#now()+15000;job.attempts=0;
        }else job.state='done';
        this.#save(job);
      }catch(error){
        if(error instanceof TelegramTaskError&&[400,403,409].includes(error.status))job.state='blocked';
        else{job.attempts++;job.next=this.#now()+Math.min(60000,1000*2**Math.min(job.attempts-1,6));}
        this.#save(job);
      }
      await this.#arm();
    }finally{if(active!==undefined)this.#active.delete(active);if(correctionsOnly)this.#correcting=false;else this.#running=false;await this.#arm();}
  }
}

function replyText(job:Job,result:TelegramTaskReply|undefined){
  if(job.mode==='voice_run'){
    const r=job.voiceOutcome;if(!r)return 'Голосовая команда ещё находится в очереди.';
    const label='Голосовая команда · бюджет '+r.proposal_id+' · проект '+r.project_id+'.\n';
    if(r.state==='completed'){const text=label+'Ответ агента:\n'+(r.outcome?.result?.content??'');return [...text].length<=4096?text:[...text].slice(0,3900).join('')+'\n… Ответ сокращён до лимита Telegram.';}
    return label+(r.state==='awaiting_approval'?'Ожидает согласования бюджета в CloudflareOS.':r.state==='unconfirmed'?'Результат выполнения пока не подтверждён.':r.state==='budget_blocked'?'Выполнение остановлено лимитом бюджета.':'Бюджет отклонён, отозван или изменился; автоматического запуска не будет.')+'\nСтатус: /status '+job.source.update_id;
  }
  if(job.mode==='voice_edit'){
    if(!job.voiceText)return 'Исправление текста ещё находится в очереди.';
    const text=job.voiceText.text,excerpt=[...text].slice(0,1400).join('');
    return 'Поручение уточнено. Выполнить?\n\n'+excerpt+(excerpt!==text?'\n… Полная версия в CloudflareOS.':'')+(excerpt===text&&job.voiceReview?'\n\nОтветьте «да» на это сообщение для выполнения, или отправьте:\n/voice_execute '+job.target+' '+job.voiceReview.revision+' '+job.voiceReview.hash:'')+'\nЧтобы изменить поручение, ответьте на это сообщение новым текстом.';
  }
  if(job.mode==='voice_confirm')return job.voiceConfirmation?(job.voiceConfirmation.current?'Текст версии '+job.voiceConfirmation.revision+' подтверждён на момент обработки сообщения. Для запуска с бюджетом канала отправьте:\n/voice_run '+job.voiceConfirmation.operation_id.slice('telegram-review-'.length):'Это подтверждение предыдущей версии. Текст уже изменился; проверьте новую версию.')+'\nКоманда не запускалась.':'Подтверждение текста ещё находится в очереди.';
  if(job.mode==='voice'&&job.voiceSource?.recognition){
    const r=job.voiceSource.recognition,source='Запись: '+r.source_request_id+' · проект '+r.project_id;
    if(r.state==='completed'){
      const transcript=job.voiceText??r.transcript,text=transcript?.text;const excerpt=text?[...text].slice(0,1400).join(''):'';
      const confirm=text&&excerpt===text&&job.voiceReview?'\nВыполнить это поручение? Ответьте «да» на это сообщение, или отправьте:\n/voice_execute '+(job.voiceReceipt?job.source.update_id:job.target)+' '+job.voiceReview.revision+' '+job.voiceReview.hash:'';
      return 'Из голосового сообщения я понял:\n\n'+(excerpt||'Текст доступен в CloudflareOS.')+(text&&excerpt!==text?'\n… Текст сокращён; полная версия в CloudflareOS.':'')+'\n\n'+source+'\nCloudflareOS → Аудио, версия '+(transcript?.revision??1)+': исходное аудио и распознанный текст.'+confirm+(text?'\nЕсли поручение понято неверно, ответьте на это сообщение новым текстом.':'');
    }
    return source+'\n'+(r.state==='awaiting_approval'?'Распознавание ждёт согласования бюджета в CloudflareOS.':r.state==='unconfirmed'?'Результат распознавания пока не подтверждён.':r.state==='budget_blocked'?'Распознавание остановлено лимитом бюджета.':'Бюджет распознавания отклонён, отозван или изменился. Автоматического запуска не будет.')+'\nБюджет: '+r.proposal_id;
  }
  if(job.mode==='voice'&&job.voiceSource)return 'Оригинал голосового сохранён в Mnemos. Распознавание ещё не выполнено. Откройте CloudflareOS → Аудио → сохранённая запись.\nЗапись: '+job.voiceSource.request+'\nПроект: '+job.voiceSource.project;
  if(job.mode==='voice')return 'Голосовое сообщение получено. Откройте CloudflareOS → Аудио → голосовые из Telegram, сохраните оригинал и проверьте текст перед выполнением. Автоматическое распознавание пока не включено.\nЗапись: '+job.voiceRequest;
  if(job.mode==='closed')return 'Задача '+job.target+' больше не принимает корректировки. Сообщение не применено; новая задача автоматически не создавалась.';
  if(job.correction)return 'Корректировка к сообщению '+job.target+' принята'+(job.correction.outcome.journalled?' и записана во входящие агента.': ' в очередь агента.')+' Это ещё не подтверждает её выполнение. Проверить задачу: /status '+job.target;
  if(job.mode==='rejected')return 'Сообщение не принято: проверьте номер задачи или версию и хеш подтверждаемого текста. Статус: /status НОМЕР. Корректировка задачи: /correct НОМЕР текст. Либо сократите сообщение.';
  if(!result)return job.target===null?'В этом канале пока нет сохранённой задачи. Отправьте запрос агенту.':'Сообщение '+job.target+' находится в очереди. Проверить: /status '+job.target;
  const label='Запрос '+result.request_id+' (сообщение '+result.update_id+').';
  if(result.budget&&result.budget.state!=='approved'){
    const b=result.budget;
    return label+'\n'+(b.state==='awaiting_approval'?'Задача ожидает согласования бюджета в CloudflareOS.':b.state==='policy_changed'?'Политика бюджета изменилась. Нужна новая задача с актуальной настройкой.':'Бюджет задачи отклонён или отозван. Автоматического запуска не будет.')+'\nПроект: '+b.project_id+'\nЗаявка: '+b.proposal_id;
  }
  if(result.outcome.state==='budget_blocked')return label+'\nЗадача остановлена ограничениями бюджета. Этот запрос автоматически не возобновится после согласования. Для продолжения нужна новая согласованная задача в CloudflareOS.';
  if(result.outcome.state==='unconfirmed')return label+'\nРезультат работы пока не подтверждён. Проверить: /status '+result.update_id;
  const text=label+'\n\nОтвет агента:\n'+(result.outcome.result?.content??'');
  const characters=[...text];
  return characters.length<=4096?text:characters.slice(0,3900).join('')+'\n… Ответ сокращён до лимита Telegram.';
}

/** Last persisted observations; reading these neither retries delivery nor runs a task. */
export interface TelegramDeliveryState {
 voice_command?:Omit<TelegramVoiceCommandReply,'outcome'> & {request_id?:string};
 voice?:{request_id:string;project_id:string;sha256:string;state?:TelegramVoiceRecognition['state'];proposal_id?:string};
 budget?:TelegramTaskReply['budget'];
 update_id:number;request_id:string|null;queue:'pending'|'done'|'blocked';
 execution:'completed'|'budget_blocked'|'unconfirmed'|null;
 correction:'queued'|'journalled'|'closed'|null;
 delivery:{phase:string;state:'delivered'|'uncertain'}[];
}
/** Trusted owner management only; callers must authorize the channel before reading. */
export function telegramDeliveryStates(storage:AccountStorage,channel:string,updates:number[]):TelegramDeliveryState[]{
 if(updates.length>25||updates.some(id=>!Number.isSafeInteger(id)||id<0))throw new TelegramTaskError(400);
 const out:TelegramDeliveryState[]=[];
 for(const update of updates){
  const job=storage.get<Job>('telegramDelivery:'+channel+':job:'+String(update).padStart(16,'0'));
  if(!job||job.source.update_id!==update)continue;
  const execution=(['completed','budget_blocked','unconfirmed'] as const).find(state=>Object.hasOwn(job.delivery,state)||Object.hasOwn(job.delivery,'voice_run_'+state))??null;
  const delivery=Object.entries(job.delivery).filter(([phase])=>['completed','budget_blocked','unconfirmed','correction','closed','rejected','status','voice','voice_confirm','voice_edit','voice_run','voice_run_completed','voice_run_unconfirmed','voice_run_budget_blocked','voice_run_awaiting_approval','voice_run_rejected','voice_run_revoked','voice_run_policy_changed','voice_saved','voice_completed','voice_unconfirmed','voice_budget_blocked','voice_awaiting_approval','voice_rejected','voice_revoked','voice_policy_changed','budget_awaiting_approval','budget_rejected','budget_revoked','budget_policy_changed'].includes(phase))
    .map(([phase,state])=>({phase,state:state==='delivered'?'delivered' as const:'uncertain' as const}));
  const voiceCommand=job.voiceOutcome?(({outcome,...metadata})=>({...metadata,...(outcome?{request_id:outcome.request_id}:{})}))(job.voiceOutcome):undefined;
  out.push({... (voiceCommand?{voice_command:voiceCommand}:{}),... (job.voiceSource?{voice:{request_id:job.voiceSource.request,project_id:job.voiceSource.project,sha256:job.voiceSource.sha256,...(job.voiceSource.recognition?{state:job.voiceSource.recognition.state,proposal_id:job.voiceSource.recognition.proposal_id}:{})}}:{}),update_id:update,request_id:job.voiceOutcome?.outcome?.request_id??job.correction?.outcome.request_id??job.request??null,queue:job.state,execution,...(job.budget?{budget:{...job.budget}}:{}),
    correction:job.mode==='closed'?'closed':job.correction?(job.correction.outcome.journalled?'journalled':'queued'):null,delivery});
 }
 return out;
}

/** Local receipt history also includes inputs not yet accepted by the Mnemos API. */
export interface TelegramLocalInbox {
 available:boolean;
 items:{update_id:number;message:string;content_expired?:boolean;kind:Job['mode'];target_update_id:number|null;state:TelegramDeliveryState}[];
 next_after:number|null;
}
export function telegramLocalInbox(storage:Storage,channel:string,after:number):TelegramLocalInbox {
 if(!Number.isSafeInteger(after)||after < -1)throw new TelegramTaskError(400);
 const prefix='telegramDelivery:'+channel+':job:';
 const rows=[...storage.list<Job>({prefix,limit:26,...(after>=0?{startAfter:prefix+String(after).padStart(16,'0')}:{})})];
 const items=rows.slice(0,25).map(([,job])=>({update_id:job.source.update_id,message:job.source.message,...(job.compacted?{content_expired:true}:{}),kind:job.mode,target_update_id:job.target,
   state:telegramDeliveryStates(storage,channel,[job.source.update_id])[0]}));
 return {available:true,items,next_after:rows.length>25?items.at(-1)!.update_id:null};
}


/** Compact terminal local text in bounded batches across all channel generations.
 * Source hashes, delivery receipts and reply mappings remain for deduplication;
 * the authoritative Mnemos journal has its own retention policy. */
export function compactTelegramLocalText(storage:Storage,now=Date.now()):number {
 const key='telegramTextCleanup';
 const state=storage.get<{at:number;cursor?:string}>(key);
 if(state&&state.at>now)return state.at;
 const rows=[...storage.list<unknown>({prefix:'telegramDelivery:',limit:100,...(state?.cursor?{startAfter:state.cursor}:{})})];
 for(const [rowKey,value] of rows){
  if(!/^telegramDelivery:.+:job:[0-9]+$/.test(rowKey))continue;
  const job=value as Job;
  if(job.state==='pending'||job.compacted)continue;
  // Existing rows get a full retention period from their first observation.
  if(job.finishedAt===undefined){job.finishedAt=now;storage.put(rowKey,job);}
  else if(job.finishedAt<=now-LOCAL_TEXT_RETENTION){
   job.source={...job.source,message:'',criteria:''};delete job.voiceText;delete job.voiceEdit;if(job.voiceSource?.recognition)delete job.voiceSource.recognition.transcript;if(job.voiceOutcome?.outcome)job.voiceOutcome.outcome.result=null;job.compacted=true;storage.put(rowKey,job);
  }
 }
 const next={at:now+(rows.length===100?1000:CLEANUP_INTERVAL),...(rows.length===100?{cursor:rows.at(-1)![0]}:{})};
 storage.put(key,next);return next.at;
}

/** Human byte import waits while the same voice input is being saved automatically. */
export function telegramVoiceProcessing(storage:AccountStorage,channel:string,update:number):boolean{
 const job=storage.get<Job>('telegramDelivery:'+channel+':job:'+String(update).padStart(16,'0'));
 return job?.mode==='voice'&&job.voiceReceipt===true&&job.state==='pending';
}
