// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { newMessagePortRpcSession, RpcStub, RpcTarget } from "capnweb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GatekeeperUiFrame } from "@gadgets/workshop-shared/gatekeeper";
import type { NativeDocumentFormat, NativeDocumentSnapshot } from "@gadgets/workshop-shared/native-document";
import SandboxedGatekeeperApp from "./SandboxedGatekeeperApp";
import { prepareForLogout } from "./authNavigation";

vi.mock("./ThemeContext", () => ({
  useTheme: () => ({ resolvedThemeMode: "light" }),
}));

vi.mock("./errorReporting", () => ({
  forwardTrustedFrameError: () => false,
}));

const WORKSPACE_ID = "a".repeat(64);

const listGadgets = vi.fn<() => Promise<{ id: string; title: string }[]>>(async () => [
  { id: WORKSPACE_ID, title: "Daily Brief" },
]);

vi.mock("./AuthContext", () => {
  let authenticatedApi:{listGadgets:typeof listGadgets}|undefined;
  return {useAuthenticatedApi:()=>({authenticatedApi:authenticatedApi??={listGadgets}})};
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface TestHost extends RpcTarget {
  setUnsavedChanges(dirty: boolean): Promise<void>;
  getSelectedSection(): Promise<string>;
  getPresentationMode(): Promise<string>;
  openSection(section:string): Promise<void>;
  openWorkspace(workspaceId: string, gadgetId?: number): Promise<void>;
  resolveWorkspaceTitles(ids: string[]): Promise<(string | null)[]>;
  openPrompt(prompt: string): Promise<void>;
  uploadText(scope: string, text: string): Promise<string>;
  downloadReviewText(review: string, node: string, version: number, side: "before" | "after"): Promise<string | null>;
  downloadText(scope: string, resource: string, version: string, side: number): Promise<string>;
  downloadNativeDocument(scope: string, resource: string, publication: string, format: NativeDocumentFormat): Promise<NativeDocumentSnapshot>;
}

class EmptyUi extends RpcTarget {}

describe("SandboxedGatekeeperApp navigation", () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;
  let host: RpcStub<TestHost> | undefined;

  beforeEach(() => {
    listGadgets.mockClear();
  });

  afterEach(async () => {
    host?.[Symbol.dispose]();
    await act(async () => root?.unmount());
    container?.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("routes validated targets and bounded prompts from the iframe host", async () => {
    const frame = {
      iframeHtml: "<!doctype html><title>Scheduler</title>",
      ui: new RpcStub(new EmptyUi()),
    } as unknown as GatekeeperUiFrame;
    const rootRoute = createRootRoute({
      component: () => <SandboxedGatekeeperApp frame={frame} gatekeeperVendorId="scheduler" />,
    });
    const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/" });
    const gadgetRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/workspace/$id",
    });
    const history = createMemoryHistory({ initialEntries: ["/"] });
    const router = createRouter({
      history,
      routeTree: rootRoute.addChildren([indexRoute, gadgetRoute]),
    });

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root!.render(<RouterProvider router={router} />));

    const iframe = container.querySelector("iframe");
    if (!iframe) throw new Error("Missing gatekeeper iframe");
    const { port1, port2 } = new MessageChannel();
    host = newMessagePortRpcSession<TestHost>(port1);
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "handshake" },
        origin: "null",
        source: iframe.contentWindow,
        ports: [port2],
      }),
    );

    const confirmLeave = vi.spyOn(window, "confirm").mockReturnValue(false);
    await host!.setUnsavedChanges(true);
    await act(async () => {
      await host!.openWorkspace(WORKSPACE_ID, 2);
      await vi.waitFor(() => expect(confirmLeave).toHaveBeenCalledOnce());
    });
    expect(router.state.location.pathname).toBe("/");
    // После успешного сохранения оболочка разрешает тот же переход без нового вопроса.
    await host!.setUnsavedChanges(false);
    await act(async () => {
      await host!.openWorkspace(WORKSPACE_ID, 2);
      await vi.waitFor(() =>
        expect(router.state.location.pathname).toBe(`/workspace/${WORKSPACE_ID}`),
      );
    });
    expect(router.state.location.search).toEqual({ w: 2 });

    // Live titles come from the user's own gadget list, never from the app's snapshot. Concurrent
    // and repeated frame requests share a bounded-lifetime host-side index.
    const now = vi.spyOn(Date, "now").mockReturnValue(0);
    listGadgets
      .mockResolvedValueOnce([{ id: WORKSPACE_ID, title: "Daily Brief" }])
      .mockResolvedValueOnce([{ id: WORKSPACE_ID, title: "Renamed Brief" }]);
    await expect(
      Promise.all([
        host.resolveWorkspaceTitles([WORKSPACE_ID, "b".repeat(64)]),
        host.resolveWorkspaceTitles([WORKSPACE_ID]),
      ]),
    ).resolves.toEqual([["Daily Brief", null], ["Daily Brief"]]);
    await expect(host.resolveWorkspaceTitles([WORKSPACE_ID])).resolves.toEqual(["Daily Brief"]);
    expect(listGadgets).toHaveBeenCalledTimes(1);

    now.mockReturnValue(30_000);
    await expect(host.resolveWorkspaceTitles([WORKSPACE_ID])).resolves.toEqual(["Renamed Brief"]);
    expect(listGadgets).toHaveBeenCalledTimes(2);

    await expect(host.openWorkspace("../evil")).rejects.toThrow(
      "Invalid gatekeeper app workspace target",
    );
    expect(router.state.location.pathname).toBe(`/workspace/${WORKSPACE_ID}`);

    await act(async () => {
      await host!.openPrompt("  Create a daily brief.  ");
      await vi.waitFor(() => expect(router.state.location.pathname).toBe("/"));
    });
    expect(router.state.location.search).toEqual({ prompt: "Create a daily brief." });
    await host!.setUnsavedChanges(true);
    confirmLeave.mockReturnValue(true);
    await act(async () => {
      await host!.openWorkspace(WORKSPACE_ID);
      await vi.waitFor(() => expect(router.state.location.pathname).toBe(`/workspace/${WORKSPACE_ID}`));
    });
    const prompts = confirmLeave.mock.calls.length;
    confirmLeave.mockReturnValue(false);
    prepareForLogout();
    await act(async () => {
      await host!.openPrompt("После выхода");
      await vi.waitFor(() => expect(router.state.location.pathname).toBe("/"));
    });
    expect(confirmLeave).toHaveBeenCalledTimes(prompts);

  });
  it("открывает раздел в том же приложении и сохраняет выбранное подключение", async () => {
    const frame = { iframeHtml: "<!doctype html><title>Mnemos</title>", ui: new RpcStub(new EmptyUi()) } as unknown as GatekeeperUiFrame;
    const rootRoute = createRootRoute({ component: () => <SandboxedGatekeeperApp frame={frame} gatekeeperVendorId="mnemos" /> });
    const appRoute = createRoute({ getParentRoute: () => rootRoute, path: "/gatekeepers/$appId" });
    const router = createRouter({ history: createMemoryHistory({ initialEntries: ["/gatekeepers/mnemos?account=8&section=projects"] }), routeTree: rootRoute.addChildren([appRoute]) });
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    await act(async () => root!.render(<RouterProvider router={router} />));
    const iframe = container.querySelector("iframe")!;
    const {port1,port2} = new MessageChannel(); host = newMessagePortRpcSession<TestHost>(port1);
    window.dispatchEvent(new MessageEvent("message", {data:{type:"handshake"}, origin:"null", source:iframe.contentWindow,ports:[port2]}));
    window.history.replaceState(null,"","/?section=projects");
    expect(await host.getSelectedSection()).toBe("projects");
    await expect(host.openSection("../admin")).rejects.toThrow("Некорректный раздел");
    const confirmLeave = vi.spyOn(window,"confirm").mockReturnValue(false);
    await host.setUnsavedChanges(true);
    await act(async () => { await host!.openSection("documents"); await vi.waitFor(()=>expect(confirmLeave).toHaveBeenCalledOnce()); });
    expect(router.state.location.search).toEqual({account:8,section:"projects"});
    await act(async () => { void router.navigate({to:"/gatekeepers/$appId",params:{appId:"mnemos"},search:{account:9,section:"projects"}}); await vi.waitFor(()=>expect(confirmLeave).toHaveBeenCalledTimes(2)); });
    expect(confirmLeave).toHaveBeenCalledTimes(2);
    expect(router.state.location.search).toEqual({account:8,section:"projects"});
    await host.setUnsavedChanges(false);

    await act(async () => { await host!.openSection("documents"); await vi.waitFor(() => expect(router.state.location.search).toEqual({account:8,section:"documents"})); });
    expect(router.state.location.pathname).toBe("/gatekeepers/mnemos");
    window.history.replaceState(null,"","/");
  });
  it("приём рядом с беседой выбирает раздел без URL и закрывается только из своего фрейма", async () => {
    const closed=vi.fn();
    const frame={iframeHtml:"<!doctype html><title>Intake</title>",ui:new RpcStub(new EmptyUi()),inboxUploads:{storageOrigin:"https://storage.example",issuer:new RpcStub(new EmptyUi())}} as unknown as GatekeeperUiFrame;
    const route=createRootRoute({component:()=> <SandboxedGatekeeperApp frame={frame} gatekeeperVendorId="mnemos" embeddedIntake onClosePanel={closed}/>});
    const router=createRouter({history:createMemoryHistory({initialEntries:["/?chat=17"]}),routeTree:route});
    container=document.createElement("div");document.body.append(container);root=createRoot(container);
    await act(async()=>root!.render(<RouterProvider router={router}/>));
    const iframe=container.querySelector("iframe")!;
    const {port1,port2}=new MessageChannel();host=newMessagePortRpcSession<TestHost>(port1);
    window.dispatchEvent(new MessageEvent("message",{data:{type:"handshake"},origin:"null",source:iframe.contentWindow,ports:[port2]}));
    expect(await host.getSelectedSection()).toBe("intake");expect(await host.getPresentationMode()).toBe("panel");
    expect(router.state.location.href).toBe("/?chat=17");
    expect(container.querySelector('[aria-label="Перетащите материалы организации"]')).not.toBeNull();
    window.dispatchEvent(new MessageEvent("message",{data:{type:"mnemos-intake-close"},origin:"null",source:window}));expect(closed).not.toHaveBeenCalled();
    window.dispatchEvent(new MessageEvent("message",{data:{type:"mnemos-intake-close"},origin:"null",source:iframe.contentWindow}));expect(closed).toHaveBeenCalledOnce();
  });
  it("смена организации отменяет ожидающий drop и очищает его состояние", async () => {
    let issued=0;
    class Issuer extends RpcTarget {issue(){issued++;throw Error("unexpected upload")} submit(){throw Error("unexpected submit")}}
    const first={iframeHtml:"<!doctype html><title>First</title>",ui:new RpcStub(new EmptyUi()),inboxUploads:{storageOrigin:"https://storage.example",issuer:new RpcStub(new Issuer())}} as unknown as GatekeeperUiFrame;
    const second={...first,iframeHtml:"<!doctype html><title>Second</title>",ui:new RpcStub(new EmptyUi()),inboxUploads:{storageOrigin:"https://other.example",issuer:new RpcStub(new Issuer())}} as unknown as GatekeeperUiFrame;
    let replaceFrame:(frame:GatekeeperUiFrame)=>void=()=>{};
    const rootRoute=createRootRoute({component:()=>{const [frame,setFrame]=useState(first);replaceFrame=setFrame;return <SandboxedGatekeeperApp frame={frame} gatekeeperVendorId="mnemos"/>}});
    const router=createRouter({history:createMemoryHistory({initialEntries:["/"]}),routeTree:rootRoute.addChildren([createRoute({getParentRoute:()=>rootRoute,path:"/"})])});
    window.history.replaceState(null,"","/?section=intake");
    container=document.createElement("div");document.body.append(container);root=createRoot(container);
    await act(async()=>root!.render(<RouterProvider router={router}/>));
    const connect=()=>{const {port1,port2}=new MessageChannel();host=newMessagePortRpcSession<TestHost>(port1);window.dispatchEvent(new MessageEvent("message",{data:{type:"handshake"},origin:"null",source:container!.querySelector("iframe")!.contentWindow,ports:[port2]}));};
    connect();
    let finish:((file:File)=>void)|undefined;
    const transfer={items:[{kind:"file",getAsFile:()=>null,webkitGetAsEntry:()=>({name:"Закрытая папка.txt",isFile:true,isDirectory:false,file:(done:(file:File)=>void)=>{finish=done}})}]};
    const event=new Event("drop",{bubbles:true,cancelable:true});Object.defineProperty(event,"dataTransfer",{value:transfer});
    await act(async()=>container!.querySelector('[aria-label="Перетащите материалы организации"]')!.dispatchEvent(event));
    expect(finish).toBeDefined();
    const oldHost=host;
    await act(async()=>replaceFrame(second));oldHost?.[Symbol.dispose]();connect();
    await act(async()=>{finish!(new File(["private"],"Закрытая папка.txt"));await Promise.resolve();});
    expect(issued).toBe(0);
    expect(container.textContent).not.toContain("Читаем файлы");
    expect(container.textContent).not.toContain("Закрытая папка");
    expect(container.querySelector("progress")).toBeNull();
    window.history.replaceState(null,"","/");
  });
  it("закрытие приёма отменяет текущий PUT и сохраняет уже принятый файл", async()=>{
    const {webcrypto}=await vi.importActual<{webcrypto:Crypto}>("node:crypto");
    const {File:RealFile}=await vi.importActual<{File:typeof File}>("node:buffer");vi.stubGlobal("crypto",webcrypto);vi.stubGlobal("File",RealFile);
    const submitted:string[]=[];let count=0;let signal:AbortSignal|undefined;
    class Issuer extends RpcTarget {
      issue(size:number,checksum:string){return {upload_id:String(++count),url:"https://storage.example/file",method:"PUT",checksum_header:"x-amz-checksum-sha256",checksum_value:checksum,content_length:size};}
      submit(_id:string,path:string){submitted.push(path);return {outcome:"enqueued",enqueued:true};}
    }
    const request=vi.fn(async(_url:string,init:RequestInit)=>{expect(init.body).toBeInstanceOf(File);expect(init.credentials).toBe("omit");if(count===1)return new Response(null,{status:200});signal=init.signal as AbortSignal;return new Promise<Response>((_,reject)=>signal!.addEventListener("abort",()=>reject(Error("abort")),{once:true}));});vi.stubGlobal("fetch",request);
    const frame={iframeHtml:"<!doctype html><title>Intake</title>",ui:new RpcStub(new EmptyUi()),inboxUploads:{storageOrigin:"https://storage.example",issuer:new RpcStub(new Issuer())}} as unknown as GatekeeperUiFrame;
    const route=createRootRoute({component:()=> <SandboxedGatekeeperApp frame={frame} gatekeeperVendorId="mnemos" embeddedIntake/>});
    const router=createRouter({history:createMemoryHistory({initialEntries:["/"]}),routeTree:route});
    container=document.createElement("div");document.body.append(container);root=createRoot(container);await act(async()=>root!.render(<RouterProvider router={router}/>));
    const {port1,port2}=new MessageChannel();host=newMessagePortRpcSession<TestHost>(port1);window.dispatchEvent(new MessageEvent("message",{data:{type:"handshake"},origin:"null",source:container.querySelector("iframe")!.contentWindow,ports:[port2]}));
    const event=new Event("drop",{bubbles:true,cancelable:true});Object.defineProperty(event,"dataTransfer",{value:{files:[new File(["first"],"первый.txt"),new File(["second"],"второй.txt")],items:[]}});
    await act(async()=>{container!.querySelector('[aria-label="Перетащите материалы организации"]')!.dispatchEvent(event);await vi.waitFor(()=>expect(request).toHaveBeenCalledTimes(2));});
    expect(submitted).toEqual(["первый.txt"]);
    await act(async()=>root!.render(null));expect(signal?.aborted).toBe(true);expect(submitted).toEqual(["первый.txt"]);
  });
  it("uploads through the real host port and cancels transfer when the frame closes", async () => {
    const { webcrypto } = await vi.importActual<{ webcrypto: Crypto }>("node:crypto");
    vi.stubGlobal("crypto", webcrypto);
    let calls = 0;
    class Issuer extends RpcTarget {
      async issue(scope: string, size: number, checksum: string) {
        expect(scope).toBe("project");
        calls++;
        return { upload_id: "receipt", url: "https://objects.example/file?signed=secret",
          method: "PUT", checksum_header: "x-amz-checksum-sha256",
          checksum_value: checksum, content_length: size };
      }
    }
    let readable = true;
    const snapshot = { format: "cloudflareos.document", formatVersion: 1,
      document: { title: "Заметка", blocks: [{ id: "one", html: "<p><strong>Текст</strong></p>" }] } };
    const nativeBody = JSON.stringify(snapshot);
    let nativeDisposed = 0;
    class NativeDownload extends RpcTarget {
      async issue() {
        const bytes = new TextEncoder().encode(nativeBody);
        const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
        return { url: "https://objects.example/native?signed=secret", method: "GET", size_bytes: bytes.length,
          sha256_hex: Array.from(digest, b => b.toString(16).padStart(2, "0")).join(""), content_type: "application/json" };
      }
      async validate() { if (!readable) throw new Error("private revocation details"); }
      [Symbol.dispose]() { nativeDisposed++; }
    }
    class NativeSelector extends RpcTarget {
      async select(scope: string, resource: string, publication: string) {
        expect([scope, resource, publication]).toEqual(["project", "doc", "publication"]);
        return new RpcStub(new NativeDownload());
      }
    }
    class DownloadIssuer extends RpcTarget {
      async issue(scope: string, resource: string, version: string, side: number) {
        expect([scope, resource, version, side]).toEqual(["project", "doc", "version", 0]);
        const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("draft")));
        return { url: "https://objects.example/file?signed=secret", method: "GET", size_bytes: 5,
          sha256_hex: Array.from(digest, b => b.toString(16).padStart(2, "0")).join("") };
      }
      async validate() { if (!readable) throw new Error("revoked"); }
    }
    class ReviewIssuer extends RpcTarget {
      async issue(review: string, node: string, version: number, side: "before" | "after") {
        expect([review, node, version]).toEqual(["review", "doc", 3]);
        return side === "before" ? null : new DownloadIssuer().issue("project", "doc", "version", 0);
      }
      async validate() { if (!readable) throw new Error("revoked"); }
    }
    const reviewIssuer = new RpcStub(new ReviewIssuer());
    const downloadIssuer = new RpcStub(new DownloadIssuer());
    const issuer = new RpcStub(new Issuer());
    const ui = new RpcStub(new EmptyUi());
    const nativeSelector = new RpcStub(new NativeSelector());
    const frame = { iframeHtml: "<!doctype html><title>Mnemos</title>", ui,
      textUploads: { storageOrigin: "https://objects.example", issuer },
      reviewDownloads: { storageOrigin: "https://objects.example", issuer: reviewIssuer },
      textDownloads: { storageOrigin: "https://objects.example", issuer: downloadIssuer },
      nativeDownloads: { storageOrigin: "https://objects.example", selector: nativeSelector },
    } as unknown as GatekeeperUiFrame;
    let pendingSignal: AbortSignal | undefined;
    const request = vi.fn(async (url: string, init: RequestInit) => {
      expect(init.credentials).toBe("omit");
      expect(init.redirect).toBe("error");
      if (url === "https://objects.example/native?signed=secret") return new Response(nativeBody);
      expect(url).toBe("https://objects.example/file?signed=secret");
      if (init.method !== "PUT") return new Response("draft");
      if (calls === 1) return new Response(null, { status: 200 });
      pendingSignal = init.signal as AbortSignal;
      return new Promise<Response>((_, reject) => pendingSignal!.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
    });
    vi.stubGlobal("fetch", request);
    const route = createRootRoute({ component: () => <SandboxedGatekeeperApp frame={frame} gatekeeperVendorId="mnemos" /> });
    const router = createRouter({ history: createMemoryHistory({ initialEntries: ["/"] }),
      routeTree: route.addChildren([createRoute({ getParentRoute: () => route, path: "/" })]) });
    container = document.createElement("div"); document.body.append(container);
    root = createRoot(container);
    await act(async () => root!.render(<RouterProvider router={router} />));
    const iframe = container.querySelector("iframe")!;
    const { port1, port2 } = new MessageChannel();
    host = newMessagePortRpcSession<TestHost>(port1);
    window.dispatchEvent(new MessageEvent("message", { data: { type: "handshake" }, origin: "null", source: iframe.contentWindow, ports: [port2] }));
    try {
      await expect(host.uploadText("project", "Привет")).resolves.toBe("receipt");
      expect(new TextDecoder().decode(request.mock.calls[0][1].body as Uint8Array)).toBe("Привет");
      await expect(host.downloadText("project", "doc", "version", 0)).resolves.toBe("draft");
      await expect(host.downloadNativeDocument("project", "doc", "publication", "cloudflareos.document")).resolves.toEqual(snapshot);
      await vi.waitFor(() => expect(nativeDisposed).toBe(1));
      await expect(host.downloadReviewText("review", "doc", 3, "after")).resolves.toBe("draft");
      const beforeAbsent = request.mock.calls.length;
      await expect(host.downloadReviewText("review", "doc", 3, "before")).resolves.toBeNull();
      expect(request.mock.calls.length).toBe(beforeAbsent);
      readable = false;
      await expect(host.downloadNativeDocument("project", "doc", "publication", "cloudflareos.document")).rejects.toThrow("Native document download failed.");
      await vi.waitFor(() => expect(nativeDisposed).toBe(2));
      await expect(host.downloadReviewText("review", "doc", 3, "after")).rejects.toThrow("Document download failed.");
      await expect(host.downloadReviewText("review", "doc", 3, "before")).rejects.toThrow("Document download failed.");
      await expect(host.downloadText("project", "doc", "version", 0)).rejects.toThrow("Document download failed.");
      const pending = host.uploadText("project", "second").then(() => "resolved", () => "rejected");
      await vi.waitFor(() => expect(pendingSignal).toBeDefined());
      await expect(host.uploadText("project", "duplicate")).rejects.toThrow("Document upload unavailable.");
      expect(calls).toBe(2);
      await act(async () => root!.unmount()); root = undefined;
      expect(pendingSignal!.aborted).toBe(true);
      expect(await pending).toBe("rejected");
    } finally { nativeSelector[Symbol.dispose](); reviewIssuer[Symbol.dispose](); issuer[Symbol.dispose](); downloadIssuer[Symbol.dispose](); ui[Symbol.dispose](); }
  });

});
