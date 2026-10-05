// @vitest-environment jsdom
import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {expect,test,vi} from 'vitest'
import TemplateEditorStatus from './TemplateEditorStatus'

test('Шаблон сохраняется одним действием; неподтверждённая исходная версия блокирует сохранение',()=>{
 (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true
 const host=document.createElement('div'),root=createRoot(host),save=vi.fn<()=>void>()
 const context={accountId:0,projectId:'project',reference:{scope_id:'team',template_key:'method',revision:5}}
 try{
  act(()=>root.render(<TemplateEditorStatus context={context} ready={false} disabled={false} onSave={save}/>))
  expect(host.textContent).toContain('Основа — версия 5');expect(host.querySelectorAll('button')).toHaveLength(1)
  expect(host.textContent).not.toContain('Не в Mnemos');expect(host.querySelector('button')!.disabled).toBe(true)
  act(()=>host.querySelector('button')!.click());expect(save).not.toHaveBeenCalled()
  act(()=>root.render(<TemplateEditorStatus context={context} ready disabled={false} onSave={save}/>))
  act(()=>host.querySelector('button')!.click());expect(save).toHaveBeenCalledOnce()
  expect(host.querySelector('[title]')!.getAttribute('title')).toContain('после согласования')
  act(()=>root.render(<TemplateEditorStatus ready disabled onSave={save}/>))
  expect(host.textContent).toContain('Личный шаблон');expect(host.querySelector('button')!.disabled).toBe(true)
 }finally{act(()=>root.unmount())}
})
