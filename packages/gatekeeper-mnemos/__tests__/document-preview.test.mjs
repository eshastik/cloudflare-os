import {test} from "node:test";
import assert from "node:assert/strict";
import {mountMemoryApp} from "./app-react-harness.mjs";
test("личный материал читается из черновика без обращения к опубликованной версии",async()=>{
 let draftReads=0,publicReads=0;const app=await mountMemoryApp({async browseProject(){return {nodes:[],truncated:false};},async listPrivateDocuments(){return {documents:[{node_id:"draft",name:"Личный материал.md",content_type:"text/markdown",conflicted:false}],head:"a".repeat(64),next_cursor:""};},async readDraftDocument(){draftReads++;return {exists:true,head:"a".repeat(64),content_type:"text/markdown",conflicted:false,terms:[{present:true}]};},async readProjectDocument(){publicReads++;throw Error("404");}},{section:"documents"});
 try{await app.until(()=>app.buttons().find(b=>b.textContent==="Личный материал.md"),"материал");app.buttons().find(b=>b.textContent==="Личный материал.md").click();await app.until(()=>app.text().includes("текст"),"текст черновика");assert.equal(draftReads,1);assert.equal(publicReads,0);assert(!app.text().includes("доступ отозван"));}finally{app.dispose();}
});
