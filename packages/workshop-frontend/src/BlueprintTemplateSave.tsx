import {useEffect, useRef, useState} from 'react'
import {Button} from '@cloudflare/kumo'
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
      setAccounts(choices)
      let saved: {account?:number}|null=null
      try {saved=JSON.parse(sessionStorage.getItem(pendingKey)||'null')} catch {}
      if(saved?.account!==undefined&&choices.some(item=>item.id===saved!.account))setAccount(saved.account)
      else if(choices.length===1)setAccount(choices[0].id)
    }).catch(()=>{if(!cancelled)setError('Не удалось прочитать подключения.')})
    return()=>{cancelled=true;lifetime.current.abort();creator.current?.[Symbol.dispose]();disposeGatekeeperFrame(frame.current)}
  },[api,pendingKey])
  useEffect(()=>{
    let cancelled=false
    setProjects([]);setProject('');setScopes([]);setScope('');setError('');setVersion(null);setLocked(false);setProposed(false);setPrevious(undefined)
    creator.current?.[Symbol.dispose]();creator.current=null
    disposeGatekeeperFrame(frame.current);frame.current=null
    if(account===null)return
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
      const groups: typeof scopes = []
      let cursor = ''
      do {
        const page = await value.blueprintTemplates.selector.scopes(cursor)
        if(cancelled)return
        groups.push(...page.scopes.filter(item=>item.enabled && item.level === 'group'))
        cursor = page.next_cursor || ''
      } while(cursor)
      setScopes(groups)
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
    }).catch(()=>{if(!cancelled)setError('Не удалось открыть библиотеку шаблонов.')})
    return()=>{cancelled=true}
  },[api,account])
  async function save(){
    if(busy||account===null||!frame.current?.blueprintTemplates)return
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
  const field='mt-1 block w-full rounded-lg border border-kumo-line bg-kumo-base px-3 py-2 text-sm'
  return <section aria-label="Версия рабочего шаблона" className="space-y-4 rounded-xl border border-kumo-line p-4">
    <h3 className="m-0 text-base font-semibold">Рабочий шаблон «{blueprint.title}»</h3>
    <p className="text-sm text-kumo-subtle">Сохраните код гаджета и содержимое документа как одну версию.</p>
    {version?<div className="space-y-3"><p role="status">Личный шаблон сохранён: {version.title}, версия {version.revision}.</p>
      {proposed?<p role="status">Версия отправлена на согласование. Общий шаблон появится после одобрения.</p>:<>
        <p className="text-xs text-kumo-subtle">Сначала предложите шаблон группе. После одобрения его можно предложить отделу, затем организации.</p>
        {!scopes.length&&<p className="text-sm text-kumo-subtle">Доступных групп для согласования пока нет. Шаблон остаётся личным.</p>}
        <label className="block text-sm">Группа для согласования<select className={field} disabled={busy} value={scope} onChange={e=>setScope(e.target.value)}><option value="">Оставить личным</option>{scopes.map(item=><option key={item.scope_id} value={item.scope_id}>{{group:'Группа',department:'Отдел',organization:'Организация'}[item.level]} · {item.name}</option>)}</select></label>
        {scope&&<Button disabled={busy} onClick={()=>void propose()}>{busy?'Отправляем…':'Предложить для общего применения'}</Button>}
      </>}
      <Button variant="secondary" disabled={busy} onClick={()=>{setPrevious({template_id:version.template_id,revision:version.revision});sessionStorage.removeItem(pendingKey);creator.current?.[Symbol.dispose]();creator.current=null;setVersion(null);setLocked(false);setProposed(false);setScope('');}}>Сохранить новую версию</Button>
    </div>:<fieldset disabled={busy} className="space-y-3 border-0 p-0">
      {accounts.length!==1&&<label className="block text-sm">Организация<select className={field} value={account??''} onChange={e=>setAccount(e.target.value===''?null:Number(e.target.value))}><option value="">Выберите организацию</option>{accounts.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      <label className="block text-sm">Проект<select className={field} disabled={locked} value={project} onChange={e=>setProject(e.target.value)}><option value="">Выберите проект</option>{projects.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label className="block text-sm">Название<input className={field} disabled={locked} value={title} onChange={e=>setTitle(e.target.value)}/></label>
      <label className="block text-sm">Для каких задач<input className={field} disabled={locked} value={purpose} onChange={e=>setPurpose(e.target.value)}/></label>
      <Button disabled={!project||!title.trim()||!purpose.trim()} onClick={()=>void save()}>{busy?'Сохраняем…':previous?'Сохранить изменения шаблона':'Сохранить личный шаблон'}</Button>
    </fieldset>}
    {error&&<p role="alert" className="text-sm text-kumo-danger">{error}</p>}
    <Button variant="ghost" disabled={busy} onClick={onClose}>Назад к шаблонам</Button>
  </section>
}
