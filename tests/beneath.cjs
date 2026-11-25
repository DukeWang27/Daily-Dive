// Beneath the iceberg: the Unfathomable region, in a real browser (no database needed).
//   node tests/beneath.cjs            (SHOTS=<folder> to also save screenshots)
// Checks the evidence rule and the depth scale, then plays a question: an ordinary answer, a rare one near the
// bottom of the iceberg, then an Unfathomable one that takes the camera past the iceberg's tip into the open water,
// with its red annotation, the colossal squid and the sounds; then the rest of the day, the results, the share
// card and text, and exploring the dive again. On a desktop and a phone.
const { chromium, serve, VPS } = require('./lib.cjs');
const R = []; let fails = 0;
const ok = (name, cond, extra = '') => { R.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  [' + extra + ']' : ''}`); if (!cond) fails++; };
const SHOTS = process.env.SHOTS || '';

(async () => {
  const site = serve(8797), b = await chromium.launch();
  for (const vp of ['desk', 'phone']) {
    const ctx = await b.newContext({ viewport: VPS[vp], hasTouch: vp === 'phone' }), p = await ctx.newPage(), errs = [];
    p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await p.goto('http://localhost:8797/?test&reset&day=1'); await p.waitForSelector('#play');   // day 1: its first question has answers beneath the iceberg (played under the original evidence rule)
    const shot = async name => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/beneath-${vp}-${name}.png` }); };

    if (vp === 'desk') {
      // ---------- The rule ----------
      const u = await p.evaluate(() => { const I = Iceberg, W = I.WORLD;
        return { d1e4: I.depthOf(1e-4), d25: I.depthOf(2.5e-5), floor: I.depthOf(2e-5), d11: I.depthOf(1.1e-4), tier300: I.tierOfDepth(300).name, tier299: I.tierOfDepth(299).name,
          y299: I.yOfDepth(299), y300: I.yOfDepth(300), bottom: W.BOTTOM, mono: [0, 50, 150, 250, 299, 300, 320, 360].map(I.yOfDepth).every((y, i, a) => !i || y > a[i - 1]),
          metres: [I.metres(I.yOfDepth(120)), I.metres(I.yOfDepth(300)), I.metres(I.yOfDepth(345))], unknownShare: I.depthOf(0.03) }; });
      ok('rule: 1 in 10,000 with evidence (12 of 120,000) is 300 m, Unfathomable', u.d1e4 === 300 && u.tier300 === 'Unfathomable', JSON.stringify([u.d1e4, u.tier300]));
      ok('rule: 3 of 120,000 is still enough evidence: 360 m', u.d25 === 360);
      ok('rule: too little evidence (the table floor, under 3 of the sample) stops at 299 m on the iceberg', u.floor === 299 && u.tier299 === 'The Abyss');
      ok('rule: just above 1 in 10,000 stays on the iceberg', u.d11 < 300);
      ok('rule: answers approved by review (no table share) sit in Midwater, never beneath', u.unknownShare === 52);
      ok('depth scale: 299 m is on the iceberg, 300 m is well below its tip, and the scale only ever goes down', u.y299 < u.bottom && u.y300 > u.bottom + 100 && u.mono, `${u.y299} / ${u.bottom} / ${u.y300}`);
      ok('depth scale: reading a position back gives the depth', u.metres[0] === 120 && u.metres[1] === 300 && u.metres[2] === 345, u.metres.join(','));
      const tables = await p.evaluate(async () => { let bad = 0, beyond = 0, held = 0; for (let d = 1; d <= 15; d++) { const j = await fetch(`days/${d}.json`).then(r => r.json()); for (const q of j.questions) for (const a of q.answers) { const k = Math.round(a.s * 120000), dd = Iceberg.depthOf(a.s); if (dd >= 300 && k < 3) bad++; if (dd >= 300) beyond++; if (k < 3 && 100 * Math.log10(0.1 / a.s) >= 299.5) held++; } } return { bad, beyond, held }; });
      ok('every daily answer beneath the iceberg has at least 3 of 120,000 behind it', tables.bad === 0 && tables.beyond > 0, `${tables.beyond} answers can reach it; ${tables.held} held at 299 m for lack of evidence`);
    }

    // ---------- Play: ordinary, near the bottom, then beneath ----------
    await p.click('#play'); await p.waitForSelector('[data-screen="play"]:not([hidden])'); await p.waitForTimeout(1400);
    const pick = await p.evaluate(() => { const c = ICEBERG_TEST.cats[ICEBERG_TEST.state.round], I = Iceberg, by = f => c.answers.filter(f).sort((x, y) => y.s - x.s);
      return { common: by(a => I.depthOf(a.s) < 60)[0].a, near: (by(a => { const d = I.depthOf(a.s); return d >= 230 && d < 300; })[0] || {}).a, beyond: (by(a => I.isBeyond(I.depthOf(a.s)))[0] || {}).a }; });
    ok(`${vp}: the first question has an ordinary, a near-bottom and an Unfathomable answer to test with`, pick.common && pick.near && pick.beyond, JSON.stringify(pick));
    const guess = async a => { await p.fill('#answer', a); await p.keyboard.press('Enter'); await p.waitForTimeout(300); await p.waitForFunction(() => !ICEBERG_TEST.busy, null, { timeout: 20000 }); await p.waitForTimeout(500); };
    const scene = () => p.evaluate(() => { const v = ICEBERG_TEST.berg.view, W = Iceberg.WORLD, note = document.querySelector('.ib-note'), mark = document.querySelector('.ib-mark.focus');
      return { beyond: v.beyond, tipY: v.y0 + W.BOTTOM * v.u, top: v.frame.t, markY: mark ? mark.getBoundingClientRect().top + 7 : null, note: note ? note.className : '', name: note ? getComputedStyle(note.querySelector('.ib-name')).color : '',
        gauge: document.querySelector('.ib-depth').textContent, red: document.querySelector('.ib-read').classList.contains('beyond'), ice: +getComputedStyle(document.querySelector('.ib-ice')).opacity, guests: ICEBERG_TEST.life ? ICEBERG_TEST.life.guests : [] }; });
    await guess(pick.common);
    let s1 = await scene();
    ok(`${vp}: an ordinary answer stays on the iceberg, not red`, s1.beyond === 0 && !/tier-beyond/.test(s1.note));
    await guess(pick.near); s1 = await scene();
    ok(`${vp}: a rare answer near the bottom stays on the iceberg in The Abyss`, s1.beyond < 0.05 && /tier-abyss/.test(s1.note), s1.note);
    await shot('1-near');
    // The descent: watch it pass the tip.
    await p.fill('#answer', pick.beyond); await p.keyboard.press('Enter');
    const during = [];
    for (let i = 0; i < 8; i++) { await p.waitForTimeout(500); during.push(await p.evaluate(() => ICEBERG_TEST.berg.view.beyond)); if (i === 3) await shot('2-descent'); }
    await p.waitForFunction(() => !ICEBERG_TEST.busy, null, { timeout: 20000 });
    ok(`${vp}: the descent is long and continuous (the camera eases out from the iceberg into the water beneath)`, during.some(x => x > 0.05 && x < 0.95) && during.every((x, i, a) => !i || x >= a[i - 1] - 0.001), during.map(x => x.toFixed(2)).join(' '));
    await p.waitForTimeout(1200);
    const s2 = await scene();
    ok(`${vp}: the camera is beneath the iceberg`, s2.beyond > 0.99);
    ok(`${vp}: the iceberg's tip has gone up out of the way (well above the answer, faded)`, s2.tipY < s2.markY - 250 && s2.ice < 0.4, `tip ${Math.round(s2.tipY)} marker ${Math.round(s2.markY)} ice ${s2.ice}`);
    ok(`${vp}: the answer is annotated in red, Unfathomable`, /tier-beyond/.test(s2.note) && /224, 100, 91/.test(s2.name), s2.name);
    ok(`${vp}: the depth gauge reads it in red`, s2.red && /^3\d\d m$/.test(s2.gauge), s2.gauge);
    await shot('3-landed');
    await p.waitForTimeout(2500);
    const s3 = await scene();
    ok(`${vp}: the colossal squid comes, and only it (no giant or bigfin for an answer beneath the iceberg)`, s3.guests.includes('colossal') && !s3.guests.includes('bigfin'), s3.guests.join(','));
    await p.waitForTimeout(9000);
    const px = await p.evaluate(() => { const c = document.querySelector('#ib .ib-life-back'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0, red = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) { n++; if (d[i - 3] > d[i - 1] * 1.6 && d[i - 3] > 30) red++; } return { n, red, w: c.width, h: c.height, cost: window.Colossal.ms }; });
    ok(`${vp}: the squid is large: it covers a big part of the view`, px.n > px.w * px.h * 0.08, `${px.n} of ${px.w * px.h} pixels`);
    ok(`${vp}: where the light reaches it, it is red`, px.red > 300, `${px.red} red pixels`);
    ok(`${vp}: drawing the squid stays quick`, px.cost < 12, `${px.cost.toFixed(1)} ms a frame`);
    const sight = await p.evaluate(() => (document.querySelector('.ib-sight') || {}).textContent || '');
    ok(`${vp}: the annotation says what came`, /colossal squid/i.test(sight), sight);
    await shot('4-squid');
    await p.waitForTimeout(4000); await shot('5-squid-later');
    const slot = await p.evaluate(() => { const b = document.querySelector('.slot.tier-beyond .slot-depth'); return b ? getComputedStyle(b).color : ''; });
    ok(`${vp}: the guess row shows the depth in red`, /224, 100, 91/.test(slot), slot);
    ok(`${vp}: the timer kept running while the squid passed (nothing paused play)`, await p.evaluate(() => ICEBERG_TEST.clock.on || ICEBERG_TEST.clock.total === 0));

    // ---------- The rest of the day, results, sharing, exploring ----------
    if (await p.isVisible('#finish')) await p.click('#finish');
    await p.waitForFunction(() => ICEBERG_TEST.state && ICEBERG_TEST.state.phase === 'done'); await p.click('#next'); await p.waitForTimeout(300);
    for (let q = 1; q < 5; q++) {
      const a = await p.evaluate(() => { const c = ICEBERG_TEST.cats[ICEBERG_TEST.state.round]; return c.answers.filter(x => !x.x).sort((x, y) => y.s - x.s)[2].a; });
      await p.fill('#answer', a); await p.keyboard.press('Enter'); await p.waitForFunction(() => !ICEBERG_TEST.busy, null, { timeout: 15000 }); await p.waitForTimeout(150);
      await p.click('#finish'); await p.waitForFunction(() => ICEBERG_TEST.state && ICEBERG_TEST.state.phase === 'done'); await p.click('#next'); await p.waitForTimeout(250);
    }
    await p.waitForSelector('[data-screen="end"]:not([hidden])'); await p.waitForTimeout(1200);
    const end = await p.evaluate(() => ({ sum: !!document.querySelector('#e-rounds li.tier-beyond') && /224, 100, 91/.test(getComputedStyle(document.querySelector('#e-rounds li.tier-beyond .e-depth')).color), text: document.querySelector('#e-card').textContent, card: document.querySelector('#share-canvas').toDataURL().length }));
    ok(`${vp}: results list the find in red`, end.sum);
    ok(`${vp}: the share text marks it Unfathomable (still no answers in it)`, /◆ 3\d\d m · Unfathomable/.test(end.text) && !end.text.includes(pick.beyond), end.text.split('\n')[1]);
    ok(`${vp}: the share card draws with the find beneath the iceberg`, end.card > 50000);
    await shot('6-end');
    const cardPx = await p.evaluate(() => { const c = document.querySelector('#share-canvas'), d = c.getContext('2d').getImageData(0, 0, 540, c.height).data; let red = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 180 && d[i + 1] < 120 && d[i + 2] < 110) red++; return red; });
    ok(`${vp}: the share card marks it in red`, cardPx > 200, `${cardPx} red pixels`);
    if (SHOTS && vp === 'desk') await (await p.$('#share-canvas')).screenshot({ path: `${SHOTS}/beneath-card.png` });
    // Explore the finished dive: the overview frames the find beneath the iceberg too.
    await p.evaluate(() => window.Viewer.open('me', window.Game.today())); await p.waitForSelector('[data-screen="dive"]:not([hidden])'); await p.waitForFunction(() => document.querySelector('#v-msg').hidden, null, { timeout: 8000 }); await p.waitForTimeout(1200);
    const ov = await p.evaluate(() => { const marks = [...document.querySelectorAll('#ib2 .ib-mark.tier-beyond')]; return marks.map(m => { const r = m.getBoundingClientRect(); return { y: r.top, h: innerHeight }; }); });
    ok(`${vp}: exploring the dive, the whole-dive view includes the find beneath the iceberg`, ov.length === 1 && ov[0].y > 0 && ov[0].y < ov[0].h, JSON.stringify(ov));
    await shot('7-explore');
    await p.evaluate(() => document.querySelector('#v-qs button').click()); await p.waitForTimeout(3500);
    const v1 = await p.evaluate(() => ({ b: window.Viewer.berg.view.beyond, note: (document.querySelector('#ib2 .ib-note') || {}).className || '' }));
    ok(`${vp}: opening that question goes back down beneath the iceberg, red annotation and all`, v1.b > 0.99 && /tier-beyond/.test(v1.note), JSON.stringify(v1));
    ok(`${vp}: no script errors`, !errs.length, errs.slice(0, 3).join(' | '));
    await ctx.close();
  }
  console.log(R.join('\n')); console.log(`\n${R.length - fails} passed, ${fails} failed`);
  await b.close(); site.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); console.log(R.join('\n')); process.exit(1); });
