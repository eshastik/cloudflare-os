import {REQUEST_RATE_ERROR} from '../src/mnemos-api.ts';
import type {MnemosAccountSession} from '../src/account-session.ts';
import type {UploadUsage} from '../src/upload-usage.ts';
/** Minimal view of the connected subject's upload capacity. */
export class UploadUsageView {
 private value?:UploadUsage;private busy=false;private closed=false;private failed=false;private throttled=false;
 constructor(private root:HTMLElement,private api:Pick<MnemosAccountSession,'uploadUsage'>,private close:()=>void){}
 async load(){
  if(this.busy||this.closed)return;this.busy=true;this.failed=false;this.throttled=false;this.value=undefined;this.render();
  try{const value=await this.api.uploadUsage();if(!this.closed)this.value=value;}catch(error){if(!this.closed){this.failed=true;this.throttled=error instanceof Error&&error.message.includes(REQUEST_RATE_ERROR);}}
  finally{this.busy=false;if(!this.closed)this.render();}
 }
 render(){
  if(this.closed)return;this.root.replaceChildren();
  const text=(value:string,tag='p')=>{const node=document.createElement(tag);node.textContent=value;this.root.append(node);};
  text('Мои загрузки','h2');
  const back=document.createElement('button');back.textContent='Назад';back.onclick=()=>{this.closed=true;this.value=undefined;this.close();};this.root.append(back);
  const refresh=document.createElement('button');refresh.textContent='Обновить';refresh.disabled=this.busy;refresh.onclick=()=>void this.load();this.root.append(refresh);
  if(this.busy)text('Загрузка…');
  if(this.failed)text(this.throttled?'Достигнут лимит частоты запросов. Дождитесь следующего минутного окна и обновите состояние.':'Не удалось получить состояние. Проверьте подключение и обновите.');
  if(this.value){const v=this.value;text(`Занято слотов: ${v.active} из ${v.concurrent_limit}`);text(`Завершено, ожидает уборки: ${v.cleanup_pending}`);text(`Зарезервировано во временной зоне: ${v.reserved_bytes} байт`);if(v.request_rate){text(`Запросов в минутном окне: ${v.request_rate.used} из ${v.request_rate.limit}`);text(`Новое окно: ${new Date(v.request_rate.resets_at).toLocaleTimeString()}`);text('Обновление этого экрана также учитывается как запрос.');}else{text('Лимит частоты сервером не сообщён.');}text('Счётчики относятся к текущему пользователю и агенту. Завершённые загрузки не занимают слоты. Лимит задаёт администратор сервера.');}
 }
}
