// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */

import { act } from "react";
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

vi.mock("./AuthContext", () => ({
  useAuthenticatedApi: () => ({ authenticatedApi: { listGadgets } }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface TestHost extends RpcTarget {
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
