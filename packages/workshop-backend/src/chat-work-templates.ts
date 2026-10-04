import {checkedTemplateReferences,type ChatWorkTemplate,type ChatWorkTemplateChoice,type ChatWorkTemplateReference,type WorkTemplateReference} from '@gadgets/workshop-shared/work-template';

/** Проверяет собственное подключение и точную версию до фиксации сообщения. */
export async function prepareChatWorkTemplates(
 value:ChatWorkTemplateReference[]|undefined,
 read:(accountId:number,references:WorkTemplateReference[])=>Promise<ChatWorkTemplateChoice[]>,
):Promise<ChatWorkTemplate[]|undefined>{
 if(value===undefined)return undefined;
 if(!Array.isArray(value)||!value.length||value.length>16)throw new Error('Выберите от одного до шестнадцати шаблонов.');
 const seen=new Set<string>();
 const refs=Array.from(value).map(item=>{
  if(!item||typeof item!=='object'||Object.keys(item).some(k=>!['accountId','reference'].includes(k))||!Number.isSafeInteger(item.accountId)||item.accountId<0)throw new Error('Неверное подключение шаблона.');
  const reference=checkedTemplateReferences([item.reference])[0];const ref={accountId:item.accountId,reference};
  const key=JSON.stringify(ref);if(seen.has(key))throw new Error('Версия шаблона выбрана дважды.');seen.add(key);return ref;
 });
 const results=new Map<number,ChatWorkTemplateChoice[]>();
 await Promise.all([...new Set(refs.map(r=>r.accountId))].map(async accountId=>{
  const selected=refs.filter(r=>r.accountId===accountId).map(r=>r.reference);
  const templates=await read(accountId,selected);
  if(!Array.isArray(templates)||templates.length!==selected.length)throw new Error('Mnemos вернул неполный набор шаблонов.');
  templates.forEach((item,i)=>{if(!item||JSON.stringify(checkedTemplateReferences([item.reference])[0])!==JSON.stringify(selected[i])||typeof item.title!=='string'||!item.title.trim()||typeof item.purpose!=='string'||!['document','guidance','agent_instructions','skill'].includes(item.kind))throw new Error('Mnemos вернул другую версию шаблона.');});
  results.set(accountId,templates);
 }));
 const offsets=new Map<number,number>();
 return refs.map(ref=>{const i=offsets.get(ref.accountId)??0;offsets.set(ref.accountId,i+1);const item=results.get(ref.accountId)![i];return {accountId:ref.accountId,reference:ref.reference,title:item.title,purpose:item.purpose,kind:item.kind};});
}
