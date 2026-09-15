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
