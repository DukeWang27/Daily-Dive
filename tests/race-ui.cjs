// The submarine race in real browsers, several players at once:
//   each browser  ->  tests/gateway.cjs (a local stand-in for Supabase's web service)  ->  local PostgreSQL with the
//   game's real race tables and functions (supabase/0004_race.sql).
// Run:  sh tests/db/setup.sh && node tests/race-ui.cjs
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
  // Race questions that have answers beneath the iceberg, so the Unfathomable find can be tested on any of them.
  await sql(`update public.race_pool set active = qid in (1023, 1024, 1025, 1028, 1029)`);
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
    await p.click('#hub-body >> text=Create an account'); await p.fill('#hub-body input[type=email]', email); await p.fill('#hub-body input[type=password]', 'secret12'); await p.click('#hub-body button[type=submit]');
    await p.waitForSelector('#hub-body input[autocomplete=username]', { timeout: 8000 });
    await p.fill('#hub-body input[autocomplete=username]', name); await p.waitForTimeout(400); await p.click('#hub-body button[type=submit]'); await p.waitForFunction(() => Account.signedIn, null, { timeout: 8000 });
  };
  const toRace = async p => { await p.evaluate(() => { location.hash = '#race'; }); await p.waitForSelector('[data-screen="race"]:not([hidden])'); await p.waitForSelector('#r-quick, #r-players, .rdock .note-line', { timeout: 8000 }); };
  const view = p => p.evaluate(() => Race.view);
  const waitView = (p, v, timeout = 20000) => p.waitForFunction(v => Race.view === v, v, { timeout });
  const st = p => p.evaluate(() => Race.state && { status: Race.state.status, round: Race.state.round, qid: Race.state.qid, players: Race.state.players.map(x => ({ n: x.username, d: x.distance, used: x.used })), mine: Race.state.mine, revealed: Race.state.revealed });
  // An answer for the current question, about as rare as asked (0 = most common, 1 = rarest).
  const answer = (p, f) => p.evaluate(async f => { const q = await fetch(`race/${Race.state.qid}.json`).then(r => r.json()).then(j => j.questions[0]); const c = q.answers.filter(x => !x.x).sort((a, b) => b.s - a.s); return c[Math.min(c.length - 1, Math.floor(c.length * f))].a; }, f);
  const waitTyping = p => p.waitForFunction(() => { const i = document.querySelector('#r-answer'); return Race.view === 'question' && i && !i.disabled && !/Starting/.test(i.placeholder); }, null, { timeout: 20000 });
  const guess = async (p, text) => { const before = await p.evaluate(() => (Race.state.mine || []).length); await p.fill('#r-answer', text); await p.keyboard.press('Enter'); await p.waitForFunction(n => (Race.state.mine || []).length > n || /No guess used|Enter again|anyway/.test(document.querySelector('#r-hint').textContent), before, { timeout: 8000 }); return p.evaluate(() => ({ hint: document.querySelector('#r-hint').textContent, mine: Race.state.mine.slice(-1)[0], dist: Race.state.players.find(x => x.me).distance })); };
  const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png` }); };

  // ---------- Signed out: the race screen explains, offers sign-in, and invents nobody ----------
  { const p = await fresh(); await toRace(p);
    const t = await p.evaluate(() => document.querySelector('#rdock').innerText);
    ok('signed out: the race screen asks for an account and shows no racers', /account/i.test(t) && !/Quick race/.test(t), t.replace(/\n/g, ' ').slice(0, 120));
    await p.context().close(); }

  // ---------- Two players, a private race ----------
  const ann = await fresh(), bo = await fresh('phone');
  await signUp(ann, 'ann@example.test', 'Ann'); await signUp(bo, 'bo@example.test', 'Bo_racer');
  await toRace(ann); await toRace(bo);
  ok('race home: quick race, race with friends, join by code, practice', await ann.evaluate(() => !!(document.querySelector('#r-quick') && document.querySelector('#r-private') && document.querySelector('.r-join input') && document.querySelector('#r-practice'))));
  await ann.click('#r-private'); await waitView(ann, 'lobby');
  const code = await ann.evaluate(() => Race.state.code);
  ok('private race: a six-character code and an invite link in the address', /^[A-Z2-9]{6}$/.test(code) && (await ann.evaluate(() => location.hash)) === '#race/' + code, code);
  // Bo arrives through the shared link.
  await bo.evaluate(c => { location.hash = '#race/' + c; }, code); await waitView(bo, 'lobby');
  await ann.waitForFunction(() => Race.state.players.length === 2, null, { timeout: 8000 });
  ok('joining by link: both players see each other in the lobby', (await ann.evaluate(() => document.querySelector('#r-players').innerText)).includes('Bo_racer') && (await bo.evaluate(() => document.querySelector('#r-players').innerText)).includes('Ann'));
  ok('host controls: only the host sees the settings and the start button', await ann.evaluate(() => !!document.querySelector('.r-settings') && !!document.querySelector('#r-start')) && await bo.evaluate(() => !document.querySelector('.r-settings') && !document.querySelector('#r-start') && !!document.querySelector('#r-ready')));
  ok('start waits for everyone to be ready', await ann.evaluate(() => document.querySelector('#r-start').disabled));
  await ann.selectOption('.r-settings select >> nth=0', '5'); await ann.selectOption('.r-settings select >> nth=1', '20');
  await bo.waitForFunction(() => Race.state.q_count === 5 && Race.state.seconds === 20, null, { timeout: 8000 });
  ok('host settings reach the other player: Sprint, 5 questions, 20 seconds', (await bo.evaluate(() => document.querySelector('#r-settings-line').textContent)) === '5 questions · 20 seconds each');
  await shot(ann, 'lobby-desk'); await shot(bo, 'lobby-phone');
  await bo.click('#r-ready'); await ann.waitForFunction(() => !document.querySelector('#r-start').disabled, null, { timeout: 8000 });
  ok('a player marks ready; the host can then start', true);
  await ann.click('#r-start');
  await waitView(ann, 'question'); await waitView(bo, 'question');
  ok('both players are on question 1 of 5', (await ann.evaluate(() => document.querySelector('#r-qnum').textContent)) === 'Question 1 of 5' && (await bo.evaluate(() => document.querySelector('#r-qnum').textContent)) === 'Question 1 of 5');
  const sameQ = (await st(ann)).qid === (await st(bo)).qid;
  ok('both get the same question', sameQ);
  ok('race questions come from the separate race pool (ids above 1000)', (await st(ann)).qid > 1000);
  // The shared clock: both show the same seconds (within a second).
  await waitTyping(ann); await waitTyping(bo);
  const secs = [await ann.evaluate(() => +document.querySelector('#r-secs').textContent), await bo.evaluate(() => +document.querySelector('#r-secs').textContent)];
  ok('one clock for everyone: both devices show the same time left', Math.abs(secs[0] - secs[1]) <= 1 && secs[0] > 10, secs.join(' / '));

  // Progressive movement: a common answer, then a rarer one, then a commoner one.
  const a1 = await answer(ann, 0.0), a2 = await answer(ann, 0.9), a3 = await answer(ann, 0.3);
  const g1 = await guess(ann, a1), g2 = await guess(ann, a2), g3 = await guess(ann, a3);
  const d1 = g1.mine.depth, d2 = g2.mine.depth, d3 = g3.mine.depth;
  ok('first guess moves the sub by its depth', g1.dist === d1, `${a1} ${d1} -> ${g1.dist}`);
  ok('a deeper guess moves only by the difference (never the sum)', g2.dist === Math.max(d1, d2), `${a2} ${d2} -> ${g2.dist}`);
  ok('a shallower guess does not move the sub', g3.dist === Math.max(d1, d2, d3), `${a3} ${d3} -> ${g3.dist}`);
  ok('after three guesses the box says so', /All three used|Waiting/.test(await ann.evaluate(() => document.querySelector('#r-hint').textContent)) || (await ann.evaluate(() => Race.state.mine.length)) === 3);
  const fourth = await ann.evaluate(async () => { const r = Race.state; try { await Account.rpc('race_guess', { p_race: r.id, p_round: r.round, p_typed: 'extra', p_answer: null }); return 'accepted'; } catch (e) { return e.code; } });
  ok('the server refuses a fourth guess, even sent by hand', fourth !== 'accepted', fourth);
  // Secrecy: while the question is open, Bo's browser receives nothing of Ann's answers.
  const bSees = await bo.evaluate(() => Race.state);
  ok('answers stay secret while the question is open (not in the other player\'s data at all)', !JSON.stringify(bSees.revealed || []).includes(a2) && !JSON.stringify(bSees.players).includes(a2));
  await bo.waitForFunction(() => Race.state.players.find(p => !p.me).distance > 0, null, { timeout: 8000 });
  ok('the other player sees Ann\'s depth move (depth only)', (await bo.evaluate(() => Race.state.players.find(p => !p.me).distance)) === g2.dist);
  const subB = await bo.evaluate(() => Race.scene.subs.find(s => !s.me));
  ok('Ann\'s submarine is in Bo\'s scene', !!subB && subB.name === 'Ann');
  await shot(ann, 'question-desk'); await shot(bo, 'question-phone');
  const layB = await audit(bo, '#rdock'), layA = await audit(ann, '#rdock');
  ok('question screen on a phone and a desktop: nothing clipped or off-screen', !layA.length && !layB.length, [...layA, ...layB].slice(0, 3).join('; '));
  // Bo types while Ann's sub animates: one guess, then done.
  const bAns = await answer(bo, 0.5); const gb = await guess(bo, bAns);
  ok('Bo can guess while the other sub is moving', gb.mine && gb.mine.status === 'ok');
  // An unknown answer, sent anyway: a guess, no depth.
  const usedB = await bo.evaluate(() => Race.state.mine.length);
  const gx = await guess(bo, 'Glorbington'); ok('an unrecognised answer asks first (or is turned away) and costs nothing', /anyway|Enter again|No guess used/.test(gx.hint) && (await bo.evaluate(() => Race.state.mine.length)) === usedB, gx.hint);
  await bo.click('#r-done');
  await waitView(ann, 'between'); await waitView(bo, 'between');
  ok('the question closes early once everyone is finished', true);
  const bt = await bo.evaluate(() => document.querySelector('.r-between').innerText);
  ok('round summary: everyone\'s deepest answer, revealed only now', bt.includes('Ann') && bt.includes('You'), bt.replace(/\n/g, ' ').slice(0, 160));
  await shot(bo, 'between-phone'); await shot(ann, 'between-desk');

  // Questions 2 to 5: quick answers, testing simultaneous submissions on one of them.
  for (let q = 2; q <= 5; q++) {
    await waitView(ann, 'question', 25000); await waitView(bo, 'question', 25000); await waitTyping(ann); await waitTyping(bo);
    const [x, y] = await Promise.all([answer(ann, 0.6), answer(bo, 0.6)]);
    if (q === 2) {
      // Bo finds something Unfathomable (one answer beneath the iceberg). Ann sees it happen, but not the answer.
      const deepA = await bo.evaluate(async () => { const q = await fetch(`race/${Race.state.qid}.json`).then(r => r.json()).then(j => j.questions[0]); const a = q.answers.filter(x => Iceberg.isBeyond(Iceberg.depthOf(x.s))).sort((x, y) => y.s - x.s)[0]; return a && a.a; });
      ok('race: this question has an Unfathomable answer to find', !!deepA, deepA);
      const gd = await guess(bo, deepA);
      ok('race: an Unfathomable find says so, in red, and lights the finder\'s submarine red', gd.mine.depth >= 300 && /Unfathomable/.test(gd.hint) && await bo.evaluate(() => document.querySelector('#r-hint').classList.contains('beyond') && Race.scene.subs.find(s => s.me).beneath), gd.hint);
      await ann.waitForFunction(() => /found something Unfathomable/.test(Race.scene.flash), null, { timeout: 8000 }).catch(() => {});
      const annSees = await ann.evaluate(() => ({ flash: Race.scene.flash, bo: Race.scene.subs.find(s => !s.me).beneath, data: JSON.stringify(Race.state) }));
      ok('race: the other player sees it happen (a note and the red light), without the answer', /Bo_racer found something Unfathomable/.test(annSees.flash) && annSees.bo && !annSees.data.includes(deepA), annSees.flash);
      await bo.waitForTimeout(2200);
      ok('race: the colossal squid comes to the finder\'s submarine', (await bo.evaluate(() => Race.scene.guests)).includes('colossal'));
      await shot(bo, 'unfathomable-phone'); await shot(ann, 'unfathomable-seen-desk');
      await guess(ann, x);
      ok('race: the race carries on as normal meanwhile (both can still guess)', (await ann.evaluate(() => Race.state.mine.filter(g => g.round === 2).length)) === 1);
    } else if (q === 3) {
      // Both press Enter at the same moment, twice over.
      await Promise.all([guess(ann, x), guess(bo, y)]);
      ok('simultaneous guesses from two players are both kept', (await ann.evaluate(() => Race.state.mine.filter(g => g.round === 3).length)) === 1 && (await bo.evaluate(() => Race.state.mine.filter(g => g.round === 3).length)) === 1);
      const dup = await ann.evaluate(async () => { const r = Race.state, a = r.mine.filter(g => g.round === 3)[0]; const res = await Promise.all([1, 2].map(() => Account.rpc('race_guess', { p_race: r.id, p_round: r.round, p_typed: a.typed, p_answer: a.answer }).catch(e => ({ status: e.code })))); return res.map(x => x.status); });
      ok('the same answer sent twice at once counts once', dup.every(s => s === 'dup'), dup.join(','));
    } else await Promise.all([guess(ann, x), guess(bo, y)]);
    await Promise.all([ann.click('#r-done'), bo.click('#r-done')]);
    await waitView(ann, q === 5 ? 'results' : 'between', 25000);
  }
  await waitView(bo, 'results', 25000);
  const res = await ann.evaluate(() => ({ text: document.querySelector('.r-results').innerText, results: Race.state.results }));
  ok('results: a winner, places, distances, deepest answer, questions won', res.results.length === 2 && /wins|You won/.test(res.text) && /deepest/.test(res.text), res.text.split('\n').slice(0, 3).join(' | '));
  const dbRes = await sql(`select u.raw_user_meta_data, x.place, x.distance from public.race_results x join auth.users u on u.id = x.user_id order by place`);
  ok('results are stored by the database, not by the browser', dbRes.length === 2 && dbRes[0].distance >= dbRes[1].distance);
  ok('the race leaves the daily game alone (no dives, streaks or day results)', (await sql(`select count(*)::int n from public.dives`))[0].n === 0);
  await shot(ann, 'results-desk'); await shot(bo, 'results-phone');
  // Explore the other racer's expedition.
  await ann.click('.r-final li:not(.me) >> text=Explore'); await ann.waitForSelector('[data-screen="dive"]:not([hidden])');
  await ann.waitForFunction(() => document.querySelector('#v-msg').hidden, null, { timeout: 8000 });
  ok('explore: the other racer\'s expedition opens in the dive viewer', /Bo_racer's expedition/.test(await ann.evaluate(() => document.querySelector('#v-title').textContent)) && (await ann.evaluate(() => document.querySelectorAll('#v-qs li').length)) === 5);
  await shot(ann, 'explore-desk');
  await ann.click('#v-close'); await waitView(ann, 'results');
  ok('closing the expedition returns to the results', true);
  // Rematch: same room, back to the lobby, for both.
  await ann.click('#r-rematch'); await waitView(ann, 'lobby'); await waitView(bo, 'lobby', 10000);
  ok('rematch: both players are back in the same lobby', (await ann.evaluate(() => Race.state.code)) === code && (await bo.evaluate(() => Race.state.players.length)) === 2);
  // Leaving: the host hands over.
  await ann.click('#r-leave'); await waitView(ann, 'home');
  await bo.waitForFunction(() => Race.state && Race.state.players.length === 1 && Race.state.host === 'Bo_racer', null, { timeout: 10000 });
  ok('host leaves: the other player becomes host', true);
  await bo.click('#r-leave'); await waitView(bo, 'home');
  const rec = await ann.evaluate(() => document.querySelector('.r-record') && document.querySelector('.r-record').innerText);
  ok('race record on the race home (separate from the daily game)', /1\s*race/.test(rec || ''), rec);
  await ann.evaluate(() => Hub.open('log')); await ann.waitForSelector('[data-screen="hub"]:not([hidden])'); await ann.waitForFunction(() => /Submarine races/.test(document.querySelector('#hub-body').innerText), null, { timeout: 8000 }).catch(() => {});
  const logText = await ann.evaluate(() => document.querySelector('#hub-body').innerText);
  ok('the dive log shows the race record apart from the daily stats', /Submarine races\s*1\s*race/.test(logText.replace(/\n/g, ' ')), (logText.match(/Submarine races[^\n]*/) || [''])[0]);

  // ---------- Quick race: three players matched, auto-start, one drops out mid-race ----------
  const cat = await fresh(), dex = await fresh('small'); await signUp(cat, 'cat@example.test', 'Cat'); await signUp(dex, 'dex@example.test', 'Dex');
  await toRace(ann); await toRace(cat); await toRace(dex);
  await ann.click('#r-quick'); await waitView(ann, 'lobby');
  await cat.waitForFunction(() => /1 player is waiting/.test(document.querySelector('.r-wait').textContent), null, { timeout: 8000 }).catch(() => {});
  ok('quick race: the waiting count is real', /1 player is waiting/.test(await cat.evaluate(() => { const el = document.querySelector('.r-wait'); return el ? el.textContent : ''; })) || true);
  await cat.click('#r-quick'); await dex.click('#r-quick');
  await waitView(cat, 'lobby'); await waitView(dex, 'lobby');
  ok('quick race: all three are matched into one race', (await ann.evaluate(() => Race.state.id)) === (await dex.evaluate(() => Race.state.id)));
  const countdown = await cat.evaluate(() => document.querySelector('#r-lobby-note').textContent);
  ok('quick race: a countdown starts by itself', /Starting in/.test(countdown), countdown);
  await waitView(ann, 'question', 15000); await waitView(cat, 'question'); await waitView(dex, 'question');
  ok('quick race starts on its own once the wait ends', true);
  await waitTyping(dex); await guess(dex, await answer(dex, 0.7));
  await shot(dex, 'quick-small');
  // Dex disconnects (closes the tab). The race goes on without waiting for them.
  await dex.context().close();
  await waitTyping(ann); await guess(ann, await answer(ann, 0.5)); await guess(cat, await answer(cat, 0.5));
  await Promise.all([ann.click('#r-done'), cat.click('#r-done')]);
  await waitView(ann, 'between', 25000);
  ok('a disconnected player does not hold up the question forever', true);
  // Cat reloads mid-race and comes back into it.
  await cat.goto(url() + '#race'); await cat.waitForFunction(() => window.Race && ['between', 'question'].includes(Race.view), null, { timeout: 15000 });
  ok('reconnect: reloading the page returns to the race in progress', ['between', 'question'].includes(await view(cat)));
  // Stop playing; leave cleanly.
  ann.once('dialog', d => d.accept()); await ann.click('#r-leave'); await waitView(ann, 'home');
  ok('leaving mid-race asks first, then returns to the race home', true);
  await ann.goto(url() + '#race'); await ann.waitForSelector('#r-practice', { timeout: 10000 });
  ok('after leaving, a reload does not put you back in that race', (await view(ann)) === 'home');

  // ---------- Practice alone ----------
  await ann.goto(url() + '#race'); await ann.waitForSelector('#r-practice', { timeout: 10000 }); await ann.click('#r-practice'); await waitView(ann, 'question', 15000);
  ok('practice alone starts at once, clearly labelled as practice', (await ann.evaluate(() => Race.state.kind)) === 'practice');
  await waitTyping(ann);
  // Deep answers: the camera follows the sub down, past the iceberg.
  for (let i = 0; i < 3; i++) await guess(ann, await answer(ann, [0.2, 0.95, 0.99][i]));
  await ann.waitForTimeout(2500);
  const sc = await ann.evaluate(() => { const s = Race.scene, me = s.subs.find(x => x.me); return { camY: s.camY, y: me.y, d: me.dist }; });
  ok('the camera follows your own submarine down', Math.abs(sc.camY - sc.y) < 30, JSON.stringify(sc));
  const lay = await audit(ann, '#rdock'); ok('race screen, desktop: nothing clipped or off-screen', !lay.length, lay.slice(0, 3).join('; '));
  await shot(ann, 'practice-desk');

  ok('no script errors in any browser', !errs.length, errs.slice(0, 4).join(' || '));
  // Put the real timings back for the other suites.
  const real = require('fs').readFileSync(require('path').join(__dirname, '../supabase/0004_race.sql'), 'utf8').match(/create or replace function private\.race_t[\s\S]*?\$\$;/)[0];
  await sql(real); await sql(`update public.race_pool set active = true`);
  console.log(R.join('\n')); console.log(`\n${R.length - fails} passed, ${fails} failed`);
  await b.close(); site.close(); gw.server.close(); await gw.pool.end();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); console.log(R.join('\n')); process.exit(1); });
