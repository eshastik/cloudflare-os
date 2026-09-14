import { Button, Dialog } from "@cloudflare/kumo";
import { useTheme } from "../ThemeContext";
import { ACCENT_PALETTE, type ThemeMode } from "../theme";

export default function AppearanceSettings({open,onOpenChange}: {open:boolean;onOpenChange(open:boolean):void}) {
  const {themeMode,setThemeMode,accentColor,setAccentChoice,accentSaved}=useTheme();
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog size="sm" className="!w-[min(460px,calc(100vw-32px))] bg-kumo-base p-5">
      <Dialog.Title className="text-lg font-medium">Оформление</Dialog.Title>
      <Dialog.Description className="mt-1 text-sm text-kumo-subtle">Ваш выбор сохраняется в этом браузере.</Dialog.Description>
      <section className="mt-5" aria-label="Режим оформления"><h3 className="mb-2 text-sm font-medium">Тема</h3>
        <div className="flex flex-wrap gap-2">{([["system","Системная"],["light","Светлая"],["dark","Тёмная"]] as [ThemeMode,string][]).map(([mode,label])=><Button key={mode} variant={themeMode===mode?"secondary":"ghost"} aria-pressed={themeMode===mode} onClick={()=>setThemeMode(mode)}>{label}</Button>)}</div>
      </section>
      <section className="mt-5" aria-label="Цвет акцента"><h3 className="mb-2 text-sm font-medium">Цвет акцента</h3>
        <div className="grid grid-cols-2 gap-2">{ACCENT_PALETTE.map(option=><button key={option.id} type="button" aria-pressed={accentColor.toLowerCase()===option.color} onClick={()=>setAccentChoice(option.id)} className="flex min-h-11 items-center gap-2 rounded-lg border border-kumo-line px-3 py-2 text-left text-sm text-kumo-default hover:bg-kumo-tint aria-pressed:border-kumo-brand aria-pressed:bg-kumo-tint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-kumo-ring">
          <span className="h-5 w-5 shrink-0 rounded-full border border-black/10" style={{backgroundColor:option.color}} aria-hidden="true" />{option.name}
        </button>)}</div>
      </section>
      {!accentSaved && <p role="status" className="mt-3 text-sm text-kumo-subtle">Цвет применён, но браузер не разрешил его сохранить. После перезагрузки выберите его снова.</p>}
      <div className="mt-5 flex items-center justify-between gap-3"><Button variant="ghost" onClick={()=>setAccentChoice("mnemos")}>Вернуть зелёный Mnemos</Button><Button onClick={()=>onOpenChange(false)}>Готово</Button></div>
    </Dialog>
  </Dialog.Root>;
}
