import type {PublishedSignalAssessment} from '../src/mnemos-api.ts';
import type {Task} from '../src/tracker-artifact.ts';
export type SignalGapTask=Pick<Task,'id'|'title'|'description'|'next_step'> & {project:string};
/** Stable task identity for one selected source and gap; no grant is implied. */
export async function signalGapTask(source:PublishedSignalAssessment,signal:string):Promise<SignalGapTask>{
 const snapshot=source.snapshot;
 if(!source.publication.enabled||!snapshot||snapshot.project_id!==source.project_id||snapshot.request_id!==source.publication.source_request_id)throw Error('Unavailable assessment');
 const finding=snapshot.assessment.findings.find(f=>f.signal_id===signal);
 if(!finding||finding.state==='available')throw Error('No gap');
 const key=JSON.stringify([source.project_id,source.publication.source_owner_id,snapshot.request_id,signal]);
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key));
 const id='signal-gap-'+Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
 const reasons={missing:'Нет измерения',stale:'Измерение устарело',unavailable:'Источник недоступен',future_timestamp:'Некорректное время измерения',unit_mismatch:'Единица измерения не соответствует требованию'};
 return {project:source.project_id,id,title:'Восстановить измерение: '+signal,
  description:['Требование: '+finding.purpose,'Причина: '+reasons[finding.state],
   'mnemos-signal-gap:'+JSON.stringify({project:source.project_id,request:snapshot.request_id,signal,requirements_sha256:snapshot.requirements_sha256,collected_at:snapshot.collected_at}),
   'Проект: '+source.project_id,'Оценка: '+snapshot.request_id,'Владелец снимка: '+source.publication.source_owner_id,'Публикация: '+source.publication.revision,
   'Снимок собран: '+snapshot.collected_at,'Проверено: '+snapshot.assessment.assessed_at,
   'Ожидаемая единица: '+(finding.expected_unit||'не задана'),'Полученная единица: '+(finding.unit||'нет измерения'),
   'Сигнал: '+signal,'Источник: '+(finding.source_id||'не получен'),'Отпечаток: '+(finding.source_revision||'нет'),
   'Критерии приёмки: восстановить измерение для исходного требования; получить новую оценку по тому же профилю из действующего источника. Сигнал должен иметь состояние available и корректное время в пределах срока свежести профиля. Сохранить ID новой оценки в результате задачи; опубликовать выбранную оценку в общем обзоре. Изменение только статуса задачи не устраняет пробел.'
  ].join('\n'),next_step:'Проверить источник, устранить причину и повторить оценку с новым ID по исходному профилю.'};
}

/** This marker is a navigation hint, never an authorization or completion claim. */
export function gapReference(description:string){
 const line=description.split('\n').find(line=>line.startsWith('mnemos-signal-gap:'));
 if(!line)return undefined;
 try{const value:unknown=JSON.parse(line.slice('mnemos-signal-gap:'.length));
  if(!value||typeof value!=='object')return undefined;
  const v=value as Record<string,unknown>;
  if(typeof v.project!=='string'||typeof v.request!=='string'||typeof v.signal!=='string'||typeof v.requirements_sha256!=='string'||!/^[a-f0-9]{64}$/.test(v.requirements_sha256)||typeof v.collected_at!=='string'||!Number.isFinite(Date.parse(v.collected_at)))return undefined;
  return {project:v.project,request:v.request,signal:v.signal,requirements_sha256:v.requirements_sha256,collected_at:v.collected_at};
 }catch{return undefined;}
}
export function gapResolution(description:string,current:PublishedSignalAssessment):string{
 const before=gapReference(description),after=current.snapshot;
 if(!before||current.project_id!==before.project||!current.publication.enabled||!after||after.project_id!==before.project||after.request_id!==current.publication.source_request_id||after.request_id===before.request||after.requirements_sha256!==before.requirements_sha256||!(Date.parse(after.collected_at)>Date.parse(before.collected_at)))throw Error('No comparable new assessment');
 const finding=after.assessment.findings.find(f=>f.signal_id===before.signal);
 if(!finding||finding.state!=='available')throw Error('Gap remains');
 return ['Измерение повторно проверено: '+finding.purpose,'Новая опубликованная оценка: '+after.request_id,'Публикация: '+current.publication.revision,'Снимок: '+after.collected_at,'Проверено: '+after.assessment.assessed_at,'Источник: '+finding.source_id,'Отпечаток результата: '+finding.source_revision,'Результат измерения: '+finding.value+' '+finding.unit,'Достаточность всего профиля: '+after.assessment.state].join('\n');
}
