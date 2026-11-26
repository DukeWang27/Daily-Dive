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
  ok('risk: the choice is offered after a first answer worth something, with the stakes spelled out', /Keep \+\d+ m/.test(R.c) && /×1\.5/.test(R.c) && /earns 0/.test(R.c), R.c);
  ok('risk: keeping it banks the first answer and ends the question', R.q.done && R.q.choice.kind === 'secure' && R.depth === R.q.choice.stake, JSON.stringify(R.q.choice) + ' ' + R.depth);
  await R.p.close();
  R = await riskRun(2, 'rare');
  ok('risk: playing on is ordinary best of three', R.q.choice.kind === 'continue' && R.depth > R.q.choice.stake, R.depth);
  await R.p.close();
  R = await riskRun(3, 'rare');
  ok('risk: a risk that comes off pays 1.5 times the better answer', R.q.choice.kind === 'risk' && R.depth > R.q.choice.stake * 1.5, `${R.depth} vs stake ${R.q.choice.stake}`);
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
  ok('no page errors', !errs.length, errs.slice(0, 3).join(' | '));
  await b.close(); site.close(); fs.rmSync(out, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
