import { test } from "node:test";
import assert from "node:assert/strict";
import { MnemosAPI, MnemosAPIError } from "./mnemos-api.ts";

// Один серверный ответ теряется после сохранения. Повтор с прежней ревизией
// должен получить конфликт, а чтение — уже сохранённое разрешение.
test("Разрешение шаблонов: потеря ответа, конфликт повторной записи и подмена области", async () => {
  let grant = { binding_id: "agent", scope_id: "team", revision: 0, enabled: false };
  let writes = 0;
  let loseAnswer = true;
  const calls: string[] = [];
  const api = new MnemosAPI("https://memory.example", async () => "human-token", async (url, init) => {
    calls.push(String(url));
    if (init?.method === "PUT") {
      const body = JSON.parse(String(init.body));
      if (body.expected_revision !== grant.revision) return Response.json({ code: "revision-conflict" }, { status: 409 });
      grant = { ...grant, revision: grant.revision + 1, enabled: body.enabled };
      writes++;
      if (loseAnswer) { loseAnswer = false; throw Error("answer lost"); }
    }
    return Response.json(grant);
  });
  assert.deepEqual(await api.readTemplateAgentGrant("agent", "team"), grant);
  await assert.rejects(api.setTemplateAgentGrant("agent", "team", 0, true));
  await assert.rejects(api.setTemplateAgentGrant("agent", "team", 0, true), e => e instanceof MnemosAPIError && e.status === 409);
  assert.deepEqual(await api.readTemplateAgentGrant("agent", "team"), { binding_id: "agent", scope_id: "team", revision: 1, enabled: true });
  assert.deepEqual(await api.setTemplateAgentGrant("agent", "team", 1, false), { binding_id: "agent", scope_id: "team", revision: 2, enabled: false });
  assert.equal(writes, 2);
  assert.ok(calls.every(u => u === "https://memory.example/v1/template-scopes/team/agent-grants/agent"));

  for (const changed of [{ binding_id: "foreign" }, { scope_id: "foreign" }, { revision: -1 }, { revision: 0, enabled: true }, { enabled: "true" }]) {
    const forged = new MnemosAPI("https://memory.example", async () => "human-token", async () => Response.json({ ...grant, ...changed }));
    await assert.rejects(forged.readTemplateAgentGrant("agent", "team"), e => e instanceof MnemosAPIError && e.status === 502);
  }
  const before = calls.length;
  for (const expected of [-1, 0.5, Number.MAX_SAFE_INTEGER]) await assert.rejects(api.setTemplateAgentGrant("agent", "team", expected, true));
  assert.equal(calls.length, before);
});

test("Список разрешений: курсор, чужой агент, повтор области и ложное усечение", async () => {
  const item = {binding_id:"agent",scope_id:"team",revision:2,enabled:true};
  let url = "";
  const api = new MnemosAPI("https://memory.example",async()=>"human-token",async(input)=>{url=String(input);return Response.json({grants:[item]});});
  assert.deepEqual(await api.listTemplateAgentGrants("agent","department"),{grants:[item]});
  assert.equal(url,"https://memory.example/v1/agent-connections/agent/template-grants?cursor=department");
  const unicodePage={grants:[{...item,scope_id:'\uE000'},{...item,scope_id:'😀'}]};
  const unicode=new MnemosAPI("https://memory.example",async()=>"human-token",async()=>Response.json(unicodePage));
  assert.deepEqual(await unicode.listTemplateAgentGrants("agent"),unicodePage);
  const reversed=new MnemosAPI("https://memory.example",async()=>"human-token",async()=>Response.json({grants:[...unicodePage.grants].reverse()}));
  await assert.rejects(reversed.listTemplateAgentGrants("agent"),e=>e instanceof MnemosAPIError&&e.status===502);
  for(const response of [{grants:[{...item,binding_id:"foreign"}]},{grants:[item,item]},{grants:[{...item,revision:0}]},{grants:[item],next_cursor:"team"},{grants:null}]){
    const broken = new MnemosAPI("https://memory.example",async()=>"human-token",async()=>Response.json(response));
    await assert.rejects(broken.listTemplateAgentGrants("agent"),e=>e instanceof MnemosAPIError&&e.status===502);
  }
});
