import type { RpcStub, RpcTarget } from "cloudflare:workers";

/** A completed Gadget response that should be delivered back to the chat gateway. */
export type GadgetResponse = {
  text: string;
  // Необязательные поля ниже добавлены для Telegram (ADR 0027 Mnemos); прежние получатели их
  // не читают.
  /** Название беседы на сайте, если оно уже не служебное («Новая беседа»). */
  title?: string;
  /** Ход ждёт решения, которое принимается только на сайте (запрос подключения, ввод пароля). */
  needsDecision?: boolean;
  /** Действия хода, которые человек может подтвердить или отклонить кнопкой в канале. */
  decisions?: ExternalDecision[];
  /** Ход начат другим человеком (соавтором): его решения — только на сайте, в канал — строкой. */
  waitingFor?: string;
  /** Названия документов и приложений, созданных агентом в этом ходе. */
  documents?: string[];
  /** Созданные в этом ходе документы, таблицы и презентации: номер вывода в беседе и название.
   *  По ним канал открывает редактор (Telegram Mini App); права проверяются при открытии. */
  editable?: { gadgetId: number; title: string }[];
  /** Агент закончил ход без текста ответа: `text` — служебная замена. */
  noReply?: boolean;
};

/** Действие агента, ждущее решения человека: номер в журнале беседы и описание словами. Кнопкой
 *  его можно решить, только если описание целиком видно в канале. */
export type ExternalDecision = {
  action: number;
  title: string;
  /** Одна-три короткие строки подробностей карточки без идентификаторов. */
  details: string[];
  /** Полное описание действия (Markdown), как его видит человек на сайте. Не обрезается. */
  description: string;
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
  // Беседа сайта, перенесённая в канал: ход идёт в неё, а не в беседу канала по gadgetKey. Такая
  // беседа должна уже существовать — удалённая на сайте заново не создаётся.
  workspaceId?: string;
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
  workspaceId?: string;
};

/** Решение по действию агента, принятое в канале (кнопка в Telegram) от имени владельца беседы. */
export type DecideExternalActionInput = {
  callerEmail: string;
  gadgetKey: string;
  chatKey: string;
  workspaceId?: string;
  action: number;
  decision: "approve" | "reject";
};

/** Итог решения: принято; уже решено раньше или действия нет (карточка устарела); отказ. */
export type DecideExternalActionResult =
  | { status: "approved" | "rejected" }
  | { status: "stale"; state: "approved" | "rejected" | "missing" }
  /** Доступ к материалам беседы изменился (проверка источников не прошла): действие не применено. */
  | { status: "access_changed" }
  | { status: "denied" };

/** Service binding RPC interface used by chat gateway workers. */
export interface ExternalMessageGateway {
  /** Submit an external chat message for Gadget routing and execution. */
  submitExternalMessage(input: SubmitExternalMessageInput): Promise<SubmitExternalMessageResult>;

  /** Задать название беседы от имени её владельца. false — беседы нет или вызывающий не владелец. */
  renameExternalChat(input: RenameExternalChatInput): Promise<boolean>;

  /** Подтвердить или отклонить действие агента в беседе канала от имени её владельца. */
  decideExternalAction(input: DecideExternalActionInput): Promise<DecideExternalActionResult>;
}
