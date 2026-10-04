import { useEffect, useState, useRef } from 'react'
import { Dialog } from '@cloudflare/kumo'
import { Blueprint, MagnifyingGlass, X } from '@phosphor-icons/react'
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

function BlueprintTemplatePicker({ onSelect, onClose }: { onSelect(template: ChatTemplate): void; onClose(): void }) {
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

/** Рабочие материалы Mnemos и явный вход к старым ссылкам Blueprint. */
export default function ChatTemplatePicker({onSelect,onClose}:{onSelect(template:ChatTemplate):void;onClose():void}){
 const {authenticatedApi}=useAuthenticatedApi();
 const [legacy,setLegacy]=useState(false);
 const [selected,setSelected]=useState<ChatWorkTemplate[]>([]);
 const [accounts,setAccounts]=useState<Array<{accountId:number;title:string}>>([]);
 const [accountId,setAccountId]=useState<number|null>(null);
 const [scopes,setScopes]=useState<Array<{scopeId:string;title:string}>>([]);
 const [scopeCursor,setScopeCursor]=useState('');
 const [scopeId,setScopeId]=useState<string|null>(null);
 const [projects,setProjects]=useState<Array<{accountId:number;projectId:string;title:string}>>([]);
 const [projectId,setProjectId]=useState('');
 const generation=useRef(0);
 const scopeAccount=useRef<number|null>(null);
 const scopeRequest=useRef<symbol|null>(null);
 const [scopeBusy,setScopeBusy]=useState(false);
 const [scopeError,setScopeError]=useState('');
 const [items,setItems]=useState<ChatWorkTemplate[]>([]);
 const [cursor,setCursor]=useState('');
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 const [query,setQuery]=useState('');
 const [reload,setReload]=useState(0);
 useEffect(()=>{let active=true;void Promise.all([authenticatedApi.listChatTemplateAccounts(),authenticatedApi.listChatProjects()]).then(([value,projects])=>{if(active){setProjects(projects);setAccounts(value);setAccountId(old=>value.some(a=>a.accountId===old)?old:value[0]?.accountId??null);if(!value.length)setLoading(false);}},()=>{if(active){setError('Не удалось загрузить подключения Mnemos.');setLoading(false);}});return()=>{active=false;};},[authenticatedApi,reload]);
 useEffect(()=>{
  let active=true;setScopeError('');
  if(scopeAccount.current!==accountId){scopeAccount.current=accountId;setScopes([]);setScopeCursor('');setScopeId(null);scopeRequest.current=null;setScopeBusy(false);}
  setProjectId(old=>projects.some(p=>p.accountId===accountId&&p.projectId===old)?old:projects.find(p=>p.accountId===accountId)?.projectId??'');
  if(accountId!==null)void authenticatedApi.listChatTemplateScopes(accountId).then(page=>{if(active){setScopes(old=>[...page.scopes,...old.filter(scope=>scope.scopeId===scopeId&&!page.scopes.some(fresh=>fresh.scopeId===scope.scopeId))]);setScopeCursor(page.nextCursor);}},()=>{if(active)setScopeError('Области шаблонов не загрузились. Личный каталог можно открыть отдельно.');});
  return()=>{active=false;};
 },[authenticatedApi,accountId,projects,reload]);
 useEffect(()=>{
  let active=true;++generation.current;setItems([]);setCursor('');if(accountId===null||scopeId===null&&!projectId){setLoading(false);return;}
  setLoading(true);setError('');
  void authenticatedApi.listChatTemplates(accountId,scopeId,'',scopeId===null?projectId:undefined).then(page=>{if(active){setItems(page.templates.map(item=>({...item,accountId})));setCursor(page.nextCursor);setLoading(false);}},()=>{if(active){setError('Выбранный каталог недоступен. Повторите запрос или выберите другую область.');setLoading(false);}});
  return()=>{active=false;};
 },[authenticatedApi,accountId,scopeId,projectId,reload]);
 const more=async()=>{if(accountId===null)return;const current=generation.current;setLoading(true);try{const page=await authenticatedApi.listChatTemplates(accountId,scopeId,cursor,scopeId===null?projectId:undefined);if(current!==generation.current)return;setItems(old=>[...old,...page.templates.map(item=>({...item,accountId}))]);setCursor(page.nextCursor);}catch{if(current===generation.current)setError('Следующая страница не загрузилась.');}finally{if(current===generation.current)setLoading(false);}};
 const moreScopes=async()=>{
  if(accountId===null||scopeRequest.current!==null)return;
  const token=Symbol();scopeRequest.current=token;setScopeBusy(true);const current=generation.current;
  try{const page=await authenticatedApi.listChatTemplateScopes(accountId,scopeCursor);if(current!==generation.current||scopeRequest.current!==token)return;setScopes(old=>[...old,...page.scopes.filter(s=>!old.some(existing=>existing.scopeId===s.scopeId))]);setScopeCursor(page.nextCursor);}
  catch{if(current===generation.current)setScopeError('Следующая страница областей не загрузилась.');}
  finally{if(scopeRequest.current===token){scopeRequest.current=null;setScopeBusy(false);}}
 };
 if(legacy)return <BlueprintTemplatePicker onSelect={onSelect} onClose={onClose}/>;
 const shown=items.filter(item=>(item.title+' '+item.purpose).toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru')));
 const kinds={document:'Форма документа',guidance:'Методика',agent_instructions:'Инструкция агента',skill:'Навык'};
 return <Dialog.Root open onOpenChange={open=>{if(!open)onClose();}}><Dialog size="base" className="!z-[1200] !w-[min(560px,calc(100vw-24px))] overflow-hidden bg-kumo-base !p-0">
  <div className="flex justify-between gap-4 px-5 py-4"><div><Dialog.Title>Выбрать шаблон</Dialog.Title><Dialog.Description>Формы и методики для задачи. Выбранная версия останется в истории беседы.</Dialog.Description></div><WorkshopIconButton aria-label="Закрыть выбор шаблона" onClick={onClose}><X size={18}/></WorkshopIconButton></div>
  <div className="flex flex-wrap gap-2 px-5 pb-3">
   {accounts.length>1&&<select aria-label="Подключение Mnemos" value={accountId??''} onChange={event=>setAccountId(Number(event.target.value))}>{accounts.map(a=><option key={a.accountId} value={a.accountId}>{a.title} · {a.accountId}</option>)}</select>}
   {accountId!==null&&<select aria-label="Область шаблонов" value={scopeId??''} onChange={event=>setScopeId(event.target.value||null)}><option value="">Личные шаблоны</option>{scopes.map(scope=><option key={scope.scopeId} value={scope.scopeId}>{scope.title}</option>)}</select>}
   {accountId!==null&&scopeId===null&&<select aria-label="Проект личных шаблонов" value={projectId} onChange={event=>setProjectId(event.target.value)}>{projects.filter(p=>p.accountId===accountId).map(p=><option key={p.projectId} value={p.projectId}>{p.title}</option>)}</select>}
   {scopeCursor&&<WorkshopButton disabled={scopeBusy} onClick={()=>void moreScopes()}>Ещё области</WorkshopButton>}
  </div>
  <label className="mx-5 mb-3 flex gap-2 rounded-lg border border-kumo-line px-3 py-2"><MagnifyingGlass size={16}/><input autoFocus aria-label="Поиск шаблона" placeholder="Найти в загруженных шаблонах…" value={query} onChange={event=>setQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent outline-none"/></label>
  <div className="max-h-[min(55vh,440px)] overflow-y-auto px-5 pb-4" aria-label="Рабочие шаблоны Mnemos">
   {scopeError&&<p role="alert">{scopeError} <WorkshopButton onClick={()=>setReload(v=>v+1)}>Повторить загрузку областей</WorkshopButton></p>}
   {error&&<p role="alert">{error} <WorkshopButton onClick={()=>setReload(v=>v+1)}>Повторить</WorkshopButton></p>}
   {loading&&<p role="status">Загрузка шаблонов…</p>}
   {!loading&&!error&&!shown.length&&<p>{accountId===null?'Mnemos не подключён.':query?'В загруженных шаблонах совпадений нет.':'В этой области шаблонов пока нет.'}</p>}
   {shown.map(item=><button key={JSON.stringify(item.reference)} type="button" aria-pressed={selected.some(s=>s.accountId===item.accountId&&JSON.stringify(s.reference)===JSON.stringify(item.reference))} onClick={()=>setSelected(old=>{const key=JSON.stringify([item.accountId,item.reference]);return old.some(s=>JSON.stringify([s.accountId,s.reference])===key)?old.filter(s=>JSON.stringify([s.accountId,s.reference])!==key):old.length<16?[...old,item]:old;})} className="block w-full rounded-lg py-3 text-left hover:bg-kumo-tint"><span className="block font-medium">{item.title}</span><span className="block text-[12px] text-kumo-subtle">{kinds[item.kind]} · версия {item.reference.revision}</span><span className="block text-[13px]">{item.purpose}</span></button>)}
   {cursor&&<WorkshopButton disabled={loading} onClick={()=>void more()}>Загрузить ещё</WorkshopButton>}
  </div>
  <div className="border-t border-kumo-line px-5 py-3">{selected.length>0&&<><p className="mb-2 text-[12px]">{selected.map(s=>s.title+' · версия '+s.reference.revision).join('; ')}</p><WorkshopButton onClick={()=>onSelect({id:JSON.stringify(selected.map(s=>[s.accountId,s.reference])),title:selected.map(s=>s.title+' · версия '+s.reference.revision).join('; '),description:'',mnemos:selected})}>Использовать выбранные ({selected.length})</WorkshopButton></>}<WorkshopButton onClick={()=>setLegacy(true)}>Старые шаблоны Blueprint</WorkshopButton></div>
 </Dialog></Dialog.Root>;
}
