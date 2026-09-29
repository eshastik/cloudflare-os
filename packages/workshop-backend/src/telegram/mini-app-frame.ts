import { MINI_APP_EDITOR_FRAME_CSP, MINI_APP_EDITOR_FRAME_HTML } from "@gadgets/workshop-shared/telegram-mini-app";

/** Фрейм редактора Mini App: статическая разметка со своим заголовком CSP (см. telegram-mini-app.ts).
 *  Данных в ответе нет: код редактора фрейм получает от страницы сообщением. */
export function handleMiniAppEditorFrame(req: Request): Response {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
  }
  return new Response(req.method === "HEAD" ? null : MINI_APP_EDITOR_FRAME_HTML, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": MINI_APP_EDITOR_FRAME_CSP,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-cache",
    },
  });
}
