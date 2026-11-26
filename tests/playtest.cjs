// The private playtest build (?playtest): day picker, switching day, replay, playing a question, notes kept, and no
// request to the live database. Day files come from tools/playtest/build.py, built into a temp folder.
// Usage: node tests/playtest.cjs
const { chromium, serve } = require('./lib.cjs');
const fs = require('fs'), path = require('path'), os = require('os'), { execFileSync } = require('child_process');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('PASS  ' + name); } else { fail++; console.log('FAIL  ' + name + (extra ? '  [' + extra + ']' : '')); } };
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-'));
execFileSync('python3', [path.join(__dirname, '..', 'tools/playtest/build.py'), out]);
const shots = process.env.SHOTS || '';

(async () => {
  const site = serve(8791), b = await chromium.launch();
  for (const vp of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    const tag = vp.width > 600 ? 'desk' : 'phone', p = await b.newPage({ viewport: vp }), errs = [], remote = [];
    p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await p.route('**/pt/**', r => { const f = path.join(out, 'pt', path.basename(new URL(r.request().url()).pathname)); fs.existsSync(f) ? r.fulfill({ path: f, contentType: 'application/json' }) : r.fulfill({ status: 404 }); });
    await p.route(/supabase\.co|fake\.test/, r => { remote.push(r.request().url()); r.abort(); });
    await p.goto('http://localhost:8791/?playtest'); await p.waitForSelector('.pt-bar'); await p.waitForFunction(() => !document.querySelector('#play').disabled);
    ok(`${tag}: home offers day 1`, /Play day 1/.test(await p.textContent('#play')), await p.textContent('#play'));
    const tab = async () => { if (await p.locator('.pt-tog').isVisible() && await p.evaluate(() => document.querySelector('.pt-bar').classList.contains('pt-min'))) await p.click('.pt-tog'); };
    await tab(); await p.click('.pt-day'); await p.waitForSelector('.pt-row');
    const rows = await p.locator('.pt-row').count(), groups = await p.locator('.pt-days h4').allTextContents();
    ok(`${tag}: picker lists every day, grouped`, rows >= 107 && groups.length >= 3, `${rows} ${groups}`);
    await p.fill('.pt-filter', 'bookmark'); ok(`${tag}: search narrows the list`, (await p.locator('.pt-row').count()) >= 1 && (await p.locator('.pt-row').count()) < 5);
    if (shots) await p.screenshot({ path: `${shots}/pt-days-${tag}.png` });
    await p.click('.pt-row:has-text("Day 101")'); await p.waitForFunction(() => !document.querySelector('#play').disabled && /101/.test(document.querySelector('.pt-day').textContent));
    ok(`${tag}: switched to day 101`, /Play day 101/.test(await p.textContent('#play')));
    await p.click('#play'); await p.waitForFunction(() => window.Game.screen === 'play' && !document.querySelector('#answer').disabled, null, { timeout: 15000 });
    ok(`${tag}: first question is the new sample's, with no hint that gives answers away`, await p.evaluate(() => /bookmark/i.test(window.Game.cats[0].prompt) && window.Game.cats.every(c => !c.hint)));
    await p.waitForTimeout(1200);
    for (const g of ['receipt', 'bacon']) { await p.fill('#answer', g); await p.press('#answer', 'Enter'); await p.waitForTimeout(4000); }
    const g = await p.evaluate(() => JSON.parse(localStorage.getItem('iceberg-pt:game:101')).rounds[0].guesses.map(x => x.status + ':' + x.name));
    ok(`${tag}: guesses count`, g.length === 2 && g.every(x => x.startsWith('ok:')), g.join(' '));
    if (shots) await p.screenshot({ path: `${shots}/pt-play-${tag}.png` });
    if (tag === 'phone') { await p.locator('.pt-tog').waitFor(); const bar = await p.locator('.pt-bar').boundingBox(), next = await p.locator('#finish:visible, #next:visible').first().boundingBox().catch(() => null);
      ok('phone: folded, the tab clears the question and the bottom button', !next || bar.y + bar.height <= next.y || bar.y >= next.y + next.height, JSON.stringify([bar, next])); }
    await tab(); await p.click('.pt-bar button:has-text("Notes")'); await p.waitForSelector('.pt-notes textarea');
    await p.keyboard.type('Bacon should be deeper.'); await p.keyboard.press('Enter'); await p.keyboard.type('Good prompt.'); await p.waitForTimeout(800);
    const notes = await p.evaluate(() => JSON.parse(localStorage.getItem('iceberg-pt:notes') || '{}'));
    ok(`${tag}: question note saved, Enter didn't move the game on`, notes['d101-q1'] && /deeper\.\nGood/.test(notes['d101-q1'].text) && await p.evaluate(() => window.Game.round) === 0, JSON.stringify(notes));
    if (shots) await p.screenshot({ path: `${shots}/pt-notes-${tag}.png` });
    await p.keyboard.press('Escape');
    // Replay starts day 101 again from the top.
    await tab(); await p.click('.pt-bar button:has-text("Replay")'); await p.waitForFunction(() => !document.querySelector('#play').disabled && window.Game.screen === 'home');
    ok(`${tag}: replay returns to a fresh day 101`, /Play day 101/.test(await p.textContent('#play')) && !(await p.evaluate(() => localStorage.getItem('iceberg-pt:game:101'))));
    ok(`${tag}: notes survive the replay`, !!(await p.evaluate(() => localStorage.getItem('iceberg-pt:notes'))).includes('deeper'));
    await tab(); await p.click('.pt-bar button:has-text("Next")'); await p.waitForFunction(() => /102/.test((document.querySelector('.pt-day') || {}).textContent || ''));
    ok(`${tag}: next goes to day 102`, true);
    ok(`${tag}: no request to the live database`, remote.length === 0, remote.join(' '));
    ok(`${tag}: no page errors`, errs.length === 0, errs.join(' | '));
    ok(`${tag}: real game storage untouched`, await p.evaluate(() => Object.keys(localStorage).every(k => !k.startsWith('iceberg:'))), await p.evaluate(() => Object.keys(localStorage).join(',')));
    await p.close();
  }
  // The live game ignores all of it.
  const p = await b.newPage(); await p.goto('http://localhost:8791/?test'); await p.waitForFunction(() => !document.querySelector('#play').disabled);
  ok('normal game: no playtest bar', (await p.locator('.pt-bar').count()) === 0);
  await b.close(); site.close(); fs.rmSync(out, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
