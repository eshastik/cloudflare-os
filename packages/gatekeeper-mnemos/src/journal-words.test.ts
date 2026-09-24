import { test } from "node:test";
import assert from "node:assert/strict";
import { describeEvent, feminine, MEANINGFUL_ACTIONS, type JournalNames } from "../app-react/journal-words.ts";
import { agentNames } from "../app-react/names.ts";
import type { OperationAuditEvent } from "./operation-audit.ts";

const NAMES: JournalNames = {
  actor: id => ({ alex: "Александр", anna: "Анна Смирнова", nikita: "Никита", "agent-chat": "Агент беседы", bob: "Борис" } as Record<string, string>)[id] ?? "",
  project: id => ({ sklad: "Склад" } as Record<string, string>)[id] ?? "",
  document: (project, node) => project === "sklad" && node === "dog" ? { name: "Договор", dir: false } : project === "sklad" && node === "dir" ? { name: "Архив", dir: true } : null,
  unit: id => id === "unit-1" ? "Бухгалтерия" : "",
  invitation: id => id === "inv-1" ? { name: "Ольга", email: "olga@example.test" } : null,
};

function event(action: string, patch: Partial<OperationAuditEvent> = {}): OperationAuditEvent {
  return { id: "1", tenant_id: "org", actor: "alex", on_behalf_of: "", action, resource: "", subject: "", allowed: true, reason: "accepted", at: "2026-09-24T09:00:00Z", prev_hash: "", hash: "", ...patch };
}

// Операции, которые сервер Mnemos пишет в журнал операций (services/**, сверено 2026-09-24).
const SERVER_ACTIONS = ["agent-authorization.cleanup", "agent.absence.disable", "agent.absence.dispatch.authorize", "agent.absence.enable", "agent.absence.result.select", "agent.absence.task.budget", "agent.absence.task.cancel.confirm", "agent.absence.task.cancel.prepare", "agent.absence.task.create", "agent.authorization.approve", "agent.authorization.begin", "agent.authorization.deny", "agent.authorization.exchange", "agent.authorization.refresh", "agent.bind", "agent.credential.issue", "agent.engagement.allow", "agent.engagement.revoke", "agent.revoke", "agent.runtime.start.attempt", "agent.task.transition", "agent.workshop.provision", "agent.workshop.scope.update", "blob.write.attempt", "blob.write.written", "budget.policy.set", "budget.team.decide", "budget.team.propose", "budget.team.result.contribution", "budget.team.result.review", "calendar.connection.create", "calendar.connection.disable", "calendar.draft.stage", "calendar.events.read", "calendar.grant.configure", "collaboration.absence.result", "collaboration.comment", "collaboration.create", "collaboration.result", "collaboration.review", "content.collect.attempt", "content.create", "content.manifest.bind", "content.publish.attempt", "content.publish.observation", "content.storage.bind", "content.storage.retain", "content.storage.unbind", "content.storage.unreferenced", "corporate-update.prepare", "corporate.import.preview", "corporate.update.preview", "database.query", "externaldb.register", "externaldb.remove", "externaldb.schema.mark", "externaldb.sweep.done", "externaldb.sweep.failed", "git.commit.read", "git.connection.create", "git.connection.disable", "git.file.read", "git.merge_request.merge", "git.merge_request.open", "git.push.authorize", "git.push.forward", "git.repository.configure", "git.repository.read", "human.credential.issue", "inbox.alert.raise", "inbox.alert.resolved", "inbox.claim.Claim", "inbox.enqueue", "inbox.publish.attempt", "inbox.publish.observation", "inbox.transition.queued.classified", "inbox.version.prepare", "index.replace", "login.request.expire", "login.request.put", "login.request.take", "mail.attachment.read", "mail.connection.create", "mail.connection.disable", "mail.draft.stage", "mail.grant.configure", "mail.messages.read", "node.create", "node.delete", "node.move", "node.rename", "office-update.prepare", "office.update.preview", "org_invitation.accept", "org_invitation.create", "org_invitation.revoke", "org_unit.create", "org_unit.delete", "org_unit.member.remove", "org_unit.member.set", "personal-memory.select", "platform-signal.observe", "platform-signal.read", "platform.signal.owner.set", "policy.alert.review", "principal.member.add", "principal.restore", "principal.revoke", "principal.role.create", "principal.save", "private-document.create.prepare", "private-document.location.prepare", "private-document.participant.set", "private-workflow.open", "project.centroid.add", "project.closure.rebuild", "project.create", "project.description.set", "project.sharing.settings", "project.signals.save", "project.visibility.approve", "project.visibility.private", "project.visibility.request", "projection.claim", "projection.complete", "publication.apply.intent", "publication.policy.set", "publication.review.approve", "publication.review.create", "publication.review.withdraw", "request.admit", "rights.grant", "rights.remove", "segment.vector.set", "segments.put", "staging.delete.attempt", "storage.reserve", "telegram.channel.create", "telegram.task.accept", "temporary.storage.reserve", "ui-readiness.record", "upload.begin", "upload.complete", "user.deactivate", "user.reactivate", "user.save", "voice.source.save", "voice.transcript.confirm", "work-template.version.create", "workflow-attempt.record", "workspace-activity.cleanup", "workspace-activity.record"];

test("журнал: у каждой операции сервера есть описание, «служебное действие» не встречается", () => {
  for (const action of SERVER_ACTIONS) {
    const line = describeEvent(event(action, { resource: '["sklad","dog"]', subject: "anna" }), NAMES);
    assert.doesNotMatch(line.text, /служебное действие|undefined|null|\[|\{/, action);
    assert.equal(line.technical, !MEANINGFUL_ACTIONS.includes(action), `${action}: значимость по перечню`);
  }
});

test("журнал: то, чем забит журнал на установке, — технические записи и по умолчанию скрыты", () => {
  for (const action of ["workspace-activity.record", "ui-readiness.record", "private-workflow.open", "platform-signal.read", "login.request.put", "human.credential.issue", "agent.credential.issue", "content.publish.attempt", "projection.claim", "git.file.read", "mail.messages.read", "database.query"])
    assert.equal(describeEvent(event(action), NAMES).technical, true, action);
  // Первая запись пары «начато — итог» техническая даже у значимой операции.
  assert.equal(describeEvent(event("git.push.forward", { reason: "requested" }), NAMES).technical, true);
});

test("журнал: значимые события — законченным предложением с именами", () => {
  const say = (action: string, patch: Partial<OperationAuditEvent> = {}) => describeEvent(event(action, patch), NAMES);
  assert.equal(say("node.create", { resource: '["sklad","dog"]' }).text, "Александр создал документ «Договор» в проекте «Склад»");
  assert.equal(say("node.create", { resource: '["sklad","dog"]' }).projectId, "sklad");
  assert.equal(say("node.delete", { resource: '["sklad","gone"]', actor: "anna" }).text, "Анна Смирнова удалила документ из проекта «Склад»");
  assert.equal(say("content.publish.observation", { actor: "agent-chat", on_behalf_of: "alex", resource: '["sklad","dog","ab"]', reason: "reference_committed" }).text,
    "Агент беседы изменил документ «Договор» в проекте «Склад» (по поручению: Александр)");
  assert.equal(say("node.move", { resource: JSON.stringify({ version: 1, project_id: "sklad", node_id: "dir" }) }).text, "Александр переместил папку «Архив» в проекте «Склад»");
  assert.equal(say("org_invitation.create", { resource: "inv-1" }).text, "Александр пригласил в организацию: Ольга (olga@example.test)");
  assert.equal(say("org_unit.delete", { resource: '["unit-2","Склад","projects_made_private=1"]' }).text, "Александр удалил отдел «Склад»");
  assert.equal(say("org_unit.member.set", { resource: '["unit-1","anna"]', subject: "anna" }).text, "Александр включил в отдел «Бухгалтерия»: Анна Смирнова");
  assert.equal(say("rights.grant", { resource: "sklad:filesystem:write", subject: "bob" }).text, "Александр выдал право менять проект «Склад»: Борис");
  assert.equal(say("rights.grant", { resource: "project.create", subject: "bob" }).text, "Александр выдал право создавать проекты: Борис");
  assert.equal(say("org_invitation.accept", { actor: "anna" }).text, "Анна Смирнова приняла приглашение и присоединилась к организации");
  assert.equal(say("project.create", { resource: "sklad", actor: "nikita" }).text, "Никита создал проект «Склад»");
  assert.equal(say("git.push.forward", { resource: '["sklad","g-1","r-1","abc"]', reason: "unconfirmed" }).text, "Александр отправил изменения кода в проекте «Склад»");
  assert.equal(say("agent.task.transition", { actor: "system:agenticos", on_behalf_of: "alex" }).text, "Платформа агентов: техническая операция");
});

test("журнал: род глагола по имени", () => {
  assert.equal(feminine("Анна"), true);
  assert.equal(feminine("Мария Петрова"), true);
  assert.equal(feminine("Никита"), false);
  assert.equal(feminine("Александр Егоров"), false);
  assert.equal(feminine("Агент беседы"), false);
  assert.equal(feminine("Коллега"), false);
});

test("имена агентов: номер только при одинаковых действующих; отозванные номера не сдвигают", () => {
  const external = (id: string, revoked = false) => ({ binding_id: id, agent_principal_id: `p-${id}`, runtime_id: "external", runtime_agent_id: "", managed_runtime: false, revoked });
  const one = agentNames([external("a", true), external("b", true), external("c"), { ...external("w"), runtime_id: "workshop" }]);
  assert.equal(one.get("c"), "Свой агент (Claude Code или Codex)", "единственный действующий — без номера");
  assert.equal(one.get("w"), "Агент беседы");
  const two = agentNames([external("a", true), external("c"), external("d")]);
  assert.equal(two.get("c"), "Свой агент (Claude Code или Codex)");
  assert.equal(two.get("d"), "Свой агент (Claude Code или Codex) № 2");
});
