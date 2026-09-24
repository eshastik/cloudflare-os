import { it as test, expect } from "vitest";
const assert = { deepEqual(actual: unknown, expected: unknown) { expect(actual).toEqual(expected); } };
import type { AiChatMessage, ActionLogEntry } from "@gadgets/workshop-shared/api";
import { corporateWorkContext } from "./corporate-work-context.ts";
function observation(sequence:number,state:"approved"|"pending"|"rejected", context?: {projectName:string;resourceName?:string}):AiChatMessage {
 return {chatId:1,sequence,timestamp:new Date(),author:{type:"agent",id:"agent",name:"Помощник"},type:"action",actionId:sequence,actionLog:{id:sequence,type:"observation",state,createdAt:new Date(),resourceTitle:"Mnemos",description:{title:"Чтение",description:"Любой текст",workContext:context}}};
}
test("Контекст берётся из успешных наблюдений, объединяет материалы и не дублирует их",()=>{
 assert.deepEqual(corporateWorkContext([
  observation(1,"approved",{projectName:"Продажи"}),
  observation(2,"approved",{projectName:"Продажи",resourceName:"Договор"}),
  observation(3,"approved",{projectName:"Продажи",resourceName:"Договор"}),
  observation(4,"approved",{projectName:"Закупки",resourceName:"Смета"}),
 ]),[{projectName:"Продажи",resources:["Договор"]},{projectName:"Закупки",resources:["Смета"]}]);
});
test("Отказы, ожидающие действия, старые наблюдения и заявления агента не создают контекст",()=>{
 const forged=observation(4,"approved",{projectName:"Не читать"});
 if(forged.type==="action") forged.actionLog={...forged.actionLog!,type:"action"} as ActionLogEntry;
 assert.deepEqual(corporateWorkContext([observation(1,"rejected",{projectName:"Секрет"}),observation(2,"pending",{projectName:"Не подтверждено"}),observation(3,"approved"),forged,
 {chatId:1,sequence:5,timestamp:new Date(),author:{type:"agent",id:"agent",name:"Помощник"},type:"message",message:"Я выбрал проект Секрет"}]),[]);
});
import { corporateSources } from "./corporate-work-context.ts";
function described(sequence:number,title:string,description:string,extra:Record<string,unknown>={}):AiChatMessage {
 return {chatId:1,sequence,timestamp:new Date(),author:{type:"agent",id:"agent",name:"Помощник"},type:"action",actionId:sequence,actionLog:{id:sequence,type:"observation",state:"approved",createdAt:new Date(),resourceTitle:"Mnemos",description:{title,description,...extra}}} as AiChatMessage;
}
test("Источники: проект со ссылкой по идентификатору из соседнего чтения, документы и число поисков",()=>{
 const id="03df01061ae3e9db16ba4f6ed0531c04";
 assert.deepEqual(corporateSources([
  described(1,"Поиск в Mnemos",`Проект «${id}», запрос: «лев».`),
  described(2,"Материалы Mnemos","Поиск выполнен.",{workContext:{projectName:"Красноярский лев"}}),
  described(3,"Чтение документа Mnemos","Проект «Красноярский лев», документ «README.md».",{activity:{kind:"mnemos.open",scopeId:id}}),
  described(4,"Материалы Mnemos","…",{workContext:{projectName:"Красноярский лев",resourceName:"README.md"},activity:{kind:"mnemos.result",scopeId:id,items:[{name:"README.md",documentId:"n1"}]}}),
 ]),[{projectName:"Красноярский лев",projectId:id,resourceTitle:"Mnemos",documents:[{name:"README.md",documentId:"n1"}],searches:1}]);
});
