// The day as one continuous dive (iceberg.js, game.js): where you are is the running total of each question's best
// answer, the camera only ever goes down, and it all survives a reload. Covers: a common answer after a very rare
// one, the best answer coming first, second or third, all five questions, reloading mid-question (guesses, time and
// depth kept), regions on the way down, the end of the day and the dive rebuilt in the viewer.
// Usage: node tests/expedition.cjs
const { chromium, serve } = require('./lib.cjs');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('PASS  ' + name); } else { fail++; console.log('FAIL  ' + name + (extra ? '  [' + extra + ']' : '')); } };

(async () => {
  const site = serve(8797), b = await chromium.launch();
  for (const vp of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    const tag = vp.width > 600 ? 'desk' : 'phone', p = await b.newPage({ viewport: vp }), errs = [];
    p.on('pageerror', e => errs.push(e.message));
    const URL = 'http://localhost:8797/?test&day=1&time=20&fast';
    await p.goto(URL + '&reset'); await p.waitForFunction(() => !document.querySelector('#play').disabled);
    await p.click('#play'); await p.waitForFunction(() => window.ICEBERG_TEST.screen === 'play' && !window.ICEBERG_TEST.busy, null, { timeout: 15000 }); await p.waitForTimeout(800);
    const T = () => p.evaluate(() => { const t = window.ICEBERG_TEST, v = t.berg.view; return { round: t.state.round, camY: v.camY, at: v.at, region: v.region, scores: t.state.rounds.map(r => { const ok = r.guesses.filter(g => g.status === 'ok'); return ok.length ? Math.max(...ok.map(g => Iceberg.depthOf(g.share))) : 0; }) }; });
    // An answer of a given rarity for question q: 0 the most common ... 1 the rarest listed.
    const word = (q, k) => p.evaluate(([q, k]) => { const a = window.ICEBERG_TEST.cats[q].answers.filter(r => !r.x).sort((x, y) => y.s - x.s); return a[Math.min(a.length - 1, Math.floor(k * (a.length - 1)))].a; }, [q, k]);
    const cams = [];
    // Sampled while answering (a question open for guesses), per question: between questions the view may recompose.
    const sample = async () => { const s = await p.evaluate(() => ({ y: window.ICEBERG_TEST.berg.view.camY, r: window.ICEBERG_TEST.state.round, ph: window.ICEBERG_TEST.state.phase, mv: window.ICEBERG_TEST.berg.view.busy, v: window.ICEBERG_TEST.berg.view.veiled })); if (s.ph === 'play') cams.push(s); };
    let watching = true; (async () => { while (watching) { try { await sample(); } catch { /* reloading */ } await p.waitForTimeout(60); } })();
    const guess = async (q, k) => { await p.fill('#answer', await word(q, k)); await p.press('#answer', 'Enter'); await p.waitForTimeout(250); await p.waitForFunction(() => !window.ICEBERG_TEST.busy, null, { timeout: 15000 }); await p.waitForTimeout(350); return T(); };
    const sum = s => s.scores.reduce((a, b) => a + b, 0);
    const next = async () => { await p.waitForFunction(() => window.ICEBERG_TEST.state.phase === 'done', null, { timeout: 10000 }); await p.waitForTimeout(500); await p.click('#next'); await p.waitForTimeout(900); };

    // Q1: the rarest first, then a common one, then a middling one. Only the first counts; nothing moves after it.
    const a1 = await guess(0, 1), a2 = await guess(0, 0), a3 = await guess(0, 0.4);
    ok(`${tag}: Q1 best first: the dive is at that answer's distance`, a1.at === a1.scores[0] && a1.at > 0, JSON.stringify(a1));
    ok(`${tag}: a common answer after a very rare one leaves you where you are`, a2.at === a1.at && a2.camY >= a1.camY - 0.5, `${a1.camY} -> ${a2.camY}`);
    ok(`${tag}: the third, shallower answer still doesn't move you`, a3.at === a1.at && a3.camY >= a2.camY - 0.5);
    await next();
    const q2s = await T();
    ok(`${tag}: the next question starts where you are (base = Q1's score)`, q2s.round === 1 && q2s.at === q2s.scores[0], JSON.stringify(q2s));
    // Q2: common first, then the best second, then a middling one.
    const b1 = await guess(1, 0.05), b2 = await guess(1, 0.95), b3 = await guess(1, 0.5);
    ok(`${tag}: Q2 best second: you go down by the difference only`, b2.at === sum(b2) && b2.at - b1.at === b2.scores[1] - Math.min(b2.scores[1], (b1.at - b1.scores[0])) || b2.at === b2.scores[0] + b2.scores[1], JSON.stringify([b1.at, b2.at, b2.scores]));
    ok(`${tag}: Q2's total distance is its best answer, not the sum of its guesses`, b3.at === b3.scores[0] + b3.scores[1], JSON.stringify(b3));
    await next();
    // Q3: two middling answers, then reload in the middle, then the best third.
    const c1 = await guess(2, 0.3);
    const before = await p.evaluate(() => ({ left: window.ICEBERG_TEST.clock.left, n: window.ICEBERG_TEST.state.rounds[2].guesses.length }));
    watching = false; await p.waitForTimeout(100);
    await p.goto(URL); await p.waitForFunction(() => window.ICEBERG_TEST && window.ICEBERG_TEST.state && window.ICEBERG_TEST.screen === 'play', null, { timeout: 15000 }); await p.waitForTimeout(1200);
    const r = await T(), rv = await p.evaluate(() => ({ left: window.ICEBERG_TEST.clock.left, n: window.ICEBERG_TEST.state.rounds[2].guesses.length, m: window.ICEBERG_TEST.berg.view.metres }));
    ok(`${tag}: after a reload: same question, same guesses, same depth`, r.round === 2 && rv.n === before.n && r.at === c1.at, JSON.stringify({ r, rv, c1: c1.at }));
    ok(`${tag}: after a reload the time already used is not handed back`, rv.left <= before.left + 50, `${before.left} -> ${rv.left}`);
    ok(`${tag}: after a reload the camera is down at your depth, not at the tip`, Math.abs(rv.m - r.at) < 140 && r.at > 100, JSON.stringify(rv));
    cams.length = 0; watching = true; (async () => { while (watching) { try { await sample(); } catch { } await p.waitForTimeout(60); } })();
    const c2 = await guess(2, 0.35), c3 = await guess(2, 1);
    ok(`${tag}: Q3 best third: down by its gain over the question's best so far`, c3.at === sum(c3) && c3.at >= c2.at, JSON.stringify([c2.at, c3.at, c3.scores]));
    await next();
    for (const q of [3, 4]) { await guess(q, 0.9); await guess(q, 0.2); await p.click('#finish'); await next(); }
    watching = false; await p.waitForTimeout(200);
    // A recompose hidden under the dark (narrow screens, between questions) is not a journey: skip across it.
    const ups = cams.filter((c, i) => i && c.r === cams[i - 1].r && !c.v && !cams[i - 1].v && c.y < cams[i - 1].y - 1.5);
    ok(`${tag}: the camera never went up while answering (${cams.length} samples)`, cams.length > 40 && !ups.length, ups.slice(0, 3).map(c => `${c.r}:${Math.round(c.y)}`).join(','));
    // The end of the day.
    await p.waitForFunction(() => window.ICEBERG_TEST.screen === 'end', null, { timeout: 15000 }); await p.waitForTimeout(800);
    const end = await p.evaluate(() => ({ total: +document.querySelector('#e-total').textContent.replace(/\D/g, ''), facts: document.querySelector('#e-deepest').textContent, text: document.querySelector('#e-card').textContent, day: JSON.parse(localStorage.getItem('iceberg:day:' + window.Game.today()) || 'null') }));
    const regionName = await p.evaluate(t => Iceberg.regionOf(t).name, end.day.total);
    ok(`${tag}: the day's total is the dive's depth: the sum of the five best answers`, end.total === end.day.total && end.day.total === end.day.rounds.reduce((a, r) => a + r.depth, 0), JSON.stringify([end.total, end.day.total]));
    ok(`${tag}: the end names the region reached and, separately, the rarest answer`, end.facts.includes(regionName) && /rarest answer/.test(end.facts), end.facts);
    ok(`${tag}: the share text says how far down, and where`, end.text.includes(`${end.day.total.toLocaleString('en-US')} m down`) && end.text.includes(regionName), end.text.split('\n')[0]);
    const card = await p.evaluate(() => { const c = document.querySelector('#end-berg'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let lit = 0; for (let i = 0; i < d.length; i += 16) if (d[i] + d[i + 1] + d[i + 2] > 120) lit++; return lit; });
    ok(`${tag}: the end picture is drawn`, card > 2000, card);
    // The dive rebuilt in the viewer: each question's best where it left the dive.
    await p.evaluate(() => window.Viewer.open('me', window.Game.today())); await p.waitForSelector('[data-screen="dive"]:not([hidden])'); await p.waitForTimeout(1600);
    const vw = await p.evaluate(() => { const b = window.Viewer.berg; return { marks: document.querySelectorAll('#ib2 .ib-mark').length, at: b.dive.at }; });
    ok(`${tag}: the viewer rebuilds the whole dive (five marks along the way)`, vw.marks === end.day.rounds.filter(r => r.name).length, JSON.stringify(vw));
    await p.evaluate(() => document.querySelector('#v-qs li:nth-child(3) button').click()); await p.waitForTimeout(1800);
    const v3 = await p.evaluate(() => window.Viewer.berg.dive);
    const want3 = end.day.rounds.slice(0, 3).reduce((a, r) => a + r.depth, 0);
    ok(`${tag}: opening question 3 in the viewer puts you where it left the dive`, v3.at === want3, JSON.stringify([v3, want3]));
    ok(`${tag}: no page errors`, !errs.length, errs.slice(0, 3).join(' | '));
    await p.close();
  }
  // Regions follow the running depth; rarity tiers follow one answer. They never borrow each other's names.
  const p = await b.newPage(); await p.goto('http://localhost:8797/?test&day=1'); await p.waitForFunction(() => window.Iceberg);
  const names = await p.evaluate(() => ({ regions: [0, 299, 300, 600, 1000, 1300, 1500, 1999].map(m => Iceberg.regionOf(m).key), tiers: Iceberg.TIERS.map(t => t.name), regionNames: Iceberg.REGIONS.map(r => r.name) }));
  ok('regions by running depth: surface, twilight 300, midnight 600, abyss 1,000, trenches 1,300, the unknown 1,500', names.regions.join() === 'surface,surface,twilight,midnight,abyss,trench,unknown,unknown', names.regions.join());
  ok('rarity tiers and regions never share a name', names.tiers.every(t => !names.regionNames.includes(t)), JSON.stringify(names));
  await b.close(); site.close();
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
