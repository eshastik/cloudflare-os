import {recoveryKey} from './recovery-key.ts';
import type {AccountStorage} from './account-session.ts';
import type {NativeDocumentFormat} from '@gadgets/workshop-shared/native-document';

/** Frozen update coordinates; every replay still requires current Mnemos authorization. */
export type OfficeUpdateIntent={project:string;node:string;format:NativeDocumentFormat;head:string;request:string;update:string;upload:string};
const purpose=new TextEncoder().encode('mnemos.office-update.v1');
function valid(value:OfficeUpdateIntent,format:NativeDocumentFormat){
 return value&&value.format===format&&['cloudflareos.document','cloudflareos.spreadsheet','cloudflareos.presentation'].includes(format)&&
  ['project','node','request','update','upload'].every(key=>{const text=value[key as keyof OfficeUpdateIntent];return typeof text==='string'&&text.length>0&&new TextEncoder().encode(text).length<=255&&!/[\x00-\x1f\x7f]/.test(text)})&&
  value.request.length<=220&&typeof value.head==='string'&&/^[a-f0-9]{64}$/.test(value.head)&&
  Object.keys(value).every(key=>['project','node','format','head','request','update','upload'].includes(key));
}

/** A separate per-account key prevents creation receipts from becoming updates. */
export class OfficeUpdateRecovery {
 constructor(private storage:AccountStorage){}
 async #key(create:boolean){
  const bytes=recoveryKey(this.storage,'office-update-key',create);
  return crypto.subtle.importKey('raw',bytes,'AES-GCM',false,['encrypt','decrypt']);
 }
 async seal(intent:OfficeUpdateIntent):Promise<string>{
  const frozen={...intent};if(!valid(frozen,frozen.format))throw Error('Invalid update intent');
  const key=await this.#key(true),iv=crypto.getRandomValues(new Uint8Array(12));
  const bytes=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:purpose},key,new TextEncoder().encode(JSON.stringify({version:1,intent:frozen}))));
  return btoa(String.fromCharCode(...iv,...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
 }
 async open(receipt:string,format:NativeDocumentFormat):Promise<OfficeUpdateIntent>{
  if(typeof receipt!=='string'||receipt.length>8192||!/^[A-Za-z0-9_-]+$/.test(receipt))throw Error('Invalid update receipt');
  const bytes=Uint8Array.from(atob(receipt.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
  const key=await this.#key(false);
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(0,12),additionalData:purpose},key,bytes.slice(12));
  const value=JSON.parse(new TextDecoder().decode(plain));
  if(value?.version!==1||!valid(value.intent,format))throw Error('Invalid update receipt');
  return {...value.intent};
 }
}
