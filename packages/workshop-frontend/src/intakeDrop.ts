export interface IntakeDroppedFile {file:File;path:string}
/** Читает дерево только из пользовательского drop; файлы не покидают браузер при перечислении. */
export async function collectIntakeDrop(transfer:DataTransfer):Promise<IntakeDroppedFile[]> {
 const result:IntakeDroppedFile[]=[];
 async function visit(entry:FileSystemEntry,path:string,depth:number):Promise<void>{
  if(depth>32||result.length>=10000)throw Error("Слишком большая папка. Разделите загрузку на части.");
  const name=path?path+"/"+entry.name:entry.name;
  if(entry.isFile){const file=await new Promise<File>((resolve,reject)=>(entry as FileSystemFileEntry).file(resolve,reject));result.push({file,path:name});return;}
  if(entry.isDirectory){const reader=(entry as FileSystemDirectoryEntry).createReader();while(true){const entries=await new Promise<FileSystemEntry[]>((resolve,reject)=>reader.readEntries(resolve,reject));if(!entries.length)break;for(const child of entries)await visit(child,name,depth+1);}}
 }
 const items=Array.from(transfer.items??[]).filter(item=>item.kind==="file");
 if(items.length){
  // DataTransfer закрывается после события: захватываем ссылки до первого await.
  const entries=items.map(item=>({entry:item.webkitGetAsEntry?.(),file:item.getAsFile()}));
  for(const {entry,file} of entries){if(entry)await visit(entry,"",0);else if(file)result.push({file,path:file.webkitRelativePath||file.name});}
 }else for(const file of Array.from(transfer.files??[]))result.push({file,path:file.webkitRelativePath||file.name});
 return result;
}
