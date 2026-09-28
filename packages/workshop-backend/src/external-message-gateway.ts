import { WorkerEntrypoint } from "cloudflare:workers";
import { validateRpc } from "capnweb-validate";
import {
  type DecideExternalActionInput,
  type DecideExternalActionResult,
  type ExternalMessageGateway as ExternalMessageGatewayContract,
  type RenameExternalChatInput,
  type SubmitExternalMessageInput,
  type SubmitExternalMessageResult,
} from "@gadgets/workshop-shared/external-message-gateway";

type ExternalMessageGatewayProps = {
  source: string;
};

@validateRpc()
export class ExternalMessageGateway extends WorkerEntrypoint<Cloudflare.Env, ExternalMessageGatewayProps> implements ExternalMessageGatewayContract {
  #keys(input: { gadgetKey: string; chatKey: string }) {
    let source = this.ctx.props.source;
    if (!source) throw new Error("ExternalMessageGateway source prop is required.");
    return { source, gadget: `${source}:${input.gadgetKey}`, chat: `${source}:${input.chatKey}` };
  }

  // Беседа канала — объект по имени из gadgetKey. Беседа сайта, перенесённая в канал, — объект по
  // её номеру: права проверяет сама беседа (владелец или соавтор), номер прав не даёт.
  #overseer(input: { workspaceId?: string }, gadget: string) {
    let namespace = this.ctx.exports.OverseerDurableObject;
    if (input.workspaceId === undefined) return namespace.getByName(gadget);
    if (!/^[0-9a-f]{64}$/.test(input.workspaceId)) throw new Error("Invalid workspace.");
    return namespace.get(namespace.idFromString(input.workspaceId));
  }

  async submitExternalMessage(input: SubmitExternalMessageInput): Promise<SubmitExternalMessageResult> {
    let keys = this.#keys(input);
    let externalKeys = { ...keys, message: `${keys.source}:${input.messageKey}` };

    // External gateways decide which Gadget receives a prompt by passing gadgetKey.
    // We prefix that key with the binding-owned source before using it as the DO name,
    // preventing collisions with other gateways and web-created Gadget IDs.
    let overseer = this.#overseer(input, externalKeys.gadget);

    return await overseer.receiveExternalMessage({
      callerEmail: input.callerEmail,
      externalChatKey: externalKeys.chat,
      idempotencyKey: externalKeys.message,
      prompt: input.prompt,
      chatGatewayRpcTarget: input.chatGatewayRpcTarget,
      title: input.gadgetTitle,
      ...(input.streamProgress ? { streamProgress: true } : {}),
      ...(keys.source === "telegram" ? { channel: "telegram" as const } : {}),
      ...(input.workspaceId !== undefined ? { existingOnly: true } : {}),
    });
  }

  async renameExternalChat(input: RenameExternalChatInput): Promise<boolean> {
    let keys = this.#keys(input);
    return await this.#overseer(input, keys.gadget).renameExternalChat(input.callerEmail, keys.chat, input.title);
  }

  async decideExternalAction(input: DecideExternalActionInput): Promise<DecideExternalActionResult> {
    let keys = this.#keys(input);
    return await this.#overseer(input, keys.gadget).decideExternalAction(
        input.callerEmail, keys.chat, input.action, input.decision);
  }
}
