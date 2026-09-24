// Подписи вместо служебных идентификаторов. Модуль без React: им пользуются и
// прежние экраны (app/main.ts), и новые.
import type { AgentConnectionPage } from "../src/mnemos-api.ts";

type AgentConnection = AgentConnectionPage["connections"][number];

/** Похоже на служебный идентификатор, а не на имя: такое не показывается на основных экранах. */
export function looksLikeId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    || /^[0-9a-f]{16,}$/i.test(value)
    || /^(external|workshop|agent|agents|binding|request|task)[-_/]/i.test(value)
    || (value.length > 24 && !/\s/.test(value));
}

/** Имя человека по известному справочнику; длинный идентификатор заменяется словом. */
export function personName(id: string, names?: Map<string, string>): string {
  const known = names?.get(id);
  if (known) return known;
  if (!id) return "не указан";
  return looksLikeId(id) ? "коллега" : id;
}

/** Человеческое название подключения агента по его среде: у подключений нет собственного имени. */
export function agentKind(connection: Pick<AgentConnection, "runtime_id" | "managed_runtime">): string {
  if (connection.runtime_id === "workshop") return "Агент беседы";
  if (connection.managed_runtime === true) return "Агент AgenticOS";
  if (connection.runtime_id === "external" || connection.managed_runtime === false) return "Свой агент (Claude Code или Codex)";
  return "Агент";
}

/** Имена всех подключений; одинаковые различаются номером по порядку. */
export function agentNames(connections: AgentConnection[]): Map<string, string> {
  const seen = new Map<string, number>();
  const out = new Map<string, string>();
  for (const connection of connections) {
    const kind = agentKind(connection);
    const n = (seen.get(kind) ?? 0) + 1;
    seen.set(kind, n);
    const name = n > 1 ? `${kind} № ${n}` : kind;
    out.set(connection.binding_id, name);
    if (!out.has(connection.agent_principal_id)) out.set(connection.agent_principal_id, name);
  }
  return out;
}

/** Имя агента по подключению или принципалу; неизвестный — просто «агент». */
export function agentName(connections: AgentConnection[], id: string): string {
  return agentNames(connections).get(id) ?? "агент";
}

/** Исполнитель или автор обращения: агент по имени подключения, человек — по имени или слову. */
export function actorName(connections: AgentConnection[], agentId: string, userId: string, names?: Map<string, string>): string {
  return agentId ? agentName(connections, agentId) : personName(userId, names);
}

