import {it,expect} from 'vitest';
import {UserDurableObject} from '../src/user';
import {DriveImportGuard} from '../src/drive-import-lease';
import {DEFAULT_ADMIN_CONFIG,serializeAdminConfig} from '../src/admin-config';

it.each(['google','yandex'])('%s retains source and current policy on retry',async(vendor)=>{
 const pattern=vendor==='google'?'https://drive.google.com/file/:fileId/*':'https://disk.yandex.ru/*';
 const records=new Map();let config=DEFAULT_ADMIN_CONFIG,sourceLive=true,targetLive=true,factories=0,reads=0,lost=true,saved=false;
 const posts:unknown[][]=[];let duringRead=()=>{};
 const snapshot={provider:'google-drive',fileId:'file'};
 const source={validate:async()=>{},read:async()=>{reads++;duringRead();return snapshot}};
 const google={getDriveImportSource:async()=>{factories++;return {source,sourceKey:'epoch-one/file',resource:{urlPattern:pattern}}}};
 const mnemos={captureDriveImport:async(...args:any[])=>{
  posts.push(args.slice(0,4));
  if(!saved){await args[4].read();saved=true}
  if(lost){lost=false;throw Error('lost reply')}
  return {node_id:'node',head:'head'};
 }};
 const user=Object.create(UserDurableObject.prototype) as UserDurableObject;
 Object.assign(user,{env:{BLUEPRINTS:{get:async()=>serializeAdminConfig(config)}},storage:{connectedAccounts:{get:(id:number)=>id===7&&sourceLive?{id,vendorId:vendor,account:google}:id===8&&targetLive?{id,vendorId:'mnemos',account:mnemos}:undefined}},ctx:{id:{toString:()=> 'user'},storage:{kv:{get:(key:string)=>records.get(key),put:(key:string,value:unknown)=>records.set(key,value)}},exports:{DriveImportLease:({props}:any)=>new DriveImportGuard(props.source,()=>user.checkCalendarSourceAccounts(props.accounts))}}});
 await expect(user.captureDriveImport(99,8,'file','project','request')).rejects.toThrow('unavailable');
 config={...DEFAULT_ADMIN_CONFIG,disabledResources:{[vendor]:[pattern]}};
 await expect(user.captureDriveImport(7,8,'file','project','request')).rejects.toThrow('disabled');expect(factories).toBe(0);
 config=DEFAULT_ADMIN_CONFIG;
 await expect(user.captureDriveImport(7,8,'file','project','request')).rejects.toThrow('lost reply');
 sourceLive=false;
 await expect(user.captureDriveImport(7,8,'file','project','request')).resolves.toEqual({node_id:'node',head:'head'});
 expect(factories).toBe(1);expect(reads).toBe(1);expect(posts[1]).toEqual(posts[0]);
 await expect(user.captureDriveImport(7,8,'other','project','request')).rejects.toThrow('changed');
 targetLive=false;await expect(user.captureDriveImport(7,8,'file','project','request')).rejects.toThrow('unavailable');
 targetLive=true;sourceLive=true;saved=false;duringRead=()=>{sourceLive=false};
 await expect(user.captureDriveImport(7,8,'file','project','new-request')).rejects.toThrow('unavailable');
});
