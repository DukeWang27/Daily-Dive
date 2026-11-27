// End-to-end test of the release candidate: the real game (not the playtest) against tests/gateway.cjs and the local
// database, with the prepared days (content/build/sql, private) loaded exactly as production would get them.
//   sh tests/db/setup.sh && node tests/e2e-final.cjs [day]
// Covers: a guest's full day (common, unusual, misspelled, wrong and listed-wrong answers), the reveal cards, the end
// screen; signing up and handing the guest dive in (the server re-scores it: totals must match); rankings; the next
// day; a phone; the database unreachable; the answer-check endpoint unreachable.
const { chromium, serve, VPS } = require('./lib.cjs');
const gw = require('./gateway.cjs');
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log('PASS  ' + name); } else { fail++; console.log('FAIL  ' + name + (extra ? '  [' + extra + ']' : '')); } };
const API = 'http://localhost:8790', SITE = 'http://localhost:8784/';
const DAY = +process.argv[2] || 10;
const sql = (q, p) => gw.pool.query(q, p).then(r => r.rows);
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
let launch = iso(new Date());
const setDay = async n => { const d = new Date(); d.setDate(d.getDate() - (n - 1)); launch = iso(d); await sql(`update public.game_config set value = $1 where key = 'launch'`, [launch]); };
const url = (extra = '') => `${SITE}?test&fast&api=${API}&key=${gw.ANON}&launch=${launch}${extra}`;
const SQLDIR = path.join(ROOT, 'content', 'build', 'sql');
if (!fs.existsSync(SQLDIR)) { console.log('no prepared days here (private content)'); process.exit(0); }

(async () => {
  // Load the prepared days as production would get them.
  for (const f of fs.readdirSync(SQLDIR).filter(f => /^day_\d+\.sql$/.test(f)).sort()) execFileSync('psql', ['-q', '-U', 'postgres', '-d', process.env.ICEBERG_TEST_DB || 'icetest', '-f', path.join(SQLDIR, f)], { stdio: 'ignore' });
  await new Promise(r => gw.server.listen(8790, r)); const site = serve(8784), b = await chromium.launch();
  await sql(`truncate auth.users cascade`); await sql(`truncate public.rate_log, public.username_holds, public.round_plays, public.day_results`);
  await setDay(DAY);
  const errs = [];
  const page = async (vp = 'desk', extra = '', block) => {
    const ctx = await b.newContext({ viewport: VPS[vp], hasTouch: vp === 'phone' }), p = await ctx.newPage();
    p.on('pageerror', e => errs.push(`${vp}: ${e.message}`));
    if (block) await p.route(u => block.test(u.origin + u.pathname), r => r.abort());
    await p.goto(url(extra)); await p.waitForSelector('#play'); await p.waitForFunction(() => !document.querySelector('#play').disabled, null, { timeout: 15000 });
    return p;
  };
  const idle = p => p.waitForFunction(() => !ICEBERG_TEST.busy, null, { timeout: 15000 }).catch(() => {});
  const say = async (p, t) => { await p.fill('#answer', t); await p.keyboard.press('Enter'); await idle(p); await p.waitForTimeout(250); };
  const st = p => p.evaluate(() => ICEBERG_TEST.state);
  const cats = p => p.evaluate(() => ICEBERG_TEST.cats.map(c => ({ key: c.key, prompt: c.prompt, mode: c.mode && c.mode.type, forbid: (c.mode && c.mode.forbid) || [], notIn: c.notIn || [], exact: !!c.exact, rows: c.answers.filter(a => !a.x && !a.h).sort((x, y) => y.s - x.s).map(a => a.d || a.a) })));
  const toNext = async p => { await p.click('#finish').catch(() => {}); await p.waitForFunction(() => ICEBERG_TEST.state.phase === 'done', null, { timeout: 15000 }).catch(() => {}); };
  const slip = w => { const i = Math.floor(w.length / 2); return w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2); };   // swap two middle letters

  // ---------- A guest plays the whole day ----------
  let p = await page('desk');
  const C = await cats(p);
  ok(`day ${DAY} loads its prepared questions from the database`, C.length === 5 && C.every(c => c.rows.length > 10), C.map(c => c.key).join(', '));
  await p.click('#play'); await p.waitForSelector('[data-screen="play"]:not([hidden])');
  const log = [];
  for (let q = 0; q < 5; q++) {
    await p.waitForFunction(i => ICEBERG_TEST.state.round === i && ICEBERG_TEST.state.phase === 'play', q, { timeout: 15000 }).catch(() => {});
    if (await p.evaluate(() => { const c = document.querySelector('#round-card'); return c && !c.hidden; })) { await p.keyboard.press('Enter'); await p.waitForTimeout(300); }
    const c = C[q], ok2 = r => !c.forbid.includes(r), common = c.rows.filter(ok2)[0], deep = c.rows[Math.floor(c.rows.length * 0.8)], mid = c.rows.find(r => ok2(r) && r.length >= 7 && /^[A-Za-z ]+$/.test(r) && r !== common) || c.rows[3];
    // A wrong answer the editors listed ("red panda" for black and white) or plain junk: never counted.
    const wrong = c.notIn[0] || 'xqzvwk';
    await say(p, wrong);
    let s = await st(p); const r0 = s.rounds[q];
    ok(`Q${q + 1} (${c.key}): a wrong answer ("${wrong}") is not counted`, !r0.guesses.some(g => g.status === 'ok'), JSON.stringify(r0.guesses.map(g => g.status)));
    await say(p, common);
    // A slip of a listed answer: counted, corrected, asked about, or (where spelling is the point) left for review.
    await say(p, slip(mid));
    s = await st(p);
    if (await p.evaluate(() => /Did you mean/i.test(document.querySelector('#hint').textContent))) { await p.keyboard.press('Enter'); await idle(p); s = await st(p); }
    const last = s.rounds[q].guesses[s.rounds[q].guesses.length - 1];
    ok(`Q${q + 1}${c.mode ? ' [' + c.mode + ']' : ''}: a misspelling ("${slip(mid)}") is corrected to the answer${c.exact ? ', or left for review on a spelling question' : ''}`, last && (last.name === undefined ? false : true) || (c.exact && last && last.status !== 'ok') || (last && last.status === 'ok'), last && `${last.status} ${last.name || ''}`);
    if (s.rounds[q].guesses.length < 3 && s.rounds[q].phase !== 'done') await say(p, deep);
    s = await st(p); const r = s.rounds[q];
    log.push({ q, guesses: r.guesses.map(g => `${g.status}:${g.name || g.typed}`) });
    await toNext(p);
    await p.waitForTimeout(400);
    if (q === 0) {
      const cards = await p.$$eval('#depths-list li', l => l.map(x => x.textContent));
      ok('results: "From the depths" shows the Buoy as an estimate (no real counts yet), never invented player numbers', cards.some(t => /Buoy/.test(t) && /estimate/.test(t)) && !cards.some(t => /Shoal|Kindred|Trench/.test(t)), cards.join(' / '));
      ok('results: no "undefined", "null" or "NaN" in the results panel', !/\bundefined\b|\bnull\b|\bNaN\b/.test(await p.textContent('#done-panel')));
    }
    if (q < 4) { await p.click('#next'); await p.waitForTimeout(300); }
  }
  await p.click('#next').catch(() => {}); await p.waitForSelector('[data-screen="end"]:not([hidden])', { timeout: 15000 }).catch(() => {});
  const total = await p.evaluate(() => ICEBERG_TEST.state && ICEBERG_TEST.state.rounds.reduce((t, r, i) => t + (window.Game.scoreOf ? 0 : 0), 0));
  const endText = await p.textContent('[data-screen="end"]').catch(() => '');
  ok('the end screen appears with the day\'s total', /\d/.test(endText) && !/\bundefined\b|\bNaN\b/.test(endText));
  const plays = await sql(`select count(*)::int n from public.round_plays where day = $1`, [DAY]);
  ok('the five questions were recorded for the crowd counts (anonymous)', plays[0].n === 5, plays[0].n);
  const dr = await sql(`select total from public.day_results where day = $1`, [DAY]);
  const shown = +(endText.match(/([\d,]+)\s*m/) || [0, '0'])[1].replace(/,/g, '');
  ok('the day result recorded equals the total shown', dr.length === 1 && dr[0].total === shown, `${dr[0] && dr[0].total} vs ${shown}`);

  // ---------- Sign up: the guest dive is handed in and re-scored by the server ----------
  await p.evaluate(() => Hub.open('account')); await p.waitForSelector('[data-screen="hub"]:not([hidden])');
  await p.click('#hub-body .auth-switch >> text=Create account'); await p.fill('#hub-body input[type=email]', 'e2e@example.test'); await p.fill('#hub-body input[type=password]', 'secret12'); await p.click('#hub-body button[type=submit]');
  await p.waitForSelector('#hub-body input[autocomplete=username]', { timeout: 8000 }).catch(() => {});
  await p.fill('#hub-body input[autocomplete=username]', 'diver_e2e').catch(() => {}); await p.waitForTimeout(500); await p.click('#hub-body button[type=submit]').catch(() => {});
  await p.waitForFunction(() => window.Account && Account.signedIn, null, { timeout: 10000 }).catch(() => {}); await p.waitForTimeout(2500);
  const dive = await sql(`select d.total, d.depths from public.dives d join public.profiles pr on pr.id = d.user_id where pr.username = 'diver_e2e' and d.day = $1`, [DAY]);
  ok('signing up hands the guest dive in, and the server\'s own scoring gives the same total', dive.length === 1 && dive[0].total === shown, dive[0] ? `${dive[0].total} vs ${shown}` : 'no dive');
  await p.evaluate(() => Hub.open('rankings')).catch(() => {}); await p.waitForTimeout(1500);
  const rank = await p.textContent('#hub-body').catch(() => '');
  ok('rankings list the new player for the day', /diver_e2e/.test(rank), rank.slice(0, 120).replace(/\n/g, ' | '));
  await p.context().close();

  // ---------- The next day: new questions, fresh state ----------
  await setDay(DAY + 1);
  p = await page('phone');
  const C2 = await cats(p);
  ok(`the next day (${DAY + 1}) brings different questions`, C2.length === 5 && C2.every(c => !C.some(x => x.key === c.key)), C2.map(c => c.key).join(', '));
  await p.click('#play'); await p.waitForSelector('[data-screen="play"]:not([hidden])');
  if (await p.evaluate(() => { const c = document.querySelector('#round-card'); return c && !c.hidden; })) { await p.keyboard.press('Enter'); await p.waitForTimeout(300); }
  await say(p, C2[0].rows[1]);
  ok('phone: a guess counts and nothing spills sideways', (await st(p)).rounds[0].guesses.some(g => g.status === 'ok') && await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await p.context().close();

  // ---------- Failure: the database unreachable ----------
  // A player who already loaded today keeps playing from the device's copy; a new device is told, and retries itself.
  {
    const ctx = await b.newContext({ viewport: VPS.desk }); let down = false;
    const q = await ctx.newPage(); q.on('pageerror', e => errs.push('outage: ' + e.message));
    await q.route(u => down && u.origin === 'http://localhost:8790', r => r.abort());
    await q.goto(url()); await q.waitForFunction(() => !document.querySelector('#play').disabled, null, { timeout: 15000 });
    down = true; await q.reload(); await q.waitForFunction(() => !document.querySelector('#play').disabled, null, { timeout: 15000 }).catch(() => {});
    ok('database down: a player who already opened today carries on from the copy on their device', await q.evaluate(() => ICEBERG_TEST.cats.length === 5 && !document.querySelector('#play').disabled));
    await q.evaluate(() => localStorage.clear()); await q.reload(); await q.waitForFunction(() => /Trying again/.test(document.querySelector('#home-streak').textContent), null, { timeout: 15000 }).catch(() => {});
    const msg = await q.textContent('#home-streak');
    ok('database down on a new device: a clear message, and it retries by itself (no wrong questions)', /Trying again/.test(msg) && await q.evaluate(() => /Couldn/.test(document.querySelector('#play').textContent)), JSON.stringify([msg, await q.textContent('#play')]));
    down = false; await q.waitForFunction(() => !document.querySelector('#play').disabled && !/Couldn/.test(document.querySelector('#play').textContent), null, { timeout: 25000 }).catch(() => {});
    ok('…and opens today by itself once the connection is back', await q.evaluate(() => ICEBERG_TEST.cats.length === 5 && !/Couldn/.test(document.querySelector('#play').textContent)));
    await ctx.close();
  }

  // ---------- Failure: the answer check unreachable ----------
  p = await page('desk', '&verify=http://localhost:9/nothing');
  await p.click('#play'); await p.waitForSelector('[data-screen="play"]:not([hidden])');
  if (await p.evaluate(() => { const c = document.querySelector('#round-card'); return c && !c.hidden; })) { await p.keyboard.press('Enter'); await p.waitForTimeout(300); }
  await say(p, 'Zorblaxian quandary thing'); await say(p, 'Zorblaxian quandary thing'); await p.waitForTimeout(8000);
  const g = (await st(p)).rounds[0].guesses;
  ok('with the answer check unreachable an unknown answer simply waits for review and play goes on', g.some(x => x.status === 'pending') && await p.evaluate(() => !document.querySelector('#answer').disabled), JSON.stringify(g.map(x => x.status)));
  await p.context().close();

  ok('no script errors anywhere', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(JSON.stringify(log));
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close(); site.close(); gw.server.close(); await gw.pool.end(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
