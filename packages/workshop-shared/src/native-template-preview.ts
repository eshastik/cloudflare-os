import type {NativeDocumentSnapshot} from './native-document';

const object=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error('Повреждена структура формы');return v as Record<string,unknown>};
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const color=(v:unknown,fallback:string)=>typeof v==='string'&&/^#[0-9a-f]{3,8}$/i.test(v)?v:fallback;
const number=(v:unknown,fallback:number,min=0,max=1200)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max?v:fallback;
const keys=['eyebrow','title','text','body','label','alt'];

/** Пассивный просмотр данных формы. Формулы и содержимое блоков не исполняются. */
export function nativeTemplatePreview(snapshot:NativeDocumentSnapshot,selected?:{sheet?:string;slide?:number}):{text:string;html:string;format:'spreadsheet'|'presentation';labels:string[]}{
 const data=object(snapshot.document),lines:string[]=[],labels:string[]=[],pages:string[]=[];
 if(snapshot.format==='cloudflareos.spreadsheet'){
  const order=data.sheetOrder,sheets=object(data.sheets),cells=object(data.cells);
  if(typeof data.title!=='string'||!Array.isArray(order)||!order.length||order.length>500||new Set(order).size!==order.length)throw Error('Повреждена форма таблицы');
  lines.push(data.title);
  for(const id of order){
   if(typeof id!=='string'||!Object.hasOwn(sheets,id)||!Object.hasOwn(cells,id))throw Error('Повреждён лист');
   const sheet=object(sheets[id]),values=object(cells[id]);if(typeof sheet.name!=='string')throw Error('Повреждено название листа');
   labels.push(sheet.name);lines.push('Лист: '+sheet.name);let maxRow=12,maxCol=6;
   for(const [ref,cell] of Object.entries(values).sort(([a],[b])=>a.localeCompare(b,undefined,{numeric:true}))){
    const m=/^([A-Z]+)([1-9][0-9]*)$/.exec(ref),v=object(cell).value;if(!m||typeof v!=='string')throw Error('Повреждена ячейка');
    if(v){lines.push(ref+'\t'+v);maxRow=Math.max(maxRow,Number(m[2]));let col=0;for(const c of m[1])col=col*26+c.charCodeAt(0)-64;maxCol=Math.max(maxCol,col);}
   }
   if(selected?.sheet&&selected.sheet!==id)continue;
   const column=(n:number)=>{let s='';for(;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s};
   const rowLimit=Math.min(maxRow,40),colLimit=Math.min(maxCol,12);let table='<table><thead><tr><th></th>';
   for(let c=1;c<=colLimit;c++)table+='<th>'+column(c)+'</th>';table+='</tr></thead><tbody>';
   for(let r=1;r<=rowLimit;r++){table+='<tr><th>'+r+'</th>';for(let c=1;c<=colLimit;c++){const ref=column(c)+r,cell=values[ref]===undefined?{}:object(values[ref]),fmt=cell.fmt==null?{}:object(cell.fmt);table+='<td title="'+esc(ref)+'" style="font-weight:'+(fmt.b?'700':'400')+';font-style:'+(fmt.i?'italic':'normal')+';background:'+color(fmt.bg,'#fff')+';color:'+color(fmt.c,'#18201c')+'">'+esc(cell.value)+'</td>';}table+='</tr>';}table+='</tbody></table>';
   pages.push('<section><h2>'+esc(sheet.name)+'</h2><div class="sheet">'+table+'</div>'+(maxRow>rowLimit||maxCol>colLimit?'<p>Показана область A1:'+column(colLimit)+rowLimit+'. Все заполненные ячейки доступны в разделе «Значения и формулы».</p>':'')+'</section>');
  }
 }else if(snapshot.format==='cloudflareos.presentation'){
  if(data.themeVersion!=='workspace.1'||!Array.isArray(data.slides)||!data.slides.length||data.slides.length>1000)throw Error('Повреждена форма презентации');
  if(typeof data.title==='string')lines.push(data.title);
  for(const [index,value] of data.slides.entries()){
   const slide=object(value),blocks=slide.blocks;if(!Array.isArray(blocks)||blocks.length>10000)throw Error('Повреждён слайд');
   lines.push('Слайд '+(index+1));let body='';const background=slide.background===undefined?{}:object(slide.background);
   const renderBlock=(value:unknown,depth=0):string=>{
    if(depth>16)throw Error('Слишком много вложенных групп');
    const b=object(value),p=object(b.props);const texts=keys.filter(k=>k in p).map(k=>{if(typeof p[k]!=='string')throw Error('Повреждён текст слайда');return p[k] as string});lines.push(...texts.filter(Boolean));
    const x=number(b.x,36,-1200,2400),y=number(b.y,36,-675,1350),w=number(b.w,320,1,2400),h=number(b.h,200,1,1350);
    if(b.type==='group'){
     if(!Array.isArray(p.blocks)||p.blocks.length>10000||typeof p.width!=='number'||!Number.isFinite(p.width)||p.width<=0||typeof p.height!=='number'||!Number.isFinite(p.height)||p.height<=0)throw Error('Повреждена группа');
     const angle=number(p.rotation,0,-360,360),flipX=p.flipH===true?-1:1,flipY=p.flipV===true?-1:1;
     return '<g transform="translate('+x+' '+y+') translate('+w/2+' '+h/2+') rotate('+angle+') scale('+flipX+' '+flipY+') translate('+(-w/2)+' '+(-h/2)+')"><g transform="scale('+w/p.width+' '+h/p.height+') translate('+(-number(p.originX,0,-1000000,1000000))+' '+(-number(p.originY,0,-1000000,1000000))+')">'+p.blocks.map(child=>renderBlock(child,depth+1)).join('')+'</g></g>';
    }
    const size=number(p.fontSize,b.type==='title'?40:b.type==='sectionLabel'?14:20,6,200),weight=number(p.weight,b.type==='title'?700:400,100,900);
    let content=texts.map(t=>'<div>'+esc(t).replaceAll('\n','<br>')+'</div>').join('');
    if(b.type==='table'){
     if(!Array.isArray(p.cells))throw Error('Повреждена таблица слайда');
     content='<table style="width:100%;height:100%"><tbody>'+p.cells.map(row=>{if(!Array.isArray(row))throw Error('Повреждена строка таблицы');return '<tr>'+row.map(value=>{const cell=object(value);if(typeof cell.text!=='string')throw Error('Повреждён текст ячейки');lines.push(cell.text);return '<td>'+esc(cell.text)+'</td>'}).join('')+'</tr>'}).join('')+'</tbody></table>';
    }else if(b.type==='svg'&&typeof p.markup==='string')content=safeSvg(p.markup,lines);
    else if(b.type==='divider')content='<div style="height:100%;background:'+color(p.color,'#1d6a50')+'"></div>';
    else if(b.type==='image'&&!content)content='<div class="placeholder">Изображение</div>';
    if(!content)return '';
    return '<foreignObject x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+'"><div xmlns="http://www.w3.org/1999/xhtml" style="font: '+weight+' '+size+'px Arial,sans-serif;line-height:'+number(p.lineHeight,1.2,0.5,3)+';color:'+color(p.color,background.coverBrand?'#fff':'#18201c')+';text-align:'+(['left','center','right'].includes(String(p.align))?p.align:'left')+';white-space:normal;overflow-wrap:break-word">'+content+'</div></foreignObject>';
   };
   body=blocks.map(value=>renderBlock(value)).join('');
   labels.push('Слайд '+(index+1));if(selected?.slide!==undefined&&selected.slide!==index)continue;
   pages.push('<section aria-label="Слайд '+(index+1)+'"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 675" class="slide"><rect width="1200" height="675" fill="'+color(background.color,'#fff')+'"/>'+body+'</svg></section>');
  }
 }else throw Error('Выберите таблицу или презентацию');
 return {text:lines.filter(Boolean).join('\n\n'),format:snapshot.format==='cloudflareos.spreadsheet'?'spreadsheet':'presentation',labels,html:page(pages.join(''))};
}

function page(content:string){return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; form-action 'none'; base-uri 'none'"><style>body{margin:0;background:#f6f8f7;color:#18201c;font:14px Arial,sans-serif}section{margin:0 0 16px}section:last-child{margin-bottom:0}h2{margin:0;padding:12px;font-size:14px}.sheet{overflow:auto;background:white}table{border-collapse:collapse;min-width:100%;table-layout:fixed}th{background:#edf2ef;color:#6b7770;font-weight:400;min-width:36px}td{min-width:110px;max-width:200px;white-space:pre-wrap;overflow-wrap:anywhere}th,td{border:1px solid #dfe6e2;padding:8px;height:24px}thead{position:sticky;top:0}.slide{display:block;width:100%;height:auto;background:white}.placeholder{border:2px dashed #9aa9a0;padding:20px;color:#68776e}</style></head><body>`+content+`</body></html>`}
function safeSvg(markup:string,lines:string[]){
 const root=document.createElement('template');root.innerHTML=markup;const svg=root.content.querySelector('svg');if(!svg)return '';
 const tags=new Set(['svg','g','defs','lineargradient','radialgradient','stop','path','rect','circle','ellipse','line','polyline','polygon','text','tspan','clippath']);
 const attrs=new Set(['viewBox','preserveAspectRatio','x','y','x1','y1','x2','y2','width','height','cx','cy','r','rx','ry','d','points','fill','stroke','stroke-width','opacity','fill-opacity','stroke-opacity','offset','stop-color','stop-opacity','transform','id','font-size','font-weight','text-anchor','clip-path']);
 for(const e of [svg,...svg.querySelectorAll('*')]){if(!tags.has(e.tagName.toLowerCase())){e.remove();continue}for(const a of [...e.attributes]){if(!attrs.has(a.name)||/url\(\s*(?!#[A-Za-z_][\w.-]*\s*\))|(?:https?:|javascript:|data:|[<>])/i.test(a.value))e.removeAttribute(a.name)}}
 for(const node of svg.querySelectorAll('text')){const text=[...node.childNodes].map(child=>child.nodeType===1?'\n'+(child.textContent??'')+'\n':child.textContent??'').join('').trim();if(text)lines.push(text);}svg.setAttribute('style','width:100%;height:100%');return svg.outerHTML;
}
