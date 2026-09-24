import {
  ArrowUpRight, Buildings, CalendarBlank, CheckCircle, Code, CurrencyRub, Envelope, Eye, Key, LinkSimple,
  PaperPlaneTilt, ShareNetwork, ShieldCheck, Stamp, Trash, UserPlus, Users, XCircle, type Icon,
} from "@phosphor-icons/react";
import type { ActionCardIcon, ActionOutcome } from "@gadgets/workshop-shared/gatekeeper";
import { safeExternalUrl } from "../../utils/safeExternalUrl";

const ICONS: Record<ActionCardIcon, Icon> = {
  share: ShareNetwork, review: Stamp, publish: PaperPlaneTilt, person: Users, department: Buildings,
  invitation: UserPlus, access: Key, visibility: Eye, budget: CurrencyRub, mail: Envelope,
  calendar: CalendarBlank, code: Code, connection: LinkSimple, delete: Trash, other: ShieldCheck,
};

export type ActionConfirmState = "pending" | "approved" | "rejected";

// Карточка действия, которое агент предлагает от имени человека. Оформлена как карточка
// созданного документа: плитка со значком вида действия слева, заголовок и подробности справа.
// Пока решения нет — кнопки; после решения — итог и ссылка на результат, если ресурс её дал.
export function ActionConfirmCard({ icon, title, details, state, outcome, busy, onApprove, onReject, onAlwaysApprove, open }: {
  icon: ActionCardIcon;
  title: string;
  details: string[];
  state: ActionConfirmState;
  outcome?: ActionOutcome;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
  /** Есть только у видов, которые можно разрешить насовсем. */
  onAlwaysApprove?: () => void;
  /** Карточка-переход: главная кнопка открывает экран у человека; без обработчика экран недоступен. */
  open?: { label: string; onOpen?: () => void };
}) {
  const Glyph = ICONS[icon] ?? ShieldCheck;
  const link = outcome?.url ? safeExternalUrl(outcome.url) : undefined;
  const pending = state === "pending";
  return (
    <div
      role="group"
      aria-label={pending ? "Нужно ваше подтверждение" : title}
      className={`flex w-full max-w-[560px] items-stretch overflow-hidden rounded-2xl border bg-kumo-base shadow-[0_1px_2px_rgba(82,16,0,0.04)] ${pending ? "border-kumo-warning/40" : "border-kumo-line"}`}
    >
      <span
        className="relative grid w-[72px] flex-shrink-0 place-items-center border-r border-kumo-line bg-kumo-tint/40"
        aria-hidden="true"
      >
        <span className="absolute inset-0 bg-gradient-to-br from-kumo-brand/[0.08] via-transparent to-transparent" />
        <Glyph size={26} weight="duotone" className="relative text-kumo-default" />
      </span>
      <div className="min-w-0 flex-1 px-3.5 py-3">
        <div className="text-[14px] font-medium leading-5 tracking-[-0.2px] text-kumo-default">{title}</div>
        {details.map((line, index) => (
          <div key={index} className="mt-0.5 text-[12px] leading-[17px] text-kumo-subtle">{line}</div>
        ))}
        {pending ? (
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={open ? () => { open.onOpen?.(); onApprove(); } : onApprove}
              disabled={busy || (!!open && !open.onOpen)}
              className="h-8 cursor-pointer rounded-full bg-kumo-brand px-3.5 text-[13px] font-medium text-white transition-colors hover:bg-kumo-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kumo-ring disabled:cursor-not-allowed disabled:opacity-40"
            >
              {open ? open.label : "Подтвердить"}
            </button>
            {onAlwaysApprove && (
              <button
                type="button"
                onClick={onAlwaysApprove}
                disabled={busy}
                className="h-8 cursor-pointer rounded-full border border-kumo-fill-hover px-3 text-[13px] text-kumo-default transition-colors hover:bg-kumo-tint disabled:cursor-not-allowed disabled:opacity-40"
              >
                Разрешать всегда
              </button>
            )}
            <button
              type="button"
              onClick={onReject}
              disabled={busy}
              className="h-8 cursor-pointer rounded-full px-3 text-[13px] text-kumo-subtle transition-colors hover:text-kumo-danger disabled:cursor-not-allowed disabled:opacity-40"
            >
              Отклонить
            </button>
          </div>
        ) : (
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] leading-4">
            {state === "approved" ? (
              <span className="flex items-center gap-1 font-medium text-kumo-success">
                <CheckCircle size={14} weight="fill" aria-hidden="true" /> Сделано
              </span>
            ) : (
              <span className="flex items-center gap-1 font-medium text-kumo-danger">
                <XCircle size={14} weight="fill" aria-hidden="true" /> Отклонено
              </span>
            )}
            {state === "approved" && outcome && <span className="text-kumo-subtle">{outcome.summary}</span>}
            {state === "approved" && open?.onOpen && (
              <button type="button" onClick={open.onOpen} className="flex cursor-pointer items-center gap-0.5 text-kumo-link hover:underline">
                {open.label} <ArrowUpRight size={12} weight="bold" aria-hidden="true" />
              </button>
            )}
            {state === "approved" && link && (
              <a href={link} target="_blank" rel="noopener noreferrer" className="flex items-center gap-0.5 text-kumo-link hover:underline">
                Открыть <ArrowUpRight size={12} weight="bold" aria-hidden="true" />
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
