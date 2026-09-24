import {
  selectUploadFiles, treeFromPaths, type SkippedGroup, type UploadCandidate, type UploadTreeDir, type UploadTreeNode,
} from "../../gatekeeper-mnemos/src/upload-filter.ts";

export interface IntakeDroppedFile {file:File;path:string}

/** Больше файлов за одну загрузку не отправляем: разделите папку на части. */
export const MAX_UPLOAD_FILES = 10000;

/** Что загрузить из выбранного: отобранные материалы и сводка пропущенного. */
export interface IntakeUploadPlan {
  files: IntakeDroppedFile[];
  bytes: number;
  skippedFiles: number;
  /** Счёт пропущенного остановлен на пределе обхода: пропущено не меньше skippedFiles. */
  skippedMore: boolean;
  groups: SkippedGroup[];
  skippedDirs: string[];
  /** Все файлы, включая пропущенные, — для «загрузить всё». */
  allFiles(): Promise<IntakeDroppedFile[]>;
}

const fileOf=(entry:FileSystemFileEntry)=>new Promise<File>((resolve,reject)=>entry.file(resolve,reject));

// .gitignore читается для правил и затем загружается как обычный файл: File берётся один раз.
const once=<T,>(load:()=>Promise<T>)=>{let value:Promise<T>|undefined;return()=>value??=load();};

// Каталог перетаскивания как дерево для отбора. Каталог читается страницами до пустой.
function entryTree(entry:FileSystemDirectoryEntry):UploadTreeDir<File> {
 return {kind:"dir",name:entry.name,children:async()=>{
  const reader=entry.createReader();const all:FileSystemEntry[]=[];
  while(true){const page=await new Promise<FileSystemEntry[]>((resolve,reject)=>reader.readEntries(resolve,reject));if(!page.length)break;all.push(...page);}
  return all.flatMap((child):UploadTreeNode<File>[]=>child.isFile?[{kind:"file",name:child.name,load:once(()=>fileOf(child as FileSystemFileEntry))}]:child.isDirectory?[entryTree(child as FileSystemDirectoryEntry)]:[]);
 }};
}

// .gitignore больше мегабайта — не список шаблонов, а что-то другое; правил из него не берём.
async function readText(file:File):Promise<string>{
 if(file.size>1024*1024)throw Error("Слишком большой .gitignore");
 if(typeof file.text==="function")return file.text();
 return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(reader.error);reader.readAsText(file);});
}

async function resolve(candidates:UploadCandidate<File>[]):Promise<IntakeDroppedFile[]>{
 const out:IntakeDroppedFile[]=[];
 for(const {path,node} of candidates)out.push({path,file:await node.load()});
 return out;
}

/** Отбор для деревьев папок; отдельно выбранные файлы (loose) загружаются как есть. */
export async function planUpload(roots:UploadTreeDir<File>[],loose:IntakeDroppedFile[]=[],options:{filter?:boolean}={}):Promise<IntakeUploadPlan>{
 const kept:IntakeDroppedFile[]=[...loose],skipped:UploadCandidate<File>[]=[],groups=new Map<string,number>(),skippedDirs:string[]=[];
 let skippedMore=false;
 for(const root of roots){
  const selection=await selectUploadFiles(root,readText,{filter:options.filter});
  // Материалы превращаются в File сразу (нужен размер), пропущенное — только по «загрузить всё».
  kept.push(...await resolve(selection.kept));
  skipped.push(...selection.skipped);skippedDirs.push(...selection.skippedDirs);skippedMore||=selection.truncated;
  for(const group of selection.groups)groups.set(group.label,(groups.get(group.label)??0)+group.files);
 }
 return {
  files:kept,bytes:kept.reduce((sum,{file})=>sum+file.size,0),skippedFiles:skipped.length,skippedMore,skippedDirs,
  groups:[...groups].map(([label,files])=>({label,files})).sort((a,b)=>b.files-a.files||a.label.localeCompare(b.label)),
  allFiles:async()=>[...kept,...await resolve(skipped)],
 };
}

/** Отбор перетаскивания: папки — через правила, отдельные файлы — как есть. */
export async function planIntakeDrop(transfer:DataTransfer,options:{filter?:boolean}={}):Promise<IntakeUploadPlan>{
 const items=Array.from(transfer.items??[]).filter(item=>item.kind==="file");
 const roots:UploadTreeDir<File>[]=[],loose:IntakeDroppedFile[]=[];
 if(items.length){
  // DataTransfer закрывается после события: захватываем ссылки до первого await.
  const entries=items.map(item=>({entry:item.webkitGetAsEntry?.(),file:item.getAsFile()}));
  for(const {entry,file} of entries){
   if(entry?.isDirectory)roots.push(entryTree(entry as FileSystemDirectoryEntry));
   else if(entry?.isFile)loose.push({file:await fileOf(entry as FileSystemFileEntry),path:entry.name});
   else if(file)loose.push({file,path:file.webkitRelativePath||file.name});
  }
 }else for(const file of Array.from(transfer.files??[]))loose.push({file,path:file.webkitRelativePath||file.name});
 return planUpload(roots,loose,options);
}

/** Отбор выбранной через input папки: браузер уже отдал плоский список с путями. */
export async function planPickedFiles(files:IntakeDroppedFile[],options:{filter?:boolean}={}):Promise<IntakeUploadPlan>{
 const nested=files.filter(({path})=>path.includes("/")),loose=files.filter(({path})=>!path.includes("/"));
 return planUpload(treeFromPaths(nested),loose,options);
}

/** Одна папка целиком, с отбором. */
export async function planDirectoryEntry(entry:FileSystemDirectoryEntry,options:{filter?:boolean}={}):Promise<IntakeUploadPlan>{
 return planUpload([entryTree(entry)],[],options);
}

/** Все файлы перетаскивания без отбора, с путями от имени папки. */
export async function collectIntakeDrop(transfer:DataTransfer):Promise<IntakeDroppedFile[]> {
 return (await planIntakeDrop(transfer,{filter:false})).files;
}
