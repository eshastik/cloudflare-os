import {test} from "node:test";
import assert from "node:assert/strict";
import {buildIntakePlan, selectedFromFolder} from "./intake-review.ts";
const alerts=[{id:"a",paths:["Каталог/Договор.docx"]},{id:"b",paths:["Каталог/Финансы/Смета.xlsx"]},{id:"c",paths:["Другой/Смета.xlsx"]}];
test("выбор папки включает вложенные материалы, не соседние папки",()=>{
 assert.deepEqual(selectedFromFolder(alerts,"Каталог"),["a","b"]);
});
test("итог сохраняет отдельные области выбранных файлов",()=>{
 const plan=buildIntakePlan(alerts,new Set(["a","b"]),{a:{project:"p",domain:"право",file:"Договор.docx"},b:{project:"p",domain:"финансы",file:"Смета.xlsx"}});
 assert.deepEqual(plan.map(p=>p.place),["p/право/Договор.docx","p/финансы/Смета.xlsx"]);
});
test("две записи в один адрес блокируют всю подготовку, не теряют документ молча",()=>{
 assert.throws(()=>buildIntakePlan(alerts,new Set(["b","c"]),{b:{project:"p",domain:"финансы",file:"Смета.xlsx"},c:{project:"p",domain:"финансы",file:"Смета.xlsx"}}),/одинаковый адрес/);
});
test("неполное размещение не превращается в дефолтный проект или область",()=>{
 assert.throws(()=>buildIntakePlan(alerts,new Set(["a"]),{a:{project:"",domain:"",file:"Договор.docx"}}),/Укажите/);
});

test("несколько вопросов одного содержимого нельзя разнести по разным проектам",()=>{
 const duplicated=[{id:"a",paths:["one"],blob_sha256_hex:"same"},{id:"b",paths:["two"],blob_sha256_hex:"same"}];
 assert.throws(()=>buildIntakePlan(duplicated,new Set(["a","b"]),{a:{project:"first",domain:"право",file:"one"},b:{project:"second",domain:"право",file:"two"}}),/Один материал/);
});
