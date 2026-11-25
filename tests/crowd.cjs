// "You and 3 others said this": the crowd line after a question, from real counts only. A stand-in database answers
// round_counts; the line must follow it exactly, and must not appear when too few real players have answered.
const { chromium, serve, VPS } = require('./lib.cjs');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('PASS  ' + name); } else { fail++; console.log('FAIL  ' + name + (extra ? '  [' + extra + ']' : '')); } };

(async () => {
  const site = serve(8801), b = await chromium.launch();
  const run = async (players, counts) => {
    const p = await (await b.newContext({ viewport: VPS.desk })).newPage();
    await p.route('http://fake.test/**', r => {
      const u = r.request().url();
      if (u.includes('round_counts')) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ players, counts }) });
      if (u.includes('day_content')) return r.fulfill({ status: 200, contentType: 'application/json', body: 'null' });
      return r.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });
    await p.goto('http://localhost:8801/?test&reset&fast&day=1&api=http://fake.test&key=x'); await p.waitForSelector('#play:not([disabled])');
    await p.click('#play'); await p.waitForTimeout(400);
    const answer = async w => { await p.fill('#answer', w); await p.press('#answer', 'Enter'); await p.waitForTimeout(900); };
    await answer('raven'); await answer('eagle');
    await p.evaluate(() => document.querySelector('#finish').click());
    await p.waitForFunction(() => !document.querySelector('#done-panel').hidden); await p.waitForTimeout(1200);
    const lines = await p.evaluate(() => [...document.querySelectorAll('#sum li')].map(li => li.innerText.replace(/\s+/g, ' ')));
    const note = await p.evaluate(() => document.querySelector('.ib-meta') ? document.querySelector('.ib-meta').textContent : '');
    await p.context().close();
    return { lines, note };
  };
  const live = await run(40, { raven: 1, eagle: 12 });
  ok('alone: "Nobody else said this" when you were the only one', /raven.*Nobody else said this/i.test(live.lines[0]), live.lines[0]);
  ok('others: "You and 11 others said this" from the real count', /eagle.*You and 11 others said this/i.test(live.lines[1]), live.lines[1]);
  const few = await run(12, { raven: 1, eagle: 5 });
  ok('too few real players: no crowd line at all (never made up)', few.lines.every(l => !/said this/.test(l)), few.lines.join(' / '));
  const none = await run(0, {});
  ok('no simulated player counts in the answer note', !/50,000/.test(none.note), none.note);
  await b.close(); site.close();
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.log('STOPPED: ' + e.message); process.exit(1); });
