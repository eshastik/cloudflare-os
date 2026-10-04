import type {ChatWorkTemplate} from '@gadgets/workshop-shared/work-template'
import {X} from '@phosphor-icons/react'
import {WorkshopButton,WorkshopIconButton} from './components/WorkshopControls'

const kinds={document:'Форма документа',guidance:'Методика',agent_instructions:'Инструкция агента',skill:'Навык'}

export default function TaskTemplateMaterials({items,onChoose,onPreview,onRemove,onClear}:{items:ChatWorkTemplate[];onChoose():void;onPreview(item:ChatWorkTemplate):void;onRemove(item:ChatWorkTemplate):void;onClear():void}){
 return <section aria-label="Материалы для задачи" className="mx-3 mb-2 rounded-lg border border-kumo-line bg-kumo-tint px-3 py-2">
  <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><p className="text-[12px] font-medium">Материалы для задачи: {items.length}</p><WorkshopButton className="!h-7 !text-[12px]" onClick={onChoose}>Изменить выбор</WorkshopButton></div>
  <ul className="max-h-40 space-y-1 overflow-y-auto">{items.map(item=><li key={JSON.stringify([item.accountId,item.reference])} className="flex min-w-0 items-start gap-2 rounded-lg bg-kumo-base px-2 py-2">
   <button type="button" aria-label={'Посмотреть выбранный шаблон: '+item.title+' · версия '+item.reference.revision} onClick={()=>onPreview(item)} className="min-w-0 flex-1 rounded text-left focus-visible:outline-2 focus-visible:outline-kumo-brand"><span className="block break-words text-[12px] font-medium">{item.title}</span><span className="mt-0.5 block text-[11px] text-kumo-subtle">{kinds[item.kind]} · версия {item.reference.revision} · {'scope_id' in item.reference?'Общий':'Личный'}</span></button>
   <WorkshopIconButton className="!h-7 !w-7 shrink-0" aria-label={'Убрать из задачи: '+item.title+' · версия '+item.reference.revision} onClick={()=>onRemove(item)}><X size={13}/></WorkshopIconButton>
  </li>)}</ul>
  <div className="mt-2 flex flex-wrap items-center justify-between gap-2"><p className="text-[11px] text-kumo-subtle">Выбраны для следующего сообщения. Версии закрепятся после отправки.</p><WorkshopButton className="!h-7 !text-[11px]" onClick={onClear}>Убрать все материалы</WorkshopButton></div>
 </section>
}
