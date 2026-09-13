import type {ProjectSearchPage} from './mnemos-api.ts';

export type SearchReference={node_id:string;ordinal:number};
export type SearchEvaluationSet={format:'mnemos.search-evaluation';version:1;name:string;revision:string;k:number;cases:{id:string;query:string;relevant:SearchReference[]}[]};
const key=(r:SearchReference)=>JSON.stringify([r.node_id,r.ordinal]);
const text=(v:unknown,max:number):v is string=>typeof v==='string'&&v.trim().length>0&&new TextEncoder().encode(v).length<=max;

/** References are explicitly human-labelled fragments, not model-generated relevance judgments. */
export function decodeSearchEvaluation(raw:string):SearchEvaluationSet{
 if(new TextEncoder().encode(raw).length>128*1024)throw Error('Evaluation too large');
 const value=JSON.parse(raw);
 if(!value||value.format!=='mnemos.search-evaluation'||value.version!==1||!text(value.name,255)||!text(value.revision,128)||!Number.isInteger(value.k)||value.k<1||value.k>20||!Array.isArray(value.cases)||!value.cases.length||value.cases.length>30)throw Error('Invalid evaluation');
 const ids=new Set<string>();
 for(const c of value.cases){
  if(!c||!text(c.id,128)||ids.has(c.id)||!text(c.query,4096)||!Array.isArray(c.relevant)||c.relevant.length>100)throw Error('Invalid case');
  ids.add(c.id);const refs=new Set<string>();
  for(const r of c.relevant){
   if(!r||!text(r.node_id,255)||!Number.isSafeInteger(r.ordinal)||r.ordinal<0||refs.has(key(r)))throw Error('Invalid reference');
   refs.add(key(r));
  }
 }
 return value;
}

/** Recall and precision both use fragment identity; repeated hits never inflate the score. */
export function scoreSearch(project:string,relevant:SearchReference[],k:number,page:ProjectSearchPage){
 if(page.index_pending!==false||page.degraded!==false)return {state:'unavailable' as const,reason:'index_not_ready'};
 if(!Array.isArray(page.hits)||page.hits.some(h=>h.project_id!==project||!text(h.node_id,255)||!Number.isSafeInteger(h.ordinal)||h.ordinal<0))throw Error('Invalid search identity');
 const hits=page.hits.slice(0,k).map(h=>({node_id:h.node_id,ordinal:h.ordinal}));
 if(new Set(hits.map(key)).size!==hits.length)throw Error('Duplicate search fragment');
 const expected=new Set(relevant.map(key)),matched=hits.filter(h=>expected.has(key(h))).length;
 return {state:'measured' as const,returned:hits.length,relevant:expected.size,matched,
  recall:expected.size?matched/expected.size:null,precision:hits.length?matched/hits.length:null,hits};
}

/** Runs only authorized searches; missing telemetry is a separate case, not a zero score. */
export async function evaluateSearch(project:string,set:SearchEvaluationSet,search:(query:string)=>Promise<ProjectSearchPage>){
 const cases=[];
 for(const c of set.cases){
  const started=performance.now();
  try{const page=await search(c.query);cases.push({id:c.id,query:c.query,elapsed_ms:performance.now()-started,...scoreSearch(project,c.relevant,set.k,page)});}
  catch{cases.push({id:c.id,query:c.query,elapsed_ms:null,state:'unavailable' as const,reason:'search_unavailable'});}
 }
 const measured=cases.filter(c=>c.state==='measured');
 const recalls=measured.flatMap(c=>c.recall===null?[]:[c.recall]),precisions=measured.flatMap(c=>c.precision===null?[]:[c.precision]);
 const mean=(xs:number[])=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
 return {k:set.k,case_count:cases.length,measured:measured.length,unavailable:cases.length-measured.length,
  recall:mean(recalls),recall_cases:recalls.length,precision:mean(precisions),precision_cases:precisions.length,cases};
}
