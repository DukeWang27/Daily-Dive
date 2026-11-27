// The question review dashboard in the private playtest (review.js): opens from the bar, lists and searches every
// question, finds an answer across all questions, records decisions, added and flagged answers (kept after a reload),
// and shows answers reported from the results screen with the game's own verdict.
// Usage: node tests/review.cjs
const { chromium, serve } = require('./lib.cjs');
const fs = require('fs'), path = require('path'), os = require('os'), { execFileSync } = require('child_process');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('PASS  ' + name); } else { fail++; console.log('FAIL  ' + name + (extra ? '  [' + extra + ']' : '')); } };
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'review-'));
execFileSync('python3', [path.join(__dirname, '..', 'tools/playtest/build.py'), out]);

(async () => {
  const site = serve(8871), b = await chromium.launch(), errs = [];
  for (const vp of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    const tag = vp.width > 600 ? 'desk' : 'phone', p = await b.newPage({ viewport: vp });
    p.on('pageerror', e => errs.push(e.message));
    await p.route('**/pt/**', r => { const f = path.join(out, 'pt', path.basename(new URL(r.request().url()).pathname)); fs.existsSync(f) ? r.fulfill({ path: f, contentType: 'application/json' }) : r.fulfill({ status: 404 }); });
    await p.route(/supabase\.co/, r => r.abort());
    await p.goto('http://localhost:8871/?playtest&day=3'); await p.evaluate(() => localStorage.clear()); await p.goto('http://localhost:8871/?playtest&day=3');
    await p.waitForFunction(() => !document.querySelector('#play').disabled);
    // Report an answer from the results first, so the Reports tab has something.
    await p.click('#play'); await p.waitForTimeout(2200);
    await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('iceberg-pt:game:3')); });
    await p.fill('#answer', 'glorbwizzle'); await p.press('#answer', 'Enter'); await p.waitForTimeout(600);
    await p.click('#finish').catch(() => {}); await p.waitForFunction(() => JSON.parse(localStorage.getItem('iceberg-pt:game:3') || '{}').phase === 'done', null, { timeout: 15000 });
    await p.waitForTimeout(600); await p.click('#sum .dispute');
    const rep = await p.evaluate(() => window.PTReports ? window.PTReports() : []);
    ok(`${tag}: an answer reported from the results is kept with the question and the game's verdict`, rep.length === 1 && rep[0].text === 'glorbwizzle' && rep[0].key && /review|pending|Waiting/i.test(rep[0].result + rep[0].reason + rep[0].kind), JSON.stringify(rep));
    if (await p.locator('.pt-tog').isVisible() && await p.evaluate(() => document.querySelector('.pt-bar').classList.contains('pt-min'))) await p.click('.pt-tog');
    await p.click('.pt-bar button:has-text("Review")'); await p.waitForSelector('.rv-row', { timeout: 20000 });
    // The Editorial v2 tab opens first, sorted by what needs a decision; each question shows its rubric and test.
    const ed = await p.textContent('.rv-count');
    ok(`${tag}: the editorial tab opens first with the new questions (v2 and v3)`, +((ed.match(/^(\d+) questions/) || [])[1] || 0) >= 70, ed);
    await p.click('.rv-row >> nth=0'); await p.waitForSelector('.rv-decide');
    const det = await p.textContent('.rv-body');
    ok(`${tag}: an editorial question shows its decision buttons, quality, method and independent test`, /Approve/.test(det) && /Rewrite/.test(det) && /Validation:/.test(det) && /Independent test/.test(det), det.slice(0, 200));
    await p.click('.rv-st.approved'); const dd = await p.evaluate(() => Object.values(JSON.parse(localStorage.getItem('iceberg-pt:review') || '{}')).filter(x => x.ed));
    ok(`${tag}: an editorial decision is saved`, dd.length === 1 && dd[0].ed === 'approve', JSON.stringify(dd));
    await p.click('.rv-back'); await p.click('.rv-tabs button:has-text("Questions")'); await p.waitForSelector('.rv-search');
    const count = await p.textContent('.rv-count');
    ok(`${tag}: the dashboard lists the whole bank`, /of (\d{3,}) questions/.test(count) && +count.match(/of (\d+) questions/)[1] > 500, count);
    await p.fill('.rv-search', 'name a job'); await p.waitForTimeout(200);
    await p.click('.rv-row'); await p.waitForSelector('.rv-ans');
    ok(`${tag}: a question opens with its answers, rules and checks`, /Name a job/.test(await p.textContent('.rv h2')) && (await p.locator('.rv-ans').count()) > 50);
    await p.click('.rv-st.approved'); await p.fill('.rv-add input >> nth=0', 'quantitative strategist'); await p.click('.rv-add button');
    p.once('dialog', d => d.accept('not a job title'));
    await p.click('.rv-ans .rv-link >> nth=0'); await p.waitForTimeout(300);
    const d = await p.evaluate(() => JSON.parse(localStorage.getItem('iceberg-pt:review') || '{}'));
    const j = Object.values(d).find(x => x.id === 'jobs');
    ok(`${tag}: approve, add an answer and flag one are all saved`, j && j.status === 'approved' && j.added.some(a => a.a === 'quantitative strategist') && Object.keys(j.flagged).length === 1, JSON.stringify(j));
    await p.click('.rv-back');
    await p.click('.rv-tabs button:has-text("Find an answer")'); await p.fill('.rv-search', 'accountant'); await p.waitForTimeout(300);
    ok(`${tag}: one answer can be found across every question`, (await p.locator('.rv-row').count()) >= 1 && /accountant/.test(await p.textContent('.rv-list')));
    await p.click('.rv-tabs button:has-text("Reported")');
    ok(`${tag}: the reported answer is listed, with a way to add it`, /glorbwizzle/.test(await p.textContent('.rv-body')) && (await p.locator('.rv-body button:has-text("add to this question")').count()) === 1);
    await p.click('.rv-tabs button:has-text("Weakest")');
    ok(`${tag}: the weakest coverage is listed`, (await p.locator('.rv-row').count()) > 20);
    if (process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}/review-${tag}.png` });
    await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    ok(`${tag}: Escape closes it`, (await p.locator('.rv').count()) === 0);
    await p.reload(); await p.waitForFunction(() => !document.querySelector('#play').disabled);
    ok(`${tag}: decisions survive a reload`, /approved/.test(await p.evaluate(() => localStorage.getItem('iceberg-pt:review'))));
    await p.close();
  }
  ok('no page errors', !errs.length, errs.slice(0, 3).join(' | '));
  await b.close(); site.close(); fs.rmSync(out, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
