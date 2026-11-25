// How the game feels, measured: plays real questions in a real browser and times what a player waits for.
//   node tests/perf.cjs [--url=URL] [--vp=desk|phone] [--cpu=4] [--net=slow] [--questions=5] [--deep] [--reduce] [--json=out.json]
// For each question it records, from the moment the key or button is pressed:
//   feedback   until something on screen changes (the guess slot, the button)
//   landed     until the answer's reveal has finished and the box is usable again
//   results    after the third guess lands: until the question's results appear
//   next       after "Next question": until the next question's text is on screen, the box is usable, the clock runs
// plus frame times during camera moves and in general, long main-thread tasks, and memory across the questions.
// --deep makes the first question's last guess a Challenger Deep answer (beneath the iceberg, with the squid).
const { chromium, serve, VPS } = require('./lib.cjs');
const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.split('=').slice(1).join('=') : process.argv.includes(`--${k}`) ? true : d; };
const API = arg('api', false), AUTH = arg('auth', false);   // --api: use the local stand-in server (GATEWAY_DELAY=ms makes it slow); --auth: play signed in
const URL0 = arg('url', ''), VP = arg('vp', 'desk'), CPU = +arg('cpu', 1), NET = arg('net', ''), QN = +arg('questions', 5), DEEP = !!arg('deep', false), OUT = arg('json', '');
const pct = (a, p) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))]; };
const r0 = n => Math.round(n);

(async () => {
  const site = URL0 ? null : serve(8810), b = await chromium.launch();
  const ctx = await b.newContext({ viewport: VPS[VP], hasTouch: VP !== 'desk', reducedMotion: arg('reduce', false) ? 'reduce' : 'no-preference' }), p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  if (NET === 'slow') { await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 300, downloadThroughput: 1.6 * 1024 * 1024 / 8, uploadThroughput: 750 * 1024 / 8 }); }
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  // Instruments: every frame's time, long tasks, and a stamp for anything we ask about.
  await p.addInitScript(() => {
    window.__perf = { frames: [], long: [], marks: {} };
    let last = 0; const tick = t => { if (last) window.__perf.frames.push([t, t - last]); last = t; requestAnimationFrame(tick); }; requestAnimationFrame(tick);
    try { new PerformanceObserver(l => l.getEntries().forEach(e => window.__perf.long.push([e.startTime, e.duration]))).observe({ type: 'longtask', buffered: true }); } catch { /* not supported */ }
  });
  const base = URL0 || 'http://localhost:8810/';
  let gw = null, apiQ = '', auth = null;
  if (API) { gw = require('./gateway.cjs'); await new Promise(r => gw.server.listen(8790, r)); apiQ = `&api=http://localhost:8790&key=${gw.ANON}`; }
  const t0 = Date.now();
  await p.goto(base + (base.includes('?') ? '&' : '?') + 'test&time=20&reset' + apiQ, { timeout: 120000 });
  await p.waitForSelector('#play', { timeout: 120000 }); const loadMs = Date.now() - t0;
  if (API) await p.waitForFunction(() => window.Account && Account.state !== 'off', null, { timeout: 15000 });
  if (AUTH) {
    // sign up a fresh player, timing each step as a player would feel it
    const email = `perf${Date.now()}@example.test`;
    auth = await p.evaluate(async email => { const t = performance.now(); await Account.signUp(email, 'secret12'); const a = performance.now() - t; const t2 = performance.now(); await Account.claim('P' + String(Date.now()).slice(-8), 'dumbo'); return { signUp: Math.round(a), claim: Math.round(performance.now() - t2) }; }, email);
    await p.evaluate(() => { location.hash = ''; }); await p.waitForTimeout(300);
  }
  await p.waitForFunction(() => !document.querySelector('#play').disabled, null, { timeout: 120000 }); await p.waitForTimeout(600);
  // Start: press Play, time until the first question can be typed into.
  const startT = await p.evaluate(() => new Promise(res => { const t = performance.now(); document.querySelector('#play').click(); const w = () => { const i = document.querySelector('#answer'); if (window.ICEBERG_TEST && ICEBERG_TEST.screen === 'play' && document.activeElement === i) res(performance.now() - t); else requestAnimationFrame(w); }; w(); }));
  await p.waitForTimeout(1500);
  const rows = [];
  for (let q = 0; q < QN; q++) {
    // three answers, each rarer than the last, as a good player would give
    const ans = await p.evaluate(([deep, q]) => { const c = ICEBERG_TEST.cats[ICEBERG_TEST.state.round], I = window.Iceberg, list = c.answers.filter(a => !a.x).sort((a, b) => b.s - a.s), at = f => list[Math.min(list.length - 1, Math.floor(f * list.length))].a;
      const beyond = deep && q === 0 && I.isBeyond ? c.answers.filter(a => I.isBeyond(I.depthOf(a.s)))[0] : null;
      return [at(0.05), at(0.45), beyond ? beyond.a : at(0.8)]; }, [DEEP, q]);
    const row = { q: q + 1, guesses: [] };
    for (let g = 0; g < 3; g++) {
      await p.fill('#answer', ans[g]);
      const m = await p.evaluate(gi => new Promise(res => {
        const slots = document.querySelector('#slots'), t = performance.now(); let feedback = 0;
        const mo = new MutationObserver(() => { if (!feedback) feedback = performance.now() - t; }); mo.observe(slots, { subtree: true, attributes: true, childList: true, characterData: true });
        const input = document.querySelector('#answer'); input.form.requestSubmit();
        const waitLanded = () => { if (!ICEBERG_TEST.busy && ICEBERG_TEST.berg.view.settled && (ICEBERG_TEST.state.phase === 'done' || ICEBERG_TEST.clock.on || gi === 2)) { mo.disconnect(); res({ t, feedback, landed: performance.now() - t }); } else requestAnimationFrame(waitLanded); };
        requestAnimationFrame(waitLanded);
      }), g);
      row.guesses.push(m);
      if (g === 2) {
        // after the third: how long until the results appear
        row.results = await p.evaluate(t => new Promise(res => { const w = () => { const d = document.querySelector('#done-panel'); if (d && !d.hidden && getComputedStyle(d).opacity > 0.5) res(performance.now() - t); else requestAnimationFrame(w); }; w(); }), m.t);
      } else await p.waitForTimeout(250);   // a person needs a moment to type the next one
    }
    await p.waitForTimeout(1200);           // reading the results
    if (q === QN - 1) { rows.push(row); break; }
    row.next = await p.evaluate(() => new Promise(res => {
      const t = performance.now(), before = document.querySelector('#q-title').textContent, r = { visible: 0, typing: 0, clock: 0, settled: 0, feedback: 0 };
      const btn = document.querySelector('#next'), mo = new MutationObserver(() => { if (!r.feedback) r.feedback = performance.now() - t; }); mo.observe(document.querySelector('[data-screen="play"]'), { subtree: true, attributes: true, childList: true });
      btn.click();
      const w = () => {
        const n = performance.now() - t, i = document.querySelector('#answer'), title = document.querySelector('#q-title');
        if (!r.visible && title.textContent !== before && getComputedStyle(document.querySelector('.q')).opacity > 0.9) r.visible = n;
        if (!r.typing && document.activeElement === i && !i.disabled && ICEBERG_TEST.state.phase === 'play') r.typing = n;
        if (!r.clock && ICEBERG_TEST.clock.on) r.clock = n;
        if (!r.settled && ICEBERG_TEST.berg.view.settled && !ICEBERG_TEST.busy && r.visible) r.settled = n;
        if ((r.visible && r.typing && r.clock && r.settled) || n > 8000) { mo.disconnect(); res(r); } else requestAnimationFrame(w);
      }; w();
    }));
    rows.push(row);
    await p.waitForTimeout(400);
  }
  const perf = await p.evaluate(() => ({ frames: window.__perf.frames.map(f => f[1]), long: window.__perf.long, mem: performance.memory ? performance.memory.usedJSHeapSize : 0 }));
  const fr = perf.frames.filter(x => x < 1000);
  const out = {
    url: base, vp: VP, reduce: !!arg('reduce', false), cpu: CPU, net: NET || 'normal', deep: DEEP, api: !!API, delay: +(process.env.GATEWAY_DELAY || 0), auth, loadMs, startToTyping: r0(startT),
    perQuestion: rows.map(r => ({ q: r.q, feedback: r.guesses.map(g => r0(g.feedback)), landed: r.guesses.map(g => r0(g.landed)), thirdToResults: r0(r.results || 0), next: r.next ? Object.fromEntries(Object.entries(r.next).map(([k, v]) => [k, r0(v)])) : null })),
    frames: { n: fr.length, p50: +pct(fr, 50).toFixed(1), p95: +pct(fr, 95).toFixed(1), over33: fr.filter(x => x > 33.4).length, fps: +(1000 / (fr.reduce((a, b) => a + b, 0) / fr.length)).toFixed(1) },
    longTasks: { n: perf.long.length, total: r0(perf.long.reduce((a, b) => a + b[1], 0)), max: r0(Math.max(0, ...perf.long.map(x => x[1]))) },
    heapMB: +(perf.mem / 1048576).toFixed(1), errors: errs,
  };
  console.log(JSON.stringify(out, null, 1));
  if (OUT) require('fs').writeFileSync(OUT, JSON.stringify(out, null, 1));
  await b.close(); if (site) site.close(); if (gw) { gw.server.close(); await gw.pool.end(); }
})().catch(e => { console.error(e); process.exit(1); });
