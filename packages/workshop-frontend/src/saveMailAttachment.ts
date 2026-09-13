/** Download bytes as a file; untrusted names cannot select paths or execute content. */
export function saveMailAttachment(bytes:Uint8Array,filename:string):void {
 if(!(bytes instanceof Uint8Array)||bytes.byteLength>2*1024*1024||typeof filename!=='string'||filename.length>4096)throw Error('Attachment unavailable.')
 const name=filename.split(/[\\/]/).at(-1)!.replace(/[\x00-\x1f\x7f<>:"|?*\u202a-\u202e\u2066-\u2069]/g,'_').replace(/^[. ]+|[. ]+$/g,'').slice(0,180)||'attachment'
 const url=URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type:'application/octet-stream'}))
 const a=document.createElement('a');a.href=url;a.download=name;a.style.display='none';document.body.append(a)
 try{a.click()}finally{a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
}
