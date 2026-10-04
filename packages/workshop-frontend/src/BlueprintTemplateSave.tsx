import {useEffect, useRef, useState} from 'react'
import {WorkshopButton} from './components/WorkshopControls'
import type {RpcStub} from 'capnweb'
import type {GatekeeperUiFrame, GatekeeperBlueprintTemplateCreator, GatekeeperTemplateVersion} from '@gadgets/workshop-shared/gatekeeper'
import type {NativeDocumentFormat} from '@gadgets/workshop-shared/native-document'
import type {NativeSnapshotSourceRef} from './nativeSnapshotSource'
import {useAuthenticatedApi} from './AuthContext'
import {listAccounts, storesDocuments, openBlueprintTemplatesFrame} from './accountCapabilities'
import {disposeGatekeeperFrame} from './disposeGatekeeperFrame'
import {uploadGatekeeperBlueprintTemplate} from './gatekeeperAppUpload'

export default function BlueprintTemplateSave({blueprint, format, snapshotSource, onClose}: {blueprint:{id:string;title:string;description:string};format?:NativeDocumentFormat;snapshotSource?:NativeSnapshotSourceRef;onClose():void}) {
  const {authenticatedApi:api} = useAuthenticatedApi()
  const [accounts,setAccounts] = useState<{id:number;name:string}[]>([])
  const [account,setAccount] = useState<number|null>(null)
  const [projects,setProjects] = useState<{id:string;name:string}[]>([])
  const [project,setProject] = useState('')
  const [scopes,setScopes] = useState<{scope_id:string;revision:number;level:string;name:string;enabled:boolean}[]>([])
  const [scope,setScope] = useState(''), [proposed,setProposed] = useState(false), [locked,setLocked] = useState(false)
  const [title,setTitle] = useState(blueprint.title), [purpose,setPurpose] = useState(blueprint.description || blueprint.title)
  const [busy,setBusy] = useState(false), [error,setError] = useState(''), [version,setVersion] = useState<GatekeeperTemplateVersion|null>(null)
  const [accountsLoading,setAccountsLoading]=useState(true)
  const [libraryState,setLibraryState]=useState<'idle'|'loading'|'ready'|'error'>('idle')
  const [libraryReload,setLibraryReload]=useState(0)
  const [scopesLoading,setScopesLoading]=useState(false),[scopesError,setScopesError]=useState(''),[scopesReload,setScopesReload]=useState(0)
  const [previous,setPrevious]=useState<{template_id:string;revision:number}|undefined>()
  const frame = useRef<GatekeeperUiFrame|null>(null)
  const creator = useRef<RpcStub<GatekeeperBlueprintTemplateCreator>|null>(null)
  const lifetime = useRef(new AbortController())
  const pendingKey = `mnemos-blueprint-save:${blueprint.id}`
  useEffect(() => {
    let cancelled = false
    lifetime.current = new AbortController()
    void listAccounts(api).then(items => {
      if(cancelled)return
      const choices=items.filter(storesDocuments).map(item=>({id:item.id,name:item.description.displayName||item.description.uniqueName||item.vendorId}))
      setAccounts(choices);setAccountsLoading(false)
      let saved: {account?:number}|null=null
      try {saved=JSON.parse(sessionStorage.getItem(pendingKey)||'null')} catch {}
      if(saved?.account!==undefined&&choices.some(item=>item.id===saved!.account))setAccount(saved.account)
      else if(choices.length===1)setAccount(choices[0].id)
    }).catch(()=>{if(!cancelled){setError('Не удалось прочитать библиотеки.');setAccountsLoading(false)}})
    return()=>{cancelled=true;lifetime.current.abort();creator.current?.[Symbol.dispose]();disposeGatekeeperFrame(frame.current)}
  },[api,pendingKey])
  useEffect(()=>{
    let cancelled=false
    setProjects([]);setProject('');setScopes([]);setScope('');setError('');setVersion(null);setLocked(false);setProposed(false);setPrevious(undefined)
    creator.current?.[Symbol.dispose]();creator.current=null
    disposeGatekeeperFrame(frame.current);frame.current=null
    if(account===null){setLibraryState('idle');return}
    setLibraryState('loading')
    void openBlueprintTemplatesFrame(api,account).then(async value=>{
      if(cancelled){disposeGatekeeperFrame(value);return}
      frame.current=value
      const latest=await value.blueprintTemplates.selector.latest(blueprint.id)
      if(cancelled)return
      if(latest){setPrevious({template_id:latest.template_id,revision:latest.revision});setProject(latest.project_id);setTitle(latest.title);setPurpose(latest.purpose)}
      const result=await value.blueprintTemplates.selector.projects()
      if(cancelled)return
      setProjects(result.projects)
      if(!latest&&result.projects.length===1)setProject(result.projects[0].id)
      let saved:{account:number;id:string}|null=null
      try{saved=JSON.parse(sessionStorage.getItem(pendingKey)||'null')}catch{}
      if(saved?.account===account){
        const resumed=await value.blueprintTemplates.selector.resume(saved.id) as unknown as RpcStub<GatekeeperBlueprintTemplateCreator>
        if(cancelled){resumed[Symbol.dispose]();return}
        creator.current=resumed
        const state=await resumed.state()
        if(cancelled)return
        setProject(state.project);setTitle(state.title);setPurpose(state.purpose);setVersion(state.version);setLocked(true)
      }
      setLibraryState('ready')
    }).catch(()=>{if(!cancelled){setError('Не удалось открыть библиотеку шаблонов.');setLibraryState('error')}})
    return()=>{cancelled=true}
  },[api,account,libraryReload])
  useEffect(()=>{
    let cancelled=false;setScopes([]);setScope('');setScopesError('');
    const selector=frame.current?.blueprintTemplates?.selector;
    if(libraryState!=='ready'||!selector){setScopesLoading(false);return}
    setScopesLoading(true)
    void (async()=>{
      const groups:typeof scopes=[];let cursor='';
      do {
        const page=await selector.scopes(cursor);if(cancelled)return;
        groups.push(...page.scopes.filter(item=>item.enabled&&item.level==='group'));cursor=page.next_cursor||'';
      } while(cursor)
      if(!cancelled)setScopes(groups)
    })().catch(()=>{if(!cancelled)setScopesError('Не удалось загрузить группы. Личный шаблон можно сохранить и использовать.')}).finally(()=>{if(!cancelled)setScopesLoading(false)})
    return()=>{cancelled=true}
  },[account,libraryState,scopesReload])
  async function save(){
    if(busy||libraryState!=='ready'||account===null||!frame.current?.blueprintTemplates)return
    setBusy(true);setError('')
    const signal=lifetime.current.signal
    try {
      const store=frame.current.blueprintTemplates
      let saved:{account:number;id:string}|null=null
      try{saved=JSON.parse(sessionStorage.getItem(pendingKey)||'null')}catch{}
      if(!creator.current){
        if(saved?.account===account)creator.current=await store.selector.resume(saved.id) as RpcStub<GatekeeperBlueprintTemplateCreator>
        else {
          const prepared=await store.selector.prepare(project,title,purpose,previous,blueprint.id)
          creator.current=prepared.creator as RpcStub<GatekeeperBlueprintTemplateCreator>
          sessionStorage.setItem(pendingKey,JSON.stringify({account,id:prepared.id}));setLocked(true)
        }
      }
      signal.throwIfAborted()
      const operation=creator.current
      if(!operation)throw Error("Операция не найдена")
      const state=await operation.state()
      if(!state.upload){
        const snapshot=format ? await snapshotSource?.current?.(format,signal) : undefined
        if(format&&!snapshot)throw Error('Редактор ещё не готов')
        const stream=await api.captureBlueprintTemplate(blueprint.id,snapshot)
        const bytes=new Uint8Array(await new Response(stream).arrayBuffer())
        const upload=await uploadGatekeeperBlueprintTemplate(bytes,store.storageOrigin,async(size,checksum)=>operation.issue(size,checksum),signal)
        await operation.checkpoint(upload)
      }
      signal.throwIfAborted()
      const result=await operation.save()
      signal.throwIfAborted();setVersion(result)
    }catch{if(!signal.aborted)setError('Сохранение не подтверждено. Повтор продолжит ту же операцию.')}
    finally{if(!signal.aborted)setBusy(false)}
  }
  async function propose(){
    const selected=scopes.find(item=>item.scope_id===scope)
    if(busy||!selected||!creator.current)return
    setBusy(true);setError('')
    try{await creator.current.propose(selected.scope_id,selected.revision);setProposed(true);sessionStorage.removeItem(pendingKey)}
    catch{setError('Предложение не подтверждено. Повторите отправку; права и правила согласования проверяет сервер.')}
    finally{setBusy(false)}
  }
  const field='mt-1 block w-full rounded-lg border border-kumo-line bg-kumo-base px-3 py-2 text-[13px] disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-kumo-brand'
  return <section aria-label="Версия рабочего шаблона" className="space-y-4 p-1">
    <div><h3 className="m-0 text-[17px] font-medium">{version?'Шаблон сохранён':previous?'Новая версия шаблона':'Сохранить личный шаблон'}</h3><p className="mt-1 text-[13px] leading-5 text-kumo-subtle">{format?'Текущее содержимое станет исходной версией для новых документов.':'Сохраните гаджет и его содержимое для следующих задач.'}</p></div>
    {accountsLoading&&<p role="status" className="text-[13px] text-kumo-subtle">Загрузка библиотек…</p>}
    {!accountsLoading&&!accounts.length&&!error&&<p className="text-[13px] text-kumo-subtle">Нет доступной библиотеки для сохранения шаблона.</p>}
    {libraryState==='loading'&&<p role="status" className="text-[13px] text-kumo-subtle">Подготовка сохранения…</p>}
    {version?<div className="space-y-4">
      <div className="rounded-xl border border-kumo-line bg-kumo-tint p-3"><p role="status" className="m-0 text-[14px] font-medium">Личный шаблон сохранён: {version.title}, версия {version.revision}.</p><p className="mt-1 text-[13px] text-kumo-subtle">Выберите его в чате через «Выбрать шаблон» для следующей задачи.</p></div>
      <div className="rounded-xl border border-kumo-line p-3"><h4 className="m-0 text-[14px] font-medium">Предложить команде</h4>
       {proposed?<p role="status" className="mt-2 text-[13px]">Версия отправлена на согласование. Общий шаблон появится после одобрения.</p>:<div className="mt-2 space-y-3">
        <p className="text-[13px] leading-5 text-kumo-subtle">Личная версия уже доступна вам. Для общего применения выберите группу и отправьте эту версию на согласование.</p>
        {scopesLoading&&<p role="status" className="text-[13px] text-kumo-subtle">Загрузка групп…</p>}
        {scopesError&&<p role="alert" className="text-[13px] text-kumo-subtle">{scopesError} <WorkshopButton disabled={busy||scopesLoading} onClick={()=>setScopesReload(v=>v+1)}>Повторить загрузку групп</WorkshopButton></p>}
        {!scopesLoading&&!scopesError&&!scopes.length&&<p className="text-[13px] text-kumo-subtle">Доступных групп для согласования пока нет. Шаблон остаётся личным.</p>}
        {scopes.length>0&&<><label className="block text-[13px]">Группа для согласования<select className={field} disabled={busy||scopesLoading} value={scope} onChange={e=>setScope(e.target.value)}><option value="">Выберите группу</option>{scopes.map(item=><option key={item.scope_id} value={item.scope_id}>{item.name}</option>)}</select></label><WorkshopButton tone="primary" disabled={busy||!scope||scopesLoading} onClick={()=>void propose()}>{busy?'Отправляем…':'Предложить для общего применения'}</WorkshopButton></>}
       </div>}
      </div>
      <WorkshopButton disabled={busy} onClick={()=>{setPrevious({template_id:version.template_id,revision:version.revision});sessionStorage.removeItem(pendingKey);creator.current?.[Symbol.dispose]();creator.current=null;setVersion(null);setLocked(false);setProposed(false);setScope('');}}>Сохранить новую версию</WorkshopButton>
    </div>:<fieldset disabled={busy||accountsLoading||libraryState==='loading'} className="space-y-3 border-0 p-0">
      {accounts.length!==1&&<label className="block text-[13px]">Библиотека<select className={field} disabled={locked} value={account??''} onChange={e=>setAccount(e.target.value===''?null:Number(e.target.value))}><option value="">Выберите библиотеку</option>{accounts.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      <label className="block text-[13px]">Проект<select className={field} disabled={locked||libraryState!=='ready'} value={project} onChange={e=>setProject(e.target.value)}><option value="">Выберите проект</option>{projects.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label className="block text-[13px]">Название<input className={field} disabled={locked||libraryState!=='ready'} value={title} onChange={e=>setTitle(e.target.value)}/></label>
      <label className="block text-[13px]">Для каких задач<textarea rows={2} className={field} disabled={locked||libraryState!=='ready'} value={purpose} onChange={e=>setPurpose(e.target.value)}/></label>
      {previous&&<p className="text-[12px] text-kumo-subtle">Будет создана новая версия. Ранее созданные документы сохранят использованную версию.</p>}
      <WorkshopButton tone="primary" disabled={libraryState!=='ready'||!project||!title.trim()||!purpose.trim()} onClick={()=>void save()}>{busy?'Сохраняем…':previous?'Сохранить изменения шаблона':'Сохранить личный шаблон'}</WorkshopButton>
      <p className="text-[12px] text-kumo-subtle">Сохранение не отправляет шаблон на согласование. Это отдельный шаг.</p>
    </fieldset>}
    {error&&<p role="alert" className="text-[13px] text-kumo-danger">{error}</p>}
    {libraryState==='error'&&<WorkshopButton onClick={()=>setLibraryReload(v=>v+1)}>Повторить загрузку библиотеки</WorkshopButton>}
    <WorkshopButton disabled={busy} onClick={onClose}>Назад к шаблонам</WorkshopButton>
  </section>
}
