import { test } from "node:test";
import assert from "node:assert/strict";
import { mountMemoryApp } from "./app-react-harness.mjs";

test("«Источники»: аккаунт, область, проект, разрешённые действия, ошибка доступа с «Переподключить», происхождение копий", async () => {
  const app = await mountMemoryApp({
    async listImapAccounts() { return { servers: [{ id: "yandex", title: "Яндекс", host: "imap.yandex.ru", port: 993 }], accounts: [{ id: "acc-1", server: "yandex", username: "d.sokolov@example.test", mailbox: "INBOX", enabled: true }] }; },
    async listMailConnections() { return { connections: [{ connection_id: "m-1", project_id: "one", provider: "yandex", query_sha256: "", revision: 1, enabled: true }] }; },
    async listCalDAVAccounts() { return { servers: [{ id: "icloud", title: "iCloud", url: "https://caldav.icloud.com" }], accounts: [{ id: "cal-1", server: "icloud", username: "d.sokolov@example.test", enabled: false, calendars: [{ id: "c1", title: "Рабочий календарь" }] }] }; },
    async listWebDAVAccounts() { return { servers: [{ id: "dav", title: "Диск компании", url: "https://dav.example.test" }], accounts: [{ id: "dav-1", server: "dav", username: "sokolov", enabled: true }] }; },
    async listGitConnections() { return { connections: [{ connection_id: "g-1", owner_id: "alice", provider: "gitlab", api_base: "https://gitlab.example.test", account_id: "7", account_login: "sokolov", name: "GitLab компании", revision: 2, enabled: true }] }; },
    async listVisibleDatabaseConnections() { return { databases: [{ db_id: "db-1", project_id: "two", name: "Аналитика", driver: "postgres", env_var: "", registered_by: "alice", registered_at: "", configured: true, last_sweep_at: "2026-09-12T09:10:00Z", unreachable_since: "2026-09-13T08:00:00Z" }], truncated: false }; },
    async listTelegram() { return { connections: [{ bot: "bot-1", username: "acme_bot", binding: "b-managed", ready: true, disconnected: false, cleanup_pending: false, channel_registered: true }], unavailable: 0 }; },
    async readCorporateOrigin(project, node, head) { app.calls.push(["readCorporateOrigin", project, node, head]); return { source_node_id: "src-9", source_head: "9".repeat(64), source_sha256: "", output_sha256: "", provider: "jira", entity_kind: "issue", entity_id: "ACME-42" }; },
  });
  try {
    await app.open("Источники");
    const group = name => app.document.querySelector(`#root section[aria-label="${name}"]`);
    await app.until(() => group("Почта")?.textContent.includes("d.sokolov@example.test") && group("Почта").textContent.includes("INBOX"), "аккаунт и папка почты");
    assert.ok(group("Почта").textContent.includes("Общий проект"), "проект-получатель почты");
    assert.ok(group("Почта").textContent.includes("отправка письма") && group("Почта").textContent.includes("после согласования"), "действие наружу названо и требует согласования");
    assert.ok(!group("Почта").textContent.includes("внешний источник не изменяется"), "у почты нет надписи про неизменяемость");
    await app.until(() => group("Календарь")?.textContent.includes("Рабочий календарь"), "область календаря");
    assert.ok(group("Календарь").textContent.includes("Ошибка доступа") && [...group("Календарь").querySelectorAll("button")].some(b => b.textContent === "Переподключить"), "отключённый аккаунт — ошибка и «Переподключить»");
    await app.until(() => group("Диск")?.textContent.includes("sokolov"), "диск");
    assert.ok(group("Диск").textContent.includes("внешний источник не изменяется"), "у импорта копий есть надпись");
    await app.until(() => group("Git")?.textContent.includes("GitLab компании"), "git");
    assert.ok(group("Git").textContent.includes("push") && group("Git").textContent.includes("после согласования"), "push назван и требует согласования");
    assert.ok(!group("Git").textContent.includes("внешний источник не изменяется"));
    await app.until(() => group("Базы данных")?.textContent.includes("Аналитика"), "база");
    assert.ok(group("Базы данных").textContent.includes("Ошибка доступа") && group("Базы данных").textContent.includes("Второй проект"), "ошибка доступа базы и проект");
    await app.until(() => group("Telegram")?.textContent.includes("@acme_bot"), "телеграм");

    [...group("Базы данных").querySelectorAll("button")].find(b => b.textContent === "Переподключить").click();
    await app.until(() => app.button("Закрыть подключения БД"), "прежний раздел подключений БД открыт внутри вкладки");
    app.button("К вкладке").click();
    await app.until(() => group("Базы данных"), "возврат к источникам");

    const origin = group("Импортированные копии");
    assert.ok(origin.textContent.includes("внешний источник не изменяется"));
    app.type(origin.querySelector('select[aria-label="Проект копии"]'), "one");
    await app.until(() => origin.querySelector('select[aria-label="Документ копии"] option[value="plan"]'), "документы проекта в выборе");
    app.type(origin.querySelector('select[aria-label="Документ копии"]'), "plan");
    [...origin.querySelectorAll("button")].find(b => b.textContent === "Показать происхождение").click();
    await app.until(() => origin.textContent.includes("ACME-42"), "происхождение копии");
    assert.deepEqual(app.calls.find(([m]) => m === "readCorporateOrigin"), ["readCorporateOrigin", "one", "plan", "a".repeat(64)]);
    assert.ok(origin.textContent.includes("jira") && origin.textContent.includes("рабочая копия"), "где оригинал и где копия");
  } finally { app.dispose(); }
});

test("«Источники»: пустое состояние и отказ RPC показаны честно", async () => {
  const app = await mountMemoryApp({ async listImapAccounts() { throw new Error("forbidden"); } });
  try {
    await app.open("Источники");
    const group = name => app.document.querySelector(`#root section[aria-label="${name}"]`);
    await app.until(() => group("Почта")?.textContent.includes("сервер отказал"), "отказ по почте");
    await app.until(() => group("Диск")?.textContent.includes("Подключений нет"), "пустой диск");
    assert.ok(group("Git").textContent.includes("Подключений нет"));
  } finally { app.dispose(); }
});
