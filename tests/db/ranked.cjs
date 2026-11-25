// Ranked 1v1, checked on a real PostgreSQL database with every call made as a signed-in player would make it:
// matchmaking (including two players searching at the same moment), Elo, settling exactly once, forfeits, answers
// still under review, the win-trading cap, no rematches, and that nobody can call the settlement directly.
//   sh tests/db/setup.sh && psql -U postgres -d icetest -f supabase/0007_intelligence.sql -f supabase/0008_ranked.sql && node tests/db/ranked.cjs
const { Client, Pool } = require('../node_modules/pg');
const DB = process.env.ICEBERG_TEST_DB || 'icetest';
const R = []; let fails = 0;
const ok = (name, cond, extra = '') => { R.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  [' + extra + ']' : ''}`); if (!cond) fails++; };


(async () => {
  const db = new Client({ host: '/var/run/postgresql', user: 'postgres', database: DB }); await db.connect();
  const pool = new Pool({ host: '/var/run/postgresql', user: 'postgres', database: DB, max: 12 });
  const admin = (sql, p) => db.query(sql, p).then(r => r.rows);
  const asUser = async (client, who, sql, p = []) => {
    await client.query('begin');
    try { await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: who, role: 'authenticated' })]); await client.query('set local role authenticated'); const r = await client.query(sql, p); await client.query('commit'); return r.rows; }
    catch (e) { await client.query('rollback'); throw e; }
  };
  const rpcOn = async (client, who, fn, args = {}) => { const k = Object.keys(args); const rows = await asUser(client, who, `select public.${fn}(${k.map((x, i) => `${x} => $${i + 1}`).join(', ')}) as v`, k.map(x => args[x])); return rows[0].v; };
  const rpc = (who, fn, args) => rpcOn(db, who, fn, args);
  const fails_with = async (fn, want) => { try { await fn(); return false; } catch (e) { return new RegExp(want).test(e.message); } };
  const user = async name => { const [u] = await admin(`insert into auth.users (email) values ($1) returning id`, [name.toLowerCase() + '@race.test']); await rpc(u.id, 'claim_profile', { p_username: name }); return u.id; };
  const st = (who, race) => rpc(who, 'race_state', { p_race: race });
  const answers = async qid => admin(`select answer, depth from public.set_answers where set_id = $1 order by depth, answer`, [qid]);
  const open = race => admin(`update public.races set round_start = now() - interval '1 second' where id = $1`, [race]);
  const finishRace = async race => { for (let i = 0; i < 14; i++) { await admin(`update public.races set round_start = now() - interval '30 seconds', round_end = now() - interval '5 seconds', between_until = now() - interval '1 second' where id = $1`, [race]); await admin(`select private.race_tick($1)`, [race]); } };
  await admin(`truncate auth.users cascade`); await admin(`delete from public.races`); await admin(`truncate public.rate_log, public.username_holds`);
  const ids = []; for (const n of ['Rae', 'Sol', 'Tam', 'Uma', 'Val', 'Wes']) ids.push(await user(n));
  const [rae, sol, tam, uma, val, wes] = ids;
  const pool2 = await admin(`select count(*)::int n from public.race_pool where ranked`);
  ok('ranked pool: only well-covered race questions (120+ answers), never daily ones', pool2[0].n >= 5, `${pool2[0].n} ranked questions`);

  // ---------- Matchmaking ----------
  ok('signed-out visitors cannot queue', await fails_with(() => db.query(`set role anon; select public.ranked_find(); reset role;`), 'permission denied|sign_in'));
  await db.query('reset role');
  let a = await rpc(rae, 'ranked_find');
  ok('alone in the queue: searching, with the rating range shown', a.status === 'searching' && a.range >= 100 && a.elo === 1000, JSON.stringify(a));
  const [x, y] = await Promise.all([rpcOn(pool, sol, 'ranked_find'), rpcOn(pool, tam, 'ranked_find')]);
  const matched = [x, y].filter(z => z.status === 'matched');
  const races1 = await admin(`select id, kind, q_count, seconds, max_players, array_length(questions, 1) n from public.races where kind = 'ranked'`);
  ok('three players searching at once: exactly one match is made, of two players (nobody matched twice)', races1.length === 1 && races1[0].n === 5 && races1[0].q_count === 5 && races1[0].seconds === 20, JSON.stringify(races1));
  const raceA = races1[0].id, inA = (await admin(`select user_id from public.race_players where race_id = $1`, [raceA])).map(r => r.user_id);
  ok('the match has two different players', inA.length === 2 && inA[0] !== inA[1]);
  const left = [rae, sol, tam].find(u => !inA.includes(u));
  ok('the third player stays in the queue', (await admin(`select count(*)::int n from public.ranked_queue where user_id = $1`, [left]))[0].n === 1);
  const again = await rpc(inA[0], 'ranked_find');
  ok('searching again while in a running match returns that match (a refresh or dropped connection)', again.status === "matched" && String(again.race.id) === String(raceA));
  await rpc(left, 'ranked_cancel');
  ok('cancel leaves the queue', (await admin(`select count(*)::int n from public.ranked_queue`))[0].n === 0);
  ok('ranked matches cannot be joined by code by anyone else', await fails_with(async () => rpc(uma, 'race_join', { p_code: (await admin(`select code from public.races where id = $1`, [raceA]))[0].code }), 'race_started|race_not_found'));

  // ---------- Playing and settling ----------
  await open(raceA);
  const [p1, p2] = inA;
  const q1 = (await admin(`select questions[1] q from public.races where id = $1`, [raceA]))[0].q, rows = await answers(q1);
  const deep = rows[rows.length - 1], shallow = rows[0];
  await rpc(p1, 'race_guess', { p_race: raceA, p_round: 1, p_typed: deep.answer, p_answer: deep.answer });
  await rpc(p2, 'race_guess', { p_race: raceA, p_round: 1, p_typed: shallow.answer, p_answer: shallow.answer });
  ok('settling before the end does nothing', (await rpc(p1, 'ranked_result', { p_race: raceA })).outcome === 'playing');
  ok('a player cannot call the settlement directly', await fails_with(() => rpc(p1, 'race_state', { p_race: raceA }).then(() => asUser(db, p1, 'select private.ranked_settle($1)', [raceA])), 'permission denied'));
  await finishRace(raceA);
  let res = await rpc(p1, 'ranked_result', { p_race: raceA });
  const me1 = res.players.find(p => p.me), them1 = res.players.find(p => !p.me);
  ok('finished: settled the moment it ends; the deeper player wins, Elo moves by the expected amount (K=40 while placing, equal ratings: +20 / -20)', ['rated', 'settled'].includes(res.outcome) && me1.result === 'win' && me1.delta === 20 && them1.delta === -20, JSON.stringify(res));
  await admin(`select private.ranked_settle($1)`, [raceA]); await admin(`update public.races set status = 'closed' where id = $1`, [raceA]); await admin(`update public.races set status = 'finished' where id = $1`, [raceA]);
  const hist = await admin(`select count(*)::int n from public.rating_history where race_id = $1`, [raceA]);
  const r1 = await admin(`select elo, played, wins, losses, streak, peak from public.ratings where user_id = $1`, [p1]);
  ok('settled exactly once, however often it is asked or the race row changes', hist[0].n === 2 && r1[0].elo === 1020 && r1[0].played === 1 && r1[0].wins === 1 && r1[0].streak === 1 && r1[0].peak === 1020, JSON.stringify(r1));
  ok('no rematch for ranked: queue again instead', await fails_with(() => rpc(p1, 'race_rematch', { p_race: raceA }), 'ranked_no_rematch'));

  // ---------- Forfeit ----------
  const mk = async (u1, u2) => { const qs = (await admin(`select array_agg(qid) q from (select qid from public.race_pool where ranked limit 5) x`))[0].q;
    const [r] = await admin(`insert into public.races (code, kind, q_count, seconds, max_players, status, questions, round, round_start, round_end) values (private.race_code(), 'ranked', 5, 20, 2, 'question', $1, 1, now() - interval '1 second', now() + interval '20 seconds') returning id`, [qs]);
    await admin(`insert into public.race_players (race_id, user_id, seat, ready) values ($1, $2, 0, true), ($1, $3, 1, true)`, [r.id, u1, u2]); return r.id; };
  const raceB = await mk(uma, val);
  await rpc(val, 'race_leave', { p_race: raceB }); await admin(`update public.race_players set left_at = now() - interval '2 minutes' where race_id = $1 and user_id = $2`, [raceB, val]);   // left mid-match (the test moves the clock)
  await finishRace(raceB);
  res = await rpc(uma, 'ranked_result', { p_race: raceB });
  ok('leaving a ranked match is a forfeit: the leaver loses, the other wins', res.players.find(p => p.me).result === 'win' && res.players.find(p => !p.me).result === 'loss' && res.players[0].reason === 'forfeit', JSON.stringify(res));

  // ---------- Answers still under review ----------
  const raceC = await mk(wes, uma);
  const qc = (await admin(`select questions[1] q from public.races where id = $1`, [raceC]))[0].q, rc = await answers(qc);
  await rpc(wes, 'race_guess', { p_race: raceC, p_round: 1, p_typed: rc[0].answer, p_answer: rc[0].answer });          // a shallow known answer
  await rpc(uma, 'race_guess', { p_race: raceC, p_round: 1, p_typed: 'zzzunknownzzz', p_answer: null });               // pending review
  await finishRace(raceC);
  res = await rpc(wes, 'ranked_result', { p_race: raceC });
  ok('a pending answer that could change the winner: the result waits for review', res.outcome === 'waiting', JSON.stringify(res));
  await admin(`update public.races set round_end = now() - interval '4 minutes' where id = $1`, [raceC]);
  res = await rpc(wes, 'ranked_result', { p_race: raceC });
  ok('still unresolved after three minutes: no contest, nobody\'s rating changes', res.outcome === 'unresolved' && res.players.every(p => p.result === 'void' && p.delta === 0), JSON.stringify(res));

  // ---------- Win-trading cap ----------
  for (let i = 0; i < 4; i++) { const rr = await mk(rae, wes); const qq = (await admin(`select questions[1] q from public.races where id = $1`, [rr]))[0].q, an = await answers(qq);
    await rpc(rae, 'race_guess', { p_race: rr, p_round: 1, p_typed: an[an.length - 1].answer, p_answer: an[an.length - 1].answer }); await finishRace(rr); await rpc(rae, 'ranked_result', { p_race: rr }); }
  const capped = await admin(`select result, reason from public.rating_history where user_id = $1 and opponent = $2 order by at`, [rae, wes]);
  ok('the same pair is rated at most three times a day; the fourth counts for nothing', capped.filter(c => c.result !== 'void').length === 3 && capped[3].reason === 'repeat_pair', JSON.stringify(capped));

  // ---------- Leaderboard and profile ----------
  const prof = await rpc(rae, 'ranked_profile', {});
  ok('profile: rating, peak, record, streak, placement left and history', prof.elo > 1000 && prof.played === 4 && prof.wins === 4 && prof.best_streak === 4 && prof.placement_left === 6 && prof.history.length === 4, JSON.stringify(prof).slice(0, 200));
  const board = await rpc(rae, 'ranked_board', { p_limit: 10, p_offset: 0 });
  ok('leaderboard lists only players past their ten placement matches', Array.isArray(board) && board.length === 0);
  await admin(`update public.ratings set played = 12 where user_id = $1`, [rae]);
  const board2 = await rpc(sol, 'ranked_board', { p_limit: 10, p_offset: 0 });
  ok('...and then shows them, by rating', board2.length === 1 && board2[0].username === 'Rae');
  ok('ratings can be read but not written by players', await fails_with(() => asUser(db, rae, `update public.ratings set elo = 3000 where user_id = $1`, [rae]).then(r => { if (!r.length) throw new Error('permission denied (no rows)'); }), 'permission denied|no rows'));
  const elo = (await admin(`select elo from public.ratings where user_id = $1`, [rae]))[0].elo;
  ok('...and an attempted write changes nothing', elo < 3000);

  await admin(`delete from auth.users where email like '%@race.test'`); await admin(`delete from public.races`);
  console.log(R.join('\n')); console.log(`\n${R.length - fails} passed, ${fails} failed`);
  await db.end(); await pool.end(); process.exit(fails ? 1 : 0);
})().catch(e => { console.log(R.join('\n')); console.error('\nSTOPPED:', e.message, (e.stack || '').split('\n').slice(1, 3).join(' ')); process.exit(1); });
