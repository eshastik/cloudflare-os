// @vitest-environment jsdom
import {it,expect,vi} from 'vitest'
import {saveMailAttachment} from './saveMailAttachment'
it('downloads inert binary bytes with a basename and revokes the blob URL',()=>{
 vi.useFakeTimers();let blob:Blob|undefined;let name='';const create=vi.fn((b:Blob)=>{blob=b;return 'blob:fixture'}),revoke=vi.fn();
 vi.stubGlobal('URL',{createObjectURL:create,revokeObjectURL:revoke});const click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(function(this:HTMLAnchorElement){name=this.download;expect(this.href).toBe('blob:fixture')});
 try{saveMailAttachment(new Uint8Array([0,255]),'../folder/contract.bin');expect(name).toBe('contract.bin');expect(blob?.type).toBe('application/octet-stream');expect(blob?.size).toBe(2);expect(document.querySelector('a')).toBeNull();vi.runAllTimers();expect(revoke).toHaveBeenCalledWith('blob:fixture');expect(()=>saveMailAttachment(new Uint8Array(2*1024*1024+1),'file')).toThrow();expect(create).toHaveBeenCalledTimes(1);}
 finally{click.mockRestore();vi.unstubAllGlobals();vi.useRealTimers()}
})
