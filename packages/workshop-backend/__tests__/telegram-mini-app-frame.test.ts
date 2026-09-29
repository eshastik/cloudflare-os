// Фрейм редактора Mini App отдаётся своим адресом со своим заголовком CSP: страница Mini App не
// разрешает data:-скрипты, а фрейм — разрешает, но без сети и без происхождения страницы.
import { env, createExecutionContext } from "cloudflare:test";
import { expect, it } from "vitest";
import {
  MINI_APP_EDITOR_FRAME_CSP, MINI_APP_EDITOR_FRAME_HTML, MINI_APP_EDITOR_FRAME_PATH,
} from "@gadgets/workshop-shared/telegram-mini-app";
import worker from "../src/server";

const fetchWorker = (req: Request) => worker.fetch(req, env as never, createExecutionContext());

it("адрес фрейма отдаёт разметку с заголовком CSP фрейма", async () => {
  const res = await fetchWorker(new Request(`https://mnemos.example${MINI_APP_EDITOR_FRAME_PATH}`));
  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
  expect(res.headers.get("Content-Security-Policy")).toBe(MINI_APP_EDITOR_FRAME_CSP);
  expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  const body = await res.text();
  expect(body).toBe(MINI_APP_EDITOR_FRAME_HTML);
  // Разметку редактора фрейм принимает только от родителя.
  expect(body).toContain("event.source !== parent");
});

it("политика фрейма закрывает сеть и вложенные фреймы", () => {
  const csp = new Map(MINI_APP_EDITOR_FRAME_CSP.split(";").map(p => p.trim().split(/\s+/)).map(([k, ...v]) => [k, v.join(" ")]));
  expect(csp.get("default-src")).toBe("'none'");
  expect(csp.get("connect-src")).toBe("'none'");
  expect(csp.get("frame-src")).toBe("'none'");
  expect(csp.get("form-action")).toBe("'none'");
});

it("фрейм изолирован при любом встраивании и встраивается только своей страницей и Telegram Web", () => {
  const csp = new Map(MINI_APP_EDITOR_FRAME_CSP.split(";").map(p => p.trim().split(/\s+/)).map(([k, ...v]) => [k, v.join(" ")]));
  // Без allow-same-origin: происхождение фрейма непрозрачно, даже если чужой сайт встроит его без атрибута sandbox.
  expect(csp.get("sandbox")).toBe("allow-scripts");
  expect(csp.get("frame-ancestors")).toBe("'self' https://web.telegram.org");
});

it("фрейм принимает только GET и HEAD", async () => {
  const res = await fetchWorker(new Request(`https://mnemos.example${MINI_APP_EDITOR_FRAME_PATH}`, { method: "POST", body: "x" }));
  expect(res.status).toBe(405);
  const head = await fetchWorker(new Request(`https://mnemos.example${MINI_APP_EDITOR_FRAME_PATH}`, { method: "HEAD" }));
  expect(head.status).toBe(200);
  expect(head.headers.get("Content-Security-Policy")).toBe(MINI_APP_EDITOR_FRAME_CSP);
});
