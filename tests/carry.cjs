// The dive goes on between questions (the camera keeps the depth the last question reached instead of rising to the
// tip), and Enter sends a typed guess wherever the focus is; typing with the focus elsewhere goes into the box.
// Usage: node tests/carry.cjs
const { chromium, serve } = require('./lib.cjs');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('PASS  ' + name); } else { fail++; console.log('FAIL  ' + name + (extra ? '  [' + extra + ']' : '')); } };

(async () => {
  const site = serve(8795), b = await chromium.launch();
  for (const vp of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    const tag = vp.width > 600 ? 'desk' : 'phone', p = await b.newPage({ viewport: vp }), errs = [];
    p.on('pageerror', e => errs.push(e.message));
    await p.goto('http://localhost:8795/?test&reset&day=1&time=20'); await p.waitForFunction(() => !document.querySelector('#play').disabled);
    await p.click('#play'); await p.waitForFunction(() => window.ICEBERG_TEST.screen === 'play' && !window.ICEBERG_TEST.busy, null, { timeout: 15000 }); await p.waitForTimeout(2500);
    const T = () => p.evaluate(() => { const t = window.ICEBERG_TEST; return { camY: t.berg.view.camY, round: t.state.round, n: t.state.rounds[t.state.round].guesses.length }; });
    const tip = (await T()).camY;
    const rare = await p.evaluate(() => { const a = window.ICEBERG_TEST.cats[0].answers; return a[a.length - 6].a; });
    await p.fill('#answer', rare); await p.mouse.click(vp.width / 3, vp.height - 120);
    ok(`${tag}: focus left the box`, await p.evaluate(() => document.activeElement !== document.querySelector('#answer')));
    await p.keyboard.press('Enter'); await p.waitForTimeout(6000);
    const a = await T(); ok(`${tag}: Enter sent the guess after a click on the water`, a.n === 1, JSON.stringify(a));
    await p.click('#finish'); await p.waitForTimeout(3000);
    const deep = (await T()).camY;
    await p.click('#next'); await p.waitForTimeout(1500);
    const q2 = await T();
    ok(`${tag}: the next question starts at the depth reached, not back at the tip`, q2.round === 1 && q2.camY > tip + 200 && Math.abs(q2.camY - deep) < 260, JSON.stringify({ tip, deep, q2 }));
    await p.evaluate(() => document.activeElement && document.activeElement.blur());
    const common = await p.evaluate(() => window.ICEBERG_TEST.cats[1].answers[0].a);
    await p.keyboard.type(common); await p.keyboard.press('Enter'); await p.waitForTimeout(5000);
    const c = await T(); ok(`${tag}: typing with no focus goes into the box, and Enter sends it`, c.n === 1, JSON.stringify(c));
    ok(`${tag}: a common answer still travels back up to its own depth`, c.camY < q2.camY - 200, JSON.stringify(c));
    ok(`${tag}: no page errors`, !errs.length, errs.join(' | '));
    await p.close();
  }
  await b.close(); site.close();
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
