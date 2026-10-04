// @vitest-environment jsdom
import React from 'react'
import {createRoot} from 'react-dom/client'
import {test,expect,vi,beforeEach,afterEach} from 'vitest'
import TemplateScopeSettings from './TemplateScopeSettings'
const api={configuration:vi.fn<()=>Promise<any>>(),configure:vi.fn<(...args:any[])=>Promise<any>>()}
const parent={scope_id:'department',revision:2,level:'department',parent_id:'organization',reader_group_id:'department-readers',name:'Маркетинг',enabled:true,approvers:['alice']}
const initial={scopes:[{...parent,scope_id:'organization',level:'organization',parent_id:'',reader_group_id:'',name:'Компания'},parent],people:[{id:'alice',name:'Алиса'}],groups:[{id:'readers',name:'Команда маркетинга'},{id:'department-readers',name:'Отдел маркетинга'}]}
let host:HTMLDivElement,root:ReturnType<typeof createRoot>
beforeEach(()=>{vi.resetAllMocks();api.configuration.mockResolvedValue(initial);api.configure.mockImplementation(async(id,revision,config)=>({...config,scope_id:id,revision:revision+1}));(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');document.body.append(host);root=createRoot(host)})
afterEach(async()=>{await React.act(async()=>root.unmount());host.remove()})
const button=(text:string)=>[...host.querySelectorAll('button')].find(item=>item.textContent===text)!
async function open(){await React.act(async()=>root.render(<TemplateScopeSettings selector={api as never} onClose={()=>{}}/>))}
async function name(value:string){const input=host.querySelector('input:not([type])') as HTMLInputElement;await React.act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}))})}
async function select(index:number,value:string){await React.act(async()=>{const el=host.querySelectorAll('select')[index];el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}))})}
test('новая группа выбирает родителя, читателей и согласующего по названиям',async()=>{
 await open();await React.act(async()=>button('Создать уровень').click());await name('Рабочая группа');await select(0,'group');await select(1,'department');await select(2,'readers');
 await React.act(async()=>(host.querySelector('input[type=checkbox]') as HTMLInputElement).click());await React.act(async()=>button('Сохранить').click());
 expect(api.configure).toHaveBeenCalledWith(expect.stringMatching(/^[a-f0-9-]{36}$/),0,{level:'group',name:'Рабочая группа',parent_id:'department',reader_group_id:'readers',approvers:['alice'],enabled:true});expect(host.textContent).not.toContain('ID области')
})
test('неподтверждённая запись требует перечитать текущую конфигурацию',async()=>{
 await open();const row=[...host.querySelectorAll('button')].find(item=>item.textContent?.startsWith('Маркетинг'))!;await React.act(async()=>row.click());api.configure.mockRejectedValueOnce(new Error('lost'));await React.act(async()=>button('Сохранить').click());expect(button('Сохранить').matches(':disabled')).toBe(true);expect(host.textContent).toContain('Перечитайте настройки');
 api.configuration.mockResolvedValue({...initial,scopes:[initial.scopes[0],{...parent,revision:3}]});await React.act(async()=>button('Перечитать настройки').click());const next=[...host.querySelectorAll('button')].find(item=>item.textContent?.startsWith('Маркетинг'))!;await React.act(async()=>next.click());await React.act(async()=>button('Сохранить').click());expect(api.configure.mock.calls.at(-1)?.[1]).toBe(3)
})
test('при отказе сервера настройка не выдаёт форму и не меняет права',async()=>{
 api.configuration.mockRejectedValue(new Error('403'));await open();expect(host.textContent).toContain('Настройка недоступна');expect(host.querySelector('form')).toBeNull();expect(api.configure).not.toHaveBeenCalled()
})

test('недоступного согласующего можно явно убрать из прежней конфигурации',async()=>{
 api.configuration.mockResolvedValue({...initial,scopes:[initial.scopes[0],{...parent,approvers:['alice','retired']}]});await open();const row=[...host.querySelectorAll('button')].find(item=>item.textContent?.startsWith('Маркетинг'))!;await React.act(async()=>row.click());expect(host.textContent).toContain('Сотрудник больше недоступен');await React.act(async()=>button('Убрать из согласующих').click());await React.act(async()=>button('Сохранить').click());expect(api.configure.mock.calls.at(-1)?.[2].approvers).toEqual(['alice'])
})

async function field(label:string,value:string){const input=host.querySelector('[aria-label="'+label+'"]') as HTMLInputElement;await React.act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}))})}
async function editDepartment(){await open();await React.act(async()=>[...host.querySelectorAll('button')].find(item=>item.textContent?.startsWith('Маркетинг'))!.click())}
test('содержание требует согласующего каждого уникального направления отдельно от распространения',async()=>{
 api.configuration.mockResolvedValue({...initial,people:[...initial.people,{id:'bob',name:'Борис'}]});await editDepartment();await React.act(async()=>button('Добавить направление').click());expect(button('Сохранить').matches(':disabled')).toBe(true);await field('Название направления 1','Разработка');await React.act(async()=>(host.querySelector('[aria-label="Направление 1: Борис"]') as HTMLInputElement).click());await React.act(async()=>button('Добавить направление').click());await field('Название направления 2','Разработка');await React.act(async()=>(host.querySelector('[aria-label="Направление 2: Алиса"]') as HTMLInputElement).click());expect(button('Сохранить').matches(':disabled')).toBe(true);expect(api.configure).not.toHaveBeenCalled();await field('Название направления 2','Юридическая проверка');await React.act(async()=>button('Сохранить').click());expect(api.configure.mock.calls[0][2]).toMatchObject({approvers:['alice'],review_requirements:[{domain_id:'Разработка',approvers:['bob']},{domain_id:'Юридическая проверка',approvers:['alice']}]})
})
test('прежние предметные требования сохраняются, последнее направление снимается явно',async()=>{
 const review_requirements=[{domain_id:'Разработка',approvers:['alice','retired']}];api.configuration.mockResolvedValue({...initial,scopes:[initial.scopes[0],{...parent,review_requirements}]});await editDepartment();expect(host.textContent).toContain('Сотрудник больше недоступен');await React.act(async()=>button('Сохранить').click());expect(api.configure.mock.calls[0][2].review_requirements).toEqual(review_requirements);await React.act(async()=>button('Убрать из направления').click());await React.act(async()=>button('Сохранить').click());expect(api.configure.mock.calls[1][2].review_requirements).toEqual([{domain_id:'Разработка',approvers:['alice']}]);await React.act(async()=>button('Убрать направление 1').click());await React.act(async()=>button('Сохранить').click());expect(api.configure.mock.calls[2][2].review_requirements).toEqual([]);expect(initial.scopes[1]).not.toHaveProperty('review_requirements')
})

test('группы читателей других уровней не предлагаются, текущая группа сохраняется',async()=>{
 await editDepartment();const readers=host.querySelectorAll('select')[2];expect([...readers.options].map(item=>item.value)).toContain('department-readers');await React.act(async()=>button('Отмена').click());await React.act(async()=>button('Создать уровень').click());await select(0,'group');const choices=[...host.querySelectorAll('select')[2].options].map(item=>item.value);expect(choices).toContain('readers');expect(choices).not.toContain('department-readers');expect(host.textContent).toContain('только одному уровню')
})
