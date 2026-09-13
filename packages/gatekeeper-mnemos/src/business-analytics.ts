/** A bounded business dataset supplied by an authorized document, not inferred from logins. */
export interface BusinessDataset {
 format:'mnemos.business-dataset';format_version:1;organization:string;observed_at:string;
 employees:null|{id:string;name:string;department:string|null}[];
 clients:null|{id:string;name:string;status:string|null}[];
 coverage:{employees:'complete'|'partial'|'unknown';clients:'complete'|'partial'|'unknown'};
}
export function decodeBusinessDataset(text:string):BusinessDataset{
 const fail=()=>{throw Error('Invalid business dataset');};
 if(new TextEncoder().encode(text).length>262144)fail();
 const object=(value:unknown):Record<string,unknown>=>{if(!value||typeof value!=='object'||Array.isArray(value))return fail();return value as Record<string,unknown>;};
 const word=(value:unknown):string=>{if(typeof value!=='string'||!value.trim()||value.includes('\0')||new TextEncoder().encode(value).length>512)return fail();return value;};
 const raw=object(JSON.parse(text)),coverage=object(raw.coverage);
 if(raw.format!=='mnemos.business-dataset'||raw.format_version!==1)fail();
 const observed=word(raw.observed_at);if(!/(Z|[+-]\d{2}:\d{2})$/.test(observed)||!Number.isFinite(Date.parse(observed)))fail();
 const parse=(value:unknown,field:'department'|'status')=>{
  if(value===null)return null;if(!Array.isArray(value)||value.length>2000)return fail();const ids=new Set<string>();
  return value.map(item=>{const row=object(item),id=word(row.id);if(ids.has(id))fail();ids.add(id);return {id,name:word(row.name),group:row[field]===null?null:word(row[field])};});
 };
 const employees=parse(raw.employees,'department'),clients=parse(raw.clients,'status');
 const scope=(key:'employees'|'clients',rows:unknown)=>{const v=coverage[key];if(!['complete','partial','unknown'].includes(String(v))||(rows===null&&v!=='unknown'))return fail();return v as 'complete'|'partial'|'unknown';};
 return {format:'mnemos.business-dataset',format_version:1,organization:word(raw.organization),observed_at:observed,
  employees:employees?.map(e=>({id:e.id,name:e.name,department:e.group}))??null,clients:clients?.map(c=>({id:c.id,name:c.name,status:c.group}))??null,
  coverage:{employees:scope('employees',employees),clients:scope('clients',clients)}};
}
export function groupBusinessRows(rows:ReadonlyArray<{group:string|null}>):{name:string|null;count:number}[]{
 const counts=new Map<string|null,number>();for(const row of rows)counts.set(row.group,(counts.get(row.group)??0)+1);
 return Array.from(counts,([name,count])=>({name,count}));
}
