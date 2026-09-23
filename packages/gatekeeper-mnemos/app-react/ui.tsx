import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { Empty } from "@cloudflare/kumo";
import { Tray } from "@phosphor-icons/react";

export type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info";

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-kumo-fill text-kumo-subtle",
  success: "bg-kumo-success-tint text-kumo-success",
  warning: "bg-kumo-warning-tint text-kumo-warning",
  danger: "bg-kumo-danger-tint text-kumo-danger",
  info: "bg-kumo-info-tint text-kumo-info",
};

export function StatusBadge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return (
    <span className={`inline-flex w-fit shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[12px] leading-4 font-medium ${TONES[tone]}`}>
      <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-current" aria-hidden="true" />
      {children}
    </span>
  );
}

export function RowList({ children }: { children: ReactNode }) {
  return <div className="overflow-hidden rounded-xl border border-kumo-line bg-kumo-base">{children}</div>;
}

export function Row({ children, className = "", ...rest }: { children: ReactNode; className?: string } & Record<string, unknown>) {
  return <div className={`flex items-center gap-3 p-3 border-t border-kumo-line first:border-t-0 ${className}`} {...rest}>{children}</div>;
}

/** Основная строка и подпись строки списка. */
export function RowText({ title, note, children }: { title: ReactNode; note?: ReactNode; children?: ReactNode }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="text-[13px] leading-[18px] font-medium tracking-[-0.25px] text-kumo-default">{title}</div>
      {note && <div className="mt-0.5 text-[12px] text-kumo-subtle">{note}</div>}
      {children}
    </div>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="text-[11px] leading-4 font-semibold uppercase tracking-[0.9px] text-kumo-subtle">{children}</div>;
}

export function Notice({ tone = "neutral", children }: { tone?: "neutral" | "danger" | "success"; children: ReactNode }) {
  const color = tone === "danger" ? "text-kumo-danger" : tone === "success" ? "text-kumo-success" : "text-kumo-subtle";
  return <p role="status" className={`m-0 text-[13px] leading-[18px] tracking-[-0.25px] ${color}`}>{children}</p>;
}

/** Честное пустое состояние: заголовок один на всех, строка — что появится в разделе. */
export function EmptyTab({ description }: { description: string }) {
  return (
    <div className="rounded-xl border border-dashed border-kumo-line bg-kumo-base">
      <Empty size="sm" icon={<Tray size={28} className="text-kumo-subtle" />} title="Пока нечего показать" description={description} />
    </div>
  );
}

/** Блок вкладки: заголовок со счётчиком, действия справа, содержимое. Пустой блок не исчезает — показывает empty. */
export function Block({ title, count, actions, empty, children }: { title: string; count?: number; actions?: ReactNode; empty?: string; children?: ReactNode }) {
  return (
    <section aria-label={title} className="mb-6">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="m-0 text-[15px] font-semibold text-kumo-strong">{title}</h2>
        {count !== undefined && <span className="rounded-full bg-kumo-fill px-1.5 text-[11px] leading-4 font-medium text-kumo-subtle">{count}</span>}
        <div className="flex-1" />
        {actions}
      </div>
      {empty !== undefined && count === 0 ? <Notice>{empty}</Notice> : children}
    </section>
  );
}

/** Служебные идентификаторы для администратора — свёрнуты под «Подробнее»; остальным не показываются. */
export function AdminDetails({ show, items }: { show: boolean; items: [string, string | undefined][] }) {
  const shown = items.filter((item): item is [string, string] => !!item[1]);
  if (!show || shown.length === 0) return null;
  return (
    <details data-admin-details="" className="mt-2 text-[12px] text-kumo-subtle">
      <summary className="cursor-pointer select-none">Подробнее</summary>
      <div className="mt-1 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-0.5">
        {shown.map(([label, value]) => <div key={label} className="contents"><span>{label}</span><span className="break-all font-mono">{value}</span></div>)}
      </div>
    </details>
  );
}

const inputClass = "h-8 rounded-lg border border-kumo-line bg-kumo-base px-2 text-[13px] text-kumo-default outline-none focus:border-kumo-ring";

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputClass} ${props.className ?? ""}`} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputClass} ${props.className ?? ""}`} />;
}
