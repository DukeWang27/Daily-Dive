// Days after the original bank: if the database has no prepared content (or predates 0006), the game plays the same rotation the server scores.
const { chromium, serve } = require('./lib.cjs');
(async () => {
  const site = serve(8784), b = await chromium.launch(); let ok = 0, bad = 0;
  for (const [status, body, label] of [[404, '{"code":"PGRST202"}', 'function missing (old database)'], [200, 'null', 'no prepared content']]) {
    const p = await b.newPage(); let hit = 0;
    await p.route('**/rest/v1/rpc/day_content', r => { hit++; r.fulfill({ status, contentType: 'application/json', body }); });
    await p.route('http://fake.test/**', r => r.request().url().includes('day_content') ? r.fallback() : r.abort());
    await p.goto('http://localhost:8784/?test&reset&day=16&api=http://fake.test&key=x');
    const t = await p.waitForFunction(() => /Couldn.t load/.test(document.querySelector('#play').textContent) ? 'error' : (typeof CATS !== 'undefined' && CATS.length ? CATS[0].prompt : null), null, { timeout: 15000 }).then(h => h.jsonValue()).catch(e => 'timeout');
    const want = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'days', '1.json'))).questions[0].prompt;
    const good = hit > 0 && t === want;
    console.log(good ? 'PASS' : 'FAIL', label, '| rpc calls', hit, '|', String(t).replace(/\s+/g, ' ').slice(0, 90), '| day 1 first prompt:', want);
    good ? ok++ : bad++; await p.close();
  }
  await b.close(); site.close(); console.log(ok, 'passed', bad, 'failed');
})();
