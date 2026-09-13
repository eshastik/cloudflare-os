import {MnemosAPIError,type OfficeUpdateInput,type OfficeUpdateComparison} from './mnemos-api.ts';

/** Validate server coordinates before a trusted host can expose comparison data. */
export function validateOfficeUpdateComparison(value:OfficeUpdateComparison,node:string,input:OfficeUpdateInput):void {
 const hash=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
 const id=(value:unknown)=>typeof value==='string'&&value.length>0&&value.length<=255&&!/[\x00-\x1f\x7f]/.test(value);
 const report=(value:unknown)=>Array.isArray(value)&&value.length<=4096&&value.every(v=>typeof v==='string'&&v.length<=2048);
 const ticket=value?.incoming,baseline=value?.baseline;
 if(!value||value.node_id!==node||value.head!==input.expected_head||!hash(value.current_sha256)||
  !['source_unchanged','already_current','update_available','conflict'].includes(value.outcome)||
  !baseline||(baseline.revision_head!==undefined&&!hash(baseline.revision_head))||!id(baseline.source_node_id)||!hash(baseline.source_head)||!hash(baseline.source_sha256)||!hash(baseline.output_sha256)||!report(baseline.unsupported)||
  !ticket||!id(ticket.preview_id)||ticket.source_node_id!==input.source_node_id||ticket.source_head!==input.source_head||
  ticket.content_type!==`application/vnd.cloudflareos.${input.format==='docx'?'document':input.format==='pptx'?'presentation':'spreadsheet'}+json`||ticket.method!=='GET'||
  !Number.isSafeInteger(ticket.size_bytes)||ticket.size_bytes<1||ticket.size_bytes>4*1024*1024||!hash(ticket.sha256_hex)||!hash(ticket.source_sha256)||!report(ticket.unsupported))throw new MnemosAPIError(502);
 // The outcome must describe these exact bytes, including preservation of local edits.
 const expected=ticket.source_sha256===baseline.source_sha256?'source_unchanged':value.current_sha256===ticket.sha256_hex?'already_current':value.current_sha256===baseline.output_sha256?'update_available':'conflict';
 if(value.outcome!==expected)throw new MnemosAPIError(502);
}
