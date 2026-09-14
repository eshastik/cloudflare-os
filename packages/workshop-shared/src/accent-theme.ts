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
/** Числовые оттенки: одинаковый контраст в браузере и тесте, без относительного CSS цвета. */
export function accentShades(seed:string) {
  if(!isAccentHex(seed)) seed=ACCENT_PALETTE[0].color;
  let brand=mix(seed,"#000000",0);
  // Администратор может задать светлый цвет. Белая надпись кнопки должна остаться читаемой.
  while((1.05/(accentLuminance(brand)+0.05))<4.8) brand=mix(brand,"#000000",0.06);
  return {brand,hover:mix(brand,"#000000",0.15),lightText:mix(brand,"#000000",0.12),darkText:mix(brand,"#ffffff",0.65),lightTint:mix(brand,"#ffffff",0.93),darkTint:mix(brand,"#000000",0.65)};
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
  };
}
