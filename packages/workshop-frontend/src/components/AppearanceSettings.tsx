import { Dialog } from "@cloudflare/kumo";
import { useTheme } from "../ThemeContext";
import { ACCENT_PALETTE, type ThemeMode } from "../theme";

// Окно оформления: тема тем же переключателем, что на странице «Настройки», и цвет акцента.
const THEMES: [ThemeMode, string][] = [["light", "Светлая"], ["dark", "Тёмная"], ["system", "Как в системе"]];
const SECONDARY = "h-9 cursor-pointer rounded-full border border-kumo-fill-hover bg-kumo-overlay px-3.5 text-[14px] text-kumo-default transition-colors hover:bg-kumo-tint";
const PRIMARY = "h-9 cursor-pointer rounded-full bg-kumo-brand px-4 text-[14px] font-medium text-white transition-colors hover:bg-kumo-brand-hover";

export default function AppearanceSettings({open,onOpenChange}: {open:boolean;onOpenChange(open:boolean):void}) {
  const {themeMode,setThemeMode,accentColor,setAccentChoice,accentSaved}=useTheme();
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog size="sm" className="!w-[min(460px,calc(100vw-32px))] !rounded-[24px] bg-kumo-overlay p-6">
      <Dialog.Title className="m-0 text-[22px] leading-7 font-semibold tracking-[-0.4px] text-kumo-default">Оформление</Dialog.Title>
      <Dialog.Description className="mt-1 mb-0 text-[14px] text-kumo-subtle">Ваш выбор сохраняется в этом браузере.</Dialog.Description>
      <section className="mt-5" aria-label="Режим оформления"><h3 className="m-0 mb-2 text-[15px] font-semibold text-kumo-default">Тема</h3>
        <div role="radiogroup" aria-label="Тема" className="grid grid-cols-3 rounded-[14px] bg-kumo-tint p-1">{THEMES.map(([mode,label])=><button key={mode} type="button" role="radio" aria-checked={themeMode===mode} onClick={()=>setThemeMode(mode)} className={`h-9 cursor-pointer rounded-[10px] text-[14px] text-kumo-default transition-colors focus-visible:outline-2 focus-visible:outline-kumo-ring ${themeMode===mode?"bg-kumo-overlay font-semibold shadow-[0_1px_3px_rgba(24,32,28,0.12)]":""}`}>{label}</button>)}</div>
      </section>
      <section className="mt-5" aria-label="Цвет акцента"><h3 className="m-0 mb-2 text-[15px] font-semibold text-kumo-default">Цвет акцента</h3>
        <div className="grid grid-cols-2 gap-2">{ACCENT_PALETTE.map(option=><button key={option.id} type="button" aria-pressed={accentColor.toLowerCase()===option.color} onClick={()=>setAccentChoice(option.id)} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-kumo-fill px-3 py-2 text-left text-[14px] text-kumo-default hover:bg-kumo-tint aria-pressed:border-kumo-brand aria-pressed:bg-kumo-tint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-kumo-ring">
          <span className="h-5 w-5 shrink-0 rounded-full border border-black/10" style={{backgroundColor:option.color}} aria-hidden="true" />{option.name}
        </button>)}</div>
      </section>
      {!accentSaved && <p role="status" className="mt-3 mb-0 text-[14px] text-kumo-subtle">Цвет применён, но браузер не разрешил его сохранить. После перезагрузки выберите его снова.</p>}
      <div className="mt-6 flex items-center justify-between gap-3"><button type="button" className={SECONDARY} onClick={()=>setAccentChoice("mnemos")}>Вернуть зелёный Mnemos</button><button type="button" className={PRIMARY} onClick={()=>onOpenChange(false)}>Готово</button></div>
    </Dialog>
  </Dialog.Root>;
}
