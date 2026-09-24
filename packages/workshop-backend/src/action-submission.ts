import type {ActionRecord} from "./overseer.js";
import type {ActionDescription} from "@gadgets/workshop-shared/gatekeeper";

/** Durable-журнал сохраняет ключ gatekeeper/action и после потери RPC-ответа. */
export function findSubmittedAction(records: Iterable<ActionRecord>, gatekeeperId: number, action: number, description: ActionDescription): (ActionRecord & {type: "action"}) | undefined {
  for (const record of records) {
    if (record.type !== "action" || record.gatekeeperId !== gatekeeperId || record.action !== action) continue;
    const before = record.description;
    if (before.title !== description.title || before.description !== description.description || before.implementsRevert !== description.implementsRevert || !!before.ownerApprovalRequired !== !!description.ownerApprovalRequired || !!before.awaitDecision !== !!description.awaitDecision || !!before.autoApprovable !== !!description.autoApprovable || before.actionKind?.tag !== description.actionKind?.tag || before.actionKind?.label !== description.actionKind?.label || JSON.stringify(before.card ?? null) !== JSON.stringify(description.card ?? null)) {
      throw new Error("Действие уже предложено с другим описанием. Создайте новое предложение.");
    }
    return record;
  }
  return undefined;
}
