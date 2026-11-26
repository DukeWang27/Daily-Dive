// Full play-through checks for the three-guess game. Needs Node and Playwright.
// Run from the project folder:  node tests/matrix.cjs            (everything, about 3 minutes)
//                               node tests/matrix.cjs audio,sizes (parts: desk, phone, edge, reload, review, audio, timing, sizes, daily, scene, perf, brand, timer)
const { chromium, serve, open, audit } = require('./lib.cjs');
const R = []; let fails = 0;
const ok = (name, cond, extra = '') => { R.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  [' + extra + ']' : ''}`); if (!cond) fails++; };
const URL = 'http://localhost:8782/';
// All play-through checks use days/0.json, a fixed set of five questions, so they don't change with the calendar.
const S = p => p.evaluate(() => { const st = ICEBERG_TEST.state, r = st && st.rounds[st.round]; return st ? { round: st.round, phase: st.phase, n: r.guesses.length, status: r.guesses.map(g => g.status), names: r.guesses.map(g => g.name || g.typed), shares: r.guesses.map(g => g.share), misses: r.misses, busy: ICEBERG_TEST.busy } : null; });
const settle = async p => { await p.waitForFunction(() => !ICEBERG_TEST.busy, null, { timeout: 10000 }); await p.waitForTimeout(250); };
const enter = async (p, text) => { await p.fill('#answer', text); await p.keyboard.press('Enter'); await p.waitForTimeout(60); };
const guess = async (p, text) => { await enter(p, text); await settle(p); };
// Where the camera is the moment a guess has landed (the results view takes over shortly after the third).
const landed = async (p, text) => { await enter(p, text); await p.waitForFunction(() => !ICEBERG_TEST.busy, null, { timeout: 10000 }); };
const waitDone = p => p.waitForFunction(() => ICEBERG_TEST.state && ICEBERG_TEST.state.phase === 'done', null, { timeout: 10000 });
const hint = p => p.evaluate(() => { const a = document.querySelector('#q-ask'); return (document.querySelector('#hint').textContent + ' ' + (a && !a.hidden ? a.textContent : '')).trim(); });   // the hint line, plus a spelling question in the ice panel
// Nothing on the iceberg overlaps: visible labels, the card and markers.
const overlaps = p => p.evaluate(() => {
  const vis = n => { const cs = getComputedStyle(n); return !n.classList.contains('dim') && cs.display !== 'none' && +cs.opacity > 0.05; };
  const box = n => n.getBoundingClientRect(), hit = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
  const ib = box(document.querySelector('#ib')), pills = [...document.querySelectorAll('.ib-pill')].filter(vis), card = document.querySelector('.ib-note'), marks = [...document.querySelectorAll('.ib-mark')].filter(vis), out = [];
  pills.forEach((a, i) => pills.slice(i + 1).forEach(b => { if (hit(box(a), box(b))) out.push(`labels overlap: ${a.textContent} / ${b.textContent}`); }));
  if (card) { const c = box(card); pills.forEach(a => { if (hit(box(a), c)) out.push('label under annotation: ' + a.textContent); }); marks.forEach(m => { if (!m.classList.contains('focus') && hit(box(m), c)) out.push('marker under annotation'); });
    if (c.left < ib.left - 1 || c.right > ib.right + 1 || c.top < ib.top - 1 || c.bottom > ib.bottom + 1) out.push('annotation clipped by the window'); const hud = document.querySelector('.ib-read.on .ib-depth'); if (hud && hit(box(hud), c)) out.push('annotation over the depth reading'); }
  marks.forEach((a, i) => marks.slice(i + 1).forEach(b => { if (hit(box(a), box(b))) out.push('markers overlap'); }));
  return out; });
const slots = p => p.$$eval('#slots .slot', els => els.map(e => ({ cls: e.className.replace('slot ', ''), text: e.innerText.replace(/\n/g, ' | ') })));
async function fresh(b, vp, extra = '') { const p = await open(b, vp, URL + '?test&day=0&fast&reset' + extra); await p.evaluate(() => { window.__snd = []; const o = Sound.play; Sound.play = (n, a) => { window.__snd.push(n); return o(n, a); }; }); return p; }
const start = async p => { await p.click('#play'); await p.waitForSelector('[data-screen="play"]:not([hidden])'); await p.waitForTimeout(500); };

async function fullGame(b, vp) {
  const T = s => `${vp}: ${s}`, p = await fresh(b, vp);
  const home = await p.evaluate(() => document.querySelector('[data-screen="home"]').innerText);
  ok(T('home explains the game, with no speed talk'), /Three guesses/.test(home) && /How deep can you go/.test(home) && !/as many as|fast as/i.test(home), home.replace(/\n+/g, ' ').slice(0, 90));
  ok(T('home layout'), !(await audit(p)).length, (await audit(p)).join('; '));
  await start(p);
  let st = await slots(p);
  ok(T('q1: three slots, first one ready, none used'), st.length === 3 && /next/.test(st[0].cls) && /empty/.test(st[1].cls) && /empty/.test(st[2].cls), st.map(s => s.cls).join(','));
  ok(T('q1: with the clock turned off, no timer is shown'), await p.evaluate(() => document.querySelector('#melt').hidden && ICEBERG_TEST.clock.total === 0));
  ok(T('q1: the scene fills the whole window, controls floating over it'), await p.evaluate(() => { const r = document.querySelector('#ib').getBoundingClientRect(), a = document.querySelector('#answer').getBoundingClientRect(); return r.width * r.height / (innerWidth * innerHeight) > 0.99 && a.top > r.top && a.bottom < r.bottom; }), await p.evaluate(() => { const r = document.querySelector('#ib').getBoundingClientRect(); return Math.round(100 * r.width * r.height / (innerWidth * innerHeight)) + '% of the window'; }));
  ok(T('q1: play layout'), !(await audit(p)).length, (await audit(p)).join('; '));

  // Q1: three progressively rarer answers.
  const inputY = (await p.locator('#answer').boundingBox()).y; const depths = [], hints = [], huds = [];
  for (const a of ['kangaroo', 'octopus', 'axolotl']) { await guess(p, a); await p.waitForTimeout(350); depths.push(await p.evaluate(() => ICEBERG_TEST.berg.depth)); hints.push(await hint(p)); huds.push(await p.textContent('.ib-depth')); ok(T(`q1 ${a}: nothing overlaps on the iceberg`), !(await overlaps(p)).length, (await overlaps(p)).join('; ')); if (a === 'octopus') await p.screenshot({ path: `tests/shot-${vp}-play.png` }); }
  ok(T('q1 rarer each time: camera goes deeper each guess'), depths[0] > 0 && depths[1] > depths[0] && depths[2] > depths[1], depths.join(' < '));
  ok(T('q1: depth gauge matches each answer'), huds.every((h, i) => h === depths[i] + ' m'), huds.join(', '));
  ok(T('q1: feedback says how far the first takes you, then how much further each better one goes'), /^\+\d+ m\. You're down to \d+ m/.test(hints[0]) && /\+\d+ m beats your \+\d+ m: \d+ m further down, to \d+ m/.test(hints[1]) && /beats your/.test(hints[2]), hints.join(' || '));
  ok(T('q1: input stayed in place and focused'), Math.abs((await p.locator('#answer').boundingBox()).y - inputY) < 1 && await p.evaluate(() => document.activeElement.id === 'answer'));
  st = await slots(p);
  ok(T('q1: slots show name, share, zone and depth; the third is marked deepest'), st.every(s => /done/.test(s.cls) && /%/.test(s.text) && /\d+m/.test(s.text)) && /best/.test(st[2].cls) && !/best/.test(st[0].cls) && /Counts/i.test(st[2].text) && (vp !== 'desk' || /Rare/.test(st[0].text)), st.map(s => s.text).join(' || '));
  ok(T('q1: all three markers stay on the iceberg'), await p.evaluate(() => document.querySelectorAll('.ib-mark').length === 3));
  await waitDone(p); await p.waitForTimeout(400);
  let d = await p.evaluate(() => ({ best: document.querySelector('#best-name').textContent, depth: document.querySelector('#best-depth').textContent, rows: document.querySelectorAll('#sum li').length, bars: [...document.querySelectorAll('#common li, #rare li')].map(l => l.innerText.replace(/\n/g, ' ')), players: document.querySelector('#players').textContent, sample: !document.querySelector('#sample-note').hidden, meta: document.querySelector('#top-meta').textContent }));
  ok(T('q1 results: deepest answer and its depth are the score'), d.best === 'axolotl' && d.depth === '+' + depths[2] + 'm' && d.meta === depths[2] + ' m', `${d.best} ${d.depth} / header ${d.meta}`);
  ok(T('q1 results: 5 common + 5 rare with %, labelled as estimates, and no invented head-counts'), d.bars.length === 10 && d.bars.every(x => /%/.test(x) && !/·\s*[\d,]+/.test(x)) && /^Estimated/.test(d.players) && !/simulated/.test(d.players) && d.sample, d.bars[0] + ' ... ' + d.bars[9]);
  ok(T('q1 results layout'), !(await audit(p)).length, (await audit(p)).join('; '));
  await p.screenshot({ path: `tests/shot-${vp}-done.png` });
  // Compare guesses without replaying.
  await p.click('#sum li:nth-child(1) .sum-row'); await p.waitForFunction(() => document.querySelector('.ib-note.in .ib-name')?.textContent === 'kangaroo', null, { timeout: 6000 });
  ok(T('q1 results: tapping a guess flies the camera to it'), true);
  ok(T('q1 results: still nothing overlapping'), !(await overlaps(p)).length, (await overlaps(p)).join('; '));
  await p.click('#next');

  // Q2: the rarest answer first, then two more common ones.
  await p.waitForFunction(() => ICEBERG_TEST.state.round === 1 && ICEBERG_TEST.state.phase === 'play'); await p.waitForTimeout(500);
  ok(T('q2: other players\' answers are hidden while guessing'), await p.evaluate(() => document.querySelector('#done-panel').hidden && !/banana|Everyone/.test(document.querySelector('[data-screen="play"]').innerText)));
  const d2 = [], h2 = [];
  for (const a of ['jabuticaba', 'apple', 'kiwi']) { await landed(p, a); d2.push(await p.evaluate(() => ICEBERG_TEST.berg.depth)); await p.waitForTimeout(250); h2.push(await hint(p)); ok(T(`q2 ${a}: nothing overlaps`), !(await overlaps(p)).length, (await overlaps(p)).join('; ')); }
  st = await slots(p);
  ok(T('q2 rarest first: camera rises to the real spot of later guesses (not forced deeper)'), d2[0] > 200 && d2[1] === 0 && d2[2] > 0 && d2[2] < d2[0], d2.join(', '));
  ok(T('q2: first guess stays the deepest; later ones get neutral feedback'), /best/.test(st[0].cls) && !/best/.test(st[1].cls) && !/best/.test(st[2].cls) && /Your \+\d+ m still counts: you stay at \d+ m\. 1 guess left/.test(h2[1]) && /still counts/.test(h2[2]), h2.join(' || '));
  await waitDone(p);
  ok(T('q2: score is still the first guess'), await p.evaluate(() => document.querySelector('#best-name').textContent === 'jabuticaba'), await p.textContent('#best-depth'));
  await p.click('#next');

  // Q3: three progressively more common answers.
  await p.waitForFunction(() => ICEBERG_TEST.state.round === 2 && ICEBERG_TEST.state.phase === 'play'); await p.waitForTimeout(500);
  const d3 = []; for (const a of ['zester', 'whisk', 'fridge']) { await landed(p, a); d3.push(await p.evaluate(() => ICEBERG_TEST.berg.depth)); await p.waitForTimeout(250); }
  ok(T('q3 more common each time: camera climbs back up, best stays first'), d3[0] > d3[1] && d3[1] > d3[2] && /best/.test((await slots(p))[0].cls), d3.join(' > '));
  await waitDone(p); const q3 = await p.textContent('#best-depth'); await p.click('#next');

  // Q4: typo, duplicate, invalid, pending.
  await p.waitForFunction(() => ICEBERG_TEST.state.round === 3 && ICEBERG_TEST.state.phase === 'play'); await p.waitForTimeout(500);
  await enter(p, 'snaek'); let s4 = await S(p);
  ok(T('q4 unclear typo "snaek" (snake? sneak? snack?): no guess used, and never a list of possible answers'), s4.n === 0 && !/(snake|snack|sneak).*(snake|snack|sneak)/.test(await hint(p)) && /isn't on our list, and it's close|Did you mean (snake|snack|sneak)\?/.test(await hint(p)), await hint(p));
  await enter(p, 'snorkle'); await settle(p);
  ok(T('q4 clear typo "snorkle": corrected at once and said so ("Accepted as: snorkel")'), (await S(p)).n === 1 && /Accepted as: snorkel \(spelling corrected\)/.test(await hint(p)), await hint(p));
  ok(T('q4 corrected typo: placed as snorkel'), (await S(p)).names[0] === 'snorkel', JSON.stringify(await S(p)));
  await enter(p, 'Snorkels'); s4 = await S(p);
  ok(T('q4 duplicate "Snorkels": no guess used, no rarity shown again'), s4.n === 1 && /already tried snorkel|already discovered this answer/.test(await hint(p)), await hint(p));
  await enter(p, 'apple'); s4 = await S(p);
  ok(T('q4 invalid "apple": reason given, no guess used'), s4.n === 1 && s4.misses === 1 && /Doesn't start with SN\. No guess used/.test(await hint(p)), await hint(p));
  await enter(p, 'snorlax'); s4 = await S(p);
  // Unknown to the list: kept at once as a guess waiting for review, unless it looks like a slip of a listed answer
  // (then one "Did you mean ...?" first, which uses nothing).
  const asked = /Did you mean/.test(await hint(p));
  ok(T('q4 unknown "snorlax": kept for review straight away, or one spelling question first'), asked ? s4.n === 1 : (s4.n === 2 && /isn't on our list yet\. Kept for review/.test(await hint(p))), await hint(p));
  if (asked) { await p.keyboard.press('Escape'); await p.waitForTimeout(150); }
  s4 = await S(p); st = await slots(p);
  ok(T('q4 pending: keeping it as typed uses a guess, slot shows pending with no depth or rarity'), s4.n === 2 && s4.status[1] === 'pending' && /pending/.test(st[1].cls) && /Waiting for review/.test(st[1].text) && !/%|\d+m/.test(st[1].text), st[1].text);
  await guess(p, 'snafu');
  await waitDone(p); await p.waitForTimeout(300);
  d = await p.evaluate(() => ({ best: document.querySelector('#best-name').textContent, rows: [...document.querySelectorAll('#sum li')].map(l => l.innerText.replace(/\n/g, ' | ')), note: document.querySelector('#review-note').textContent }));
  ok(T('q4 results: best is snafu; pending, rejected and typed-but-unsent answers all listed, with dispute buttons'), d.best === 'snafu' && d.rows.length === 5 && d.rows.some(x => /snaek.*Typed but not sent/.test(x)) && d.rows.some(x => /snorlax.*I think this counts/.test(x)) && d.rows.some(x => /apple.*Dispute.*didn't use a guess/.test(x)), d.rows.join(' || '));
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
  ok(T('q5 finish early: button shows what you keep and how many guesses go unused'), !fin.hidden && /Finish with \+\d+ m/.test(fin.label) && fin.note === '2 guesses unused', `${fin.label} · ${fin.note}`);
  await p.click('#finish'); await waitDone(p);
  ok(T('q5: finished with one guess, no confirmation step'), (await S(p)).n === 1 && await p.evaluate(() => document.querySelector('#best-name').textContent === 'Ferrari'));
  await p.click('#next');
  await p.waitForSelector('[data-screen="end"]:not([hidden])'); await p.waitForTimeout(700);
  const end = await p.evaluate(() => { const c = document.querySelector('#share-canvas'), g = c.getContext('2d'), px = g.getImageData(0, 0, c.width, c.height).data; let lit = 0; for (let i = 0; i < px.length; i += 4000) if (px[i] + px[i + 1] + px[i + 2] > 60) lit++;
    return { total: document.querySelector('#e-total').textContent, rows: [...document.querySelectorAll('#e-rounds li')].map(l => l.innerText.replace(/\n/g, ' ')), text: document.querySelector('#e-card').textContent, deepest: document.querySelector('#e-deepest').textContent, rank: document.querySelector('#e-rank').textContent, lit, emoji: /\p{Extended_Pictographic}/u.test(document.querySelector('[data-screen="end"]').innerText), icons: document.querySelectorAll('#e-rounds .cat-svg').length }; });
  const sum = depths[2] + d2[0] + (+q3.replace('m', '')) + (await p.evaluate(() => ICEBERG_TEST.depthOf(ICEBERG_TEST.shareOf('snafu', 3)) + ICEBERG_TEST.depthOf(ICEBERG_TEST.shareOf('ferrari', 4))));
  ok(T('end: total is the sum of the five deepest answers'), +end.total.replace(/,/g, '') === sum, `${end.total} = ${sum}`);
  ok(T('end: five rows, deepest find named, custom icons, no emoji'), end.rows.length === 5 && /rarest answer (axolotl|jabuticaba|zester)/.test(end.deepest) && end.icons === 5 && !end.emoji, end.deepest);
  ok(T('end: no ranking is invented without real players'), end.rank === '');
  ok(T('end: share text is spoiler-free (depths only)'), /^Deeple #\d+ · [\d,]+ m down · [A-Za-z ]+\n1 [▓░]{10} \+\d+ m/.test(end.text) && !/axolotl|jabuticaba|zester|snorkel|ferrari|animal|fruit/i.test(end.text), end.text.replace(/\n/g, ' / '));
  ok(T('end: share card image is drawn'), end.lit > 100, `${end.lit} sampled bright pixels`);
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 8000 }).catch(() => null), p.click('#save-card')]);
  ok(T('end: image saves as a PNG'), !!dl && /deeple-\d+\.png/.test(dl.suggestedFilename()), dl ? dl.suggestedFilename() : 'no download');
  if (dl) await dl.saveAs(`tests/shot-${vp}-card.png`);
  ok(T('end layout'), !(await audit(p)).length, (await audit(p)).join('; '));
  await p.screenshot({ path: `tests/shot-${vp}-end.png` });
  const snd = await p.evaluate(() => window.__snd), need = ['start', 'question', 'submit', 'final', 'travel', 'reveal', 'deeper', 'neutral', 'rare', 'round', 'day', 'duplicate', 'invalid', 'pending', 'click'];
  ok(T('every moment has its sound; no countdown sounds remain'), need.every(n => snd.includes(n)) && !snd.includes('tick') && !snd.includes('timeup'), need.filter(n => !snd.includes(n)).join(',') || `${snd.length} sound calls`);
  ok(T('no console or page errors'), !p.errs.length, p.errs.join(' | '));
  await p.goto(URL + '?test&day=0&fast'); await p.waitForSelector('#play');
  ok(T('coming back: results button, streak and status; no practice dive offered'), await p.evaluate(() => /See today/.test(document.querySelector('#play').textContent) && !document.querySelector('#practice') && !/practice/i.test(document.querySelector('[data-screen="home"]').innerText) && /1-day streak/.test(document.querySelector('#home-streak').textContent) && /done/.test(document.querySelector('#home-day').textContent)));
  await p.context().close();
}

async function edge(b) {
  // Three answers with identical rarity.
  let p = await fresh(b, 'desk'); await start(p);
  const same = await p.evaluate(async () => { const cats = (await (await fetch('days/0.json')).json()).questions, by = {}; for (const r of cats[0].answers) if (!r.x && !/ /.test(r.a)) (by[r.s] = by[r.s] || []).push(r.a); return Object.values(by).filter(v => v.length >= 3).sort((a, b) => 0)[0].slice(0, 3); });
  const hs = []; for (const a of same) { await guess(p, a); await p.waitForTimeout(350); hs.push(await hint(p)); ok(`identical rarity (${a}): labels and markers don't overlap`, !(await overlaps(p)).length, (await overlaps(p)).join('; ')); }
  let s = await S(p), st = await slots(p);
  ok('identical rarity: all three sit at the same depth, the first stays the deepest', new Set(s.shares).size === 1 && /best/.test(st[0].cls) && !/best/.test(st[1].cls) && !/best/.test(st[2].cls) && /level with your best/.test(hs[1]), `${same.join(', ')} | ${hs[1]}`);
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
  await p.waitForFunction(() => { const st = ICEBERG_TEST.state; return st.rounds[st.round].guesses.length === 2; }, null, { timeout: 8000 }).catch(() => {}); await settle(p);
  ok('rapid: a guess typed and sent during the reveal goes in once, straight after', await p.inputValue('#answer') === '' && (await S(p)).n === 2 && (await S(p)).names[1] === 'octopus', (await S(p)).names.join(', '));
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
  ok('reload: markers are back on the iceberg, camera at the deepest', await p.evaluate(() => document.querySelectorAll('.ib-mark').length === 2 && document.querySelector('.ib-note .ib-name')?.textContent === 'octopus'));
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
    // The review endpoint's contract (api/verify.js): one answer per request, with nearby listed answers as candidates.
    const verdict = { batmobile: { status: 'ok', relationship: 'new', canonical: 'batmobile' }, 'time machine': { status: 'invalid', relationship: 'none', canonical: '', reason: 'Not a real thing with wheels' }, whip: { status: 'ok', relationship: 'alias', canonical: 'car' } }[body.answer];
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(verdict || { status: 'pending' }) }); });
  await start(p); await p.evaluate(() => { const s = ICEBERG_TEST.state; s.round = 4; localStorage.setItem('iceberg:game:' + s.day, JSON.stringify(s)); });
  await p.goto(URL + '?test&day=0&fast&verify=/verify-mock'); await p.waitForSelector('[data-screen="play"]:not([hidden])'); await p.waitForTimeout(300);
  await enter(p, 'batmobile'); await p.keyboard.press('Enter'); await p.waitForTimeout(80);
  let s = await S(p);
  ok('review: an unknown answer takes a slot at once and waits', s.n === 1 && s.status[0] === 'pending' && /Being checked/.test((await slots(p))[0].text));
  await p.waitForFunction(() => ICEBERG_TEST.state.rounds[4].guesses[0].status === 'ok', null, { timeout: 6000 }); await settle(p); await p.waitForTimeout(300);
  let st = await slots(p);
  ok('review approved: it is revealed at +52 m (Rare), never the maximum', /done/.test(st[0].cls) && /\+52m/.test(st[0].text) && /Rare/.test(st[0].text) && await p.evaluate(() => document.querySelectorAll('.ib-mark').length === 1), st[0].text);
  await enter(p, 'time machine'); await p.keyboard.press('Enter');
  await p.waitForFunction(() => ICEBERG_TEST.state.rounds[4].guesses[1].status === 'miss', null, { timeout: 6000 }); await p.waitForTimeout(200); st = await slots(p);
  ok('review rejected: the slot stays used, with the reason and no depth', /miss/.test(st[1].cls) && /Not a real thing with wheels/.test(st[1].text) && (await S(p)).n === 2, st[1].text);
  ok('review: only the unknown answer was sent, one per request, with the question, its rule, at most 5 nearby listed answers and nothing else', bodies.length === 2 && bodies.every(x => typeof x.answer === 'string' && x.question.key === 'wheels' && Array.isArray(x.question.rules) && x.candidates.length <= 5 && Object.keys(x).sort().join() === 'answer,candidates,player,question'), JSON.stringify(bodies.map(x => x.answer)));
  await guess(p, 'car'); await waitDone(p);
  ok('review: best is still the approved answer (52 m beats car)', await p.evaluate(() => document.querySelector('#best-name').textContent === 'batmobile' && document.querySelector('#best-depth').textContent === '+52m'));
  ok('review: verdicts are remembered, so the same answer is judged instantly next time', await p.evaluate(() => ICEBERG_TEST.judge('Batmobile', 4).status === 'ok' && ICEBERG_TEST.judge('time machine', 4).status === 'invalid'));
  await p.context().close();
  // Same-as-earlier verdict, and a dead service.
  const q = await fresh(b, 'desk', '&verify=/verify-mock');
  await q.route('**/verify-mock', route => route.request().method() !== 'POST' ? route.continue() : route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 'ok', relationship: 'alias', canonical: 'car' }) }));
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
  ok('pending answers earn nothing: score comes from the valid guess only', await d.evaluate(() => document.querySelector('#best-name').textContent === 'dog' && document.querySelector('#best-depth').textContent === '+0m'));
  // A verdict that arrives later (remembered on the device) updates the pending guess and the score.
  await d.evaluate(() => localStorage.setItem('iceberg:verdicts:animals', JSON.stringify({ pikachu: { status: 'ok' } })));
  await d.goto(URL + '?test&day=0&fast'); await d.waitForTimeout(600);
  ok('pending verified later: the score updates', await d.evaluate(() => document.querySelector('#best-name').textContent === 'pikachu' && document.querySelector('#best-depth').textContent === '+52m'), await d.textContent('#best-depth'));
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
  ok('reveal length: ordinary guesses take under 1.5 seconds (each still visibly lands)', times.slice(0, 3).every(t => t > 500 && t < 1500), times.slice(0, 3).map(t => (t / 1000).toFixed(2) + ' s').join(', '));
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
    await p.waitForFunction(() => !document.querySelector('#play').disabled); const meta = (await p.textContent('#home-day')).split(' · ')[0];
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

// The living scene: wildlife by depth, encounters, the annotation, reduced motion, the calmer setting.
async function scene(b) {
  const fs = require('fs'), path = require('path'), root = path.join(__dirname, '..');
  const band = k => p.evaluate(key => Wildlife.species().find(s => s.key === key).band, k);
  let p = await fresh(b, 'desk'); await start(p);
  const life = () => p.evaluate(() => ICEBERG_TEST.life.stats());
  const cast = await p.evaluate(() => Wildlife.species());
  ok('wildlife: every real animal names its species, its real range and a depth band; the inventions are marked as such', cast.length >= 18 && cast.every(s => s.name && s.real.length > 20 && (s.fiction ? s.rare : /^[A-Z][a-z]+( [a-z]+)?$/.test(s.latin) && (s.rare ? s.min >= 200 : s.zone[1] > s.zone[0]))), cast.length + ' animals');
  ok('wildlife: bands cover the surface, midwater, the deep and the abyss', ['surface', 'mid', 'deep', 'abyss'].every(k => cast.filter(s => s.band === k).length >= 3), ['surface', 'mid', 'deep', 'abyss'].map(k => k + ' ' + cast.filter(s => s.band === k).length).join(', '));
  await p.waitForTimeout(900);
  const top = await life();
  ok('wildlife: the water is populated, drawn on its own layers behind and in front of the iceberg', top.animals >= 15 && await p.evaluate(() => ['back', 'front', 'lume'].every(k => { const c = document.querySelector('.ib-life-' + k); return c && c.width > 50 && getComputedStyle(c).imageRendering === 'pixelated'; })), top.animals + ' animals');
  ok('wildlife: layer order is sea, animals, ice, animals, darkness, living light, fade, text', await p.evaluate(() => [...document.querySelector('#ib').children].map(n => n.getAttribute('class').split(' ').pop()).join(' ').startsWith('ib-sea ib-life-back ib-ice ib-life-front ib-snow ib-shade ib-life-lume ib-glow ib-veil ib-bestline ib-route ib-lines ib-layer')), await p.evaluate(() => [...document.querySelector('#ib').children].map(n => n.getAttribute('class').split(' ').pop()).join(' ')));
  ok('wildlife: same pixel size as the iceberg artwork', await p.evaluate(() => { const v = ICEBERG_TEST.berg.view, c = document.querySelector('.ib-life-back'); return Math.abs(c.getBoundingClientRect().width / c.width - v.u) < 0.01; }));
  const surfaceView = top.inView;
  ok('at the surface: only surface animals are in view', surfaceView.length > 0 && surfaceView.every(k => cast.find(s => s.key === k).band === 'surface'), surfaceView.join(', '));
  // A common answer: no encounter. Then down through the bands.
  await guess(p, 'dog'); await p.waitForTimeout(700);
  ok('common answer (0 m): no great animal, no sighting line', (await life()).guests === 0 && !(await p.$('.ib-sight')));
  await guess(p, 'koala'); await p.waitForTimeout(900);
  const mid = (await life()).inView;
  ok('at 100 m: midwater and deep animals have replaced the surface ones', mid.some(k => ['mid', 'deep'].includes(cast.find(s => s.key === k).band)) && !mid.includes('seal') && !mid.includes('auk'), mid.join(', '));
  ok('uncommon/deep answer (100 m): still no great animal', (await life()).guests === 0);
  const made0 = (await life()).made;
  await guess(p, 'numbat'); await p.waitForTimeout(900);
  const deep = (await life()).inView;
  ok('at 317 m (the Twilight Zone): nothing from the surface in view', deep.every(k => cast.find(s => s.key === k).band !== 'surface'), deep.join(', ') || 'nothing in view');
  await p.waitForTimeout(600);
  ok('Unfathomable answer (+317 m): the colossal squid comes, and the annotation says so', (await p.evaluate(() => ICEBERG_TEST.life.guests)).includes('colossal') && /colossal squid/i.test(await p.textContent('.ib-sight')), await p.evaluate(() => ICEBERG_TEST.life.guests.join(',')));
  ok('encounter plays its own quiet sound', (await p.evaluate(() => window.__snd)).includes('encounter'));
  await waitDone(p); await p.waitForTimeout(500);
  // Back up to the first guess and down again: the same water, not a fresh one.
  await p.click('#sum li:nth-child(1) .sum-row'); await p.waitForFunction(() => document.querySelector('.ib-note.in .ib-name')?.textContent === 'dog', null, { timeout: 6000 }); await p.waitForTimeout(500);
  const up = await life();
  ok('camera back up: surface animals again, same population (nothing was regenerated)', up.inView.some(k => cast.find(s => s.key === k).band === 'surface') && up.made === made0, up.inView.join(', '));
  await p.click('#sum li:nth-child(3) .sum-row'); await p.waitForFunction(() => document.querySelector('.ib-note.in .ib-name')?.textContent === 'numbat', null, { timeout: 6000 }); await p.waitForTimeout(400);
  ok('camera down again: the squid is still there, and is not triggered twice', JSON.stringify(await p.evaluate(() => ICEBERG_TEST.life.guests)) === '["colossal"]');
  ok('results note what was seen, the rare animal first', /Seen on this dive: colossal squid/.test(await p.textContent('#seen')), await p.textContent('#seen'));
  ok('sightings are kept for later (a future collection)', await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('iceberg:sightings') || '{}'); return s.colossal && s.colossal.n === 1 && Object.keys(s).length >= 5; }));
  ok('scene: no errors', !p.errs.length, p.errs.join('; '));
  await p.context().close();

  // Thresholds: an encounter needs the answer's own rarity (its depth) and the dive's region (the running total).
  // A deeper one never brings the shallower one with it, and none comes twice in a question.
  p = await fresh(b, 'desk'); await start(p);
  for (const [depth, at, want] of [[200, 200, ''], [199, 400, ''], [200, 350, 'giant'], [250, 350, 'giant'], [250, 650, 'bigfin'], [300, 330, 'colossal'], [0, 1600, ''], [40, 1600, 'megalodon'], [210, 1750, 'coil'], [320, 1750, 'colossal']]) {
    const got = await p.evaluate(([d, a]) => { const e = ICEBERG_TEST.life.encounterFor(d, [], a); return e ? e.key : ''; }, [depth, at]);
    ok(`threshold: a +${depth} m answer at ${at} m brings ${want || 'nothing'}`, got === want, got || 'nothing');
  }
  ok('a second answer in the same question does not repeat the encounter', await p.evaluate(() => !ICEBERG_TEST.life.encounterFor(220, ['giant'], 400)));
  await p.context().close();

  // The annotation.
  for (const vp of ['desk', 'phone']) {
    p = await fresh(b, vp); await start(p);
    await enter(p, 'great white shark'); await p.waitForFunction(() => document.querySelector('.ib-note.in'), null, { timeout: 8000 });
    const early = await p.evaluate(() => ({ first: +getComputedStyle(document.querySelector('.ib-name')).opacity, last: +getComputedStyle(document.querySelector('.ib-meta')).opacity, line: getComputedStyle(document.querySelector('.ib-leader')).strokeDashoffset }));
    await p.waitForTimeout(1500);
    const a = await p.evaluate(() => {
      const n = document.querySelector('.ib-note'), cs = getComputedStyle(n), r = n.getBoundingClientRect(), m = document.querySelector('.ib-mark.focus').getBoundingClientRect();
      const hit = sel => { const e = document.querySelector(sel); if (!e || e.closest('[hidden]')) return false; const q = e.getBoundingClientRect(); return q.width && r.left < q.right && q.left < r.right && r.top < q.bottom && q.top < r.bottom; };
      return { order: [...n.children].map(c => c.className).join(' '), text: n.innerText.replace(/\n/g, ' | '), bg: cs.backgroundColor, border: cs.borderTopWidth, radius: cs.borderTopLeftRadius, shadow: cs.boxShadow,
        d: document.querySelector('.ib-leader').getAttribute('d'), last: +getComputedStyle(n.querySelector('.ib-meta')).opacity, inside: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight,
        overControls: ['.q', '#play-panel', '.top'].filter(hit).join(','), overMark: r.left < m.right && m.left < r.right && r.top < m.bottom && m.top < r.bottom, sizes: [...n.children].map(c => parseFloat(getComputedStyle(c).fontSize)) };
    });
    ok(`${vp} annotation: reads answer, share of players, depth, rarity, then guess (no simulated player count)`, /^ib-name ib-share ib-below ib-rank ib-meta/.test(a.order) && /great white shark \| (~?0\.\d+%|under 0\.1%) of players( \(est\.\))? EXCEPTIONAL \| \+203 m · down to 203 m/i.test(a.text) && /Rarer than \d+% of answers given \| Guess 1(?! · [\d,]+ of)/.test(a.text) && !/50,000/.test(a.text), a.text);
    ok(`${vp} annotation: the answer is the largest line, the small print the smallest`, a.sizes[0] > a.sizes[1] && a.sizes[1] >= a.sizes[2] && a.sizes[2] > a.sizes[4], a.sizes.join(' > '));
    ok(`${vp} annotation: open, not a card (no fill, border, rounded box or drop shadow)`, /rgba\(0, 0, 0, 0\)|transparent/.test(a.bg) && a.border === '0px' && a.radius === '0px' && a.shadow === 'none', `${a.bg} ${a.border} ${a.radius} ${a.shadow}`);
    ok(`${vp} annotation: joined to its marker by a line, and clear of the marker, the controls and the window edge`, /^M[\d.-]+ [\d.-]+[HV]/.test(a.d) && a.inside && !a.overControls && !a.overMark, `${a.d} ${a.overControls}`);
    ok(`${vp} annotation: revealed in stages (the answer first, the small print last)`, early.first >= early.last && early.last < 0.5 && a.last === 1, `at landing: answer ${early.first.toFixed(2)}, small print ${early.last.toFixed(2)}`);
    ok(`${vp} annotation: the box is ready for the next guess while it draws`, await p.evaluate(() => !ICEBERG_TEST.busy && document.activeElement.id === 'answer'));
    // Two answers at the same depth, then a short one on the tip: markers and labels never collide.
    await guess(p, 'zebra'); await guess(p, 'bear'); await p.waitForTimeout(400);
    ok(`${vp}: two answers at the same depth (zebra, bear at 20 m) keep separate markers and labels`, !(await overlaps(p)).length, (await overlaps(p)).join('; '));
    await waitDone(p); await p.waitForTimeout(700);
    const fr = await p.evaluate(() => { const v = ICEBERG_TEST.berg.view, d = document.querySelector('#done-panel').getBoundingClientRect(), n = document.querySelector('.ib-note').getBoundingClientRect(); return { axis: v.axis, dl: d.left, dt: d.top, nr: n.right, nb: n.bottom, w: innerWidth }; });
    ok(`${vp} results: the iceberg moves aside for the panel and the annotation stays clear of it`, vp === 'desk' ? fr.axis < fr.dl && fr.nr <= fr.dl + 1 : fr.nb <= fr.dt + 1, JSON.stringify(fr));
    await p.context().close();
  }

  // Reduced motion: everything still works, nothing animates, the squid is simply there.
  p = await open(b, 'desk', URL + '?test&day=0&fast&reset', { ctx: { reducedMotion: 'reduce' } }); await start(p);
  await guess(p, 'numbat'); await p.waitForTimeout(700);
  const rm = await p.evaluate(() => ({ s: ICEBERG_TEST.life.stats(), guests: ICEBERG_TEST.life.guests, note: +getComputedStyle(document.querySelector('.ib-meta')).opacity, depth: ICEBERG_TEST.berg.depth }));
  const px = () => p.evaluate(() => { const c = document.querySelector('.ib-life-back'); return c.toDataURL().length + ':' + c.style.transform; });
  const f1 = await px(); await p.waitForTimeout(600); const f2 = await px();
  ok('reduced motion: the answer still lands and is fully annotated at once', rm.depth === 317 && rm.note === 1);
  ok('reduced motion: animals are drawn but hold still', rm.s.reduce && rm.s.animals > 10 && f1 === f2);
  ok('reduced motion: the encounter still happens, without movement', rm.guests.includes('colossal'));
  ok('reduced motion: no errors', !p.errs.length, p.errs.join('; '));
  await p.context().close();

  // The "Calmer water" setting.
  p = await fresh(b, 'desk'); await start(p); await p.waitForTimeout(300);
  const full = await p.evaluate(() => ICEBERG_TEST.life.stats());
  await p.click('#sound-btn'); await p.check('#fx-low'); await p.waitForTimeout(300);
  const calm = await p.evaluate(() => ICEBERG_TEST.life.stats());
  ok('calmer water: fewer animals at once, and the choice is remembered', calm.low && calm.animals < full.animals && await p.evaluate(() => localStorage.getItem('iceberg:fx') === '"low"'), `${full.animals} -> ${calm.animals}`);
  await p.reload(); await p.waitForSelector('#play'); await p.click('#play'); await p.waitForTimeout(600);
  ok('calmer water: still on after a reload', await p.evaluate(() => ICEBERG_TEST.life.low && document.querySelector('#fx-low').checked));
  await p.context().close();

  // Colour: no gold or purple left anywhere in the game's own files.
  const src = ['index.html', 'iceberg.js', 'wildlife.js', 'share.js', 'brand.js', 'game.js'].map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
  ok('palette: no gold or purple anywhere in the game', !/ffcf5a|255, ?207, ?90|#b693ff|#c9a6ff|#9091f7|var\(--gold\)|var\(--amber\)/i.test(src));
}

// Smoothness, measured in this test browser (software rendering, so real devices should do better).
async function perf(b) {
  for (const vp of ['desk', 'phone']) {
    const p = await open(b, vp, URL + '?test&day=0&reset'); await start(p); await p.waitForTimeout(1800);
    const measure = () => p.evaluate(() => new Promise(res => { const d = []; let last = performance.now(), n = 0; const f = t => { d.push(t - last); last = t; if (++n < 150) requestAnimationFrame(f); else { d.sort((a, b) => a - b); res({ median: d[75], p95: d[142], cost: ICEBERG_TEST.life.stats().cost }); } }; requestAnimationFrame(f); }));
    const idle = await measure();
    await p.fill('#answer', 'axolotl'); await p.keyboard.press('Enter'); const travel = await measure();
    ok(`${vp} smoothness: frames while idle and while the camera travels with wildlife on screen`, idle.median < 34 && travel.median < 34, `idle median ${idle.median.toFixed(1)} ms (95th ${idle.p95.toFixed(1)}), travelling median ${travel.median.toFixed(1)} ms (95th ${travel.p95.toFixed(1)}); wildlife drawing ${travel.cost.toFixed(2)} ms a frame`);
    ok(`${vp} smoothness: drawing the animals takes a small share of a frame`, travel.cost < 4, travel.cost.toFixed(2) + ' ms');
    await p.context().close();
  }
}

// The melting-ice timer.
async function timer(b) {
  const C = p => p.evaluate(() => ICEBERG_TEST.clock);
  const timed = async (vp, secs, extra = '', opts) => { const p = await open(b, vp, URL + `?test&day=0&reset&time=${secs}${extra}`, opts); await p.evaluate(() => { window.__snd = []; const o = Sound.play; Sound.play = (n, a) => { window.__snd.push(n); return o(n, a); }; }); return p; };
  const begin = async p => { await p.click('#play'); await p.waitForSelector('[data-screen="play"]:not([hidden])'); };
  const running = p => p.waitForFunction(() => ICEBERG_TEST.clock.on, null, { timeout: 8000 });

  // Layout, start, pause and resume, at real speed.
  for (const vp of ['desk', 'phone']) {
    const p = await timed(vp, 45); await begin(p);
    const early = await C(p);
    ok(`${vp} timer: the clock waits until the question is in view`, !early.on && early.left === 45000, JSON.stringify(early));
    await running(p); await p.waitForTimeout(700);
    const box = await p.evaluate(() => { const r = s => document.querySelector(s).getBoundingClientRect(), m = r('#melt'), e = r('#entry'), a = r('#answer'), n = document.querySelector('#melt-n'), cs = getComputedStyle(n);
      return { inside: m.left >= e.left && m.right <= a.left + 1 && m.top >= e.top - 1 && m.bottom <= e.bottom + 1, leftOf: m.right <= a.left + 1, input: a.width, text: n.textContent, font: cs.fontFamily, size: parseFloat(cs.fontSize), sameFont: cs.fontFamily === getComputedStyle(document.querySelector('#answer')).fontFamily, canvas: document.querySelector('#melt-ice').getBoundingClientRect().width, pix: getComputedStyle(document.querySelector('#melt-ice')).imageRendering, emoji: /\p{Extended_Pictographic}/u.test(document.querySelector('#entry').innerText) }; });
    ok(`${vp} timer: sits inside the answer bar, to the left of the box, in the same type`, box.inside && box.leftOf && box.sameFont && box.size >= 14 && box.input > 150 && !box.emoji, JSON.stringify(box));
    ok(`${vp} timer: custom pixel artwork, small`, box.pix === 'pixelated' && box.canvas <= 40);
    ok(`${vp} timer: counting down from 45`, /^4[345]$/.test(box.text) && (await C(p)).left < 45000, box.text);
    ok(`${vp} timer: layout has no overlap or clipping`, !(await audit(p)).length, (await audit(p)).join('; '));
    // A deep answer: a long journey. The clock must not run during it.
    const before = await C(p);
    await p.fill('#answer', 'axolotl'); const t0 = Date.now(); await p.keyboard.press('Enter');
    await p.waitForTimeout(500); const mid = await C(p);
    await settle(p); const took = Date.now() - t0, after = await C(p);
    ok(`${vp} timer: stops for the reveal and the camera's journey down`, !mid.on && took > 1500 && before.left - after.left < 600, `reveal took ${took} ms, clock moved ${Math.round(before.left - after.left)} ms`);
    ok(`${vp} timer: carries on, from where it stopped, when the box is ready again`, after.on && after.left > 38000);
    // A common answer now: in the dive the camera stays where it is (only ever down); the clock rule is the same.
    const b2 = await C(p); await p.fill('#answer', 'dog'); const t1 = Date.now(); await p.keyboard.press('Enter'); await settle(p); const a2 = await C(p);
    ok(`${vp} timer: also stops for an answer that doesn't take you deeper (no journey, the dive only goes down)`, b2.left - a2.left < 600, `clock moved ${Math.round(b2.left - a2.left)} ms`);
    await p.waitForTimeout(1200); const s1 = await C(p);
    ok(`${vp} timer: the ice matches the time left`, Math.abs(s1.ice.fraction - s1.left / s1.total) < 0.02 && s1.ice.length < 16.6 && s1.ice.length > 2.4, `${(s1.ice.fraction * 100).toFixed(1)}% ice, ${(100 * s1.left / s1.total).toFixed(1)}% time`);
    // Third guess: the question ends in the ordinary way, with time to spare.
    await guess(p, 'koala'); await waitDone(p);
    const d = await p.evaluate(() => ({ t: ICEBERG_TEST.state.rounds[0].timeout, best: document.querySelector('#best-name').textContent, aside: document.querySelector('#sum-aside').textContent }));
    ok(`${vp} timer: three guesses inside the time ends the question normally`, !d.t && d.best === 'axolotl' && !/time ran out/.test(d.aside) && !(await C(p)).on, d.aside);
    ok(`${vp} timer: no errors`, !p.errs.length, p.errs.join('; '));
    await p.context().close();
  }

  // Out of time after one guess, after two, and with none.
  let p = await timed('desk', 7); await begin(p); await running(p);
  await guess(p, 'octopus'); await waitDone(p); await p.waitForTimeout(300);
  let d = await p.evaluate(() => ({ r: ICEBERG_TEST.state.rounds[0], best: document.querySelector('#best-name').textContent, depth: document.querySelector('#best-depth').textContent, aside: document.querySelector('#sum-aside').textContent, snd: window.__snd }));
  ok('time runs out after one guess: the question ends and that answer is kept and scored', d.r.timeout && d.r.guesses.length === 1 && d.best === 'octopus' && d.depth === '+121m' && /time ran out · 2 unused/.test(d.aside), `${d.best} ${d.depth}, ${d.aside}`);
  ok('last seconds: a water drop each second, then a soft dissolve; no alarm', d.snd.filter(x => x === 'drip').length >= 4 && d.snd.filter(x => x === 'drip').length <= 5 && d.snd.includes('melt') && (await C(p)).ice.melted, d.snd.filter(x => /drip|melt|crack/.test(x)).join(','));
  await p.click('#next'); await running(p);
  await guess(p, 'banana'); await guess(p, 'kiwano'); await waitDone(p); await p.waitForTimeout(300);
  d = await p.evaluate(() => ({ r: ICEBERG_TEST.state.rounds[1], best: document.querySelector('#best-name').textContent, depth: document.querySelector('#best-depth').textContent }));
  ok('time runs out after two guesses: the deeper of the two is the score', d.r.timeout && d.r.guesses.length === 2 && d.best === 'kiwano' && d.depth === '+260m', `${d.best} ${d.depth}`);
  await p.click('#next'); await running(p); await waitDone(p); await p.waitForTimeout(300);
  d = await p.evaluate(() => ({ r: ICEBERG_TEST.state.rounds[2], lbl: document.querySelector('#best-lbl').textContent, depth: document.querySelector('#best-depth').textContent, next: !document.querySelector('#next').closest('[hidden]') }));
  ok('time runs out with no answer: 0 m, said plainly, and the game carries on', d.r.timeout && d.r.guesses.length === 0 && /^Time ran out/.test(d.lbl) && d.depth === '+0m' && d.next, `${d.lbl} ${d.depth}`);
  await p.click('#next'); await running(p);
  ok('each question starts with its full time', Math.abs((await C(p)).left - 7000) < 500);
  ok('timed-out questions: no errors', !p.errs.length, p.errs.join('; '));
  await p.context().close();

  // Urgency is gradual and stays in the palette.
  p = await timed('desk', 12); await begin(p); await running(p);
  const cls = () => p.evaluate(() => ({ c: document.querySelector('#melt').className, col: getComputedStyle(document.querySelector('#melt-n')).color, n: +document.querySelector('#melt-n').textContent }));
  const u0 = await cls(); await p.waitForFunction(() => +document.querySelector('#melt-n').textContent <= 9); const u1 = await cls();
  await p.waitForFunction(() => +document.querySelector('#melt-n').textContent <= 4); await p.waitForTimeout(650); const u2 = await cls();
  const redish = c => { const m = c.match(/\d+/g).map(Number); return m[0] > m[2] + 30; };
  ok('urgency: calm above ten seconds, brighter under ten, a little larger under five; never red', !/low|last/.test(u0.c) && /low/.test(u1.c) && !/last/.test(u1.c) && /last/.test(u2.c) && ![u0, u1, u2].some(x => redish(x.col)), `${u0.c} | ${u1.c} | ${u2.c} ${u2.col}`);
  ok('a single dry crack marks ten seconds left', (await p.evaluate(() => window.__snd.filter(x => x === 'crack').length)) === 1);
  await p.context().close();

  // Finishing early stops the clock for good.
  p = await timed('desk', 6); await begin(p); await running(p); await guess(p, 'octopus'); await p.click('#finish'); await waitDone(p); await p.waitForTimeout(6500);
  d = await p.evaluate(() => ({ t: ICEBERG_TEST.state.rounds[0].timeout, snd: window.__snd, round: ICEBERG_TEST.state.round }));
  ok('finish early: the clock stops, nothing times out afterwards', !d.t && !d.snd.includes('melt') && d.round === 0);
  await p.context().close();

  // A reload never hands time back, and time away from the page still counts.
  p = await timed('desk', 30); await begin(p); await running(p); await p.waitForTimeout(2500);
  const r0 = (await C(p)).left;
  await p.goto(URL + '?test&day=0&time=30'); await p.waitForSelector('[data-screen="play"]:not([hidden])'); await p.waitForTimeout(400);
  const r1 = await C(p);
  ok('reload: the time already used stays used', r1.left < r0 + 50 && r1.left > r0 - 2500 && r1.left < 28000, `${Math.round(r0)} ms before, ${Math.round(r1.left)} ms after`);
  await p.goto('about:blank'); await p.waitForTimeout(3000);
  await p.goto(URL + '?test&day=0&time=30'); await p.waitForSelector('[data-screen="play"]:not([hidden])'); await p.waitForTimeout(300);
  const r2 = await C(p);
  ok('closing the page does not stop the clock: three seconds away cost three seconds', r1.left - r2.left > 2800 && r1.left - r2.left < 5500, `${Math.round(r1.left - r2.left)} ms`);
  // Reload while an answer is on the iceberg: guesses and time both survive.
  await guess(p, 'octopus'); const r3 = (await C(p)).left; await p.goto(URL + '?test&day=0&time=30'); await p.waitForSelector('[data-screen="play"]:not([hidden])'); await p.waitForTimeout(400);
  const r4 = await C(p), st = await S(p);
  ok('reload mid-question: the guess is still there and the clock picks up', st.n === 1 && r4.on && r4.left <= r3 + 50 && r4.left > r3 - 2500);
  await p.context().close();

  // An answer still being checked when time runs out is not lost.
  p = await timed('desk', 4, '&verify=/verify-mock');
  await p.route('**/verify-mock', async route => { if (route.request().method() !== 'POST') return route.continue(); await new Promise(r => setTimeout(r, 6000)); await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 'ok', relationship: 'new', canonical: 'jackalope' }) }); });
  await begin(p); await running(p);
  await enter(p, 'jackalope'); await p.keyboard.press('Enter'); await waitDone(p);
  const v0 = await p.evaluate(() => ICEBERG_TEST.state.rounds[0].guesses[0].status);
  await p.waitForFunction(() => ICEBERG_TEST.state.rounds[0].guesses[0].status === 'ok', null, { timeout: 9000 }); await p.waitForTimeout(500);
  d = await p.evaluate(() => ({ depth: document.querySelector('#best-depth').textContent, t: ICEBERG_TEST.state.rounds[0].timeout }));
  ok('slow checking: an answer approved after time ran out still gets its depth', v0 === 'pending' && d.t && d.depth === '+52m', `${v0} -> ${d.depth}`);
  await p.context().close();

  // Sound off, and reduced motion.
  p = await timed('desk', 6); await p.evaluate(() => Sound.set({ muted: true })); await begin(p); await running(p); await waitDone(p);
  ok('muted: the timer runs and ends without sound or errors', (await p.evaluate(() => Sound.prefs.muted && ICEBERG_TEST.state.rounds[0].timeout)) && !p.errs.length, p.errs.join('; '));
  await p.context().close();
  p = await timed('desk', 6, '', { ctx: { reducedMotion: 'reduce' } }); await begin(p); await running(p); await p.waitForTimeout(2200);
  const m1 = await C(p); await waitDone(p);
  ok('reduced motion: the ice still shows the time left (no falling drops), and time still ends the question', Math.abs(m1.ice.fraction - m1.left / m1.total) < 0.03 && m1.ice.drops === 0 && (await p.evaluate(() => ICEBERG_TEST.state.rounds[0].timeout)) && !p.errs.length);
  await p.context().close();

  // Smoothness with the timer running.
  p = await timed('phone', 45); await begin(p); await running(p); await p.waitForTimeout(800);
  const fr = await p.evaluate(() => new Promise(res => { const d = []; let last = performance.now(), n = 0; const f = t => { d.push(t - last); last = t; if (++n < 150) requestAnimationFrame(f); else { d.sort((a, b) => a - b); res({ median: d[75], p95: d[142] }); } }; requestAnimationFrame(f); }));
  ok('smoothness with the timer running (phone size)', fr.median < 34, `median ${fr.median.toFixed(1)} ms, 95th ${fr.p95.toFixed(1)} ms`);
  await p.screenshot({ path: 'tests/shot-phone-timer.png' });
  await p.context().close();
}

// The name lives in one place and can be previewed without changing the game.
async function brand(b) {
  let p = await fresh(b, 'desk');
  ok('name: the game is called Deeple by default', (await p.title()) === 'Deeple' && (await p.textContent('#brand')).trim() === 'Deeple' && (await p.textContent('.wordmark')) === 'Deeple');
  ok('name: the old name appears nowhere a player would read it', !/Iceberg/.test((await p.evaluate(() => document.body.innerText + ' ' + document.title + ' ' + document.querySelector('meta[property="og:title"]').content)).replace(/today's iceberg/gi, '')));
  ok('name: the tab has an icon', await p.evaluate(() => /^data:image\/svg\+xml/.test(document.querySelector('link[rel=icon]').href)));
  await p.context().close();
  p = await fresh(b, 'desk', '&brand=oddfish');
  const o = await p.evaluate(() => ({ title: document.title, head: document.querySelector('#brand').textContent.trim(), word: document.querySelector('.wordmark').textContent, tag: document.querySelector('.tagline').textContent, desc: document.querySelector('meta[name=description]').content, share: IcebergShare.text({ day: 3, total: 420, rounds: [null, null, null, null, null], streak: 0 }), label: document.querySelector('#brand').getAttribute('aria-label'), body: document.body.innerText }));
  ok('preview (?brand=oddfish): header, home page, tab, search text and share message all change together', o.title === 'Oddfish' && o.head === 'Oddfish' && o.word === 'Oddfish' && /The rarer, the deeper/.test(o.tag) && /sink to the bottom/.test(o.desc) && /^Oddfish #3 · 420 m/.test(o.share) && /The rarer, the deeper/.test(o.share) && o.label === 'Oddfish home', o.share.split('\n')[0]);
  ok('preview: the old name appears nowhere a player would read it', !/Iceberg/.test(o.body.replace(/today's iceberg/gi, '')));
  await p.context().close();
  p = await fresh(b, 'desk', '&brand=nonsense');
  ok('an unknown name falls back to the default', (await p.title()) === 'Deeple');
  await p.context().close();
  for (const vp of ['desk', 'phone', 'small']) {
    const { VPS } = require('./lib.cjs'), ctx = await b.newContext({ viewport: VPS[vp] }), q = await ctx.newPage(), errs = [];
    q.on('pageerror', e => errs.push(e.message));
    await q.goto(URL + 'brand.html'); await q.waitForTimeout(700);
    const r = await q.evaluate(() => ({ boards: document.querySelectorAll('.board').length, names: [...document.querySelectorAll('.board-head h2')].map(n => n.textContent).join(', '), over: document.documentElement.scrollWidth - innerWidth, icons: document.querySelectorAll('.icons svg').length, small: [...document.querySelectorAll('.icons figure:first-child svg')].every(s => s.getBoundingClientRect().width === 16), links: [...document.querySelectorAll('.board-head a')].map(a => a.getAttribute('href')).join(' ') }));
    ok(`name previews (${vp}): five names shown at tab, header, phone-icon and headline size, with no sideways scroll`, r.boards === 5 && r.over <= 0 && r.icons === 20 && r.small && !errs.length && /brand=nerodeep/.test(r.links), `${r.names}; ${errs.join('; ')}`);
    if (vp !== 'small') await q.screenshot({ path: `tests/shot-brand-${vp}.png` });
    await ctx.close();
  }
}

(async () => {
  const srv = serve(8782), b = await chromium.launch({ args: ['--autoplay-policy=document-user-activation-required'] });
  const only = process.argv[2];
  const jobs = { desk: () => fullGame(b, 'desk'), phone: () => fullGame(b, 'phone'), edge: () => edge(b), reload: () => reload(b), review: () => review(b), audio: () => audio(b), timing: () => timing(b), sizes: () => sizes(b), daily: () => daily(b), scene: () => scene(b), perf: () => perf(b), brand: () => brand(b), timer: () => timer(b) };
  for (const [k, f] of Object.entries(jobs)) if (!only || only.split(',').includes(k)) { try { await f(); } catch (e) { ok(`${k}: test run completed`, false, e.message.split('\n')[0]); } }
  console.log(R.join('\n')); console.log(`\n${R.length - fails} passed, ${fails} failed`);
  await b.close(); srv.close();
})();
