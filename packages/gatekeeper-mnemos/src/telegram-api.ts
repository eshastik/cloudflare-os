import {parseTelegramVoice, type TelegramVoiceSource, TELEGRAM_VOICE_MAX_BYTES} from './telegram-voice.ts';

/** Unmodified Telegram input; sender and message authorization belongs to the inbox. */
export type TelegramUpdate = {update_id:number;[key:string]:unknown};

/** Server-only Bot API transport. Never expose an instance or token to an agent capability.
 * Transport failures are deliberately sanitized: fetch errors can contain the token-bearing URL. */
export class TelegramAPI {
  #token: string;
  #fetch: typeof fetch;
  constructor(token: string, fetcher: typeof fetch = fetch) {
    if (!/^[1-9][0-9]{0,19}:[A-Za-z0-9_-]{30,100}$/.test(token)) throw Error('Invalid Telegram bot credential.');
    this.#token = token;
    this.#fetch = fetcher;
  }
  async #call(method: 'getMe' | 'getWebhookInfo' | 'setWebhook' | 'deleteWebhook' | 'getUpdates' | 'sendMessage' | 'getFile', body: object): Promise<unknown> {
    try {
      const fetcher = this.#fetch;
      const response = await fetcher('https://api.telegram.org/bot' + this.#token + '/' + method, {
        method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(15000),
        headers: {'content-type': 'application/json'}, body: JSON.stringify(body),
      });
      if (!response.ok || !response.body) { await response.body?.cancel(); throw Error(); }
      const reader = response.body.getReader();
      let text = '', size = 0;
      const decoder = new TextDecoder('utf-8', {fatal: true, ignoreBOM: false});
      try {
        for (;;) {
          const {done, value} = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 65536) throw Error();
          text += decoder.decode(value, {stream: true});
        }
        text += decoder.decode();
      } catch { await reader.cancel().catch(() => {}); throw Error(); }
      finally { reader.releaseLock(); }
      const result = JSON.parse(text);
      if (!result || result.ok !== true || !Object.hasOwn(result, 'result')) throw Error();
      return result.result;
    } catch { throw Error('Telegram request failed or its result is unconfirmed.'); }
  }
  /** Probe without changing Telegram delivery configuration. */
  async identity(): Promise<{id: string; username: string}> {
    const result = await this.#call('getMe', {}) as {id?: unknown; username?: unknown; is_bot?: unknown} | null;
    if (!result || !Number.isSafeInteger(result.id) || String(result.id) !== this.#token.split(':')[0] ||
        result.is_bot !== true || typeof result.username !== 'string' || !/^[A-Za-z0-9_]{5,32}$/.test(result.username))
      throw Error('Invalid Telegram bot identity.');
    return {id: String(result.id), username: result.username};
  }
  /** Switch only this connection's webhook to polling, preserving queued input.
   * The caller must already hold the owner's explicit delivery acknowledgement. */
  async connectPolling(expectedWebhook:string):Promise<void> {
    let endpoint:URL;
    try{endpoint=new URL(expectedWebhook);}catch{throw Error('Invalid Telegram webhook.');}
    if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash)
      throw Error('Invalid Telegram webhook.');
    await this.identity();
    const current=await this.#call('getWebhookInfo',{}) as {url?:unknown}|null;
    if(!current||typeof current.url!=='string')throw Error('Invalid Telegram webhook response.');
    if(current.url&&current.url!==expectedWebhook)throw Error('This bot already has another webhook.');
    if(current.url&&await this.#call('deleteWebhook',{drop_pending_updates:false})!==true)
      throw Error('Telegram polling setup is unconfirmed.');
  }
  /** Read at most one bounded update. Pass only a durably accepted cursor: the
   * next getUpdates request acknowledges all IDs below its offset at Telegram. */
  async pollUpdate(offset:number):Promise<TelegramUpdate|null> {
    if(!Number.isSafeInteger(offset)||offset<0)throw Error('Invalid Telegram polling offset.');
    const result=await this.#call('getUpdates',{offset,limit:1,timeout:0,allowed_updates:['message']});
    if(!Array.isArray(result)||result.length>1)throw Error('Invalid Telegram update response.');
    if(result.length===0)return null;
    const update=result[0];
    if(!update||typeof update!=='object'||Array.isArray(update)||!Number.isSafeInteger(update.update_id)||
      update.update_id<offset||update.update_id>=Number.MAX_SAFE_INTEGER)
      throw Error('Invalid Telegram update response.');
    return update as TelegramUpdate;
  }
  /** The host supplies a fixed public route and secret. Refuse an existing different webhook.
   * The UI must explain that enabling webhook delivery takes over any getUpdates consumer. */
  async connectWebhook(url: string, secret: string): Promise<void> {
    let endpoint: URL;
    try { endpoint = new URL(url); } catch { throw Error('Invalid Telegram webhook.'); }
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
        !['', '443', '80', '88', '8443'].includes(endpoint.port) || !/^[A-Za-z0-9_-]{32,256}$/.test(secret))
      throw Error('Invalid Telegram webhook.');
    await this.identity();
    const current = await this.#call('getWebhookInfo', {}) as {url?: unknown} | null;
    if (!current || typeof current.url !== 'string') throw Error('Invalid Telegram webhook response.');
    if (current.url && current.url !== url) throw Error('This bot already has another webhook.');
    const result = await this.#call('setWebhook', {url, secret_token: secret, allowed_updates: ['message'], drop_pending_updates: false});
    if (result !== true) throw Error('Telegram webhook setup is unconfirmed.');
  }
  /** Fetch only a saved, authorized voice source. Recheck current channel authority
   * across network boundaries; never return a token-bearing download URL. */
  async downloadVoice(source:TelegramVoiceSource,authorize:()=>Promise<void>):Promise<{bytes:Uint8Array;sha256:string;source:TelegramVoiceSource}> {
    try {
      const pinned=parseTelegramVoice(source);
      if(!pinned||typeof authorize!=='function')throw Error();
      await authorize();
      const file=await this.#call('getFile',{file_id:pinned.file_id}) as
        {file_unique_id?:unknown;file_size?:unknown;file_path?:unknown}|null;
      if(!file||file.file_unique_id!==pinned.file_unique_id||typeof file.file_path!=='string'||file.file_path.length>1024||
        !/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(file.file_path)||file.file_path.split('/').some(part=>part==='.'||part==='..')||
        file.file_size!==undefined&&(!Number.isSafeInteger(file.file_size)||(file.file_size as number)<1||(file.file_size as number)>TELEGRAM_VOICE_MAX_BYTES)||
        file.file_size!==undefined&&pinned.file_size!==undefined&&file.file_size!==pinned.file_size)throw Error();
      await authorize();
      const fetcher=this.#fetch;
      const response=await fetcher('https://api.telegram.org/file/bot'+this.#token+'/'+file.file_path,
        {method:'GET',redirect:'manual',signal:AbortSignal.timeout(30000)});
      if(!response.ok||!response.body){await response.body?.cancel();throw Error();}
      const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
      try {
        for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;
          if(size>TELEGRAM_VOICE_MAX_BYTES||pinned.file_size!==undefined&&size>pinned.file_size||file.file_size!==undefined&&size>(file.file_size as number))throw Error();
          chunks.push(part.value);
        }
        if(!size||pinned.file_size!==undefined&&size!==pinned.file_size||file.file_size!==undefined&&size!==file.file_size)throw Error();
      } catch {await reader.cancel().catch(()=>{});throw Error();}
      finally {reader.releaseLock();}
      const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
      const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
      await authorize();
      return {bytes,sha256:[...digest].map(value=>value.toString(16).padStart(2,'0')).join(''),source:pinned};
    } catch {throw Error('Telegram voice download unavailable.');}
  }
  /** Send plain text to the already authorized private sender. This method never retries:
   * a lost sendMessage response cannot safely be interpreted as an unsent message. */
  async reply(sender: number, text: string): Promise<number> {
    if (!Number.isSafeInteger(sender) || sender <= 0 || typeof text !== 'string' || !text.trim() || [...text].length > 4096)
      throw Error('Invalid Telegram reply.');
    const result = await this.#call('sendMessage', {chat_id: sender, text, link_preview_options: {is_disabled: true}}) as
      {message_id?: unknown; chat?: {id?: unknown; type?: unknown}} | null;
    if (!result || !Number.isSafeInteger(result.message_id) || (result.message_id as number) <= 0 ||
        result.chat?.id !== sender || result.chat.type !== 'private') throw Error('Telegram reply is unconfirmed.');
    return result.message_id as number;
  }
}
