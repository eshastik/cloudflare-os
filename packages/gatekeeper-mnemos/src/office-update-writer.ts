import {RpcTarget} from 'cloudflare:workers';
import type {MnemosAccountSession} from './account-session.ts';
import type {OfficeUpdateIntent,OfficeUpdateRecovery} from './office-update-recovery.ts';

/** One prepared update, with one immutable upload once checkpointed. */
export class OfficeUpdateWriter extends RpcTarget {
 #intent:OfficeUpdateIntent;
 #issued=new Set<string>();
 #issuing=0;
 #session:MnemosAccountSession;
 #recovery:OfficeUpdateRecovery;
 constructor(session:MnemosAccountSession,recovery:OfficeUpdateRecovery,intent:OfficeUpdateIntent){
  super();this.#session=session;this.#recovery=recovery;this.#intent={...intent};if(intent.upload)this.#issued.add(intent.upload);
 }
 async head(){return this.#intent.head}
 async recoveryState(){return {head:this.#intent.head,uploadId:this.#intent.upload}}
 async issue(expected:string,size:number,checksum:string){
  const i=this.#intent;
  if(expected!==i.head||i.upload||this.#issued.size+this.#issuing>=8)throw Error('Update upload is fixed');
  this.#issuing++;try{const ticket=await this.#session.beginNativeUpload(i.project,size,checksum);this.#issued.add(ticket.upload_id);return ticket}finally{this.#issuing--}
 }
 #freeze(expected:string,upload:string){
  const i=this.#intent;
  if(expected!==i.head||!this.#issued.has(upload)||(i.upload&&i.upload!==upload))throw Error('Update request changed');
  i.upload=upload;
 }
 async checkpoint(expected:string,upload:string){this.#freeze(expected,upload);return this.#recovery.seal(this.#intent)}
 async save(expected:string,upload:string){
  this.#freeze(expected,upload);const i=this.#intent;
  return (await this.#session.applyOfficeUpdate(i.project,i.node,i.request,i.update,i.upload)).head;
 }
}
