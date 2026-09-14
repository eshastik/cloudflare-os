import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@cloudflare/kumo";
import { RpcTarget, newMessagePortRpcSession } from "capnweb";
import { mountLegacy, type Host } from "../app/main.ts";
import { HostProvider, makeHostContext } from "./host.ts";
import MemoryPage from "./MemoryPage.tsx";
import { applyThemeMode } from "./theme.ts";
import "./styles.css";

class Frame extends RpcTarget {
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

  // Прежние разделы монтируются сразу, но скрыты до вкладки «Ещё»: их состояние и загрузка не зависят от React.
  mountLegacy(legacy, host);

  createRoot(root).render(
    <HostProvider value={makeHostContext(host, legacy)}>
      <TooltipProvider>
        <MemoryPage legacy={legacy} />
      </TooltipProvider>
    </HostProvider>,
  );
}

// Скрипт стоит в <head> как классический, поэтому разметка ниже ещё не разобрана.
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", main, { once: true });
else main();
