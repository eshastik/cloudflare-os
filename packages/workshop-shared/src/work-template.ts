/** Точная версия личного либо опубликованного шаблона. Ссылка не выдаёт прав. */
export type WorkTemplateReference =
  | {template_id: string; revision: number; scope_id?: never; template_key?: never}
  | {scope_id: string; template_key: string; revision: number; template_id?: never};

/** Вид материала определяет его применение, но не полномочия агента. */
export type WorkTemplateKind = 'document' | 'guidance' | 'agent_instructions' | 'skill';

/** Запись каталога с точной версией; название и вид получены от Mnemos. */
export interface ChatWorkTemplateChoice {
  /** Координаты версии в каталоге. */
  reference: WorkTemplateReference;
  /** Название для человека. */
  title: string;
  /** Назначение материала. */
  purpose: string;
  /** Способ применения. */
  kind: WorkTemplateKind;
}

/** Выбор человека: подключение принадлежит отправителю сообщения. */
export interface ChatWorkTemplateReference {
  /** Подключение Mnemos отправителя. */
  accountId: number;
  /** Точная выбранная версия. */
  reference: WorkTemplateReference;
}

/** Проверенный сервером выбор для истории беседы. */
export interface ChatWorkTemplate extends ChatWorkTemplateChoice {
  /** Владелец подключения; сервер сохраняет его при отправке сообщения. */
  ownerId?:string;
  /** Подключение Mnemos отправителя; само по себе не предоставляет доступ. */
  accountId: number;
}

/** Проверяет координаты до запроса и возвращает собственную копию набора. */
export function checkedTemplateReferences(value:unknown):WorkTemplateReference[]{
 if(!Array.isArray(value)||value.length<1||value.length>16)throw new Error('Нужны от одной до шестнадцати ссылок на шаблоны.');
 const seen=new Set<string>();
 const text=(v:unknown):v is string=>typeof v==='string'&&!!v.trim()&&new TextEncoder().encode(v).length<=255&&!v.includes('\0');
 return Array.from(value).map(item=>{
  if(!item||typeof item!=='object'||Array.isArray(item)||!Number.isSafeInteger(item.revision)||item.revision<1||Object.keys(item).some(k=>!['template_id','scope_id','template_key','revision'].includes(k)))throw new Error('Нужна точная ссылка на версию шаблона.');
  let ref:WorkTemplateReference;
  if(text(item.template_id)&&item.scope_id===undefined&&item.template_key===undefined)ref={template_id:item.template_id,revision:item.revision};
  else if(item.template_id===undefined&&text(item.scope_id)&&text(item.template_key))ref={scope_id:item.scope_id,template_key:item.template_key,revision:item.revision};
  else throw new Error('Личная и общая ссылки не могут смешиваться.');
  const key=JSON.stringify(ref);if(seen.has(key))throw new Error('Ссылка на версию повторяется.');seen.add(key);return ref;
 });
}


/** Содержимое точной версии, прочитанное с актуальными правами агента. */
export interface WorkTemplateMaterial extends ChatWorkTemplateChoice {
 /** Голова исходного снимка; не текущая голова папки автора. */
 sourceHead:string;
 /** Тип содержимого для выбора редактора. */
 contentType:string;
 /** Текст методики либо нативные данные формы; неподдерживаемые форматы отвергаются. */
 content:{type:'text';text:string}|{type:'native';snapshot:import('./native-document.js').NativeDocumentSnapshot};
}
