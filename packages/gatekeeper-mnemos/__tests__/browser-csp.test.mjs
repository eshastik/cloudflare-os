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
      const child = spawn(process.env.CHROME_BINARY || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless", "--disable-background-networking", "--disable-component-update", "--disable-sync", "--disable-extensions", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${join(dir,"profile")}`, "--virtual-time-budget=3000", "--dump-dom", `file://${page}`], { detached:true, stdio:["ignore","pipe","pipe"] });
      let output = "", diagnostics = "", evidence = false, stopped = false;
      const stop = () => {
        if(stopped)return; stopped=true;
        try { process.kill(-child.pid,"SIGTERM"); } catch {}
        child.stdout.destroy();child.stderr.destroy();
      };
      const timer=setTimeout(()=>{stop();reject(new Error(`Chrome did not produce CSP/RPC evidence before timeout; body=${output.match(/<body[^>]*>/)?.[0] || "missing"}; stderr=${diagnostics}`));},10000);
      child.on("error",error=>{clearTimeout(timer);stop();reject(error);});
      child.stdout.on("data",chunk=>{
        output+=chunk.toString();
        if(output.length>4<<20){clearTimeout(timer);stop();reject(new Error("Browser output limit"));return;}
        const body=output.match(/<body[^>]*>/)?.[0] || "";
        if(markers.every(marker=>body.includes(marker))){evidence=true;stop();}
      });
      child.once("exit",()=>{
        clearTimeout(timer);stop();
        if(evidence)resolve();else reject(new Error(`Chrome exited without CSP/RPC evidence; body=${output.match(/<body[^>]*>/)?.[0] || "missing"}; stderr=${diagnostics}`));
      });
      child.stderr.on("data", chunk => { diagnostics = (diagnostics + chunk.toString()).slice(-4096); });
    });

  } finally { await rm(dir,{recursive:true,force:true}); }
});
