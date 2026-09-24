import {describe, expect, it, vi} from "vitest";
import {collection, createTypedStorage} from "@gadgets/typed-storage";
import type {ActionRecord} from "../src/overseer.js";
import {findSubmittedAction} from "../src/action-submission.js";
import {makeMockStorage} from "./mock-storage.js";
import {OverseerDurableObject, checkedActionOutcome, withCheckedActionCard} from "../src/overseer.js";

vi.mock("capnweb-validate", () => ({validateRpc: () => () => undefined}));
vi.mock("cloudflare:workers", async importOriginal => {
  const workers = await importOriginal<typeof import("cloudflare:workers")>();
  return {...workers, DurableObject: class { constructor(public ctx: unknown, public env: unknown) {} }};
});

const description = {title: "Создать проект", description: "Создать проект «Продажи».", implementsRevert: false, awaitDecision: true};
function fixture() {
  const durable = makeMockStorage();
  const open = () => createTypedStorage(durable, {collections: {actions: collection<ActionRecord>()({primaryKey: "id"})}});
  const storage = open();
  storage.actions.put({id: 8, gatekeeperId: 3, caller: {from: "agent", chatId: 1}, action: 42, createdAt: new Date(), state: "pending", type: "action", description});
  return {open, storage};
}

describe("повтор отправки действия в очередь", () => {
  it("подтверждение владельца проверяется перед вызовом gatekeeper, а профиль сам по себе не даёт полномочия", async () => {
    const durable = makeMockStorage();
    const ctx = {storage: durable, id: {toString: () => "workspace"}, exports: {UserDurableObject: {}}, waitUntil: () => {}} as unknown as DurableObjectState;
    const impl = new OverseerDurableObject(ctx, {} as Cloudflare.Env)["impl"];
    const ownerOnly = {...description, ownerApprovalRequired: true, autoApprovable: true, actionKind: {tag: "admin", label: "Управление"}};
    await expect(impl.submitAction(3, 42, ownerOnly, {from: "agent", chatId: 1})).rejects.toThrow(/аккаунта/);
    impl.storage.gatekeepers.put({id: 3, creationSpec: {type: "ambient", vendorId: "mnemos", accountId: 0}} as Parameters<typeof impl.storage.gatekeepers.put>[0]);
    await impl.submitAction(3, 42, ownerOnly, {from: "agent", chatId: 1});
    const record = [...impl.storage.actions.list()][0] as ActionRecord & {type: "action"};
    const apply = vi.fn(async () => {});
    vi.spyOn(impl, "getGatekeeperFacet").mockReturnValue({applyAction: apply} as ReturnType<typeof impl.getGatekeeperFacet>);
    const profile = {type: "user" as const, id: "owner-profile", name: "Владелец"};
    await expect(impl.applyPendingAction(record, profile, false, false)).rejects.toThrow(/владелец/);
    await expect(impl.applyPendingAction(record, profile, true, true)).rejects.toThrow(/владелец/);
    expect(apply).not.toHaveBeenCalled();
    await impl.applyPendingAction(record, profile, false, true);
    expect(apply).toHaveBeenCalledOnce();
    const ordinary = {...record, id: 99, action: 99, state: "pending" as const, description};
    await impl.applyPendingAction(ordinary, profile, false, false);
    expect(apply).toHaveBeenCalledTimes(2);
  });
  it("личное наблюдение запрещает совместную беседу и сохраняет изоляцию workspace после перезапуска", async () => {
    const make = (durable = makeMockStorage()) => {
      const ctx = {storage: durable, id: {toString: () => "workspace"}, exports: {UserDurableObject: {}}, waitUntil: () => {}} as unknown as DurableObjectState;
      const impl = new OverseerDurableObject(ctx, {} as Cloudflare.Env)["impl"];
      vi.spyOn(impl, "getOwnerProfileId").mockResolvedValue("owner");
      return {impl, durable};
    };
    const {impl, durable} = make(); const sharing = await impl.getSharingManager();
    const caller = {profileId:"owner", isOwner:true};
    const link = await sharing.createShareLink({caller, role:"use"});
    await expect(impl.authorizeObservation(3, {title:"Личное", description:"", ownerOnly:true}, {from:"agent",chatId:1})).rejects.toThrow(/Личные/);
    sharing.revokeShareLink(caller, link.linkId, []);
    await impl.authorizeObservation(3, {title:"Личное", description:"", ownerOnly:true}, {from:"agent",chatId:1});
    expect(impl.storage.ownerOnlyObservations.get()).toBe(true); expect(impl.storage.prohibitAllSharing.get()).toBe(false);
    await expect(sharing.createShareLink({caller,role:"use"})).rejects.toThrow(/личные/);
    const restarted = make(durable).impl;
    await expect((await restarted.getSharingManager()).createShareLink({caller,role:"build"})).rejects.toThrow(/личные/);
    impl.storage.gatekeepers.put({id:3,creationSpec:{type:"ambient",vendorId:"mnemos",accountId:0}} as Parameters<typeof impl.storage.gatekeepers.put>[0]);
    await impl.submitAction(3,42,{...description,ownerApprovalRequired:true},{from:"agent",chatId:1});
    const action = [...impl.storage.actions.list()].find(r=>r.type==="action") as ActionRecord & {type:"action"};
    const apply = vi.fn(async()=>{});
    vi.spyOn(impl,"getGatekeeperFacet").mockReturnValue({applyAction:apply} as ReturnType<typeof impl.getGatekeeperFacet>);
    await impl.applyPendingAction(action,{type:"user",id:"owner",name:"Владелец"},false,true);
    expect(apply).toHaveBeenCalledOnce();
    const other = make().impl;
    await expect((await other.getSharingManager()).createShareLink({caller,role:"use"})).resolves.toHaveProperty("key");
  });
  it("начатая выдача ссылки не обходит личное наблюдение во время mintKey", async () => {
    const ctx = {storage: makeMockStorage(), id: {toString: () => "workspace"}, exports: {UserDurableObject: {}}, waitUntil: () => {}} as unknown as DurableObjectState;
    const impl = new OverseerDurableObject(ctx, {} as Cloudflare.Env)["impl"];
    vi.spyOn(impl,"getOwnerProfileId").mockResolvedValue("owner");
    const sharing = await impl.getSharingManager();
    const pending = sharing.createShareLink({caller:{profileId:"owner",isOwner:true},role:"use"});
    await impl.authorizeObservation(3,{title:"Личное",description:"",ownerOnly:true},{from:"agent",chatId:1});
    await expect(pending).rejects.toThrow(/личные/);
    expect(sharing.hasAnyShares()).toBe(false);
  });
  it("реальная очередь не выделяет новую карточку после потерянного ответа и восстановления DO", async () => {
    const storage = makeMockStorage();
    const ctx = {storage, id: {toString: () => "workspace"}, exports: {UserDurableObject: {}}, waitUntil: () => {}} as unknown as DurableObjectState;
    const open = () => new OverseerDurableObject(ctx, {} as Cloudflare.Env)["impl"];
    let impl = open();
    await impl.submitAction(3, 42, description, {from: "agent", chatId: 1});
    const first = [...impl.storage.actions.list()];
    impl = open();
    await impl.submitAction(3, 42, description, {from: "agent", chatId: 1});
    expect([...impl.storage.actions.list()]).toEqual(first);
    expect(impl.consumeCapturedActions(1)?.awaitDecision).toBe(true);
    await impl.submitAction(4, 42, description, {from: "agent", chatId: 1});
    await impl.submitAction(3, 43, description, {from: "agent", chatId: 1});
    expect([...impl.storage.actions.list()]).toHaveLength(3);
  });
  it("после потерянного ответа и перезапуска находит исходную durable-карточку", () => {
    const {open} = fixture();
    const restarted = open();
    expect(findSubmittedAction(restarted.actions.list(), 3, 42, description)?.id).toBe(8);
    expect([...restarted.actions.list()]).toHaveLength(1);
  });
  it("не склеивает разные gatekeeper или action", () => {
    const {storage} = fixture();
    expect(findSubmittedAction(storage.actions.list(), 4, 42, description)).toBeUndefined();
    expect(findSubmittedAction(storage.actions.list(), 3, 43, description)).toBeUndefined();
  });
  it.each(["approved", "rejected"] as const)("сохраняет завершённое состояние %s", state => {
    const {open, storage} = fixture();
    const record = storage.actions.get(8)!; storage.actions.put({...record, state});
    expect(findSubmittedAction(open().actions.list(), 3, 42, description)?.state).toBe(state);
  });
  it("карточка действия проверяется при отправке, итог ресурса сохраняется у выполненного действия", async () => {
    const ctx = {storage: makeMockStorage(), id: {toString: () => "workspace"}, exports: {UserDurableObject: {}}, waitUntil: () => {}} as unknown as DurableObjectState;
    const impl = new OverseerDurableObject(ctx, {} as Cloudflare.Env)["impl"];
    const card = {icon: "rocket", details: ["Проект «Продажи»", "", 5, "Вторая", "Третья", "Четвёртая"]};
    await impl.submitAction(3, 42, {...description, card} as never, {from: "agent", chatId: 1});
    const record = [...impl.storage.actions.list()][0] as ActionRecord & {type: "action"};
    expect(record.description.card).toEqual({icon: "other", details: ["Проект «Продажи»", "Вторая", "Третья"]});
    const apply = vi.fn(async () => ({summary: "  Николай Деревцов может править «План»  ", url: "javascript:alert(1)"}));
    vi.spyOn(impl, "getGatekeeperFacet").mockReturnValue({applyAction: apply} as unknown as ReturnType<typeof impl.getGatekeeperFacet>);
    await impl.applyPendingAction(record, {type: "user", id: "owner", name: "Владелец"}, false, false);
    const saved = impl.storage.actions.get(record.id) as ActionRecord & {type: "action"};
    expect(saved.state).toBe("approved");
    expect(saved.outcome).toEqual({summary: "Николай Деревцов может править «План»"});
    expect(checkedActionOutcome({summary: "Готово", url: "https://mnemos.example/doc"})).toEqual({summary: "Готово", url: "https://mnemos.example/doc"});
    expect(checkedActionOutcome(undefined)).toBeUndefined();
    expect(checkedActionOutcome({summary: "   "})).toBeUndefined();
    expect(withCheckedActionCard({...description, card: "плохо"} as never)).toEqual(description);
    const open = (value: unknown) => withCheckedActionCard({...description, card: {icon: "connection", details: ["Пароль вводит человек"], open: value}} as never).card?.open;
    expect(open({section: "connections", label: "  Открыть «Подключения»  "})).toEqual({section: "connections", label: "Открыть «Подключения»"});
    expect(open({section: "projects", project: "p1", label: "Открыть проект"})).toEqual({section: "projects", project: "p1", label: "Открыть проект"});
    for (const bad of [{section: "../admin", label: "x"}, {section: "connections", label: ""}, {section: "projects", project: "a/b?c", label: "x"}, "connections"]) expect(open(bad)).toBeUndefined();
  });
  it("подмена карточки подтверждения не меняет исходное действие", () => {
    const {storage} = fixture();
    const record = storage.actions.get(8)! as ActionRecord & {type: "action"};
    storage.actions.put({...record, description: {...description, card: {icon: "share", details: ["Проект «Продажи»"]}}});
    expect(() => findSubmittedAction(storage.actions.list(), 3, 42, {...description, card: {icon: "share", details: ["Проект «Архив»"]}})).toThrow(/другим описанием/);
    expect(findSubmittedAction(storage.actions.list(), 3, 42, {...description, card: {icon: "share", details: ["Проект «Продажи»"]}})?.id).toBe(8);
  });
  it("подмена описания или автоматического одобрения не меняет исходную карточку", () => {
    const {storage} = fixture();
    for (const changed of [{...description, description: "Другой проект"}, {...description, autoApprovable: true}, {...description, actionKind: {tag: "safe", label: "Без подтверждения"}}]) {
      expect(() => findSubmittedAction(storage.actions.list(), 3, 42, changed)).toThrow(/другим описанием/);
    }
    expect(storage.actions.get(8)?.description).toEqual(description);
  });
});
