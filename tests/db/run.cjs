// Checks the database rules on a real PostgreSQL database: accounts, usernames, scoring, streaks, friends,
// rankings, privacy and above all who may see what, and when.
//   sh tests/db/setup.sh && node tests/db/run.cjs
// Every query below is run the way the game's public key would run it (as the "anon" or "authenticated" role,
// with the player's identity set), so a rule that only the page enforces would fail here.
const { Client } = require('../node_modules/pg');
const fs = require('fs'), path = require('path');
const DB = process.env.ICEBERG_TEST_DB || 'icetest';
const R = []; let fails = 0;
const ok = (name, cond, extra = '') => { R.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  [' + extra + ']' : ''}`); if (!cond) fails++; };
const day1 = JSON.parse(fs.readFileSync(path.join(__dirname, '../../days/1.json'), 'utf8'));
const jsDepth = s => { if (s >= 0.1) return 0; const d = Math.max(1, Math.round(100 * Math.log10(0.1 / s))); return d >= 300 && Math.round(s * 120000) < 3 ? 299 : d; };   // the game's own rule (iceberg.js)

(async () => {
  const db = new Client({ host: '/var/run/postgresql', user: 'postgres', database: DB }); await db.connect();
  const admin = (sql, p) => db.query(sql, p).then(r => r.rows);
  // Run one statement as a player (or as a signed-out visitor when who is null).
  const as = async (who, sql, p = []) => {
    await db.query('begin');
    try {
      await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(who ? { sub: who, role: 'authenticated' } : { role: 'anon' })]);
      await db.query(`set local role ${who ? 'authenticated' : 'anon'}`);
      const r = await db.query(sql, p); await db.query('commit'); return r.rows;
    } catch (e) { await db.query('rollback'); throw e; }
  };
  const rpc = async (who, fn, args = {}) => { const keys = Object.keys(args); const rows = await as(who, `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as v`, keys.map(k => typeof args[k] === 'object' && args[k] !== null ? JSON.stringify(args[k]) : args[k])); return rows[0].v; };
  const fails_with = async (fn, want) => { try { await fn(); return false; } catch (e) { return want ? new RegExp(want).test(e.message) : true; } };
  const user = async (name, email) => { const [u] = await admin(`insert into auth.users (email) values ($1) returning id`, [email || name.toLowerCase() + '@example.test']); if (name) await rpc(u.id, 'claim_profile', { p_username: name }); return u.id; };
  // The calendar: make "today" day n for a player whose clock is on UTC.
  const setDay = n => admin(`update public.game_config set value = ((now() at time zone 'UTC')::date - $1::int)::text where key = 'launch'`, [n - 1]);
  const G = (round, slot, answer, extra = {}) => ({ round, slot, typed: answer, answer, status: 'ok', ...extra });
  // What a set of guesses is worth on a given day, straight from the rarity table (to check the scoring against).
  const worth = async (day, guesses) => { const set = (await admin(`select private.day_set($1) as s`, [day]))[0].s; let t = 0; for (const r of [1, 2, 3, 4, 5]) { let best = 0; for (const g of guesses.filter(x => x.round === r)) { const row = (await admin(`select depth from public.set_answers where set_id = $1 and round = $2 and answer = $3`, [set, r, g.answer]))[0]; if (row) best = Math.max(best, row.depth); } t += best; } return t; };
  const some = async day => { const set = (await admin(`select private.day_set($1) as s`, [day]))[0].s, rows = await admin(`select round, answer from public.set_answers where set_id = $1 and round in (1, 2) and depth between 60 and 160 order by round, answer`, [set]); return [G(1, 1, rows.find(x => x.round === 1).answer), G(2, 1, rows.find(x => x.round === 2).answer)]; };
  await admin(`truncate auth.users cascade`); await admin(`truncate public.rate_log, public.username_holds, public.days, public.round_plays`);
  await setDay(16);

  // ---------- Usernames ----------
  const ada = await user('Ada'), ben = await user('Ben_2'), cy = await user('Cyrus');
  ok('account: choosing a username creates the player', (await rpc(ada, 'me')).username === 'Ada' && (await rpc(ada, 'me')).stats.dives === 0);
  const nobody = await user(null, 'nobody@example.test');
  ok('account: a signed-in person with no username yet has no profile', (await rpc(nobody, 'me')) === null);
  ok('username: the same name in other capitals is refused', await fails_with(() => rpc(nobody, 'claim_profile', { p_username: 'ADA' }), 'username_taken'));
  ok('username: the availability check says so too', (await rpc(null, 'username_check', { p_username: 'ada' })).reason === 'taken' && (await rpc(null, 'username_check', { p_username: 'Dora' })).ok);
  ok('username: uniqueness is enforced by the database itself, not just the function', await fails_with(() => admin(`insert into public.profiles (id, username) values ($1, 'aDa')`, [nobody]), 'profiles_username_key'));
  const bad = { 'ab': 'format', '1abc': 'format', 'has space': 'format', 'waytoolongausernamehere1': 'format', 'admin': 'reserved', 'Moderator': 'reserved', '4dm1n': 'format', 'Adm1n': 'reserved', 'sup_port': 'reserved', 'xXfuckXx': 'unsuitable', 'sh1thead': 'unsuitable', 'sex': 'unsuitable' };
  const got = {}; for (const n of Object.keys(bad)) got[n] = (await rpc(null, 'username_check', { p_username: n })).reason;
  ok('username: length, characters, reserved names, look-alikes and unsuitable words are refused', Object.keys(bad).every(n => got[n] === bad[n]), JSON.stringify(got));
  ok('username: ordinary names containing an awkward fragment are fine (Essex, Grapes, Peacock)', (await rpc(null, 'username_check', { p_username: 'Essex' })).ok && (await rpc(null, 'username_check', { p_username: 'Grapes' })).ok && (await rpc(null, 'username_check', { p_username: 'Peacock_9' })).ok);
  ok('username: a second profile for the same account is refused', await fails_with(() => rpc(ada, 'claim_profile', { p_username: 'Ada2' }), 'already_has_profile'));
  await rpc(cy, 'change_username', { p_username: 'Cyr' });
  ok('username change: works once, then not again for 14 days', (await rpc(cy, 'me')).username === 'Cyr' && await fails_with(() => rpc(cy, 'change_username', { p_username: 'Cyril' }), 'username_too_soon'));
  ok('username change: the old name is held, so nobody else can take it', (await rpc(null, 'username_check', { p_username: 'cyrus' })).reason === 'taken' && await fails_with(() => rpc(nobody, 'claim_profile', { p_username: 'Cyrus' }), 'username_taken'));
  ok('username change: fixing only the capitals is always allowed', (await rpc(cy, 'change_username', { p_username: 'CYR' })).username === 'CYR');

  // ---------- Direct access ----------
  const tables = ['profiles', 'player_stats', 'dives', 'dive_guesses', 'friendships', 'blocks', 'set_answers', 'answer_sets', 'days', 'game_config', 'rate_log', 'username_holds', 'banned_terms', 'reserved_names', 'verified_answers', 'round_plays', 'day_results', 'flags'];
  let leaks = [];
  for (const t of tables) for (const who of [null, ada]) {
    try { const r = await as(who, `select * from public.${t} limit 1`); leaks.push(`${t} readable by ${who ? 'a player' : 'a visitor'} (${r.length} rows)`); } catch (e) { if (!/permission denied/.test(e.message)) leaks.push(t + ': ' + e.message); }
    if (!['round_plays', 'day_results', 'flags'].includes(t)) for (const sql of [`delete from public.${t}`, `update public.${t} set ${t === 'profiles' ? "username = 'Hacked'" : t === 'dives' ? 'total = 9999' : t === 'game_config' ? "value = 'x'" : 'ctid = ctid'}`]) {
      try { const r = await as(who, sql); leaks.push(`${sql} allowed for ${who ? 'a player' : 'a visitor'}`); void r; } catch (e) { if (!/permission denied|cannot assign|ctid/.test(e.message)) leaks.push(t + ': ' + e.message); }
    }
  }
  ok('direct access: no table can be read, changed or emptied with the public key, signed in or not', !leaks.length, leaks.slice(0, 4).join('; '));
  ok('direct access: the views of raw answer counts are closed too', await fails_with(() => as(ada, `select * from public.answer_counts limit 1`), 'permission denied') && await fails_with(() => as(null, `select * from public.round_players limit 1`), 'permission denied'));
  ok('direct access: internal helpers cannot be called', await fails_with(() => as(ada, `select private.store_dive($1, 16, '[]'::jsonb, 'play', true)`, [ada]), 'permission denied') && await fails_with(() => as(ada, `select private.recount($1)`, [ben]), 'permission denied'));
  ok('direct access: a visitor cannot call the players\' functions', await fails_with(() => rpc(null, 'me'), 'permission denied') && await fails_with(() => rpc(null, 'get_dive', { p_username: 'Ada', p_day: 16 }), 'permission denied') && await fails_with(() => rpc(null, 'friends', { p_day: 16 }), 'permission denied'));
  ok('direct access: someone signed in without a username cannot use them either', await fails_with(() => rpc(nobody, 'friends', { p_day: 16 }), 'no_profile') && await fails_with(() => rpc(nobody, 'submit_dive', { p_day: 16, p_guesses: [] }), 'no_profile'));

  // ---------- Scoring ----------
  const seed = await admin(`select round, answer, share, depth from public.set_answers where set_id = 1`);
  const mism = seed.filter(r => { const row = day1.questions[r.round - 1].answers.find(a => a.a === r.answer); return !row || jsDepth(row.s) !== r.depth || row.s !== r.share; });
  ok('scoring: every answer in the database has exactly the share and depth the game shows', seed.length > 500 && !mism.length, `${seed.length} answers in set 1, ${mism.length} differ`);
  const all = await admin(`select count(*)::int n, count(*) filter (where depth <> case when share >= 0.1 then 0 when floor(100 * log(0.1 / share::numeric) + 0.5) >= 300 and round(share * 120000) < 3 then 299 else greatest(1, floor(100 * log(0.1 / share::numeric) + 0.5)) end)::int off from public.set_answers where set_id < 1000`);
  ok('scoring: the same holds across all 15 sets (with the evidence rule beneath the iceberg)', all[0].n === 19922 && all[0].off === 0, `${all[0].n} answers, ${all[0].off} differ`);
  const adaDive = [G(1, 1, 'eagle'), G(1, 2, 'raven'), G(1, 3, 'lyrebird', { sight: 'giant' }), G(2, 1, 'feta'), G(2, 2, 'feta'), G(3, 1, 'bulgaria', { typed: 'Bulgaria!' }),
    { round: 4, slot: 1, typed: 'underwater chess boxing', answer: 'not a real answer', status: 'ok' }, { round: 4, slot: 2, typed: 'zzz', answer: null, status: 'miss' }, G(5, 1, 'quadrant', { sight: 'colossal', depth: 9999, share: 0.0000001 })];
  // Typed one thing, claimed another: "dog" sent as if it were "lyrebird".
  const cheat = await user('Cheater');
  const ch = await rpc(cheat, 'submit_dive', { p_day: 16, p_guesses: [{ round: 1, slot: 1, typed: 'eagle', answer: 'lyrebird', status: 'ok' }, { round: 2, slot: 1, typed: 'Scamorzza', answer: 'scamorza', status: 'ok' }, { round: 3, slot: 1, typed: 'the Kazakhstans', answer: 'kazakhstan', status: 'ok' }] });
  ok('scoring: a guess whose typed words do not match the answer it claims gets no depth; typos and plurals still count', ch.depths[0] === 0 && ch.depths[1] === 304 && ch.depths[2] === 140, JSON.stringify(ch.depths));
  const res = await rpc(ada, 'submit_dive', { p_day: 16, p_guesses: adaDive });
  ok('scoring: the total is worked out by the database from the answers (204 + 90 + 125 + 0 + 84 = 503)', res.total === 503 && res.max_depth === 204 && JSON.stringify(res.depths) === '[204,90,125,0,84]' && res.saved, JSON.stringify(res));
  const d1 = await rpc(ada, 'get_dive', { p_username: 'ada', p_day: 16 }), gq = (r, s) => d1.guesses.find(g => g.round === r && g.slot === s);
  ok('scoring: numbers sent by the browser are ignored', gq(5, 1).depth === 84 && gq(5, 1).share > 0.001);
  ok('scoring: an answer the day does not accept gets no depth', gq(4, 1).status === 'pending' && gq(4, 1).depth === null && gq(4, 1).answer === null);
  ok('scoring: the same answer twice counts once', gq(2, 1).status === 'ok' && gq(2, 2).status === 'miss');
  ok('scoring: the deepest answer of each question is marked, and only real encounters are kept', gq(1, 3).best && !gq(1, 1).best && gq(1, 3).sight === 'giant' && gq(5, 1).sight === null);
  ok('scoring: four guesses on one question, or a repeated slot, is refused outright', await fails_with(() => rpc(ben, 'submit_dive', { p_day: 16, p_guesses: [G(1, 1, 'eagle'), G(1, 1, 'raven')] }), 'bad_guesses') && await fails_with(() => rpc(ben, 'submit_dive', { p_day: 16, p_guesses: [G(1, 4, 'eagle')] }), 'bad_guesses') && await fails_with(() => rpc(ben, 'submit_dive', { p_day: 16, p_guesses: [G(6, 1, 'eagle')] }), 'bad_guesses'));
  ok('scoring: a refused dive leaves nothing behind', (await admin(`select count(*)::int n from public.dives where user_id = $1`, [ben]))[0].n === 0);
  const again = await rpc(ada, 'submit_dive', { p_day: 16, p_guesses: [G(1, 1, 'lyrebird'), G(2, 1, 'scamorza'), G(3, 1, 'antigua and barbuda'), G(4, 1, 'sepak takraw'), G(5, 1, 'quickstep')] });
  ok('one dive a day: handing in a better one afterwards changes nothing', again.total === 503 && again.saved === false && (await admin(`select count(*)::int n from public.dives where user_id = $1`, [ada]))[0].n === 1);
  ok('one dive a day: enforced by the database itself', await fails_with(() => admin(`insert into public.dives (user_id, day, set_id, total, max_depth, depths) values ($1, 16, 1, 1, 1, '{1,0,0,0,0}')`, [ada]), 'dives_user_id_day_key'));
  ok('days: a day that has closed, or has not begun, cannot be handed in', await fails_with(() => rpc(ben, 'submit_dive', { p_day: 13, p_guesses: [] }), 'day_closed') && await fails_with(() => rpc(ben, 'submit_dive', { p_day: 19, p_guesses: [] }), 'day_closed'));
  // The rarity table changes later: the dive must not move.
  await admin(`update public.set_answers set share = 0.5, depth = 0 where set_id = 1 and round = 1 and answer = 'lyrebird'`);
  const d1b = await rpc(ada, 'get_dive', { p_username: 'Ada', p_day: 16 });
  ok('history: a stored dive keeps its depths when the rarity table is changed later', d1b.total === 503 && d1b.guesses.find(g => g.round === 1 && g.slot === 3).depth === 204);
  await admin(`update public.set_answers set share = $1, depth = 204 where set_id = 1 and round = 1 and answer = 'lyrebird'`, [day1.questions[0].answers.find(a => a.a === 'lyrebird').s]);

  // ---------- Streaks ----------
  const st = async u => (await rpc(u, 'me')).stats;
  ok('streak: the first dive starts it at 1, and is not called an extension', (await st(ada)).streak === 1 && res.extended === false);
  await setDay(17); const r11 = await rpc(ada, 'submit_dive', { p_day: 17, p_guesses: [G(1, 1, 'crow')] });
  ok('streak: the next day makes it 2', r11.streak === 2 && r11.extended === true);
  await rpc(ada, 'submit_dive', { p_day: 17, p_guesses: [G(1, 1, 'crow')] }); await rpc(ada, 'submit_dive', { p_day: 17, p_guesses: [] });
  ok('streak: refreshing or replaying the same day does not add to it', (await st(ada)).streak === 2 && (await st(ada)).dives === 2);
  await setDay(18); await rpc(ada, 'submit_dive', { p_day: 18, p_guesses: [] });
  ok('streak: three days running is 3', (await st(ada)).streak === 3 && (await st(ada)).longest === 3);
  await setDay(19);
  ok('streak: still alive the day after the last dive (there is until midnight to extend it)', (await st(ada)).streak === 3);
  await setDay(21);
  ok('streak: a missed day ends it, and the longest streak is kept', (await st(ada)).streak === 0 && (await st(ada)).longest === 3);
  const r15 = await rpc(ada, 'submit_dive', { p_day: 21, p_guesses: [G(1, 1, 'eagle')] });
  ok('streak: playing again starts from 1', r15.streak === 1 && r15.extended === false && r15.longest === 3);
  const s15 = await st(ada);
  ok('records: total days, first day, average, best day and deepest find', s15.dives === 4 && s15.first_day === 16 && s15.best_total === 503 && s15.best_total_day === 16 && s15.best_depth === 204 && s15.best_depth_answer === 'lyrebird' && +s15.average === Math.round((await rpc(ada, 'my_dives')).reduce((t, c) => t + c.total, 0) / 4), JSON.stringify(s15));
  const cal = await rpc(ada, 'my_dives');
  ok('calendar: exactly the days played, each with its score, depth and place', cal.map(c => c.day).join() === '16,17,18,21' && cal[0].total === 503 && cal[0].deepest_answer === 'lyrebird' && cal[0].rank === 1 && cal[0].players === 2);

  // ---------- Guest progress ----------
  const dee = await user('Dee');
  const imp = await rpc(dee, 'import_dives', { p_dives: [{ day: 19, guesses: [G(1, 1, 'raven')] }, { day: 20, guesses: [G(1, 1, 'partridge')] }, { day: 21, guesses: await some(21) }, { day: 22, guesses: [] }, { day: 46, guesses: [] }, { day: 0, guesses: [] }] });
  ok('guest progress: earlier days on the device move to the new account; days that cannot exist are refused', imp.map(x => x.state).join() === 'saved,saved,saved,saved,refused,refused', JSON.stringify(imp));
  const sd = await st(dee), ddives = await admin(`select day, source, ranked, total from public.dives where user_id = $1 order by day`, [dee]);
  ok('guest progress: the streak and totals follow from those days', sd.streak === 4 && sd.dives === 4 && ddives[2].total === await worth(21, await some(21)) && ddives[2].total > 100);
  ok('guest progress: a day that had already closed is history only, and does not enter its ranking afterwards', ddives[0].ranked === false && ddives[2].ranked === true && ddives.every(d => d.source === 'guest'));
  const imp2 = await rpc(dee, 'import_dives', { p_dives: [{ day: 21, guesses: [G(1, 1, 'lyrebird'), G(4, 1, 'sepak takraw')] }] });
  ok('guest progress: a day already on the account is kept as it is (no second score)', imp2[0].state === 'kept' && (await admin(`select total from public.dives where user_id = $1 and day = 21`, [dee]))[0].total === await worth(21, await some(21)));

  // ---------- Friends ----------
  await setDay(26);
  const eve = await user('Eve'), fay = await user('Fay'), gus = await user('Gus'), hal = await user('Hal');
  ok('search: by the start of a username, any capitals, never yourself', (await rpc(ada, 'search_users', { p_query: 'e' })).length === 0 && (await rpc(ada, 'search_users', { p_query: 'EV' }))[0].username === 'Eve' && (await rpc(eve, 'search_users', { p_query: 'ev' })).length === 0);
  await rpc(hal, 'update_settings', { p: { searchable: false } });
  ok('search: a player who turned search off is not found', (await rpc(ada, 'search_users', { p_query: 'hal' })).length === 0);
  ok('friends: a request is pending until the other player accepts', (await rpc(ada, 'friend_request', { p_username: 'eve' })) === 'requested' && (await rpc(eve, 'friends', { p_day: 26 })).incoming[0].username === 'Ada' && (await rpc(ada, 'friends', { p_day: 26 })).outgoing[0].username === 'Eve' && (await rpc(ada, 'friends', { p_day: 26 })).friends.length === 0);
  ok('friends: asking twice does not create two requests', (await rpc(ada, 'friend_request', { p_username: 'Eve' })) === 'requested' && (await admin(`select count(*)::int n from public.friendships`))[0].n === 1);
  ok('friends: accepting makes it mutual', (await rpc(eve, 'friend_respond', { p_username: 'Ada', p_accept: true })) === 'friend' && (await rpc(ada, 'friends', { p_day: 26 })).friends[0].username === 'Eve' && (await rpc(eve, 'friends', { p_day: 26 })).friends[0].username === 'Ada');
  await rpc(ada, 'friend_request', { p_username: 'Fay' });
  ok('friends: declining removes the request', (await rpc(fay, 'friend_respond', { p_username: 'Ada', p_accept: false })) === 'none' && (await rpc(ada, 'friends', { p_day: 26 })).outgoing.length === 0);
  ok('friends: nobody can accept a request that was not sent to them', await fails_with(() => rpc(gus, 'friend_respond', { p_username: 'Ada', p_accept: true }), 'no_request') && await fails_with(() => rpc(ada, 'friend_respond', { p_username: 'Eve', p_accept: true }), 'no_request'));
  await rpc(ada, 'friend_request', { p_username: 'Gus' }); await rpc(ada, 'friend_remove', { p_username: 'Gus' });
  ok('friends: a sent request can be withdrawn', (await rpc(gus, 'friends', { p_day: 26 })).incoming.length === 0);
  await rpc(ada, 'friend_request', { p_username: 'Gus' });
  ok('friends: if both ask, they are friends at once', (await rpc(gus, 'friend_request', { p_username: 'Ada' })) === 'friend');
  ok('friends: you cannot befriend yourself or someone who does not exist', await fails_with(() => rpc(ada, 'friend_request', { p_username: 'Ada' }), 'yourself') && await fails_with(() => rpc(ada, 'friend_request', { p_username: 'Nobody_here' }), 'not_found'));
  await rpc(ada, 'friend_remove', { p_username: 'Gus' });
  ok('friends: removing a friend ends it for both', (await rpc(gus, 'friends', { p_day: 26 })).friends.length === 0 && (await rpc(ada, 'friends', { p_day: 26 })).friends.length === 1);
  // Blocking
  await rpc(fay, 'block_user', { p_username: 'Ada' });
  ok('blocking: the blocked player cannot find or view the blocker', (await rpc(ada, 'search_users', { p_query: 'fay' })).length === 0 && await fails_with(() => rpc(ada, 'profile_of', { p_username: 'Fay' }), 'not_found'));
  ok('blocking: their friend request appears to go through but never arrives', (await rpc(ada, 'friend_request', { p_username: 'Fay' })) === 'requested' && (await rpc(fay, 'friends', { p_day: 26 })).incoming.length === 0 && (await admin(`select count(*)::int n from public.friendships where a = least($1::uuid, $2::uuid) and b = greatest($1::uuid, $2::uuid)`, [ada, fay]))[0].n === 0);
  await rpc(eve, 'block_user', { p_username: 'Ada' });
  ok('blocking a friend ends the friendship', (await rpc(ada, 'friends', { p_day: 26 })).friends.length === 0 && (await rpc(eve, 'friends', { p_day: 26 })).blocked.join() === 'Ada');
  await rpc(eve, 'block_user', { p_username: 'Ada', p_block: false }); await rpc(ada, 'friend_request', { p_username: 'Eve' }); await rpc(eve, 'friend_respond', { p_username: 'Ada', p_accept: true });
  ok('blocking: can be undone, and the friendship made again', (await rpc(ada, 'friends', { p_day: 26 })).friends[0].username === 'Eve');
  let limited = false; const spam = await user('Spammer'); const targets = [];
  for (let i = 0; i < 24; i++) targets.push(await user('Target' + String.fromCharCode(97 + i)));
  for (let i = 0; i < 24 && !limited; i++) { try { await rpc(spam, 'friend_request', { p_username: 'Target' + String.fromCharCode(97 + i) }); } catch (e) { limited = /rate_limited/.test(e.message) && i === 20; } }
  ok('friends: request spam is cut off (20 an hour)', limited);

  // ---------- Spoilers: today's answers stay hidden until you have dived ----------
  await rpc(ada, 'friend_request', { p_username: 'Gus' }); await rpc(gus, 'friend_respond', { p_username: 'Ada', p_accept: true });
  const eveDive = [G(1, 1, 'lyrebird'), G(2, 1, 'scamorza'), G(3, 1, 'kazakhstan'), G(4, 1, 'bocce'), G(5, 1, 'quickstep')];   // set ((20-1) % 15) + 1 = 5? no: see below
  const set26 = (await admin(`select private.day_set(26) as s`))[0].s, a26 = await admin(`select round, answer, depth from public.set_answers where set_id = $1 and depth between 60 and 260 order by round, depth desc`, [set26]);
  const pick = (r, i) => a26.filter(x => x.round === r)[i], dive26 = k => [1, 2, 3, 4, 5].map(r => G(r, 1, pick(r, k).answer));
  void eveDive;
  const eveRes = await rpc(eve, 'submit_dive', { p_day: 26, p_guesses: dive26(0) });
  let f = await rpc(ada, 'friends', { p_day: 26 });
  const eveRow = () => f.friends.find(x => x.username === 'Eve');
  ok('spoilers: before my dive I can see that a friend has finished, but not their score', f.unlocked === false && eveRow().done === true && eveRow().total === null && eveRow().max_depth === null);
  ok('spoilers: their iceberg is locked', await fails_with(() => rpc(ada, 'get_dive', { p_username: 'Eve', p_day: 26 }), 'locked'));
  let lb = await rpc(ada, 'leaderboard', { p_day: 26, p_scope: 'global' });
  ok('spoilers: today\'s global ranking is locked (only how many have finished is shown)', lb.locked === true && lb.rows === undefined && lb.players === 1);
  ok('spoilers: today\'s friends ranking is locked', (await rpc(ada, 'leaderboard', { p_day: 26, p_scope: 'friends' })).locked === true);
  ok('spoilers: a signed-out visitor gets nothing for an open day', (await rpc(null, 'leaderboard', { p_day: 26, p_scope: 'global' })).locked === true);
  let pe = await rpc(ada, 'profile_of', { p_username: 'Eve' });
  ok('spoilers: a friend\'s profile hides today\'s deepest answer', pe.calendar.find(c => c.day === 26).deepest_answer === null && pe.stats.best_depth_answer === null && pe.calendar.find(c => c.day === 26).total === eveRes.total);
  const everything = JSON.stringify([f, lb, pe, await rpc(ada, 'me'), await rpc(ada, 'day_summary', { p_day: 26 }), await rpc(ada, 'search_users', { p_query: 'eve' }), await rpc(ada, 'my_dives')]);
  ok('spoilers: none of today\'s answers appear in anything the database will give me', !dive26(0).some(g => everything.includes(`"${g.answer}"`)));
  ok('spoilers: answer counts for a question are locked until this device has played it', (await rpc(ada, 'round_counts', { p_day: 26, p_round: 1, p_player: 'device-ada-1' })).locked === true);
  await as(ada, `insert into public.round_plays (day, round, player, answers, best, depth) values (26, 1, 'device-ada-1', $1, $2, 0)`, [[pick(1, 3).answer], pick(1, 3).answer]);
  ok('spoilers: ...and open for that question once it has', (await rpc(ada, 'round_counts', { p_day: 26, p_round: 1, p_player: 'device-ada-1' })).players === 1 && (await rpc(ada, 'round_counts', { p_day: 26, p_round: 2, p_player: 'device-ada-1' })).locked === true);
  // Now Ada dives.
  await rpc(ada, 'submit_dive', { p_day: 26, p_guesses: dive26(2) });
  f = await rpc(ada, 'friends', { p_day: 26 }); lb = await rpc(ada, 'leaderboard', { p_day: 26, p_scope: 'global' }); pe = await rpc(ada, 'profile_of', { p_username: 'Eve' });
  const ed = await rpc(ada, 'get_dive', { p_username: 'Eve', p_day: 26 });
  ok('after my dive: friends\' scores, the rankings and their icebergs open at once', f.unlocked && eveRow().total === eveRes.total && lb.locked === false && lb.rows.length === 2 && ed.guesses.length === 5 && ed.guesses[0].answer === pick(1, 0).answer && pe.calendar.find(c => c.day === 26).deepest_answer !== null);
  ok('a friend\'s dive comes back complete: every guess with its share, depth and which was deepest', ed.username === 'Eve' && ed.total === eveRes.total && ed.guesses.every(g => g.share > 0 && g.depth === pick(g.round, 0).depth && g.best) && ed.set === set26 && ed.own === false);
  // A day that has closed is history: open to friends who never played it.
  ok('history: a closed day\'s dive can be explored without having played it', (await rpc(eve, 'get_dive', { p_username: 'Ada', p_day: 16 })).total === 503 && (await rpc(null, 'leaderboard', { p_day: 16 })).rows[0].username === 'Ada');

  // ---------- Privacy ----------
  ok('privacy: a stranger sees a name, picture, streaks and dive count, and nothing else', await (async () => { const p = await rpc(hal, 'profile_of', { p_username: 'Ada' }); return p.relation === 'none' && p.calendar === null && p.stats.best_total === undefined && p.stats.dives === 5 && p.can_explore === false; })());
  ok('privacy: only friends can open a dive', await fails_with(() => rpc(hal, 'get_dive', { p_username: 'Ada', p_day: 16 }), 'friends_only'));
  await rpc(eve, 'update_settings', { p: { share_answers: false } });
  const hidden = await rpc(ada, 'get_dive', { p_username: 'Eve', p_day: 26 });
  ok('privacy: with answers hidden, a friend sees the depths but not the words', hidden.answers_hidden && hidden.guesses.every(g => g.answer === null && g.typed === null && g.depth > 0) && (await rpc(ada, 'profile_of', { p_username: 'Eve' })).calendar[0].deepest_answer === null);
  await rpc(eve, 'update_settings', { p: { share_dives: false, share_calendar: false } });
  ok('privacy: with dives and calendar switched off, friends get neither', await fails_with(() => rpc(ada, 'get_dive', { p_username: 'Eve', p_day: 26 }), 'private') && (await rpc(ada, 'profile_of', { p_username: 'Eve' })).calendar === null);
  ok('privacy: my own dives and calendar are always mine to see', (await rpc(eve, 'get_dive', { p_username: 'Eve', p_day: 26 })).guesses[0].answer !== null && (await rpc(eve, 'profile_of', { p_username: 'Eve' })).calendar.length === 1);
  ok('privacy: settings can only be changed for yourself, and unknown settings are ignored', (await rpc(ada, 'update_settings', { p: { username: 'Hacked', id: eve, ranked: true } })).username === 'Ada' && (await rpc(eve, 'me')).settings.share_dives === false);
  await rpc(eve, 'update_settings', { p: { share_dives: true, share_calendar: true, share_answers: true } });
  const blob = JSON.stringify([await rpc(ada, 'me'), await rpc(ada, 'profile_of', { p_username: 'Eve' }), await rpc(ada, 'friends', { p_day: 26 }), lb, ed, await rpc(ada, 'search_users', { p_query: 'ev' }), await rpc(ada, 'leaderboard', { p_day: 26, p_scope: 'friends' })]);
  ok('privacy: no email address, account id or other private detail is ever returned', !/@|example\.test/.test(blob) && ![ada, ben, eve, gus].some(id => blob.includes(id)));

  // ---------- Rankings ----------
  await setDay(36);
  const set36 = (await admin(`select private.day_set(36) as s`))[0].s, a36 = await admin(`select round, answer, depth from public.set_answers where set_id = $1 order by round, depth desc, answer`, [set36]);
  const by = (r, d) => a36.find(x => x.round === r && x.depth === d), sameDepth = (() => { for (const x of a36.filter(y => y.round === 1 && y.depth > 0)) { const y = a36.find(z => z.round === 2 && z.depth === x.depth); if (y) return [x, y]; } })();
  const hi = a36.find(x => x.round === 3 && x.depth >= 150), lo = a36.find(x => x.round === 3 && x.depth > 0 && x.depth < 60);
  // Ada and Gus: same total, same deepest; Ada first. Eve: same total made of two answers (shallower best). Hal: highest. Ben: opted out.
  await rpc(hal, 'submit_dive', { p_day: 36, p_guesses: [G(1, 1, sameDepth[0].answer), G(2, 1, sameDepth[1].answer), G(3, 1, hi.answer)] });
  await rpc(ada, 'submit_dive', { p_day: 36, p_guesses: [G(1, 1, sameDepth[0].answer), G(2, 1, sameDepth[1].answer)] });
  await rpc(gus, 'submit_dive', { p_day: 36, p_guesses: [G(2, 1, sameDepth[1].answer), G(1, 1, sameDepth[0].answer)] });
  await rpc(ben, 'update_settings', { p: { ranked: false } });
  await rpc(ben, 'submit_dive', { p_day: 36, p_guesses: [G(1, 1, sameDepth[0].answer), G(2, 1, sameDepth[1].answer), G(3, 1, hi.answer), G(3, 2, lo.answer)] });
  await rpc(cy, 'submit_dive', { p_day: 36, p_guesses: [G(3, 1, lo.answer)] });
  void by;
  lb = await rpc(ada, 'leaderboard', { p_day: 36, p_scope: 'global' });
  const order = lb.rows.map(r => `${r.rank}.${r.username}`).join(' ');
  ok('ranking: ordered by total depth; a tie goes to whoever finished first', order === '1.Hal 2.Ada 3.Gus 4.CYR', order);
  ok('ranking: says how many are ranked, where I am, and my percentile', lb.players === 4 && lb.me.rank === 2 && +lb.me.top === 50 && lb.rows.find(r => r.me).username === 'Ada');
  ok('ranking: a player who opted out is not listed or counted, but still gets their own place among the rest', !lb.rows.some(r => r.username === 'Ben_2') && (await rpc(ben, 'day_summary', { p_day: 36 })).rank === 2 && (await rpc(ben, 'day_summary', { p_day: 36 })).ranked === false);
  // Tie on total, different deepest answer.
  const t1 = a36.filter(x => x.round === 4 && x.depth > 100)[0], t2 = a36.find(x => x.round === 5 && x.depth > 20 && x.depth < t1.depth), t3 = a36.find(x => x.round === 4 && x.depth === t1.depth - t2.depth + 0) || null;
  const iris = await user('Iris'), jon = await user('Jon');
  await rpc(iris, 'submit_dive', { p_day: 36, p_guesses: [G(5, 1, t2.answer), G(4, 1, a36.find(x => x.round === 4 && x.depth === t1.depth).answer)] });
  const total = t1.depth + t2.depth, pair = (() => { for (const x of a36.filter(y => y.round === 4 && y.depth > 0)) { const y = a36.find(z => z.round === 5 && z.depth === total - x.depth && z.depth > 0); if (y && Math.max(x.depth, y.depth) !== t1.depth) return [x, y]; } })();
  void t3;
  if (pair) {
    await rpc(jon, 'submit_dive', { p_day: 36, p_guesses: [G(4, 1, pair[0].answer), G(5, 1, pair[1].answer)] });
    lb = await rpc(ada, 'leaderboard', { p_day: 36 });
    const ir = lb.rows.find(r => r.username === 'Iris'), jr = lb.rows.find(r => r.username === 'Jon'), deeper = Math.max(pair[0].depth, pair[1].depth) > t1.depth ? jr : ir, other = deeper === ir ? jr : ir;
    ok('ranking: equal totals are split by the deepest single answer, whoever finished first', ir.total === jr.total && deeper.max_depth > other.max_depth && deeper.rank < other.rank, `Iris ${ir.total}/${ir.max_depth} #${ir.rank}, Jon ${jr.total}/${jr.max_depth} #${jr.rank}`);
  } else ok('ranking: equal totals are split by the deepest single answer', false, 'no suitable pair of answers found');
  ok('ranking: the same question asked twice gives the same order', JSON.stringify((await rpc(ada, 'leaderboard', { p_day: 36 })).rows) === JSON.stringify(lb.rows));
  const fl = await rpc(ada, 'leaderboard', { p_day: 36, p_scope: 'friends' });
  ok('friends ranking: only me and my friends, ranked among ourselves', fl.rows.map(r => r.username).join() === 'Ada,Gus' && fl.me.rank === 1 && fl.players === 2, fl.rows.map(r => r.username).join());
  const sum = await rpc(gus, 'day_summary', { p_day: 36 });
  ok('end of day: my place, how many friends have finished and how many I beat', sum.done && sum.rank === (await rpc(gus, 'leaderboard', { p_day: 36 })).me.rank && +sum.friends === 1 && +sum.friends_done === 1 && +sum.friends_beaten === 0, JSON.stringify(sum));
  await rpc(ada, 'block_user', { p_username: 'Hal' });
  ok('ranking: someone I have blocked is not shown to me (places are unchanged)', !(await rpc(ada, 'leaderboard', { p_day: 36 })).rows.some(r => r.username === 'Hal') && (await rpc(ada, 'leaderboard', { p_day: 36 })).me.rank === lb.me.rank);
  ok('ranking: paging and limits are bounded', (await rpc(ada, 'leaderboard', { p_day: 36, p_scope: 'global', p_limit: 100000, p_offset: -5 })).rows.length <= 100 && (await rpc(ada, 'leaderboard', { p_day: 36, p_scope: 'global', p_limit: 2, p_offset: 1 })).rows.length === 2);

  // ---------- Beneath the iceberg ----------
  const ev = (await admin(`select count(*) filter (where depth >= 300 and round(share * 120000) < 3)::int bad, count(*) filter (where depth >= 300)::int beyond, count(*) filter (where depth = 299 and round(share * 120000) < 3)::int held from public.set_answers where set_id < 1000`))[0];
  ok('Unfathomable: no daily answer reaches 300 m without at least 3 of the 120,000 sample behind it; thinner ones stop at 299 m', ev.bad === 0 && ev.beyond > 0 && ev.held > 0, JSON.stringify(ev));

  // ---------- Deleting an account ----------
  await rpc(gus, 'delete_account');
  ok('delete account: the player, their dives and their friendships are gone', (await admin(`select (select count(*) from public.profiles where id = $1)::int + (select count(*) from public.dives where user_id = $1)::int + (select count(*) from public.friendships where a = $1 or b = $1)::int + (select count(*) from auth.users where id = $1)::int as n`, [gus]))[0].n === 0 && !(await rpc(ada, 'friends', { p_day: 36 })).friends.some(x => x.username === 'Gus'));
  ok('delete account: the name cannot be taken by someone else straight away', (await rpc(null, 'username_check', { p_username: 'gus' })).reason === 'taken');
  ok('delete account: nobody can delete anyone but themselves', (await rpc(ada, 'me')).username === 'Ada' && await fails_with(() => as(ada, `delete from auth.users where id = $1`, [ben]), 'permission denied'));

  console.log(R.join('\n')); console.log(`\n${R.length - fails} passed, ${fails} failed`);
  await db.end(); process.exit(fails ? 1 : 0);
})().catch(e => { console.log(R.join('\n')); console.error('\nSTOPPED:', e.message, '\n', (e.stack || '').split('\n').slice(1, 4).join('\n')); process.exit(1); });
