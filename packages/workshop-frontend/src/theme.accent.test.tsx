// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { ACCENT_PALETTE, accentShades, accentLuminance, accentCSSVariables } from "@gadgets/workshop-shared/accent-theme";
import { applyAccentColor, readAccentChoice, writeAccentChoice, resolveAccentColor } from "./theme";
import { ThemeProvider, useTheme } from "./ThemeContext";
let root: Root | undefined;
let container: HTMLDivElement;
beforeEach(()=>{
  const values=new Map<string,string>();
  Object.defineProperty(window,"localStorage",{configurable:true,value:{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key),clear:()=>values.clear()}});
  document.documentElement.style.cssText="";
  window.matchMedia=vi.fn<Window["matchMedia"]>().mockReturnValue({matches:false,media:"",onchange:null,addListener:vi.fn<() => void>(),removeListener:vi.fn<() => void>(),dispatchEvent:vi.fn<() => boolean>().mockReturnValue(true),addEventListener:vi.fn<() => void>(),removeEventListener:vi.fn<() => void>()});
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  container=document.createElement("div");document.body.append(container);
});
afterEach(async()=>{if(root)await React.act(async()=>root!.unmount());root=undefined;container?.remove();vi.restoreAllMocks();});
function contrast(a:string,b:string){const x=accentLuminance(a),y=accentLuminance(b);return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05);}
it("Все восемь акцентов сохраняют читаемые кнопки, ссылки и выделение в обеих темах",()=>{
 expect(ACCENT_PALETTE).toHaveLength(8);
 for(const option of ACCENT_PALETTE){const s=accentShades(option.color);
  expect(contrast(s.brand,"#ffffff")).toBeGreaterThanOrEqual(4.5);
  expect(contrast(s.hover,"#ffffff")).toBeGreaterThanOrEqual(4.5);
  expect(contrast(s.lightText,"#ffffff")).toBeGreaterThanOrEqual(4.5);
  expect(contrast(s.darkText,"#27272a")).toBeGreaterThanOrEqual(4.5);
  expect(contrast(s.lightText,s.lightTint)).toBeGreaterThanOrEqual(4.5);
  expect(contrast("#f7f7f8",s.darkTint)).toBeGreaterThanOrEqual(4.5);
 }
});
it("Выбор хранится в браузере, имеет приоритет над общим оформлением и проверяется при чтении",()=>{
 expect(readAccentChoice()).toBeNull();expect(resolveAccentColor(null)).toBe("#21664f");
 expect(writeAccentChoice("blue")).toBe(true);expect(readAccentChoice()).toBe("blue");
 expect(resolveAccentColor(readAccentChoice(),"#ff0000")).toBe("#176b9a");
 window.localStorage.setItem("mnemos:accent-choice","url(https://invalid.example)");expect(readAccentChoice()).toBeNull();
});
it("Изменение акцента не трогает цвета статусов и отвергает произвольный CSS",()=>{
 document.documentElement.style.setProperty("--color-kumo-danger","#ff0000");
 applyAccentColor("#176b9a");expect(document.documentElement.style.getPropertyValue("--color-kumo-brand")).toBe("#176b9a");
 expect(document.documentElement.style.getPropertyValue("--color-kumo-danger")).toBe("#ff0000");
 expect(Object.keys(accentCSSVariables("#176b9a")).some(key=>/danger|warning|success/.test(key))).toBe(false);
 applyAccentColor("url(https://invalid.example)");expect(document.documentElement.style.getPropertyValue("--color-kumo-brand")).toBe("");
});
it("Личный выбор применяется сразу, переживает смену темы и сбрасывается в Mnemos",async()=>{
 function Controls(){const t=useTheme();return <><output>{t.accentColor}</output><button onClick={()=>t.setAccentChoice("red")}>Красный</button><button onClick={()=>t.setThemeMode("dark")}>Тёмная</button><button onClick={()=>t.setAccentChoice("mnemos")}>Сброс</button></>;}
 root=createRoot(container);await React.act(async()=>root!.render(<ThemeProvider><Controls/></ThemeProvider>));
 const buttons=container.querySelectorAll("button");
 await React.act(async()=>buttons[0].click());expect(container.querySelector("output")!.textContent).toBe("#ac3443");expect(readAccentChoice()).toBe("red");
 await React.act(async()=>buttons[1].click());expect(document.documentElement.getAttribute("data-mode")).toBe("dark");expect(document.documentElement.style.getPropertyValue("--color-kumo-brand")).toBe("#ac3443");
 await React.act(async()=>buttons[2].click());expect(document.documentElement.style.getPropertyValue("--color-kumo-brand")).toBe("#21664f");expect(readAccentChoice()).toBe("mnemos");
});
