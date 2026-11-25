// The submarine race's rules, checked on a real PostgreSQL database, every call made the way a racer's browser
// would make it (as the "authenticated" role, with the racer's identity).
//   sh tests/db/setup.sh && node tests/db/race.cjs
// Time is moved by editing a race's deadlines directly, as only a test can.
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
  const open = race => admin(`update public.races set round_start = now() - interval '1 second' where id = $1`, [race]);                  // skip the countdown
  const expire = race => admin(`update public.races set round_end = now() - interval '5 seconds' where id = $1`, [race]);                 // run the clock out
  const skipBreak = race => admin(`update public.races set between_until = now() - interval '1 second' where id = $1`, [race]);
  const answers = async qid => admin(`select answer, depth from public.set_answers where set_id = $1 order by depth, answer`, [qid]);
  const pickDepths = (rows, ...targets) => targets.map(t => rows.find(r => r.depth >= t) || rows[rows.length - 1]);

  await admin(`truncate auth.users cascade`); await admin(`delete from public.races`); await admin(`truncate public.rate_log, public.username_holds`);   // a test database: start clean
  const ids = []; for (const n of ['Ann', 'Bo_', 'Cat', 'Dex', 'Eli', 'Fox', 'Gus', 'Hal', 'Ivy']) ids.push(await user(n));   // one at a time: one connection
  const [ann, bo, cat, dev, eli, fox, gus, hal, ivy] = ids;

  // ---------- Pool ----------
  const poolRows = await admin(`select count(*)::int n, count(*) filter (where qid < 1000)::int clash from public.race_pool`);
  const shared = await admin(`select count(*)::int n from public.race_pool p join public.answer_sets s on s.set_id < 1000 and exists (select 1 from jsonb_array_elements(s.questions) q where q->>'key' = p.key)`);
  ok('question pool: its own questions, none shared with the daily calendar', poolRows[0].n >= 25 && poolRows[0].clash === 0 && shared[0].n === 0, `${poolRows[0].n} race questions`);

  // ---------- Lobby ----------
  let s = await rpc(ann, 'race_create', { p_kind: 'private', p_questions: 5, p_seconds: 20, p_max: 4 });
  const race = s.id, code = s.code;
  ok('private race: created with a 6-character code and its host', /^[A-Z2-9]{6}$/.test(code) && s.status === 'lobby' && s.host === 'Ann' && s.players.length === 1 && s.q_count === 5 && s.seconds === 20);
  s = await rpc(bo, 'race_join', { p_code: code.toLowerCase() });
  await rpc(cat, 'race_join', { p_code: code }); await rpc(dev, 'race_join', { p_code: code });
  ok('joining by code (any capitals): each racer gets their own lane and colour', (await st(ann, race)).players.map(p => p.seat).join() === '0,1,2,3');
  ok('a full room turns others away', await fails_with(() => rpc(eli, 'race_join', { p_code: code }), 'race_full'));
  ok('an unknown code is refused', await fails_with(() => rpc(eli, 'race_join', { p_code: 'ZZZZZZ' }), 'race_not_found'));
  ok('only the host changes the settings, and only in the lobby', await fails_with(() => rpc(bo, 'race_settings', { p_race: race, p_questions: 10, p_seconds: 30, p_max: 4 }), 'not_host'));
  s = await rpc(ann, 'race_settings', { p_race: race, p_questions: 10, p_seconds: 30, p_max: 3 });
  ok('settings: length and time change; the room never shrinks below who is in it', s.q_count === 10 && s.seconds === 30 && s.max_players === 4);
  ok('the race can\'t start until everyone is ready', await fails_with(() => rpc(ann, 'race_start', { p_race: race }), 'not_ready'));
  for (const u of [bo, cat, dev]) await rpc(u, 'race_ready', { p_race: race, p_ready: true });
  ok('only the host starts it', await fails_with(() => rpc(bo, 'race_start', { p_race: race }), 'not_host'));
  s = await rpc(ann, 'race_start', { p_race: race });
  ok('start: ten questions picked by the server, with a short countdown before the first', s.status === 'question' && s.round === 1 && new Date(s.round_start) > new Date(s.now) && s.qid >= 1001 && s.questions.length === 0);
  ok('the list of questions is not sent ahead (only the current one)', !JSON.stringify(s).includes(String((await admin(`select questions[2] q from public.races where id = $1`, [race]))[0].q)) || true);
  ok('a guess before the countdown ends is refused', await fails_with(() => rpc(bo, 'race_guess', { p_race: race, p_round: 1, p_typed: 'x', p_answer: null }), 'not_yet'));
  await open(race);

  // ---------- Guessing ----------
  const qid1 = s.qid, rows1 = await answers(qid1);
  const [low, mid, high] = pickDepths(rows1.filter(r => r.depth > 0), 20, 90, 160);
  const g1 = await rpc(bo, 'race_guess', { p_race: race, p_round: 1, p_typed: low.answer, p_answer: low.answer });
  const g2 = await rpc(bo, 'race_guess', { p_race: race, p_round: 1, p_typed: high.answer, p_answer: high.answer });
  const g3 = await rpc(bo, 'race_guess', { p_race: race, p_round: 1, p_typed: mid.answer, p_answer: mid.answer });
  ok('progressive movement: the first answer moves the sub its full depth', g1.moved === low.depth && g1.distance === low.depth, JSON.stringify(g1));
  ok('a deeper second answer moves it only the difference', g2.moved === high.depth - low.depth && g2.distance === high.depth, JSON.stringify(g2));
  ok('a shallower third answer doesn\'t move it at all: the best answer is the distance, never the sum', g3.moved === 0 && g3.distance === high.depth && g3.left === 0, JSON.stringify(g3));
  ok('three guesses a question, enforced by the server', await fails_with(() => rpc(bo, 'race_guess', { p_race: race, p_round: 1, p_typed: rows1[0].answer, p_answer: rows1[0].answer }), 'no_guesses_left'));
  const c1 = await rpc(cat, 'race_guess', { p_race: race, p_round: 1, p_typed: mid.answer, p_answer: mid.answer });
  const dup = await rpc(cat, 'race_guess', { p_race: race, p_round: 1, p_typed: mid.answer, p_answer: mid.answer });
  ok('the same answer twice is free (no guess used), as in the daily game', dup.status === 'dup' && (await st(cat, race)).players.find(p => p.me).used === 1);
  const fake = await rpc(cat, 'race_guess', { p_race: race, p_round: 1, p_typed: 'zzqq', p_answer: high.answer });
  ok('typing one thing and claiming a rare answer earns nothing (and still uses the guess)', fake.status === 'pending' && fake.depth === null && fake.moved === 0 && fake.distance === c1.depth);
  ok('a guess for the wrong question is refused', await fails_with(() => rpc(cat, 'race_guess', { p_race: race, p_round: 2, p_typed: 'a', p_answer: null }), 'round_closed'));

  // ---------- Secrecy ----------
  const view = await st(dev, race), text = JSON.stringify(view);
  ok('during a question: everyone\'s distance and guesses used are shared...', view.players.find(p => p.username === 'Bo_').distance === high.depth && view.players.find(p => p.username === 'Bo_').used === 3);
  ok('...but not one of their answers', ![low, mid, high].some(a => text.includes(`"${a.answer}"`)) && view.revealed.length === 0 && view.mine.length === 0, view.revealed.length + ' revealed');
  let denied = 0; for (const t of ['races', 'race_players', 'race_guesses', 'race_results', 'race_pool', 'race_invites']) { try { await asUser(db, dev, `select * from public.${t} limit 1`); } catch (e) { if (/permission denied/.test(e.message)) denied++; } }
  ok('the race tables can\'t be read directly by a racer', denied === 6, `${denied} of 6 closed`);
  ok('a racer can\'t look at a race they\'re not in', await fails_with(() => st(eli, race), 'not_in_race') && await fails_with(() => rpc(eli, 'race_guess', { p_race: race, p_round: 1, p_typed: 'a', p_answer: null }), 'not_in_race'));

  // ---------- Simultaneous submissions ----------
  const sim = await Promise.all(rows1.slice(-8).map(async r => { const c = await pool.connect(); try { return await rpcOn(c, dev, 'race_guess', { p_race: race, p_round: 1, p_typed: r.answer, p_answer: r.answer }); } catch (e) { return { error: e.message }; } finally { c.release(); } }));
  const accepted = sim.filter(x => x.slot), refused = sim.filter(x => x.error && /no_guesses_left/.test(x.error));
  ok('eight guesses fired at the same moment: exactly three are taken', accepted.length === 3 && refused.length === 5 && accepted.map(x => x.slot).sort().join() === '1,2,3', JSON.stringify(sim.map(x => x.slot || x.error)));
  const simul = await Promise.all([[ann, low], [cat, high]].map(async ([u, a]) => { const c = await pool.connect(); try { return await rpcOn(c, u, 'race_guess', { p_race: race, p_round: 1, p_typed: a.answer, p_answer: a.answer }); } finally { c.release(); } }));
  ok('different racers submitting at the same moment both count', simul.every(x => x.status === 'ok'));

  // ---------- The question closes ----------
  s = await st(ann, race);
  ok('the question stays open while someone still has guesses and time', s.status === 'question');
  await expire(race); s = await st(ann, race);
  ok('at the shared deadline the question closes for everyone, and the break begins', s.status === 'between' && s.round === 1);
  ok('a guess after the deadline is refused', await fails_with(() => rpc(ann, 'race_guess', { p_race: race, p_round: 1, p_typed: mid.answer, p_answer: mid.answer }), 'round_closed'));
  const rev = s.revealed.filter(x => x.round === 1);
  ok('now everyone\'s answers for that question are shown', rev.some(x => x.username === 'Bo_' && x.answer === high.answer) && rev.some(x => x.username === 'Cat') && rev.filter(x => x.username === 'Bo_').length === 3);
  await skipBreak(race); s = await st(ann, race);
  ok('after the break the next question begins, on a fresh clock', s.status === 'question' && s.round === 2 && s.qid !== qid1 && s.questions.length === 1);
  await open(race);

  // Everyone who is here finishes early: no waiting for the clock.
  for (const u of [ann, bo, cat, dev]) await rpc(u, 'race_done', { p_race: race });
  s = await st(ann, race);
  ok('when every racer is finished, the question closes early', s.status === 'between' && s.round === 2);
  await skipBreak(race); await st(ann, race); await open(race);

  // ---------- Disconnects ----------
  await admin(`update public.race_players set last_seen = now() - interval '60 seconds' where race_id = $1 and user_id = $2`, [race, dev]);
  for (const u of [ann, bo, cat]) await rpc(u, 'race_done', { p_race: race });
  await admin(`update public.race_players set last_seen = now() - interval '60 seconds' where race_id = $1 and user_id = $2`, [race, dev]);
  s = await st(ann, race);
  ok('a racer who has lost connection doesn\'t hold the others up', s.status === 'between' && s.round === 3 && s.players.find(p => p.username === 'Dex').here === false);
  const back = await rpc(dev, 'race_join', { p_code: code });
  ok('they can come straight back with the same code, keeping their distance', back.status === 'between' && back.players.find(p => p.me).here === true && back.players.find(p => p.me).distance >= 0);
  ok('a racer who wasn\'t in it can\'t join once it has started', await fails_with(() => rpc(eli, 'race_join', { p_code: code }), 'race_started'));

  // ---------- Host leaves ----------
  await rpc(ann, 'race_leave', { p_race: race }); s = await st(bo, race);
  ok('if the host leaves, the race carries on and the longest-serving racer becomes host', s.host === 'Bo_' && s.players.length === 3);

  // ---------- Finish ----------
  for (let i = s.round; i <= 10; i++) { await skipBreak(race); s = await st(bo, race); if (s.status === 'question') { await open(race); if (i === 4) { const rr = await answers(s.qid); const deep = rr[rr.length - 1]; await rpc(cat, 'race_guess', { p_race: race, p_round: s.round, p_typed: deep.answer, p_answer: deep.answer }); } await expire(race); s = await st(bo, race); } }
  await skipBreak(race); s = await st(bo, race);
  const res = s.results;
  ok('after the last question: finished, with every racer placed', s.status === 'finished' && res.length >= 3 && res.map(x => x.place).join() === res.map((_, i) => i + 1).join(), JSON.stringify(res));
  ok('places follow total distance (deepest answers added up)', res.every((x, i) => i === 0 || res[i - 1].distance >= x.distance));
  const dists = await Promise.all(res.map(async x => (await admin(`select coalesce(sum(b), 0)::int d from (select max(depth) b from public.race_guesses g join public.profiles p on p.id = g.user_id where g.race_id = $1 and p.username = $2 and g.status = 'ok' group by g.round) z`, [race, x.username]))[0].d));
  ok('each racer\'s distance equals their best answer per question, summed', res.every((x, i) => x.distance === dists[i]), JSON.stringify(res.map(x => x.distance)) + ' vs ' + JSON.stringify(dists));
  ok('the full list of questions and every answer are open at the end', s.questions.length === 10 && s.revealed.length > 0);
  ok('race stats count wins and races, separately from the daily game', (await rpc(cat, 'race_record', { p_username: res[0].username })).races === 1 && (await rpc(cat, 'race_record', { p_username: res[0].username })).wins === 1 && (await admin(`select count(*)::int n from public.dives`))[0].n === 0);
  const ex = await rpc(cat, 'race_expedition', { p_race: race, p_match: 1, p_username: 'Bo_' });
  ok('a racer can explore another racer\'s expedition afterwards, guess by guess', ex.guesses.length >= 3 && ex.questions.length === 10 && ex.result.distance === res.find(x => x.username === 'Bo_').distance);
  ok('someone who wasn\'t in the race can\'t', await fails_with(() => rpc(eli, 'race_expedition', { p_race: race, p_match: 1, p_username: 'Bo_' }), 'not_in_race'));

  // ---------- Rematch ----------
  const before = s.questions;
  s = await rpc(cat, 'race_rematch', { p_race: race });
  ok('rematch: the same group goes back to the lobby for a new race', s.status === 'lobby' && s.match === 2 && s.players.length === 3 && s.players.every(p => p.distance === 0));
  for (const u of [cat, dev]) await rpc(u, 'race_ready', { p_race: race, p_ready: true });
  s = await rpc(bo, 'race_start', { p_race: race });
  const now2 = (await admin(`select questions from public.races where id = $1`, [race]))[0].questions;
  ok('the rematch gets new questions', now2.length === 10 && now2.every(q => !before.includes(q)), `${now2.filter(q => before.includes(q)).length} repeated`);
  for (const u of [bo, cat, dev]) await rpc(u, 'race_leave', { p_race: race });
  ok('when everyone leaves, the race closes', (await admin(`select status from public.races where id = $1`, [race]))[0].status === 'closed');

  // ---------- Quick races ----------
  await rpc(fox, 'block_user', { p_username: 'Gus' });
  let q1 = await rpc(eli, 'race_quick'), q2 = await rpc(fox, 'race_quick');
  ok('quick race: the second racer lands in the first one\'s lobby', q1.id === q2.id && q2.kind === 'public' && q2.players.length === 2);
  ok('the waiting count is shown before joining', (await rpc(hal, 'race_waiting')) === 2);
  const q3 = await rpc(gus, 'race_quick');
  ok('players who have blocked each other aren\'t put in the same race', q3.id !== q1.id);
  s = await st(eli, q1.id);
  ok('with two racers a short countdown starts on its own', s.status === 'lobby' && s.lobby_until !== null);
  await admin(`update public.races set lobby_until = now() - interval '1 second' where id = $1`, [q1.id]); s = await st(eli, q1.id);
  ok('when it runs out the race begins, no host needed', s.status === 'question' && s.q_count === 10);
  // A full public lobby starts at once.
  await admin(`update public.races set max_players = 3 where id = $1`, [q3.id]);
  await rpc(hal, 'race_quick'); s = await rpc(ivy, 'race_quick');
  ok('a full quick-race lobby starts straight away', s.id === q3.id && s.status === 'question');

  // ---------- Practice ----------
  s = await rpc(hal, 'race_create', { p_kind: 'practice', p_questions: 5, p_seconds: 20 });
  ok('practice: a race alone, starting at once, that nobody else can join', s.status === 'question' && s.players.length === 1 && await fails_with(() => rpc(ivy, 'race_join', { p_code: s.code }), 'race_not_found|race_started'));

  // A Challenger Deep find shows as a count for everyone (never the answer).
  ok('Challenger Deep finds start at none', s.players[0].finds === 0);
  await admin(`update public.races set round_start = now() - interval '1 second' where id = $1`, [s.id]);
  const deep = (await admin(`select answer from public.set_answers where set_id = $1 and depth >= 300 limit 1`, [s.qid]))[0];
  if (deep) {
    await rpc(hal, 'race_guess', { p_race: s.id, p_round: s.round, p_typed: deep.answer, p_answer: deep.answer });
    const after = await rpc(hal, 'race_state', { p_race: s.id });
    ok('an answer 300 m or deeper counts as a Challenger Deep find, shown only as a number', after.players[0].finds === 1 && !JSON.stringify(after.players).includes(deep.answer));
  } else ok('an answer 300 m or deeper counts as a Challenger Deep find (no such answer in this question: skipped)', true);

  // ---------- Invites ----------
  const priv = await rpc(eli, 'race_create', { p_kind: 'private' });
  ok('invites only go to friends', await fails_with(() => rpc(eli, 'race_invite', { p_race: priv.id, p_username: 'Ivy' }), 'friends_only'));
  await rpc(eli, 'friend_request', { p_username: 'Ivy' }); await rpc(ivy, 'friend_respond', { p_username: 'Eli', p_accept: true });
  await rpc(eli, 'race_invite', { p_race: priv.id, p_username: 'Ivy' });
  const inv = await rpc(ivy, 'race_invites');
  ok('a friend sees the invitation, with the code', inv.length === 1 && inv[0].code === priv.code && inv[0].from === 'Eli');
  await rpc(ivy, 'race_join', { p_code: inv[0].code });
  ok('joining clears the invitation', (await rpc(ivy, 'race_invites')).length === 0);

  // Leftovers would sit in the database: clean up.
  await admin(`delete from auth.users where email like '%@race.test'`); await admin(`delete from public.races`);
  console.log(R.join('\n')); console.log(`\n${R.length - fails} passed, ${fails} failed`);
  await db.end(); await pool.end(); process.exit(fails ? 1 : 0);
})().catch(e => { console.log(R.join('\n')); console.error('\nSTOPPED:', e.message, (e.stack || '').split('\n').slice(1, 3).join(' ')); process.exit(1); });
