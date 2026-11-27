// How the game moves from one moment to the next, in a real browser: no waiting where nothing is happening.
//   node tests/flow.cjs
// Times are measured from the key press or click, in the page itself. The limits are deliberately tight: they are
// what makes the game feel responsive, not what merely makes it work.
const { chromium, serve, VPS } = require('./lib.cjs');
const R = []; let fails = 0;
const ok = (name, cond, extra = '') => { R.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  [' + extra + ']' : ''}`); if (!cond) fails++; };

(async () => {
  const site = serve(8818), b = await chromium.launch();
  const open = async (vp = 'desk', extra = '', ctxOpts = {}) => {
    const ctx = await b.newContext({ viewport: VPS[vp], hasTouch: vp !== 'desk', ...ctxOpts }), p = await ctx.newPage(); p.errs = [];
    p.on('pageerror', e => p.errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') p.errs.push(m.text()); });
    // count animation-frame callbacks per frame: a loop left running twice shows up as more callbacks
    await p.addInitScript(() => { const raf = window.requestAnimationFrame.bind(window); let n = 0; window.__rafCalls = () => n; window.requestAnimationFrame = f => { n++; return raf(f); }; });
    await p.goto(`http://localhost:8818/?test&time=20&reset${extra}`); await p.waitForSelector('#play'); await p.waitForTimeout(500);
    return p;
  };
  const answers = (p, q) => p.evaluate(q => { const c = ICEBERG_TEST.cats[q], l = c.answers.filter(a => !a.x && window.Iceberg.depthOf(a.s) < 150).sort((a, b) => b.s - a.s); /* ordinary depths: a find beneath the iceberg pauses on purpose (beneath.cjs times those) */ return [l[2].a, l[Math.floor(l.length * 0.4)].a, l[Math.floor(l.length * 0.75)].a, l[Math.floor(l.length * 0.6)].a]; }, q);
  const idle = p => p.waitForFunction(() => !ICEBERG_TEST.busy, null, { timeout: 15000 });
  const nextQ = p => p.evaluate(() => new Promise(res => { const t = performance.now(), before = ICEBERG_TEST.state.round; document.querySelector('#next').click();
    const w = () => { const n = performance.now() - t; if (ICEBERG_TEST.clock.on && ICEBERG_TEST.state.round === before + 1) res({ clock: n, typing: document.activeElement === document.querySelector('#answer') }); else if (n > 4000) res({ clock: -1 }); else requestAnimationFrame(w); }; w(); }));

  // ---------- A whole dive on a desktop ----------
  const p = await open();
  await p.click('#play'); await p.waitForFunction(() => ICEBERG_TEST.screen === 'play' && ICEBERG_TEST.clock.on, null, { timeout: 4000 });
  ok('Play: the first question is ready to type into straight away, and the clock starts once the camera has arrived', await p.evaluate(() => document.activeElement === document.querySelector('#answer')));
  let a = await answers(p, 0);
  // Fast typing: the second guess is sent while the first is still travelling. It must go in by itself.
  await p.fill('#answer', a[0]); await p.keyboard.press('Enter'); await p.waitForTimeout(120);
  await p.fill('#answer', a[1]); await p.keyboard.press('Enter');
  await p.waitForFunction(() => ICEBERG_TEST.state.rounds[0].guesses.length === 2, null, { timeout: 5000 }).catch(() => {});
  ok('typing ahead: a guess sent while the last one is still on its way goes in by itself (no second press)', (await p.evaluate(() => ICEBERG_TEST.state.rounds[0].guesses.length)) === 2);
  await idle(p);
  // The third guess: results soon after it lands; Enter brings them at once.
  await p.fill('#answer', a[2]);
  const third = await p.evaluate(() => new Promise(res => { const t = performance.now(); document.querySelector('#entry').requestSubmit(); let landed = 0;
    const w = () => { const n = performance.now() - t; if (!landed && !ICEBERG_TEST.busy) landed = n; const d = document.querySelector('#done-panel'); if (!d.hidden) res({ landed, results: n }); else if (n > 6000) res({ landed, results: -1 }); else requestAnimationFrame(w); }; w(); }));
  ok('third guess: the results follow within half a second of the answer landing (no dead time)', third.results > 0 && third.results - third.landed < 500, `landed ${Math.round(third.landed)} ms, results ${Math.round(third.results)} ms`);
  ok('third guess: from Enter to the results in under 1.5 s', third.results > 0 && third.results < 1500, Math.round(third.results) + ' ms');
  await p.waitForTimeout(600);
  // Next question: immediate, and the clock waits until the camera has risen and the box is ready.
  const n1 = await nextQ(p);
  ok('next question: the box is ready to type into at once', n1.typing);
  ok('next question: the transition takes under a second, and the clock only starts when it is done', n1.clock > 500 && n1.clock < 1100, Math.round(n1.clock) + ' ms');
  // Pressing Next twice moves one question, not two.
  a = await answers(p, 1);
  for (const x of a.slice(0, 3)) { await p.fill('#answer', x); await p.keyboard.press('Enter'); await idle(p); await p.waitForTimeout(150); }
  await p.waitForSelector('#done-panel:not([hidden])');
  await p.evaluate(() => { document.querySelector('#next').click(); document.querySelector('#next').click(); });
  await p.waitForTimeout(1200);
  ok('pressing Next twice moves on one question only', (await p.evaluate(() => ICEBERG_TEST.state.round)) === 2);
  // A guess sent during the rise: it takes over cleanly, and the following Next still works (this hung before).
  a = await answers(p, 2);
  await p.fill('#answer', a[0]); await p.keyboard.press('Enter'); await idle(p); await p.click('#finish'); await p.waitForSelector('#done-panel:not([hidden])'); await p.waitForTimeout(300);
  await p.evaluate(() => document.querySelector('#next').click()); await p.waitForTimeout(150);
  a = await answers(p, 3); await p.fill('#answer', a[0]); await p.keyboard.press('Enter'); await idle(p);
  const mid = await p.evaluate(() => ({ items: ICEBERG_TEST.berg.count, guesses: ICEBERG_TEST.state.rounds[3].guesses.length, marks: document.querySelectorAll('#ib .ib-mark').length }));
  ok('a guess sent while the camera is still rising lands on a clean iceberg (none of the last question\'s answers left)', mid.items === 1 && mid.guesses === 1 && mid.marks === 1, JSON.stringify(mid));
  await p.click('#finish'); await p.waitForSelector('#done-panel:not([hidden])'); await p.waitForTimeout(300);
  const n2 = await nextQ(p);
  ok('…and the next Next works as normal', n2.clock > 0, Math.round(n2.clock) + ' ms');
  // Out of time on the last question.
  a = await answers(p, 4); await p.fill('#answer', a[0]); await p.keyboard.press('Enter'); await p.waitForTimeout(80);
  await p.evaluate(() => { ICEBERG_TEST.state.rounds[4].left = 900; });   // while it is revealing (the clock is stopped): under a second left
  await p.waitForSelector('#done-panel:not([hidden])', { timeout: 5000 });
  ok('time running out ends the question and shows the results promptly', await p.evaluate(() => ICEBERG_TEST.state.rounds[4].timeout === true));
  const before = await p.evaluate(() => window.__rafCalls());
  await p.waitForTimeout(1000);
  const perSecEnd = (await p.evaluate(() => window.__rafCalls())) - before;
  await p.evaluate(() => document.querySelector('#next').click()); await p.waitForSelector('[data-screen="end"]:not([hidden])', { timeout: 4000 });
  ok('the whole dive is finished and the day\'s results appear', true);
  const txt = await p.evaluate(() => document.body.innerText);
  ok('no placeholder text anywhere on the way (null, undefined, NaN)', !/\bnull\b|\bundefined\b|\bNaN\b|\[object /.test(txt));
  ok('no script errors', !p.errs.length, p.errs.slice(0, 2).join(' | '));
  await p.context().close();

  // ---------- Animation loops don't pile up over repeated questions ----------
  { const q = await open('desk', '&fast'); await q.click('#play'); await q.waitForFunction(() => ICEBERG_TEST.screen === 'play');
    const rate = async () => { const a0 = await q.evaluate(() => window.__rafCalls()); await q.waitForTimeout(1000); return (await q.evaluate(() => window.__rafCalls())) - a0; };
    const heap = () => q.evaluate(() => performance.memory ? performance.memory.usedJSHeapSize / 1048576 : 0);
    await q.waitForTimeout(800); const r1 = await rate(), h1 = await heap();
    for (let round = 0; round < 4; round++) {
      const x = await answers(q, round); for (const y of x.slice(0, 3)) { await q.fill('#answer', y); await q.keyboard.press('Enter'); await idle(q); await q.waitForTimeout(80); }
      await q.waitForSelector('#done-panel:not([hidden])'); await q.waitForTimeout(200); await q.evaluate(() => document.querySelector('#next').click()); await q.waitForFunction(() => ICEBERG_TEST.clock.on, null, { timeout: 4000 });
    }
    await q.waitForTimeout(800); const r2 = await rate(), h2 = await heap();
    ok('after four questions the same number of animation loops is running as after one (none left behind)', r2 <= r1 * 1.15 + 5, `${r1} → ${r2} callbacks a second`);
    ok('memory stays level across the questions', h2 - h1 < 12, `${h1.toFixed(1)} → ${h2.toFixed(1)} MB`);
    await q.context().close(); }

  // ---------- Beneath the iceberg: the long descent can be cut short; the way back up is quick ----------
  { const q = await open('desk', '&day=1'); await q.click('#play'); await q.waitForFunction(() => ICEBERG_TEST.clock.on, null, { timeout: 4000 });   // day 1's first question has answers beneath the iceberg
    const deep = await q.evaluate(() => ICEBERG_TEST.cats[0].answers.filter(a => Iceberg.isBeyond(Iceberg.depthOf(a.s)))[0].a);
    await q.fill('#answer', deep);
    const skip = await q.evaluate(() => new Promise(res => { const t = performance.now(); document.querySelector('#entry').requestSubmit();
      setTimeout(() => document.querySelector('#ib').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })), 600);
      const w = () => { const n = performance.now() - t; if (!ICEBERG_TEST.busy) res(n); else if (n > 8000) res(-1); else requestAnimationFrame(w); }; requestAnimationFrame(w); }));
    ok('beneath the iceberg: a tap during the long descent brings it to its end within a second', skip > 0 && skip < 1200, Math.round(skip) + ' ms (uncut: about 4,500 ms)');
    await q.click('#finish'); await q.waitForSelector('#done-panel:not([hidden])'); await q.waitForTimeout(800);
    const back = await nextQ(q);
    ok('from beneath the iceberg to the next question in about a second (a crossfade, not the whole climb)', back.clock > 0 && back.clock < 1300, Math.round(back.clock) + ' ms');
    ok('no script errors', !q.errs.length, q.errs.slice(0, 2).join(' | '));
    await q.context().close(); }

  // ---------- Reduced motion, a phone, a reload mid-question ----------
  { const q = await open('phone', '', { reducedMotion: 'reduce' }); await q.click('#play'); await q.waitForFunction(() => ICEBERG_TEST.screen === 'play');
    const x = await answers(q, 0); for (const y of x.slice(0, 3)) { await q.fill('#answer', y); await q.keyboard.press('Enter'); await idle(q); }
    await q.waitForSelector('#done-panel:not([hidden])'); await q.waitForTimeout(300);
    const n = await nextQ(q);
    ok('reduced motion (phone): the next question is ready almost at once, with no camera journey', n.clock >= 0 && n.clock < 450, Math.round(n.clock) + ' ms');
    await q.fill('#answer', (await answers(q, 1))[0]); await q.keyboard.press('Enter'); await idle(q);
    await q.goto(q.url().replace('&reset', '')); await q.waitForFunction(() => window.ICEBERG_TEST && ICEBERG_TEST.screen === 'play', null, { timeout: 5000 });
    ok('a reload mid-question comes back to the same question with the guess in place', await q.evaluate(() => ICEBERG_TEST.state.round === 1 && ICEBERG_TEST.state.rounds[1].guesses.length === 1));
    ok('no script errors', !q.errs.length, q.errs.slice(0, 2).join(' | '));
    await q.context().close(); }

  console.log(R.join('\n')); console.log(`\n${R.length - fails} passed, ${fails} failed`);
  await b.close(); site.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); console.log(R.join('\n')); process.exit(1); });
