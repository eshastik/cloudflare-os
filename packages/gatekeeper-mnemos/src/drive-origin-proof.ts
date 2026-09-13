/** Provenance bound to one human's exact Mnemos creation request and upload.
 * This is server-only data; a proof carries no document or provider authority. */
export interface DriveOriginClaim {
 version:1;tenant:string;owner:string;project:string;request:string;upload:string;
 expected_head:string;provider:'google-drive'|'yandex-disk'|'webdav';source_binding:string;
 file:string;revision:string;sha256:string;size:number;
}
const encoder=new TextEncoder();
function url64(bytes:Uint8Array){return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
/** Issue from trusted capture state only, with a deployment-owned key. No expiry:
 * exact request/upload binding permits recovery after staging and login expiry. */
export async function signDriveOrigin(key:string,claim:DriveOriginClaim):Promise<string>{
 if(encoder.encode(key).length<32)throw Error('Drive provenance signing is not configured.');
 const payload=encoder.encode(JSON.stringify(claim));if(payload.length>4096)throw Error('Drive provenance is too large.');
 const purpose=encoder.encode('mnemos.drive-origin.v1\0'),input=new Uint8Array(purpose.length+payload.length);input.set(purpose);input.set(payload,purpose.length);
 const signingKey=await crypto.subtle.importKey('raw',encoder.encode(key),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signature=new Uint8Array(await crypto.subtle.sign('HMAC',signingKey,input));
 return url64(payload)+'.'+url64(signature);
}
/** Hide the host source capability key while retaining exact binding equality. */
export async function driveSourceBinding(sourceKey:string):Promise<string>{
 if(!sourceKey||encoder.encode(sourceKey).length>8192)throw Error('Invalid Drive source binding.');
 return [...new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode('mnemos.drive-binding.v1\0'+sourceKey)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
