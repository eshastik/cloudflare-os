import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@cloudflare/kumo";
import { ArrowLeft } from "@phosphor-icons/react";
import { closeLegacySection, confirmLegacyNavigation, openLegacySection, type LegacySection } from "../app/main.ts";
import RoleMembershipPanel from "./RoleMembershipPanel.tsx";
import { useLegacyContainer } from "./host.ts";

export type { LegacySection };

// Только известные действия закрытия; имена пользовательских объектов здесь не интерпретируются.
const CLOSE_LABELS: Partial<Record<LegacySection["kind"],string>> = {
 imap:"Закрыть аккаунты почты",caldav:"Закрыть аккаунты календарей",webdav:"Закрыть аккаунты WebDAV",
 mail:"Закрыть почтовое подключение",calendar:"Закрыть календарь",git:"Закрыть Git-подключения",
 databases:"Закрыть подключения БД",telegram:"Закрыть Telegram",voice:"Закрыть аудио",
 businessOverview:"Закрыть данные организации",projectSignals:"Закрыть оценку",signalsOverview:"Закрыть обзор",
 agentAnswers:"Закрыть ответы",agentQuality:"Закрыть качество",expenses:"Закрыть сводку",
 workTemplates:"Закрыть шаблоны",resourceMap:"Закрыть ресурсы",tracker:"Закрыть трекер",
 signalInbox:"Закрыть уведомления",signalOwners:"Закрыть ответственных",policyAlerts:"Закрыть предупреждения",
 operationAudit:"Закрыть журнал",reindexBatch:"Закрыть массовый пересчёт",centroid:"Закрыть профиль",
 searchEvaluation:"Закрыть проверку поиска",answerEvaluation:"Закрыть оценку ответа",
 document:"Закрыть редактор",policy:"Закрыть настройки",absence:"Закрыть замещение",engagement:"Закрыть разрешения",
 memory:"Закрыть память",budget:"Закрыть бюджет проекта",taskHistory:"Закрыть историю задач",collaborations:"Закрыть обращения",metrics:"Закрыть раздел"
};


/**
 * Перенесённый раздел внутри вкладки: контейнер #legacy переезжает в этот блок, main.ts открывает раздел,
 * а по его закрытию зовёт onClose. Бизнес-логика раздела остаётся в app/*.ts.
 */
export function LegacyPanel({ section, title, onClose }: { section: LegacySection; title: string; onClose: () => void }) {
  const legacy = useLegacyContainer();
  const box = useRef<HTMLDivElement>(null);
  const key = JSON.stringify(section);
  const nativeClose = useRef<HTMLButtonElement|null>(null);
  const [closeDisabled,setCloseDisabled] = useState(false);
  useEffect(() => {
    const home = legacy.parentElement;
    if (!box.current || !home) return;
    box.current.append(legacy);
    legacy.hidden = false;
    const syncClose = () => {
      const expected = CLOSE_LABELS[section.kind];
      const button = expected ? Array.from(legacy.querySelectorAll<HTMLButtonElement>(":scope > button")).find(b=>b.textContent===expected) : undefined;
      nativeClose.current=button??null;
      if(button) button.dataset.embeddedClose="";
      setCloseDisabled(button?.disabled??false);
    };
    const observer = new MutationObserver(syncClose);
    observer.observe(legacy,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:["disabled"]});
    openLegacySection(section, onClose);
    syncClose();
    return () => {
      observer.disconnect();
      nativeClose.current=null;
      closeLegacySection();
      legacy.hidden = true;
      home.append(legacy);
    };
    // Раздел пересоздаётся только при смене его описания, не при каждой перерисовке родителя.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, legacy]);
  return (
    <section aria-label={title}>
      <div className="mb-3 flex items-center gap-3">
        <Button variant="ghost" size="sm" icon={ArrowLeft} disabled={closeDisabled} onClick={() => { if (nativeClose.current) nativeClose.current.click(); else if (confirmLegacyNavigation()) onClose(); }}>Назад</Button>
        <h2 className="m-0 text-lg font-semibold text-kumo-strong">{title}</h2>
      </div>
      <div ref={box} />
    </section>
  );
}

/** Состояние «какой перенесённый раздел открыт» для вкладки; children рисуются, пока раздел закрыт. */
export function useLegacySection(): { section: { section: LegacySection; title: string } | null; open(section: LegacySection, title: string): void; close(): void } {
  const [section, setSection] = useState<{ section: LegacySection; title: string } | null>(null);
  return { section, open: (next, title) => setSection({ section: next, title }), close: () => setSection(null) };
}

export function LegacySwitch({ state, children }: { state: ReturnType<typeof useLegacySection>; children: ReactNode }) {
  if (state.section?.section.kind === "roleMembership") return <RoleMembershipPanel onClose={state.close} />;
  if (state.section) return <LegacyPanel section={state.section.section} title={state.section.title} onClose={state.close} />;
  return <>{children}</>;
}
