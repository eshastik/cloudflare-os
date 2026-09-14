// ВРЕМЕННЫЙ тест ревью S6: клик по переключателю организации в настоящем Chrome. Удаляется после ревью.
import { test } from "node:test";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { build } from "esbuild";

test("Chrome: клик по кнопке организации", async () => {
  let html = await readFile(new URL("../src/generated/app.txt", import.meta.url), "utf8");
  const probe = `
    window.addEventListener('error', e => parent.postMessage('err:' + (e.error && e.error.message || e.message), '*'));
    const start = Date.now();
    const timer = setInterval(() => {
      const btn = [...document.querySelectorAll('#root button')].find(b => (b.getAttribute('aria-label') || '').startsWith('Организация'));
      const tabs = document.querySelectorAll('[role=tab]').length;
      if (btn && tabs === 8 && document.querySelector('#root').textContent.includes('Team')) {
        clearInterval(timer);
        parent.postMessage('before:tabs=' + tabs, '*');
        btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse', button: 0, isPrimary: true }));
        btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
        btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse', button: 0, isPrimary: true }));
        btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
        btn.click();
        setTimeout(() => {
          const menu = [...document.querySelectorAll('[role=menu],[role=menuitem],[role=menuitemcheckbox]')].map(e => e.getAttribute('role') + ':' + e.textContent).join('|');
          parent.postMessage('after:tabs=' + document.querySelectorAll('[role=tab]').length + ';rootEmpty=' + (document.querySelector('#root').innerHTML.length === 0) + ';menu=' + (menu || 'none'), '*');
        }, 300);
      } else if (Date.now() - start > 8000) { clearInterval(timer); parent.postMessage('timeout:tabs=' + tabs + ';btn=' + !!btn, '*'); }
    }, 50);
  `;
  const hash = createHash("sha256").update(probe).digest("base64");
  html = html.replace(/script-src ('sha256-[^']+')/, `script-src $1 'sha256-${hash}'`);
  html = html.replace("</html>", `<script>${probe}</script></html>`);
  const output = await build({ stdin: { contents: `
    import { RpcTarget, newMessagePortRpcSession } from "capnweb";
    const active=[];
    class UI extends RpcTarget {
      async whoAmI(){return {subject:{tenant_id:'org',user_id:'alice'},tenant_name:'Team'};}
      async listProjects(){return {projects:[]};}
      async listPublicationReviews(){return {reviews:[],next_cursor:''};}
      async listAgentConnections(){return {connections:[],next_cursor:''};}
      async managedAgentRequest(){return null;} async managedTaskRequest(){return null;} async recordUIReadiness(){}
    }
    class Host extends RpcTarget { #ui=new UI();get ui(){return this.#ui;} async subscribeTheme(){return 'light';} }
    const frame=document.createElement('iframe');frame.sandbox='allow-scripts';
    window.addEventListener('message',e=>{
      if(e.source!==frame.contentWindow || e.origin!=='null')return;
      if(e.data?.type==='handshake')active.push(newMessagePortRpcSession(e.ports[0],new Host()));
      else if(typeof e.data==='string'){document.body.dataset.log=(document.body.dataset.log||'')+' '+e.data; if(e.data.startsWith('after')||e.data.startsWith('timeout'))document.body.dataset.done='yes';}
    });
    frame.srcdoc=${JSON.stringify(html)};document.body.append(frame);
  `, resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", platform: "browser", minify: true });
  const script = output.outputFiles[0].text.replaceAll("</script", "<\\/script");
  const dir = await mkdtemp(join(tmpdir(), "mnemos-s6-chrome-"));
  try {
    const page = join(dir, "index.html");
    await writeFile(page, `<body data-done="no"><script>${script}</script></body>`);
    await new Promise((resolve, reject) => {
      const child = spawn(process.env.CHROME_BINARY || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless", "--disable-background-networking", "--disable-component-update", "--disable-sync", "--disable-extensions", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${join(dir, "profile")}`, "--virtual-time-budget=12000", "--dump-dom", `file://${page}`], { detached: true, stdio: ["ignore", "pipe", "pipe"] });
      let out = "", stopped = false;
      const stop = () => { if (stopped) return; stopped = true; try { process.kill(-child.pid, "SIGTERM"); } catch {} };
      const timer = setTimeout(() => { stop(); reject(new Error("Chrome timeout; body=" + (out.match(/<body[^>]*>/)?.[0] || "missing"))); }, 40000);
      child.stdout.on("data", c => { out += c.toString(); const body = out.match(/<body[^>]*>/)?.[0] || ""; if (body.includes('data-done="yes"')) { clearTimeout(timer); console.log("CHROME:", body); stop(); resolve(); } });
      child.once("exit", () => { clearTimeout(timer); const body = out.match(/<body[^>]*>/)?.[0] || "missing"; console.log("CHROME exit:", body); resolve(); });
      child.on("error", e => { clearTimeout(timer); reject(e); });
    });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
