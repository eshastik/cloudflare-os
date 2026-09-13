import type {DriveImportCapture} from './drive-import-capture.ts';
import {RpcTarget,RpcStub} from 'cloudflare:workers';
import type {NativeDocumentFormat} from '@gadgets/workshop-shared/native-document';
import type {MnemosAccountSession} from './account-session.ts';
import type {OfficeUpdateRecovery} from './office-update-recovery.ts';
import {OfficeUpdateWriter} from './office-update-writer.ts';

/** Mint a fixed human review from server-verified comparison data. */
export async function reviewOfficeUpdate(session:MnemosAccountSession,recovery:OfficeUpdateRecovery,project:string,target:string,source:string,format:NativeDocumentFormat,sourceHead:string,sourceSHA256:string,captures?:DriveImportCapture){
 if(!['cloudflareos.document','cloudflareos.spreadsheet','cloudflareos.presentation'].includes(format)||!/^[a-f0-9]{64}$/.test(sourceHead)||!/^[a-f0-9]{64}$/.test(sourceSHA256))throw Error('Invalid captured source');
 const doc=await session.readDraftDocument(project,target);
 const input={expected_head:doc.head,source_node_id:source,source_head:sourceHead,format:format==='cloudflareos.document'?'docx' as const:format==='cloudflareos.presentation'?'pptx' as const:'xlsx' as const,title:(doc.terms[0]?.metadata?.name||'Document').replace(/\.(cfdoc|cfsheet|cfslides)$/i,'')};
 const comparison=await session.compareOfficeUpdate(project,target,input);
 if(comparison.incoming.source_sha256!==sourceSHA256)throw Error('Captured source checksum changed');
 let ticket=comparison.incoming;
 async function validate(){
  if(comparison.drive_source_verified!==true)captures?.validateUpdateSource(project,comparison.baseline,{source_node_id:source,source_head:sourceHead,source_sha256:sourceSHA256});
  const current=await session.readDraftDocument(project,target);
  if(current.head!==comparison.head)throw Error('Target changed; review the update again');
  await session.checkPrivateVersionRead(project,source,sourceHead);
  const origin=await session.officeOrigin(project,target,comparison.head);
  if(!origin||origin.source_node_id!==comparison.baseline.source_node_id||origin.source_head!==comparison.baseline.source_head||origin.source_sha256!==comparison.baseline.source_sha256||origin.output_sha256!==comparison.baseline.output_sha256)throw Error('Update baseline changed');
 }
 await validate();
 return new RpcStub(new class extends RpcTarget{
  async describe(){await validate();return {head:comparison.head,outcome:comparison.outcome,currentSHA256:comparison.current_sha256,sourceSHA256,outputSHA256:comparison.incoming.sha256_hex,unsupported:[...comparison.incoming.unsupported]}}
  async preview(){await validate();return new RpcStub(new class extends RpcTarget{async issue(){await validate();return ticket}async validate(){await validate()}}())}
  async prepare(acceptUnsupported:boolean,replaceLocal:boolean){
   if(typeof acceptUnsupported!=='boolean'||typeof replaceLocal!=='boolean')throw Error('Invalid update decision');
   await validate();
   const prepared=await session.prepareOfficeUpdate(project,target,input,{current_sha256:comparison.current_sha256,source_sha256:sourceSHA256,output_sha256:comparison.incoming.sha256_hex,accept_unsupported:acceptUnsupported,replace_local:replaceLocal});
   await validate();ticket=prepared.comparison.incoming;
   return new RpcStub(new OfficeUpdateWriter(session,recovery,{project,node:target,head:comparison.head,format,request:crypto.randomUUID(),update:prepared.update_id,upload:''}));
  }
 }());
}
