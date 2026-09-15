import TemplateScopeSettings from './TemplateScopeSettings'
import {useEffect, useRef, useState} from 'react'
import {useNavigate} from '@tanstack/react-router'
import {Button} from '@cloudflare/kumo'
import type {GatekeeperBlueprintTemplates, GatekeeperUiFrame} from '@gadgets/workshop-shared/gatekeeper'
import {BLUEPRINT_TEMPLATE_MIME, decodeBlueprintTemplate} from '@gadgets/workshop-shared/blueprint-template'
import {useAuthenticatedApi} from './AuthContext'
import {listAccounts, storesDocuments, openBlueprintTemplatesFrame} from './accountCapabilities'
import {disposeGatekeeperFrame} from './disposeGatekeeperFrame'
import {downloadGatekeeperFile} from './gatekeeperAppDownload'

type Entry = Awaited<ReturnType<GatekeeperBlueprintTemplates['templates']>>['templates'][number]
type Scope = Awaited<ReturnType<GatekeeperBlueprintTemplates['scopes']>>['scopes'][number]
const levels = {organization:'Организация', department:'Отдел', group:'Группа'}

export default function SharedTemplateLibrary() {
 const {authenticatedApi:api} = useAuthenticatedApi(), navigate = useNavigate()
 const [accounts,setAccounts] = useState<{id:number;name:string}[]>([]), [account,setAccount] = useState<number|null>(null)
 const [scopes,setScopes] = useState<Scope[]>([]), [scope,setScope] = useState('')
 const [projects,setProjects] = useState<{id:string;name:string}[]>([]), [project,setProject] = useState('')
 const [items,setItems] = useState<Entry[]>([]), [cursor,setCursor] = useState(''), [selected,setSelected] = useState<Entry|null>(null)
 const [settings,setSettings]=useState(false),[configurationRevision,setConfigurationRevision]=useState(0)
 const [reason,setReason] = useState(''), [promotion,setPromotion] = useState('')
 const [loading,setLoading] = useState(true), [busy,setBusy] = useState(false), [error,setError] = useState('')
 const frame = useRef<GatekeeperUiFrame|null>(null), lifetime = useRef(new AbortController())
 const pending = useRef<{key:string;id:string}|null>(null)
 useEffect(()=>{
   let active=true
   void listAccounts(api).then(result=>{
     if(!active)return
     const choices=result.filter(storesDocuments).map(item=>({id:item.id,name:item.description.displayName||item.vendorId}))
     setAccounts(choices);if(choices.length)setAccount(choices[0].id);else setLoading(false)
   }).catch(()=>{if(active){setError('Не удалось прочитать подключения');setLoading(false)}})
   return()=>{active=false}
 },[api])
 useEffect(()=>{
   let active=true
   const controller=new AbortController();lifetime.current=controller
   setScopes([]);setScope('');setItems([]);setProjects([]);setProject('');setSelected(null);setError('')
   if(account===null)return
   setLoading(true)
   void openBlueprintTemplatesFrame(api,account).then(async value=>{
     if(!active){disposeGatekeeperFrame(value);return}
     frame.current=value
     const found:Scope[]=[];let next=''
     do {const page=await value.blueprintTemplates.selector.scopes(next);if(!active)return;found.push(...page.scopes.filter(item=>item.enabled));next=page.next_cursor||''} while(next)
     const projectPage=await value.blueprintTemplates.selector.projects();if(!active)return
     setProjects(projectPage.projects);if(projectPage.projects.length===1)setProject(projectPage.projects[0].id)
     setScopes(found);if(found.length)setScope(found[0].scope_id);else setLoading(false)
   }).catch(()=>{if(active){setError('Не удалось открыть общие шаблоны');setLoading(false)}})
   return()=>{active=false;controller.abort();disposeGatekeeperFrame(frame.current);frame.current=null}
 },[api,account,configurationRevision])
 useEffect(()=>{
   let active=true
   setItems([]);setCursor('');setSelected(null)
   const store=frame.current?.blueprintTemplates
   if(!scope||!store)return
   setLoading(true);setError('')
   void store.selector.templates(scope).then(page=>{if(active){setItems(page.templates.filter(item=>item.source.content_type===BLUEPRINT_TEMPLATE_MIME));setCursor(page.next_cursor||'')}})
     .catch(()=>{if(active)setError('Не удалось загрузить шаблоны')}).finally(()=>{if(active)setLoading(false)})
   return()=>{active=false}
 },[scope])
 async function more(){
   const store=frame.current?.blueprintTemplates;if(!store||!cursor||busy)return
   setBusy(true);setError('');const signal=lifetime.current.signal, currentScope=scope
   try{const page=await store.selector.templates(currentScope,cursor);signal.throwIfAborted();setItems(old=>[...old,...page.templates.filter(item=>item.source.content_type===BLUEPRINT_TEMPLATE_MIME)]);setCursor(page.next_cursor||'')}
   catch{if(!signal.aborted)setError('Не удалось загрузить следующую страницу')}
   finally{if(!signal.aborted)setBusy(false)}
 }
 async function create(){
   const store=frame.current?.blueprintTemplates;if(!store||!selected||!project||busy)return
   setBusy(true);setError('');const signal=lifetime.current.signal
   try {
     const key=JSON.stringify([account,selected.scope_id,selected.template_key,selected.revision,project])
     if(pending.current?.key!==key){
       let id=sessionStorage.getItem('mnemos-template-use:'+key)
       if(!id){id=crypto.randomUUID();sessionStorage.setItem('mnemos-template-use:'+key,id)}
       pending.current={key,id}
     }
     const copy=await store.selector.apply(selected.scope_id,selected.template_key,selected.revision,project,selected.source.title+'.mnemos-template',pending.current.id)
     signal.throwIfAborted()
     const bytes=await downloadGatekeeperFile(store.storageOrigin,copy.ticket,signal,()=>store.selector.validateApplication(project,copy.node,copy.head))
     await decodeBlueprintTemplate(bytes);signal.throwIfAborted()
     using workspace=await api.newGadgetFromTemplateSnapshot(new Response(new Uint8Array(bytes)).body!,{})
     const metadata=await workspace.getMetadata();signal.throwIfAborted()
     sessionStorage.removeItem('mnemos-template-use:'+key);pending.current=null
     await navigate({to:'/workspace/$id',params:{id:metadata.id}})
   } catch {if(!signal.aborted)setError('Не удалось открыть шаблон. Повторите создание — сохранённая копия будет использована повторно.')}
   finally{if(!signal.aborted)setBusy(false)}
 }
 async function promote(){
   const store=frame.current?.blueprintTemplates;if(!store||!selected||busy||!reason.trim())return
   setBusy(true);setError('');const signal=lifetime.current.signal
   try {
     const key='mnemos-template-promotion:'+JSON.stringify([account,selected.scope_id,selected.template_key,selected.revision,reason])
     let id=sessionStorage.getItem(key);if(!id){id=crypto.randomUUID();sessionStorage.setItem(key,id)}
     await store.selector.promote(selected.scope_id,selected.template_key,selected.revision,reason,id)
     signal.throwIfAborted();sessionStorage.removeItem(key);setPromotion('Предложение отправлено. Шаблон появится на следующем уровне после согласования.')
   }catch{if(!signal.aborted)setError('Отправка не подтверждена. Повторите предложение; исходная версия останется прежней.')}
   finally{if(!signal.aborted)setBusy(false)}
 }
 const parent = scopes.find(item=>item.scope_id===scopes.find(current=>current.scope_id===selected?.scope_id)?.parent_id)
 const selectClass='rounded-lg border border-kumo-line bg-kumo-base px-3 py-2 text-sm text-kumo-default'
 if(settings&&frame.current?.blueprintTemplates)return <TemplateScopeSettings selector={frame.current.blueprintTemplates.selector} onClose={()=>{setSettings(false);setConfigurationRevision(value=>value+1)}}/>
 return <section className="px-3 py-4" aria-label="Общие шаблоны">
   <div className="mb-5 flex flex-wrap items-center gap-3">
     {frame.current?.blueprintTemplates&&<Button disabled={busy||loading} onClick={()=>setSettings(true)}>Настроить уровни</Button>}
     {accounts.length>1&&<select aria-label="Организация" disabled={busy} value={account??''} onChange={e=>setAccount(Number(e.target.value))} className={selectClass}>{accounts.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>}
     {!!scopes.length&&<select aria-label="Уровень применения" disabled={busy} value={scope} onChange={e=>setScope(e.target.value)} className={selectClass}>{scopes.map(item=><option key={item.scope_id} value={item.scope_id}>{levels[item.level]} · {item.name}</option>)}</select>}
   </div>
   {error&&<p role="alert" className="mb-4 text-sm text-kumo-danger">{error}</p>}
   {loading?<p role="status" className="text-sm text-kumo-subtle">Загрузка шаблонов…</p>:!items.length&&<p className="text-sm text-kumo-subtle">{scopes.length?'На этом уровне пока нет утверждённых шаблонов гаджетов.':'Нет доступных уровней общего применения. Администратор может создать их в настройках.'}</p>}
   <div className="space-y-2">{items.map(item=><button type="button" disabled={busy} key={item.scope_id+':'+item.template_key} onClick={()=>{setSelected(item);setError('');setReason('');setPromotion('')}} className="block w-full rounded-xl border border-kumo-line p-4 text-left hover:bg-kumo-tint">
     <span className="block text-sm font-medium">{item.source.title}</span><span className="mt-1 block text-xs text-kumo-subtle">{item.source.purpose}</span><span className="mt-2 block text-xs text-kumo-subtle">Утверждённая версия {item.revision}</span>
   </button>)}</div>
   {cursor&&<Button className="mt-3" disabled={busy} onClick={()=>void more()}>Показать ещё</Button>}
   {selected&&<div className="mt-5 rounded-xl border border-kumo-line p-4">
     <h2 className="text-sm font-medium">Начать работу: {selected.source.title}</h2>
     <p className="my-2 text-xs text-kumo-subtle">Сохраним личную копию шаблона в проекте и откроем рабочий гаджет.</p>
     <div className="flex flex-wrap items-center gap-3"><select aria-label="Проект для рабочей копии" disabled={busy} value={project} onChange={e=>setProject(e.target.value)} className={selectClass}><option value="">Выберите проект</option>{projects.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select><Button variant="primary" disabled={busy||!project} onClick={()=>void create()}>{busy?'Создание…':'Начать работу'}</Button><Button disabled={busy} onClick={()=>setSelected(null)}>Отмена</Button></div>
     {parent&&<details className="mt-4 border-t border-kumo-line pt-3"><summary className="cursor-pointer text-sm text-kumo-subtle">Предложить для более широкого применения</summary>
       <p className="my-2 text-xs text-kumo-subtle">Следующий уровень: {levels[parent.level]} · {parent.name}</p>
       {promotion?<p role="status" className="text-sm">{promotion}</p>:<><label className="block text-sm">Для чего нужен общий шаблон<textarea className="my-2 block w-full rounded-lg border border-kumo-line bg-kumo-base p-2" disabled={busy} value={reason} onChange={e=>setReason(e.target.value)} /></label><Button disabled={busy||!reason.trim()} onClick={()=>void promote()}>{busy?'Отправляем…':'Отправить на согласование'}</Button></>}
     </details>}
   </div>}
 </section>
}
