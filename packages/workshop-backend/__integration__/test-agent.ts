import {exports} from "cloudflare:workers";
import {runInDurableObject} from "cloudflare:test";
import type {AuthenticatedApi, Overseer} from "@gadgets/workshop-shared/api";

// Эти проверки проверяют RPC и хранение. Выбор агента настоящий, его внешний ход подменён.
export async function prepareTestAgent(user: Pick<AuthenticatedApi, "addModel">, workspace: Pick<Overseer, "getMetadata">) {
  await user.addModel({type: "agent", id: "mnemos-assistant", name: "Тестовый Mnemos"}, {provider: "openai", model: "test", apiToken: "test", apiUrl: "https://model.invalid"});
  const id = (await workspace.getMetadata()).id;
  const stub = exports.OverseerDurableObject.get(exports.OverseerDurableObject.idFromString(id));
  await runInDurableObject(stub, instance => {
    const impl = instance["impl"];
    impl.startAgent = chatId => {
      const meta = impl.storage.chatMeta.get(chatId)!;
      delete meta.activeAgent;
      impl.storage.chatMeta.put(meta);
    };
    impl.generateThreadTitle = async () => {};
  });
}
