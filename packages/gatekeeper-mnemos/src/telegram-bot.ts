import {LocalOperationStorage} from './local-operation-storage.ts';
import {ConnectionAuditQueue} from './connection-audit-queue.ts';
import {saveTelegramConnection,type TelegramAuditOwner} from './telegram-connection-audit.ts';
import {saveTelegramSetup} from './telegram-setup.ts';
import {telegramPublicWebhook} from './telegram-webhook.ts';
import {TelegramVoiceTransfer} from './telegram-voice-transfer.ts';
import type {TelegramBudgetSettings} from './mnemos-api.ts';
import {TelegramVoiceInbox} from './telegram-voice-inbox.ts';
import type {TelegramConnectionState} from './telegram-management.ts';
import {DurableObject} from 'cloudflare:workers';
import {TelegramAPI} from './telegram-api.ts';
import {TelegramDelivery,telegramDeliveryStates,telegramLocalInbox,compactTelegramLocalText,telegramVoiceProcessing} from './telegram-delivery.ts';
import {TelegramTaskClient, TelegramTaskError} from './telegram-task-client.ts';
import {TelegramInbox, readTelegramInput} from './telegram-inbox.ts';

interface Env {MNEMOS_CALENDAR_BRIDGE_TOKEN?:string;MNEMOS_TELEGRAM_PUBLIC_ORIGIN?:string;MNEMOS_TELEGRAM_DELIVERY_MODE?:string; MNEMOS_LOGIN_CONFIG?: string; MNEMOS_API_ORIGIN: string;MNEMOS_STORAGE_ORIGIN?:string}
type Connection = {
  telegram_audit_owner?:TelegramAuditOwner;
  // Captured from the owning account, never from webhook input. Absent on legacy primary records.
  origins?: {apiOrigin: string; storageOrigin?: string};
  account: string; request: string; bot: string; binding: string; accountEpoch: string;
  token: string; username: string; secret: string; route: string; ready: boolean;
  deliveryMode?:'webhook'|'polling';
  pairing: {code: string; expires: number; epoch: string; candidate?:number};
  channel?: {id: string; tenant: string; owner: string; sender: number; secret: string; registered: boolean; disabled: boolean};
};
function unavailable(): never { throw Error('Telegram connection unavailable.'); }

/** One deployment-wide registry/credential holder per Telegram bot ID. Only trusted
 * UserAccount management calls reach its RPC methods; HTTP exposes webhook delivery only. */
export class TelegramBot extends DurableObject<Env> {
  #auditQueue(){return new ConnectionAuditQueue(this.ctx.storage.kv,origin=>{
    const record=this.#record();if(origin!==(record?.origins?.apiOrigin??this.env.MNEMOS_API_ORIGIN))unavailable();
    return this.env.MNEMOS_CALENDAR_BRIDGE_TOKEN??'';
  });}
  #operationStorage(){
    const record=this.#record();
    return new LocalOperationStorage(this.ctx.storage.kv,
      this.#auditQueue().capture(record?.origins?.apiOrigin??this.env.MNEMOS_API_ORIGIN,()=>this.ctx.waitUntil(this.#armAudit())),()=>{
        const current=this.#record();
        return current?.telegram_audit_owner??(current?.channel?{tenant:current.channel.tenant,user:current.channel.owner}:undefined);
      },work=>this.ctx.storage.transactionSync(work));
  }
  async #armAudit(){const alarm=await this.ctx.storage.getAlarm();await this.ctx.storage.setAlarm(Math.min(alarm??Infinity,Date.now()+1000));}
  #saveConnection(record:Connection){
    const owner=record.telegram_audit_owner??(record.channel?{tenant:record.channel.tenant,user:record.channel.owner}:undefined);
    if(!owner)throw Error('Telegram audit owner unavailable');
    saveTelegramConnection(this.#auditQueue().capture(record.origins?.apiOrigin??this.env.MNEMOS_API_ORIGIN,()=>this.ctx.waitUntil(this.#armAudit())),record,owner);
  }
  async #auditOwner(record:Connection){
    if(record.telegram_audit_owner)return;
    const owner=await this.#owner(record.account).telegramAuditOwner();this.#same(record);
    if(record.channel&&(record.channel.tenant!==owner.tenant||record.channel.owner!==owner.user))unavailable();
    record.telegram_audit_owner=owner;
  }
  #delivery?: {epoch:string;queue:TelegramDelivery};
  #queue(record:Connection){
    const channel=record.channel;
    if(!record.token||!channel?.registered||channel.disabled)throw new TelegramTaskError(403);
    if(this.#delivery?.epoch===record.pairing.epoch)return this.#delivery.queue;
    const client=new TelegramTaskClient(record.origins?.apiOrigin ?? this.env.MNEMOS_API_ORIGIN,{tenant:channel.tenant,channel:channel.id,
      owner:channel.owner,binding:record.binding,bot:record.bot,sender:channel.sender,secret:channel.secret});
    const local=async()=>{
      try{this.#same(record);}catch{throw new TelegramTaskError(403);}
      if(!await this.#owner(record.account).telegramEpochValid(record.accountEpoch))throw new TelegramTaskError(403);
      try{this.#same(record);}catch{throw new TelegramTaskError(403);}
    };
    const queue=new TelegramDelivery(this.#operationStorage(),channel.id,channel.sender,{
      client,voice:async update=>this.#processVoice(record,client,update,local),authorize:async()=>{await local();await client.validate();await local();},
      send:async text=>{await local();return new TelegramAPI(record.token).reply(channel.sender,text);},
      arm:async at=>{this.#same(record);await this.ctx.storage.setAlarm(Math.min(at,this.#auditQueue().hasPending()?Date.now()+1000:Infinity));},
    });
    this.#delivery={epoch:record.pairing.epoch,queue};return queue;
  }
  async #processVoice(record:Connection,client:TelegramTaskClient,update:number,local:()=>Promise<void>){
    const channel=record.channel!;
    const authorize=async()=>{await local();await client.validate();await local();};
    const inbox=new TelegramVoiceInbox(this.#operationStorage(),channel.id,record.pairing.epoch,channel.sender);
    const item=await inbox.read(update,authorize);
    const storageOrigin=record.origins ? record.origins.storageOrigin : this.env.MNEMOS_STORAGE_ORIGIN;
    if(!storageOrigin)return item.imported??null;
    const transfer=new TelegramVoiceTransfer(this.#operationStorage(),storageOrigin,JSON.stringify([channel.id,record.pairing.epoch]));
    const recognize=async(imported:{request:string;project:string;sha256:string})=>{const admission=transfer.saved(update)?.admission;if(!admission?.budget.voice_binding_id)throw new TelegramTaskError(409);const recognition=await client.transcribeVoice(update,{...imported,binding:admission.budget.voice_binding_id,budgetRevision:admission.budget.revision});await authorize();return {...imported,recognition};};
    if(item.imported)return transfer.saved(update)?.admission?recognize(item.imported):item.imported;
    const key='telegramVoiceSettings:'+JSON.stringify([channel.id,record.pairing.epoch,update]);
    let budget=this.#operationStorage().get<TelegramBudgetSettings>(key);
    if(!budget){budget=await client.voiceSettings();await authorize();this.#operationStorage().put(key,budget);}
    if(!budget.voice_binding_id)return null;
    if(!['audio/ogg','audio/webm','audio/wav','audio/mpeg','audio/mp4','audio/flac'].includes(item.input.voice.mime_type??'audio/ogg')||item.input.voice.file_unique_id.length>255)return null;

    let source;
    if(transfer.saved(update)?.upload)source=await transfer.resume(client,update);
    else{
      const file=await new TelegramAPI(record.token).downloadVoice(item.input.voice,authorize);
      source=await transfer.save(client,{expected_budget_revision:budget.revision,update_id:update,message_id:item.input.message,sender_id:item.input.sender,file_unique_id:item.input.voice.file_unique_id,media_type:item.input.voice.mime_type??'audio/ogg',size_bytes:file.bytes.byteLength,sha256:file.sha256},budget,file.bytes);
    }
    await authorize();const imported={request:source.request_id,project:source.project_id,sha256:source.sha256};
    await inbox.importedFromChannel(update,imported,authorize);return recognize(imported);
  }
  /** Durable alarm delivery uses only the channel credential, not an expired browser token. */
  async alarm(){
    const audit=this.#auditQueue();
    await this.ctx.storage.setAlarm(Math.min(compactTelegramLocalText(this.#operationStorage()),audit.hasPending()?Date.now()+60000:Infinity));
    await audit.drain();
    const record=this.#record();
    if(record && !record.token && record.channel && !record.channel.disabled){
      await this.#serialize(()=>this.#cleanup(record));return;
    }
    if(!record?.token||!record.channel?.registered||record.channel.disabled)return;
    const queue=this.#queue(record);
    await Promise.all([queue.drain(),queue.drain(true)]);
  }
  #tail: Promise<unknown> = Promise.resolve();
  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(operation);
    this.#tail = result.catch(() => {});
    return result;
  }
  #record() { return this.ctx.storage.kv.get<Connection>('connection'); }
  #owner(account: string) {
    if (!/^[0-9a-f]{64}$/.test(account)) unavailable();
    return this.ctx.exports.UserAccount.get(this.ctx.exports.UserAccount.idFromString(account));
  }
  #same(record: Connection) {
    const current = this.#record();
    if (!current || current.account !== record.account || current.request !== record.request ||
        current.pairing.epoch !== record.pairing.epoch || current.accountEpoch !== record.accountEpoch) unavailable();
    return current;
  }
  #route() {
    let base: URL;
    try { base = new URL(JSON.parse(this.env.MNEMOS_LOGIN_CONFIG ?? '').callbackUrl); } catch { unavailable(); }
    if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) unavailable();
    return base.href.replace(/\/$/, '') + '/telegram/' + this.ctx.id.toString();
  }
  async #authorize(record: Connection) {
    const authority = await this.#owner(record.account).telegramAuthority(record.binding);
    if (authority.epoch !== record.accountEpoch ||
        authority.apiOrigin !== (record.origins?.apiOrigin ?? this.env.MNEMOS_API_ORIGIN)) unavailable();
    this.#same(record);
    return authority;
  }
  /** Identity and agent binding are resolved by the account, never from Telegram input. */
  async configure(account: string, request: string, token: string, binding: string, deliveryAcknowledged: boolean, expectedEpoch: string) {
    return this.#serialize(() => this.#connect(account, request, token, binding, deliveryAcknowledged, expectedEpoch));
  }
  async #connect(account: string, request: string, token: string, binding: string, deliveryAcknowledged: boolean, expectedEpoch: string) {
    if (!deliveryAcknowledged || typeof request !== 'string' || !/^[0-9a-f-]{36}$/.test(request)) unavailable();
    const deliveryMode=this.env.MNEMOS_TELEGRAM_DELIVERY_MODE??'webhook';
    if(deliveryMode!=='webhook'&&deliveryMode!=='polling')throw Error('Invalid Telegram delivery mode.');
    const previous = this.#record();
    // A valid bot token does not authorize moving a bot out of another Mnemos account.
    if (previous && previous.account !== account) unavailable();
    if (previous?.request !== request && previous?.channel && !previous.channel.disabled)
      throw Error('Disable the existing Telegram channel before changing its setup.');
    const authority = await this.#owner(account).telegramAuthority(binding);
    if (authority.epoch !== expectedEpoch) unavailable();
    const api = new TelegramAPI(token);
    const identity = await api.identity();
    if (this.ctx.id.toString() !== this.ctx.exports.TelegramBot.idFromName(identity.id).toString()) unavailable();
    const raced = this.#record();
    if (raced && raced.account !== account) unavailable();
    let record: Connection;
    if (raced?.request === request) {
      if (raced.token !== token || raced.binding !== binding || raced.accountEpoch !== authority.epoch) unavailable();
      record = raced;
      record.telegram_audit_owner={tenant:authority.tenant,user:authority.owner};
    } else {
      if (this.ctx.storage.kv.get<boolean>('request:' + request)) throw Error('Telegram setup was superseded.');
      // Serialize setup at the DO boundary. A second request cannot supersede a network
      // operation already in progress and later restore its old webhook secret.
      if (raced && !raced.ready) throw Error('Finish or disable the pending Telegram setup first.');
      record = saveTelegramSetup({transactionSync:work=>this.ctx.storage.transactionSync(work),kv:{put:(key,value)=>{if(key==='connection')this.#saveConnection(value as Connection);else this.ctx.storage.kv.put(key,value);}}},request,() => {
        const pairing = new TelegramInbox(this.ctx.storage.kv, identity.id).begin({
          tenant: authority.tenant, owner: authority.owner, bot: identity.id, binding,
        });
        const created: Connection = {telegram_audit_owner:{tenant:authority.tenant,user:authority.owner},account, request, bot: identity.id, binding, accountEpoch: authority.epoch,
          origins: {apiOrigin: authority.apiOrigin, storageOrigin: authority.storageOrigin},
          token, username: identity.username, secret: crypto.randomUUID().replaceAll('-', ''),
          route: this.#route(), ready: false, pairing};
        return created;
      });
    }
    await this.#authorize(record);
    if (!record.ready||(record.deliveryMode??'webhook')!==deliveryMode) {
      const endpoint=telegramPublicWebhook(record.route,this.env.MNEMOS_TELEGRAM_PUBLIC_ORIGIN);
      if(deliveryMode==='polling')await api.connectPolling(endpoint);
      else await api.connectWebhook(endpoint, record.secret);
      await this.#authorize(record);
      record.ready = true;
      record.deliveryMode=deliveryMode;
      this.#saveConnection(record);
    }
    if(deliveryMode==='polling')await this.ctx.exports.TelegramPoller.get(this.ctx.exports.TelegramPoller.idFromName(record.bot)).start(record.bot,record.pairing.epoch);
    return this.describe(account);
  }
  /** Internal transport entry point. Polling uses exactly the same authenticated
   * inbox and durable admission as webhook delivery, including pre-pairing input. */
  async pollInput(epoch:string):Promise<{enabled:boolean;more:boolean}>{
    const record=this.#record();
    if(!record?.token||!record.ready||record.deliveryMode!=='polling'||record.pairing.epoch!==epoch)
      return {enabled:false,more:false};
    if(!await this.#owner(record.account).telegramEpochValid(record.accountEpoch))return {enabled:false,more:false};
    this.#same(record);
    const key='telegramPollingCursor:'+epoch;
    const offset=this.ctx.storage.kv.get<number>(key)??0;
    const update=await new TelegramAPI(record.token).pollUpdate(offset);
    const current=this.#same(record);
    if(current.deliveryMode!=='polling'||!current.token)return {enabled:false,more:false};
    if(!update)return {enabled:true,more:false};
    const response=await this.fetch(new Request(record.route,{method:'POST',
      headers:{'Content-Type':'application/json','X-Telegram-Bot-Api-Secret-Token':record.secret},
      body:JSON.stringify(update)}));
    if(!response.ok)throw Error('Telegram input was not accepted.');
    this.#same(record);
    // The next Telegram request acknowledges only after the inbox accepted this
    // exact update. A failed commit replays the same ID through existing dedup.
    this.ctx.storage.kv.put(key,update.update_id+1);
    return {enabled:true,more:true};
  }
  /** Account capability checks ownership; old/replaced channel metadata stays unavailable. */
  async localInbox(account:string,channel:string,after:number){
    const record=this.#record();
    if(!record||record.account!==account||record.channel?.id!==channel)return {available:false,items:[],next_after:null};
    return telegramLocalInbox(this.#operationStorage(),channel,after);
  }
  #voiceAccess(account:string,channelID:string){
    const record=this.#record(),channel=record?.channel;
    if(!record||record.account!==account||!record.token||channel?.id!==channelID||!channel.registered||channel.disabled)unavailable();
    const client=new TelegramTaskClient(record.origins?.apiOrigin ?? this.env.MNEMOS_API_ORIGIN,{tenant:channel.tenant,channel:channel.id,owner:channel.owner,binding:record.binding,bot:record.bot,sender:channel.sender,secret:channel.secret});
    const authorize=async()=>{
      const current=this.#same(record);
      if(current.channel?.id!==channelID||!current.channel.registered||current.channel.disabled||!current.token)unavailable();
      await client.validate();
      if(!await this.#owner(account).telegramEpochValid(record.accountEpoch))unavailable();
      const latest=this.#same(record);
      if(latest.channel?.id!==channelID||!latest.channel.registered||latest.channel.disabled||!latest.token)unavailable();
    };
    return {record,authorize,inbox:new TelegramVoiceInbox(this.#operationStorage(),channel.id,record.pairing.epoch,channel.sender)};
  }
  /** Human management can inspect only its current channel's saved voice inputs. */
  async voiceInbox(account:string,channel:string){
    const access=this.#voiceAccess(account,channel);
    const items=await access.inbox.list(access.authorize);
    return items.map(item=>({request:item.request,update:item.input.update,message:item.input.message,duration:item.input.voice.duration,received_at:item.received_at}));
  }
  /** Imported-source coordinates only, checked against the current channel owner. */
  async voiceImportState(account:string,channel:string,update:number){
    const access=this.#voiceAccess(account,channel);
    const saved=(await access.inbox.read(update,access.authorize)).imported;
    return saved?{request:saved.request,project:saved.project,sha256:saved.sha256}:null;
  }
  async completeVoiceImport(account:string,channel:string,update:number,source:import('./telegram-voice-inbox.ts').TelegramVoiceImport){
    const access=this.#voiceAccess(account,channel);
    await access.inbox.imported(update,source,access.authorize);
  }
  /** Server-to-server bytes only; Telegram URLs and bot credentials never leave this DO. */
  async voiceFile(account:string,channel:string,update:number){
    const access=this.#voiceAccess(account,channel);
    if(telegramVoiceProcessing(this.#operationStorage(),channel,update))throw Error('Voice original is being saved.');
    const intent=await access.inbox.read(update,access.authorize);
    const file=await new TelegramAPI(access.record.token).downloadVoice(intent.input.voice,access.authorize);
    if(telegramVoiceProcessing(this.#operationStorage(),channel,update))throw Error('Voice original is being saved.');
    return {request:intent.request,mime:intent.input.voice.mime_type??'audio/ogg',bytes:file.bytes.slice(),sha256:file.sha256};
  }
  async deliveryStates(account:string,channel:string,updates:number[]){
    const record=this.#record();
    if(!record||record.account!==account||record.channel?.id!==channel)return [];
    return telegramDeliveryStates(this.#operationStorage(),channel,updates);
  }
  async describe(account: string):Promise<TelegramConnectionState> {
    const record = this.#record();
    if (!record || record.account !== account) unavailable();
    await this.#owner(account).identity(); this.#same(record);
    const active = await this.#owner(account).telegramEpochValid(record.accountEpoch); this.#same(record);
    const pairing = record.token ? new TelegramInbox(this.ctx.storage.kv, record.bot).describe()
      : {epoch: record.pairing.epoch, sender: null, candidate: null, expires: null};
    return {bot: record.bot, username: record.username, binding: record.binding, ready: !!record.token && record.ready && active,
      disconnected: !record.token, cleanup_pending: !!record.channel && !record.channel.disabled && !record.token,
      channel_id: record.channel?.id ?? null, channel_registered: !!record.token && active && !!record.channel?.registered && !record.channel.disabled,
      ...pairing, code: pairing.sender === null && (pairing.expires ?? 0) > Date.now() ? record.pairing.code : null};
  }
  async confirm(account: string, epoch: string, sender: number) {
    return this.#serialize(() => this.#confirm(account, epoch, sender));
  }
  async #confirm(account: string, epoch: string, sender: number) {
    const record = this.#record();
    if (!record?.token || record.account !== account || !record.ready) unavailable();
    const authority = await this.#authorize(record);
    const inbox = new TelegramInbox(this.ctx.storage.kv, record.bot), state = inbox.describe();
    if (state.epoch !== epoch || (state.sender !== null && state.sender !== sender)) unavailable();
    this.ctx.storage.transactionSync(() => {
      if (state.sender === null) inbox.confirm(epoch, sender);
      if (!record.channel) {
        const bytes = crypto.getRandomValues(new Uint8Array(32));
        const secret = btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
        record.channel = {id: crypto.randomUUID(), tenant: authority.tenant, owner: authority.owner, sender, secret, registered: false, disabled: false};
        // Persist pairing confirmation, credential and audit before network I/O.
        // A lost reply must not allocate another grant or change its secret.
        record.telegram_audit_owner = {tenant: authority.tenant, user: authority.owner};
        this.#saveConnection(record);
      }
    });
    const channel = record.channel;
    if (!channel) unavailable();
    if (channel.disabled || channel.sender !== sender || channel.tenant !== authority.tenant || channel.owner !== authority.owner) unavailable();
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(channel.secret)));
    this.#same(record);
    // Exact retries also ask Mnemos again: a cached success is not proof of current rights.
    await this.#owner(account).registerTelegramGrant(record.accountEpoch, {
      request_id: channel.id, binding_id: record.binding, bot_id: record.bot, sender_id: sender,
      credential_sha256: [...digest].map(byte => byte.toString(16).padStart(2, '0')).join(''), confirmed: true,
    });
    await this.#authorize(record);
    channel.registered = true;
    this.#saveConnection(record);
    return this.describe(account);
  }
  /** Disable locally first. Keep the ownership reservation, erase the credential, and
   * rotate the secret so even a failed remote cleanup cannot restore ingress. */
  async disconnect(account: string) {
    return this.#serialize(() => this.#disconnect(account));
  }
  async #disconnect(account: string) {
    const record = this.#record();
    if (!record || record.account !== account) unavailable();
    await this.#owner(account).identity();
    this.#same(record);
    await this.#auditOwner(record);
    if (record.token) {
      this.ctx.storage.transactionSync(()=>{
        new TelegramInbox(this.ctx.storage.kv, record.bot).disconnect();
        record.token = ''; record.ready = true; record.secret = crypto.randomUUID();
        record.pairing = {...record.pairing, epoch: crypto.randomUUID()};
        this.#saveConnection(record);
      });
    }
    if (record.channel && !record.channel.disabled) {
      await this.#owner(account).disableTelegramGrant(record.channel.id);
      this.#same(record);
      record.channel.disabled = true; record.channel.registered = false; record.channel.secret = '';
      this.#saveConnection(record);
    }
  }
  /** Trusted account revocation: erase local delivery before acknowledging durable cleanup. */
  async revokeAccount(account: string) {
    const record = this.#record();
    // Accounts track attempted setup too; a rejected foreign setup owns nothing here.
    if (!record || record.account !== account) return;
    if (await this.#owner(account).telegramEpochValid(record.accountEpoch)) unavailable();
    this.#same(record);
    await this.#auditOwner(record);
    if (record.token) {
      this.ctx.storage.transactionSync(()=>{
        new TelegramInbox(this.ctx.storage.kv, record.bot).disconnect();
        record.token = ''; record.ready = true; record.secret = crypto.randomUUID();
        record.pairing = {...record.pairing, epoch: crypto.randomUUID()};
        this.#saveConnection(record);
      });
    }
    if (record.channel && !record.channel.disabled) await this.ctx.storage.setAlarm(Date.now()+1);
  }
  async #cleanup(record: Connection) {
    const channel = this.#same(record).channel;
    if (!channel || channel.disabled || record.token) return;
    // Arm before network I/O: timeout or a lost success reply must survive eviction.
    await this.ctx.storage.setAlarm(Date.now()+60_000);
    try {
      await new TelegramTaskClient(record.origins?.apiOrigin ?? this.env.MNEMOS_API_ORIGIN, {tenant:channel.tenant,channel:channel.id,
        owner:channel.owner,binding:record.binding,bot:record.bot,sender:channel.sender,secret:channel.secret}).revoke();
    } catch { return; } // Unknown registration remains pending; never claim cancellation.
    this.#same(record);
    channel.disabled = true; channel.registered = false; channel.secret = '';
    record.channel = channel;
    this.#saveConnection(record);
  }
  async fetch(request: Request): Promise<Response> {
    const reply = (status: number) => new Response(null, {status, headers: {'Cache-Control': 'no-store'}});
    const record = this.#record();
    if (!record?.token || request.url !== record.route) return reply(404);
    let message;
    try { message = await readTelegramInput(request, record.secret); } catch { return reply(403); }
    if (!record.ready) return reply(503);
    if (!message) return reply(200);
    try {
      // Pairing may arrive after the browser credential expires. It grants no execution
      // authority; confirmation still requires a live human session and current agent.
      if (!await this.#owner(record.account).telegramEpochValid(record.accountEpoch)) return reply(403);
      this.#same(record);
      if ('voice' in message) {
        const channel=record.channel;
        if(!channel?.registered||channel.disabled||message.sender!==channel.sender)return reply(200);
        const client=new TelegramTaskClient(record.origins?.apiOrigin ?? this.env.MNEMOS_API_ORIGIN,{tenant:channel.tenant,channel:channel.id,owner:channel.owner,binding:record.binding,bot:record.bot,sender:channel.sender,secret:channel.secret});
        const authorize=async()=>{this.#same(record);await client.validate();if(!await this.#owner(record.account).telegramEpochValid(record.accountEpoch))unavailable();this.#same(record);};
        const intent=await new TelegramVoiceInbox(this.#operationStorage(),channel.id,record.pairing.epoch,channel.sender).accept(message,authorize);
        const queue=this.#queue(record);
        await queue.enqueueVoiceReceipt({update:message.update,message:message.message,sender:message.sender,request:intent.request});
        this.ctx.waitUntil(queue.drain());
        return reply(200);
      }
      if (message.text.startsWith('/start')) {
        await this.#auditOwner(record);
        this.ctx.storage.transactionSync(()=>{
          if(new TelegramInbox(this.ctx.storage.kv, record.bot).offer(message)){
            record.pairing={...record.pairing,candidate:message.sender};
            this.#saveConnection(record);
          }
        });
        return reply(200);
      }
      // Input received before pairing has no execution authority. Acknowledge
      // without dispatch so an old command cannot block a later /start in polling.
      if(!record.channel?.registered||record.channel.disabled||message.sender!==record.channel.sender)return reply(200);
      const queue=this.#queue(record);
      await queue.enqueue(message);
      this.ctx.waitUntil(queue.drain(true));
      return reply(200);
    } catch { return reply(503); }
  }
}

/** Route only the configured HTTPS path; a bot ID is a locator, not authorization. */
export function telegramRoute(request: Request, callback: string): string | null {
  let base: URL;
  try { base = new URL(callback); } catch { return null; }
  const url = new URL(request.url), prefix = base.pathname.replace(/\/$/, '') + '/telegram/';
  if (url.protocol !== 'https:' || url.origin !== base.origin || url.search || url.hash || request.method !== 'POST' ||
      !url.pathname.startsWith(prefix)) return null;
  const id = url.pathname.slice(prefix.length);
  return /^[0-9a-f]{64}$/.test(id) ? id : null;
}
