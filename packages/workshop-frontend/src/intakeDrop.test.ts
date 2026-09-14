// @vitest-environment jsdom
import {expect,it} from "vitest";
import {collectIntakeDrop} from "./intakeDrop";
it("собирает вложенную папку со всеми страницами каталога и относительными путями",async()=>{
 const first=new File(["a"],"Договор.txt"),second=new File(["b"],"Смета.txt");
 const file=(value:File)=>({name:value.name,isFile:true,isDirectory:false,file:(done:(file:File)=>void)=>done(value)});
 const directory=(name:string,batches:unknown[][])=>({name,isFile:false,isDirectory:true,createReader:()=>{let index=0;return {readEntries:(done:(items:unknown[])=>void)=>done(batches[index++]??[])}}});
 const entry=directory("Проект",[[file(first)],[directory("Финансы",[[file(second)]])]]);
 const transfer={items:[{kind:"file",webkitGetAsEntry:()=>entry,getAsFile:()=>null}]} as unknown as DataTransfer;
 const files=await collectIntakeDrop(transfer);
 expect(files.map(f=>f.path)).toEqual(["Проект/Договор.txt","Проект/Финансы/Смета.txt"]);
 expect(files.map(f=>f.file)).toEqual([first,second]);
});
it("не читает строки и ссылки как файлы",async()=>{
 const transfer={items:[{kind:"string",getAsFile:()=>{throw Error("must not read")}}],files:[]} as unknown as DataTransfer;
 expect(await collectIntakeDrop(transfer)).toEqual([]);
});
