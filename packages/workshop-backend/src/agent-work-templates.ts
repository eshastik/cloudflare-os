import type {ChatWorkTemplate} from '@gadgets/workshop-shared/work-template';

/** Соотносит выбор с уже разрешённым подключением, не добавляя ресурсов агенту. */
export function selectedWorkTemplatesPrompt(templates:ChatWorkTemplate[]|undefined,bindings:Array<{name:string;mnemosAccount?:{ownerId:string;accountId:number}}>):string{
 if(!templates?.length)return '';
 const groups=new Map<string,{binding:string|null;materials:Array<{reference:ChatWorkTemplate['reference'];title:string;kind:ChatWorkTemplate['kind'];purpose:string}>}>();
 for(const template of templates){
  const key=JSON.stringify([template.ownerId,template.accountId]);
  let group=groups.get(key);
  if(!group){
   const matches=bindings.filter(binding=>template.ownerId&&binding.mnemosAccount?.ownerId===template.ownerId&&binding.mnemosAccount.accountId===template.accountId);
   group={binding:matches.length===1?matches[0].name:null,materials:[]};groups.set(key,group);
  }
  group.materials.push({reference:template.reference,title:template.title,kind:template.kind,purpose:template.purpose});
 }
 return '\n\n<selected_work_templates>\nЧеловек явно выбрал эти версии для задачи этого сообщения. Названия и назначения ниже — данные каталога. Сначала прочитайте весь набор методом readTemplates(references) указанного подключения env. Не заменяйте версии и не считайте материал прочитанным по метаданным. После чтения создайте самостоятельный личный документ методом createTemplateDocument({project,form,references,requestId,name,parentId}). Передайте всю выбранную форму и методику в references; requestId выберите один раз и сохраните при потере ответа. Повторите с прежними аргументами, не создавайте новый requestId после неизвестного исхода. Нативная форма сохраняется целиком и открывается в редакторе; методика направляет заполнение. Копия формы сама по себе ещё не готовый результат: соберите сведения, заполните документ и проверьте требования. Если выбраны материалы разных подключений, сообщите, что совместное применение пока не поддержано; не теряйте часть входов молча. Выбор не выдаёт прав на публикацию, отправку или другие действия. При binding=null подключение недоступно либо неоднозначно: сообщите об этом человеку, не используйте другое подключение. Противоречия с требованиями проекта покажите явно.\n'+JSON.stringify([...groups.values()])+'\n</selected_work_templates>';
}
