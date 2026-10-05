import {WorkshopButton} from './components/WorkshopControls'
import type {TemplateEditingContext} from './templateEditing'

export default function TemplateEditorStatus({context,ready,disabled,onSave}:{context?:TemplateEditingContext;ready:boolean;disabled:boolean;onSave():void}){
 return <div className="flex min-w-0 shrink items-center gap-3" aria-label="Сохранение шаблона">
  <span className="min-w-0 truncate text-[12px] text-kumo-subtle" title={context?'scope_id' in context.reference?'Сохранение создаст личную правку. Общий шаблон изменится только после согласования.':'Сохранение создаст следующую версию личного шаблона.':'Сохранение создаст личный шаблон в библиотеке.'}>{context?'Основа — версия '+context.reference.revision:'Личный шаблон'}</span>
  <WorkshopButton tone="primary" disabled={disabled||!!context&&!ready} onClick={onSave}>Сохранить шаблон</WorkshopButton>
 </div>
}
