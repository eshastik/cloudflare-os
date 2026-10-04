import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readWorkTemplateMaterials} from './read-work-template-materials.ts';
import type {WorkTemplateReference} from '@gadgets/workshop-shared/work-template';
const refs:WorkTemplateReference[]=[{template_id:'method',revision:3},{scope_id:'department',template_key:'form',revision:5}];
const source={template_id:'method',revision:3,title:'Методика',purpose:'Подготовить ТЗ',kind:'guidance' as const,project_id:'source',node_id:'node',source_head:'a'.repeat(64),content_type:'text/markdown',user_id:'owner',agent_id:'agent',created_at:new Date().toISOString()};
const native={format:'cloudflareos.document',formatVersion:1,document:{blocks:[{html:'<p>Раздел ТЗ</p>'}]}};
const bytes=[new TextEncoder().encode('Укажите требования и критерии приёмки.'),new TextEncoder().encode(JSON.stringify(native))];
const sources=[source,{...source,kind:'document' as const,content_type:'application/vnd.cloudflareos.document+json',revision:11}];
const selection=()=>({materials:[{reference:refs[0],personal:sources[0]},{reference:refs[1],scoped:{scope_id:'department',template_key:'form',revision:5,proposal_id:'proposal',approved_by:'reviewer',approved_at:new Date().toISOString(),source:sources[1]}}]});
async function fixture(){
 const tickets=await Promise.all(bytes.map(async(data,i)=>({head:sources[i].source_head,node_id:sources[i].node_id,term_index:0,content_type:sources[i].content_type,url:'https://storage.example/'+i,method:'GET',size_bytes:data.byteLength,sha256_hex:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),b=>b.toString(16).padStart(2,'0')).join(''),expires_at:new Date(Date.now()+60_000).toISOString()})));
 let reads=0;
 const session:Parameters<typeof readWorkTemplateMaterials>[0]={readWorkTemplateSelection:async()=>{reads++;return selection();},beginWorkTemplateDownload:async reference=>{const i='template_id' in reference?0:1;return {reference,source:sources[i],ticket:tickets[i]};}};
 const fetcher:typeof fetch=async url=>new Response(bytes[Number(new URL(String(url)).pathname.slice(1))]);
 return {session,tickets,fetcher,reads:()=>reads};
}

test('читает методику и нативную форму точных версий без передачи credential хранилищу',async()=>{
 const f=await fixture();const calls:unknown[]=[];
 const out=await readWorkTemplateMaterials(f.session,'https://storage.example',refs,async(url,init)=>{calls.push({url,init});return f.fetcher(url,init);});
 assert.equal(f.reads(),2);assert.equal(out.materials.length,2);assert.equal(out.materials[0].content.type,'text');assert.deepEqual(out.materials[1].content,{type:'native',snapshot:native});assert.deepEqual(out.materials.map(m=>m.reference),refs);
 assert.equal(out.materials[1].reference.revision,5);assert.equal(out.materials[1].sourceHead,source.source_head);
 for(const call of calls as {init:RequestInit}[]){assert.equal(call.init.redirect,'manual');assert.equal(call.init.headers,undefined);}
});

test('отзыв после объектного чтения отвергает весь набор',async()=>{
 const f=await fixture();let reads=0;f.session.readWorkTemplateSelection=async()=>{if(++reads===2)throw Error('Нет доступа');return selection();};
 await assert.rejects(readWorkTemplateMaterials(f.session,'https://storage.example',refs,f.fetcher),/Нет доступа/);
});

test('сумма, усечение, размер, источник, срок и повреждённый снимок не дают содержимое',async()=>{
 for(const scenario of ['checksum','truncated','oversized','foreign','expired','wrong head','native format','redirect']){
  const f=await fixture();let fetcher=f.fetcher;
  if(scenario==='redirect')fetcher=async()=>new Response(null,{status:302,headers:{location:'https://foreign.example/source'}});
  if(scenario==='checksum')f.tickets[0].sha256_hex='0'.repeat(64);
  if(scenario==='truncated')fetcher=async()=>new Response(new Uint8Array());
  if(scenario==='oversized')f.tickets[0].size_bytes=1024*1024+1;
  if(scenario==='foreign')f.tickets[0].url='https://foreign.example/source';
  if(scenario==='expired')f.tickets[0].expires_at=new Date(0).toISOString();
  if(scenario==='wrong head')f.tickets[0].head='b'.repeat(64);
  if(scenario==='native format'){
   const wrong=new TextEncoder().encode(JSON.stringify({...native,format:'cloudflareos.app'}));
   f.tickets[1].size_bytes=wrong.length;f.tickets[1].sha256_hex=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',wrong)),b=>b.toString(16).padStart(2,'0')).join('');
   fetcher=async(url,init)=>String(url).endsWith('/1')?new Response(wrong):f.fetcher(url,init);
  }
  await assert.rejects(readWorkTemplateMaterials(f.session,'https://storage.example',refs,fetcher),scenario);
 }
});

test('неподдерживаемый формат не заменяется текстовым представлением',async()=>{
 const f=await fixture();let fetched=0;
 f.session.readWorkTemplateSelection=async()=>{const out=selection();out.materials[0].personal={...source,content_type:'application/pdf'};return out;};
 await assert.rejects(readWorkTemplateMaterials(f.session,'https://storage.example',refs,async()=>{fetched++;return new Response('fallback');}),/Формат/);assert.equal(fetched,0);
});
