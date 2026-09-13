import type {MnemosAccountSession} from '../src/account-session.ts';
import type {CalendarConnectionInfo, CalendarEventWindow} from '../src/calendar-connections.ts';
type API=Pick<MnemosAccountSession,'readCalendarEvents'>;
/** Human read-only view over the same authorized event window used by agents. */
export class CalendarEventsView {
 private closed=false;private busy=false;private notice='';private result?:CalendarEventWindow;
 private from=new Date().toISOString().slice(0,16);
 private to=new Date(Date.now()+7*86400000).toISOString().slice(0,16);
 constructor(private root:HTMLElement,private api:API,private connection:CalendarConnectionInfo){}
 dispose(){this.closed=true;this.result=undefined;this.root.remove();}
 async read(from=this.from,to=this.to){
  if(this.closed||this.busy)return;
  this.from=from;this.to=to;this.result=undefined;this.notice='';
  const start=new Date(from+'Z'),end=new Date(to+'Z');
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(to)||!Number.isFinite(+start)||!Number.isFinite(+end)||start.toISOString().slice(0,16)!==from||end.toISOString().slice(0,16)!==to||+end<=+start||+end-+start>366*86400000){this.notice='Укажите период до 366 суток; конец должен быть позже начала.';this.render();return;}
  this.busy=true;this.render();
  try{
   const result=await this.api.readCalendarEvents(this.connection.project_id,this.connection.connection_id,{time_min:start.toISOString(),time_max:end.toISOString(),limit:100});
   if(result.calendar_id!==this.connection.calendar_id||typeof result.time_zone!=='string'||!result.time_zone||!Array.isArray(result.events)||result.events.length>100||typeof result.truncated!=='boolean'||result.events.some(e=>!e||typeof e!=='object'||Array.isArray(e)||typeof e.id!=='string'||!e.id))throw Error('Invalid calendar window');
   if(!this.closed)this.result=result;
  }catch{if(!this.closed)this.notice='События недоступны. Проверьте подключение и права, затем повторите чтение.';}
  finally{this.busy=false;if(!this.closed)this.render();}
 }
 render(){
  if(this.closed)return;this.root.replaceChildren();
  const text=(value:string,tag='p')=>{const element=document.createElement(tag);element.textContent=value;if(tag==='pre')element.style.whiteSpace='pre-wrap';this.root.append(element);};
  const button=(label:string,action:()=>void)=>{const b=document.createElement('button');b.textContent=label;b.disabled=this.busy;b.onclick=action;this.root.append(b);return b;};
  text('События календаря','h3');button('Закрыть события',()=>this.dispose()).disabled=false;
  const field=(label:string,value:string)=>{const wrapper=document.createElement('label');wrapper.textContent=label;const input=document.createElement('input');input.type='datetime-local';input.setAttribute('aria-label',label);input.value=value;input.disabled=this.busy;wrapper.append(input);this.root.append(wrapper);return input;};
  const from=field('Начало периода (UTC)',this.from),to=field('Конец периода (UTC)',this.to);
  button('Показать события',()=>void this.read(from.value,to.value));if(this.notice)text(this.notice);if(!this.result)return;
  text('Часовой пояс календаря: '+this.result.time_zone);
  if(this.result.truncated)text('Показана только часть событий. Сузьте период, чтобы прочитать остальные.');
  else if(!this.result.events.length)text('В выбранном периоде событий нет.');
  const string=(value:unknown)=>typeof value==='string'?value:'';
  const time=(value:unknown)=>{if(!value||typeof value!=='object'||Array.isArray(value))return 'не указано';const point=value as Record<string,unknown>;return point.kind==='date'?string(point.date)+' (дата)':point.kind==='dateTime'?string(point.dateTime)+(string(point.timeZone)?' · '+string(point.timeZone):''):'не указано';};
  for(const event of this.result.events){
   text(string(event.title)||string(event.summary)||'Без названия','h4');text('ID: '+event.id);
   text('Начало: '+time(event.start));text('Конец: '+time(event.end));
   if(event.all_day===true||(event.start&&typeof event.start==='object'&&'kind' in event.start&&event.start.kind==='date'))text('На весь день; дата/время конца не включается в событие.');
   if(event.status==='cancelled')text('Событие отменено.');
   if(string(event.location))text('Место: '+event.location);
   if(string(event.description))text(string(event.description),'pre');
   if(event.description_truncated===true)text('Описание сокращено источником.');
  }
 }
}
