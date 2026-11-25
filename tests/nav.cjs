// How quickly the screens answer a tap: from the click to the next screen visibly there. Measuring tool, not pass/fail.
//   node tests/nav.cjs [--cpu=4] [--vp=phone]
const { chromium, serve, VPS } = require('./lib.cjs');
const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
(async () => {
  const site = serve(8833), b = await chromium.launch(), vp = arg('vp', 'desk'), cpu = +arg('cpu', 1);
  const p = await (await b.newContext({ viewport: VPS[vp], hasTouch: vp !== 'desk' })).newPage(); const cdp = await p.context().newCDPSession(p);
  if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  const t0 = Date.now(); await p.goto('http://localhost:8833/?test&reset'); await p.waitForFunction(() => !document.querySelector('#play').disabled); const ready = Date.now() - t0;
  await p.waitForTimeout(1500);
  // click -> first frame where the target is visible
  const time = (click, seen) => p.evaluate(([click, seen]) => new Promise(res => { const t = performance.now(); document.querySelector(click).click();
    const w = () => { const n = document.querySelector(seen); if (n && n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden') res(Math.round(performance.now() - t)); else if (performance.now() - t > 3000) res('not seen in 3 s'); else requestAnimationFrame(w); }; requestAnimationFrame(w); }), [click, seen]);
  const out = { vp, cpu, homeReadyMs: ready };
  out.menu = await time('#menu-btn', '#menu-panel:not([hidden])'); await p.keyboard.press('Escape');
  out.howTo = await time('#howto-btn', '#howto[open]'); await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  out.raceMode = await time('.mode[data-mode="race"]', '.r-title'); await p.waitForTimeout(800);
  out.dailyMode = await time('.mode[data-mode="daily"]', '[data-screen="home"]:not([hidden]) .title-block'); await p.waitForTimeout(500);
  await p.click('#menu-btn'); out.rankings = await time('#menu-panel [data-go="ranks"]', '#hub-body .title'); await p.waitForTimeout(500);
  out.profile = await time('#acct-btn', '#hub-body .who'); await p.waitForTimeout(500);
  await p.click('.mode[data-mode="daily"]'); await p.waitForTimeout(600);
  out.play = await p.evaluate(() => new Promise(res => { const t = performance.now(); document.querySelector('#play').click(); const w = () => { if (document.activeElement && document.activeElement.id === 'answer') res(Math.round(performance.now() - t)); else if (performance.now() - t > 3000) res('not seen in 3 s'); else requestAnimationFrame(w); }; requestAnimationFrame(w); }));
  // long tasks on the title screen while idle (the home art, the sea, preparing the scene and the sound)
  const p2 = await (await b.newContext({ viewport: VPS[vp] })).newPage(); const c2 = await p2.context().newCDPSession(p2); if (cpu > 1) await c2.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  await p2.addInitScript(() => { window.__long = []; new PerformanceObserver(l => l.getEntries().forEach(e => window.__long.push(Math.round(e.duration)))).observe({ type: 'longtask', buffered: true });
    window.__f = []; let last = 0; const tick = t => { if (last) window.__f.push(t - last); last = t; requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
  await p2.goto('http://localhost:8833/?test&reset'); await p2.waitForTimeout(6000);
  const idle = await p2.evaluate(() => { const f = window.__f.slice(30).sort((a, b) => a - b); return { longTasks: window.__long, frameP50: +f[Math.floor(f.length / 2)].toFixed(1), frameP95: +f[Math.floor(f.length * .95)].toFixed(1) }; });
  out.homeIdle = idle;
  console.log(JSON.stringify(out)); await b.close(); site.close();
})();
