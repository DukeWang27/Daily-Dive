// What a player sees when they answer, in a real browser on the playtest build: a word from another category explained
// (terrodactyl on birds), a slip inside a job corrected, a brand or model counted as the thing it is, a vague brand
// asked about at no cost, and everything typed shown in the results.
// Usage: node tests/answers-ui.cjs
const { chromium, serve } = require('./lib.cjs');
const fs = require('fs'), path = require('path'), os = require('os'), { execFileSync } = require('child_process');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('PASS  ' + name); } else { fail++; console.log('FAIL  ' + name + (extra ? '  [' + extra + ']' : '')); } };
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'aui-'));
execFileSync('python3', [path.join(__dirname, '..', 'tools/playtest/build.py'), out]);

(async () => {
  const site = serve(8881), b = await chromium.launch(), errs = [];
  const open = async day => {
    const p = await b.newPage({ viewport: { width: 1280, height: 800 } }); p.on('pageerror', e => errs.push(e.message));
    await p.route('**/pt/**', r => { const f = path.join(out, 'pt', path.basename(new URL(r.request().url()).pathname)); fs.existsSync(f) ? r.fulfill({ path: f, contentType: 'application/json' }) : r.fulfill({ status: 404 }); });
    await p.route(/supabase\.co/, r => r.abort());
    await p.goto(`http://localhost:8881/?playtest&day=${day}&fast`); await p.evaluate(() => localStorage.clear()); await p.goto(`http://localhost:8881/?playtest&day=${day}&fast`);
    await p.waitForFunction(() => !document.querySelector('#play').disabled); await p.click('#play'); await p.waitForTimeout(2500);
    return p;
  };
  const hint = p => p.textContent('#hint');
  const st = (p, day) => p.evaluate(d => JSON.parse(localStorage.getItem('iceberg-pt:game:' + d)), day);
  const enter = async (p, t) => { await p.fill('#answer', t); await p.press('#answer', 'Enter'); await p.waitForTimeout(1500); };
  const toQuestion = async (p, day, key) => {
    for (let i = 0; i < 5; i++) {
      if (await p.evaluate(k => window.Game.cats[window.Game.round] && window.Game.cats[window.Game.round].key === k, key)) return;
      await p.evaluate(() => { const s = window.ICEBERG_TEST; }); await p.fill('#answer', 'xqzv'); await p.press('#answer', 'Enter');
      await p.click('#finish').catch(() => {}); await p.waitForTimeout(400);
      await p.waitForFunction(d => (JSON.parse(localStorage.getItem('iceberg-pt:game:' + d) || '{}').phase) === 'done', day, { timeout: 30000 }).catch(() => {});
      await p.click('#next').catch(() => {}); await p.waitForTimeout(1800);
    }
  };

  // Day 1, Name a bird: terrodactyl.
  let p = await open(1); await p.waitForTimeout(1500);   // the dictionary of other categories loads in the background
  await enter(p, 'terrodactyl');
  let s = await st(p, 1);
  ok('terrodactyl on birds: recognised as pterodactyl, explained as another category, no guess used', /pterodactyl/i.test(await hint(p)) && /not this question/.test(await hint(p)) && s.rounds[0].guesses.length === 0, await hint(p));
  await p.close();

  // Day 3: Name something you wear, then Name a job.
  p = await open(3); await toQuestion(p, 3, 'clothing'); await p.waitForTimeout(800);
  ok('the question says how brands are counted before you answer', /Brands and models count as the thing they are/.test(await p.textContent('#q-hint')), await p.textContent('#q-hint'));
  await enter(p, 'Nike');
  const r0 = (await st(p, 3)).rounds.find(r => r.key === 'clothing');
  ok('a vague brand (Nike) is asked about, at no cost', /makes several things/.test(await hint(p)) && r0.guesses.length === 0, await hint(p));
  await enter(p, 'Rolex Submariner');
  ok('a model counts as the thing it is, and says so', /Accepted as: watch \(Rolex Submariner\)/.test(await hint(p)), await hint(p));
  await p.waitForTimeout(2500); await enter(p, 'Cartier watch');
  ok('the same item by another brand is the same answer: no guess used', /already discovered this answer \(watch\)/.test(await hint(p)), await hint(p));
  await enter(p, 'cummerbund'); await p.waitForTimeout(2500);
  await p.click('#finish').catch(() => {}); await p.waitForFunction(() => (JSON.parse(localStorage.getItem('iceberg-pt:game:3') || '{}').phase) === 'done', null, { timeout: 30000 }); await p.waitForTimeout(800);
  const rows = await p.evaluate(() => [...document.querySelectorAll('#sum li')].map(l => l.innerText.replace(/\n/g, ' | ')));
  ok('the results list everything typed, including the brand that needed more detail', rows.some(x => /Nike/.test(x) && /full name|not sent|Needed/i.test(x)) && rows.some(x => /watch/.test(x) && /Rolex Submariner/.test(x)), rows.join(' || '));
  await p.click('#next'); await p.waitForTimeout(1800);
  await toQuestion(p, 3, 'jobs');
  await enter(p, 'quant traiding');
  ok('a slip inside a job name is corrected and counted', /Accepted as: quantitative trader/.test(await hint(p)), await hint(p));
  await p.close();
  ok('no page errors', !errs.length, errs.slice(0, 3).join(' | '));
  await b.close(); site.close(); fs.rmSync(out, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
