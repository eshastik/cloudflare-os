import {test} from "node:test";
import assert from "node:assert/strict";
import {mountMemoryApp} from "./app-react-harness.mjs";
test("единая кнопка назад закрывает контроллер почты и не показывает поздний ответ",async()=>{
 let reads=0,resolve;const app=await mountMemoryApp({listImapAccounts(){if(++reads===1)return Promise.resolve({servers:[],accounts:[]});return new Promise(r=>{resolve=r;});}},{section:"sources"});
 try{await app.until(()=>app.button("Настроить"),"источники");app.button("Настроить").click();await app.until(()=>resolve&&app.button("Закрыть аккаунты почты")?.hasAttribute("data-embedded-close"),"закрытие перенесено в навигацию");assert.equal(app.buttons().filter(b=>b.textContent==="Назад").length,1);app.button("Назад").click();resolve({servers:[],accounts:[{id:"late",username:"private@example.test",server:"test",enabled:true}]});await app.until(()=>app.button("Настроить"),"возврат к списку");assert(!app.text().includes("private@example.test"));}finally{app.dispose();}
});
