import {intakePlacement} from "./intake.ts";
export interface IntakeChoice {project:string;domain:string;file:string}
export interface IntakePlanItem {id:string;paths:string[];place:string}
interface FileGroup {id:string;paths:string[];blob_sha256_hex?:string}
/** Выбор папки действует на её поддерево, но не на каталог с похожим префиксом. */
export function selectedFromFolder(alerts:FileGroup[],folder:string):string[] {
 return alerts.filter(alert=>alert.paths.some(path=>folder?path.startsWith(folder+"/"):!path.includes("/"))).map(alert=>alert.id);
}
/** Проверка итоговых адресов до первого изменяющего запроса. */
export function buildIntakePlan(alerts:FileGroup[],selected:Set<string>,choices:Record<string,IntakeChoice>):IntakePlanItem[] {
 const addresses=new Map<string,string>();
 const blobPlaces=new Map<string,string>();
 return alerts.filter(alert=>selected.has(alert.id)).map(alert=>{
  const choice=choices[alert.id];
  if(!choice?.project.trim()||!choice.domain.trim()||!choice.file.trim())throw Error("Укажите проект, область и имя каждого выбранного файла.");
  const place=intakePlacement(choice.project.trim(),choice.domain.trim(),choice.file.trim());
  const blob=alert.blob_sha256_hex||alert.id;
  if(blobPlaces.has(blob)&&blobPlaces.get(blob)!==place)throw Error("Один материал выбран для разных адресов. Оставьте одно размещение для всех его вопросов.");
  if(addresses.has(place)&&addresses.get(place)!==blob)throw Error("У двух файлов одинаковый адрес размещения. Измените имя, область или проект одного из них.");
  addresses.set(place,blob);blobPlaces.set(blob,place);return {id:alert.id,paths:alert.paths,place};
 });
}
