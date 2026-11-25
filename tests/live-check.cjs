// A read-only look at the deployed site after a release: it loads pages and reads what they show, and never answers a
// question, so it adds nothing to the live game's data. Usage: node tests/live-check.cjs [https://site]
const { chromium } = require('playwright');
const SITE = process.argv[2] || 'https://iceberg-eight-silk.vercel.app/';
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('PASS  ' + name); } else { fail++; console.log('FAIL  ' + name + (extra ? '  [' + extra + ']' : '')); } };

(async () => {
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  const b = await chromium.launch(proxy ? { proxy: { server: proxy } } : {});
  for (const vp of [{ name: 'phone', viewport: { width: 390, height: 844 } }, { name: 'desk', viewport: { width: 1280, height: 820 } }]) {
    const ctx = await b.newContext({ viewport: vp.viewport, ignoreHTTPSErrors: !!proxy }), p = await ctx.newPage(), errs = [], asked = [];
    p.on('pageerror', e => errs.push(e.message));
    p.on('request', r => { if (r.url().includes('day_content')) asked.push(r.url()); });
    await p.goto(SITE + '?v=' + Date.now(), { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => { const b = document.querySelector('#play'); return b && !b.disabled; }, null, { timeout: 30000 }).catch(() => {});
    const s = await p.evaluate(() => ({ title: document.title, play: document.querySelector('#play').textContent.trim(), mode: (document.querySelector('.mode[data-mode="daily"]') || {}).textContent,
      icon: !!document.querySelector('link[rel="apple-touch-icon"]'), q: typeof CATS !== 'undefined' ? CATS.length : 0, prompt: typeof CATS !== 'undefined' && CATS[0] ? CATS[0].prompt : '',
      day: window.Game ? Game.today() : 0, journal: !!window.Journal, menu: !!document.querySelector('#menu-panel [data-go="journal"]'), slab: !!document.querySelector('.q-berg') }));
    ok(`${vp.name}: the site is the new release (Deeple, Icebreaker, the iceberg icon)`, s.title === 'Deeple' && /Icebreaker/.test(s.mode) && s.icon, JSON.stringify([s.title, s.mode, s.icon]));
    ok(`${vp.name}: today's five questions load (day ${s.day})`, s.q === 5 && s.play === "Play today's Icebreaker", `${s.q} · ${s.play} · ${s.prompt}`);
    ok(`${vp.name}: journal, menu item and the question's block of ice are present`, s.journal && s.menu && s.slab);
    ok(`${vp.name}: no page errors`, errs.length === 0, errs.join(' | '));
    // An upcoming day must not be readable yet: ask the database directly, as anyone could.
    if (vp.name === 'desk') {
      const future = await p.evaluate(async d => { const r = await fetch(`${BACKEND.url}/rest/v1/rpc/day_content`, { method: 'POST', headers: { apikey: BACKEND.anonKey, Authorization: `Bearer ${BACKEND.anonKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_day: d }) }); return [r.status, await r.text()]; }, s.day + 3);
      ok(`upcoming day ${s.day + 3} is locked (the database returns nothing)`, future[0] === 200 && future[1] === 'null', future.join(' '));
      const table = await p.evaluate(async () => { const r = await fetch(`${BACKEND.url}/rest/v1/content_days?select=day&limit=1`, { headers: { apikey: BACKEND.anonKey, Authorization: `Bearer ${BACKEND.anonKey}` } }); return r.status; });
      ok('the prepared-content table cannot be read directly', table === 401 || table === 403 || table === 404, String(table));
      const files = await p.evaluate(async () => (await Promise.all(['content/schedule.json', 'content/build/days/10.json', 'tools/content/build.py', 'supabase/0006_content.sql'].map(f => fetch(f).then(r => r.status)))));
      ok('private content, tools and database files are not on the site', files.every(x => x === 404), files.join(','));
    }
    await ctx.close();
  }
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.log('STOPPED: ' + e.message); process.exit(1); });
