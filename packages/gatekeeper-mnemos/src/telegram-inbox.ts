import {parseTelegramVoice, type TelegramVoiceSource} from './telegram-voice.ts';
import type {AccountStorage} from './account-session.ts';

type Scope = {tenant: string; owner: string; bot: string; epoch: string; binding: string};
type Message = {update: number; message: number; sender: number; text: string; replyTo?:number};
/** Authenticated envelope; channel ownership must still be checked before retrieval. */
export type TelegramVoiceMessage=Omit<Message,'text'>&{voice:TelegramVoiceSource;caption?:string};
type Pairing = {code: string; expires: number; candidate?: number};
type State = {scope: Scope; pairing?: Pairing; sender?: number};
export type TelegramMessageIntent = {
  request: string;
  scope: Scope;
  sender: number;
  update: number;
  message: number;
  text: string;
};

function unavailable(): never { throw Error('Telegram connection unavailable.'); }
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}
function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/** Authenticate and bound the webhook before parsing. No identity comes from query parameters. */
export async function readTelegramInput(request: Request, secret: string): Promise<Message | TelegramVoiceMessage | null> {
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(secret) || request.method !== 'POST' ||
      request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== secret ||
      request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') unavailable();
  if (!request.body) unavailable();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 65536) unavailable();
      chunks.push(part.value);
    }
  } catch {
    await reader.cancel().catch(() => {});
    unavailable();
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let update: Record<string, unknown>;
  try { update = record(JSON.parse(new TextDecoder('utf-8', {fatal: true, ignoreBOM: false}).decode(bytes))); }
  catch { unavailable(); }
  if (!Number.isSafeInteger(update.update_id) || (update.update_id as number) < 0) unavailable();
  // Authenticate the current private sender; forwarded audio is source material,
  // and its understood task still requires that sender to confirm it.
  const message = record(update.message), sender = record(message.from), chat = record(message.chat);
  if (!positive(message.message_id) || !positive(sender.id) || sender.is_bot !== false ||
      chat.type !== 'private' || chat.id !== sender.id ||
      message.sender_chat || message.via_bot || message.business_connection_id) return null;
  const replied=record(message.reply_to_message);
  if(message.reply_to_message&&(!positive(replied.message_id)||record(replied.chat).id!==chat.id))return null;
  if(message.voice!==undefined){
    const voice=parseTelegramVoice(message.voice);
    if(!voice||message.text!==undefined||message.caption!==undefined&&(typeof message.caption!=='string'||new TextEncoder().encode(message.caption).length>16384))return null;
    return {update:update.update_id as number,message:message.message_id,sender:sender.id,voice,
      ...(typeof message.caption==='string'?{caption:message.caption}:{}),...(positive(replied.message_id)?{replyTo:replied.message_id}:{})};
  }
  if(message.forward_origin)return null;
  if(typeof message.text!=='string'||!message.text.trim()||new TextEncoder().encode(message.text).byteLength>16384)return null;
  return {update: update.update_id as number, message: message.message_id, sender: sender.id, text: message.text,
    ...(positive(replied.message_id)?{replyTo:replied.message_id}:{})};
}

/** Existing text dispatch remains text-only until audio is durably journalled. */
export async function readTelegramMessage(request:Request,secret:string):Promise<Message|null>{
  const input=await readTelegramInput(request,secret);
  return input&&'text' in input?input:null;
}

/** Server-only state for one bot in one account DO. Management calls require a live human
 * session; ingress calls require webhook authentication. This helper never executes a task.
 * All methods use synchronous durable KV: callers must not substitute eventually consistent KV. */
export class TelegramInbox {
  #storage: AccountStorage;
  #key: string;
  constructor(storage: AccountStorage, bot: string) {
    if (!/^[1-9][0-9]{0,19}$/.test(bot)) unavailable();
    this.#storage = storage;
    this.#key = 'telegramInbox:' + bot;
  }
  #state(): State {
    const state = this.#storage.get<State>(this.#key);
    if (!state) unavailable();
    return structuredClone(state);
  }
  #same(scope: Scope): State {
    const state = this.#state();
    if (Object.keys(state.scope).some(key => state.scope[key as keyof Scope] !== scope[key as keyof Scope])) unavailable();
    return state;
  }
  /** Authenticated management supplies server-resolved identity and selected agent binding.
   * Starting again rotates the epoch and immediately invalidates the old sender and intents. */
  begin(scope: Omit<Scope, 'epoch'>, now = Date.now()) {
    if (scope.bot !== this.#key.slice('telegramInbox:'.length) ||
        Object.values(scope).some(value => typeof value !== 'string' || !value || value.length > 255 || /[\x00-\x1f]/.test(value)) ||
        !Number.isSafeInteger(now)) unavailable();
    const pairing = {code: crypto.randomUUID().replaceAll('-', ''), expires: now + 300000};
    const state: State = {scope: {...scope, epoch: crypto.randomUUID()}, pairing};
    this.#storage.put(this.#key, state);
    return {code: pairing.code, expires: pairing.expires, epoch: state.scope.epoch};
  }
  /** Consume a one-use /start code only as a candidate; it grants no task access. */
  offer(message: Message, now = Date.now()): boolean {
    const state = this.#state(), pairing = state.pairing;
    if (!pairing || pairing.expires <= now || !positive(message.sender) ||
        message.text !== '/start ' + pairing.code || pairing.candidate !== undefined) return false;
    pairing.candidate = message.sender;
    this.#storage.put(this.#key, state);
    return true;
  }
  /** Show only the sender ID for explicit confirmation in authenticated CloudflareOS. */
  candidate(epoch: string, now = Date.now()): number | null {
    const state = this.#state();
    if (state.scope.epoch !== epoch || !state.pairing || state.pairing.expires <= now) unavailable();
    return state.pairing.candidate ?? null;
  }
  /** A Telegram /start never confirms itself. The human confirms the exact candidate in the UI. */
  confirm(epoch: string, sender: number, now = Date.now()): void {
    const state = this.#state();
    if (state.scope.epoch !== epoch || !positive(sender) || !state.pairing ||
        state.pairing.expires <= now || state.pairing.candidate !== sender) unavailable();
    state.sender = sender;
    delete state.pairing;
    this.#storage.put(this.#key, state);
  }
  /** Authenticated disconnect invalidates queued work, including after a DO restart. */
  disconnect(): void { this.#storage.delete(this.#key); }

  /** Server-side management snapshot; no bot token or webhook secret is included. */
  describe() {
    const state = this.#state();
    return {epoch: state.scope.epoch, sender: state.sender ?? null,
      candidate: state.pairing?.candidate ?? null, expires: state.pairing?.expires ?? null};
  }

  /** Persist immutable input before dispatch. Replays retain their request ID, but still
   * require current human/agent rights. The dispatcher must use that ID idempotently. */
  async accept(message: Message, authorize: (scope: Readonly<Scope>) => Promise<void>): Promise<TelegramMessageIntent> {
    message = structuredClone(message);
    const state = this.#state();
    if (state.sender !== message.sender || !positive(message.sender) || !positive(message.message) ||
        !Number.isSafeInteger(message.update) || message.update < 0 ||
        typeof message.text !== 'string' || !message.text.trim() || message.text.startsWith('/start') ||
        new TextEncoder().encode(message.text).byteLength > 16384) unavailable();
    await authorize(structuredClone(state.scope));
    if (this.#same(state.scope).sender !== message.sender) unavailable();
    const key = this.#key + ':' + state.scope.epoch + ':update:' + message.update;
    const previous = this.#storage.get<TelegramMessageIntent>(key);
    if (previous) {
      if (previous.sender !== message.sender || previous.message !== message.message || previous.text !== message.text) unavailable();
      return structuredClone(previous);
    }
    const intent: TelegramMessageIntent = {...message, request: crypto.randomUUID(), scope: state.scope};
    this.#storage.put(key, intent);
    return structuredClone(intent);
  }

  /** Recheck ownership, connection epoch and agent rights before dispatch or delivering a reply. */
  async validate(intent: TelegramMessageIntent, authorize: (scope: Readonly<Scope>) => Promise<void>): Promise<void> {
    const frozen = structuredClone(intent);
    const state = this.#same(frozen.scope);
    if (state.sender !== frozen.sender) unavailable();
    const saved = this.#storage.get<TelegramMessageIntent>(this.#key + ':' + frozen.scope.epoch + ':update:' + frozen.update);
    if (!saved || saved.request !== frozen.request || saved.sender !== frozen.sender ||
        saved.message !== frozen.message || saved.text !== frozen.text) unavailable();
    await authorize(structuredClone(frozen.scope));
    if (this.#same(frozen.scope).sender !== frozen.sender) unavailable();
  }
}
