// Разметка изолированного фрейма гаджета (srcdoc): Cap'n Web, связь с родителем через MessagePort,
// защитные заплатки окна. Общая для рабочего места и редактора в Telegram Mini App.
import { FRAME_THEME_SCRIPT, HOST_BASE_CSS, hostRootAttributes, type HostTheme } from './gadgetHostTheme'
import CAPNWEB_BUNDLE from 'capnweb?raw'

// We want to inject Cap'n Web into the Gadget. Luckily it has no dependencies, so we can just take
// the whole module and embed it. We can import the module using ?raw to get a string of the
// content.
let CAPNWEB_BUNDLE_ANNOTATED = `//# sourceURL=jsrpc.js\n${CAPNWEB_BUNDLE}`

// Unfortunately, we will have to embed the code as a data: URL, because our iframe is totally
// sandboxed. Even more unfortunately, since it's a module which we need to import from, we can't
// use the data URL as a <script> tag's source. Instead, we have to use it in an import statement.
// And, guess what? That import statement is going to appear in code which is *also* embedded in
// a data: URL, so we have a doubly-nested data: URL. We'll use base64 encoding for the inner
// data: and URL encoding for the outer, as this largely avoids double-escaping.
//
// In any case, we'll prefix the gadget code with this prefix which imports the Cap'n Web library
// (from a massive data URL) and sets up the RPC connection to the parent.
let INJECTED_CODE_PREFIX = encodeURIComponent(String.raw`//# sourceURL=client.js
import { RpcTarget, RpcStub, newMessagePortRpcSession } from "data:text/javascript;charset=utf-8;base64,${btoa(CAPNWEB_BUNDLE_ANNOTATED)}";

let gadget;  // RPC stub to the gadget's server-side Durable Object.
{
  let {port1, port2} = new MessageChannel();
  window.parent.postMessage("handshake", "*", [port2]);
  gadget = newMessagePortRpcSession(port1);
}

// Monkey-patch console to forward logs to the parent frame.
for (let level of ['debug', 'info', 'log', 'warn', 'error']) {
  let original = console[level];
  console[level] = (...args) => {
    original.apply(console, args);
    try {
      let message = args.map(arg => {
        if (typeof arg === 'string') return arg;
        try { return JSON.stringify(arg); }
        catch { return String(arg); }
      });
      window.parent.postMessage({ type: 'console', level, message }, '*');
    } catch {};
  };
}

// Allow user-activated target=_blank links, but block programmatic popups.
const blockedOpen = () => {
  console.error('window.open() is disabled in Gadget UIs. Use a link with target="_blank" instead.');
  return null;
};
window.open = blockedOpen;
globalThis.open = blockedOpen;
try {
  Window.prototype.open = blockedOpen;
} catch {}

// Report only the occurrence of genuine input, never its key, target or contents.
{
let lastActivityReport = -Infinity;
for (const name of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
  window.addEventListener(name, event => {
    const now = performance.now();
    if (!event.isTrusted || now - lastActivityReport < 1000) return;
    lastActivityReport = now;
    window.parent.postMessage({ type: 'workspace-activity' }, '*');
  }, { capture: true, passive: true });
}
}

// Forward Escape key presses to the parent frame. The sandboxed iframe captures keydown events
// when it has focus, so the parent never sees them. The workshop UI uses Escape to exit fullscreen
// gadget mode, so forward it explicitly.
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    window.parent.postMessage({ type: 'escape' }, '*');
  }
}, true);

window.addEventListener('click', (event) => {
  if (!(event.target instanceof Element)) {
    return;
  }

  const anchor = event.target.closest('a[href][target]');
  if (!anchor || anchor.target.toLowerCase() !== '_blank') {
    return;
  }

  // A link to the Workshop itself (a document, project, chat) opens in the same page: the parent
  // navigates on the user's click. Only other sites get a new tab.
  let url;
  try { url = new URL(anchor.getAttribute('href'), shellOrigin); } catch { url = null; }
  if (url && url.origin === shellOrigin) {
    event.preventDefault();
    window.parent.postMessage({ type: 'open-internal', path: url.pathname + url.search + url.hash }, '*');
    return;
  }

  const rel = new Set((anchor.getAttribute('rel') || '').split(/\s+/).filter(Boolean));
  rel.add('noopener');
  anchor.setAttribute('rel', Array.from(rel).join(' '));
}, true);

${FRAME_THEME_SCRIPT}
// Capture unhandled exceptions and promise rejections.
window.addEventListener('error', (event) => {
  window.parent.postMessage({
    type: 'console',
    level: 'error',
    message: ['Uncaught', event.error?.stack || event.message],
  }, '*');
});
window.addEventListener('unhandledrejection', (event) => {
  let reason = event.reason;
  window.parent.postMessage({
    type: 'console',
    level: 'error',
    message: ['Unhandled promise rejection:', reason?.stack || String(reason)],
  }, '*');
});

`);

/** Разметка фрейма. theme — тема и акцент оболочки на момент создания: первый кадр гаджета уже в них,
 *  дальнейшие смены приходят сообщением host-theme. Базовые токены Mnemos стоят в <head> до кода гаджета. */
export const createSandboxedHtml = (jsCode: string, readinessId?: string, theme: HostTheme = { mode: 'light', accent: null }): string => {
  return `<!DOCTYPE html>
<html${hostRootAttributes(theme)}>
<head>
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src 'none'; script-src data: 'unsafe-inline'; style-src data: 'unsafe-inline'; img-src data:; media-src data:; object-src 'none'; base-uri 'none'; form-action 'none'; connect-src 'none';">
  <style id="mnemos-host-tokens">${HOST_BASE_CSS}</style>
</head>
<body>
    <script type="module" src="data:text/javascript;charset=utf-8,${INJECTED_CODE_PREFIX}${encodeURIComponent(`const nativeUIReadinessAttempt = ${JSON.stringify(readinessId ?? null)};\nconst shellOrigin = ${JSON.stringify(window.location.origin)};\n` + jsCode)}"></script>
</body>
</html>`.trim()
}
