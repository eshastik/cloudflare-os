import { test } from "node:test";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { build } from "esbuild";

test("Chrome allows the app RPC but blocks network and unapproved inline code", async () => {
  let html = await readFile(new URL("../src/generated/app.txt", import.meta.url), "utf8");
  const probe = `document.addEventListener('securitypolicyviolation', e => { if(e.effectiveDirective==='connect-src') parent.postMessage('network-blocked','*'); if(e.effectiveDirective==='script-src-elem') parent.postMessage('inline-blocked','*'); }); fetch('http://127.0.0.1:9/csp-probe').catch(()=>{});`;
  const hash = createHash("sha256").update(probe).digest("base64");
  html = html.replace(/script-src ('sha256-[^']+')/, `script-src $1 'sha256-${hash}'`);
  html = html.replace("</html>", `<script>${probe}</script><script>parent.postMessage('evil-executed','*')</script></html>`);
  const output = await build({ stdin: { contents: `
    import { RpcTarget, newMessagePortRpcSession } from "capnweb";
    let calls=0; const active=[];
    function seen(){ if(++calls>=3) document.body.dataset.ready='yes'; }
    class UI extends RpcTarget {
      async whoAmI(){seen();return {subject:{tenant_id:'org',user_id:'alice'},tenant_name:'Team'};}
      async listProjects(){seen();return {projects:[]};}
      async listAgentConnections(){seen();return {connections:[]};}
    }
    class Host extends RpcTarget { #ui=new UI();get ui(){return this.#ui;} async subscribeTheme(){return 'light';} }
    const frame=document.createElement('iframe');frame.sandbox='allow-scripts';
    window.addEventListener('message',e=>{
      if(e.source!==frame.contentWindow || e.origin!=='null')return;
      if(e.data?.type==='handshake')active.push(newMessagePortRpcSession(e.ports[0],new Host()));
      if(e.data==='network-blocked')document.body.dataset.network='blocked';
      if(e.data==='inline-blocked')document.body.dataset.inline='blocked';
      if(e.data==='evil-executed')document.body.dataset.evil='yes';
    });
    frame.srcdoc=${JSON.stringify(html)};document.body.append(frame);
  `, resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", platform: "browser", minify: true });
  const script = output.outputFiles[0].text.replaceAll("</script", "<\\/script");
  const dir = await mkdtemp(join(tmpdir(), "mnemos-browser-csp-"));
  try {
    const page = join(dir, "index.html");
    await writeFile(page, `<body data-ready="no" data-network="no" data-inline="no" data-evil="no"><script>${script}</script></body>`);
    const markers = ['data-ready="yes"','data-network="blocked"','data-inline="blocked"','data-evil="no"'];
    await new Promise((resolve, reject) => {
      const child = spawn(process.env.CHROME_BINARY || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless", "--disable-background-networking", "--disable-component-update", "--disable-sync", "--disable-extensions", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${join(dir,"profile")}`, "--remote-debugging-port=0", `file://${page}`], { detached:true, stdio:["ignore","ignore","pipe"] });
      let diagnostics="",socket,started=false,finished=false,body="missing";
      const pending=new Map();let sequence=0;
      const finish=(error)=>{
        if(finished)return;finished=true;clearTimeout(timer);
        for(const {reject} of pending.values())reject(error || new Error("browser closed"));pending.clear();
        socket?.close();try{process.kill(-child.pid,"SIGTERM")}catch{}child.stderr.destroy();
        if(error)reject(error);else resolve();
      };
      const timer=setTimeout(()=>finish(new Error(`Chrome readiness timeout: ${body}`)),10000);
      child.once("error",finish);
      child.once("exit",()=>{if(!finished)finish(new Error(`Chrome exited before readiness: ${body}`))});
      child.stderr.on("data",chunk=>{
        diagnostics=(diagnostics+chunk.toString()).slice(-4096);
        const endpoint=diagnostics.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1];
        if(!endpoint||started)return;started=true;
        void (async()=>{
          socket=new WebSocket(endpoint);
          await new Promise((yes,no)=>{socket.addEventListener("open",yes,{once:true});socket.addEventListener("error",no,{once:true})});
          socket.addEventListener("message",event=>{
            const result=JSON.parse(String(event.data)),callback=pending.get(result.id);
            if(callback){pending.delete(result.id);result.error?callback.reject(new Error(result.error.message)):callback.resolve(result.result)}
          });
          const call=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}))});
          let session;
          while(!finished){
            if(!session){
              const {targetInfos}=await call("Target.getTargets");
              const target=targetInfos.find(t=>t.type==='page'&&t.url===`file://${page}`);
              if(target)session=(await call("Target.attachToTarget",{targetId:target.targetId,flatten:true})).sessionId;
            }
            if(session){
              const {result}=await call("Runtime.evaluate",{expression:"document.body?.outerHTML.slice(0,200)",returnByValue:true},session);
              body=result.value??"missing";
              if(markers.every(marker=>body.includes(marker))){finish();return}
            }
            await new Promise(resolve=>setTimeout(resolve,50));
          }
        })().catch(finish);
      });
    });

  } finally { await rm(dir,{recursive:true,force:true}); }
});
