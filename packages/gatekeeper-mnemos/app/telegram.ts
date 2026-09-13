import type {TelegramManagement} from '../src/telegram-management.ts';
import {parseBudgetUSD,formatBudgetUSD} from './budget-money.ts';
type State=Awaited<ReturnType<TelegramManagement['describeTelegram']>>;
type Journal=Awaited<ReturnType<TelegramManagement['telegramTaskJournal']>>;
/** Functional human setup and source journal; credentials remain in memory only. */
export class TelegramView {
 private catalogue?:Awaited<ReturnType<TelegramManagement['listTelegram']>>;
 private voiceBinding='';private voiceLimit='';
 private budget?:Awaited<ReturnType<TelegramManagement['readTelegramBudget']>>;
 private policy?:Awaited<ReturnType<TelegramManagement['readProjectBudget']>>;
 private budgetChannel='';private budgetProject='';private budgetLimit='';private budgetConsent=false;
 private bot='';private token='';private binding='';private acknowledged=false;
 private request=crypto.randomUUID();private state?:State;private journal?:Journal;private inbox?:Awaited<ReturnType<TelegramManagement['telegramLocalInbox']>>;
 private agents:Awaited<ReturnType<TelegramManagement['listAgentConnections']>>['connections']=[];
 private cursor='';private busy=false;private closed=false;private notice='';
 constructor(private root:HTMLElement,private api:TelegramManagement,private close:()=>void){}
 private async run(work:()=>Promise<void>){
  if(this.closed||this.busy)return;this.busy=true;this.notice='';this.render();
  try{await work();}catch{this.catalogue=undefined;this.state=undefined;this.journal=undefined;this.inbox=undefined;this.notice='Результат не подтверждён. Обновите состояние бота; при повторе подключения используйте тот же токен и агента.';}
  finally{this.busy=false;if(!this.closed)this.render();}
 }
 async list(){await this.run(async()=>{const result=await this.api.listTelegram();if(!this.closed)this.catalogue=result;});}
 async load(bot=this.bot){await this.run(async()=>{this.bot=bot;this.state=undefined;this.journal=undefined;this.inbox=undefined;this.budget=undefined;this.policy=undefined;this.budgetConsent=false;const state=await this.api.describeTelegram(bot);if(!this.closed)this.state=state;});}
 async agentsPage(more=false){await this.run(async()=>{const page=await this.api.listAgentConnections(more?this.cursor:'');if(!this.closed){this.agents=more?[...this.agents,...page.connections]:page.connections;this.cursor=page.next_cursor??'';}});}
 async connect(){const token=this.token,binding=this.binding,ack=this.acknowledged;this.bot=token.split(':')[0];await this.run(async()=>{const state=await this.api.connectTelegram(this.request,token,binding,ack);this.token='';if(!this.closed)this.state=state;});}
 async confirm(){const state=this.state;if(!state?.candidate)return;await this.run(async()=>{const result=await this.api.confirmTelegram(state.bot,state.epoch,state.candidate!);if(!this.closed)this.state=result;});}
 async disconnect(){const state=this.state;if(!state)return;await this.run(async()=>{await this.api.disconnectTelegram(state.bot);const result=await this.api.describeTelegram(state.bot);if(!this.closed){this.state=result;this.token='';this.request=crypto.randomUUID();}});}
 async localHistory(more=false){const state=this.state;if(!state?.channel_id)return;const after=more?this.inbox?.next_after:-1;if(after===null||after===undefined)return;await this.run(async()=>{const page=await this.api.telegramLocalInbox(state.channel_id!,after);if(!this.closed)this.inbox=more&&this.inbox?{...page,items:[...this.inbox.items,...page.items]}:page;});}
 async history(more=false){const state=this.state;if(!state?.channel_id)return;const after=more?this.journal?.next_after:-1;if(after===null||after===undefined)return;await this.run(async()=>{const page=await this.api.telegramTaskJournal(state.channel_id!,after);if(!this.closed)this.journal=more&&this.journal?{...page,items:[...this.journal.items,...page.items],delivery:[...this.journal.delivery,...page.delivery]}:page;});}
 async loadBudget(){const id=this.state?.channel_id;if(!id)return;await this.run(async()=>{const out=await this.api.readTelegramBudget(id);if(this.closed)return;this.budget=out;this.voiceBinding=out.voice_binding_id??'';this.voiceLimit=out.voice_limit_usd_micros?formatBudgetUSD(out.voice_limit_usd_micros):'';this.budgetChannel=id;this.budgetProject=out.project_id;this.budgetLimit=out.revision?formatBudgetUSD(out.limit_usd_micros):'';this.policy=undefined;this.budgetConsent=false;});}
 async loadPolicy(){const project=this.budgetProject;await this.run(async()=>{const policy=await this.api.readProjectBudget(project);if(this.closed)return;if(policy.project_id!==project||!Number.isSafeInteger(policy.revision)||policy.revision<1)throw Error('Budget policy unavailable');formatBudgetUSD(policy.limit_usd_micros);formatBudgetUSD(policy.automatic_usd_micros);this.policy=policy;this.budgetConsent=false;});}
 async saveBudget(){const id=this.state?.channel_id,budget=this.budget,policy=this.policy;if(!id||!budget||this.budgetChannel!==id||!policy||policy.project_id!==this.budgetProject||!this.budgetConsent)return;const limit=this.budgetLimit;await this.run(async()=>{const micros=parseBudgetUSD(limit);if(BigInt(micros)<1n||BigInt(micros)>BigInt(policy.limit_usd_micros))throw Error('Budget limit invalid');const saved=await this.api.setTelegramBudget(id,budget.revision,{project_id:policy.project_id,policy_revision:policy.revision,limit_usd_micros:micros,...(this.voiceBinding.trim()?{voice_binding_id:this.voiceBinding.trim(),voice_limit_usd_micros:parseBudgetUSD(this.voiceLimit)}:{})},true);if(!this.closed){this.budget=saved;this.budgetConsent=false;this.notice='Настройка сохранена. Расходы по каждой задаче разрешаются отдельно правилами проекта.';}});}
 render(){if(this.closed)return;this.root.replaceChildren();
  const text=(value:string,tag='p')=>{const e=document.createElement(tag);e.textContent=value;this.root.append(e);};
  const button=(label:string,action:()=>void)=>{const e=document.createElement('button');e.textContent=label;e.disabled=this.busy;e.onclick=action;this.root.append(e);return e;};
  const input=(label:string,value:string,change:(value:string)=>void,type='text')=>{const l=document.createElement('label');l.textContent=label;const e=document.createElement('input');e.type=type;e.value=value;e.disabled=this.busy;e.autocomplete='off';e.setAttribute('aria-label',label);e.oninput=()=>change(e.value);l.append(e);this.root.append(l);};
  text('Telegram','h2');button('Закрыть Telegram',()=>{this.closed=true;this.token='';this.state=undefined;this.journal=undefined;this.inbox=undefined;this.root.replaceChildren();this.close();}).disabled=false;
  button('Мои Telegram-боты',()=>void this.list());
  if(this.catalogue){
   if(!this.catalogue.connections.length)text('Доступных подключений ботов нет.');
   for(const item of this.catalogue.connections){const b=this.state?.bot===item.bot?this.state:item;button('@'+b.username+' · '+b.bot+(b.disconnected?' — отключён':b.channel_registered?' — подключён':b.ready?' — требуется подтверждение':' — недоступен'),()=>void this.load(b.bot));}
   if(this.catalogue.unavailable)text('Не удалось прочитать подключений: '+this.catalogue.unavailable+'. Обновите список или восстановите подключение вручную.');
  }
  input('ID бота',this.bot,value=>this.bot=value.trim());button('Обновить бота',()=>void this.load());
  if(this.notice)text(this.notice);
  if(!this.state||this.state.disconnected&&!this.state.cleanup_pending){
   input('Токен BotFather',this.token,value=>this.token=value.trim(),'password');
   button('Мои агенты',()=>void this.agentsPage());
   for(const agent of this.agents){if(agent.revoked||!agent.managed_runtime)continue;button((this.binding===agent.binding_id?'✓ ':'')+agent.agent_principal_id,()=>{this.binding=agent.binding_id;this.render();});}
   if(this.cursor)button('Ещё агенты',()=>void this.agentsPage(true));
   const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.checked=this.acknowledged;check.disabled=this.busy;check.onchange=()=>{this.acknowledged=check.checked;};label.append(check,document.createTextNode('Разрешаю выбранному агенту получать мои сообщения и отправлять ответы через Telegram.'));this.root.append(label);
   button('Подключить бота',()=>void this.connect());
  }
  const state=this.state;if(!state)return;
  if(state.channel_registered)text('Для корректировки ответьте на сообщение задачи или отправьте /correct НОМЕР текст. Статус: /status НОМЕР.');
  text('@'+state.username);text(state.channel_registered?'Канал подключён.':state.cleanup_pending?'Отключён локально; отзыв разрешения ещё не подтверждён.':state.disconnected?'Бот отключён.':'Подтвердите свой Telegram.');
  if(state.code)text('Отправьте этому боту: /start '+state.code);
  if(state.candidate!==null&&state.sender===null){text('Telegram ID для подтверждения: '+state.candidate);button('Подтвердить мой Telegram ID',()=>void this.confirm());}
  if(!state.disconnected||state.cleanup_pending)button('Отключить бота',()=>void this.disconnect());
  if(state.channel_id){button('Журнал задач',()=>void this.history());button('Локальная очередь',()=>void this.localHistory());}
  if(state.channel_id){button('Бюджет Telegram',()=>void this.loadBudget());}
  if(state.channel_id===this.budgetChannel&&this.budget){
   text('Бюджет новых сообщений','h3');text(this.budget.revision?'Сохранён проект '+this.budget.project_id+', до '+formatBudgetUSD(this.budget.limit_usd_micros)+' USD на сообщение.':'Бюджет канала ещё не выбран.');
   text('Выбор не меняет права агента и не разрешает расходы. Каждая задача должна пройти правила согласования проекта.');
   if(state.channel_registered&&!state.disconnected){
    input('ID проекта бюджета',this.budgetProject,v=>{this.budgetProject=v.trim();this.policy=undefined;this.budgetConsent=false;});
    button('Проверить бюджет проекта',()=>void this.loadPolicy());
    if(this.policy){text('Лимит проекта: '+formatBudgetUSD(this.policy.limit_usd_micros)+' USD. Автоматическое согласование: до '+formatBudgetUSD(this.policy.automatic_usd_micros)+' USD, до '+this.policy.automatic_team_size+' участников.');
     input('Лимит на сообщение, USD',this.budgetLimit,v=>{this.budgetLimit=v;this.budgetConsent=false;});
     text('Настройка распознавания голосовых: тот же проект, отдельный лимит. Пустое подключение отключает автоматический путь. Новые оригиналы сохраняются автоматически. Распознавание запускается после согласования отдельного бюджета; текст нужно проверить перед командой.');
     input('Подключение агента распознавания Telegram',this.voiceBinding,v=>{this.voiceBinding=v;this.budgetConsent=false;});
     input('Лимит распознавания Telegram, USD',this.voiceLimit,v=>{this.voiceLimit=v;this.budgetConsent=false;});
     const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.checked=this.budgetConsent;check.disabled=this.busy;check.setAttribute('aria-label','Подтверждаю бюджет новых сообщений');check.onchange=()=>{this.budgetConsent=check.checked;};label.append(check,document.createTextNode('Подтверждаю проект и лимит для новых сообщений.'));this.root.append(label);
     button('Сохранить бюджет Telegram',()=>void this.saveBudget());
    }
   }
  }
  if(this.inbox){text('Локальные сообщения бота','h3');text(this.inbox.available?'Сохранение здесь ещё не подтверждает приём сообщения сервером Mnemos.':'Локальная история этого канала недоступна.');
   for(const item of this.inbox.items){if(item.state.voice)text('Оригинал: '+item.state.voice.request_id+' · проект '+item.state.voice.project_id);text('Сообщение '+item.update_id+(item.kind==='correction'?' · корректировка к '+item.target_update_id:item.kind==='status'?' · запрос статуса':item.kind==='voice'?' · голосовое':''));text(item.content_expired?'Локальный текст удалён по сроку хранения. Принятые сообщения доступны в журнале Mnemos.':item.message,'pre');text(item.state.queue==='pending'?'Ожидает обработки.':item.state.queue==='blocked'?'Операция отклонена.':item.kind==='rejected'?'Сообщение не принято.':item.kind==='closed'?'Задача закрыла приём корректировок.':item.kind==='voice'?'Приём зарегистрирован. Работа с записью — в разделе «Аудио».':'Обработка сообщения закончена.');}
   if(this.inbox.next_after!==null)button('Ещё локальные сообщения',()=>void this.localHistory(true));
  }
  if(this.journal){text('Сообщения, принятые Mnemos. Запись в журнале не означает завершение задачи.');
   for(const item of this.journal.items){text((item.kind==='correction'?'Корректировка '+item.update_id+' к сообщению '+item.target_update_id:'Сообщение '+item.update_id)+' · задача '+item.request_id);text(item.message,'pre');
    const state=this.journal.delivery.find(state=>state.update_id===item.update_id);
    if(!state){text('Состояние обработки и доставки здесь неизвестно.');continue;}
    if(state.budget){const b=state.budget;text('Бюджет: '+(b.state==='awaiting_approval'?'ожидает согласования':b.state==='approved'?'согласован':b.state==='policy_changed'?'политика изменилась':'отклонён или отозван')+'. Проект '+b.project_id+', заявка '+b.proposal_id+'.');}
    const execution=state.execution==='completed'?'Задача завершена.':state.execution==='budget_blocked'?'Задача остановлена бюджетом.':state.execution==='unconfirmed'?'Результат задачи пока не подтверждён.':'';
    const correction=state.correction==='closed'?'Корректировка не принята: задача закрыла приём.':state.correction==='journalled'?'Корректировка записана во входящие агента.':state.correction==='queued'?'Корректировка принята в очередь агента.':'';
    text('Последнее сохранённое состояние: '+(execution||correction||(state.queue==='blocked'?'Операция отклонена.':state.queue==='pending'?'Ожидает обработки.':'Обработка сообщения закончена.')));
    for(const attempt of state.delivery)text((attempt.phase==='completed'?'Итоговый ответ':attempt.phase==='unconfirmed'?'Промежуточный ответ':'Ответ на сообщение')+' в Telegram: '+(attempt.state==='delivered'?'доставка подтверждена.':'доставка не подтверждена; автоматического повтора не будет.'));
   }
   if(this.journal.next_after!==null)button('Ещё сообщения',()=>void this.history(true));
  }
 }
}
