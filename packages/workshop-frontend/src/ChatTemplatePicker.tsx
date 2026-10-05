import SelectedTemplateAgentAccess from './SelectedTemplateAgentAccess'
import WorkTemplatePreview from './WorkTemplatePreview'
import { useEffect, useState, useRef } from 'react'
import { Dialog } from '@cloudflare/kumo'
import { Blueprint, Check, MagnifyingGlass, X, Eye, FileText, BookOpen, Robot, Lightning } from '@phosphor-icons/react'
import type {ChatWorkTemplate} from '@gadgets/workshop-shared/work-template'
import type { AuthenticatedApi, OutputFormatOffer } from '@gadgets/workshop-shared/api'
import { useAuthenticatedApi } from './AuthContext'
import { WorkshopButton, WorkshopIconButton } from './components/WorkshopControls'
import { FormatGlyph } from './components/format/FormatVisuals'
import { localizedNoun } from './components/format/formats'

export type ChatTemplate = { id: string; title: string; description: string; format?: OutputFormatOffer; mnemos?: ChatWorkTemplate[] }
type CatalogApi = Pick<AuthenticatedApi, 'listOwnBlueprints' | 'listLibraryBlueprints' | 'listFeaturedBlueprints' | 'listOutputFormats'>

export async function loadChatTemplates(api: CatalogApi): Promise<{ items: ChatTemplate[]; failed: number }> {
  const results = await Promise.allSettled([
    api.listOutputFormats().then(items => items.map(format => ({ id: format.blueprintId, title: localizedNoun(format.output.noun), description: format.description, format }))),
    api.listOwnBlueprints().then(items => items.map(({ id, title, description }) => ({ id, title, description }))),
    api.listLibraryBlueprints().then(items => items.map(({ id, metadata }) => ({ id, title: metadata.title, description: metadata.description }))),
    api.listFeaturedBlueprints().then(items => items.map(({ id, metadata }) => ({ id, title: metadata.title, description: metadata.description }))),
  ])
  const items = new Map<string, ChatTemplate>()
  for (const result of results) if (result.status === 'fulfilled') {
    for (const item of result.value) if (!items.has(item.id)) items.set(item.id, item)
  }
  return { items: [...items.values()], failed: results.filter(result => result.status === 'rejected').length }
}

/** Ссылка указывает точный шаблон платформы, но не выдаёт агенту новых прав. */
export function messageWithTemplate(message: string, template: ChatTemplate | null, origin: string): string {
  if (!template || template.mnemos) return message
  const title = template.title.replace(/[\\[\]]/g, '\\$&').replace(/[\r\n]+/g, ' ')
  return `${message}\n\nШаблон: [${title}](${origin}/blueprint/${encodeURIComponent(template.id)})`
}

function BlueprintTemplatePicker({ onSelect, onClose, onBack }: { onSelect(template: ChatTemplate): void; onClose(): void; onBack(): void }) {
  const { authenticatedApi } = useAuthenticatedApi()
  const [query, setQuery] = useState('')
  const [catalog, setCatalog] = useState<{ items: ChatTemplate[]; failed: number } | null>(null)
  const [reload, setReload] = useState(0)
  useEffect(() => {
    let active = true
    setCatalog(null)
    void loadChatTemplates(authenticatedApi).then(value => { if (active) setCatalog(value) })
    return () => { active = false }
  }, [authenticatedApi, reload])
  const items = catalog?.items.filter(item => `${item.title} ${item.description}`.toLocaleLowerCase('ru').includes(query.toLocaleLowerCase('ru').trim())) ?? []
  return <Dialog.Root open onOpenChange={open => { if (!open) onClose() }}>
    <Dialog size="base" className="!z-[1200] !w-[min(560px,calc(100vw-24px))] overflow-hidden bg-kumo-base !p-0">
      <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-4">
        <div>
          <Dialog.Title className="text-[17px] font-medium text-kumo-default">С чего начнём?</Dialog.Title>
          <Dialog.Description className="mt-1 text-[13px] text-kumo-subtle">Выберите шаблон и опишите задачу в беседе.</Dialog.Description>
        </div>
        <WorkshopIconButton aria-label="Закрыть выбор шаблона" onClick={onClose}><X size={18} /></WorkshopIconButton>
      </div>
      <div className="px-5 pb-3"><WorkshopButton onClick={onBack}>Назад к рабочим шаблонам</WorkshopButton></div>
      <label className="mx-5 mb-3 flex h-10 items-center gap-2 rounded-lg border border-kumo-line px-3 focus-within:border-kumo-brand">
        <MagnifyingGlass size={16} className="text-kumo-inactive" />
        <input autoFocus aria-label="Поиск шаблона" placeholder="Найти шаблон…" value={query} onChange={event => setQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent text-[13px] text-kumo-default outline-none" />
      </label>
      <div className="max-h-[min(55vh,440px)] overflow-y-auto px-2 pb-3" aria-label="Шаблоны платформы">
        {!catalog && <p role="status" className="px-3 py-5 text-[13px] text-kumo-subtle">Загрузка шаблонов…</p>}
        {!!catalog?.failed && <div role="status" className="mx-3 mb-2 text-[13px] text-kumo-subtle">Часть шаблонов не загрузилась. <WorkshopButton onClick={() => setReload(value => value + 1)}>Повторить</WorkshopButton></div>}
        {catalog && !items.length && <p className="px-3 py-5 text-[13px] text-kumo-subtle">{query ? 'Подходящих шаблонов нет. Попробуйте другое название.' : catalog.failed ? 'Каталог пока недоступен.' : 'Сохранённых шаблонов пока нет. Опишите задачу в чате — можно начать с чистого документа.'}</p>}
        {items.map(item => <button key={item.id} type="button" onClick={() => onSelect(item)} className="flex w-full items-start gap-3 rounded-lg px-3 py-3 text-left hover:bg-kumo-tint focus-visible:outline-2 focus-visible:outline-kumo-brand">
          <span className="mt-0.5 text-kumo-subtle">{item.format ? <FormatGlyph output={item.format.output} size="md" /> : <Blueprint size={20} />}</span>
          <span className="min-w-0 flex-1"><span className="block text-[14px] font-medium text-kumo-default">{item.title || 'Без названия'}</span>{item.description && <span className="mt-0.5 block line-clamp-2 text-[12px] leading-[18px] text-kumo-subtle">{item.description}</span>}</span>
        </button>)}
      </div>
    </Dialog>
  </Dialog.Root>
}

const templateSelectionKey=(item:ChatWorkTemplate)=>JSON.stringify([item.accountId,item.reference]);

/** Рабочие материалы Mnemos и явный вход к старым ссылкам Blueprint. */
export default function ChatTemplatePicker({onSelect,onClose,initialSelected=[],preferredProject,onOtherTemplates,embedded=false,onSelectionChange}:{onSelect(template:ChatTemplate):void;onClose():void;initialSelected?:ChatWorkTemplate[];preferredProject?:{accountId:number;projectId:string};onOtherTemplates?(selected:ChatWorkTemplate[]):void;embedded?:boolean;onSelectionChange?(selected:ChatWorkTemplate[]):void}){
 const {authenticatedApi}=useAuthenticatedApi();
 const [legacy,setLegacy]=useState(false);
 const [preview,setPreview]=useState<ChatWorkTemplate|null>(null);
 const [selected,setSelected]=useState<ChatWorkTemplate[]>(()=>[...initialSelected]);
 const [agentReadyKey,setAgentReadyKey]=useState('');
 const selectedKey=JSON.stringify(selected.map(item=>[item.accountId,item.reference]));
 useEffect(()=>{onSelectionChange?.(selected)},[selected,onSelectionChange]);
 const [accounts,setAccounts]=useState<Array<{accountId:number;title:string}>>([]);
 const [accountId,setAccountId]=useState<number|null>(initialSelected[0]?.accountId??preferredProject?.accountId??null);
 const [scopes,setScopes]=useState<Array<{scopeId:string;title:string}>>([]);
 const [scopeCursor,setScopeCursor]=useState('');
 const [scopeId,setScopeId]=useState<string|null>(initialSelected[0]&&'scope_id' in initialSelected[0].reference?initialSelected[0].reference.scope_id??null:null);
 const [library,setLibrary]=useState<'personal'|'shared'>(initialSelected[0]&&'scope_id' in initialSelected[0].reference?'shared':'personal');
 const [projects,setProjects]=useState<Array<{accountId:number;projectId:string;title:string}>>([]);
 const [projectId,setProjectId]=useState('');
 const generation=useRef(0);
 const scopeAccount=useRef<number|null>(accountId);
 const scopeRequest=useRef<symbol|null>(null);
 const [scopeBusy,setScopeBusy]=useState(false);
 const [scopeError,setScopeError]=useState('');
 const [items,setItems]=useState<ChatWorkTemplate[]>([]);
 const [cursor,setCursor]=useState('');
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 const [query,setQuery]=useState('');
 const [reload,setReload]=useState(0);
 const [catalogState,setCatalogState]=useState<'loading'|'ready'|'error'>('loading');
 const initialAccount=useRef(initialSelected[0]?.accountId??null);
 const preferredAccount=initialAccount.current??preferredProject?.accountId??null;
 const preferredProjectId=preferredProject?.projectId;
 const preferredProjectAccount=preferredProject?.accountId;
 const [kind,setKind]=useState<ChatWorkTemplate['kind']|'all'>('all');
 useEffect(()=>{
  let active=true;setCatalogState('loading');setError('');
  void Promise.all([authenticatedApi.listChatTemplateAccounts(),authenticatedApi.listChatProjects()]).then(([value,availableProjects])=>{
   if(!active)return;
   setProjects(availableProjects);setAccounts(value);
   setAccountId(old=>value.some(a=>a.accountId===old)?old:preferredAccount===null?value[0]?.accountId??null:null);
   setCatalogState('ready');
  },()=>{if(active){setError('Не удалось загрузить библиотеки Mnemos.');setCatalogState('error');}});
  return()=>{active=false;};
 },[authenticatedApi,reload,preferredAccount]);
 useEffect(()=>{
  if(catalogState!=='ready')return;
  let active=true;setScopeError('');
  if(scopeAccount.current!==accountId){scopeAccount.current=accountId;setScopes([]);setScopeCursor('');setScopeId(null);scopeRequest.current=null;setScopeBusy(false);}
  setProjectId(old=>{
   if(projects.some(p=>p.accountId===accountId&&p.projectId===old))return old;
   if(accountId===preferredProjectAccount)return projects.some(p=>p.accountId===accountId&&p.projectId===preferredProjectId)?preferredProjectId??'':'';
   return projects.find(p=>p.accountId===accountId)?.projectId??'';
  });
  if(accountId!==null)void authenticatedApi.listChatTemplateScopes(accountId).then(page=>{if(active){setScopes(old=>[...page.scopes,...old.filter(scope=>scope.scopeId===scopeId&&!page.scopes.some(fresh=>fresh.scopeId===scope.scopeId))]);setScopeCursor(page.nextCursor);}},()=>{if(active)setScopeError('Области шаблонов не загрузились. Личный каталог можно открыть отдельно.');});
  return()=>{active=false;};
 },[authenticatedApi,accountId,projects,reload,catalogState,preferredProjectAccount,preferredProjectId]);
 useEffect(()=>{
  let active=true;++generation.current;setPreview(null);setItems([]);setCursor('');if(catalogState!=='ready'){setLoading(catalogState==='loading');return;}setError('');if(accountId===null||library==='shared'&&!scopeId||library==='personal'&&!projectId){setLoading(false);return;}
  setLoading(true);setError('');
  void authenticatedApi.listChatTemplates(accountId,scopeId,'',scopeId===null?projectId:undefined).then(page=>{if(active){setItems(page.templates.map(item=>({...item,accountId})));setCursor(page.nextCursor);setLoading(false);}},()=>{if(active){setError('Выбранный каталог недоступен. Повторите запрос или выберите другую область.');setLoading(false);}});
  return()=>{active=false;};
 },[authenticatedApi,accountId,scopeId,projectId,library,reload,catalogState]);
 const more=async()=>{if(accountId===null)return;const current=generation.current;setLoading(true);try{const page=await authenticatedApi.listChatTemplates(accountId,scopeId,cursor,scopeId===null?projectId:undefined);if(current!==generation.current)return;setItems(old=>[...old,...page.templates.map(item=>({...item,accountId}))]);setCursor(page.nextCursor);}catch{if(current===generation.current)setError('Следующая страница не загрузилась.');}finally{if(current===generation.current)setLoading(false);}};
 const moreScopes=async()=>{
  if(accountId===null||scopeRequest.current!==null)return;
  const token=Symbol();scopeRequest.current=token;setScopeBusy(true);const current=generation.current;
  try{const page=await authenticatedApi.listChatTemplateScopes(accountId,scopeCursor);if(current!==generation.current||scopeRequest.current!==token)return;setScopes(old=>[...old,...page.scopes.filter(s=>!old.some(existing=>existing.scopeId===s.scopeId))]);setScopeCursor(page.nextCursor);}
  catch{if(current===generation.current)setScopeError('Следующая страница областей не загрузилась.');}
  finally{if(scopeRequest.current===token){scopeRequest.current=null;setScopeBusy(false);}}
 };
 if(legacy)return <BlueprintTemplatePicker onSelect={onSelect} onClose={onClose} onBack={()=>setLegacy(false)}/>;
 const kinds={document:'Форма документа',guidance:'Методика',agent_instructions:'Инструкция агента',skill:'Навык'};
 const filters=[['all','Все'],['document','Формы'],['guidance','Методики'],['agent_instructions','Инструкции'],['skill','Навыки']] as const;
 const chosen=(item:ChatWorkTemplate)=>selected.some(s=>templateSelectionKey(s)===templateSelectionKey(item));
 const remove=(item:ChatWorkTemplate)=>setSelected(old=>old.filter(s=>templateSelectionKey(s)!==templateSelectionKey(item)));
 if(preview)return <WorkTemplatePreview key={templateSelectionKey(preview)} editingProject={embedded&&accountId!==null&&projectId?{accountId,projectId}:undefined} item={preview} isSelected={chosen} selected={chosen(preview)} atLimit={selected.length>=16} onBack={()=>setPreview(null)} onClose={embedded?()=>setPreview(null):onClose} onToggle={item=>chosen(item)?remove(item):setSelected(old=>old.length<16?[...old,item]:old)}/>;
 const shown=items.filter(item=>(kind==='all'||item.kind===kind)&&(item.title+' '+item.purpose).toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru')));
 const selectClass='h-9 w-full min-w-0 rounded-lg border border-kumo-line bg-kumo-base px-2 text-[13px] text-kumo-default focus-visible:outline-2 focus-visible:outline-kumo-brand';
 const Container=embedded?'section':Dialog;
 const Title=embedded?'h2':Dialog.Title;
 const Description=embedded?'p':Dialog.Description;
 const content=<Container size={embedded?undefined:"base"} aria-label={embedded?"Рабочие шаблоны":undefined} className={embedded?"flex w-full min-w-0 flex-col overflow-hidden bg-kumo-base p-0":"!z-[1200] !flex !max-h-[calc(100dvh-24px)] !w-[min(600px,calc(100vw-24px))] !flex-col overflow-hidden bg-kumo-base !p-0"}>
   <div className={embedded?"sr-only":"flex shrink-0 justify-between gap-4 px-5 py-4"}>
    <div><Title className="text-[17px] font-medium">Шаблоны для задачи</Title><Description className="mt-1 text-[13px] leading-5 text-kumo-subtle">Форма задаёт структуру документа, методика — порядок работы. Можно выбрать несколько материалов.</Description></div>
    {!embedded&&<WorkshopIconButton aria-label="Закрыть выбор шаблона" onClick={onClose}><X size={18}/></WorkshopIconButton>}
   </div>
   <div className={embedded?"pb-5":"px-5 pb-4"}>
    <label className="flex h-11 items-center gap-3 rounded-lg border border-kumo-line bg-kumo-base px-3 focus-within:border-kumo-brand"><MagnifyingGlass size={18} className="shrink-0 text-kumo-subtle"/><input autoFocus={!embedded} aria-label="Поиск шаблона" placeholder="Найти шаблон для задачи…" value={query} onChange={event=>setQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm outline-none"/></label>
    <div className="mt-3 flex flex-wrap items-center gap-3">
     <div className="flex shrink-0 gap-1 rounded-lg bg-kumo-tint p-1" role="group" aria-label="Библиотеки шаблонов">{([['personal','Личные'],['shared','Общие']] as const).map(([value,label])=><button key={value} type="button" aria-pressed={library===value} onClick={()=>{setLibrary(value);if(value==='personal')setScopeId(null)}} className={'rounded-md px-3 py-1.5 text-[13px] focus-visible:outline-2 focus-visible:outline-kumo-brand '+(library===value?'bg-kumo-base font-medium text-kumo-default shadow-sm':'text-kumo-subtle hover:text-kumo-default')}>{label}</button>)}</div>
     {accountId!==null&&library==='shared'&&<select className={selectClass+' !w-auto min-w-[160px] flex-1'} aria-label="Область шаблонов" value={scopeId??''} onChange={event=>setScopeId(event.target.value||null)}><option value="" disabled>Выберите общую библиотеку</option>{scopeId&&!scopes.some(scope=>scope.scopeId===scopeId)&&<option value={scopeId}>Область выбранного шаблона</option>}{scopes.map(scope=><option key={scope.scopeId} value={scope.scopeId}>{scope.title}</option>)}</select>}
     {accountId!==null&&library==='personal'&&<details className="min-w-0 max-w-full text-[13px] text-kumo-subtle"><summary className="cursor-pointer rounded-lg px-2 py-2 focus-visible:outline-2 focus-visible:outline-kumo-brand">{projects.find(project=>project.accountId===accountId&&project.projectId===projectId)?.title??'Выберите проект'}</summary><label className="mt-2 block text-[12px]">Проект<select className={selectClass+' mt-1'} aria-label="Проект личных шаблонов" value={projectId} onChange={event=>setProjectId(event.target.value)}><option value="" disabled>Выберите проект</option>{projects.filter(p=>p.accountId===accountId).map(p=><option key={p.projectId} value={p.projectId}>{p.title}</option>)}</select></label></details>}
     {(accounts.length>1||accountId===null&&accounts.length>0)&&<select className={selectClass+' !w-auto max-w-full'} aria-label="Подключение Mnemos" value={accountId??''} onChange={event=>{setScopeId(null);setProjectId('');setAccountId(Number(event.target.value))}}><option value="" disabled>Выберите библиотеку</option>{accounts.map(a=><option key={a.accountId} value={a.accountId}>{a.title}</option>)}</select>}
     {library==='shared'&&scopeCursor&&<WorkshopButton disabled={scopeBusy} onClick={()=>void moreScopes()}>Ещё библиотеки</WorkshopButton>}
    </div>
    <div className="mt-3 flex flex-wrap gap-1" role="group" aria-label="Виды шаблонов">{filters.map(([value,label])=><button key={value} type="button" aria-pressed={kind===value} onClick={()=>setKind(value)} className={'rounded-lg px-3 py-2 text-[13px] focus-visible:outline-2 focus-visible:outline-kumo-brand '+(kind===value?'bg-kumo-tint font-medium text-kumo-default':'text-kumo-subtle hover:bg-kumo-tint')}>{label}</button>)}</div>
   </div>
   <div className={embedded?"min-h-0 flex-1":"min-h-0 flex-1 overflow-y-auto border-t border-kumo-line px-5"} aria-label="Рабочие шаблоны Mnemos">
    {scopeError&&<p role="alert" className="px-2 py-2 text-[13px]">{scopeError} <WorkshopButton onClick={()=>setReload(v=>v+1)}>Повторить загрузку областей</WorkshopButton></p>}
    {error&&<p role="alert" className="px-2 py-2 text-[13px]">{error} <WorkshopButton onClick={()=>setReload(v=>v+1)}>Повторить</WorkshopButton></p>}
    {loading&&<p role="status" className="px-2 py-4 text-[13px] text-kumo-subtle">Загрузка шаблонов…</p>}
    {!loading&&!error&&!shown.length&&<div className="px-2 py-6 text-[13px] text-kumo-subtle">{accountId===null?(accounts.length?'Выберите библиотеку для поиска шаблонов.':'Библиотека Mnemos пока недоступна.'):library==='shared'&&!scopeId?(scopes.length?'Выберите общую библиотеку выше.':'Доступных общих библиотек пока нет.'):scopeId===null&&!projectId?(accountId===preferredProjectAccount?'Проект беседы недоступен в этой библиотеке. Выберите другой проект.':'Выберите проект для личных шаблонов.'):query||kind!=='all'?'Совпадений нет. Измените запрос или вид шаблона.':'В этой области шаблонов пока нет.'}</div>}
    {shown.map(item=>{const Glyph={document:FileText,guidance:BookOpen,agent_instructions:Robot,skill:Lightning}[item.kind];return <div key={templateSelectionKey(item)} className="flex items-center gap-2 border-b border-kumo-line py-2">
     <button type="button" aria-pressed={chosen(item)} disabled={!chosen(item)&&selected.length>=16} onClick={()=>chosen(item)?remove(item):setSelected(old=>old.length<16?[...old,item]:old)} className="flex min-w-0 flex-1 items-start gap-3 rounded-lg px-2 py-3 text-left hover:bg-kumo-tint focus-visible:outline-2 focus-visible:outline-kumo-brand disabled:opacity-50">
      <span className={'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg '+(chosen(item)?'bg-kumo-tint text-kumo-brand':'bg-kumo-tint text-kumo-subtle')} aria-hidden="true">{chosen(item)?<Check size={20}/>:<Glyph size={20}/>}</span>
      <span className="min-w-0 flex-1"><span className="block text-[14px] font-medium text-kumo-default">{item.title}</span>{item.purpose&&<span className="mt-1 block line-clamp-2 text-[13px] leading-5 text-kumo-subtle">{item.purpose}</span>}<span className="mt-1 block text-[12px] text-kumo-subtle">{kinds[item.kind]} · версия {item.reference.revision}</span></span>
     </button>
     <WorkshopIconButton aria-label={'Посмотреть: '+item.title} title="Посмотреть содержимое" onClick={()=>setPreview(item)}><Eye size={18}/></WorkshopIconButton>
    </div>})}
    {cursor&&<WorkshopButton className="mt-2" disabled={loading} onClick={()=>void more()}>Загрузить ещё шаблоны</WorkshopButton>}
   </div>
   <div className={embedded?"sticky bottom-0 shrink-0 border-t border-kumo-line bg-kumo-base py-4":"shrink-0 border-t border-kumo-line bg-kumo-base px-5 py-4"}>
    {selected.length>0&&<div className="mb-3" aria-label="Выбранные шаблоны"><p className="mb-2 text-[12px] text-kumo-subtle">Материалы для задачи · {selected.length}</p><ul className="flex max-h-28 flex-wrap gap-2 overflow-y-auto">{selected.map(item=><li key={templateSelectionKey(item)} className="flex max-w-full items-center gap-1 rounded-lg border border-kumo-line py-1 pl-2 text-[12px]"><span className="min-w-0 truncate" title={item.title}>{item.title} · версия {item.reference.revision}</span><WorkshopIconButton aria-label={'Убрать: '+item.title} className="!h-6 !w-6" onClick={()=>remove(item)}><X size={12}/></WorkshopIconButton></li>)}</ul></div>}
    {selected.length>0&&<SelectedTemplateAgentAccess key={selectedKey} items={selected} onReady={setAgentReadyKey}/>}
    {selected.length>=16&&<p role="status" className="mb-3 text-[12px] text-kumo-subtle">Можно выбрать до 16 материалов. Уберите один, чтобы добавить другой.</p>}
    <div className="flex flex-wrap items-center justify-end gap-2">{!embedded&&<WorkshopButton onClick={()=>onOtherTemplates?onOtherTemplates(selected):setLegacy(true)}>{onOtherTemplates?"Шаблоны приложений":"Другие шаблоны"}</WorkshopButton>}<WorkshopButton tone="primary" disabled={!selected.length||agentReadyKey!==selectedKey} onClick={()=>onSelect({id:JSON.stringify(selected.map(s=>[s.accountId,s.reference])),title:selected.map(s=>s.title+' · версия '+s.reference.revision).join('; '),description:'',mnemos:selected})}>Использовать выбранные ({selected.length})</WorkshopButton></div>
   </div>
  </Container>;
 return embedded?content:<Dialog.Root open onOpenChange={open=>{if(!open)onClose();}}>{content}</Dialog.Root>;
}
