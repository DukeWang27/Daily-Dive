// The prepared days as they will go live (content/build/sql, private), loaded into the local test database, then
// played: for every day, generated dives (real answers, other names, estimates, repeats, risk choices) are scored by
// the game's own rules (rounds.js on the day file the browser gets) and by the server (submit path, 0011). Every total
// and every question's score must agree. Also checks each day's round types are well formed.
//   sh tests/db/setup.sh && node tests/db/live_content.cjs [first_day]
const { Client } = require('../node_modules/pg');
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..'), DB = process.env.ICEBERG_TEST_DB || 'icetest';
const FIRST = +process.argv[2] || 6;
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log('PASS  ' + name); } else { fail++; console.log('FAIL  ' + name + (extra ? '  [' + extra + ']' : '')); } };
// The browser's depth rule (iceberg.js) and round rules (rounds.js).
const SURFACE = 0.1, BEYOND = 300, EV = { players: 120000, min: 3 };
const depthOf = s => { if (s >= SURFACE) return 0; const d = Math.max(1, Math.round(100 * Math.log10(SURFACE / s))); return d >= BEYOND && !(Math.round(s * EV.players) >= EV.min) ? BEYOND - 1 : d; };
const ctx = { window: { Iceberg: { depthOf } }, Math }; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'rounds.js'), 'utf8'), ctx);
const R = ctx.window.Rounds;
let seed = 99; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const pick = a => a[Math.floor(rnd() * a.length)];

(async () => {
  const db = new Client({ host: '/var/run/postgresql', user: 'postgres', database: DB }); await db.connect();
  const q = (sql, p) => db.query(sql, p).then(r => r.rows);
  const files = fs.readdirSync(path.join(ROOT, 'content', 'build', 'sql')).filter(f => +f.slice(4, 7) >= FIRST).sort();
  await q(`delete from public.days where day >= $1`, [FIRST]);   // the test database may have mapped these days to test sets
  const t0 = Date.now();
  for (const f of files) await db.query(fs.readFileSync(path.join(ROOT, 'content', 'build', 'sql', f), 'utf8'));
  ok(`loaded ${files.length} days (${((Date.now() - t0) / 1000).toFixed(1)} s)`, files.length > 0);
  const [{ id: uid }] = await q(`insert into auth.users (email) values ('parity-' || gen_random_uuid() || '@x.test') returning id`);
  await db.query('begin'); await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: 'authenticated' })]); await db.query('set local role authenticated');
  await db.query(`select public.claim_profile(p_username => $1)`, ['Par' + String(uid).slice(0, 6)]); await db.query('commit');
  let dives = 0, rounds = 0, mism = [], kinds = {}, bad = [];
  for (const f of files) {
    const day = +f.slice(4, 7), file = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'build', 'days', day + '.json'), 'utf8'));
    const meta = (await q(`select questions from public.answer_sets where set_id = $1`, [day]))[0].questions;
    file.questions.forEach((c, i) => { const k = R.kind(c); kinds[k] = (kinds[k] || 0) + 1;
      const canon = x => JSON.stringify(x, (k, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort()) : v);
      if (canon(c.mode || null) !== canon(meta[i].mode || null)) bad.push(`${day}/${i + 1} server mode differs`);
      if (k === 'forbidden' && !(c.mode.forbid || []).every(a => c.answers.some(r => r.a === a))) bad.push(`${day}/${i + 1} a banned answer isn't on the list`);
      if (k === 'target' && c.mode.goal === 'common' && c.mode.top !== Math.max(...c.answers.filter(a => !a.pv).map(a => a.s))) bad.push(`${day}/${i + 1} target top`);
      if (k === 'mines' && !(c.mode.mines.length === 2 && c.mode.mines.every(b => b.lo < b.hi))) bad.push(`${day}/${i + 1} mines`); });
    for (let n = 0; n < 6; n++) {
      await q(`delete from public.dives where user_id = $1 and day = $2`, [uid, day]);
      const game = { rounds: [] }, guesses = [], choices = [];
      file.questions.forEach((c, i) => {
        const r = { guesses: [], done: true };
        const rows = c.answers.filter(a => !(R.kind(c) === 'forbidden' && c.mode.forbid.includes(a.a)));
        for (let s = 0; s < 3; s++) {
          if (rnd() < 0.12) { r.guesses.push({ status: 'pending', typed: 'zzq' + s }); continue; }
          const row = rnd() < 0.15 && r.guesses.length ? (c.answers.find(a => a.a === r.guesses[0].name) || pick(rows)) : pick(rows);
          if (r.guesses.some(g => g.name === row.a)) { r.guesses.push({ status: 'miss', typed: row.a }); continue; }   // the game counts a repeat as a miss
          r.guesses.push({ status: 'ok', name: row.a, typed: (row.al && rnd() < 0.3 ? (al => /[a-z0-9]/i.test(al) ? al : row.d || row.a)(pick(row.al)) : row.d || row.a)   /* an emoji-only name is recorded under the written name (validate.js) */, share: row.s });
          if (R.kind(c) === 'risk' && !r.choice && r.guesses.filter(g => g.status === 'ok').length === 1) {
            const stake = R.value(c, r.guesses[r.guesses.length - 1]);
            const kind = stake <= 0 ? 'continue' : pick(['secure', 'continue', 'risk']);
            r.choice = { kind, stake, at: r.guesses.length, auto: stake <= 0 };
            if (!r.choice.auto) choices.push({ round: i + 1, kind });
            if (kind === 'secure') break;
          }
        }
        game.rounds.push(r);
        r.guesses.forEach((g, j) => guesses.push({ round: i + 1, slot: j + 1, typed: String(g.typed).slice(0, 60), answer: g.status === 'ok' ? g.name : null, status: g.status }));
      });
      const js = game.rounds.map((r, i) => R.score(file.questions[i], r, r.guesses.length, true));
      const [{ v: id }] = await q(`select private.store_dive($1, $2, $3, 'play', true, $4) v`, [uid, day, JSON.stringify(guesses), JSON.stringify(choices)]);
      const [d] = await q(`select depths, total from public.dives where id = $1`, [id]);
      dives++; rounds += 5;
      js.forEach((v, i) => { if (v !== d.depths[i]) mism.push(`day ${day} q${i + 1} ${R.kind(file.questions[i])}: game ${v}, server ${d.depths[i]}  ${JSON.stringify(game.rounds[i].guesses.map(g => [g.status, g.name, g.share]))} ${JSON.stringify(game.rounds[i].choice || null)}`); });
    }
  }
  ok(`round types well formed and the same on both sides (${JSON.stringify(kinds)})`, !bad.length, bad.slice(0, 5).join(' | '));
  ok(`${dives} generated dives, ${rounds} questions: the server's score equals the game's for every question`, !mism.length, mism.length + ' differ: ' + mism.slice(0, 4).join(' || '));
  await q(`delete from public.dives where user_id = $1`, [uid]);
  await db.end();
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
