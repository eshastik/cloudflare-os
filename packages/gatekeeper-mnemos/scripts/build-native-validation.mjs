import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {gunzipSync} from 'node:zlib';
const require=createRequire(new URL('../../workshop-backend/package.json',import.meta.url));
const Y=require('yjs');
const destination=new URL('../src/generated/',import.meta.url);await mkdir(destination,{recursive:true});
for(const [kind,validator] of [['sheets','validateWorkbookSnapshot'],['slides','validateDeck']]){
 const bytes=await readFile(new URL('../../workshop-backend/format-blueprints/workspace-'+kind+'.gadget',import.meta.url));
 const metadata=bytes.readUInt32BE(12);if(bytes.length-24-metadata!==Number(bytes.readBigUInt64BE(16)))throw Error('Повреждён архив редактора');
 const doc=new Y.Doc();let source;
 try{Y.applyUpdateV2(doc,gunzipSync(bytes.subarray(24+metadata)));source=doc.getMap().get('server.js')?.toString();}finally{doc.destroy();}
 const start=source?.indexOf('export class Gadget extends DurableObject {'),end=source?.indexOf('\n}\n',start);
 if(start<0||end<0||!source.includes('function '+validator+'(')||!source.startsWith('import { DurableObject } from "cloudflare:workers";'))throw Error('Контракт редактора изменился');
 // Валидаторы и их функции берутся из того же архива, что редактор. Платформенный класс не включается.
 const helpers=source.slice(0,start).replace('import { DurableObject } from "cloudflare:workers";','')+source.slice(end+3);
 await writeFile(new URL('native-validation-'+kind+'.js',destination),'// Генерируется build-native-validation.mjs из поставляемого редактора.\n'+helpers+'\nexport { '+validator+' };\n');
}
console.log('native-validation: 2 редактора');
