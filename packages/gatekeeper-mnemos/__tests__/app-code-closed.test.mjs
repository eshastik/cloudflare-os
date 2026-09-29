// Код приложения закрыт (ADR 0028, п. 4): выдачи кадра страницы отказывают в теле узла приложения,
// служебный кадр сервера оболочки (AppUiContext.appCode) получает его для запуска; документ — как раньше.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Miniflare } from "miniflare";
import { fileURLToPath } from "node:url";

const APP = "application/vnd.cloudflareos.app+json";
const H = "a".repeat(64), D = "d".repeat(64);
const KEY = "shell-key-" + "k".repeat(40);

function fixture({ key = KEY, appCodeRefusal = null } = {}) {
  const appCodeCalls = [];
  const mf = new Miniflare({
    workers: [
      {
        name: "mnemos", modules: true,
        modulesRules: [{ type: "Text", include: ["**/*.txt"] }],
        scriptPath: fileURLToPath(new URL("../dist/mnemos.js", import.meta.url)),
        compatibilityDate: "2026-02-02", compatibilityFlags: ["allow_irrevocable_stub_storage", "nodejs_compat"],
        bindings: { MNEMOS_API_ORIGIN: "https://memory.example", MNEMOS_STORAGE_ORIGIN: "https://objects.example", ...(key ? { MNEMOS_SHELL_KEY: key } : {}) },
        durableObjects: { ACCOUNTS: { className: "UserAccount", useSQLite: true } },
        outboundService: async request => {
          const path = new URL(request.url).pathname;
          const ticket = (node, type, extra = {}) => Response.json({ node_id: node, url: `https://objects.example/${node}`, method: "GET", size_bytes: 4, sha256_hex: "b".repeat(64), content_type: type, ...extra });
          if (path === "/v1/projects/project/nodes/app/app-code") {
            const version = new URL(request.url).searchParams.get("version") ?? "";
            appCodeCalls.push({ version, key: request.headers.get("X-Mnemos-Shell-Key"), token: request.headers.get("Authorization") });
            if (appCodeRefusal) return Response.json({ code: appCodeRefusal[1], message: "отказ" }, { status: appCodeRefusal[0] });
            return Response.json({ content_type: APP, node_id: "app", version, head: H, url: "https://objects.example/app-code", method: "GET", size_bytes: 4, sha256_hex: "b".repeat(64), expires_at: "2026-09-29T10:00:10Z" });
          }
          // Обычные выдачи тела гаджета Mnemos закрыл сам.
          if (path === `/v1/projects/project/nodes/app/private-versions/${H}/download` || path === "/v1/projects/project/nodes/app/history/ev/download") return Response.json({ code: "gadget_code_closed", message: "закрыто" }, { status: 403 });
          if (path === "/v1/whoami") return Response.json({ subject: { tenant_id: "org", user_id: "alice" }, tenant_name: "Org" });
          if (path === "/v1/projects/project/draft/nodes/app") return Response.json({ head: H, node_id: "app", exists: true, content_type: APP });
          if (path === "/v1/projects/project/draft/nodes/doc") return Response.json({ head: D, node_id: "doc", exists: true, content_type: "text/plain" });
          if (path === "/v1/projects/project/draft/nodes/doc/download") return Response.json({ head: D, node_id: "doc", term_index: 0, url: "https://objects.example/doc", method: "GET", size_bytes: 4, sha256_hex: "b".repeat(64) });
          if (path === "/v1/projects/project/draft/nodes/app/download") return Response.json({ head: H, node_id: "app", term_index: 0, url: "https://objects.example/app", method: "GET", size_bytes: 4, sha256_hex: "b".repeat(64) });
          if (path === `/v1/projects/project/nodes/app/private-versions/${H}/access`) return Response.json({ node_id: "app", head: H });
          if (path === "/v1/projects/project/nodes/doc/history/docev/download") return ticket("doc", "application/vnd.cloudflareos.document+json", { event_id: "docev" });
          if (/\/v1\/projects\/project\/nodes\/(app|doc)\/history$/.test(path)) return Response.json({ events: [] });
          return new Response("unexpected " + path, { status: 500 });
        },
      },
      {
        name: "driver", modules: true, compatibilityDate: "2026-02-02", compatibilityFlags: ["allow_irrevocable_stub_storage", "nodejs_compat"],
        durableObjects: { ACCOUNTS: { className: "UserAccount", scriptName: "mnemos", useSQLite: true } },
        script: `export default { async fetch(request, env) {
          const account = env.ACCOUNTS.get(env.ACCOUNTS.idFromName("owner"));
          await account.acceptVerifiedCredential("fixture-human-token");
          const refusal = async call => { try { await call(); return "выдано"; } catch (error) { return error.message; } };
          const page = await account.startAppUi();
          const host = await account.startAppUi(true);
          const hostTicket = async version => (await host.nativeDownloads.selector.appCode("project", "app", version)).issue();
          const out = {
            pageDraft: await refusal(() => page.textDownloads.issuer.issue("project", "app", "${H}", 0)),
            pagePrivate: await refusal(() => page.textDownloads.issuer.issue("project", "app", "private:${H}", 0)),
            pagePublication: await refusal(async () => (await page.nativeDownloads.selector.select("project", "app", "ev")).issue()),
            pageSelectPrivate: await refusal(async () => (await page.nativeDownloads.selector.select("project", "app", "private:${H}")).issue()),
            pageAppCode: await refusal(async () => (await page.nativeDownloads.selector.appCode("project", "app", "ev")).issue()),
            hostText: await refusal(() => host.textDownloads.issuer.issue("project", "app", "private:${H}", 0)),
            hostSelect: await refusal(async () => (await host.nativeDownloads.selector.select("project", "app", "ev")).issue()),
            hostPublication: await refusal(async () => JSON.stringify(await hostTicket("ev"))),
            hostPublicationTicket: await hostTicket("ev").catch(error => ({ error: error.message })),
            hostPrivate: await hostTicket("private:${H}").catch(error => ({ error: error.message })),
            docDraft: (await page.textDownloads.issuer.issue("project", "doc", "${D}", 0)).node_id,
            docNative: (await (await page.nativeDownloads.selector.select("project", "doc", "docev")).issue()).content_type,
          };
          return Response.json(out);
        }};`,
      },
    ],
  });
  return { mf, appCodeCalls, run: async () => { const response = await (await mf.getWorker("driver")).fetch("https://driver.example/"); assert.equal(response.status, 200); return response.json(); } };
}

test("тело узла приложения: странице и агенту — отказ с понятным текстом, серверу оболочки — служебный путь app-code с ключом; документ как раньше", async () => {
  const { mf, appCodeCalls, run } = fixture();
  try {
    const out = await run();
    const closed = "Код приложения закрыт: платформа не выдаёт его ни странице, ни агенту беседы. Изменить приложение можно через агента кода в беседе.";
    for (const key of ["pageDraft", "pagePrivate", "pagePublication", "pageSelectPrivate", "pageAppCode", "hostText", "hostSelect"]) assert.ok(out[key].includes(closed), `${key}: ${out[key]}`);
    assert.deepEqual(out.hostPublicationTicket, { url: "https://objects.example/app-code", method: "GET", size_bytes: 4, sha256_hex: "b".repeat(64), content_type: APP });
    assert.equal(out.hostPrivate.content_type, APP);
    // Служебный путь: ключ оболочки и токен человека уходят только в Mnemos; в ответы кадру ключ не попадает.
    assert.ok(appCodeCalls.length >= 3);
    assert.ok(appCodeCalls.every(call => call.key === KEY && call.token === "Bearer fixture-human-token"));
    assert.deepEqual([...new Set(appCodeCalls.map(call => call.version))].sort(), ["ev", `private:${H}`]);
    assert.ok(!JSON.stringify(out).includes(KEY));
    assert.equal(out.docDraft, "doc");
    assert.equal(out.docNative, "application/vnd.cloudflareos.document+json");
  } finally { await mf.dispose(); }
});

test("app-code: без ключа у gatekeeper и при отказах Mnemos — понятный текст", async () => {
  for (const [options, expected] of [
    [{ key: "" }, "Запуск гаджетов не настроен: нет ключа оболочки."],
    [{ appCodeRefusal: [403, "shell_key_rejected"] }, "Запуск гаджетов не настроен: Mnemos не принял ключ оболочки."],
    [{ appCodeRefusal: [403, "authz.access_denied"] }, "Приложение вам недоступно: нет доступа к этой версии файла."],
    [{ appCodeRefusal: [409, "not_a_gadget"] }, "Этот файл или версия — не приложение."],
  ]) {
    const { mf, appCodeCalls, run } = fixture(options);
    try {
      const out = await run();
      assert.equal(out.hostPublicationTicket.error, expected);
      if (!options.appCodeRefusal) assert.equal(appCodeCalls.length, 0);
    } finally { await mf.dispose(); }
  }
});
