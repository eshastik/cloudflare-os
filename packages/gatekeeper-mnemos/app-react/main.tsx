import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@cloudflare/kumo";
import { RpcTarget, newMessagePortRpcSession } from "capnweb";
import { mountLegacy, type Host } from "../app/main.ts";
import { HostProvider, makeHostContext } from "./host.ts";
import MemoryPage from "./MemoryPage.tsx";
import ErrorBoundary from "./ErrorBoundary.tsx";
import { applyThemeMode, applyAccentColor } from "./theme.ts";
import "./styles.css";

class Frame extends RpcTarget {
  setAccentColor(color: string): void { applyAccentColor(color); }
  setThemeMode(mode: string): void { applyThemeMode(mode); }
}

function main() {
  const root = document.getElementById("root");
  const legacy = document.getElementById("legacy");
  if (!root || !legacy) throw new Error("В разметке нет контейнеров #root и #legacy");

  // До ответа хоста тема берётся из системной настройки; в jsdom matchMedia нет.
  applyThemeMode(typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

  const { port1, port2 } = new MessageChannel();
  const frame = new Frame();
  const host = newMessagePortRpcSession<Host>(port1, frame);
  window.parent.postMessage({ type: "handshake" }, "*", [port2]);
  host.subscribeTheme(frame).then(applyThemeMode).catch(() => {});
  host.subscribeAccent(frame).then(applyAccentColor).catch(() => {});

  // Оболочка показывает слой загрузки файлов, но не видит перетаскивание внутри фрейма.
  // dragenter приходит на каждый элемент под курсором, поэтому сообщение не чаще раза в 300 мс.
  let dragAnnounced = 0;
  window.addEventListener("dragenter", event => {
    const types = event.dataTransfer?.types;
    if (!types || !Array.from(types).includes("Files") || Date.now() - dragAnnounced < 300) return;
    dragAnnounced = Date.now();
    window.parent.postMessage({ type: "mnemos-drag-enter" }, "*");
  });

  // Существующие редакторы сохраняют состояние; их контейнер показывается внутри соответствующего раздела.
  mountLegacy(legacy, host);

  const renderer = createRoot(root);
  window.addEventListener("pagehide", () => renderer.unmount(), { once: true });
  renderer.render(
    <HostProvider value={makeHostContext(host, legacy)}>
      <TooltipProvider>
        <ErrorBoundary>
          <MemoryPage legacy={legacy} />
        </ErrorBoundary>
      </TooltipProvider>
    </HostProvider>,
  );
}

// Скрипт стоит в <head> как классический, поэтому разметка ниже ещё не разобрана.
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", main, { once: true });
else main();
