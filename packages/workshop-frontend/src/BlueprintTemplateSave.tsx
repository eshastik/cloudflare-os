import type {TemplateEditingContext} from './templateEditing'
import type {ChatWorkTemplateChoice} from '@gadgets/workshop-shared/work-template'
import type {ChatWorkTemplate,WorkTemplateKind} from '@gadgets/workshop-shared/work-template'
import {useEffect, useRef, useState} from 'react'
import {WorkshopButton} from './components/WorkshopControls'
import type {RpcStub} from 'capnweb'
import type {GatekeeperUiFrame, GatekeeperBlueprintTemplateCreator, GatekeeperTemplateVersion, GatekeeperTemplateReviewAccess} from '@gadgets/workshop-shared/gatekeeper'
import type {NativeDocumentFormat} from '@gadgets/workshop-shared/native-document'
import type {NativeSnapshotSourceRef} from './nativeSnapshotSource'
import {useAuthenticatedApi} from './AuthContext'
import {listAccounts, storesDocuments, openBlueprintTemplatesFrame} from './accountCapabilities'
import {disposeGatekeeperFrame} from './disposeGatekeeperFrame'
import {uploadGatekeeperBlueprintTemplate, uploadGatekeeperNativeDocument} from './gatekeeperAppUpload'

export default function BlueprintTemplateSave({blueprint, format, snapshotSource, onClose, nativeOnly=false, preferredProject, onUse, initialKind='document',initialTemplate}: {initialTemplate?:{context:TemplateEditingContext;material:ChatWorkTemplateChoice};initialKind?:WorkTemplateKind;onUse?(template:ChatWorkTemplate):void;preferredProject?:{accountId:number|null;projectId:string};nativeOnly?:boolean;blueprint:{id:string;title:string;description:string};format?:NativeDocumentFormat;snapshotSource?:NativeSnapshotSourceRef;onClose():void}) {
  const {authenticatedApi:api} = useAuthenticatedApi()
  const improvement=initialTemplate&&'scope_id' in initialTemplate.context.reference?initialTemplate.context.reference:undefined
  const [explanation,setExplanation]=useState('')
  const [accessPlan,setAccessPlan]=useState<GatekeeperTemplateReviewAccess|null>(null),[accessLoading,setAccessLoading]=useState(false),[accessError,setAccessError]=useState(''),[accessReload,setAccessReload]=useState(0)
  const [accounts,setAccounts] = useState<{id:number;name:string}[]>([])
  const [account,setAccount] = useState<number|null>(null)
  const [contextNotice,setContextNotice]=useState('')
  const preferredAccount=preferredProject?.accountId, preferredScope=preferredProject?.projectId
  const [projects,setProjects] = useState<{id:string;name:string}[]>([])
  const [project,setProject] = useState('')
  const [scopes,setScopes] = useState<{scope_id:string;revision:number;level:string;name:string;enabled:boolean}[]>([])
  const [scope,setScope] = useState(''), [proposed,setProposed] = useState(false), [locked,setLocked] = useState(false)
  const [title,setTitle] = useState(blueprint.title), [purpose,setPurpose] = useState(blueprint.description || blueprint.title)
  const [busy,setBusy] = useState(false), [error,setError] = useState(''), [version,setVersion] = useState<GatekeeperTemplateVersion|null>(null)
  const [accountsLoading,setAccountsLoading]=useState(true)
  const [accountsReload,setAccountsReload]=useState(0),[pendingUnavailable,setPendingUnavailable]=useState(false)
  const [libraryState,setLibraryState]=useState<'idle'|'loading'|'ready'|'error'>('idle')
  const [libraryReload,setLibraryReload]=useState(0)
  const [scopesLoading,setScopesLoading]=useState(false),[scopesError,setScopesError]=useState(''),[scopesReload,setScopesReload]=useState(0)
  const [previous,setPrevious]=useState<{template_id:string;revision:number}|undefined>()
  const frame = useRef<GatekeeperUiFrame|null>(null)
  const creator = useRef<RpcStub<GatekeeperBlueprintTemplateCreator>|null>(null)
  const lifetime = useRef(new AbortController())
  const [kind,setKind] = useState<WorkTemplateKind>(initialKind)
  const sourceKey = initialTemplate&&'template_id' in initialTemplate.context.reference?`native-template:${initialTemplate.context.reference.template_id}`:improvement?`native-improvement:${blueprint.id}:${improvement.scope_id}:${improvement.template_key}:${improvement.revision}`:nativeOnly ? `native-document:${blueprint.id}${kind==='document'?'':':'+kind}` : blueprint.id
  const kinds={document:'Форма документа',guidance:'Методика',agent_instructions:'Инструкция агента',skill:'Навык'}
  const descriptions={document:'Текущее содержимое станет исходной формой для новых документов.',guidance:'Описывает порядок работы и требования к результату. Можно использовать вместе с формой документа.',agent_instructions:'Задаёт поведение агента в выбранной задаче. Инструкция не расширяет его права.',skill:'Описывает выполнение конкретной операции. Выбирается для задач, где эта операция нужна.'}
  const pendingKey = `mnemos-blueprint-save:${sourceKey}`
  useEffect(() => {
    let cancelled = false
    lifetime.current = new AbortController()
    setAccountsLoading(true);setContextNotice('');setPendingUnavailable(false)
    void listAccounts(api).then(items => {
      if(cancelled)return
      const choices=items.filter(storesDocuments).map(item=>({id:item.id,name:item.description.displayName||item.description.uniqueName||item.vendorId}))
      setAccounts(choices);setAccountsLoading(false)
      let saved: {account?:number}|null=null
      try {saved=JSON.parse(sessionStorage.getItem(pendingKey)||'null')} catch {}
      if(saved?.account!==undefined){
        if(choices.some(item=>item.id===saved!.account))setAccount(saved.account)
        else {setAccount(null);setPendingUnavailable(true);setContextNotice('Библиотека начатого сохранения недоступна. Квитанция сохранена; новое сохранение не начато. Восстановите доступ и повторите загрузку.')}
      }else if(preferredAccount!==undefined&&preferredAccount!==null){
        if(choices.some(item=>item.id===preferredAccount))setAccount(preferredAccount)
        else {setAccount(null);setContextNotice('Библиотека документа недоступна. Выберите другую библиотеку явно.')}
      }else if(choices.length===1)setAccount(choices[0].id)
    }).catch(()=>{if(!cancelled){setError('Не удалось прочитать библиотеки.');setAccountsLoading(false)}})
    return()=>{cancelled=true;lifetime.current.abort();creator.current?.[Symbol.dispose]();disposeGatekeeperFrame(frame.current)}
  },[api,pendingKey,preferredAccount,accountsReload])
  useEffect(()=>{
    let cancelled=false
    setProjects([]);setProject('');setScopes([]);setScope('');setError('');setVersion(null);setLocked(false);setProposed(false);setPrevious(undefined)
    creator.current?.[Symbol.dispose]();creator.current=null
    disposeGatekeeperFrame(frame.current);frame.current=null
    if(account===null){setLibraryState('idle');return}
    setContextNotice('')
    setLibraryState('loading')
    void openBlueprintTemplatesFrame(api,account).then(async value=>{
      if(cancelled){disposeGatekeeperFrame(value);return}
      frame.current=value
      const ref=initialTemplate?.context.reference
      const latest=ref?.template_id?{template_id:ref.template_id,revision:ref.revision,project_id:initialTemplate!.context.projectId,title:initialTemplate!.material.title,purpose:initialTemplate!.material.purpose}:improvement?null:await value.blueprintTemplates.selector.latest(sourceKey)
      if(cancelled)return
      if(latest){setPrevious({template_id:latest.template_id,revision:latest.revision});setProject(latest.project_id);setTitle(latest.title);setPurpose(latest.purpose)}
      const result=await value.blueprintTemplates.selector.projects()
      if(cancelled)return
      setProjects(result.projects)
      if(!latest){
        if(preferredScope&&(preferredAccount===null||preferredAccount===account)){
          if(result.projects.some(item=>item.id===preferredScope))setProject(preferredScope)
          else setContextNotice('Проект документа недоступен для сохранения шаблона. Выберите другой проект явно.')
        }else if(result.projects.length===1)setProject(result.projects[0].id)
      }
      let saved:{account:number;id:string}|null=null
      try{saved=JSON.parse(sessionStorage.getItem(pendingKey)||'null')}catch{}
      if(saved?.account===account){
        const resumed=await value.blueprintTemplates.selector.resume(saved.id) as unknown as RpcStub<GatekeeperBlueprintTemplateCreator>
        if(cancelled){resumed[Symbol.dispose]();return}
        creator.current=resumed
        const state=await resumed.state()
        if(cancelled)return
        setProject(state.project);setTitle(state.title);setPurpose(state.purpose);setKind(state.kind??state.version?.kind??'document');setVersion(state.version);setLocked(true);setContextNotice('')
      }
      setLibraryState('ready')
    }).catch(()=>{if(!cancelled){setError('Не удалось открыть библиотеку шаблонов.');setLibraryState('error')}})
    return()=>{cancelled=true}
  },[api,account,libraryReload,sourceKey,preferredAccount,preferredScope])
  useEffect(()=>{
    let cancelled=false;setScopes([]);setScope('');setScopesError('');
    const selector=frame.current?.blueprintTemplates?.selector;
    if(libraryState!=='ready'||!selector){setScopesLoading(false);return}
    setScopesLoading(true)
    void (async()=>{
      const groups:typeof scopes=[];let cursor='';
      do {
        const page=await selector.scopes(cursor);if(cancelled)return;
        groups.push(...page.scopes.filter(item=>item.enabled&&(improvement?item.scope_id===improvement.scope_id:item.level==='group')));cursor=page.next_cursor||'';
      } while(cursor)
      if(!cancelled){setScopes(groups);if(improvement&&groups.length===1)setScope(groups[0].scope_id)}
    })().catch(()=>{if(!cancelled)setScopesError('Не удалось загрузить группы. Личный шаблон можно сохранить и использовать.')}).finally(()=>{if(!cancelled)setScopesLoading(false)})
    return()=>{cancelled=true}
  },[account,libraryState,scopesReload])
  useEffect(()=>{
    let cancelled=false;setAccessPlan(null);setAccessError('');setAccessLoading(false)
    const selected=scopes.find(item=>item.scope_id===scope),operation=creator.current
    if(!version||!selected||!operation)return
    setAccessLoading(true)
    void operation.reviewAccess(selected.scope_id,selected.revision).then(plan=>{if(!cancelled)setAccessPlan(plan)}).catch(()=>{if(!cancelled)setAccessError('Не удалось проверить согласующих и их доступ. Повторите проверку; отправка пока недоступна.')}).finally(()=>{if(!cancelled)setAccessLoading(false)})
    return()=>{cancelled=true}
  },[scope,scopes,version,accessReload])
  async function shareForReview(){
    const selected=scopes.find(item=>item.scope_id===scope),operation=creator.current
    if(busy||!selected||!operation||!accessPlan)return
    setBusy(true);setAccessError('')
    try{const plan=await operation.shareForReview(selected.scope_id,selected.revision,accessPlan.key);if(!lifetime.current.signal.aborted)setAccessPlan(plan)}
    catch{if(!lifetime.current.signal.aborted){setAccessPlan(null);setAccessError('Доступ не подтверждён. Проверьте состояние перед повтором; приглашения, которые успели сохраниться, сохраняются.')}}
    finally{if(!lifetime.current.signal.aborted)setBusy(false)}
  }
  async function save(){
    if(busy||pendingUnavailable||libraryState!=='ready'||account===null||!frame.current?.blueprintTemplates)return
    setBusy(true);setError('')
    const signal=lifetime.current.signal
    try {
      const store=frame.current.blueprintTemplates
      let saved:{account:number;id:string}|null=null
      try{saved=JSON.parse(sessionStorage.getItem(pendingKey)||'null')}catch{}
      if(!creator.current){
        if(saved?.account===account)creator.current=await store.selector.resume(saved.id) as RpcStub<GatekeeperBlueprintTemplateCreator>
        else {
          const prepared=nativeOnly
            ? improvement?await store.selector.prepare(project,title,purpose,previous,sourceKey,"cloudflareos.document",kind,improvement):await store.selector.prepare(project,title,purpose,previous,sourceKey,"cloudflareos.document",kind)
            : await store.selector.prepare(project,title,purpose,previous,sourceKey)
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
        let upload:string
        const issue=async(size:number,checksum:string)=>operation.issue(size,checksum)
        if(nativeOnly){
          if(!snapshot||snapshot.format!=="cloudflareos.document"||new TextEncoder().encode(JSON.stringify(snapshot)).length>1024*1024)throw Error("Поддерживается документ до одного МиБ")
          upload=await uploadGatekeeperNativeDocument(snapshot,"cloudflareos.document",store.storageOrigin,issue,signal)
        }else{
          const stream=await api.captureBlueprintTemplate(blueprint.id,snapshot)
          const bytes=new Uint8Array(await new Response(stream).arrayBuffer())
          upload=await uploadGatekeeperBlueprintTemplate(bytes,store.storageOrigin,issue,signal)
        }
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
    if(busy||!selected||!creator.current||!accessPlan||accessPlan.reviewers.some(p=>!p.canRead))return
    setBusy(true);setError('')
    try{await creator.current.propose(selected.scope_id,selected.revision,improvement?explanation:undefined,accessPlan.key);setProposed(true);sessionStorage.removeItem(pendingKey)}
    catch{setAccessPlan(null);setAccessError('Предложение не подтверждено. Сначала повторите проверку доступа и правил.');setError('Повтор отправки продолжит прежнее предложение.')}
    finally{setBusy(false)}
  }
  const field='mt-1 block w-full rounded-lg border border-kumo-line bg-kumo-base px-3 py-2 text-[13px] disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-kumo-brand'
  return <section aria-label="Версия рабочего шаблона" className="space-y-4 p-1">
    <div><h3 className="m-0 text-[17px] font-medium">{version?'Шаблон сохранён':previous?'Новая версия шаблона':'Сохранить личный шаблон'}</h3><p className="mt-1 text-[13px] leading-5 text-kumo-subtle">{nativeOnly?descriptions[kind]:format?'Текущее содержимое станет исходной версией для новых документов.':'Сохраните гаджет и его содержимое для следующих задач.'}</p></div>
    {accountsLoading&&<p role="status" className="text-[13px] text-kumo-subtle">Загрузка библиотек…</p>}
    {!accountsLoading&&!accounts.length&&!error&&<p className="text-[13px] text-kumo-subtle">Нет доступной библиотеки для сохранения шаблона.</p>}
    {contextNotice&&<p role="status" className="text-[13px] text-kumo-subtle">{contextNotice}</p>}
    {libraryState==='loading'&&<p role="status" className="text-[13px] text-kumo-subtle">Подготовка сохранения…</p>}
    {version?<div className="space-y-4">
      <div className="rounded-xl border border-kumo-line bg-kumo-tint p-3"><p role="status" className="m-0 text-[14px] font-medium">Личный шаблон сохранён: {version.title}, версия {version.revision}.</p><p className="mt-1 text-[13px] text-kumo-subtle">Выберите его в чате через «Выбрать шаблон» для следующей задачи.</p>{onUse&&account!==null&&<WorkshopButton className="mt-3" tone="primary" onClick={()=>onUse({accountId:account,reference:{template_id:version.template_id,revision:version.revision},title:version.title,purpose:version.purpose,kind:version.kind??kind})}>Использовать в задаче</WorkshopButton>}</div>
      <div className="rounded-xl border border-kumo-line p-3"><h4 className="m-0 text-[14px] font-medium">{improvement?'Предложить улучшение':'Предложить команде'}</h4>
       {proposed?<p role="status" className="mt-2 text-[13px]">{improvement?'Правка отправлена на согласование. После одобрения появится новая общая версия; прежняя сохранится.':'Версия отправлена на согласование. Общий шаблон появится после одобрения.'}</p>:<div className="mt-2 space-y-3">
        <p className="text-[13px] leading-5 text-kumo-subtle">{improvement?`Правка общей версии ${improvement.revision}. После согласования появится новая версия исходного общего шаблона.`:'Личная версия уже доступна вам. Для общего применения выберите группу и отправьте эту версию на согласование.'}</p>
        {scopesLoading&&<p role="status" className="text-[13px] text-kumo-subtle">{improvement?'Загрузка области согласования…':'Загрузка групп…'}</p>}
        {scopesError&&<p role="alert" className="text-[13px] text-kumo-subtle">{scopesError} <WorkshopButton disabled={busy||scopesLoading} onClick={()=>setScopesReload(v=>v+1)}>Повторить загрузку групп</WorkshopButton></p>}
        {!scopesLoading&&!scopesError&&!scopes.length&&<p className="text-[13px] text-kumo-subtle">{improvement?'Исходная область согласования недоступна. Правка сохранена только для вас.':'Доступных групп для согласования пока нет. Шаблон остаётся личным.'}</p>}
        {improvement&&<label className="block text-[13px]">Что изменено и почему<textarea aria-label="Объяснение улучшения" rows={3} className={field} disabled={busy} value={explanation} onChange={e=>setExplanation(e.target.value)}/></label>}
        {scopes.length>0&&<><label className="block text-[13px]">{improvement?'Область согласования':'Группа для согласования'}<select className={field} disabled={busy||scopesLoading||!!improvement} value={scope} onChange={e=>setScope(e.target.value)}><option value="">Выберите группу</option>{scopes.map(item=><option key={item.scope_id} value={item.scope_id}>{item.name}</option>)}</select></label>{scope&&<div className="space-y-2 text-[13px]">
          {accessLoading&&<p role="status">Проверяем согласующих…</p>}
          {accessPlan&&<><p className="m-0">Согласующие: {accessPlan.reviewers.map(person=>person.name).join(', ')}.</p>
            {accessPlan.reviewers.some(person=>!person.canRead)?<><p className="m-0 text-kumo-subtle">Перед отправкой им нужно открыть сохранённый документ шаблона. Приглашение даёт только чтение этого документа. Папка и другие документы остаются по своим правам.</p><WorkshopButton disabled={busy||accessLoading} onClick={()=>void shareForReview()}>Дать согласующим доступ к шаблону</WorkshopButton></>:<p role="status" className="m-0 text-kumo-subtle">Согласующие могут прочитать документ шаблона.</p>}</>}
          {accessError&&<><p role="alert" className="m-0 text-kumo-danger">{accessError}</p><WorkshopButton disabled={busy||accessLoading} onClick={()=>setAccessReload(v=>v+1)}>Проверить доступ согласующих</WorkshopButton></>}
        </div>}<WorkshopButton tone="primary" disabled={busy||!scope||scopesLoading||accessLoading||!accessPlan||accessPlan.reviewers.some(person=>!person.canRead)||!!improvement&&!explanation.trim()} onClick={()=>void propose()}>{busy?'Отправляем…':improvement?'Отправить улучшение на согласование':'Предложить для общего применения'}</WorkshopButton></>}
       </div>}
      </div>
      <WorkshopButton disabled={busy} onClick={()=>{setPrevious({template_id:version.template_id,revision:version.revision});sessionStorage.removeItem(pendingKey);creator.current?.[Symbol.dispose]();creator.current=null;setVersion(null);setLocked(false);setProposed(false);setScope('');}}>Сохранить новую версию</WorkshopButton>
    </div>:<fieldset disabled={busy||accountsLoading||libraryState==='loading'} className="space-y-3 border-0 p-0">
      {(accounts.length!==1||account===null)&&<label className="block text-[13px]">Библиотека<select className={field} disabled={locked||pendingUnavailable} value={account??''} onChange={e=>setAccount(e.target.value===''?null:Number(e.target.value))}><option value="">Выберите библиотеку</option>{accounts.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      <label className="block text-[13px]">Проект<select className={field} disabled={locked||libraryState!=='ready'} value={project} onChange={e=>{setProject(e.target.value);setContextNotice('')}}><option value="">Выберите проект</option>{locked&&project&&!projects.some(item=>item.id===project)&&<option value={project}>Проект начатого сохранения</option>}{projects.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      {nativeOnly&&<label className="block text-[13px]">Вид шаблона<select aria-label="Вид шаблона" className={field} disabled={locked||libraryState!=='ready'||!!initialTemplate} value={kind} onChange={e=>setKind(e.target.value as WorkTemplateKind)}>{Object.entries(kinds).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>}
      <label className="block text-[13px]">Название<input className={field} disabled={locked||libraryState!=='ready'} value={title} onChange={e=>setTitle(e.target.value)}/></label>
      <label className="block text-[13px]">Для каких задач<textarea rows={2} className={field} disabled={locked||libraryState!=='ready'} value={purpose} onChange={e=>setPurpose(e.target.value)}/></label>
      {previous&&<p className="text-[12px] text-kumo-subtle">Будет создана новая версия. Ранее созданные документы сохранят использованную версию.</p>}
      <WorkshopButton tone="primary" disabled={libraryState!=='ready'||!project||!title.trim()||!purpose.trim()} onClick={()=>void save()}>{busy?'Сохраняем…':previous?'Сохранить изменения шаблона':'Сохранить личный шаблон'}</WorkshopButton>
      <p className="text-[12px] text-kumo-subtle">Сохранение не отправляет шаблон на согласование. Это отдельный шаг.</p>
    </fieldset>}
    {error&&<p role="alert" className="text-[13px] text-kumo-danger">{error}</p>}
    {pendingUnavailable&&<WorkshopButton disabled={accountsLoading} onClick={()=>setAccountsReload(v=>v+1)}>Повторить загрузку библиотек</WorkshopButton>}
    {libraryState==='error'&&<WorkshopButton onClick={()=>setLibraryReload(v=>v+1)}>Повторить загрузку библиотеки</WorkshopButton>}
    <WorkshopButton disabled={busy} onClick={onClose}>{nativeOnly?'Закрыть':'Назад к шаблонам'}</WorkshopButton>
  </section>
}
