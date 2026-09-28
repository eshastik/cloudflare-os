import type { RpcStub, RpcTarget } from "cloudflare:workers";

/** A completed Gadget response that should be delivered back to the chat gateway. */
export type GadgetResponse = {
  text: string;
  // Необязательные поля ниже добавлены для Telegram (ADR 0027 Mnemos); прежние получатели их
  // не читают.
  /** Название беседы на сайте, если оно уже не служебное («Новая беседа»). */
  title?: string;
  /** Ход остановился на действии, которое человек должен подтвердить в беседе на сайте. */
  needsDecision?: boolean;
  /** Названия документов и приложений, созданных агентом в этом ходе. */
  documents?: string[];
  /** Агент закончил ход без текста ответа: `text` — служебная замена. */
  noReply?: boolean;
};

/** Промежуточное состояние хода: что агент делает сейчас и текст ответа, набранный к этому моменту. */
export type GadgetProgress = {
  /** Текст текущего шага модели (хвост, не больше нескольких тысяч знаков). */
  text: string;
  /** Идущий шаг: инструмент агента и, для executeCode, начало кода. null — модель пишет текст. */
  step: { toolName: string; code?: string } | null;
};

/** RPC target provided by the chat gateway for the backend's eventual response. */
export interface ChatGatewayRpcTarget extends RpcTarget {
  /**
   * Deliver the completed Gadget response. Implementations must be idempotent because delivery is
   * at-least-once when response target acknowledgements fail.
   */
  onGadgetResponse(response: GadgetResponse): Promise<void>;

  /**
   * Промежуточные события хода. Зовётся, только если при отправке указан `streamProgress`
   * (получатель без него может ничего не делать); не чаще нескольких раз в секунду, без гарантии
   * доставки: пропущенное событие не повторяется.
   */
  onGadgetProgress(progress: GadgetProgress): Promise<void>;
}

/** External message submission accepted by the backend gateway. */
export type SubmitExternalMessageInput = {
  // Selects the Gadgets account used to submit the message.
  // The backend trusts the gateway: supplying this email grants access as that account.
  callerEmail: string;
  // Selects the workspace to create or reuse.
  gadgetKey: string;
  // Selects the chat to create or reuse.
  chatKey: string;
  // Deduplicates the originating message and correlates the response target.
  messageKey: string;
  // Names the workspace if it must be created.
  gadgetTitle: string;
  // User text sent to Gadgets.
  prompt: string;
  // Persistent target invoked when the Gadget response is ready.
  chatGatewayRpcTarget: RpcStub<ChatGatewayRpcTarget>;
  // Слать ли промежуточные события хода в `chatGatewayRpcTarget.onGadgetProgress`.
  streamProgress?: boolean;
};

/** Submission result returned by the backend gateway. */
export type SubmitExternalMessageResult =
  | {
      accepted: true;
      chatPath: string;
    }
  | {
      accepted: false;
      // User-facing explanation of an actionable submission rejection.
      message: string;
    };

/** Переименование беседы, созданной внешним каналом (название задал человек в канале). */
export type RenameExternalChatInput = {
  callerEmail: string;
  gadgetKey: string;
  chatKey: string;
  title: string;
};

/** Service binding RPC interface used by chat gateway workers. */
export interface ExternalMessageGateway {
  /** Submit an external chat message for Gadget routing and execution. */
  submitExternalMessage(input: SubmitExternalMessageInput): Promise<SubmitExternalMessageResult>;

  /** Задать название беседы от имени её владельца. false — беседы нет или вызывающий не владелец. */
  renameExternalChat(input: RenameExternalChatInput): Promise<boolean>;
}
