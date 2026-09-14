import {test} from "node:test";
import assert from "node:assert/strict";
import {intakePlacement, checkedIntakeSubmit, uploadIntakeFile} from "./intake.ts";

test("размещение сохраняет выбранную область и не принимает обход пути",()=>{
 assert.equal(intakePlacement("alpha","legal","Договор.docx"),"alpha/legal/Договор.docx");
 assert.equal(intakePlacement("alpha","legal","Папка/Версия/Договор.docx"),"alpha/legal/Папка/Версия/Договор.docx");
 for(const name of ["../secret","a/../secret","/secret","a//file","","."]) assert.throws(()=>intakePlacement("alpha","legal",name));
 assert.throws(()=>intakePlacement("alpha","../finance","file"));
});
test("приём не назначает проект и сохраняет путь и пустые файлы",()=>{
 assert.deepEqual(checkedIntakeSubmit("upload-1","folder/.empty",0),{upload_id:"upload-1",source_path:"folder/.empty",marks:["hidden"],modified_at:"1970-01-01T00:00:00.000Z"});
 assert.throws(()=>checkedIntakeSubmit("upload","../file",0));
});
test("байты отправляются напрямую по билету и не попадают в запрос метаданных",async()=>{
 const file=new File(["abc"],"a.txt");let uploaded=false;
 const id=await uploadIntakeFile(file,async(size,sum)=>({upload_id:"u",url:"https://storage.example/file",method:"PUT",checksum_header:"x-amz-checksum-sha256",checksum_value:sum,content_length:size}),async(url,init)=>{assert.equal(url,"https://storage.example/file");assert.equal(init?.body,file);uploaded=true;return new Response(null,{status:200})});
 assert.equal(id,"u");assert.equal(uploaded,true);
});
test("неудачная передача не выдаёт идентификатор завершённой загрузки",async()=>{
 await assert.rejects(uploadIntakeFile(new File(["a"],"a"),async(size,sum)=>({upload_id:"u",url:"https://storage.example/file",method:"PUT",checksum_header:"x-amz-checksum-sha256",checksum_value:sum,content_length:size}),async()=>new Response(null,{status:503})));
});
