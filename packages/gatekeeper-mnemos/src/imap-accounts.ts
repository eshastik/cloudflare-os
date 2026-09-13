import {ConnectionAuditStorage} from './connection-audit-storage.ts';
import type {SmtpClient,SmtpServer,SmtpCredential} from './smtp-client.ts';
import type {MailDraftContent} from './mail-drafts.ts';
import {SelectedImapReader,type ImapServer,type ImapCredential} from '@gadgets/imap-client';
import type {AccountStorage} from './account-session.ts';
import type {ImapSetup,ImapAccountInfo} from './imap-types.ts';

interface Owner {tenant:string;owner:string;epoch:string;}
interface Server extends ImapServer {id:string;title:string;smtp?:SmtpServer;}
interface Account {id:string;owner:Owner;server:string;serverKey:string;credential:ImapCredential;mailbox:string;generation:string;enabled:boolean;smtp?:{credential:SmtpCredential;serverKey:string};}
type SmtpFactory=(server:SmtpServer,credential:SmtpCredential,validate:()=>Promise<void>)=>Pick<SmtpClient,'check'|'send'>;
type Reader=Pick<SelectedImapReader,'checkMailbox'|'metadata'|'readSelection'>;
type ReaderFactory=(server:ImapServer,credential:ImapCredential,mailbox:string,validate:()=>Promise<void>)=>Reader;
const denied=()=>Error('IMAP account unavailable.');
const id=(value:unknown)=>{if(typeof value!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value))throw denied();return value;};
const serverKey=(server:Server)=>JSON.stringify([server.provider,server.host,server.port]);
export const IMAP_RESOURCE={urlPattern:'mnemos://imap/mailboxes/*',title:'Почта IMAP',description:'Выбранные человеком папки почты; права агентам выдаются отдельно.'};

/** Only deployment configuration adds corporate destinations; users select a key. */
export function imapServers(config=''):Server[]{
  const servers:Server[]=[
    {id:'yandex',title:'Яндекс Почта',provider:'yandex',host:'imap.yandex.ru',port:993,smtp:{host:'smtp.yandex.ru',port:465,security:'tls'}},
    {id:'apple',title:'iCloud Mail',provider:'apple',host:'imap.mail.me.com',port:993,smtp:{host:'smtp.mail.me.com',port:587,security:'starttls'}},
  ];
  if(config){
    const values:unknown=JSON.parse(config);if(!Array.isArray(values)||values.length>20)throw denied();
    for(const value of values){
      if(!value||Object.keys(value).some(key=>!['id','title','host','port','smtp'].includes(key))||
          typeof value.id!=='string'||!/^corp-[a-z0-9-]{1,40}$/.test(value.id)||servers.some(server=>server.id===value.id)||
          typeof value.title!=='string'||!value.title||value.title.length>200||
          typeof value.host!=='string'||!/^(?=.{1,253}$)[a-z0-9]+(?:[a-z0-9.-]*[a-z0-9])?$/.test(value.host)||
          !Number.isInteger(value.port)||value.port<1||value.port>65535)throw denied();
      if(value.smtp!==undefined){
        const smtp=value.smtp;
        if(!smtp||Object.keys(smtp).some(key=>!['host','port','security'].includes(key))||typeof smtp.host!=='string'||!/^(?=.{1,253}$)[a-z0-9]+(?:[a-z0-9.-]*[a-z0-9])?$/.test(smtp.host)||!Number.isInteger(smtp.port)||smtp.port<1||smtp.port>65535||!['tls','starttls'].includes(smtp.security))throw denied();
      }
      servers.push({id:value.id,title:value.title,host:value.host,port:value.port,provider:'imap',...(value.smtp?{smtp:{...value.smtp}}:{})});
    }
  }
  return servers;
}

/** Per-human storage. Disconnect removes the credential; every source checks both
 * account generation and the current Mnemos owner epoch. */
export class ImapAccounts {
  #storage:ConnectionAuditStorage;#servers:Server[];#epoch:()=>string|undefined;#reader:ReaderFactory;#smtp?:SmtpFactory;
  constructor(storage:AccountStorage,servers:Server[],epoch:()=>string|undefined,reader:ReaderFactory=(...args)=>new SelectedImapReader(...args),smtp?:SmtpFactory){
    this.#storage=new ConnectionAuditStorage(storage,'imap');this.#servers=servers;this.#epoch=epoch;this.#reader=reader;this.#smtp=smtp;
  }
  #index(owner:Owner){return 'imapAccounts:'+JSON.stringify(owner);}
  #read(key:string){return this.#storage.get<Account>('imapAccount:'+id(key));}
  #server(key:string){const server=this.#servers.find(value=>value.id===key);if(!server)throw denied();return server;}
  #owned(record:Account|undefined,owner:Owner){
    if(!record||record.owner.tenant!==owner.tenant||record.owner.owner!==owner.owner||record.owner.epoch!==owner.epoch||this.#epoch()!==owner.epoch)throw denied();
    return record;
  }
  #info(record:Account):ImapAccountInfo{return {id:record.id,server:record.server,username:record.credential.username,mailbox:record.mailbox,enabled:record.enabled,...(record.smtp?{send_from:record.smtp.credential.from}:{})};}
  list(owner:Owner){
    if(this.#epoch()!==owner.epoch)throw denied();
    return {servers:this.#servers.map(({id,title,host,port})=>({id,title,host,port})),accounts:(this.#storage.get<string[]>(this.#index(owner))??[])
      .map(key=>this.#read(key)).filter((record):record is Account=>!!record).map(record=>this.#info(this.#owned(record,owner)))};
  }
  async connect(owner:Owner,input:ImapSetup){
    if(!input||Object.keys(input).some(key=>!['request','server','username','password','mailbox','smtp'].includes(key)))throw denied();
    const key=id(input.request),server=this.#server(input.server);
    if(typeof input.username!=='string'||!input.username||input.username.length>255||typeof input.password!=='string'||!input.password||input.password.length>4096||
        /[\x00\r\n]/.test(input.username+input.password)||typeof input.mailbox!=='string'||!input.mailbox||new TextEncoder().encode(input.mailbox).length>512||/[\x00-\x1f\x7f]/.test(input.mailbox)||this.#epoch()!==owner.epoch)throw denied();
    if(input.smtp!==undefined&&(!server.smtp||!this.#smtp||!input.smtp||Object.keys(input.smtp).some(key=>!['username','password','from'].includes(key))))throw denied();
    // Validate all SMTP fields before any credential is stored or used on the network.
    if(input.smtp)this.#smtp!(server.smtp!,input.smtp,async()=>{});
    const previous=this.#read(key);
    if(previous){this.#owned(previous,owner);if(previous.server!==input.server||previous.serverKey!==serverKey(server)||previous.credential.username!==input.username||previous.credential.password!==input.password||previous.mailbox!==input.mailbox||JSON.stringify(previous.smtp?.credential)!==JSON.stringify(input.smtp)||previous.smtp&&previous.smtp.serverKey!==JSON.stringify(server.smtp))throw Error('IMAP request changed. Use a new request.');if(previous.enabled)return this.#info(previous);}
    const index=this.#storage.get<string[]>(this.#index(owner))??[];if(!index.includes(key)&&index.length>=20)throw Error('IMAP account limit reached.');
    const record:Account={id:key,owner:{...owner},server:server.id,serverKey:serverKey(server),credential:{username:input.username,password:input.password},mailbox:input.mailbox,generation:crypto.randomUUID(),enabled:false,...(input.smtp?{smtp:{credential:{...input.smtp},serverKey:JSON.stringify(server.smtp)}}:{})};
    this.#storage.put('imapAccount:'+key,record);this.#storage.put(this.#index(owner),[...new Set([...index,key])]);
    const validate=async()=>{const current=this.#owned(this.#read(key),owner);if(current.generation!==record.generation||current.serverKey!==serverKey(this.#server(current.server)))throw denied();};
    try{
      await this.#reader(server,record.credential,record.mailbox,validate).checkMailbox();
      if(record.smtp)await this.#smtp!(server.smtp!,record.smtp.credential,validate).check();
      await validate();const complete={...record,enabled:true};this.#storage.put('imapAccount:'+key,complete);return this.#info(complete);
    }catch{
      if(this.#read(key)?.generation===record.generation){this.#storage.discard('imapAccount:'+key);this.#storage.put(this.#index(owner),(this.#storage.get<string[]>(this.#index(owner))??[]).filter(value=>value!==key));}
      throw Error('IMAP connection failed. Check the app password and selected folder.');
    }
  }
  remove(owner:Owner,key:string){this.#owned(this.#read(key),owner);this.#storage.delete('imapAccount:'+key);this.#storage.put(this.#index(owner),(this.#storage.get<string[]>(this.#index(owner))??[]).filter(value=>value!==key));}
  select(owner:Owner,key:string){const record=this.#owned(this.#read(key),owner);this.validate(key,record.generation);return {generation:record.generation};}
  #source(key:string,generation:string){
    const record=this.#read(key);if(!record||!record.enabled||record.generation!==generation||record.owner.epoch!==this.#epoch())throw denied();
    const server=this.#server(record.server);if(record.serverKey!==serverKey(server))throw denied();return {record,server};
  }
  validate(key:string,generation:string){this.#source(key,generation);}
  #selectedReader(key:string,generation:string){const {record,server}=this.#source(key,generation);return this.#reader(server,record.credential,record.mailbox,async()=>{this.validate(key,generation);});}
  async metadata(key:string,generation:string){const value=await this.#selectedReader(key,generation).metadata();this.validate(key,generation);return {...value,query:'folder:'+key};}
  #sender(key:string,generation:string){
    const {record,server}=this.#source(key,generation);
    if(!record.smtp||!server.smtp||!this.#smtp||record.smtp.serverKey!==JSON.stringify(server.smtp))throw Error('SMTP sending is not configured for this account.');
    return this.#smtp(server.smtp,record.smtp.credential,async()=>{const current=this.#source(key,generation);if(!current.record.smtp||current.record.smtp.serverKey!==JSON.stringify(current.server.smtp))throw denied();});
  }
  validateSender(key:string,generation:string){this.#sender(key,generation);}
  async send(key:string,generation:string,content:MailDraftContent){return this.#sender(key,generation).send(content);}
  async readSelection(key:string,generation:string,input:import('@gadgets/workshop-shared/mail-search').MailReadRequest){
    const result=await this.#selectedReader(key,generation).readSelection(input);this.validate(key,generation);
    const account=this.#source(key,generation).record;
    const self_addresses=[account.smtp?.credential.from,account.credential.username].filter((value):value is string=>typeof value==='string'&&/^[^\s<>@]+@[^\s<>@]+$/.test(value));
    return {provider:result.provider,query:'folder:'+key,self_addresses,messages_json:JSON.stringify(result.messages),...(result.attachment?{attachment:result.attachment}:{}),truncated:result.truncated,...(result.next_cursor?{next_cursor:result.next_cursor}:{})};
  }
}
