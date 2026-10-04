import {test} from "node:test";
import assert from "node:assert/strict";
import {MnemosAPI} from "./mnemos-api.ts";

test("Согласующие и направления сравниваются как наборы при разном порядке Unicode",async()=>{
  const config={level:"organization" as const,parent_id:"",reader_group_id:"",name:"Организация",enabled:true,approvers:["publisher"],review_requirements:[{domain_id:"Юридическая проверка",approvers:["юрист","Alice"]},{domain_id:"a",approvers:["Alice"]},{domain_id:"A",approvers:["Alice"]},{domain_id:"😀",approvers:["Alice"]},{domain_id:"",approvers:["Alice"]}]};
  const goOrder=(a:string,b:string)=>Buffer.compare(Buffer.from(a),Buffer.from(b));
  let received:unknown;
  const api=new MnemosAPI("https://memory.example",async()=>"human-token",async(_url,init)=>{
    received=JSON.parse(String(init?.body));
    return Response.json({...config,scope_id:"org",revision:1,review_requirements:config.review_requirements.map(r=>({...r,approvers:[...r.approvers].sort(goOrder)})).sort((a,b)=>goOrder(a.domain_id,b.domain_id))});
  });
  const result=await api.setTemplateScope("org",0,config);
  assert.equal(result.revision,1);
  assert.equal(result.review_requirements?.length,5);
  assert.deepEqual(config.review_requirements[0].approvers,["юрист","Alice"]);
  assert.equal((received as {expected_revision:number}).expected_revision,0);
});
