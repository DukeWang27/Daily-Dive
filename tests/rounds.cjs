// Experimental round types in the playtest build: rarity target, forbidden answers, risk and reward, a route choice and
// an answer chain. Checks the scoring, that nothing can take the dive back up, and that choices survive a reload.
// Usage: node tests/rounds.cjs
const { chromium, serve } = require('./lib.cjs');
const fs = require('fs'), path = require('path'), os = require('os'), { execFileSync } = require('child_process');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('PASS  ' + name); } else { fail++; console.log('FAIL  ' + name + (extra ? '  [' + extra + ']' : '')); } };
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'rounds-'));
execFileSync('python3', [path.join(__dirname, '..', 'tools/playtest/build.py'), out]);

(async () => {
  const site = serve(8841), b = await chromium.launch(), errs = [];
  const open = async (day, fresh = true) => {
    const p = await b.newPage({ viewport: { width: 1280, height: 800 } }); p.on('pageerror', e => errs.push(`${day}: ${e.message}`));
    await p.route('**/pt/**', r => { const f = path.join(out, 'pt', path.basename(new URL(r.request().url()).pathname)); fs.existsSync(f) ? r.fulfill({ path: f, contentType: 'application/json' }) : r.fulfill({ status: 404 }); });
    await p.route(/supabase\.co/, r => r.abort());
    await p.goto(`http://localhost:8841/?playtest&day=${day}&fast`);
    if (fresh) { await p.evaluate(() => localStorage.clear()); await p.goto(`http://localhost:8841/?playtest&day=${day}&fast`); }
    await p.waitForFunction(() => !document.querySelector('#play').disabled);
    return p;
  };
  const start = async p => { await p.click('#play'); await p.waitForTimeout(2000); };
  const card = p => p.evaluate(() => { const c = document.querySelector('#round-card'); return c && !c.hidden ? c.innerText.replace(/\n+/g, ' | ') : ''; });
  const guess = async (p, t) => { await p.fill('#answer', t); await p.press('#answer', 'Enter'); await p.waitForTimeout(300); await p.waitForFunction(() => !document.querySelector('#round-card').hidden || !window.ICEBERG_TEST || true); await p.waitForTimeout(1600); };
  const G = (p, day) => p.evaluate(d => JSON.parse(localStorage.getItem('iceberg-pt:game:' + d) || 'null'), day);
  const meta = p => p.evaluate(() => { const t = document.querySelector('#top-meta').textContent; return /Daily/.test(t) ? 0 : +t.replace(/\D/g, '') || 0; });
  const rows = (p, i) => p.evaluate(i => window.Game.cats[i].answers.filter(a => !a.pv).sort((x, y) => y.s - x.s).map(a => [a.a, a.s]), i);

  // ---------- Rarity target ----------
  let p = await open(191); await start(p); await p.waitForSelector('#round-card:not([hidden])', { timeout: 8000 });
  ok('target: its rules and the target band are shown before the clock starts', /Rarity target/i.test(await card(p)) && /1% to 3%/i.test(await card(p)));
  await p.keyboard.press('Enter'); await p.waitForTimeout(300);
  await guess(p, 'France'); const t1 = await meta(p);
  await guess(p, 'Peru'); const t2 = await meta(p);
  await guess(p, 'Bhutan'); const t3 = await meta(p);
  ok('target: an answer in the band beats a more common one and a rarer one', t2 === 250 && t1 > 0 && t1 < t2 && t3 === t2, [t1, t2, t3].join(' '));
  ok('target: being rarer than the band does not earn more (the rarest is not the goal)', (await p.evaluate(() => document.querySelector('#hint').textContent)).includes('too rare'));
  await p.close();

  // ---------- Forbidden ----------
  p = await open(192); await start(p); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
  for (const t of ['apple', 'Bananas', 'aple']) { await p.fill('#answer', t); await p.press('#answer', 'Enter'); await p.waitForTimeout(400); if (await p.evaluate(() => !document.querySelector('#q-ask').hidden)) { await p.keyboard.press('Enter'); await p.waitForTimeout(400); } }
  let g = await G(p, 192);
  ok('forbidden: the banned answer, its plural and a misspelling of it are all refused, and cost no guess', g.rounds[0].guesses.length === 0 && g.rounds[0].rejects.length >= 2, JSON.stringify(g.rounds[0].rejects.map(x => x.text)));
  await guess(p, 'kumquat'); g = await G(p, 192);
  ok('forbidden: any other fruit counts as usual', g.rounds[0].guesses.length === 1 && g.rounds[0].guesses[0].status === 'ok');
  await p.close();

  // ---------- Risk and reward ----------
  const riskRun = async (choice, second) => {
    const p = await open(193); await start(p); await p.keyboard.press('Enter').catch(() => {}); await p.waitForTimeout(300);
    const r = await rows(p, 0), first = r[Math.floor(r.length * 0.3)][0], rare = r[r.length - 3][0], common = r[2][0];
    const ups = []; let last = 0; const watch = setInterval(async () => { try { const m = await meta(p); if (m < last) ups.push([last, m]); last = Math.max(last, m); } catch { } }, 80);
    await guess(p, first); const c = await card(p);
    await p.keyboard.press(String(choice)); await p.waitForTimeout(900);
    if (choice !== 1) { await guess(p, second === 'rare' ? rare : common); if (second !== 'rare') await guess(p, r[1][0]); }
    clearInterval(watch);
    const s = await G(p, 193), q = s.rounds[0];
    return { p, c, q, depth: await meta(p), ups, first };
  };
  let R = await riskRun(1);
  ok('risk: the choice is offered after a first answer worth something, with the stakes spelled out', /Keep it: \+\d+ m/.test(R.c) && /20% bonus/.test(R.c) && /×1\.5/.test(R.c) && /earns 0/.test(R.c), R.c);
  ok('risk: keeping it banks the first answer plus 20% and ends the question', R.q.done && R.q.choice.kind === 'secure' && R.depth === Math.round(R.q.choice.stake * 1.2), JSON.stringify(R.q.choice) + ' ' + R.depth);
  await R.p.close();
  R = await riskRun(2, 'rare');
  ok('risk: playing on is ordinary best of three', R.q.choice.kind === 'continue' && R.depth > R.q.choice.stake, R.depth);
  await R.p.close();
  R = await riskRun(3, 'rare');
  { const later = await R.p.evaluate(() => { return Math.max(...JSON.parse(localStorage.getItem('iceberg-pt:game:193')).rounds[0].guesses.slice(1).filter(g => g.status === 'ok').map(g => window.Iceberg.depthOf(g.share))); });
    const want = R.q.choice.stake + Math.round(1.5 * (later - R.q.choice.stake));
    ok('risk: a risk that comes off pays the stake plus 1.5 times the gain', R.q.choice.kind === 'risk' && later > R.q.choice.stake && R.depth === want, `${R.depth} vs ${want} (stake ${R.q.choice.stake}, later ${later})`); }
  await R.p.close();
  R = await riskRun(3, 'common');
  const lost = await R.p.evaluate(() => document.querySelector('#best-depth') ? document.querySelector('#best-depth').textContent : '');
  ok('risk: a risk that fails earns nothing for that question', R.q.choice.kind === 'risk' && R.depth === 0 && /\+0/.test(lost), `${R.depth} ${lost}`);
  ok('risk: whatever happens, the dive never went back up', !R.ups.length, JSON.stringify(R.ups));
  await R.p.close();
  p = await open(193); await start(p); await p.keyboard.press('Enter').catch(() => {}); await p.waitForTimeout(300);
  await guess(p, (await rows(p, 0))[0][0]);
  ok('risk: a first answer worth nothing has nothing to stake, so no choice is offered', !(await card(p)) && (await G(p, 193)).rounds[0].choice.kind === 'continue');
  await p.close();

  // ---------- The same day for everyone ----------
  const order = async () => { const p = await open(201); const k = await p.evaluate(() => window.Game.cats.map(c => c.key + ':' + ((c.mode || {}).type || 'rarity'))); await p.close(); return k.join(','); };
  const o1 = await order(), o2 = await order();
  ok('a full expedition has one of each round type, in the same order every time it loads', o1 === o2 && ['target', 'forbidden', 'risk', 'wildcard', 'rarity'].every(t => o1.includes(':' + t)), o1);

  // ---------- Route choice ----------
  p = await open(209); await start(p);
  const finishQ = async () => { await p.click('#finish').catch(() => {}); await p.waitForFunction(() => JSON.parse(localStorage.getItem('iceberg-pt:game:209') || '{}').phase === 'done', null, { timeout: 15000 }); await p.click('#next'); await p.waitForTimeout(1300); };
  await guess(p, 'robin'); await finishQ();
  if (await card(p)) { await p.keyboard.press('Enter'); await p.waitForTimeout(300); }
  await guess(p, 'beagle'); await finishQ();
  ok('route: halfway, the water splits and four routes are offered', /Choose your route/.test(await card(p)) && /cavern/i.test(await card(p)));
  await p.keyboard.press('3'); await p.waitForTimeout(1200); if (await card(p)) { await p.keyboard.press('Enter'); await p.waitForTimeout(300); }
  const rq = await p.textContent('#q-title');
  await p.reload(); await p.waitForTimeout(2500);
  ok('route: the chosen route\'s questions follow, and survive a reload', /misleading name/.test(rq) && (await p.textContent('#q-title')) === rq, rq);
  await p.close();

  // ---------- Answer chain ----------
  p = await open(210); await start(p);
  const nextQ = async () => { await p.click('#finish').catch(() => {}); await p.waitForFunction(() => JSON.parse(localStorage.getItem('iceberg-pt:game:210') || '{}').phase === 'done', null, { timeout: 15000 }); await p.click('#next'); await p.waitForTimeout(1300); };
  await guess(p, 'Madagascar'); await nextQ();
  const q2 = await p.textContent('#q-title');
  await guess(p, 'fossa'); await nextQ();
  const q3 = await p.textContent('#q-title');
  await guess(p, 'fossa');
  const sameFam = await p.evaluate(() => document.querySelector('#hint').textContent);
  await p.reload(); await p.waitForTimeout(2500);
  ok('chain: the country chosen decides the next question', /native to Madagascar/.test(q2), q2);
  ok('chain: the animal chosen decides the one after (another family than the fossa)', /different family than the fossa/.test(q3), q3);
  ok('chain: an animal from the same family doesn\'t count there', !/^\+\d+ m\. You're down/.test(sameFam), sameFam);
  ok('chain: the chained question survives a reload', (await p.textContent('#q-title')) === q3);
  await p.close();
  // ---------- Short chains ----------
  const short = async (day, first) => { const p = await open(day); await start(p);
    await guess(p, first); await p.click('#finish').catch(() => {}); await p.waitForFunction(d => JSON.parse(localStorage.getItem('iceberg-pt:game:' + d) || '{}').phase === 'done', day, { timeout: 15000 }); await p.click('#next'); await p.waitForTimeout(1300);
    const t = await p.textContent('#q-title'), h = await p.textContent('#q-hint'); await p.reload(); await p.waitForTimeout(2500);
    const t2 = await p.textContent('#q-title'), h2 = await p.textContent('#q-hint'); await p.close(); return { t, h, t2, h2 }; };
  let c = await short(226, 'Japan');
  ok('short chain: a country leads to its inventions', /invented in Japan/.test(c.t) && c.t2 === c.t, JSON.stringify(c));
  c = await short(226, 'Liechtenstein');
  ok('short chain: an answer with no checked list falls back to a general question, and says why', /before 1900/.test(c.t) && /No checked list for Liechtenstein/.test(c.h) && c.h2 === c.h, JSON.stringify(c));
  c = await short(227, 'kangaroo');
  ok('short chain: an animal leads to the countries it lives in', /where the kangaroo lives/.test(c.t), JSON.stringify(c));

  // ---------- Sea mines ----------
  p = await open(195); await start(p); await p.keyboard.press('Enter'); await p.waitForTimeout(400);
  const mi = await p.evaluate(() => { const c = window.Game.cats[0], m = c.mode.mines, rows = c.answers.filter(a => !a.pv);
    return { inM: rows.find(a => a.s >= m[0].lo && a.s <= m[0].hi).a, near: rows.find(a => a.s > m[1].hi && a.s < m[1].hi * 1.9).a, m }; });
  ok('mines: the mined bands are on the sonar before you guess', (await p.locator('#round-extra .sonar-mine').count()) === 2);
  ok('mines: they are in the water too', await p.evaluate(() => document.querySelectorAll('#ib .ib-scen').length === 3));
  await guess(p, mi.inM); const h1 = await p.textContent('#hint'), m1 = await meta(p);
  ok('mines: an answer inside a mined band earns nothing and spends the guess', /^Mine!/.test(h1) && m1 === 0 && (await G(p, 195)).rounds[0].guesses.length === 1, h1);
  await guess(p, mi.near); const h2 = await p.textContent('#hint'), m2 = await meta(p), d2 = await p.evaluate(() => { const g = JSON.parse(localStorage.getItem('iceberg-pt:game:195')).rounds[0].guesses[1]; return window.Iceberg.depthOf(g.share); });
  ok('mines: passing close by a mine earns 25% more', /close past/.test(h2) && m2 === Math.round(d2 * 1.25), `${h2} ${m2} vs ${d2}`);
  await p.reload(); await p.waitForTimeout(2500);
  ok('mines: a reload keeps the mine that went off gone', (await p.locator('#round-extra .sonar-mine.gone').count()) === 1);
  await p.close();

  // ---------- Familiar rounds skip the card ----------
  p = await open(191); await start(p); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
  await p.evaluate(() => localStorage.setItem('iceberg-pt:kinds-seen', JSON.stringify({ target: 2 })));
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('iceberg-pt:game:191')); }); await p.close();
  p = await open(191, false); await p.evaluate(() => { localStorage.removeItem('iceberg-pt:game:191'); localStorage.setItem('iceberg-pt:kinds-seen', JSON.stringify({ target: 2 })); }); await p.reload(); await p.waitForFunction(() => !document.querySelector('#play').disabled);
  await start(p);
  const brief = await p.evaluate(() => ({ card: !document.querySelector('#round-card').hidden, rule: (document.querySelector('#round-extra .rx-rule') || {}).textContent || '', clock: !document.querySelector('#melt').classList.contains('paused') }));
  ok('a kind of round seen twice skips its card: the rule sits in one line and the clock runs', !brief.card && /target/i.test(brief.rule) && brief.clock, JSON.stringify(brief));
  await p.click('#round-extra .rx-more'); await p.waitForTimeout(400);
  const paused = await p.evaluate(() => ({ card: !document.querySelector('#round-card').hidden, paused: document.querySelector('#melt').classList.contains('paused') }));
  ok('the ? brings back the full rules, and the clock keeps running (no free thinking time)', paused.card && !paused.paused, JSON.stringify(paused));
  await p.keyboard.press('Enter'); await p.waitForTimeout(500);
  ok('closing them leaves the clock running', await p.evaluate(() => !document.querySelector('#melt').classList.contains('paused')));
  await p.close();

  // ---------- The daily mix ----------
  const mix = [];
  for (const d of [211, 212, 213]) { const p = await open(d); mix.push(await p.evaluate(() => window.Game.cats.map(c => (c.mode || {}).type || 'rarity'))); await p.close(); }
  ok('the daily mix: two rarity rounds or more, a target or forbidden, one special, rarity first, different each day',
    mix.every(m => m.length === 5 && m[0] === 'rarity' && m.filter(x => x === 'rarity').length >= 2 && m.filter(x => ['risk', 'wildcard', 'mines'].includes(x)).length === 1) && new Set(mix.map(m => m.join())).size === 3, JSON.stringify(mix));

  // ---------- The Deep Signal (rollover prototype) ----------
  p = await open(225);
  ok('signal: the home screen names the community challenge, marked as a prototype', /Deep Signal/.test(await p.textContent('#home-signal')) && /Prototype/i.test(await p.textContent('#home-signal')));
  await p.close();
  ok('no page errors', !errs.length, errs.slice(0, 3).join(' | '));
  await b.close(); site.close(); fs.rmSync(out, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
