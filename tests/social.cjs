// Accounts and social features, end to end in a real browser:
//   the game  ->  tests/gateway.cjs (a local stand-in for Supabase's web service)  ->  a local PostgreSQL database
//   holding the game's real tables, rules and functions.
// Run:  sh tests/db/setup.sh && node tests/social.cjs
// What this proves: the screens, the game's use of the database, and the database's rules.
// What it cannot prove: Supabase's own sign-in service (email delivery, Google, real sessions). Those are imitated.
const { chromium, serve, audit, VPS } = require('./lib.cjs');
const gw = require('./gateway.cjs');
const R = []; let fails = 0;
const ok = (name, cond, extra = '') => { R.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  [' + extra + ']' : ''}`); if (!cond) fails++; };
const API = 'http://localhost:8790', SITE = 'http://localhost:8783/';
const sql = (q, p) => gw.pool.query(q, p).then(r => r.rows);
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
let launch = iso(new Date());
// Make "today" day n, for the database and for the game alike.
const setDay = async n => { const d = new Date(); d.setDate(d.getDate() - (n - 1)); launch = iso(d); await sql(`update public.game_config set value = $1 where key = 'launch'`, [launch]); };
const url = (extra = '') => `${SITE}?test&fast&api=${API}&key=${gw.ANON}&launch=${launch}${extra}`;

(async () => {
  await new Promise(r => gw.server.listen(8790, r)); const site = serve(8783), b = await chromium.launch();
  await sql(`truncate auth.users cascade`); await sql(`truncate public.rate_log, public.username_holds, public.days, public.round_plays, public.day_results`);
  await setDay(1);
  const errs = [];
  const fresh = async (vp = 'desk') => { const ctx = await b.newContext({ viewport: VPS[vp], hasTouch: vp === 'phone' }), p = await ctx.newPage(); p.errs = []; p.on('pageerror', e => { p.errs.push(e.message); errs.push(e.message); }); p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) { p.errs.push(m.text()); errs.push(m.text().slice(0, 200)); } }); await p.goto(url()); await p.waitForSelector('#play'); await p.waitForFunction(() => window.Account && Account.state !== 'off', null, { timeout: 10000 }); return p; };
  const reload = async (p, extra = '') => { await p.goto(url(extra)); await p.waitForSelector('#play'); await p.waitForFunction(() => window.Account && Account.state !== 'off', null, { timeout: 10000 }); await p.waitForTimeout(700); };
  // Play today's five questions: one answer each, about as rare as asked (0 = most common, 1 = rarest listed).
  const play = async (p, rarity = 0.6) => {
    await p.click('#play'); await p.waitForSelector('[data-screen="play"]:not([hidden])'); const said = [];
    for (let q = 0; q < 5; q++) {
      const a = await p.evaluate(([i, f]) => { const c = ICEBERG_TEST.cats[i].answers.filter(x => !x.x).sort((x, y) => y.s - x.s); return c[Math.min(c.length - 1, Math.floor(c.length * f))].a; }, [q, rarity]);
      said.push(a); await p.fill('#answer', a); await p.keyboard.press('Enter'); await p.waitForFunction(() => !ICEBERG_TEST.busy, null, { timeout: 15000 }); await p.waitForTimeout(150);
      await p.click('#finish'); await p.waitForFunction(() => ICEBERG_TEST.state && ICEBERG_TEST.state.phase === 'done'); await p.click('#next'); await p.waitForTimeout(200);
    }
    await p.waitForSelector('[data-screen="end"]:not([hidden])'); await p.waitForTimeout(900); return said;
  };
  const hub = async (p, tab) => { await p.evaluate(t => Hub.open(t), tab); await p.waitForSelector('[data-screen="hub"]:not([hidden])'); await p.waitForFunction(() => !document.querySelector('#hub-body .wait'), null, { timeout: 8000 }); await p.waitForTimeout(250); };
  const body = p => p.evaluate(() => document.querySelector('#hub-body').innerText.replace(/\n+/g, ' | '));
  const signUp = async (p, email, name, pw = 'secret12') => {
    await hub(p, 'account'); await p.click('#hub-body >> text=Create an account'); await p.fill('#hub-body input[type=email]', email); await p.fill('#hub-body input[type=password]', pw); await p.click('#hub-body button[type=submit]');
    await p.waitForSelector('#hub-body input[autocomplete=username]', { timeout: 8000 });
    if (name) { await p.fill('#hub-body input[autocomplete=username]', name); await p.waitForTimeout(500); await p.click('#hub-body button[type=submit]'); await p.waitForFunction(() => Account.signedIn, null, { timeout: 8000 }); await p.waitForTimeout(600); }
  };
  // A request made by hand with the signed-in player's own token: what someone could do from the browser's developer tools.
  const direct = (p, path, bodyJson, method = 'POST') => p.evaluate(async ([api, key, path, bodyJson, method]) => { const s = JSON.parse(localStorage.getItem('iceberg:auth') || 'null'), t = s && (s.access_token || (s.currentSession && s.currentSession.access_token));
    const r = await fetch(api + path, { method, headers: { apikey: key, Authorization: 'Bearer ' + (t || key), 'Content-Type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(bodyJson) }); let j = null; try { j = await r.json(); } catch { /* empty */ } return { status: r.status, body: j }; }, [API, gw.ANON, path, bodyJson, method]);

  // ---------- No database configured: nothing social is offered or faked ----------
  { const ctx = await b.newContext({ viewport: VPS.desk }), p = await ctx.newPage(); await p.goto(SITE + '?test&fast&reset'); await p.waitForSelector('#play'); await p.click('#acct-btn'); await p.waitForSelector('[data-screen="hub"]:not([hidden])');
    const t = await p.evaluate(() => ({ tabs: [...document.querySelectorAll('#hub-tabs button')].map(x => x.textContent).join(','), text: document.querySelector('#hub-body').innerText }));
    ok('without a database: only the on-device dive log exists; no sign-in, friends or rankings are offered', t.tabs === 'Dive log' && /Guest/.test(t.text) && !/Create an account|Sign in/.test(t.text), t.tabs);
    await ctx.close(); }

  // ---------- A guest plays, then makes an account ----------
  const bea = await fresh(); await signUp(bea, 'bea@example.test', 'Bea');
  ok('create an account: email and password, then a username; signed in straight away', await bea.evaluate(() => Account.signedIn && Account.profile.username === 'Bea') && (await sql(`select username from public.profiles`))[0].username === 'Bea');
  const ada = await fresh(); const adaSaid = await play(ada, 0.55);
  const guestEnd = await ada.evaluate(() => ({ social: document.querySelector('#e-social').innerText, rank: document.querySelector('#e-rank').textContent, total: +document.querySelector('#e-total').textContent.replace(/,/g, ''), days: document.querySelectorAll('#e-days i.on, #e-days i.today').length }));
  ok('guest: can play the whole day without an account', guestEnd.total > 0 && (await sql(`select count(*)::int n from public.dives`))[0].n === 0);
  ok('guest: after the first dive, one quiet invitation to make an account, and no invented ranking', /Keep this dive/.test(guestEnd.social) && /Create an account/.test(guestEnd.social) && !/Ranked #/.test(guestEnd.social + guestEnd.rank), guestEnd.social.replace(/\n/g, ' '));
  await hub(ada, 'log');
  ok('guest log: this device\'s own history, labelled as such', /Guest \| Kept on this device only/.test(await body(ada)) && await ada.evaluate(() => document.querySelectorAll('.cal button.l1, .cal button.l2, .cal button.l3, .cal button.l4').length === 1));
  await hub(ada, 'friends'); ok('guest: friends and rankings ask for an account instead of showing anything', /Sign in or create an account/.test(await body(ada)));
  await hub(ada, 'account'); await ada.click('#hub-body >> text=Create an account'); await ada.fill('#hub-body input[type=email]', 'bea@example.test'); await ada.fill('#hub-body input[type=password]', 'secret12'); await ada.click('#hub-body button[type=submit]'); await ada.waitForTimeout(700);
  ok('create an account: an email that is already registered is refused, in plain words', /already an account with that email/.test(await body(ada)));
  await ada.fill('#hub-body input[type=password]', '123'); await ada.fill('#hub-body input[type=email]', 'ada@example.test'); await ada.click('#hub-body button[type=submit]'); await ada.waitForTimeout(600);
  ok('create an account: a too-short password is refused', /at least 6 characters/.test(await body(ada)));
  await signUp(ada, 'ada@example.test', null);
  await ada.fill('#hub-body input[autocomplete=username]', 'bea'); await ada.waitForTimeout(700);
  const live1 = await ada.textContent('#hub-body .field .msg'); await ada.click('#hub-body button[type=submit]'); await ada.waitForTimeout(600);
  ok('username: a taken name (in any capitals) is flagged as you type, and refused if sent anyway', /taken/.test(live1) && /taken/.test(await ada.textContent('#hub-body .field .msg')) && !(await ada.evaluate(() => Account.signedIn)), live1);
  await ada.fill('#hub-body input[autocomplete=username]', 'admin'); await ada.waitForTimeout(700); const live2 = await ada.textContent('#hub-body .field .msg');
  await ada.fill('#hub-body input[autocomplete=username]', 'Ada'); await ada.waitForTimeout(700); const live3 = await ada.textContent('#hub-body .field .msg');
  ok('username: reserved names are refused; a free one says so', /reserved/.test(live2) && /Ada is free/.test(live3), `${live2} / ${live3}`);
  await ada.click('#hub-body button[type=submit]'); await ada.waitForFunction(() => Account.signedIn); await ada.waitForTimeout(1500);
  const moved = await sql(`select d.day, d.total, d.source, d.ranked, (select count(*)::int from public.dive_guesses g where g.dive_id = d.id) guesses from public.dives d join public.profiles p on p.id = d.user_id where p.username = 'Ada'`);
  ok('guest progress: the dive played before signing up is now on the account, scored by the database to the same total', moved.length === 1 && moved[0].total === guestEnd.total && moved[0].source === 'guest' && moved[0].guesses === 5, JSON.stringify(moved));
  await ada.evaluate(() => Game.syncProgress()); await ada.waitForTimeout(500); await reload(ada);
  ok('guest progress: signing in again or reloading does not create a second dive', (await sql(`select count(*)::int n from public.dives`))[0].n === 1);
  ok('session: still signed in after a reload', await ada.evaluate(() => Account.signedIn && Account.profile.username === 'Ada'));
  ok('one dive a day: today is finished, so the home screen offers the results, not another go', (await ada.textContent('#play')) === "See today's results");
  await ada.click('#play'); await ada.waitForSelector('[data-screen="end"]:not([hidden])'); await ada.waitForFunction(() => /Ranked #/.test(document.querySelector('#e-social').innerText), null, { timeout: 8000 });
  ok('end of day: a real place among real players', /Ranked #1 of 1 player so far/.test(await ada.textContent('#e-social')), (await ada.textContent('#e-social')).slice(0, 80));
  await hub(ada, 'log'); const log1 = await body(ada);
  ok('profile: username, streak, totals, record and deepest discovery from the database', /Ada/.test(log1) && /Daily streak \| 1 day/i.test(log1) && /Total expeditions \| 1/i.test(log1) && new RegExp(`Personal record \\| ${guestEnd.total} m`, 'i').test(log1) && /Deepest discovery \| \d+ m \| \w/i.test(log1), log1.slice(0, 260));
  ok('profile layout (desktop): no overlap, clipping or sideways scroll', !(await audit(ada)).length, (await audit(ada)).join('; '));

  // ---------- Signing out and in ----------
  await hub(ada, 'settings'); await ada.click('#sign-out'); await ada.waitForFunction(() => Account.state === 'out');
  ok('sign out: back to being a guest', await ada.evaluate(() => !Account.signedIn && !localStorage.getItem('iceberg:auth')));
  await hub(ada, 'account'); await ada.fill('#hub-body input[type=email]', 'ada@example.test'); await ada.fill('#hub-body input[type=password]', 'wrong-password'); await ada.click('#hub-body button[type=submit]'); await ada.waitForTimeout(600);
  ok('sign in: a wrong password is refused without saying which part was wrong', /email and password don't match/.test(await body(ada)));
  await ada.fill('#hub-body input[type=password]', 'secret12'); await ada.click('#hub-body button[type=submit]'); await ada.waitForFunction(() => Account.signedIn); await ada.waitForTimeout(900);
  ok('sign in: works, and nothing is duplicated', await ada.evaluate(() => Account.profile.username === 'Ada' && Account.profile.stats.dives === 1) && (await sql(`select count(*)::int n from public.dives`))[0].n === 1);
  await ada.evaluate(() => Account.signOut()); await ada.waitForTimeout(300); await hub(ada, 'account'); await ada.click('#hub-body >> text=Forgot password?'); await ada.fill('#hub-body input[type=email]', 'ada@example.test'); await ada.click('#hub-body button[type=submit]'); await ada.waitForTimeout(600);
  const mail = await (await fetch(API + '/__test/mail')).json();
  ok('password recovery: a reset email is requested, and the page does not reveal whether the address exists', /If there's an account with that email/.test(await body(ada)) && mail.some(x => x.to === 'ada@example.test' && x.kind === 'recover'));
  await ada.evaluate(() => { location.hash = ''; }); await hub(ada, 'account'); await ada.fill('#hub-body input[type=email]', 'ada@example.test'); await ada.fill('#hub-body input[type=password]', 'secret12'); await ada.click('#hub-body button[type=submit]'); await ada.waitForFunction(() => Account.signedIn); await ada.waitForTimeout(600);

  // ---------- Friends ----------
  await hub(bea, 'friends'); await bea.fill('#hub-body input[type=search]', 'ad'); await bea.waitForSelector('#hub-body .results li .name');
  ok('search: finds a player from the start of their username', (await bea.textContent('#hub-body .results .name')) === 'Ada');
  await bea.click('#hub-body .results >> text=Add friend'); await bea.waitForTimeout(700);
  ok('friend request: sent, and shown as waiting', /Waiting for an answer \| Ada/i.test(await body(bea)) && (await sql(`select status from public.friendships`))[0].status === 'pending');
  await ada.evaluate(() => Account.refresh()); await ada.waitForTimeout(300);
  ok('friend request: the other player sees a marker on the account button', await ada.evaluate(() => document.querySelector('#acct-btn').classList.contains('alert')));
  await hub(ada, 'friends'); ok('friend request: listed under "Requests for you"', /Requests for you \| Bea \| Accept \| Decline/i.test(await body(ada)), (await body(ada)).slice(0, 140));
  await ada.click('#hub-body >> text=Accept'); await ada.waitForTimeout(800);
  ok('friend request: accepting makes them friends, both ways', (await sql(`select status from public.friendships`))[0].status === 'accepted' && /Today/i.test(await body(ada)) && /Bea/.test(await body(ada)));

  // ---------- Spoilers: Bea has not dived today; Ada has ----------
  await hub(bea, 'friends'); const fr0 = await body(bea);
  ok('before diving: the friends page says a friend has finished, and nothing more', /Ada/.test(fr0) && /Finished today/.test(fr0) && /score hidden until you dive/.test(fr0) && !new RegExp(`${guestEnd.total} m`).test(fr0) && !/Explore|Compare/.test(fr0), fr0.slice(0, 200));
  await hub(bea, 'ranks'); const rk0 = await body(bea);
  ok('before diving: today\'s rankings are closed, with a plain reason', /Finish today's dive to see today's rankings/.test(rk0) && /1 player has finished so far/.test(rk0) && !/Ada/.test(rk0));
  const a1 = await direct(bea, '/rest/v1/rpc/get_dive', { p_username: 'Ada', p_day: 1 }), a2 = await direct(bea, '/rest/v1/rpc/leaderboard', { p_day: 1, p_scope: 'friends' }), a3 = await direct(bea, '/rest/v1/dive_guesses?select=*', null, 'GET'), a4 = await direct(bea, '/rest/v1/dives?select=*', null, 'GET'), a5 = await direct(bea, '/rest/v1/rpc/profile_of', { p_username: 'Ada' }), a6 = await direct(bea, '/rest/v1/rpc/friends', { p_day: 1 }), a7 = await direct(bea, '/rest/v1/rpc/round_counts', { p_day: 1, p_round: 1, p_player: 'made-up-device' });
  ok('direct requests with a real sign-in token: a friend\'s dive is refused ("locked")', a1.status === 400 && a1.body.message === 'locked', `${a1.status} ${JSON.stringify(a1.body).slice(0, 80)}`);
  ok('direct requests: the tables of dives and guesses cannot be read at all', a3.status >= 401 && a4.status >= 401 && /permission denied/.test(a3.body.message + a4.body.message), `${a3.status}, ${a4.status}`);
  ok('direct requests: ranking, profile, friends list and answer counts give away no answer and no score', a2.body.locked === true && !a2.body.rows && a6.body.friends[0].total === null && a7.body.locked === true && ![a2, a5, a6, a7].some(x => adaSaid.some(w => JSON.stringify(x.body).includes(`"${w}"`))));
  ok('direct requests: a dive cannot be handed in with a made-up score, or for another player', (await direct(bea, '/rest/v1/rpc/submit_dive', { p_day: 5, p_guesses: [] })).body.message === 'day_closed' && (await direct(bea, '/rest/v1/day_results', { day: 1, player: 'x'.repeat(8), total: 4000, depths: [4000] })).status === 201 && (await sql(`select count(*)::int n from public.dives where total > 3000`))[0].n === 0);
  const beaSaid = await (async () => { await bea.evaluate(() => { location.hash = ''; }); await bea.waitForTimeout(300); await reload(bea); return play(bea, 0.8); })();
  await bea.waitForFunction(() => /Ranked #/.test(document.querySelector('#e-social').innerText), null, { timeout: 9000 });
  const beaEnd = await bea.evaluate(() => ({ social: document.querySelector('#e-social').innerText.replace(/\n/g, ' | '), total: +document.querySelector('#e-total').textContent.replace(/,/g, '') }));
  const rows = await sql(`select p.username, d.total, d.max_depth, d.source from public.dives d join public.profiles p on p.id = d.user_id order by d.total desc, d.max_depth desc, d.completed_at`);
  ok('signed-in play: the dive is saved to the account as it ends, scored by the database', rows.length === 2 && rows.find(r => r.username === 'Bea').total === beaEnd.total && rows.find(r => r.username === 'Bea').source === 'play', JSON.stringify(rows));
  ok('end of day: place, how many friends have finished, and how many you beat', new RegExp(`Ranked #${rows.findIndex(r => r.username === 'Bea') + 1} of 2 players so far`).test(beaEnd.social) && /1 friend has finished today, and (you're ahead of them|they're ahead of you|you're level with them)\./.test(beaEnd.social) && /Rankings \| Friends \| Your log/.test(beaEnd.social), beaEnd.social);
  await hub(bea, 'friends'); const fr1 = await body(bea), diff = Math.abs(beaEnd.total - guestEnd.total);
  ok('after diving: the friend\'s score appears, with who is ahead and by how much', new RegExp(`${guestEnd.total.toLocaleString('en-US')} m`).test(fr1) && (diff === 0 ? /level with you/ : new RegExp(`${diff.toLocaleString('en-US')} m (ahead of|behind) you`)).test(fr1) && /Explore/.test(fr1) && /Compare/.test(fr1), fr1.slice(0, 220));
  await hub(bea, 'ranks'); const rk1 = await bea.evaluate(() => [...document.querySelectorAll('#hub-body .board li')].map(li => li.innerText.replace(/\n+/g, ' ')));
  ok('after diving: today\'s ranking opens, in the database\'s order, with my row marked', rk1.length === 2 && rk1[0].startsWith(`1 ${rows[0].username}`) && rk1[1].startsWith(`2 ${rows[1].username}`) && /you/i.test(rk1.find(x => /Bea/.test(x))) && /of 2 ranked players/.test(await body(bea)), rk1.join(' || '));
  await bea.click('#hub-body .seg >> text=Friends'); await bea.waitForTimeout(700);
  ok('friends ranking: the same day among friends only, and the rules for ties are stated', /among your friends/.test(await body(bea)) && /Equal totals are split by the deepest single answer, then by who finished first/.test(await body(bea)));
  ok('rankings layout: no overlap, clipping or sideways scroll', !(await audit(bea)).length, (await audit(bea)).join('; '));

  // ---------- Exploring a friend's iceberg ----------
  await hub(bea, 'friends'); await bea.click('#hub-body >> text=Explore'); await bea.waitForSelector('[data-screen="dive"]:not([hidden])'); await bea.waitForFunction(() => Viewer.state.items === 5, null, { timeout: 8000 }); await bea.waitForTimeout(700);
  const v0 = await bea.evaluate(() => ({ title: document.querySelector('#v-title').textContent, sub: document.querySelector('#v-sub').textContent, qs: [...document.querySelectorAll('#v-qs .v-q')].map(x => x.innerText.replace(/\n+/g, ' ')), marks: document.querySelectorAll('#ib2 .ib-mark:not(.dim)').length, labels: [...document.querySelectorAll('#ib2 .ib-pill:not(.dim)')].map(x => x.textContent), wide: Viewer.berg.wide, full: (() => { const r = document.querySelector('#ib2').getBoundingClientRect(); return r.width >= innerWidth - 1 && r.height >= innerHeight - 1; })(), life: Viewer.life.count }));
  ok('friend\'s iceberg: opens on the whole dive, clearly labelled as theirs, with total and deepest', v0.title === "Ada's dive" && new RegExp(`${guestEnd.total.toLocaleString('en-US')} m total · deepest \\d+ m`).test(v0.sub), `${v0.title} / ${v0.sub}`);
  ok('friend\'s iceberg: all five questions with the answer they gave and its depth', v0.qs.length === 5 && adaSaid.every((w, i) => v0.qs[i].toLowerCase().includes(w.toLowerCase()) && /\d+ m$/.test(v0.qs[i])), v0.qs.join(' || '));
  ok('friend\'s iceberg: the same full-screen scene, with five markers on the ice and wildlife in the water', v0.full && v0.marks === 5 && v0.labels.length >= 4 && v0.wide && v0.life > 10, `${v0.marks} markers, ${v0.labels.length} labels`);
  const stored = await sql(`select g.round, g.answer, g.depth, g.share from public.dive_guesses g join public.dives d on d.id = g.dive_id join public.profiles p on p.id = d.user_id where p.username = 'Ada' order by g.round`);
  await bea.click('#v-qs li:nth-child(3) .v-q'); await bea.waitForFunction(() => document.querySelector('#ib2 .ib-note.in'), null, { timeout: 8000 }); await bea.waitForTimeout(600);
  const v1 = await bea.evaluate(() => ({ note: document.querySelector('#ib2 .ib-note').innerText.replace(/\n+/g, ' | '), gauge: document.querySelector('#ib2 .ib-depth').textContent, depth: Viewer.berg.depth, slots: [...document.querySelectorAll('#v-slots .slot')].map(x => x.innerText.replace(/\n+/g, ' ')), settled: !Viewer.berg.wide }));
  ok('friend\'s iceberg: choosing a question travels to that answer at its real depth, with its original annotation', v1.settled && v1.depth === stored[2].depth && v1.gauge === stored[2].depth + ' m' && v1.note.toLowerCase().includes(adaSaid[2].toLowerCase()) && new RegExp(`${stored[2].depth} m below the surface`).test(v1.note) && /% of players/.test(v1.note) && /Ada · Question 3 · guess 1/.test(v1.note), v1.note);
  ok('friend\'s iceberg: that question\'s three guess slots are shown', v1.slots.length === 3 && /Not used/.test(v1.slots[1]), v1.slots.join(' || '));
  await bea.click('#v-replay'); await bea.waitForFunction(() => Viewer.state.replaying); await bea.waitForFunction(() => Viewer.state.q >= 3, null, { timeout: 20000 });
  ok('friend\'s iceberg: replay runs through the questions in order', await bea.evaluate(() => Viewer.state.replaying && document.querySelector('#v-replay').textContent === 'Stop'));
  await bea.click('#v-replay'); await bea.waitForTimeout(500);
  ok('friend\'s iceberg: replay can be stopped at any time', await bea.evaluate(() => !Viewer.state.replaying));
  const beforeRows = JSON.stringify(await sql(`select * from public.dives order by id`)) + JSON.stringify(await sql(`select * from public.dive_guesses order by dive_id, round, slot`));
  await bea.click('#v-all'); await bea.waitForTimeout(900);
  // ---------- Comparing two dives ----------
  await bea.click('#v-vs'); await bea.waitForFunction(() => Viewer.state.compare && Viewer.state.items === 10, null, { timeout: 8000 }); await bea.waitForTimeout(800);
  const c0 = await bea.evaluate(() => ({ title: document.querySelector('#v-title').textContent, sub: document.querySelector('#v-sub').textContent, mine: document.querySelectorAll('#ib2 .ib-mark:not(.them)').length, theirs: document.querySelectorAll('#ib2 .ib-mark.them').length, rows: [...document.querySelectorAll('#v-qs .v-q')].map(x => x.innerText.replace(/\n+/g, ' ')), styles: [getComputedStyle(document.querySelector('#ib2 .ib-mark.them'), '::before').backgroundColor, getComputedStyle(document.querySelector('#ib2 .ib-mark:not(.them)'), '::before').backgroundColor] }));
  ok('compare: both dives on one iceberg, five markers each, in two distinct styles (mine solid, theirs hollow)', c0.title === 'You and Ada' && c0.mine === 5 && c0.theirs === 5 && c0.styles[0] !== c0.styles[1], JSON.stringify(c0.styles));
  ok('compare: says who is ahead overall and by how much, and whose single answer went deepest', (diff === 0 ? /level/ : new RegExp(`${diff.toLocaleString('en-US')} m ahead`)).test(c0.sub) && /Deepest answer:/.test(c0.sub), c0.sub);
  ok('compare: each question shows both answers and both depths', c0.rows.length === 5 && c0.rows.every((r, i) => r.toLowerCase().includes(adaSaid[i].toLowerCase()) && r.toLowerCase().includes(beaSaid[i].toLowerCase()) && /\d+ m Ada \d+ m$/.test(r)), c0.rows[0]);
  await bea.click('#v-qs li:nth-child(2) .v-q'); await bea.waitForFunction(() => document.querySelector('#ib2 .ib-note.in'), null, { timeout: 8000 }); await bea.waitForTimeout(500);
  const c1 = await bea.evaluate(() => ({ marks: document.querySelectorAll('#ib2 .ib-mark').length, note: document.querySelector('#ib2 .ib-note').innerText.replace(/\n+/g, ' | ') }));
  ok('compare: choosing a question focuses on the two answers for it', c1.marks === 2 && /(You|Ada) · Question 2/.test(c1.note), c1.note);
  await bea.screenshot({ path: 'tests/shot-social-compare.png' });
  ok('exploring and comparing change nothing in the database', beforeRows === JSON.stringify(await sql(`select * from public.dives order by id`)) + JSON.stringify(await sql(`select * from public.dive_guesses order by dive_id, round, slot`)));
  await bea.click('#v-close'); await bea.waitForSelector('[data-screen="hub"]:not([hidden])');
  ok('closing a dive returns to the page it was opened from', await bea.evaluate(() => location.hash === '#friends'));

  // ---------- Privacy ----------
  await hub(ada, 'settings'); await ada.click('#hub-body .toggle-row:has-text("explore my finished icebergs") input'); await ada.waitForTimeout(600);
  await bea.evaluate(() => Hub.open('dive', 'Ada', 1)); await bea.waitForFunction(() => /private/.test(document.querySelector('#v-msg').textContent), null, { timeout: 8000 });
  ok('privacy: with exploring switched off, a friend is told the dives are private, and sees nothing', /keeps their dives private/.test(await bea.textContent('#v-msg')) && await bea.evaluate(() => document.querySelectorAll('#ib2 .ib-mark').length === 0));
  await ada.click('#hub-body .toggle-row:has-text("explore my finished icebergs") input'); await ada.click('#hub-body .toggle-row:has-text("including the answers") input'); await ada.waitForTimeout(600);
  await bea.evaluate(() => { location.hash = '#friends'; }); await bea.waitForTimeout(400); await bea.evaluate(() => Hub.open('dive', 'Ada', 1)); await bea.waitForFunction(() => Viewer.state.items === 5, null, { timeout: 8000 }); await bea.waitForTimeout(400);
  const hid = await bea.evaluate(() => document.querySelector('.dive .dock').innerText + document.querySelector('#ib2').innerText);
  ok('privacy: with answers hidden, the depths are shown but not one of the words', /answers hidden by Ada/.test(hid) && /Hidden answer/.test(hid) && !adaSaid.some(w => hid.toLowerCase().includes(w.toLowerCase())));
  await ada.click('#hub-body .toggle-row:has-text("including the answers") input'); await ada.waitForTimeout(400);
  await bea.evaluate(() => Hub.open('u', 'Ada')); await bea.waitForSelector('[data-screen="hub"]:not([hidden])'); await bea.waitForFunction(() => /Ada/.test(document.querySelector('#hub-body').innerText) && !document.querySelector('#hub-body .wait')); await bea.waitForTimeout(300);
  const prof = await body(bea);
  ok('a friend\'s profile: their log, calendar and today\'s dive to explore or compare', /Dive log \| Ada/i.test(prof) && /Friends \| Remove friend/i.test(prof) && /Calendar/i.test(prof) && /Explore today's dive \| Compare with mine/.test(prof) && !/@/.test(prof), prof.slice(0, 200));

  // ---------- Days pass: streaks and the calendar ----------
  await setDay(2); await reload(ada); await ada.evaluate(() => { location.hash = ''; }); await ada.waitForTimeout(300);
  ok('a new day: the home screen offers a fresh iceberg', (await ada.textContent('#play')) === "Play today's iceberg" && await ada.evaluate(() => Game.today() === 2));
  await play(ada, 0.5); await ada.waitForFunction(() => /Ranked #/.test(document.querySelector('#e-social').innerText), null, { timeout: 9000 }); await ada.waitForTimeout(400);
  const e2 = await ada.evaluate(() => ({ streak: document.querySelector('#e-streak').textContent, on: document.querySelectorAll('#e-days i.on').length, pop: !!document.querySelector('#e-days i.today.pop'), server: Account.profile.stats.streak }));
  ok('streak: a second day in a row makes it 2, with a small celebration on the day\'s marker', e2.streak === '2-day streak' && e2.server === 2 && e2.on >= 2 && e2.pop, JSON.stringify(e2));
  await reload(ada); await ada.evaluate(() => Game.handIn(2)); await ada.waitForTimeout(600);
  ok('streak: reloading and handing the same day in again adds nothing', (await sql(`select current_streak, total_dives from public.player_stats s join public.profiles p on p.id = s.user_id where p.username = 'Ada'`))[0].current_streak === 2 && (await sql(`select count(*)::int n from public.dives d join public.profiles p on p.id = d.user_id where p.username = 'Ada'`))[0].n === 2);
  await hub(ada, 'log'); const cal2 = await ada.evaluate(() => ({ done: [...document.querySelectorAll('.cal button')].filter(x => /\bl[1-4]\b/.test(x.className)).map(x => +x.dataset.day), months: [...document.querySelectorAll('.cal .m')].filter(x => x.textContent).length, cells: document.querySelectorAll('.cal button').length, today: document.querySelector('.cal button.today') && +document.querySelector('.cal button.today').dataset.day, key: document.querySelector('.cal-key').innerText.replace(/\n+/g, ' '), detail: document.querySelector('.cal-day').innerText.replace(/\n+/g, ' ') }));
  ok('calendar: a year of days by week with month labels; exactly the days played are filled', cal2.cells === 371 && cal2.months >= 11 && cal2.done.join() === '1,2' && cal2.today === 2, `${cal2.cells} squares, ${cal2.months} month labels, filled: ${cal2.done}`);
  ok('calendar: the colour scale is labelled, and the chosen day shows date, score, depth, deepest answer and place', /no dive.*a finished dive.*200 m.*500 m.*800 m or more.*an answer in the Abyss/.test(cal2.key) && /Daily #2 · [\d,]+ m total · deepest \d+ m \(.+\) · placed #1 of 1/.test(cal2.detail) && /Open this dive/.test(cal2.detail), cal2.detail);
  await ada.click('.cal button[data-day="1"]'); await ada.waitForTimeout(200); await ada.click('.cal-day >> text=Open this dive'); await ada.waitForFunction(() => Viewer.state.items === 5, null, { timeout: 8000 }); await ada.waitForTimeout(500);
  const old = await ada.evaluate(() => ({ title: document.querySelector('#v-title').textContent, day: document.querySelector('#v-day').textContent, qs: [...document.querySelectorAll('#v-qs .v-q')].map(x => x.innerText.replace(/\n+/g, ' ')) }));
  ok('history: yesterday\'s iceberg can be reopened, with the same answers at the same depths', old.title === 'Your dive' && /Daily #1/.test(old.day) && adaSaid.every((w, i) => old.qs[i].toLowerCase().includes(w.toLowerCase()) && old.qs[i].endsWith(stored[i].depth + ' m')), old.qs.join(' || '));
  await ada.click('#v-close'); await ada.waitForTimeout(300);
  await setDay(4); await reload(ada); await ada.evaluate(() => Account.refresh()); await ada.waitForTimeout(400);
  ok('streak: after a missed day it is gone from the home screen, and the profile keeps the longest', (await ada.textContent('#home-streak')) === '' && await ada.evaluate(() => Game.streak().count === 0 && Account.profile.stats.longest === 2));
  await ada.evaluate(() => { location.hash = ''; }); await play(ada, 0.4); await ada.waitForFunction(() => /Ranked #/.test(document.querySelector('#e-social').innerText), null, { timeout: 9000 }); await ada.waitForTimeout(300);
  ok('streak: playing again starts from 1, with no celebration', await ada.evaluate(() => document.querySelector('#e-streak').textContent === '1-day streak' && !document.querySelector('#e-days .pop') && Account.profile.stats.longest === 2));

  // ---------- A second device ----------
  const dev2 = await fresh('phone'); await hub(dev2, 'account'); await dev2.fill('#hub-body input[type=email]', 'ada@example.test'); await dev2.fill('#hub-body input[type=password]', 'secret12'); await dev2.click('#hub-body button[type=submit]'); await dev2.waitForFunction(() => Account.signedIn); await dev2.waitForTimeout(1500);
  await dev2.evaluate(() => { location.hash = ''; }); await dev2.waitForTimeout(500);
  ok('second device: signing in brings today\'s finished dive with it, so it cannot be played twice', (await dev2.textContent('#play')) === "See today's results" && (await dev2.textContent('#home-streak')) === '1-day streak');
  await hub(dev2, 'log'); const d2 = await dev2.evaluate(() => ({ done: [...document.querySelectorAll('.cal button')].filter(x => /\bl[1-4]\b/.test(x.className)).map(x => +x.dataset.day).join(), text: document.querySelector('#hub-body').innerText }));
  ok('second device: the whole history is there (three dives, days 1, 2 and 4)', d2.done === '1,2,4' && /Total expeditions\s+3/i.test(d2.text) && /Longest streak\s+2 days/i.test(d2.text), d2.done);
  ok('profile layout (phone): no overlap, clipping or sideways scroll; the calendar scrolls inside its own strip', !(await audit(dev2)).length && await dev2.evaluate(() => document.querySelector('.cal-wrap').scrollWidth > document.querySelector('.cal-wrap').clientWidth && document.documentElement.scrollWidth <= innerWidth), (await audit(dev2)).join('; '));
  await dev2.screenshot({ path: 'tests/shot-social-log-phone.png', fullPage: true });
  await dev2.evaluate(() => Hub.open('dive', 'me', 1)); await dev2.waitForFunction(() => Viewer.state.items === 5, null, { timeout: 8000 }); await dev2.waitForTimeout(600);
  const pv = await dev2.evaluate(() => ({ qs: document.querySelectorAll('#v-qs .v-q').length, marks: document.querySelectorAll('#ib2 .ib-mark:not(.dim)').length, over: document.documentElement.scrollWidth - innerWidth }));
  await dev2.click('#v-qs li:nth-child(1) .v-q'); await dev2.waitForFunction(() => document.querySelector('#ib2 .ib-note.in'), null, { timeout: 8000 }); await dev2.waitForTimeout(700);
  const pn = await dev2.evaluate(() => { const n = document.querySelector('#ib2 .ib-note').getBoundingClientRect(), hit = s => { const q = document.querySelector(s).getBoundingClientRect(); return n.left < q.right && q.left < n.right && n.top < q.bottom && q.top < n.bottom; }; return { inside: n.left >= 0 && n.right <= innerWidth && n.bottom <= innerHeight, over: hit('.dive .q') || hit('#v-panel') }; });
  ok('viewer on a phone: a dive fetched from the database (never played on this device) rebuilds; annotation clear of the controls', pv.qs === 5 && pv.marks === 5 && pv.over <= 0 && pn.inside && !pn.over && !(await audit(dev2, '.dive .dock, header')).length, JSON.stringify(pn) + (await audit(dev2, '.dive .dock, header')).join('; '));
  await dev2.screenshot({ path: 'tests/shot-social-viewer-phone.png' });
  await dev2.context().close();

  // ---------- Blocking and removing ----------
  await setDay(1 + 3); await hub(bea, 'friends');
  await bea.evaluate(() => Hub.open('u', 'Ada')); await bea.waitForFunction(() => /Remove friend/.test(document.querySelector('#hub-body').innerText)); bea.once('dialog', d => d.accept()); await bea.click('#hub-body >> text=Block'); await bea.waitForFunction(() => location.hash === '#friends'); await bea.waitForTimeout(600);
  ok('blocking: ends the friendship and lists the player as blocked', (await sql(`select count(*)::int n from public.friendships`))[0].n === 0 && /Blocked \(1\)/i.test(await body(bea)));
  await hub(ada, 'friends'); await ada.fill('#hub-body input[type=search]', 'bea'); await ada.waitForTimeout(900);
  ok('blocking: the blocked player can no longer find the blocker, or open their profile', /No player's name starts with/.test(await body(ada)) && (await direct(ada, '/rest/v1/rpc/profile_of', { p_username: 'Bea' })).body.message === 'not_found');
  await bea.click('#hub-body summary'); await bea.click('#hub-body >> text=Unblock'); await bea.waitForTimeout(600);
  await ada.fill('#hub-body input[type=search]', ''); await ada.fill('#hub-body input[type=search]', 'bea'); await ada.waitForSelector('#hub-body .results >> text=Add friend'); await ada.click('#hub-body .results >> text=Add friend'); await ada.waitForTimeout(500);
  await hub(bea, 'friends'); await bea.click('#hub-body >> text=Decline'); await bea.waitForTimeout(600);
  ok('declining a request leaves no trace', (await sql(`select count(*)::int n from public.friendships`))[0].n === 0);
  await ada.reload(); await ada.waitForSelector('#hub-body'); await hub(ada, 'friends'); await ada.fill('#hub-body input[type=search]', 'bea'); await ada.waitForSelector('#hub-body .results >> text=Add friend'); await ada.click('#hub-body .results >> text=Add friend'); await ada.waitForTimeout(500);
  await hub(ada, 'friends'); await ada.click('#hub-body >> text=Cancel'); await ada.waitForTimeout(600);
  ok('a sent request can be cancelled', (await sql(`select count(*)::int n from public.friendships`))[0].n === 0);
  ok('friends layout: no overlap, clipping or sideways scroll', !(await audit(ada)).length, (await audit(ada)).join('; '));

  // ---------- Google, settings, deleting ----------
  const goo = await fresh(); await hub(goo, 'account'); await goo.click('#hub-body >> text=Continue with Google'); await goo.waitForFunction(() => window.Account && Account.state === 'new', null, { timeout: 10000 }); await goo.waitForTimeout(500);
  await goo.evaluate(() => Hub.open('account')); await goo.waitForSelector('#hub-body input[autocomplete=username]');
  ok('Google sign-in (imitated): comes back signed in and is asked for a username before anything else', /Choose a username/.test(await body(goo)) && await goo.evaluate(() => !location.hash.includes('access_token')));
  await goo.fill('#hub-body input[autocomplete=username]', 'Gia'); await goo.waitForTimeout(500); await goo.click('#hub-body .avatars button:nth-child(3)'); await goo.click('#hub-body button[type=submit]'); await goo.waitForFunction(() => Account.signedIn); await goo.waitForTimeout(500);
  ok('choosing a picture: one of the game\'s own animals', (await sql(`select avatar from public.profiles where username = 'Gia'`))[0].avatar === 'angler');
  await hub(goo, 'settings'); await goo.fill('#hub-body input[autocomplete=username]', 'Gia_2'); await goo.waitForTimeout(500); await goo.click('#hub-body .form >> text=Save'); await goo.waitForFunction(() => Account.profile.username === 'Gia_2', null, { timeout: 6000 }); await goo.waitForTimeout(400);
  await goo.fill('#hub-body input[autocomplete=username]', 'Gia_3'); await goo.waitForTimeout(500); await goo.click('#hub-body .form >> text=Save'); await goo.waitForTimeout(700);
  ok('settings: a username can be changed, but not twice in a row', (await sql(`select username from public.profiles where avatar = 'angler'`))[0].username === 'Gia_2' && /changed your username recently/.test(await body(goo)));
  ok('settings layout: no overlap, clipping or sideways scroll', !(await audit(goo)).length, (await audit(goo)).join('; '));
  await goo.click('#hub-body .toggle-row:has-text("global ranking") input'); await goo.waitForTimeout(500);
  ok('settings: privacy choices are saved to the account', (await sql(`select ranked from public.profiles where username = 'Gia_2'`))[0].ranked === false);
  await goo.click('#hub-body .danger summary'); await goo.click('#hub-body .danger >> text=Delete for good'); await goo.waitForTimeout(400);
  ok('delete account: nothing happens until the username is typed to confirm', (await sql(`select count(*)::int n from public.profiles where username = 'Gia_2'`))[0].n === 1);
  await goo.fill('#hub-body .danger input', 'gia_2'); await goo.click('#hub-body .danger >> text=Delete for good'); await goo.waitForFunction(() => Account.state === 'out', null, { timeout: 8000 });
  ok('delete account: the player is removed from the database and signed out here', (await sql(`select (select count(*) from public.profiles where username = 'Gia_2')::int + (select count(*) from auth.users where email = 'google.user@example.test')::int as n`))[0].n === 0);
  await goo.context().close();

  // ---------- Email confirmation switched on ----------
  const con = await fresh(); await hub(con, 'account'); await con.click('#hub-body >> text=Create an account'); await con.fill('#hub-body input[type=email]', 'new@confirm.test'); await con.fill('#hub-body input[type=password]', 'secret12'); await con.click('#hub-body button[type=submit]'); await con.waitForTimeout(700);
  ok('if the project asks new players to confirm their email, the page says to check it (and does not sign in)', /Check your email/.test(await body(con)) && await con.evaluate(() => Account.state === 'out'));
  await con.context().close();

  // ---------- Demonstration data (no database): invented players, labelled on every screen ----------
  { const ctx = await b.newContext({ viewport: VPS.desk }), p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
    await p.goto(SITE + '?test&fast&reset&demo'); await p.waitForSelector('#play'); await p.waitForFunction(() => Account.signedIn && Account.demo);
    const seen = [];
    for (const tab of ['friends', 'ranks', 'log', 'settings']) { await hub(p, tab); seen.push(await p.evaluate(() => !document.querySelector('#hub-demo').hidden && /Demonstration data/i.test(document.querySelector('#hub-demo').innerText) && /made up/.test(document.querySelector('#hub-demo').innerText))); }
    await hub(p, 'friends'); const names = await p.evaluate(() => [...document.querySelectorAll('#hub-body .rows .name')].map(x => x.textContent));
    ok('demonstration: every social screen carries a "Demonstration data, made up" label, and every invented player is named demo_…', seen.every(Boolean) && names.length >= 4 && names.every(n => /^demo_/.test(n)), names.join(','));
    await hub(p, 'ranks'); ok('demonstration: follows the same rule, rankings closed until you have dived', /Finish today's dive to see today's rankings/.test(await body(p)));
    await ctx.close();
    const ctx2 = await b.newContext({ viewport: VPS.desk }), q = await ctx2.newPage(); await q.goto(SITE + '?test&fast&reset'); await q.waitForSelector('#play'); await q.click('#acct-btn'); await q.waitForSelector('[data-screen="hub"]:not([hidden])');
    ok('demonstration: not offered on an ordinary copy of the game', !/demonstration/i.test(await q.evaluate(() => document.querySelector('[data-screen="hub"]').innerText)) && await q.evaluate(() => !Game.demo.offered));
    await ctx2.close(); }

  // ---------- Best of three, everywhere ----------
  // Day 16 uses question set 1. Each question tests one case:
  //   1 the rarest answer first · 2 two answers equally rare (the first one counts) · 3 rarest second · 4 rarest third
  //   5 an answer that doesn't count (free), an unknown one (uses a guess, no depth), then a valid one.
  await setDay(16);
  { const p = await fresh(); await signUp(p, 'scorer@example.test', 'Scorer'); await p.evaluate(() => { location.hash = ''; }); await p.waitForTimeout(400);
    const set = await p.evaluate(() => ICEBERG_TEST.cats.map(c => c.answers.filter(a => !a.x && !a.h).map(a => ({ a: a.a, name: a.d || a.a, s: a.s })).sort((x, y) => y.s - x.s)));
    const D = s => s >= 0.1 ? 0 : Math.max(1, Math.round(100 * Math.log10(0.1 / s)));
    const at = (q, f) => set[q][Math.min(set[q].length - 1, Math.floor(set[q].length * f))];
    const tie = (() => { const by = {}; for (const x of set[1]) (by[x.s] = by[x.s] || []).push(x); return Object.values(by).find(v => v.length > 1 && D(v[0].s) > 20); })();
    const plan = [
      [at(0, 0.8), at(0, 0.05), at(0, 0.4)],
      [tie[0], tie[1], at(1, 0.05)],
      [at(2, 0.05), at(2, 0.85), at(2, 0.4)],
      [at(3, 0.05), at(3, 0.4), at(3, 0.85)],
      [{ name: 'zzzzzz', bad: 'invalid' }, { name: 'quorblaxen', bad: 'pending' }, at(4, 0.3), at(4, 0.6)],
    ];
    const expectSlot = [0, 0, 1, 2, 2], expectPick = [0, 0, 1, 2, 3], expect = plan.map((g, i) => g[expectPick[i]]), expectDepth = expect.map(x => D(x.s)), total = expectDepth.reduce((a, b) => a + b, 0);
    await p.click('#play'); await p.waitForSelector('[data-screen="play"]:not([hidden])');
    const inGame = [];
    for (let q = 0; q < 5; q++) {
      for (const g of plan[q]) {
        await p.fill('#answer', g.name); await p.keyboard.press('Enter'); await p.waitForTimeout(120);
        if (g.bad === 'pending') { await p.keyboard.press('Enter'); await p.waitForTimeout(150); }
        await p.waitForFunction(() => !ICEBERG_TEST.busy, null, { timeout: 15000 }); await p.waitForTimeout(150);
      }
      await p.waitForFunction(() => ICEBERG_TEST.state.phase === 'done', null, { timeout: 15000 }); await p.waitForTimeout(300);
      inGame.push(await p.evaluate(() => ({ best: document.querySelector('#best-name').textContent, depth: document.querySelector('#best-depth').textContent, sumBest: document.querySelector('#sum li.best .sum-name') && document.querySelector('#sum li.best .sum-name').textContent, sumIdx: [...document.querySelectorAll('#sum li')].findIndex(li => li.classList.contains('best')), statuses: ICEBERG_TEST.state.rounds[ICEBERG_TEST.state.round].guesses.map(g => g.status).join(',') })));
      await p.click('#next'); await p.waitForTimeout(250);
    }
    ok('best of three, while playing: the rarest answer is the one marked and scored, whether it came first, second or third; on a tie the first one', inGame.every((x, i) => x.best === expect[i].name && x.depth === expectDepth[i] + 'm' && x.sumIdx === expectSlot[i]), inGame.map(x => `${x.best} ${x.depth} #${x.sumIdx + 1}`).join(' | '));
    ok('best of three: an answer that doesn\'t count is free; an unknown one uses a guess but has no depth', inGame[4].statuses === 'pending,ok,ok', inGame[4].statuses);
    await p.waitForSelector('[data-screen="end"]:not([hidden])'); await p.waitForFunction(() => /Ranked #/.test(document.querySelector('#e-social').innerText), null, { timeout: 9000 });
    const end = await p.evaluate(() => ({ total: +document.querySelector('#e-total').textContent.replace(/,/g, ''), rows: [...document.querySelectorAll('#e-rounds li')].map(li => li.innerText.replace(/\n+/g, ' ')), share: document.querySelector('#e-card').textContent }));
    ok('best of three, final results: the total is the five best depths added up, not every guess', end.total === total && end.rows.every((r, i) => r.includes(expect[i].name) && r.replace(/\s+/g, '').endsWith(expectDepth[i] + 'm')), `${end.total} vs ${total}; ${end.rows.join(' | ')}`);
    ok('best of three, shared result: the same five depths and total', end.share.includes(`· ${total.toLocaleString('en-US')} m`) && expectDepth.every((d, i) => end.share.split('\n')[i + 1].endsWith(`${d} m`)), end.share.split('\n').slice(0, 6).join(' / '));
    const dive = await sql(`select d.total, array(select g.slot from public.dive_guesses g where g.dive_id = d.id and g.is_best order by g.round) best_slots, d.depths from public.dives d join public.profiles p on p.id = d.user_id where p.username = 'Scorer'`);
    ok('best of three, on the server: the database marks the same answers and reaches the same total', dive[0].total === total && dive[0].best_slots.join() === expectSlot.map(x => x + 1).join() && dive[0].depths.join() === expectDepth.join(), JSON.stringify(dive[0]));
    await hub(p, 'ranks'); const row = await p.evaluate(() => { const li = [...document.querySelectorAll('#hub-body .board li')].find(x => /Scorer/.test(x.innerText)); return li && li.innerText.replace(/\n+/g, ' '); });
    ok('best of three, rankings: listed with the same total', !!row && row.includes(`${total.toLocaleString('en-US')} m`), row);
    await hub(p, 'log'); const cal = await p.evaluate(() => document.querySelector('.cal-day').innerText);
    ok('best of three, calendar: today shows the same total', cal.includes(`${total.toLocaleString('en-US')} m`), cal.replace(/\n+/g, ' '));
    await p.evaluate(() => Hub.open('dive', 'me', 16)); await p.waitForFunction(() => Viewer.state.items === 5, null, { timeout: 9000 }); await p.waitForTimeout(400);
    const v = await p.evaluate(() => [...document.querySelectorAll('#v-qs .v-q')].map(x => x.innerText.replace(/\n+/g, ' ')));
    ok('best of three, the explored iceberg: each question shows the answer that counted', v.every((r, i) => r.includes(expect[i].name) && r.endsWith(expectDepth[i] + ' m')), v.join(' | '));
    await p.click('#v-qs li:nth-child(4) .v-q'); await p.waitForFunction(() => document.querySelectorAll('#ib2 .ib-mark:not(.dim)').length === 3, null, { timeout: 9000 }); await p.waitForTimeout(600);
    const all3 = await p.evaluate(() => ({ marks: document.querySelectorAll('#ib2 .ib-mark:not(.dim)').length, best: document.querySelectorAll('#ib2 .ib-mark.best').length, slots: [...document.querySelectorAll('#v-slots .slot')].map(x => x.className) }));
    ok('best of three: all three guesses stay on the iceberg, with only the deepest marked', all3.marks === 3 && all3.best === 1 && all3.slots.filter(c => /best/.test(c)).length === 1 && /best/.test(all3.slots[2]), JSON.stringify(all3));
    await p.context().close(); }

  ok('no errors in any browser page during the whole run', !errs.length, errs.slice(0, 3).join(' || '));
  console.log(R.join('\n')); console.log(`\n${R.length - fails} passed, ${fails} failed`);
  await b.close(); site.close(); gw.server.close(); await gw.pool.end(); process.exit(fails ? 1 : 0);
})().catch(async e => { console.log(R.join('\n')); console.error('\nSTOPPED:', (e.message || '').split('\n').slice(0, 6).join('\n')); process.exit(1); });
