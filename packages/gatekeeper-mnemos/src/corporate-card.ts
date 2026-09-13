import type {MnemosAccountSession} from "./account-session.ts";
type API=Pick<MnemosAccountSession,"readDraftDocument"|"beginDraftDownload"|"checkPrivateVersionRead"|"beginNativeUpload"|"saveDraftDocument">;
export interface CorporateCardEdit {head:string;title:string;notes:string;kind:string;references:{field:string;kind:string;id:string}[];}
const limit=4*1024*1024;
const fail=()=>Error("Corporate card unavailable or changed");
const hash=async(b:Uint8Array)=>{const bytes=new Uint8Array(await crypto.subtle.digest("SHA-256",new Uint8Array(b)));return {hex:Array.from(bytes,x=>x.toString(16).padStart(2,"0")).join(""),base64:btoa(String.fromCharCode(...bytes))};};
function target(origin:string,url:string){const base=new URL(origin),u=new URL(url);if(base.protocol!=="https:"||base.origin!==origin||u.origin!==origin||u.username||u.password||u.hash)throw fail();return u;}
function card(text:string){try{return parseCard(text);}catch{throw fail();}}
function parseCard(text:string){
 // Detect ambiguous members before parsing; string-valued source JSON stays opaque.
 const stack:(Set<string>|null)[]=[];
 const tokens=/"(?:\\.|[^"\\])*"|[{}\[\]]/g;
 for(const token of text.matchAll(tokens)){
  const t=token[0];
  if(t==="{"||t==="["){stack.push(t==="{"?new Set():null);if(stack.length>32)throw fail();}
  else if(t==="}"||t==="]")stack.pop();
  else if(/^\s*:/.test(text.slice(token.index!+t.length))){const keys=stack.at(-1),key=JSON.parse(t);if(!keys||keys.has(key))throw fail();keys.add(key);}
 }
 const v=JSON.parse(text);
 const keys=["format","format_version","id","kind","title","notes","source_id","source_entity_id","source_record","source_references","access_mapping"];
 if(!v||Array.isArray(v)||Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k))||v.format!=="mnemos.corporate-record"||v.format_version!==1||!["company","contact","department","person"].includes(v.kind)||v.access_mapping!=="unmapped")throw fail();
 for(const k of ["id","kind","title","notes","source_id","source_entity_id","source_record"])if(typeof v[k]!=="string")throw fail();
 if(!Array.isArray(v.source_references)||v.source_references.length>2000)throw fail();
 for(const ref of v.source_references){
  if(!ref||Array.isArray(ref)||Object.keys(ref).length!==6||typeof ref.resolved!=="boolean")throw fail();
  for(const k of ["from_kind","from_id","field","to_kind","to_id"])if(typeof ref[k]!=="string")throw fail();
 }
 return v;
}
export class CorporateCards {
 constructor(private origin:string,private fetcher:typeof fetch=fetch){}
 private async source(api:API,project:string,node:string){
  const doc=await api.readDraftDocument(project,node);
  if(!doc.exists||doc.conflicted||doc.content_type!=="application/json")throw fail();
  const ticket=await api.beginDraftDownload(project,node,doc.head,0);
  if(ticket.head!==doc.head||ticket.node_id!==node||ticket.term_index!==0||ticket.method!=="GET"||!Number.isSafeInteger(ticket.size_bytes)||ticket.size_bytes<0||ticket.size_bytes>limit)throw fail();
  const fetcher=this.fetcher,response=await fetcher(target(this.origin,ticket.url),{redirect:"manual",signal:AbortSignal.timeout(20000)});
  if(!response.ok||!response.body){await response.body?.cancel();throw fail();}
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try {for(;;){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>ticket.size_bytes)throw fail();chunks.push(next.value);}}finally{await reader.cancel();reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  if(size!==ticket.size_bytes||(await hash(bytes)).hex!==ticket.sha256_hex)throw fail();
  const value=card(new TextDecoder("utf-8",{fatal:true,ignoreBOM:false}).decode(bytes));
  await api.checkPrivateVersionRead(project,node,doc.head);
  return {head:doc.head,value};
 }
 async read(api:API,project:string,node:string):Promise<CorporateCardEdit>{const {head,value}=await this.source(api,project,node);return {head,title:value.title,notes:value.notes,kind:value.kind,references:value.source_references.map((r:{field:string;to_kind:string;to_id:string})=>({field:r.field,kind:r.to_kind,id:r.to_id}))};}
 async save(api:API,project:string,node:string,head:string,title:string,notes:string){
  if(typeof title!=="string"||!title.trim()||new TextEncoder().encode(title).length>4096||typeof notes!=="string"||new TextEncoder().encode(notes).length>65536||title.includes("\0")||notes.includes("\0"))throw fail();
  const source=await this.source(api,project,node);if(source.head!==head)throw fail();
  source.value.title=title;source.value.notes=notes;
  const bytes=new TextEncoder().encode(JSON.stringify(source.value));if(bytes.length>limit)throw fail();
  const sum=await hash(bytes),ticket=await api.beginNativeUpload(project,bytes.length,sum.base64);
  if(ticket.method!=="PUT"||ticket.content_length!==bytes.length||ticket.checksum_header.toLowerCase()!=="x-amz-checksum-sha256"||ticket.checksum_value!==sum.base64)throw fail();
  const fetcher=this.fetcher,response=await fetcher(target(this.origin,ticket.url),{method:"PUT",redirect:"manual",signal:AbortSignal.timeout(20000),headers:{[ticket.checksum_header]:sum.base64},body:bytes});
  await response.body?.cancel();if(!response.ok)throw fail();
  // The API performs WRITE authorization and a head CAS. Never retry silently.
  return api.saveDraftDocument(project,node,ticket.upload_id,head);
 }
}
