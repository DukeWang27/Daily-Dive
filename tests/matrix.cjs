// Full play-through checks for the three-guess game. Needs Node and Playwright.
// Run from the project folder:  node tests/matrix.cjs            (everything, about 3 minutes)
//                               node tests/matrix.cjs audio,sizes (parts: desk, phone, edge, reload, review, audio, timing, sizes, daily)
const { chromium, serve, open, audit } = require('./lib.cjs');
const R = []; let fails = 0;
const ok = (name, cond, extra = '') => { R.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  [' + extra + ']' : ''}`); if (!cond) fails++; };
const URL = 'http://localhost:8782/';
// All play-through checks use days/0.json, a fixed set of five questions, so they don't change with the calendar.
const S = p => p.evaluate(() => { const st = ICEBERG_TEST.state, r = st && st.rounds[st.round]; return st ? { round: st.round, phase: st.phase, n: r.guesses.length, status: r.guesses.map(g => g.status), names: r.guesses.map(g => g.name || g.typed), shares: r.guesses.map(g => g.share), misses: r.misses, busy: ICEBERG_TEST.busy } : null; });
const settle = async p => { await p.waitForFunction(() => !ICEBERG_TEST.busy, null, { timeout: 10000 }); await p.waitForTimeout(250); };
const enter = async (p, text) => { await p.fill('#answer', text); await p.keyboard.press('Enter'); await p.waitForTimeout(60); };
const guess = async (p, text) => { await enter(p, text); await settle(p); };
const waitDone = p => p.waitForFunction(() => ICEBERG_TEST.state && ICEBERG_TEST.state.phase === 'done', null, { timeout: 10000 });
const hint = p => p.textContent('#hint');
// Nothing on the iceberg overlaps: visible labels, the card and markers.
const overlaps = p => p.evaluate(() => {
  const vis = n => { const cs = getComputedStyle(n); return !n.classList.contains('dim') && cs.display !== 'none' && +cs.opacity > 0.05; };
  const box = n => n.getBoundingClientRect(), hit = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
  const ib = box(document.querySelector('#ib')), pills = [...document.querySelectorAll('.ib-pill')].filter(vis), card = document.querySelector('.ib-card'), marks = [...document.querySelectorAll('.ib-mark')].filter(vis), out = [];
  pills.forEach((a, i) => pills.slice(i + 1).forEach(b => { if (hit(box(a), box(b))) out.push(`labels overlap: ${a.textContent} / ${b.textContent}`); }));
  if (card) { const c = box(card); pills.forEach(a => { if (hit(box(a), c)) out.push('label under card: ' + a.textContent); }); marks.forEach(m => { if (!m.classList.contains('focus') && hit(box(m), c)) out.push('marker under card'); });
    if (c.left < ib.left - 1 || c.right > ib.right + 1 || c.top < ib.top - 1 || c.bottom > ib.bottom + 1) out.push('card clipped by the frame'); const hud = document.querySelector('.ib-hud.on'); if (hud && getComputedStyle(hud).display !== 'none' && hit(box(hud), c)) out.push('card over depth gauge'); }
  marks.forEach((a, i) => marks.slice(i + 1).forEach(b => { if (hit(box(a), box(b))) out.push('markers overlap'); }));
  return out; });
const slots = p => p.$$eval('#slots .slot', els => els.map(e => ({ cls: e.className.replace('slot ', ''), text: e.innerText.replace(/\n/g, ' | ') })));
async function fresh(b, vp, extra = '') { const p = await open(b, vp, URL + '?test&day=0&fast&reset' + extra); await p.evaluate(() => { window.__snd = []; const o = Sound.play; Sound.play = (n, a) => { window.__snd.push(n); return o(n, a); }; }); return p; }
const start = async p => { await p.click('#play'); await p.waitForSelector('[data-screen="play"]:not([hidden])'); await p.waitForTimeout(500); };

async function fullGame(b, vp) {
  const T = s => `${vp}: ${s}`, p = await fresh(b, vp);
  const home = await p.evaluate(() => document.querySelector('[data-screen="home"]').innerText);
  ok(T('home explains the new game, with no timer or speed talk'), /Three guesses/.test(home) && /How deep can you go/.test(home) && !/second|timer|as many as/i.test(home), home.replace(/\n+/g, ' ').slice(0, 90));
  ok(T('home layout'), !(await audit(p)).length, (await audit(p)).join('; '));
  await start(p);
  let st = await slots(p);
  ok(T('q1: three slots, first one ready, none used'), st.length === 3 && /next/.test(st[0].cls) && /empty/.test(st[1].cls) && /empty/.test(st[2].cls), st.map(s => s.cls).join(','));
  ok(T('q1: no timer on screen'), await p.evaluate(() => !document.querySelector('#time-left, .timer, .clock')));
  ok(T('q1: iceberg fills a large part of the screen'), await p.evaluate(() => { const r = document.querySelector('#ib').getBoundingClientRect(); return r.width * r.height / (innerWidth * innerHeight) > 0.3; }), await p.evaluate(() => { const r = document.querySelector('#ib').getBoundingClientRect(); return Math.round(100 * r.width * r.height / (innerWidth * innerHeight)) + '% of the window'; }));
  ok(T('q1: play layout'), !(await audit(p)).length, (await audit(p)).join('; '));

  // Q1: three progressively rarer answers.
  const inputY = (await p.locator('#answer').boundingBox()).y; const depths = [], hints = [], huds = [];
  for (const a of ['kangaroo', 'octopus', 'axolotl']) { await guess(p, a); await p.waitForTimeout(350); depths.push(await p.evaluate(() => ICEBERG_TEST.berg.depth)); hints.push(await hint(p)); huds.push(await p.textContent('.ib-depth')); ok(T(`q1 ${a}: nothing overlaps on the iceberg`), !(await overlaps(p)).length, (await overlaps(p)).join('; ')); if (a === 'octopus') await p.screenshot({ path: `tests/shot-${vp}-play.png` }); }
  ok(T('q1 rarer each time: camera goes deeper each guess'), depths[0] > 0 && depths[1] > depths[0] && depths[2] > depths[1], depths.join(' < '));
  ok(T('q1: depth gauge matches each answer'), huds.every((h, i) => h === depths[i] + ' m'), huds.join(', '));
  ok(T('q1: feedback says first depth, then "New deepest" twice'), /m down\. Can you go deeper/.test(hints[0]) && /New deepest: \d+ m, \d+ m further down/.test(hints[1]) && /New deepest/.test(hints[2]), hints.join(' || '));
  ok(T('q1: input stayed in place and focused'), Math.abs((await p.locator('#answer').boundingBox()).y - inputY) < 1 && await p.evaluate(() => document.activeElement.id === 'answer'));
  st = await slots(p);
  ok(T('q1: slots show name, share, zone and depth; the third is marked deepest'), st.every(s => /done/.test(s.cls) && /%/.test(s.text) && /\d+m/.test(s.text)) && /best/.test(st[2].cls) && !/best/.test(st[0].cls) && /Deepest/i.test(st[2].text) && /Midwater/.test(st[0].text), st.map(s => s.text).join(' || '));
  ok(T('q1: all three markers stay on the iceberg'), await p.evaluate(() => document.querySelectorAll('.ib-mark').length === 3));
  await waitDone(p); await p.waitForTimeout(400);
  let d = await p.evaluate(() => ({ best: document.querySelector('#best-name').textContent, depth: document.querySelector('#best-depth').textContent, rows: document.querySelectorAll('#sum li').length, bars: [...document.querySelectorAll('#common li, #rare li')].map(l => l.innerText.replace(/\n/g, ' ')), players: document.querySelector('#players').textContent, sample: !document.querySelector('#sample-note').hidden, meta: document.querySelector('#top-meta').textContent }));
  ok(T('q1 results: deepest answer and its depth are the score'), d.best === 'axolotl' && d.depth === depths[2] + 'm' && d.meta === depths[2] + ' m', `${d.best} ${d.depth} / header ${d.meta}`);
  ok(T('q1 results: 5 common + 5 rare with % and player counts, labelled sample data'), d.bars.length === 10 && d.bars.every(x => /%\s*·\s*[\d,]+/.test(x)) && /Sample data · 50,000 simulated players/.test(d.players) && d.sample, d.bars[0] + ' ... ' + d.bars[9]);
  ok(T('q1 results layout'), !(await audit(p)).length, (await audit(p)).join('; '));
  await p.screenshot({ path: `tests/shot-${vp}-done.png` });
  // Compare guesses without replaying.
  await p.click('#sum li:nth-child(1) .sum-row'); await p.waitForFunction(() => document.querySelector('.ib-card.in .ib-name')?.textContent === 'kangaroo', null, { timeout: 6000 });
  ok(T('q1 results: tapping a guess flies the camera to it'), true);
  ok(T('q1 results: still nothing overlapping'), !(await overlaps(p)).length, (await overlaps(p)).join('; '));
  await p.click('#next');

  // Q2: the rarest answer first, then two more common ones.
  await p.waitForFunction(() => ICEBERG_TEST.state.round === 1 && ICEBERG_TEST.state.phase === 'play'); await p.waitForTimeout(500);
  ok(T('q2: other players\' answers are hidden while guessing'), await p.evaluate(() => document.querySelector('#done-panel').hidden && !/banana|Everyone/.test(document.querySelector('[data-screen="play"]').innerText)));
  const d2 = [], h2 = [];
  for (const a of ['jabuticaba', 'apple', 'kiwi']) { await guess(p, a); await p.waitForTimeout(350); d2.push(await p.evaluate(() => ICEBERG_TEST.berg.depth)); h2.push(await hint(p)); ok(T(`q2 ${a}: nothing overlaps`), !(await overlaps(p)).length, (await overlaps(p)).join('; ')); }
  st = await slots(p);
  ok(T('q2 rarest first: camera rises to the real spot of later guesses (not forced deeper)'), d2[0] > 200 && d2[1] === 0 && d2[2] > 0 && d2[2] < d2[0], d2.join(', '));
  ok(T('q2: first guess stays the deepest; later ones get neutral feedback'), /best/.test(st[0].cls) && !/best/.test(st[1].cls) && !/best/.test(st[2].cls) && /Not deeper\. Your \d+ m still counts\. 1 guess left/.test(h2[1]) && /Not deeper/.test(h2[2]), h2.join(' || '));
  await waitDone(p);
  ok(T('q2: score is still the first guess'), await p.evaluate(() => document.querySelector('#best-name').textContent === 'jabuticaba'), await p.textContent('#best-depth'));
  await p.click('#next');

  // Q3: three progressively more common answers.
  await p.waitForFunction(() => ICEBERG_TEST.state.round === 2 && ICEBERG_TEST.state.phase === 'play'); await p.waitForTimeout(500);
  const d3 = []; for (const a of ['zester', 'whisk', 'fridge']) { await guess(p, a); await p.waitForTimeout(300); d3.push(await p.evaluate(() => ICEBERG_TEST.berg.depth)); }
  ok(T('q3 more common each time: camera climbs back up, best stays first'), d3[0] > d3[1] && d3[1] > d3[2] && /best/.test((await slots(p))[0].cls), d3.join(' > '));
  await waitDone(p); const q3 = await p.textContent('#best-depth'); await p.click('#next');

  // Q4: typo, duplicate, invalid, pending.
  await p.waitForFunction(() => ICEBERG_TEST.state.round === 3 && ICEBERG_TEST.state.phase === 'play'); await p.waitForTimeout(500);
  await enter(p, 'snaek'); let s4 = await S(p);
  ok(T('q4 unclear typo "snaek": asks which answer was meant, no guess used'), s4.n === 0 && /Did you mean snake, snack or sneak\?|Did you mean (snake|snack|sneak)/.test(await hint(p)), await hint(p));
  await guess(p, 'snorkle');
  ok(T('q4 typo "snorkle": corrected to snorkel and placed'), (await S(p)).names[0] === 'snorkel' && /Counted as snorkel/.test(await hint(p)), await hint(p));
  await enter(p, 'Snorkels'); s4 = await S(p);
  ok(T('q4 duplicate "Snorkels": no guess used, no rarity shown again'), s4.n === 1 && /counts as snorkel, which you've already tried/.test(await hint(p)), await hint(p));
  await enter(p, 'apple'); s4 = await S(p);
  ok(T('q4 invalid "apple": reason given, no guess used'), s4.n === 1 && s4.misses === 1 && /Doesn't start with SN\. No guess used/.test(await hint(p)), await hint(p));
  await enter(p, 'snorlax'); s4 = await S(p);
  ok(T('q4 unknown "snorlax": first Enter only warns'), s4.n === 1 && /isn't on today's list\. Enter again sends it for review and uses a guess/.test(await hint(p)), await hint(p));
  await p.keyboard.press('Enter'); await p.waitForTimeout(150); s4 = await S(p); st = await slots(p);
  ok(T('q4 pending: second Enter uses a guess, slot shows pending with no depth or rarity'), s4.n === 2 && s4.status[1] === 'pending' && /pending/.test(st[1].cls) && /Waiting for review/.test(st[1].text) && !/%|\d+m/.test(st[1].text), st[1].text);
  await guess(p, 'snafu');
  await waitDone(p); await p.waitForTimeout(300);
  d = await p.evaluate(() => ({ best: document.querySelector('#best-name').textContent, rows: [...document.querySelectorAll('#sum li')].map(l => l.innerText.replace(/\n/g, ' | ')), note: document.querySelector('#review-note').textContent }));
  ok(T('q4 results: best is snafu; pending and rejected answers listed with dispute buttons'), d.best === 'snafu' && d.rows.length === 4 && d.rows.some(x => /snorlax.*I think this counts/.test(x)) && d.rows.some(x => /apple.*Dispute.*didn't use a guess/.test(x)), d.rows.join(' || '));
  await p.click('#sum .dispute'); await p.waitForTimeout(100);
  ok(T('q4: dispute is recorded and the button locks'), await p.evaluate(() => document.querySelector('#sum .dispute').disabled && JSON.parse(localStorage.getItem('iceberg:flags')).some(f => /dispute/.test(f.kind))));
  ok(T('q4 results layout'), !(await audit(p)).length, (await audit(p)).join('; '));
  await p.screenshot({ path: `tests/shot-${vp}-done-mixed.png` });
  await p.click('#next');

  // Q5: finish early.
  await p.waitForFunction(() => ICEBERG_TEST.state.round === 4 && ICEBERG_TEST.state.phase === 'play'); await p.waitForTimeout(500);
  ok(T('q5: no finish button before the first guess'), await p.evaluate(() => document.querySelector('#finish').hidden));
  await guess(p, 'Ferrari');
  const fin = await p.evaluate(() => ({ hidden: document.querySelector('#finish').hidden, label: document.querySelector('#finish').textContent, note: document.querySelector('#finish-note').textContent }));
  ok(T('q5 finish early: button shows what you keep and how many guesses go unused'), !fin.hidden && /Finish with \d+ m/.test(fin.label) && fin.note === '2 guesses unused', `${fin.label} · ${fin.note}`);
  await p.click('#finish'); await waitDone(p);
  ok(T('q5: finished with one guess, no confirmation step'), (await S(p)).n === 1 && await p.evaluate(() => document.querySelector('#best-name').textContent === 'Ferrari'));
  await p.click('#next');
  await p.waitForSelector('[data-screen="end"]:not([hidden])'); await p.waitForTimeout(700);
  const end = await p.evaluate(() => { const c = document.querySelector('#share-canvas'), g = c.getContext('2d'), px = g.getImageData(0, 0, c.width, c.height).data; let lit = 0; for (let i = 0; i < px.length; i += 4000) if (px[i] + px[i + 1] + px[i + 2] > 60) lit++;
    return { total: document.querySelector('#e-total').textContent, rows: [...document.querySelectorAll('#e-rounds li')].map(l => l.innerText.replace(/\n/g, ' ')), text: document.querySelector('#e-card').textContent, deepest: document.querySelector('#e-deepest').textContent, rank: document.querySelector('#e-rank').textContent, lit, emoji: /\p{Extended_Pictographic}/u.test(document.querySelector('[data-screen="end"]').innerText), icons: document.querySelectorAll('#e-rounds .cat-svg').length }; });
  const sum = depths[2] + d2[0] + (+q3.replace('m', '')) + (await p.evaluate(() => ICEBERG_TEST.depthOf(ICEBERG_TEST.shareOf('snafu', 3)) + ICEBERG_TEST.depthOf(ICEBERG_TEST.shareOf('ferrari', 4))));
  ok(T('end: total is the sum of the five deepest answers'), +end.total.replace(/,/g, '') === sum, `${end.total} = ${sum}`);
  ok(T('end: five rows, deepest find named, custom icons, no emoji'), end.rows.length === 5 && /Deepest find: (axolotl|jabuticaba|zester)/.test(end.deepest) && end.icons === 5 && !end.emoji, end.deepest);
  ok(T('end: no ranking is invented without real players'), end.rank === '');
  ok(T('end: share text is spoiler-free (depths only)'), /^Iceberg #\d+ · [\d,]+ m\n1 [▓░]{10} \d+ m/.test(end.text) && !/axolotl|jabuticaba|zester|snorkel|ferrari|animal|fruit/i.test(end.text), end.text.replace(/\n/g, ' / '));
  ok(T('end: share card image is drawn'), end.lit > 100, `${end.lit} sampled bright pixels`);
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 8000 }).catch(() => null), p.click('#save-card')]);
  ok(T('end: image saves as a PNG'), !!dl && /iceberg-\d+\.png/.test(dl.suggestedFilename()), dl ? dl.suggestedFilename() : 'no download');
  if (dl) await dl.saveAs(`tests/shot-${vp}-card.png`);
  ok(T('end layout'), !(await audit(p)).length, (await audit(p)).join('; '));
  await p.screenshot({ path: `tests/shot-${vp}-end.png` });
  const snd = await p.evaluate(() => window.__snd), need = ['start', 'question', 'submit', 'final', 'travel', 'reveal', 'deeper', 'neutral', 'rare', 'round', 'day', 'duplicate', 'invalid', 'pending', 'click'];
  ok(T('every moment has its sound; no countdown sounds remain'), need.every(n => snd.includes(n)) && !snd.includes('tick') && !snd.includes('timeup'), need.filter(n => !snd.includes(n)).join(',') || `${snd.length} sound calls`);
  ok(T('no console or page errors'), !p.errs.length, p.errs.join(' | '));
  await p.goto(URL + '?test&day=0&fast'); await p.waitForSelector('#play');
  ok(T('coming back: results button, practice, streak'), await p.evaluate(() => /See today/.test(document.querySelector('#play').textContent) && !document.querySelector('#practice').hidden && /1-day streak/.test(document.querySelector('#home-streak').textContent)));
  await p.context().close();
}

async function edge(b) {
  // Three answers with identical rarity.
  let p = await fresh(b, 'desk'); await start(p);
  const same = await p.evaluate(async () => { const cats = (await (await fetch('days/0.json')).json()).questions, by = {}; for (const r of cats[0].answers) if (!r.x && !/ /.test(r.a)) (by[r.s] = by[r.s] || []).push(r.a); return Object.values(by).filter(v => v.length >= 3).sort((a, b) => 0)[0].slice(0, 3); });
  const hs = []; for (const a of same) { await guess(p, a); await p.waitForTimeout(350); hs.push(await hint(p)); ok(`identical rarity (${a}): labels and markers don't overlap`, !(await overlaps(p)).length, (await overlaps(p)).join('; ')); }
  let s = await S(p), st = await slots(p);
  ok('identical rarity: all three sit at the same depth, the first stays the deepest', new Set(s.shares).size === 1 && /best/.test(st[0].cls) && !/best/.test(st[1].cls) && !/best/.test(st[2].cls) && /Level with your deepest/.test(hs[1]), `${same.join(', ')} | ${hs[1]}`);
  ok('identical rarity: three separate markers', await p.evaluate(() => new Set([...document.querySelectorAll('.ib-mark')].map(m => m.style.transform)).size === 3));
  await p.screenshot({ path: 'tests/shot-edge-identical.png' });
  await waitDone(p); await p.waitForTimeout(600);
  ok('identical rarity: results view has no overlaps either', !(await overlaps(p)).length, (await overlaps(p)).join('; '));
  await p.context().close();

  // Close but different rarity.
  p = await fresh(b, 'phone'); await start(p);
  for (const a of ['quokka', 'tarsier', 'numbat']) { await guess(p, a); await p.waitForTimeout(350); ok(`similar rarity on a phone (${a}): no overlap`, !(await overlaps(p)).length, (await overlaps(p)).join('; ')); }
  await p.screenshot({ path: 'tests/shot-edge-similar-phone.png' }); await p.context().close();

  // Rapid repeated submissions.
  p = await fresh(b, 'desk'); await start(p);
  await p.fill('#answer', 'kangaroo'); for (let i = 0; i < 6; i++) await p.keyboard.press('Enter');
  await p.keyboard.type('octopus'); await p.keyboard.press('Enter'); await p.keyboard.press('Enter');
  s = await S(p);
  ok('rapid Enter presses during a reveal: exactly one guess is taken', s.n === 1 && s.busy === true, `guesses ${s.n}`);
  await settle(p);
  ok('rapid: what was typed during the reveal is kept in the box, ready to send', await p.inputValue('#answer') === 'octopus' && (await S(p)).n === 1);
  await p.keyboard.press('Enter'); await settle(p);
  ok('rapid: next Enter sends it', (await S(p)).n === 2 && (await S(p)).names[1] === 'octopus');
  const lat = await p.evaluate(() => { const input = document.querySelector('#answer'), form = document.querySelector('#entry'); const t = []; for (const w of ['zzzz', 'mammal', 'kangaroo', 'pikachu']) { input.value = w; const a = performance.now(); form.requestSubmit(); t.push(performance.now() - a); } return Math.max(...t); });
  ok('a submission is judged in under 5 ms', lat < 5, lat.toFixed(2) + ' ms');
  await p.context().close();

  // Safeguard: answers that don't count are free a few times, then use a guess.
  p = await fresh(b, 'desk'); await start(p);
  const hm = []; for (const a of ['mammal', 'unicorn', 'qqqq']) { await enter(p, a); hm.push(await hint(p)); }
  s = await S(p);
  ok('misses: first three are free, with a warning on the third', s.n === 0 && s.misses === 3 && /No guess used\.$/.test(hm[0]) && /The next miss uses one\.$/.test(hm[2]), hm[2]);
  await enter(p, 'vertebrate'); s = await S(p); st = await slots(p);
  ok('misses: the fourth uses a guess and shows as not counted, with no rarity', s.n === 1 && s.status[0] === 'miss' && /miss/.test(st[0].cls) && /no depth/.test(st[0].text) && /That used a guess/.test(await hint(p)), st[0].text);
  // No makes cap any more: three makes all count.
  await p.context().close();
  p = await fresh(b, 'desk'); await p.evaluate(() => { const st = JSON.parse(localStorage.getItem('iceberg:game:' + 2) || 'null'); }); await start(p);
  await p.evaluate(() => { const s = ICEBERG_TEST.state; s.round = 4; localStorage.setItem('iceberg:game:' + s.day, JSON.stringify(s)); });
  await p.goto(URL + '?test&day=0&fast'); await p.waitForSelector('[data-screen="play"]:not([hidden])'); await p.waitForTimeout(300);
  for (const a of ['Ferrari', 'Lamborghini', 'Porsche']) await guess(p, a);
  s = await S(p);
  ok('category rules: three car makes all count now (the old cap is gone); "Lambo" style names still merge', s.status.join() === 'ok,ok,ok' && s.names.join() === 'ferrari,lamborghini,porsche', s.names.join());
  ok('edge runs: no errors', !p.errs.length, p.errs.join(' | '));
  await p.context().close();
}

async function reload(b) {
  const p = await fresh(b, 'phone'); await start(p);
  await guess(p, 'kangaroo'); await guess(p, 'octopus');
  await p.goto(URL + '?test&day=0&fast'); await p.waitForTimeout(600);
  let s = await S(p), st = await slots(p);
  ok('reload mid-question: back in the same question with both guesses and one left', await p.evaluate(() => ICEBERG_TEST.screen === 'play') && s.n === 2 && s.names.join() === 'kangaroo,octopus' && /done/.test(st[0].cls) && /best/.test(st[1].cls) && /next/.test(st[2].cls), st.map(x => x.cls).join(' | '));
  ok('reload: markers are back on the iceberg, camera at the deepest', await p.evaluate(() => document.querySelectorAll('.ib-mark').length === 2 && document.querySelector('.ib-card .ib-name')?.textContent === 'octopus'));
  ok('reload: layout and overlaps fine', !(await audit(p)).length && !(await overlaps(p)).length, [...await audit(p), ...await overlaps(p)].join('; '));
  await enter(p, 'kangaroo');
  ok('reload: an earlier guess still counts as a duplicate', (await S(p)).n === 2 && /already tried/.test(await hint(p)));
  // Reload in the middle of a reveal: the guess was saved the moment it was sent.
  await p.fill('#answer', 'axolotl'); await p.keyboard.press('Enter'); await p.waitForTimeout(80);
  await p.goto(URL + '?test&day=0&fast'); await p.waitForTimeout(700);
  s = await S(p);
  ok('reload during a reveal: the guess is not lost or refunded', s.n === 3 && s.names[2] === 'axolotl', `${s.n} guesses, phase ${s.phase}`);
  await waitDone(p);
  await p.goto(URL + '?test&day=0&fast'); await p.waitForTimeout(600);
  ok('reload on the results: still the results, same score', (await S(p)).phase === 'done' && await p.evaluate(() => document.querySelector('#best-name').textContent === 'axolotl' && !document.querySelector('#done-panel').hidden));
  await p.click('#next'); await p.waitForFunction(() => ICEBERG_TEST.state.round === 1); await p.waitForTimeout(300);
  await p.goto(URL + '?test&day=0&fast'); await p.waitForTimeout(600);
  s = await S(p);
  ok('reload at the start of question 2: question 2, three fresh guesses, question 1 kept', s.round === 1 && s.n === 0 && /\d+ m/.test(await p.textContent('#top-meta')), await p.textContent('#top-meta'));
  ok('reload runs: no errors', !p.errs.length, p.errs.join(' | '));
  await p.context().close();
}

async function review(b) {
  const p = await fresh(b, 'desk', '&verify=/verify-mock'); let bodies = [];
  await p.route('**/verify-mock', async route => { if (route.request().method() !== 'POST') return route.continue(); const body = JSON.parse(route.request().postData()); bodies.push(body); await new Promise(r => setTimeout(r, 250));
    const verdict = { batmobile: { status: 'ok', canonical: 'batmobile', reason: 'A car' }, 'time machine': { status: 'invalid', canonical: '', reason: 'Not a real thing with wheels' }, whip: { status: 'ok', canonical: 'car', reason: 'Slang for car' } }[body.answers[0]];
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ results: [{ text: body.answers[0], ...verdict }] }) }); });
  await start(p); await p.evaluate(() => { const s = ICEBERG_TEST.state; s.round = 4; localStorage.setItem('iceberg:game:' + s.day, JSON.stringify(s)); });
  await p.goto(URL + '?test&day=0&fast&verify=/verify-mock'); await p.waitForSelector('[data-screen="play"]:not([hidden])'); await p.waitForTimeout(300);
  await enter(p, 'batmobile'); await p.keyboard.press('Enter'); await p.waitForTimeout(80);
  let s = await S(p);
  ok('review: an unknown answer takes a slot at once and waits', s.n === 1 && s.status[0] === 'pending' && /Being checked/.test((await slots(p))[0].text));
  await p.waitForFunction(() => ICEBERG_TEST.state.rounds[4].guesses[0].status === 'ok', null, { timeout: 6000 }); await settle(p); await p.waitForTimeout(300);
  let st = await slots(p);
  ok('review approved: it is revealed on the iceberg at 52 m (Midwater), never the maximum', /done/.test(st[0].cls) && /52m/.test(st[0].text) && /Midwater/.test(st[0].text) && await p.evaluate(() => document.querySelectorAll('.ib-mark').length === 1), st[0].text);
  await enter(p, 'time machine'); await p.keyboard.press('Enter');
  await p.waitForFunction(() => ICEBERG_TEST.state.rounds[4].guesses[1].status === 'miss', null, { timeout: 6000 }); await p.waitForTimeout(200); st = await slots(p);
  ok('review rejected: the slot stays used, with the reason and no depth', /miss/.test(st[1].cls) && /Not a real thing with wheels/.test(st[1].text) && (await S(p)).n === 2, st[1].text);
  ok('review: only the unknown answer was sent, one per request', bodies.length === 2 && bodies.every(x => x.answers.length === 1 && x.category === 'wheels'), JSON.stringify(bodies.map(x => x.answers)));
  await guess(p, 'car'); await waitDone(p);
  ok('review: best is still the approved answer (52 m beats car)', await p.evaluate(() => document.querySelector('#best-name').textContent === 'batmobile' && document.querySelector('#best-depth').textContent === '52m'));
  ok('review: verdicts are remembered, so the same answer is judged instantly next time', await p.evaluate(() => ICEBERG_TEST.judge('Batmobile', 4).status === 'ok' && ICEBERG_TEST.judge('time machine', 4).status === 'invalid'));
  await p.context().close();
  // Same-as-earlier verdict, and a dead service.
  const q = await fresh(b, 'desk', '&verify=/verify-mock');
  await q.route('**/verify-mock', route => route.request().method() !== 'POST' ? route.continue() : route.fulfill({ contentType: 'application/json', body: JSON.stringify({ results: [{ text: 'whip', status: 'ok', canonical: 'car', reason: 'Slang for car' }] }) }));
  await start(q); await q.evaluate(() => { const s = ICEBERG_TEST.state; s.round = 4; localStorage.setItem('iceberg:game:' + s.day, JSON.stringify(s)); });
  await q.goto(URL + '?test&day=0&fast&verify=/verify-mock'); await q.waitForSelector('[data-screen="play"]:not([hidden])'); await q.waitForTimeout(300);
  await guess(q, 'car'); await enter(q, 'whip'); await q.keyboard.press('Enter');
  await q.waitForFunction(() => ICEBERG_TEST.state.rounds[4].guesses[1].status === 'miss', null, { timeout: 6000 }); await q.waitForTimeout(200);
  ok('review: an approved answer that equals an earlier guess scores nothing extra', /Same answer as car/.test((await slots(q))[1].text), (await slots(q))[1].text);
  await q.context().close();
  const d = await fresh(b, 'desk', '&verify=/nope'); await start(d);
  await enter(d, 'pikachu'); await d.keyboard.press('Enter'); await d.waitForTimeout(900);
  let ds = await S(d);
  ok('review service down: the answer stays pending, uses its guess, and the game carries on', ds.n === 1 && ds.status[0] === 'pending' && /Waiting for review/.test((await slots(d))[0].text));
  await guess(d, 'dog'); await d.click('#finish'); await waitDone(d);
  ok('pending answers earn nothing: score comes from the valid guess only', await d.evaluate(() => document.querySelector('#best-name').textContent === 'dog' && document.querySelector('#best-depth').textContent === '0m'));
  // A verdict that arrives later (remembered on the device) updates the pending guess and the score.
  await d.evaluate(() => localStorage.setItem('iceberg:verdicts:animals', JSON.stringify({ pikachu: { status: 'ok' } })));
  await d.goto(URL + '?test&day=0&fast'); await d.waitForTimeout(600);
  ok('pending verified later: the score updates', await d.evaluate(() => document.querySelector('#best-name').textContent === 'pikachu' && document.querySelector('#best-depth').textContent === '52m'), await d.textContent('#best-depth'));
  ok('review runs: no errors', !d.errs.filter(e => !/nope|404/.test(e)).length, d.errs.join(' | '));
  await d.context().close();
}

async function audio(b) {
  const p = await open(b, 'desk', URL + '?test&day=0&fast&reset');
  await p.click('#sound-btn');
  ok('audio: starts after the first tap', await p.evaluate(() => Sound.ready));
  const lv = await p.evaluate(async () => { const out = []; for (const n of Sound.names) out.push(await Sound.renderTest(n, { depth: 0.8, seconds: 1.2, lead: 1.2, dir: 1, step: 1 }, 5)); return out; });
  ok('audio: every sound renders, none silent, none clipping', lv.every(x => !x.nan && x.peak > 0.003 && x.peak < 0.6), lv.map(x => `${x.name} ${x.peak}`).join(', '));
  const by = Object.fromEntries(lv.map(x => [x.name, x]));
  ok('audio: "deeper" is clearly stronger than the neutral cue; no tick or time-up sound exists', by.deeper.rms > by.neutral.rms * 2 && !by.tick && !by.timeup, `deeper rms ${by.deeper.rms} vs neutral ${by.neutral.rms}`);
  await p.fill('#snd-sfx', '35'); await p.fill('#snd-amb', '20');
  ok('audio: separate effect and ambience volumes', await p.evaluate(() => Sound.prefs.sfx === 0.35 && Sound.prefs.amb === 0.2));
  await p.click('#snd-on');
  await p.click('#play'); await p.waitForSelector('[data-screen="play"]:not([hidden])'); await p.waitForTimeout(500);
  const made = await p.evaluate(() => { let n = 0; const o = AudioContext.prototype.createOscillator; AudioContext.prototype.createOscillator = function () { n++; return o.call(this); }; window.__count = () => n; return 0; });
  await guess(p, 'kangaroo'); await guess(p, 'octopus');
  ok('audio muted: the game plays normally and makes no sound', await p.evaluate(() => Sound.prefs.muted && window.__count() === 0) && (await S(p)).n === 2);
  await p.goto(URL + '?test&day=0&fast'); await p.waitForTimeout(500);
  ok('audio: preferences survive a reload', await p.evaluate(() => Sound.prefs.muted === true && Sound.prefs.sfx === 0.35 && Sound.prefs.amb === 0.2));
  ok('audio runs: no errors', !p.errs.length, p.errs.join(' | '));
  await p.context().close();
  const q = await open(b, 'desk', URL + '?test&day=0&fast&reset'); await q.addInitScript(() => { delete window.AudioContext; delete window.webkitAudioContext; });
  await q.goto(URL + '?test&day=0&fast&reset'); await q.waitForSelector('#play'); await q.click('#play'); await q.waitForSelector('[data-screen="play"]:not([hidden])'); await q.waitForTimeout(400); await guess(q, 'dog');
  ok('audio: works in a browser with no audio support', (await S(q)).n === 1 && !q.errs.length, q.errs.join(' | '));
  await q.context().close();
}

async function timing(b) {
  const p = await open(b, 'desk', URL + '?test&day=0&reset'); // real speed
  await p.click('#play'); await p.waitForSelector('[data-screen="play"]:not([hidden])'); await p.waitForTimeout(1700);
  const times = [];
  for (const a of ['kangaroo', 'octopus', 'cat', 'axolotl']) {
    if (a === 'axolotl') { await p.waitForFunction(() => ICEBERG_TEST.state.phase === 'done', null, { timeout: 8000 }); await p.click('#next'); await p.waitForFunction(() => ICEBERG_TEST.state.round === 1); await p.waitForTimeout(1700); }
    await p.fill('#answer', a === 'axolotl' ? 'jabuticaba' : a); const t0 = Date.now(); await p.keyboard.press('Enter'); await p.waitForTimeout(50); await p.waitForFunction(() => !ICEBERG_TEST.busy, null, { timeout: 10000 }); times.push(Date.now() - t0); await p.waitForTimeout(500);
  }
  ok('reveal length: ordinary guesses take about 1 to 2 seconds', times.slice(0, 3).every(t => t > 800 && t < 2100), times.slice(0, 3).map(t => (t / 1000).toFixed(2) + ' s').join(', '));
  ok('reveal length: an exceptional abyss find takes a little longer, under 3 seconds', times[3] > times[0] && times[3] < 3000, (times[3] / 1000).toFixed(2) + ' s');
  ok('timing runs: no errors', !p.errs.length, p.errs.join(' | '));
  await p.context().close();
}

async function daily(b) {
  const index = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'days', 'index.json'), 'utf8'));
  const at = async (offsetDays) => { const ctx = await b.newContext({ viewport: { width: 1100, height: 760 } }); const p = await ctx.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') p.errs.push(m.text()); });
    await p.clock.install({ time: new Date(2026, 10, 24 + offsetDays, 9, 30) }); await p.goto(URL + '?test&fast'); await p.waitForSelector('#play'); return p; };
  const seen = new Map(), keys = new Set(); let bad = [], small = [], icons = [];
  for (let d = 0; d < index.count; d++) {
    const p = await at(d);
    const meta = await p.textContent('#top-meta');
    await p.click('#play'); await p.waitForSelector('[data-screen="play"]:not([hidden])'); await p.waitForTimeout(150);
    const info = await p.evaluate(async n => { const day = await (await fetch(`days/${n}.json`)).json(); return { title: document.querySelector('#q-title').textContent, qs: day.questions.map(q => ({ key: q.key, prompt: q.prompt, n: q.answers.length, tip: q.answers.filter(a => a.s >= 0.1).length, icon: document.createElement('i').innerHTML = IcebergIcons.svg(q.icon), rules: q.rules.length, hint: !!q.hint })) }; }, d + 1);
    if (meta !== `Daily #${d + 1}` || info.title !== info.qs[0].prompt) bad.push(`day ${d + 1}: header "${meta}", shows "${info.title}"`);
    info.qs.forEach(q => { if (keys.has(q.key)) bad.push('repeated question ' + q.key); keys.add(q.key); if (q.n < 25 || q.tip < 1 || !q.rules || !q.hint) small.push(`${q.key} (${q.n} answers, ${q.tip} at the tip)`); if (/M4 21 11 8l4 5 3-3 10 11z/.test(q.icon)) icons.push(q.key); });
    seen.set(d + 1, info.qs.map(q => q.prompt).join(' | '));
    // One real guess on each day's first question: the top answer must be recognised and land at the tip.
    const top = await p.evaluate(async n => (await (await fetch(`days/${n}.json`)).json()).questions[0].answers[0], d + 1);
    await p.fill('#answer', top.d || top.a); await p.keyboard.press('Enter'); await p.waitForTimeout(80); await p.waitForFunction(() => !ICEBERG_TEST.busy, null, { timeout: 9000 });
    const g = await p.evaluate(() => ICEBERG_TEST.state.rounds[0].guesses[0]);
    if (!g || g.status !== 'ok' || p.errs.length) bad.push(`day ${d + 1}: top answer "${top.a}" -> ${g && g.status} ${p.errs.join(' ')}`);
    await p.context().close();
  }
  ok(`daily: each of the ${index.count} days loads its own five questions by date, with the right "Daily #"`, !bad.length, bad.join('; ') || [...seen.values()][0]);
  ok('daily: no question is used twice across the calendar', keys.size === index.count * 5, `${keys.size} different questions`);
  ok('daily: every question has rules, a hint, at least 25 answers and an answer at the tip', !small.length, small.join('; '));
  ok('daily: every question has its own icon (none falls back to the default)', !icons.length, icons.join(', '));
  const wrap = await at(index.count); const again = await wrap.evaluate(() => fetch('days/1.json').then(r => r.json()).then(d => d.questions[0].prompt));
  await wrap.click('#play'); await wrap.waitForSelector('[data-screen="play"]:not([hidden])');
  ok('daily: after the last day the calendar starts again from day 1 (numbering carries on)', await wrap.textContent('#q-title') === again && await wrap.evaluate(() => ICEBERG_TEST.state.day) === index.count + 1);
  await wrap.context().close();
  // Yesterday's unfinished game must not leak into today.
  const ctx = await b.newContext({ viewport: { width: 1100, height: 760 } }); const p = await ctx.newPage(); await p.clock.install({ time: new Date(2026, 10, 24, 23, 50) });
  await p.goto(URL + '?test&fast'); await p.waitForSelector('#play'); await p.click('#play'); await p.waitForSelector('[data-screen="play"]:not([hidden])'); await p.waitForTimeout(200);
  await p.fill('#answer', 'eagle'); await p.keyboard.press('Enter'); await p.waitForTimeout(80); await p.waitForFunction(() => !ICEBERG_TEST.busy, null, { timeout: 9000 });
  const first = await p.textContent('#q-title'); await p.clock.setFixedTime(new Date(2026, 10, 25, 0, 10)); await p.goto(URL + '?test&fast'); await p.waitForSelector('#play'); await p.waitForTimeout(300);
  const home = await p.evaluate(() => ({ screen: ICEBERG_TEST.screen, meta: document.querySelector('#top-meta').textContent, btn: document.querySelector('#play').textContent }));
  await p.click('#play'); await p.waitForSelector('[data-screen="play"]:not([hidden])');
  ok('daily: after midnight the new day starts fresh with new questions', home.screen === 'home' && home.meta === 'Daily #2' && /Play today/.test(home.btn) && await p.textContent('#q-title') !== first && await p.evaluate(() => ICEBERG_TEST.state.rounds[0].guesses.length === 0), `${home.meta}: ${await p.textContent('#q-title')}`);
  await ctx.close();
  // Word questions: starts-with, ends-in and contains.
  const w = await at(1); // day 2 has "ends in OCK"
  const verdicts = await w.evaluate(async () => { const day = await (await fetch('days/2.json')).json(), i = day.questions.findIndex(q => q.key === 'ock'); const j = t => { const r = ICEBERG_TEST.judge(t, i); return r.status + (r.answer ? ':' + r.answer : '') + (r.reason ? ' (' + r.reason + ')' : ''); };
    return { clock: j('clock'), clocks: j('Clocks'), knocked: j('knocked'), apple: j('apple'), two: j('rock star'), typo: j('padlokc'), i }; });
  ok('word questions: "ends in OCK" accepts clock, folds clocks and knocked, rejects apple and two-word answers', verdicts.clock === 'ok:clock' && verdicts.clocks === 'ok:clock' && verdicts.knocked === 'ok:knock' && /invalid \(Doesn't end in OCK\)/.test(verdicts.apple) && /invalid \(One word only\)/.test(verdicts.two), JSON.stringify(verdicts));
  await w.context().close();
}

async function sizes(b) {
  const { VPS } = require('./lib.cjs'); VPS.keyboard = { width: 390, height: 430 }; VPS.laptop = { width: 1366, height: 700 };
  for (const vp of ['small', 'keyboard', 'tablet', 'laptop', 'wide']) {
    const p = await open(b, vp, URL + '?test&day=0&fast&reset'); const a0 = await audit(p);
    await p.click('#play'); await p.waitForSelector('[data-screen="play"]:not([hidden])'); await p.waitForTimeout(500);
    const issues = [];
    for (const a of ['great white shark', 'kangaroo', 'axolotl']) { await guess(p, a); await p.waitForTimeout(300); issues.push(...await audit(p), ...await overlaps(p)); if (a === 'kangaroo') await p.screenshot({ path: `tests/shot-${vp}-play.png` }); }
    const fits = await p.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1 || innerWidth > 920);
    await waitDone(p); await p.waitForTimeout(500); issues.push(...await audit(p), ...await overlaps(p)); await p.screenshot({ path: `tests/shot-${vp}-done.png` });
    ok(`${vp} (${VPS[vp].width}×${VPS[vp].height}): home, guessing and results fit with no overlap, clipping or sideways scroll`, !a0.length && !issues.length && !p.errs.length, [...a0, ...issues, ...p.errs].join('; '));
    if (vp === 'small' || vp === 'keyboard') ok(`${vp}: the guessing screen fits in one window without scrolling`, fits);
    await p.context().close();
  }
}

(async () => {
  const srv = serve(8782), b = await chromium.launch({ args: ['--autoplay-policy=document-user-activation-required'] });
  const only = process.argv[2];
  const jobs = { desk: () => fullGame(b, 'desk'), phone: () => fullGame(b, 'phone'), edge: () => edge(b), reload: () => reload(b), review: () => review(b), audio: () => audio(b), timing: () => timing(b), sizes: () => sizes(b), daily: () => daily(b) };
  for (const [k, f] of Object.entries(jobs)) if (!only || only.split(',').includes(k)) { try { await f(); } catch (e) { ok(`${k}: test run completed`, false, e.message.split('\n')[0]); } }
  console.log(R.join('\n')); console.log(`\n${R.length - fails} passed, ${fails} failed`);
  await b.close(); srv.close();
})();
