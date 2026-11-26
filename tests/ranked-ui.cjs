// Ranked 1v1 in two real browsers: queue, match, five questions, settle, show the rating change.
//   each browser  ->  tests/gateway.cjs (a local stand-in for Supabase's web service)  ->  local PostgreSQL with the
//   game's real race tables and functions (supabase/0004_race.sql).
// Run:  sh tests/db/setup.sh && psql -U postgres -d icetest -f supabase/0007_intelligence.sql -f supabase/0008_ranked.sql && node tests/ranked-ui.cjs
// To keep the run short, the race's fixed pauses (countdown, break between questions, quick-race wait) are shortened
// in the test database only. Everything else (deadlines, guess limits, scoring, secrecy) is the real code.
// What it cannot prove: Supabase's own realtime service (the "poke" is switched off in tests; polling carries it)
// and behaviour across real networks.
const { chromium, serve, audit, VPS } = require('./lib.cjs');
const gw = require('./gateway.cjs');
const R = []; let fails = 0;
const ok = (name, cond, extra = '') => { R.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  [' + extra + ']' : ''}`); if (!cond) fails++; };
const API = 'http://localhost:8790', SITE = 'http://localhost:8784/';
const sql = (q, p) => gw.pool.query(q, p).then(r => r.rows);
const url = (extra = '') => `${SITE}?test&fast&api=${API}&key=${gw.ANON}${extra}`;
const SHOTS = process.env.SHOTS || '';

(async () => {
  await new Promise(r => gw.server.listen(8790, r)); const site = serve(8784), b = await chromium.launch();
  await sql(`truncate auth.users cascade`); await sql(`truncate public.rate_log, public.username_holds, public.races cascade`);
  // Race questions that have answers beneath the iceberg, so the Challenger Deep find can be tested on any of them.
  await sql(`update public.race_pool set active = qid in (1023, 1024, 1025, 1028, 1029)`);
  // Nothing goes beneath the iceberg without real players' evidence (supabase/0006_content.sql). Give the rarest answer of
  // each of these questions that evidence here, as enough real races would: 5 of 12,000 players gave it.
  await sql(`update public.set_answers sa set share = 0.00002, ev = true, n_real = 5, depth = private.depth_for(0.00002, false, true)
    where (set_id, answer) in (select set_id, answer from (select set_id, answer, row_number() over (partition by set_id order by share, answer) rn from public.set_answers where set_id in (1023, 1024, 1025, 1028, 1029)) x where rn = 1)`);
  await sql(`create or replace function private.race_t(k text) returns interval language sql immutable as $$
    select case k when 'countdown' then interval '1.5 seconds' when 'between' then interval '3 seconds' when 'grace' then interval '1.5 seconds'
      when 'lobby_wait' then interval '4 seconds' when 'away' then interval '8 seconds' when 'abandon' then interval '30 seconds' end $$`);
  const errs = [];
  const fresh = async (vp = 'desk') => {
    const ctx = await b.newContext({ viewport: VPS[vp], hasTouch: vp === 'phone' || vp === 'small' }), p = await ctx.newPage(); p.errs = [];
    p.on('pageerror', e => { p.errs.push(e.message); errs.push(e.message); });
    p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) { p.errs.push(m.text()); errs.push(m.text().slice(0, 200)); } });
    await p.goto(url()); await p.waitForSelector('#play'); await p.waitForFunction(() => window.Account && Account.state !== 'off', null, { timeout: 10000 }); return p;
  };
  const signUp = async (p, email, name) => {
    await p.evaluate(() => Hub.open('account')); await p.waitForSelector('[data-screen="hub"]:not([hidden])'); await p.waitForTimeout(200);
    await p.click('#hub-body .auth-switch >> text=Create account'); await p.fill('#hub-body input[type=email]', email); await p.fill('#hub-body input[type=password]', 'secret12'); await p.click('#hub-body button[type=submit]');
    await p.waitForSelector('#hub-body input[autocomplete=username]', { timeout: 8000 });
    await p.fill('#hub-body input[autocomplete=username]', name); await p.waitForTimeout(400); await p.click('#hub-body button[type=submit]'); await p.waitForFunction(() => Account.signedIn, null, { timeout: 8000 });
  };
  const toRace = async p => { await p.evaluate(() => { location.hash = '#race'; }); await p.waitForSelector('[data-screen="race"]:not([hidden])'); await p.waitForSelector('#r-quick, #r-players, #r-signup, .rdock .note-line', { timeout: 8000 }); };
  const view = p => p.evaluate(() => Race.view);
  const waitView = (p, v, timeout = 20000) => p.waitForFunction(v => Race.view === v, v, { timeout });
  const st = p => p.evaluate(() => Race.state && { status: Race.state.status, round: Race.state.round, qid: Race.state.qid, players: Race.state.players.map(x => ({ n: x.username, d: x.distance, used: x.used })), mine: Race.state.mine, revealed: Race.state.revealed });
  // An answer for the current question, about as rare as asked (0 = most common, 1 = rarest).
  const answer = (p, f) => p.evaluate(async f => { const q = await fetch(`race/${Race.state.qid}.json`).then(r => r.json()).then(j => j.questions[0]); const c = q.answers.filter(x => !x.x).sort((a, b) => b.s - a.s); return c[Math.min(c.length - 1, Math.floor(c.length * f))].a; }, f);
  const waitTyping = p => p.waitForFunction(() => { const i = document.querySelector('#r-answer'); return Race.view === 'question' && i && !i.disabled && !/Starting/.test(i.placeholder); }, null, { timeout: 20000 });
  const guess = async (p, text) => { const before = await p.evaluate(() => (Race.state.mine || []).length); await p.fill('#r-answer', text); await p.keyboard.press('Enter'); await p.waitForFunction(n => (Race.state.mine || []).length > n || /No guess used|Enter again|anyway/.test(document.querySelector('#r-hint').textContent), before, { timeout: 8000 }); return p.evaluate(() => ({ hint: document.querySelector('#r-hint').textContent, mine: Race.state.mine.slice(-1)[0], dist: Race.state.players.find(x => x.me).distance })); };
  const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png` }); };

  await sql(`update public.race_pool set active = true, ranked = true where qid in (1023, 1024, 1025, 1028, 1029)`);
  const ann = await fresh(), bo = await fresh('phone');
  await signUp(ann, 'ann@ranked.test', 'Anouk'); await signUp(bo, 'bo@ranked.test', 'Bodil');
  await toRace(ann); await toRace(bo);
  await ann.waitForSelector('#r-ranked'); await ann.waitForFunction(() => /rating/.test((document.querySelector('.rk-elo') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
  const card = await ann.evaluate(() => ({ div: document.querySelector('.rk-div').textContent, elo: document.querySelector('.rk-elo').textContent, badge: !!document.querySelector('.rk-card canvas.rk-badge'), quick: !!document.querySelector('#r-quick'), friends: !!document.querySelector('#r-private') }));
  ok('race home: ranked 1v1 first (division, rating, insignia), then quick race and race friends', card.div === 'Current' && /1,000 rating/.test(card.elo) && card.badge && card.quick && card.friends, JSON.stringify(card));
  await shot(ann, 'ranked-home');
  await ann.click('#r-ranked'); await ann.waitForFunction(() => Race.view === 'search' && /searching|Waiting/i.test(document.querySelector('.rk-status').textContent), null, { timeout: 8000 });
  ok('searching: a clear status, the rating range, and a cancel button', await ann.evaluate(() => !!document.querySelector('#r-cancel') && /±\d+/.test(document.querySelector('.rdock').innerText)));
  await shot(ann, 'ranked-search');
  await bo.click('#r-ranked');
  await Promise.all([ann, bo].map(p => p.waitForFunction(() => Race.state && Race.state.kind === 'ranked', null, { timeout: 15000 })));
  const s0 = await st(ann);
  ok('both are matched into the same ranked race, two players, five questions', s0.players.length === 2 && (await st(bo)).players.length === 2 && (await ann.evaluate(() => Race.state.q_count)) === 5 && (await ann.evaluate(() => Race.state.id)) === (await bo.evaluate(() => Race.state.id)));
  for (let round = 1; round <= 5; round++) {
    await Promise.all([waitTyping(ann), waitTyping(bo)]);
    if (round === 2) await shot(ann, 'ranked-race');
    await guess(ann, await answer(ann, 0.95)); await guess(bo, await answer(bo, 0.05));
    await ann.click('#r-done').catch(() => {}); await bo.click('#r-done').catch(() => {});
    await Promise.all([ann, bo].map(p => p.waitForFunction(r => Race.state && (Race.state.round > r || Race.state.status !== 'question'), round, { timeout: 30000 })));
  }
  await Promise.all([ann, bo].map(p => p.waitForFunction(() => Race.state && Race.state.status === 'finished' && document.querySelector('.rk-result .rk-change'), null, { timeout: 40000 })));
  const ra = await ann.evaluate(() => ({ t: document.querySelector('.rk-result .r-title').textContent, d: document.querySelector('.rk-delta').textContent, again: !!document.querySelector('#r-again'), table: !!document.querySelector('.r-answers') }));
  const rb = await bo.evaluate(() => ({ t: document.querySelector('.rk-result .r-title').textContent, d: document.querySelector('.rk-delta').textContent }));
  ok('results: the deeper player sees Victory and +20, the other Defeat and -20 (placement K, equal ratings)', ra.t === 'Victory' && ra.d === '+20' && rb.t === 'Defeat' && rb.d === '-20', JSON.stringify([ra, rb]));
  ok('results: question-by-question answers are shown now the match is over, and "Queue again" replaces rematch', ra.table && ra.again);
  await shot(ann, 'ranked-result'); await shot(bo, 'ranked-result-phone');
  const db = await sql(`select u.email, r.elo, r.played from public.ratings r join auth.users u on u.id = r.user_id order by r.elo desc`);
  ok('the database agrees: 1020 and 980, one match each', db.length === 2 && db[0].elo === 1020 && db[1].elo === 980 && db.every(x => x.played === 1), JSON.stringify(db));
  ok('no script errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  for (const p of [ann, bo]) await p.context().close();
  await sql(`delete from auth.users where email like '%@ranked.test'`);
  await b.close(); site.close(); gw.server.close(); await gw.pool.end();
  console.log(R.join('\n')); console.log(`\n${R.length - fails} passed, ${fails} failed`); process.exit(fails ? 1 : 0);
})().catch(e => { console.log(R.join('\n')); console.error('\nSTOPPED:', e.message); process.exit(1); });
