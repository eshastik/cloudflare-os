import {test} from "node:test";
import assert from "node:assert/strict";
import {MnemosAPI, MnemosAPIError} from "./mnemos-api.ts";

const part = {node_id:"node",head:"a".repeat(64),name:"договор.pdf",content_type:"application/pdf",size_bytes:120,offset:0,next_offset:4,total_bytes:4,text:"тест",truncated:false,no_text:false};

test("Чтение ZIP передаёт точные имена, включая вложенный архив и специальные знаки", async () => {
  const path=["folder/вложенный&архив.zip", "кавычка\"?\n😀.pdf"];
  let url:URL|undefined;
  const api=new MnemosAPI("https://memory.example",async()=>"token",async (input)=>{
    url=new URL(String(input));return Response.json({...part,archive_path:path});
  });
  const result=await api.readDraftText("project","node",0,49152,undefined,path);
  assert.deepEqual(url?.searchParams.getAll("archive_path"),path);
  assert.equal(url?.searchParams.get("offset"),"0");
  assert.deepEqual(result.archive_path,path);
});

test("Старый сервер без выбранного пути и ответ для другого файла отвергаются",async()=>{
  for (const response of [{...part},{...part,archive_path:["другой.txt"]},{...part,archive_path:null}]) {
    const api=new MnemosAPI("https://memory.example",async()=>"token",async()=>Response.json(response));
    await assert.rejects(api.readDraftText("project","node",0,49152,undefined,["договор.pdf"]),e=>e instanceof MnemosAPIError && e.status===502);
  }
});

test("Чтение обычного документа сохраняет прежний URL без пути архива",async()=>{
  let url="";
  const api=new MnemosAPI("https://memory.example",async()=>"token",async input=>{url=String(input);return Response.json(part);});
  await api.readDraftText("project","node",0,49152);
  assert.equal(new URL(url).search,"?offset=0&max_bytes=49152");
});

test("Неверный путь архива отвергается до сетевого запроса",async()=>{
  let calls=0;
  const api=new MnemosAPI("https://memory.example",async()=>"token",async()=>{calls++;return Response.json(part);});
  await assert.rejects(api.readDraftText("project","node",0,49152,undefined,[42] as unknown as string[]),e=>e instanceof MnemosAPIError && e.status===400);
  assert.equal(calls,0);
});


test("ZIP с именами в старой кодировке сохраняет байты и порядок вложенных путей",async()=>{
  const path=["пакет.zip",{nameBase64:"gC50eHQ="}];
  const encoded=[Buffer.from("пакет.zip").toString("base64"),"gC50eHQ="];
  let url:URL|undefined;
  const api=new MnemosAPI("https://memory.example",async()=>"token",async input=>{
    url=new URL(String(input));return Response.json({...part,archive_path:["пакет.zip","�.txt"],archive_path_base64:encoded});
  });
  await api.readDraftText("project","node",0,49152,undefined,path);
  assert.deepEqual(url?.searchParams.getAll("archive_path_b64"),encoded);
  assert.equal(url?.searchParams.has("archive_path"),false);
  for (const wrong of [undefined,[encoded[0],"gS50eHQ="],[encoded[0],"!!!"]]) {
    const bad=new MnemosAPI("https://memory.example",async()=>"token",async()=>Response.json({...part,archive_path_base64:wrong}));
    await assert.rejects(bad.readDraftText("project","node",0,49152,undefined,path),e=>e instanceof MnemosAPIError && e.status===502);
  }
});

test("Неканонический Base64 имени отвергается до запроса",async()=>{
  let calls=0;
  const api=new MnemosAPI("https://memory.example",async()=>"token",async()=>{calls++;return Response.json(part);});
  for (const nameBase64 of ["", "!!!", "YR==", "YQ", "Y Q=="]) {
    await assert.rejects(api.readDraftText("project","node",0,49152,undefined,[{nameBase64}]),e=>e instanceof MnemosAPIError && e.status===400);
  }
  assert.equal(calls,0);
});
