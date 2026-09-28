/** Палитра личного оформления. Цвета статусов остаются отдельными. */
export const ACCENT_PALETTE = [
  {id:"mnemos",name:"Зелёный Mnemos",color:"#21664f"},
  {id:"orange",name:"Оранжевый",color:"#ae4b14"},
  {id:"blue",name:"Голубой",color:"#176b9a"},
  {id:"red",name:"Красный",color:"#ac3443"},
  {id:"gold",name:"Золотистый",color:"#86620b"},
  {id:"sage",name:"Шалфейный",color:"#526b5a"},
  {id:"slate",name:"Серо-голубой",color:"#526477"},
  {id:"plum",name:"Сливовый",color:"#705575"},
] as const;
/** Сохранённый выбор из фиксированной палитры. */
export type AccentChoice = typeof ACCENT_PALETTE[number]["id"];
/** Проверяет значение из хранилища, не принимая произвольный CSS. */
export function isAccentChoice(value: unknown): value is AccentChoice {return ACCENT_PALETTE.some(option=>option.id===value);}
/** Полный или короткий HEX, безопасный для значения CSS. */
export function isAccentHex(value: unknown): value is string {return typeof value==="string" && /^#(?:[a-f0-9]{3}|[a-f0-9]{6})$/i.test(value);}
function rgb(hex:string):number[] {const full=hex.length===4?hex.slice(1).split("").map(c=>c+c).join(""):hex.slice(1);return [0,2,4].map(offset=>parseInt(full.slice(offset,offset+2),16));}
function mix(seed:string,target:string,amount:number):string {const a=rgb(seed),b=rgb(target);return "#"+a.map((v,i)=>Math.round(v+(b[i]-v)*amount).toString(16).padStart(2,"0")).join("");}
/** Относительная яркость sRGB для проверки контраста основных элементов. */
export function accentLuminance(hex:string):number {const [r,g,b]=rgb(hex).map(v=>{const c=v/255;return c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4;});return 0.2126*r+0.7152*g+0.0722*b;}
const toLinear=(v:number)=>{const c=v/255;return c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4;};
/** Цвет в OKLCH: [светлота, хрома, оттенок в градусах]. */
export function hexToOklch(hex:string):[number,number,number] {
  const [r,g,b]=rgb(hex).map(toLinear);
  const l=Math.cbrt(0.4122214708*r+0.5363325363*g+0.0514459929*b),m=Math.cbrt(0.2119034982*r+0.6806995451*g+0.1073969566*b),s=Math.cbrt(0.0883024619*r+0.2817188376*g+0.6299787005*b);
  const L=0.2104542553*l+0.7936177850*m-0.0040720468*s,A=1.9779984951*l-2.4285922050*m+0.4505937099*s,B=0.0259040371*l+0.7827717662*m-0.8086757660*s;
  const hue=Math.atan2(B,A)*180/Math.PI;
  return [L,Math.hypot(A,B),hue<0?hue+360:hue];
}
/** Обратное преобразование для проверки контраста нейтральных поверхностей, окрашенных оттенком акцента. */
export function oklchToHex(L:number,C:number,H:number):string {
  const A=C*Math.cos(H*Math.PI/180),B=C*Math.sin(H*Math.PI/180);
  const l=(L+0.3963377774*A+0.2158037573*B)**3,m=(L-0.1055613458*A-0.0638541728*B)**3,s=(L-0.0894841775*A-1.2914855480*B)**3;
  const lin=[4.0767416621*l-3.3077115913*m+0.2309699292*s,-1.2684380046*l+2.6097574011*m-0.3413193965*s,-0.0041960863*l-0.7034186147*m+1.7076147010*s];
  return "#"+lin.map(v=>{const c=Math.min(1,Math.max(0,v));const e=c<=0.0031308?12.92*c:1.055*c**(1/2.4)-0.055;return Math.round(e*255).toString(16).padStart(2,"0");}).join("");
}
/** Ниже этой хромы акцент считается серым: нейтральные поверхности тогда не подкрашиваются. */
const NEUTRAL_TINT_MIN_CHROMA=0.02;
/** Числовые оттенки: одинаковый контраст в браузере и тесте, без относительного CSS цвета. */
export function accentShades(seed:string) {
  if(!isAccentHex(seed)) seed=ACCENT_PALETTE[0].color;
  let brand=mix(seed,"#000000",0);
  // Администратор может задать светлый цвет. Белая надпись кнопки должна остаться читаемой.
  while((1.05/(accentLuminance(brand)+0.05))<4.8) brand=mix(brand,"#000000",0.06);
  const [,chroma,hue]=hexToOklch(brand);
  return {brand,hover:mix(brand,"#000000",0.15),lightText:mix(brand,"#000000",0.12),darkText:mix(brand,"#ffffff",0.65),lightTint:mix(brand,"#ffffff",0.93),darkTint:mix(brand,"#000000",0.65),
    // Нейтральные поверхности и текст едва окрашены оттенком акцента: иначе при чужом цвете остаётся зелёный подтон Mnemos.
    hue:Math.round(hue*10)/10,neutralTint:Math.min(1,Math.round(chroma/NEUTRAL_TINT_MIN_CHROMA*100)/100)};
}
/** Общие акцентные токены оболочки и встроенной панели; токены предупреждений и ошибок не затрагиваются. */
export function accentCSSVariables(seed:string):Record<string,string> {
  const c=accentShades(seed);
  return {
    "--color-kumo-brand":c.brand,
    "--color-kumo-brand-hover":c.hover,
    "--color-kumo-ring":`light-dark(${c.brand}, ${c.darkText})`,
    "--color-accent-100":c.brand,
    "--color-accent-200":`light-dark(${c.lightText}, ${c.darkText})`,
    "--text-color-kumo-brand":`light-dark(${c.lightText}, ${c.darkText})`,
    "--text-color-kumo-link":`light-dark(${c.lightText}, ${c.darkText})`,
    "--color-selection-bg":`light-dark(${c.lightTint}, ${c.darkTint})`,
    "--color-selection-text":`light-dark(${c.lightText}, #f7f7f8)`,
    "--accent-hue":String(c.hue),
    "--accent-neutral-tint":String(c.neutralTint),
  };
}/** Акцент для встроенных редакторов (гаджетов) в изолированном фрейме. Редакторы светлые,
 * поэтому передаются только оттенки светлой темы; имена с приставкой host не пересекаются
 * с собственными переменными гаджета. Значения — только HEX: фрейм проверяет их перед применением. */
export function gadgetAccentVariables(seed:string):Record<string,string> {
  const c=accentShades(seed);
  return {"--host-accent":c.brand,"--host-accent-hover":c.hover,"--host-accent-text":c.lightText,"--host-accent-tint":c.lightTint};
}
/** Режим темы: светлая, тёмная или как в системе. */
export type ThemeModeChoice = "light" | "dark" | "system";
/** Проверяет значение режима темы из хранилища или от клиента. */
export function isThemeModeChoice(value: unknown): value is ThemeModeChoice {return value==="light"||value==="dark"||value==="system";}
/** Оформление, сохранённое в аккаунте. null в поле — человек его не выбирал. */
export interface AppearancePreference {
  /** Вариант из ACCENT_PALETTE; null — действует общий цвет установки. */
  accent: AccentChoice | null;
  /** Режим темы; null — как в системе. */
  themeMode: ThemeModeChoice | null;
}
/** Строгий разбор: лишние поля и значения вне палитры отвергаются, а не отбрасываются. */
export function parseAppearancePreference(value: unknown): AppearancePreference | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== 2 || !keys.includes("accent") || !keys.includes("themeMode")) return null;
  const {accent, themeMode} = value as Record<string, unknown>;
  if (accent !== null && !isAccentChoice(accent)) return null;
  if (themeMode !== null && !isThemeModeChoice(themeMode)) return null;
  return {accent, themeMode};
}
