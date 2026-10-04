import {useEffect,useState} from 'react'
import {Button} from '@cloudflare/kumo'
import type {GatekeeperBlueprintTemplates,GatekeeperTemplateScopeConfig} from '@gadgets/workshop-shared/gatekeeper'

type Configuration=Awaited<ReturnType<GatekeeperBlueprintTemplates['configuration']>>
type Scope=Configuration['scopes'][number]
const levels={organization:'Организация',department:'Отдел',group:'Группа'}
export default function TemplateScopeSettings({selector,onClose}:{selector:Pick<GatekeeperBlueprintTemplates,'configuration'|'configure'>;onClose():void}){
 const [data,setData]=useState<Configuration|null>(null),[editing,setEditing]=useState<Scope|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[uncertain,setUncertain]=useState(false),[reload,setReload]=useState(0),[query,setQuery]=useState('')
 useEffect(()=>{let active=true;setBusy(true);setData(null);setEditing(null);setNotice('');setUncertain(false)
   void selector.configuration().then(value=>{if(active)setData(value)}).catch(()=>{if(active)setNotice('Настройка недоступна. Нужны права управления шаблонами, сотрудниками и группами.')}).finally(()=>{if(active)setBusy(false)})
   return()=>{active=false}
 },[selector,reload])
 const parentLevel=editing?.level==='group'?'department':'organization'
 const parents=data?.scopes.filter(item=>item.enabled&&item.level===parentLevel&&item.scope_id!==editing?.scope_id)||[]
 async function save(){
   if(!editing||busy||uncertain||invalidRequirements)return
   setBusy(true);setNotice('')
   const {scope_id,revision,...config}=editing
   try{const saved=await selector.configure(scope_id,revision,config);setEditing(saved);setData(old=>old?{...old,scopes:[...old.scopes.filter(item=>item.scope_id!==saved.scope_id),saved]}:old);setNotice('Настройки сохранены')}
   catch{setUncertain(true);setNotice('Ответ не получен. Перечитайте настройки перед следующей правкой.')}
   finally{setBusy(false)}
 }
 function change(patch:Partial<GatekeeperTemplateScopeConfig>){setEditing(old=>old?{...old,...patch}:old)}
 const requirements=editing?.review_requirements??[]
 const invalidRequirements=requirements.length>32||requirements.reduce((count,item)=>count+item.approvers.length,0)>100||requirements.some(item=>!item.domain_id.trim()||new TextEncoder().encode(item.domain_id).length>255||!item.approvers.length)||new Set(requirements.map(item=>item.domain_id.trim())).size!==requirements.length
 function requirement(index:number,patch:Partial<(typeof requirements)[number]>){change({review_requirements:requirements.map((item,i)=>i===index?{...item,...patch}:item)})}
 const field='mt-1 block w-full rounded-lg border border-kumo-line bg-kumo-base px-3 py-2 text-sm'
 return <section className="space-y-4 rounded-xl border border-kumo-line p-4" aria-label="Уровни применения шаблонов">
   <div className="flex items-center justify-between gap-3"><h2 className="text-base font-medium">Уровни применения</h2><Button disabled={busy} onClick={onClose}>Назад</Button></div>
   <p className="text-sm text-kumo-subtle">Организация → отдел → группа. На каждом уровне назначаются свои читатели и согласующие.</p>
   {notice&&<p role="status" className="text-sm">{notice}</p>}
   {busy&&!data&&<p role="status">Загрузка настроек…</p>}
   {uncertain&&<Button disabled={busy} onClick={()=>setReload(value=>value+1)}>Перечитать настройки</Button>}
   {data&&!editing&&<><div className="space-y-1">{data.scopes.map(item=><button type="button" key={item.scope_id} onClick={()=>{setEditing({...item,approvers:[...item.approvers]});setNotice('');setQuery('')}} className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-kumo-tint">{item.name}<span className="ml-2 text-xs text-kumo-subtle">{levels[item.level]}{item.enabled?'':' · выключена'}</span></button>)}</div>
     {!data.scopes.length&&<p className="text-sm text-kumo-subtle">Создайте область организации, затем отделы и группы.</p>}
     <Button onClick={()=>{setEditing({scope_id:crypto.randomUUID(),revision:0,level:'organization',name:'',parent_id:'',reader_group_id:'',approvers:[],enabled:true});setQuery('')}}>Создать уровень</Button>
   </>}
   {data&&editing&&<form onSubmit={event=>{event.preventDefault();void save()}} className="space-y-4">
     <fieldset disabled={busy||uncertain} className="space-y-4">
       <label className="block text-sm">Название<input required className={field} value={editing.name} onChange={e=>change({name:e.target.value})}/></label>
       <label className="block text-sm">Уровень<select className={field} disabled={editing.revision>0} value={editing.level} onChange={e=>change({level:e.target.value as Scope['level'],parent_id:'',reader_group_id:''})}>{Object.entries(levels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
       {editing.level!=='organization'&&<><label className="block text-sm">{editing.level==='group'?'В каком отделе':'В какой организации'}<select required className={field} value={editing.parent_id} onChange={e=>change({parent_id:e.target.value})}><option value="">Выберите область</option>{parents.map(item=><option key={item.scope_id} value={item.scope_id}>{item.name}</option>)}</select></label>
       <label className="block text-sm">Кому доступны шаблоны<select required className={field} value={editing.reader_group_id} onChange={e=>change({reader_group_id:e.target.value})}><option value="">Выберите группу сотрудников</option>{data.groups.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label></>}
       <div><p className="text-sm">Кто разрешает общее применение</p><input aria-label="Найти согласующего" className={field} placeholder="Найти сотрудника…" value={query} onChange={e=>setQuery(e.target.value)}/><div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-kumo-line p-2">{data.people.filter(item=>item.name.toLocaleLowerCase('ru').includes(query.toLocaleLowerCase('ru'))).map(item=><label key={item.id} className="flex items-center gap-2 p-2 text-sm"><input type="checkbox" checked={editing.approvers.includes(item.id)} onChange={e=>change({approvers:e.target.checked?[...editing.approvers,item.id]:editing.approvers.filter(id=>id!==item.id)})}/>{item.name}</label>)}</div>{editing.approvers.filter(id=>!data.people.some(person=>person.id===id)).map(id=><div key={id} className="mt-2 flex items-center justify-between gap-2 text-sm"><span title={id}>Сотрудник больше недоступен</span><Button type="button" onClick={()=>change({approvers:editing.approvers.filter(value=>value!==id)})}>Убрать из согласующих</Button></div>)}<p className="mt-1 text-xs text-kumo-subtle">Выбрано: {editing.approvers.length}</p></div>
       <section aria-label="Согласование содержания" className="space-y-3 rounded-lg border border-kumo-line p-3">
         <h3 className="text-sm font-medium">Кто проверяет содержание</h3>
         <p className="text-xs text-kumo-subtle">Каждый назначенный сотрудник согласует свою часть. Эти решения обязательны перед разрешением общего применения. Автор не согласует собственный материал.</p>
         {data.scopes.filter(item=>item.scope_id===editing.parent_id).map(item=><p key={item.scope_id} className="text-xs text-kumo-subtle">Требования родительской области «{item.name}» также применяются. Здесь задаются дополнительные направления этого уровня.</p>)}
         {requirements.map((item,index)=><fieldset key={index} aria-label={'Направление '+(index+1)} className="space-y-2 rounded-lg border border-kumo-line p-3">
           <label className="block text-sm">Название направления<input required aria-label={'Название направления '+(index+1)} className={field} value={item.domain_id} onChange={e=>requirement(index,{domain_id:e.target.value})} placeholder="Например, разработка или юридическая проверка"/></label>
           <p className="text-xs text-kumo-subtle">Согласующие направления</p>
           <div className="max-h-40 overflow-y-auto">{data.people.map(person=><label key={person.id} className="flex items-center gap-2 p-2 text-sm"><input type="checkbox" aria-label={'Направление '+(index+1)+': '+person.name} checked={item.approvers.includes(person.id)} onChange={e=>requirement(index,{approvers:e.target.checked?[...item.approvers,person.id]:item.approvers.filter(id=>id!==person.id)})}/>{person.name}</label>)}</div>
           {item.approvers.filter(id=>!data.people.some(person=>person.id===id)).map(id=><div key={id} className="flex items-center justify-between gap-2 text-sm"><span title={id}>Сотрудник больше недоступен</span><Button type="button" onClick={()=>requirement(index,{approvers:item.approvers.filter(value=>value!==id)})}>Убрать из направления</Button></div>)}
           <p className="text-xs text-kumo-subtle">Выбрано: {item.approvers.length}</p>
           <Button type="button" onClick={()=>change({review_requirements:requirements.filter((_,i)=>i!==index)})}>Убрать направление {index+1}</Button>
         </fieldset>)}
         {!requirements.length&&<p className="text-xs text-kumo-subtle">Дополнительные направления не назначены.</p>}
         <Button type="button" disabled={requirements.length>=32} onClick={()=>change({review_requirements:[...requirements,{domain_id:'',approvers:[]}]})}>Добавить направление</Button>
         {invalidRequirements&&<p role="alert" className="text-xs text-kumo-danger">У каждого направления должно быть уникальное название до 255 байт и хотя бы один согласующий. Всего можно назначить до 100 согласований.</p>}
         <p className="text-xs text-kumo-subtle">Изменение настроек требует нового предложения для ещё не согласованных материалов.</p>
       </section>
       <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editing.enabled} onChange={e=>change({enabled:e.target.checked})}/>Уровень включён</label>
       <div className="flex gap-2"><Button type="submit" variant="primary" disabled={!editing.name.trim()||!editing.approvers.length||invalidRequirements}>Сохранить</Button><Button type="button" onClick={()=>setEditing(null)}>Отмена</Button></div>
     </fieldset>
   </form>}
 </section>
}
