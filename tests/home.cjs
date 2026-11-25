// The title screen, the two modes, the menu and How to play, at every screen size; Practice Dive gone from view.
// Run: node tests/home.cjs   (no database needed; the race landing's signed-in view is covered by race-ui.cjs)
const { chromium, serve, audit, VPS } = require('./lib.cjs');
const R = []; let fails = 0;
const ok = (name, cond, extra = '') => { R.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  [' + extra + ']' : ''}`); if (!cond) fails++; };
const SITE = 'http://localhost:8831/';
const junk = p => p.evaluate(() => { const t = document.body.innerText; const m = t.match(/\bnull\b|\bundefined\b|\[object|NaN\b/); return m ? m[0] : ''; });
(async () => {
  const site = serve(8831), b = await chromium.launch();
  for (const vp of ['desk', 'wide', 'tablet', 'phone', 'small']) {
    const ctx = await b.newContext({ viewport: VPS[vp], hasTouch: vp === 'phone' || vp === 'small' }), p = await ctx.newPage(), errs = [];
    p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
    await p.goto(SITE + '?test&reset'); await p.waitForFunction(() => !document.querySelector('#play').disabled); await p.waitForTimeout(900);
    const T = s => `${vp}: ${s}`;
    // The title screen.
    const home = await p.evaluate(() => {
      const box = el => { const r = document.querySelector(el).getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height }; };
      const vis = el => { const n = document.querySelector(el); return !!n && n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden'; };
      return { play: box('#play'), word: box('.wordmark'), modes: vis('#modes'), daily: document.querySelector('.mode[data-mode="daily"]').getAttribute('aria-current'), race: vis('.mode[data-mode="race"]'),
        practice: !!document.querySelector('#practice') || /practice/i.test(document.querySelector('[data-screen="home"]').innerText),
        tiersShown: [...document.querySelectorAll('[data-screen="home"] .depths li')].filter(l => l.offsetParent).length,
        scroll: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight + 1, status: document.querySelector('#home-day').textContent,
        h: innerHeight, w: innerWidth, frame: getComputedStyle(document.querySelector('#scene')).boxShadow + getComputedStyle(document.querySelector('#scene')).borderRadius };
    });
    ok(T('the name, the premise and Play are all on screen without scrolling'), home.play.b <= home.h && home.play.t > 0 && home.word.t > 0 && !home.scroll, JSON.stringify(home.play));
    ok(T('both modes are in the header; Daily Dive is the one shown'), home.modes && home.race && home.daily === 'page');
    ok(T('no Practice Dive anywhere on the title screen'), !home.practice);
    ok(T('the six depth zones are not spelled out on the title screen'), home.tiersShown === 0);
    ok(T('the iceberg has no frame round it'), !/rgba|px [1-9]/.test(home.frame.replace('none', '')) || home.frame.startsWith('none'), home.frame);
    ok(T('status line: day and question count'), /^Daily #\d+ · 5 questions/.test(home.status), home.status);
    ok(T('title screen layout: nothing clipped or off-screen'), !(await audit(p, '[data-screen="home"], header')).length, (await audit(p, '[data-screen="home"], header')).join('; '));
    ok(T('no null, undefined or NaN on the title screen'), !(await junk(p)), await junk(p));
    // Tip and Play button don't overlap the words (phones: the iceberg rises behind the text).
    const clash = await p.evaluate(() => { const c = document.querySelector('#scene-art'), m = new DOMMatrix(getComputedStyle(c).transform), W = window.Iceberg.WORLD; const tipY = m.f + 42 * m.a, tipX = m.e + W.WW / 2 * m.a;
      const words = [...document.querySelectorAll('.title-block .wordmark, .title-block .tagline, .title-block .premise')].filter(n => n.offsetParent).map(n => n.getBoundingClientRect());
      return words.some(r => tipX > r.left && tipX < r.right && tipY < r.bottom - 4) ? 'tip under text' : ''; });
    ok(T('the iceberg\'s tip stays clear of the words'), !clash, clash);
    // How to play: opens, holds the six zones, closes with Escape and gives focus back.
    await p.click('#howto-btn'); await p.waitForTimeout(350);
    const how = await p.evaluate(() => ({ open: document.querySelector('#howto').open, zones: document.querySelectorAll('#howto .depths li').length, text: document.querySelector('#howto').innerText }));
    ok(T('How to play opens, with all six depth zones and the race explained'), how.open && how.zones === 6 && /Challenger Deep/.test(how.text) && /Submarine Race/i.test(how.text) && /seconds a question|no clock/.test(how.text));
    ok(T('How to play fits the screen'), await p.evaluate(() => { const r = document.querySelector('#howto').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight + 1; }));
    await p.keyboard.press('Escape'); await p.waitForTimeout(250);
    ok(T('Escape closes How to play'), !(await p.evaluate(() => document.querySelector('#howto').open)));
    ok(T('after reading it once, the link no longer says "New here?"'), (await p.textContent('#howto-label')) === 'How to play');
    // The menu.
    await p.click('#menu-btn'); await p.waitForTimeout(200);
    const menu = await p.evaluate(() => ({ open: !document.querySelector('#menu-panel').hidden, items: [...document.querySelectorAll('#menu-panel [data-go], #menu-panel a')].map(n => n.textContent.trim()), r: document.querySelector('#menu-panel').getBoundingClientRect().toJSON() }));
    ok(T('menu: how to play, dive log, friends, rankings, sign in, settings, privacy'), menu.open && ['How to play', 'Dive log', 'Friends', 'Rankings', 'Sign in', 'Settings', 'Privacy'].every(x => menu.items.includes(x)), menu.items.join(', '));
    ok(T('menu fits on screen'), menu.r.left >= 0 && menu.r.right <= VPS[vp].width && menu.r.bottom <= VPS[vp].height, JSON.stringify(menu.r));
    await p.keyboard.press('Escape'); ok(T('Escape closes the menu'), await p.evaluate(() => document.querySelector('#menu-panel').hidden));
    await p.click('#menu-btn'); await p.click('#menu-panel [data-go="ranks"]'); await p.waitForSelector('[data-screen="hub"]:not([hidden])'); await p.waitForTimeout(300);
    ok(T('menu → Rankings opens the rankings'), /ranks/.test(await p.evaluate(() => location.hash)) && await p.evaluate(() => document.querySelector('#modes').getClientRects().length > 0));
    ok(T('rankings page: nothing clipped, no null text'), !(await audit(p)).length && !(await junk(p)), (await audit(p)).join('; ') + (await junk(p)));
    // Modes: Submarine Race, then back to Daily Dive.
    const t0 = Date.now(); await p.click('.mode[data-mode="race"]'); await p.waitForSelector('[data-screen="race"]:not([hidden])'); const raceMs = Date.now() - t0;
    await p.waitForTimeout(1400);
    const race = await p.evaluate(() => ({ cur: document.querySelector('.mode[data-mode="race"]').getAttribute('aria-current'), text: document.querySelector('#rdock').innerText, subs: Race.scene.subs.length, title: document.querySelector('.r-title') && document.querySelector('.r-title').textContent }));
    ok(T('Submarine Race opens its own landing at once, marked as the current mode'), race.cur === 'page' && race.title === 'Race to the bottom' && raceMs < 1500, raceMs + ' ms');
    ok(T('race landing: the rules in three lines, and a fleet of submarines diving behind'), /Up to 8 subs/.test(race.text) && /Deepest wins/.test(race.text) && race.subs === 4, race.subs + ' subs');
    ok(T('race landing without a database says so plainly'), /isn't connected/.test(race.text));
    ok(T('race landing: nothing clipped or off-screen, no null text'), !(await audit(p, '#rdock, header')).length && !(await junk(p)), (await audit(p, '#rdock, header')).join('; '));
    await p.click('.mode[data-mode="daily"]'); await p.waitForSelector('[data-screen="home"]:not([hidden])'); await p.waitForTimeout(300);
    ok(T('Daily Dive goes back to the title screen'), await p.evaluate(() => document.querySelector('.mode[data-mode="daily"]').getAttribute('aria-current') === 'page' && !location.hash));
    // In a question, the modes and the menu step aside.
    await p.click('#play'); await p.waitForSelector('[data-screen="play"]:not([hidden])'); await p.waitForTimeout(500);
    ok(T('during a question, the mode switch and menu are out of the way'), await p.evaluate(() => document.querySelector('#modes').getClientRects().length === 0 && document.querySelector('#menu-btn').getClientRects().length === 0));
    ok(T('no page errors'), !errs.length, errs.join(' | '));
    await ctx.close();
  }
  // Practice is still there for testing and recordings, by address only.
  { const p = await (await b.newContext({ viewport: VPS.desk })).newPage(); await p.goto(SITE + '?test&reset&practice'); await p.waitForFunction(() => !document.querySelector('#play').disabled);
    await p.evaluate(() => Game.store.set('day:' + Game.today(), { v: 3, day: Game.today(), total: 500, rounds: [] })); await p.evaluate(() => Game.home()); await p.click('#play'); await p.waitForTimeout(500);
    ok('?practice: a practice dive can still be started for testing', await p.evaluate(() => ICEBERG_TEST.state && ICEBERG_TEST.state.practice === true)); await p.context().close(); }
  // Reduced motion: everything still there, nothing animates.
  { const p = await (await b.newContext({ viewport: VPS.phone, reducedMotion: 'reduce' })).newPage(); await p.goto(SITE + '?test&reset'); await p.waitForFunction(() => !document.querySelector('#play').disabled);
    ok('reduced motion: the title screen shows fully, with no animation running', await p.evaluate(() => getComputedStyle(document.querySelector('.title-block')).animationName === 'none' && getComputedStyle(document.querySelector('#scene-art')).opacity === '1'));
    await p.context().close(); }
  console.log(R.join('\n')); console.log(`\n${R.length - fails} passed, ${fails} failed`);
  await b.close(); site.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
