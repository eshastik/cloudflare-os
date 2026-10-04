import type {ChatWorkTemplateReference} from '@gadgets/workshop-shared/work-template';
// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => {
  const listModels = vi.fn<() => Promise<never[]>>(async () => []);
  const newGadget = vi.fn<() => never>();
  return {
    addToast: vi.fn<(toast: unknown) => void>(),
    authenticatedApi: { listModels, newGadget, listChatProjects: async () => [] },
    listModels,
    navigate: vi.fn<(options: unknown) => void>(),
    newGadget,
    send: undefined as undefined | ((message:string,model:string|null,capsules?:undefined,attachments?:undefined,formats?:undefined,templates?:ChatWorkTemplateReference[])=>Promise<void>),
    seeds: [] as Array<{ text?: string; nonce?: number }>,
  };
});

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => testState.navigate,
}));

vi.mock("@cloudflare/kumo", () => ({
  useKumoToastManager: () => ({ add: testState.addToast }),
}));

vi.mock("./AuthContext", () => ({
  useAuthenticatedApi: () => ({
    authenticatedApi: testState.authenticatedApi,
  }),
}));

vi.mock("./ChatInterface", () => ({
  ChatInput: ({ seedText, seedNonce, onSend, settings }: { seedText?: string; seedNonce?: number;onSend:(message:string,model:string|null,capsules?:undefined,attachments?:undefined,formats?:undefined,templates?:ChatWorkTemplateReference[])=>Promise<void>; settings?: React.ReactNode }) => {
    testState.send=onSend;
    testState.seeds.push({ text: seedText, nonce: seedNonce });
    // Проекты и «Код» живут в нижней строке поля ввода (проп settings).
    return <><textarea aria-label="Prompt" readOnly value={seedText ?? ""} />{settings}</>;
  },
}));

vi.mock("./components/MeshBackground", () => ({ default: () => null }));
vi.mock("./components/AppShell/HomeTaskSuggestions", () => ({
  default: ({ onPick }: { onPick: (example: unknown) => void }) => (
    <button type="button" onClick={() => onPick({ label: "Сводка по «Склад»", prompt: "Собери сводку по проекту «Склад».", project: { accountId: 1, projectId: "sklad", title: "Склад", hasCode: false } })}>пример</button>
  ),
}));
vi.mock("./useDocumentTitle", () => ({ useDocumentTitle: () => {} }));

import { HomePageContent } from "./routes/index";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Home prompt route flow", () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(async () => {
    await act(async () => root?.unmount());
    container?.remove();
    localStorage.clear();
    testState.seeds.length = 0;
    vi.clearAllMocks();
  });

  it("seeds the composer once, clears route state, and does not create a workspace", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root!.render(<HomePageContent prompt="Create a daily brief." />));

    expect(container.querySelector<HTMLTextAreaElement>('[aria-label="Prompt"]')?.value).toBe(
      "Create a daily brief.",
    );
    expect(Math.max(...testState.seeds.map(({ nonce }) => nonce ?? 0))).toBe(1);
    expect(testState.navigate).toHaveBeenCalledWith({ to: "/", search: {}, replace: true });
    expect(testState.newGadget).not.toHaveBeenCalled();
  });
  it("сохраняет выбранный проект при отправке после очистки URL",async()=>{
    const newChat=vi.fn<(...args:unknown[])=>Promise<number>>(async()=>7);
    testState.newGadget.mockReturnValue({newChat,getMetadata:async()=>({id:'workspace'}),[Symbol.dispose]:()=>{}} as never);
    container=document.createElement('div');document.body.append(container);root=createRoot(container);
    const context={accountId:3,projectId:'project-a',title:'Проект А'};
    await act(async()=>root!.render(<HomePageContent prompt="Работа над проектом" projectContext={context}/>));
    await act(async()=>root!.render(<HomePageContent/>));
    // Проект показан чипом над полем ввода и уходит в беседу набором из одного проекта.
    expect(container.querySelector('[aria-label="Убрать проект «Проект А»"]')).not.toBeNull();
    await act(async()=>testState.send!('Подготовь документ',null));
    expect(newChat).toHaveBeenCalledWith('Подготовь документ',null,undefined,undefined,undefined,{...context,projects:[{...context,pinnedBy:'user'}]},undefined);
    expect(testState.navigate).toHaveBeenCalledWith({to:'/workspace/$id',params:{id:'workspace'},search:{chat:7}});
  });

  it.each([false,true])('главная сохраняет набор формы и методики; проект выбран: %s',async(hasProject)=>{
    const newChat=vi.fn<(...args:unknown[])=>Promise<number>>(async()=>7);
    testState.newGadget.mockReturnValue({newChat,getMetadata:async()=>({id:'workspace'}),[Symbol.dispose]:()=>{}} as never);
    container=document.createElement('div');document.body.append(container);root=createRoot(container);
    const project={accountId:3,projectId:'project-a',title:'Проект А'};
    await act(async()=>root!.render(<HomePageContent projectContext={hasProject?project:undefined}/>));
    const templates=[{accountId:3,reference:{template_id:'method',revision:3}},{accountId:3,reference:{scope_id:'department',template_key:'form',revision:5}}];
    await act(async()=>testState.send!('Подготовь ТЗ',null,undefined,undefined,undefined,templates));
    expect(newChat.mock.calls[0][6]).toEqual(templates);
    expect(newChat.mock.calls[0][5]).toEqual(hasProject?{...project,projects:[{...project,pinnedBy:'user'}]}:undefined);
  });

  it("пример задачи кладёт текст в поле и подключает проект чипом", async () => {
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    await act(async () => root!.render(<HomePageContent />));
    const pick = [...container.querySelectorAll("button")].find(b => b.textContent === "пример")!;
    await act(async () => pick.click());
    expect(container.querySelector<HTMLTextAreaElement>('[aria-label="Prompt"]')?.value).toBe("Собери сводку по проекту «Склад».");
    expect(container.querySelector('[aria-label="Убрать проект «Склад»"]')).not.toBeNull();
    // Повторный щелчок не добавляет проект второй раз.
    await act(async () => pick.click());
    expect(container.querySelectorAll('[aria-label="Убрать проект «Склад»"]')).toHaveLength(1);
  });

});
