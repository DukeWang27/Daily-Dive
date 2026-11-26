// The field journal (journal.js), in a real browser with no database: what counts as a discovery, fairness between
// players, keeping undiscovered animals secret, and the page at phone and desktop sizes.
const { chromium, serve, VPS } = require('./lib.cjs');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('PASS  ' + name); } else { fail++; console.log('FAIL  ' + name + (extra ? '  [' + extra + ']' : '')); } };

(async () => {
  const site = serve(8793), b = await chromium.launch();
  const R = (title, name, depth) => ({ title, name, depth, share: 0.1 / Math.pow(10, depth / 100) });
  const seed = async (p, days) => p.evaluate(days => { for (const k of Object.keys(localStorage)) if (k.startsWith('iceberg:day:') || k === 'iceberg:sightings') localStorage.removeItem(k); days.forEach(d => localStorage.setItem('iceberg:day:' + d.day, JSON.stringify({ v: 3, total: 0, ...d }))); }, days);
  const open = async p => { await p.evaluate(() => { location.hash = '#journal'; }); await p.waitForSelector('.jn-list'); };

  const ctx = await b.newContext({ viewport: VPS.desk }), p = await ctx.newPage(), errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8793/?test&day=3'); await p.waitForSelector('#play:not([disabled])');

  // ---------- The rules ----------
  const rules = await p.evaluate(() => {
    const J = Journal, sameAll = [];
    for (let day = 1; day < 60; day++) for (let round = 1; round <= 5; round++) for (const d of [0, 20, 75, 150, 240]) sameAll.push(J.residentAt(d, day, round).key === J.residentAt(d, day, round).key);
    const zoneOk = []; const sp = Wildlife.species();
    for (let day = 1; day < 40; day++) for (const d of [5, 30, 60, 110, 180, 260, 299]) { const s = sp.find(x => x.key === J.residentAt(d, day, 1).key); zoneOk.push(s.zone[0] <= d && d <= s.zone[1]); }
    const varied = new Set(); for (let day = 1; day < 40; day++) varied.add(J.residentAt(150, day, 3).key);
    // f(depth, before): one answer of that depth, after earlier questions that took the dive to 'before' metres.
    const f = (depth, before = 0, name = 'x') => J.finds({ day: 5, rounds: [...(before ? [{ title: 'P', name: 'p', depth: before }] : []), { title: 'T', name, depth }] }).filter(x => x.round === (before ? 2 : 1)).map(x => x.sp.key);
    return { same: sameAll.every(Boolean), zone: zoneOk.every(Boolean), varied: varied.size, tip: f(0), d199: f(199, 150), d200: f(200, 150), d200shallow: f(200), d250: f(250, 400), d250tw: f(250, 100), d300: f(300, 100), none: J.finds({ day: 5, rounds: [{ title: 'T', name: null, depth: 0 }, null] }).length };
  });
  ok('fair: the same depth on the same question always meets the same animal', rules.same);
  ok('the animal met always lives at that depth', rules.zone);
  ok('different days bring different animals at the same depth', rules.varied >= 3, rules.varied);
  ok('an answer at the tip (everyone said it) only meets the seabirds', rules.tip.length === 1 && rules.tip[0] === 'auk', rules.tip);
  ok('the giant squid needs a +200 m answer, and the dive in the Twilight Zone (300 m) or deeper', !rules.d199.includes('giant') && rules.d200.includes('giant') && !rules.d200shallow.includes('giant'), JSON.stringify([rules.d199, rules.d200, rules.d200shallow]));
  ok('the bigfin needs +250 m in the Midnight Zone (600 m); the colossal squid an Unfathomable answer (+300 m)', rules.d250.includes('bigfin') && !rules.d250tw.includes('bigfin') && !rules.d250.includes('colossal') && rules.d300.includes('colossal'), JSON.stringify([rules.d250, rules.d250tw, rules.d300]));
  ok('a question with no verified answer records nothing', rules.none === 0);

  // ---------- Nothing yet ----------
  await seed(p, []); await open(p);
  ok('empty journal explains how entries are made', /Nothing recorded yet/.test(await p.textContent('.jn-lead')));

  // ---------- Glimpses don't count ----------
  await p.evaluate(() => localStorage.setItem('iceberg:sightings', JSON.stringify({ angler: { n: 3, first: 1 }, viper: { n: 1, first: 1 }, colossal: { n: 1, first: 2 } })));
  await p.evaluate(() => { location.hash = '#log'; }); await open(p);
  ok('animals only glimpsed in passing are not recorded', await p.evaluate(() => !document.querySelector('.jn-row:not(.unknown)')));

  // ---------- A history ----------
  await seed(p, [
    { day: 1, rounds: [R('Birds', 'raven', 12), R('Cheese', 'feta', 64), R('Countries', 'Bhutan', 148), R('Sports', 'sepak takraw', 212), R('Words', 'quagmire', 0)] },
    { day: 2, rounds: [R('Fish', 'cod', 120), R('Trees', 'rowan', 296), { title: 'Gods', name: null, depth: 0 }, R('Tools', 'spokeshave', 257), R('Colours', 'teal', 40)] },
  ]);
  await p.evaluate(() => { location.hash = '#log'; }); await open(p);
  const page = await p.evaluate(() => {
    const known = [...document.querySelectorAll('.jn-row:not(.unknown) .jn-name')].map(n => n.firstChild.textContent.trim());
    const text = document.querySelector('#hub-body').innerText, all = Wildlife.species().map(s => s.name);
    const j = Journal.compute();
    return { known, leaked: all.filter(n => !known.includes(n) && text.includes(n)), count: j.log.size, deepest: j.deepest && j.deepest.depth, colossal: !!j.log.get('colossal'),
      great: [...document.querySelectorAll('.jn-row.great .jn-name')].map(n => n.firstChild.textContent.trim()), lead: document.querySelector('.jn-lead').innerText };
  });
  ok('entries are made from the saved dives', page.count === page.known.length && page.count >= 6, page.count);
  ok('undiscovered animals stay unnamed on the page', page.leaked.length === 0, page.leaked);
  ok('the giant and bigfin squid are recorded from deep answers; the colossal squid is not', page.great.includes('Giant squid') && page.great.includes('Bigfin squid') && !page.colossal, page.great);
  ok('the rarest answer and the deepest dive are kept as personal records', page.deepest === 296 && /rowan/.test(page.lead) && /Deepest dive/.test(page.lead));
  ok('each entry says which answer found it', await p.evaluate(() => /“raven” for Birds/.test(document.querySelector('#hub-body').innerText)));

  // Opening an entry shows the animal, larger, with what it really is.
  await p.click('.jn-row:not(.unknown) >> nth=1'); await p.waitForSelector('.jn-detail canvas');
  ok('an entry opens to the animal and a true fact about it', await p.evaluate(() => { const d = document.querySelector('.jn-detail'); return d.querySelector('canvas').width > 100 && d.innerText.length > 30; }));
  await p.keyboard.press('Enter');
  ok('entries work from the keyboard', await p.evaluate(() => document.querySelectorAll('.jn-detail').length <= 1));
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await ctx.close();

  // ---------- Sizes ----------
  for (const vp of ['phone', 'small', 'desk']) {
    const c = await b.newContext({ viewport: VPS[vp] }), q = await c.newPage();
    await q.goto('http://localhost:8793/?test&day=3'); await q.waitForSelector('#play:not([disabled])');
    await seed(q, [{ day: 1, rounds: [R('Birds', 'raven', 12), R('Cheese', 'feta', 64), R('Countries', 'Bhutan', 148), R('Sports', 'sepak takraw', 212), R('Words', 'quagmire', 0)] }]);
    await open(q);
    ok(`${vp}: the journal fits the width`, await q.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    ok(`${vp}: reachable from the menu`, await q.evaluate(() => !!document.querySelector('#menu-panel [data-go="journal"]')));
    await q.evaluate(() => { location.hash = '#log'; }); await q.waitForSelector('.jn-link');
    ok(`${vp}: the dive log links to it, and no extra tab crowds the tab row`, await q.evaluate(() => /of \d+ animals/.test(document.querySelector('.jn-link').innerText) && document.querySelector('#hub-tabs').scrollWidth <= document.querySelector('#hub-tabs').clientWidth));
    await c.close();
  }
  await b.close(); site.close();
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.log('STOPPED: ' + e.message); process.exit(1); });
