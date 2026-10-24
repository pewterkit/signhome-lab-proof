// Lab timing · own-domain sign-in fix · 24 Oct 2026.
// Measures "wrong chooser -> right chooser" for the fix steps a script CAN perform in our test lab, with no deploy,
// no console change, no DNS change and no Google account. Usage: node ops-lab-timing.mjs <runs> [fixPackUrl]
// Per run: (B) customer app with default authDomain -> Google chooser read; (3) copy the Workers snippet from the LIVE
// preview pack page and paste it into the app's fetch handler; (4) set authDomain to the host from the pack;
// (R) "redeploy" = re-import the edited module locally (stand-in, NOT Cloudflare deploy time); (A) chooser read again.
// Pack steps 1 (Google Cloud redirect URI) and 2 (Firebase authorised domain) are NOT performed: the lab host is
// already registered and changing either console needs a person signed in to that console. They are reported, not timed.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const RUNS = +(process.argv[2] || 3); const PACK_URL = process.argv[3] || '<fix-pack-url>';
const HOST = 'lab.pewterkit.com';
const tpl = readFileSync(new URL('./customer-app.template.js', import.meta.url), 'utf8');
const now = () => performance.now(); const ms = (a, b) => Math.round(b - a);
const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const b = await chromium.launch(); const runs = [];
async function chooser(ctx, tag, dir) {
  const p = await ctx.newPage(); const t0 = now();
  await p.goto(`https://${HOST}/`, { waitUntil: 'networkidle', timeout: 30000 });
  await p.locator('text=Sign in with Google (redirect)').click();
  const went = await p.waitForURL(/accounts\.google\.com/, { timeout: 30000 }).then(() => true, () => false);
  let shown = null, err = null;
  if (went) {
    await p.locator('text=/to continue to/i').first().waitFor({ timeout: 15000 }).catch(() => {});
    const t = await p.locator('body').innerText(); const m = t.match(/to continue to\s+(\S+)/i);
    shown = m ? m[1] : null; if (!m) err = (t.match(/Error \d+: \S+/) || [t.slice(0, 160).replace(/\s+/g, ' ')])[0];
  } else err = 'stayed on app: ' + (await p.locator('#out').innerText().catch(() => ''));
  const t1 = now(); await p.screenshot({ path: `${dir}/${tag}.png` }); await p.close();
  return { shown, err, ms: ms(t0, t1), shot: `${tag}.png` };
}
for (let i = 1; i <= RUNS; i++) {
  const dir = `run${i}`; mkdirSync(dir, { recursive: true });
  const r = { run: i, startedAt: new Date().toISOString(), steps: {} };
  let src = tpl; writeFileSync(`${dir}/app-before.mjs`, src);
  let mod = await import(pathToFileURL(`${process.cwd()}/${dir}/app-before.mjs`).href + `?v=${Date.now()}`);
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
  // Serve https://lab.pewterkit.com from the local module inside this browser only (Playwright route).
  await ctx.route(`https://${HOST}/**`, async (route) => {
    const q = route.request(); const body = q.postDataBuffer();
    const req = new Request(q.url(), { method: q.method(), headers: q.headers(), body: body && q.method() !== 'GET' ? body : undefined });
    try {
      const res = await mod.default.fetch(req, {});
      const h = Object.fromEntries([...res.headers].filter(([k]) => !['content-encoding', 'content-length', 'transfer-encoding'].includes(k)));
      await route.fulfill({ status: res.status, headers: h, body: Buffer.from(await res.arrayBuffer()) });
    } catch (e) { await route.fulfill({ status: 500, body: 'local worker error: ' + e.message }); }
  });
  // (B) wrong chooser
  r.steps.before = await chooser(ctx, 'before-chooser', dir);
  const tWrong = now();
  // (3) copy the Workers snippet from the live preview pack and paste it into the fetch handler
  let t = now();
  const pack = await (await fetch(PACK_URL)).text();
  const snip = decode((pack.match(/<div class="pk-prompt" id="snip">([\s\S]*?)<button/) || [])[1] || '');
  const packAuth = decode((pack.match(/Then set <code>authDomain: "([^"]+)"/) || [])[1] || '');
  const packExpect = decode((pack.match(/Expected: Google names <code>([^<]+)<\/code>/) || [])[1] || '');
  if (!snip) throw new Error('snippet not found on pack page');
  src = src.replace('async fetch(req, env) {', 'async fetch(req, env) {\n    ' + snip.trim().split('\n').join('\n    '));
  r.steps.s3_paste_snippet = { ms: ms(t, now()), snippetChars: snip.length, snippet: snip.trim() };
  // (4) set authDomain to the value the pack gives
  t = now();
  src = src.replace('authDomain: "pewterkit-day0.firebaseapp.com"', `authDomain: "${packAuth}"`);
  r.steps.s4_set_authDomain = { ms: ms(t, now()), value: packAuth };
  // (R) local "redeploy" stand-in
  t = now(); writeFileSync(`${dir}/app-after.mjs`, src);
  mod = await import(pathToFileURL(`${process.cwd()}/${dir}/app-after.mjs`).href + `?v=${Date.now()}`);
  r.steps.redeploy_local_standin = { ms: ms(t, now()), note: 'local module reload, NOT Cloudflare deploy time' };
  // (A) right chooser
  r.steps.after = await chooser(ctx, 'after-chooser', dir);
  r.wrongToRightMs = ms(tWrong, now());
  r.packExpectedLine = packExpect; r.registrableExpected = 'pewterkit.com';
  r.pass = /firebaseapp\.com$/.test(r.steps.before.shown || '') && r.steps.after.shown === 'pewterkit.com';
  r.packExpectedMatchesReality = packExpect === r.steps.after.shown;
  await ctx.close(); runs.push(r);
  console.log(`run${i}: ${r.pass ? 'PASS' : 'FAIL'} before=${r.steps.before.shown} after=${r.steps.after.shown} wrong->right=${r.wrongToRightMs}ms (paste ${r.steps.s3_paste_snippet.ms} · authDomain ${r.steps.s4_set_authDomain.ms} · reload ${r.steps.redeploy_local_standin.ms} · after-chooser ${r.steps.after.ms}) packExpected=${packExpect}`);
}
await b.close();
writeFileSync('timings.json', JSON.stringify({ script: 'ops-lab-timing.mjs', pack: PACK_URL, host: HOST, runs }, null, 1));
process.exit(runs.every((r) => r.pass) ? 0 : 1);
