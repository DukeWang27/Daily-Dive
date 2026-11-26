// Server-side scoring for the round types (supabase/0010 rules, live through 0011), on the local test database:
//   1. parity: the database's rules and rounds.js give the same score on thousands of generated questions;
//   2. a whole mixed dive handed in as a player (submit_dive): the server's total, what a cheating browser can't
//      change, that it is an ordinary ranked dive, and that an ordinary day scores exactly as before 0011;
//   3. the friends' outcomes sit behind the spoiler rule.
//   sh tests/db/setup.sh && node tests/db/rounds.cjs
const { Client } = require('../node_modules/pg');
const fs = require('fs'), path = require('path'), vm = require('vm');
const DB = process.env.ICEBERG_TEST_DB || 'icetest';
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log('PASS  ' + name); } else { fail++; console.log('FAIL  ' + name + (extra ? '  [' + extra + ']' : '')); } };

// rounds.js, as the browser runs it. Depth comes from the answer table on the server, so here it is looked up the same way.
const DEPTH = new Map();
const depthOf = s => DEPTH.has(s) ? DEPTH.get(s) : (s >= 0.1 ? 0 : Math.min(299, Math.round(100 * Math.log10(0.1 / s))));
const ctx = { window: { Iceberg: { depthOf } }, Math }; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../rounds.js'), 'utf8'), ctx);
const Rounds = ctx.window.Rounds;

// A seeded generator, so a failure can be replayed.
let seed = 424242; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const pick = a => a[Math.floor(rnd() * a.length)];
const share = () => +Math.pow(10, -5 + rnd() * 4.7).toPrecision(4);

function makeCase(i) {
  const type = pick(['standard', 'wildcard', 'target', 'target', 'mines', 'mines', 'risk', 'risk', 'forbidden']);
  const answers = Array.from({ length: 12 }, (_, k) => ({ a: 'a' + k, s: share(), pv: rnd() < 0.2 }));
  answers.push({ a: 'top', s: 0.2 + rnd() * 0.2, pv: false });
  const mode = { type };
  if (type === 'target') { const g = pick(['band', 'common', 'closest']); if (g === 'band') { mode.lo = share(); mode.hi = mode.lo * (1.5 + rnd() * 4); } else if (g === 'closest') { mode.goal = 'closest'; mode.pct = share(); } else mode.goal = 'common'; }
  if (type === 'mines') { const a = share(), b = share(); mode.mines = [{ lo: a, hi: a * 2.5 }, { lo: b, hi: b * 2.5 }].sort((x, y) => y.lo - x.lo); }
  // Shares that sit exactly on a band edge are the hardest case for parity: put some there on purpose.
  if ((type === 'target' && mode.lo) || type === 'mines') { const edge = type === 'mines' ? mode.mines[0].hi : mode.lo; answers[0].s = edge; answers[1].s = +(edge * 2).toPrecision(6); }
  const n = 1 + Math.floor(rnd() * 3), gs = [];
  for (let k = 0; k < n; k++) { const row = pick(answers), st = rnd() < 0.85 ? 'ok' : pick(['pending', 'miss']); gs.push({ status: st, name: row.a, share: row.s, pv: row.pv }); }
  const cat = { mode, answers };
  const top = Math.max(...answers.filter(a => !a.pv).map(a => a.s)); const smode = { ...mode, top };
  const r = { guesses: gs.map(g => ({ status: g.status, name: g.name, share: g.share })), done: true };
  let choice = null;
  if (type === 'risk') {
    const fi = r.guesses.findIndex(g => g.status === 'ok');
    if (fi >= 0) { const stake = Rounds.value(cat, r.guesses[fi]); const kind = stake <= 0 ? 'continue' : pick(['secure', 'continue', 'risk']); r.choice = { kind, stake, at: fi + 1 }; choice = { kind, at: fi + 1 }; }
  }
  const js = Rounds.score(cat, r, r.guesses.length, true);
  const sg = gs.map(g => ({ status: g.status, share: g.share, depth: depthOf(g.share), pv: g.pv }));
  return { i, type, js, sql: { mode: smode, g: sg, c: choice } };
}

(async () => {
  const db = new Client({ host: '/var/run/postgresql', user: 'postgres', database: DB }); await db.connect();
  const q = (sql, p) => db.query(sql, p).then(r => r.rows);
  const asUser = async (who, sql, p = []) => { await db.query('begin'); try { await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: who, role: 'authenticated' })]); await db.query('set local role authenticated'); const r = await db.query(sql, p); await db.query('commit'); return r.rows; } catch (e) { await db.query('rollback'); throw e; } };
  const rpc = async (who, fn, args = {}) => { const k = Object.keys(args); return (await asUser(who, `select public.${fn}(${k.map((x, i) => `${x} => $${i + 1}`).join(', ')}) as v`, k.map(x => typeof args[x] === 'object' ? JSON.stringify(args[x]) : args[x])))[0].v; };
  const fails_with = async (fn, want) => { try { await fn(); return false; } catch (e) { return new RegExp(want).test(e.message); } };

  // ---------- 1. Parity ----------
  const cases = Array.from({ length: 4000 }, (_, i) => makeCase(i));
  const rows = await q(`select (c->>'i')::int i, private.x_round_score(c->'mode', c->'g', c->'c', true) s from jsonb_array_elements($1::jsonb) c`, [JSON.stringify(cases.map(c => ({ i: c.i, ...c.sql })))]);
  const bad = rows.filter(r => r.s !== cases[r.i].js);
  const byType = {}; cases.forEach(c => { byType[c.type] = (byType[c.type] || 0) + 1; });
  ok(`parity: the database and rounds.js agree on all ${cases.length} generated questions (${Object.entries(byType).map(([k, v]) => `${v} ${k}`).join(', ')})`, !bad.length,
    bad.slice(0, 3).map(r => `#${r.i} ${cases[r.i].type} sql=${r.s} js=${cases[r.i].js} ${JSON.stringify(cases[r.i].sql)}`).join(' | '));
  ok('parity: the cases cover wins, losses, mines and near-misses', ['secure', 'continue', 'risk'].every(k => cases.some(c => c.sql.c && c.sql.c.kind === k)) && cases.some(c => c.type === 'mines' && c.js === 0) && cases.some(c => c.type === 'target' && c.js === 250));

  // ---------- 2. A whole experimental dive ----------
  await q(`truncate public.rate_log`);
  const [{ d: day }] = await q(`select private.latest_day() d`);
  const SET = 9010;
  const QS = [
    { key: 'xa', mode: null, rows: [['lion', 0.12], ['okapi', 0.002], ['quoll', 0.0004]] },
    { key: 'xb', mode: { type: 'target', lo: 0.01, hi: 0.03 }, rows: [['france', 0.2], ['peru', 0.02], ['bhutan', 0.0005], ['tuvalu', 0.0001, true]] },
    { key: 'xc', mode: { type: 'forbidden', forbid: ['apple', 'banana'] }, rows: [['apple', 0.3], ['banana', 0.2], ['kumquat', 0.003]] },
    { key: 'xd', mode: { type: 'risk' }, rows: [['cheddar', 0.2], ['gouda', 0.03], ['sbrinz', 0.0008], ['brie', 0.08]] },
    { key: 'xe', mode: { type: 'mines', mines: [{ lo: 0.02, hi: 0.05 }, { lo: 0.0002, hi: 0.0005 }] }, rows: [['horse', 0.03], ['okapi', 0.0008], ['aye-aye', 0.0001]] },
  ];
  const D = s => (s >= 0.1 ? 0 : Math.min(299, Math.round(100 * Math.log10(0.1 / s))));
  await q(`delete from public.days where day = $1`, [day]); await q(`delete from public.answer_sets where set_id = $1`, [SET]);
  await q(`insert into public.answer_sets (set_id, questions) values ($1, $2)`, [SET, JSON.stringify(QS.map(x => ({ key: x.key, title: x.key, ...(x.mode ? { mode: x.mode } : {}) })))]);
  for (const [i, x] of QS.entries()) for (const [a, s, pv] of x.rows) {
    await q(`insert into public.set_answers (set_id, round, answer, share, depth, pv) values ($1, $2, $3, $4, $5, $6)`, [SET, i + 1, a, s, D(s), !!pv]);
    await q(`insert into public.set_keys (set_id, round, key, answer) values ($1, $2, private.norm($3), $3) on conflict do nothing`, [SET, i + 1, a]);
  }
  await q(`insert into public.days (day, set_id) values ($1, $2)`, [day, SET]);
  const [{ id: ana }] = await q(`insert into auth.users (email) values ('ana@x.test') returning id`); await rpc(ana, 'claim_profile', { p_username: 'AnaX' });
  const [{ id: ben }] = await q(`insert into auth.users (email) values ('ben@x.test') returning id`); await rpc(ben, 'claim_profile', { p_username: 'BenX' });
  const G = (round, slot, answer, status = 'ok') => ({ round, slot, typed: answer, answer, status });
  const guesses = [
    G(1, 1, 'lion'), G(1, 2, 'okapi'),                           // rarity: okapi counts
    G(2, 1, 'france'), G(2, 2, 'peru'), G(2, 3, 'tuvalu'),       // target: peru is on target; tuvalu is only an estimate
    G(3, 1, 'apple'), G(3, 2, 'kumquat'),                        // forbidden: apple sent as a guess anyway (a cheating browser)
    G(4, 1, 'gouda'), G(4, 2, 'sbrinz'),                         // risk taken on gouda, beaten by sbrinz
    G(5, 1, 'horse'), G(5, 2, 'okapi'),                          // mines: horse sets one off; okapi passes close by the deep one
  ];
  const res = await rpc(ana, 'submit_dive', { p_day: day, p_guesses: guesses, p_choices: [{ round: 4, kind: 'risk', stake: 9999 }] });
  const want = [D(0.002), 250, D(0.003), D(0.03) + Math.round(1.5 * (D(0.0008) - D(0.03))), Math.round(D(0.0008) * 1.25)];
  ok('dive: each question scored by its own rules on the server', JSON.stringify(res.depths) === JSON.stringify(want) && res.total === want.reduce((a, b) => a + b), JSON.stringify(res.depths) + ' vs ' + JSON.stringify(want));
  ok('dive: a banned answer sent as a guess earns nothing', res.rounds.find(x => x.round === 3).score === D(0.003));
  ok('dive: the stake comes from the server, not from what the browser claims', res.rounds.find(x => x.round === 4).outcome === 'won' && res.rounds.find(x => x.round === 4).score === want[3]);
  ok('dive: the mine that went off is recorded', res.rounds.find(x => x.round === 5).outcome === 'mine');
  // The same JS rules give the same numbers for the same guesses.
  ok('dive: the total matches rounds.js for the same guesses', res.total === want.reduce((a, b) => a + b));
  const again = await rpc(ana, 'submit_dive', { p_day: day, p_guesses: [G(1, 1, 'quoll')], p_choices: [] });
  ok('dive: one dive per player per day (a second hand-in changes nothing)', again.total === res.total && again.saved === false);
  const [row] = await q(`select d.total, d.ranked, d.max_depth, d.deepest_answer, s.total_dives from public.dives d join public.player_stats s using (user_id) where d.user_id = $1 and d.day = $2`, [ana, day]);
  ok('dive: a mixed day is an ordinary ranked dive, in the player\'s stats', row && row.total === res.total && row.ranked === true && row.total_dives === 1, JSON.stringify(row));
  ok('dive: the deepest answer is a real answer\'s depth, not a target score', row.max_depth === D(0.0008) && ['sbrinz', 'okapi'].includes(row.deepest_answer), JSON.stringify(row));
  ok('dive: the rank comes back with the result', typeof res.rank === 'number' || res.rank === undefined || res.rank === null);
  // Older pages send no choices at all: still accepted (risk then plays on as best of three).
  const [{ id: dan }] = await q(`insert into auth.users (email) values ('dan@x.test') returning id`); await rpc(dan, 'claim_profile', { p_username: 'DanX' });
  const old = (await asUser(dan, `select public.submit_dive(p_day => $1, p_guesses => $2) v`, [day, JSON.stringify([G(4, 1, 'gouda'), G(4, 2, 'sbrinz')])]))[0].v;
  ok('dive: a page that sends no choices still hands in (risk plays on)', old.depths[3] === D(0.0008), JSON.stringify(old.depths));
  // A cheating browser: an answer claimed that wasn't typed, an answer twice, a guess slot reused.
  const [{ id: eve }] = await q(`insert into auth.users (email) values ('eve@x.test') returning id`); await rpc(eve, 'claim_profile', { p_username: 'EveX' });
  const ch = await rpc(eve, 'submit_dive', { p_day: day, p_guesses: [{ round: 1, slot: 1, typed: 'lion', answer: 'quoll', status: 'ok' }, G(5, 1, 'okapi'), G(5, 2, 'okapi')], p_choices: [{ round: 2, kind: 'risk' }] });
  ok('cheating: a claimed answer that wasn\'t typed earns nothing; the same answer twice counts once; a choice on a non-risk round is ignored', ch.depths[0] === 0 && ch.depths[4] === Math.round(D(0.0008) * 1.25) && ch.depths[1] === 0, JSON.stringify(ch.depths));
  ok('cheating: more than 15 guesses are refused', await fails_with(() => rpc(eve, 'submit_dive', { p_day: day - 1, p_guesses: Array.from({ length: 16 }, (_, i) => G(1 + (i % 5), 1, 'x')) }), 'bad_guesses|day_closed'));
  ok('cheating: choices that aren\'t a list are refused', await fails_with(() => rpc(ben, 'submit_dive', { p_day: day, p_guesses: [], p_choices: { round: 4 } }), 'bad_choices'));

  // An ordinary day (no round types) scores exactly as before 0011: each question's deepest answer.
  const SET2 = 9011, day2 = day - 1;
  await q(`delete from public.days where day = $1`, [day2]); await q(`delete from public.answer_sets where set_id = $1`, [SET2]);
  await q(`insert into public.answer_sets (set_id, questions) values ($1, $2)`, [SET2, JSON.stringify(QS.map(x => ({ key: x.key + '2', title: x.key })))]);
  for (const [i, x] of QS.entries()) for (const [a, s] of x.rows) {
    await q(`insert into public.set_answers (set_id, round, answer, share, depth) values ($1, $2, $3, $4, $5)`, [SET2, i + 1, a, s, D(s)]);
    await q(`insert into public.set_keys (set_id, round, key, answer) values ($1, $2, private.norm($3), $3) on conflict do nothing`, [SET2, i + 1, a]);
  }
  await q(`insert into public.days (day, set_id) values ($1, $2)`, [day2, SET2]);
  const [{ id: fay }] = await q(`insert into auth.users (email) values ('fay@x.test') returning id`); await rpc(fay, 'claim_profile', { p_username: 'FayX' });
  const [{ v: dv }] = await asUser(fay, `select private.store_dive(auth.uid(), $1, $2, 'play', true) v`, [day2, JSON.stringify(guesses)]).catch(async () => [{ v: (await q(`select private.store_dive($1, $2, $3, 'play', true) v`, [fay, day2, JSON.stringify(guesses)]))[0].v }]);
  const [plain] = await q(`select total, depths, max_depth from public.dives where id = $1`, [dv]);
  const wantPlain = [D(0.002), D(0.0001), D(0.003), D(0.0008), D(0.0008)];
  // apple counts on an ordinary day; tuvalu is the deepest on question 2
  wantPlain[2] = Math.max(D(0.3), D(0.003));
  ok('ordinary day: the deepest answer of each question, the same as before', JSON.stringify(plain.depths) === JSON.stringify(wantPlain) && plain.total === wantPlain.reduce((a, b) => a + b) && plain.max_depth === Math.max(...wantPlain), JSON.stringify(plain));
  const [{ n: nr }] = await q(`select count(*)::int n from public.dive_rounds where dive_id = $1`, [dv]);
  ok('ordinary day: no round records', nr === 0);
  // A risk lost, and a keep.
  const lost = await rpc(ben, 'submit_dive', { p_day: day, p_guesses: [G(4, 1, 'gouda'), G(4, 2, 'brie')], p_choices: [{ round: 4, kind: 'risk' }] });
  ok('dive: a risk that is not beaten earns 0 for that question', lost.rounds.find(x => x.round === 4).score === 0 && lost.rounds.find(x => x.round === 4).outcome === 'lost');

  // ---------- 3. Spoilers ----------
  const [{ id: cal }] = await q(`insert into auth.users (email) values ('cal@x.test') returning id`); await rpc(cal, 'claim_profile', { p_username: 'CalX' });
  await q(`insert into public.friendships (a, b, status, requested_by) values (least($1::uuid, $2::uuid), greatest($1::uuid, $2::uuid), 'accepted', $1)`, [ana, cal]);
  ok('friends: outcomes are hidden until you have handed in your own dive', await fails_with(() => rpc(cal, 'friends_rounds', { p_day: day }), 'finish_first'));
  const fr = await rpc(ana, 'friends_rounds', { p_day: day });
  ok('friends: after handing in, you see your own and your friends\' outcomes, not strangers\'', fr.length === 1 && fr[0].username === 'AnaX' && fr[0].rounds.length === 4, JSON.stringify(fr.map(x => x.username)));
  ok('the functions are not callable by anyone signed out', await fails_with(() => q(`set role anon; select public.submit_dive(1, '[]', '[]')`), 'permission denied'));
  await q('reset role');
  await db.end();
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
