// Where a day's questions come from when a database is connected. The first few days ship as files (index.json
// "static"); every later day is asked of the database, which may answer with prepared questions, with "none" (then
// both sides fall back to an earlier day in rotation), or not at all (then the game must not guess).
const { chromium, serve } = require('./lib.cjs');
const fs = require('fs'), path = require('path');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('PASS  ' + name); } else { fail++; console.log('FAIL  ' + name + (extra ? '  [' + extra + ']' : '')); } };
const file = n => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'days', n + '.json'))).questions[0].prompt;
const prepared = n => ({ v: 4, day: n, questions: JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'days', '1.json'))).questions.map((q, i) => i ? q : { ...q, prompt: 'Prepared question for day ' + n }) });

(async () => {
  const site = serve(8784), b = await chromium.launch();
  // answer(day) -> { status, body } | 'down'. staticDays: what index.json says ships as files.
  const open = async (day, staticDays, answer) => {
    const p = await b.newPage(), asked = [];
    if (staticDays) await p.route('**/days/index.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ v: 3, count: 15, static: staticDays, samplePlayers: 50000 }) }));
    await p.route('http://fake.test/**', r => {
      const u = r.request().url(); if (!u.includes('day_content')) return r.abort();
      const d = JSON.parse(r.request().postData()).p_day; asked.push(d); const a = answer(d);
      return a === 'down' ? r.abort() : r.fulfill({ status: a.status, contentType: 'application/json', body: a.body });
    });
    await p.goto(`http://localhost:8784/?test&reset&day=${day}&api=http://fake.test&key=x`);
    const got = await p.waitForFunction(() => /Couldn.t load/.test(document.querySelector('#play').textContent) ? 'error' : (typeof CATS !== 'undefined' && CATS.length ? CATS[0].prompt : null), null, { timeout: 15000 }).then(h => h.jsonValue()).catch(() => 'timeout');
    await p.close(); return { got, asked };
  };
  const none = () => ({ status: 200, body: 'null' }), missing = () => ({ status: 404, body: '{"code":"PGRST202"}' });

  let r = await open(16, 0, missing);
  ok('a database from before prepared content: day 16 plays day 1 (the rotation)', r.got === file(1), r.got);
  r = await open(16, 0, none);
  ok('no prepared content for day 16: day 1, as the database scores it', r.got === file(1), r.got);
  r = await open(2, 2, none);
  ok('a day that ships as a file never asks the database', r.got === file(2) && r.asked.length === 0, r.asked.join());
  r = await open(5, 2, d => ({ status: 200, body: JSON.stringify(prepared(d)) }));
  ok('an early day past the files uses the prepared questions, not the old file', r.got === 'Prepared question for day 5' && r.asked[0] === 5, r.got);
  r = await open(5, 2, none);
  ok('an early day with nothing prepared uses its own file (it is its own rotation day)', r.got === file(5), r.got);
  r = await open(5, 2, () => 'down');
  ok('database unreachable on an early day: says so, and does not fall back to the old file', r.got === 'error', r.got);
  r = await open(20, 2, d => d === 20 ? none() : ({ status: 200, body: JSON.stringify(prepared(d)) }));
  ok('past the prepared days: rotation lands on day 5, and its prepared questions are fetched', r.got === 'Prepared question for day 5' && r.asked.join() === '20,5', r.asked.join());
  await b.close(); site.close();
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.log('STOPPED: ' + e.message); process.exit(1); });
