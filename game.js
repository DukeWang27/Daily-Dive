// Iceberg: three guesses per question. How deep can you go?
// Five questions a day. Each guess is revealed on the iceberg at once: the fewer players who share it, the deeper
// it sits. Only the deepest answer of each question counts, and depth in metres is the score.
// Other pieces: validate.js (answer checking), audio.js (sound), sea.js (background), iceberg.js (artwork, depth scale,
// the explorable iceberg), share.js (share card), icons.js (category icons), categories.json (today's questions).

// ---------- Settings ----------
// Everything works with these left empty: everyone is then a guest, statistics are sample estimates and unknown
// answers stay "pending".
//   url + anonKey: a Supabase project (see BACKEND.md) for accounts, friends, rankings and real player counts.
//                  The anon key is the project's PUBLIC key. Never put the service-role key or any secret here.
//   providers: other ways to sign in besides email and password, e.g. ["google"]. None at launch: players sign up
//              with any email address (Gmail included). See BACKEND.md, "Google sign-in (postponed)".
//   verifyUrl: an endpoint that reviews unknown answers (see api/verify.js).
const BACKEND = { url: "https://lrubyctrjrkzbbshlois.supabase.co", anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxydWJ5Y3RyanJremJic2hsb2lzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTU1NDAzODMsImV4cCI6MjExMTExNjM4M30.fHMwQT9ioTTmlrrC9PZku2brxuqffvGQ8kv7JohTinY", providers: [], verifyUrl: "" };
const LAUNCH = [2026, 11, 24];     // Daily #1: year, month, day. Days change at each player's local midnight.
const GUESSES = 3;                // per question
const QUESTION_SECONDS = 20;        // thinking time per question, shared by its three guesses. It stops while an answer is revealed. 0 = no timer
const FREE_MISSES = 3;            // answers that don't count are free up to this many per question; after that each uses a guess
const IMAGINARY_PLAYERS = 200;    // early-estimate weight blended with real counts
const BOARD_MIN_PLAYERS = 30;       // real counts replace the sample board once this many players have answered a question
const BOARD_MIN_COUNT = 5;        // a rare answer needs this many real players before it's listed (no one-off junk)
const RANK_MIN_PLAYERS = 30;      // a ranking is only shown once this many real players have finished the day
const REVIEWED_SHARE = 0.03;      // approved by review but not yet counted: sits in Midwater (52 m), never the maximum
const PARAMS = new URLSearchParams(location.search);
// Playtest (a private build for trying every day; tools/playtest): no database, no accounts, any day, replay at will.
const PLAYTEST = !!window.PLAYTEST || PARAMS.has("playtest");
if (PLAYTEST) { BACKEND.url = ""; BACKEND.anonKey = ""; BACKEND.verifyUrl = ""; }
const SPEED = PARAMS.has("fast") ? 4 : 1;
// The automated tests run untimed unless they ask for a clock (?test&time=20).
// The playtest can try other clocks (20, 30 or 45 seconds), chosen in its bar; the live game always uses QUESTION_SECONDS.
// "off": untimed practice.
const PT_SECONDS = PLAYTEST ? (() => { try { const v = localStorage.getItem("iceberg-pt:seconds"); return v === "off" ? -1 : [20, 30, 45].includes(+v) ? +v : 0; } catch { return 0; } })() : 0;
const TIME_MS = 1000 * (PARAMS.has("test") ? Math.max(0, +PARAMS.get("time") || 0) : PT_SECONDS < 0 ? 0 : PT_SECONDS || QUESTION_SECONDS);
if (PARAMS.get("verify")) BACKEND.verifyUrl = PARAMS.get("verify"); // for testing a review endpoint without editing this file
// Automated tests never touch the live database: with ?test the game uses only the stand-in it is given (or none).
if (PARAMS.has("test")) { BACKEND.url = PARAMS.get("api") || ""; BACKEND.anonKey = PARAMS.get("api") ? PARAMS.get("key") || "" : ""; BACKEND.providers = PARAMS.get("providers") ? PARAMS.get("providers").split(",") : []; }
if (PARAMS.has("test") && /^\d{4}-\d\d-\d\d$/.test(PARAMS.get("launch") || "")) { const d = PARAMS.get("launch").split("-").map(Number); LAUNCH[0] = d[0]; LAUNCH[1] = d[1]; LAUNCH[2] = d[2]; }
const { depthOf, tierOfDepth } = window.Iceberg;
const Brand = window.Brand || { name: "Iceberg", noun: "iceberg", slug: "iceberg" }; // brand.js: the game's name, in one place
const Account = window.Account;   // account.js: sign-in and the database (everyone is a guest without it)
const V = window.IcebergValidate, Sound = window.Sound, Sea = window.Sea || { mood() {} }, Icons = window.IcebergIcons, Share = window.IcebergShare, Wildlife = window.Wildlife;
let SAMPLE_PLAYERS = 50000;       // only used to rank estimated answers on the board; never shown as a number of people

// ---------- Small helpers ----------
const $ = sel => document.querySelector(sel);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const STORE_PREFIX = PLAYTEST ? "iceberg-pt:" : "iceberg:";
const store = {
  get(k, d) { try { const v = localStorage.getItem(STORE_PREFIX + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(STORE_PREFIX + k, JSON.stringify(v)); } catch { /* private mode: fine */ } },
  del(k) { try { localStorage.removeItem(STORE_PREFIX + k); } catch { /* fine */ } },
};
const localMidnight = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };
if (PLAYTEST && +PARAMS.get("day") > 0) store.set("pt-day", +PARAMS.get("day"));
const PT_DAY = PLAYTEST ? store.get("pt-day", 1) : 0;
const dayNumber = () => PT_DAY || Math.max(1, Math.round((localMidnight() - new Date(LAUNCH[0], LAUNCH[1] - 1, LAUNCH[2])) / 86400000) + 1);
// Today's finished result, if there is one. Results saved by the earlier timed version of the game are ignored.
const todayResult = () => { const d = store.get("day:" + dayNumber(), null); return d && d.v === 3 ? d : null; };
const playerId = (() => { let id = store.get("pid", null); if (!id) { id = Math.random().toString(36).slice(2) + Date.now().toString(36); store.set("pid", id); } return id; })();
const fmt = n => n.toLocaleString("en-US");
const pctText = s => s >= 0.1 ? `${Math.round(s * 100)}%` : s >= 0.01 ? `${(s * 100).toFixed(1)}%` : s >= 0.001 ? `${(s * 100).toFixed(2)}%` : `${(s * 100).toFixed(3)}%`;
// An estimate is shown as one: rounded, with "~" or "under", never to three decimal places it can't support.
const estText = s => s >= 0.1 ? `~${Math.round(s * 20) * 5}%` : s >= 0.01 ? `~${Math.round(s * 100)}%` : s >= 0.001 ? `~${+(s * 100).toFixed(1)}%` : s >= 0.0001 ? "under 0.1%" : "under 0.01%";
const display = row => row.d || row.a;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "es"}`;
const ICON = {
  wait: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4.4 4.3a1.7 1.7 0 1 1 2.5 1.5c-.6.3-.9.7-.9 1.3M6 9.3v.1" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  no: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="m3.5 3.5 5 5m0-5-5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
};

// ---------- Live data (optional) ----------
const live = {
  on: () => !!(BACKEND.url && BACKEND.anonKey),
  headers: () => ({ apikey: BACKEND.anonKey, Authorization: `Bearer ${BACKEND.anonKey}`, "Content-Type": "application/json" }),
  post(table, body) { return fetch(`${BACKEND.url}/rest/v1/${table}`, { method: "POST", headers: { ...live.headers(), Prefer: "return=minimal" }, body: JSON.stringify(body) }); },
  // One row per player per question: up to three answers and which was deepest.
  async record(day, round, answers, best, depth) {
    if (!live.on()) return;
    try { await live.post("round_plays", { day, round, player: playerId, answers, best, depth }); } catch { /* offline: sample stats still work */ }
  },
  async recordDay(day, total, depths) {
    if (!live.on()) return;
    try { await live.post("day_results", { day, player: playerId, total, depths }); } catch { /* ignore */ }
  },
  // How many players gave each answer today. The database only releases this for a question this device has
  // already finished, so it is asked for afterwards, never before.
  async counts(day, round) {
    if (!live.on()) return null;
    try {
      const res = await fetch(`${BACKEND.url}/rest/v1/rpc/round_counts`, { method: "POST", headers: live.headers(), body: JSON.stringify({ p_day: day, p_round: round, p_player: playerId }) }).then(r => r.json());
      return res && !res.locked ? { players: res.players || 0, counts: new Map(Object.entries(res.counts || {})) } : null;
    } catch { return null; }
  },
  // How today's totals are spread, for a percentile. Real players only.
  async ranking(day, total) {
    if (!live.on()) return null;
    try {
      const rows = await fetch(`${BACKEND.url}/rest/v1/score_counts?day=eq.${day}`, { headers: live.headers() }).then(r => r.json());
      const players = rows.reduce((s, r) => s + r.n, 0), below = rows.filter(r => r.total < total).reduce((s, r) => s + r.n, 0);
      return players >= RANK_MIN_PLAYERS ? { players, below } : null;
    } catch { return null; }
  },
  // A dispute ("I think this counts") or an unknown answer waiting for review. Kept locally too, so nothing is lost offline.
  async flag(day, round, text, kind) {
    const log = store.get("flags", []); log.push({ day, round, text, kind, at: Date.now() }); store.set("flags", log.slice(-200));
    if (PLAYTEST && window.PTReport && /dispute/.test(kind)) { const c = CATS[round - 1], r = state && state.rounds[round - 1], x = r && [...(r.rejects || []), ...(r.guesses || []), ...(r.tried || [])].find(g => (g.typed || g.text) === text);
      window.PTReport({ day, round, key: c ? c.key : "", prompt: c ? c.prompt || c.title : "", text, kind, result: x ? (x.status || x.outcome || "rejected") : kind, reason: x && x.reason || "" }); }
    if (!live.on()) return;
    try { await live.post("flags", { day, round, player: playerId, text, kind }); } catch { /* ignore */ }
  },
};
// Review of unknown answers. Never blocks play: the guess is already placed as "pending" when this runs.
// Contract (api/verify.js): POST { question, answer, candidates, player } -> { status: "ok"|"invalid"|"pending", relationship, canonical }
// "pending" changes nothing: the guess stays pending for a person to review.
async function requestReview(cat, texts) {
  if (!BACKEND.verifyUrl || !texts.length) return null;
  // One small request per answer: the question, its rule, the answer, and the five listed answers it most resembles
  // (so another name for one of them can be recognised). Nothing else leaves the page.
  const P = prep(cat), names = [...new Set(P.keys.map(k => k.row.a))];
  const near = t => { const n = V.normalize(t); return names.map(a => ({ a, c: V.editCost(n, V.normalize(a), 6) + (V.sound(n) === V.sound(V.normalize(a)) ? -1 : 0) })).sort((x, y) => x.c - y.c).slice(0, 5).map(x => x.a); };
  const one = async text => {
    try {
      const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 7000);
      const res = await fetch(BACKEND.verifyUrl, { method: "POST", headers: { "Content-Type": "application/json" }, signal: ctl.signal,
        body: JSON.stringify({ question: { key: cat.key, prompt: cat.prompt || cat.title, rules: cat.rules || [] }, answer: text, candidates: near(text), player: playerId }) });
      clearTimeout(timer);
      if (!res.ok) return null;
      const v = await res.json(); return v && { text, status: v.status, canonical: v.canonical || "", relationship: v.relationship || null, reason: v.reason || "" };
    } catch { return null; }
  };
  return (await Promise.all(texts.slice(0, 3).map(one))).filter(Boolean);
}
// How rare an answer is: its share in the day's rarity table. The table is fixed when the day is published, so an
// answer is worth the same to everyone, whenever they play, and a finished iceberg never shifts afterwards.
// (Today's real counts are shown on the results panel once enough players have answered.)
const shareOf = row => row.s;

// ---------- State (saved after every change, so a reload never resets a question) ----------
// Run something when the browser has a quiet moment (falls back to a short timeout where that isn't available).
const idle = f => (window.requestIdleCallback ? requestIdleCallback(f, { timeout: 1500 }) : setTimeout(f, 60));
// DAYX: the whole day as loaded (its theme, and any route choice or answer chain: experimental, playtest only).
let DAYX = null;
let CATS = [], state = null, berg = null, life = null, scen = null, cameFrom = "home", screen = "home", busy = false, unknownKey = "", autoFinish = 0;
const prepared = new Map();
// Shared reference lists some questions use on top of their own answers (content/kb): every job title, not only the
// common ones. Loaded once, kept by the browser, merged into the question before its first guess.
// "products:wearables": brands and models (content/kb/products.json), for questions where a brand or model counts as
// the kind of thing it is. The rule is added to the question's hint, so it is clear before the clock starts.
const KB_FOR = { jobs: "occupations", clothing: "products:wearables" }, kbLoads = new Map();
const kbOf = cat => cat && (cat.kb || KB_FOR[cat.key]);
function loadKb(cat) {
  const ref = kbOf(cat); if (!ref || cat._kb) return Promise.resolve();
  const [file, part] = ref.split(":");
  if (!kbLoads.has(file)) kbLoads.set(file, fetch(`content/kb/${file}.json`).then(r => r.ok ? r.json() : null).catch(() => null));
  return kbLoads.get(file).then(kb => {
    if (!kb || cat._kb) return;
    V.mergeKb(cat, part ? kb[part] : kb); prepared.delete(cat.key);
    if (part && (!cat.granularity || cat.granularity === "category") && !/count as/.test(cat.hint || "")) cat.hint = `${cat.hint ? cat.hint + " " : ""}Brands and models count as the thing they are: a Rolex Submariner is a watch.`;
  });
}
// The other categories' answers, to explain an answer that belongs elsewhere (loaded once, in the background).
let LEXICON = null;
const loadLexicon = () => { if (LEXICON !== null) return; LEXICON = undefined; fetch("content/kb/lexicon.json").then(r => r.ok ? r.json() : null).then(x => { LEXICON = x; }).catch(() => {}); };
const prep = cat => { if (!prepared.has(cat.key)) prepared.set(cat.key, V.prepare(cat)); return prepared.get(cat.key); };
const saveKey = s => s.practice ? "game:practice" : "game:" + s.day;
const save = () => { if (state) store.set(saveKey(state), state); };
function newGame(practice) {
  state = { v: 3, day: dayNumber(), practice, round: 0, phase: "play", finished: false,
    rounds: CATS.map(c => ({ key: c.key, guesses: [], rejects: [], misses: 0, done: false, left: TIME_MS, at: 0 })) };
  save();
}
const cur = () => state.rounds[state.round];
const okGuesses = r => r.guesses.filter(g => g.status === "ok");
// The deepest answer wins; equal shares keep the earlier guess.
// Which question a round belongs to, and what its answers are worth there (rounds.js: rarity, target, forbidden, risk).
const catOf = r => (state && CATS[state.rounds.indexOf(r)]) || { answers: [] };
const bestOf = r => Rounds.best(catOf(r), r);
const scoreOf = r => Rounds.score(catOf(r), r);
const valueOf = (r, g) => Rounds.value(catOf(r), g);
const totalSoFar = () => state ? state.rounds.reduce((s, r) => s + scoreOf(r), 0) : 0;
// ---------- The dive: one calculation for where you are ----------
// Your depth is the running total: every finished question's score plus the best verified answer so far in this one.
// It is always worked out from the saved guesses, never from the camera, so a reload, another screen or the next
// question can't lose it. Only an answer that beats your best for a question takes you further down, and only by the
// difference. Four things are kept apart: how rare an answer is (its share of players), how far it takes you (its depth
// in metres, the question's score if it is your best), where you are (this running total), and your deepest discovery
// (your single rarest answer of the day).
const diveBefore = i => state ? state.rounds.slice(0, i).reduce((s, r) => s + scoreOf(r), 0) : 0;
const diveNow = () => totalSoFar();
// One guess, as it played out: where its question started, what it added, where it left you.
function diveOf(r, g) {
  const i = state.rounds.indexOf(r), cat = CATS[i], base = diveBefore(i), n = r.guesses.indexOf(g);
  const had = Rounds.score(cat, r, n, false), now = Rounds.score(cat, r, n + 1, false), v = Rounds.value(cat, g);
  const beats = now > had;
  return { base, depth: v, gain: Math.max(0, now - had), at: base + Math.max(now, had), keep: beats ? null : had, beats, had, now };
}
// The marks along the way: where each finished question left you.
function syncRoute() {
  if (!berg || !state) return;
  const ways = [];
  for (let i = 0; i < state.round && i < CATS.length; i++) if (state.rounds[i].done || i < state.round) ways.push({ m: diveBefore(i + 1), label: `Q${i + 1}` });
  berg.setRoute(ways);
}
// Another real name for the same answer ("Mexican Hairless Dog" for Xoloitzcuintli) is shown as the player wrote it.
const guessName = (cat, g) => { if (g.aka) return g.aka; const row = g.name && cat.answers.find(a => a.a === g.name); return row ? display(row) : g.typed; };

function show(id) {
  if ((id === "hub" || id === "dive") && screen !== "hub" && screen !== "dive") cameFrom = screen;   // so leaving those pages returns here
  screen = id;
  for (const s of document.querySelectorAll("[data-screen]")) s.hidden = s.dataset.screen !== id;
  Sea.mood(id); Sound.setAmbience(id, 0);
  if (id !== "play") { clock.on = false; clearInterval(clock.timer); cancelAnimationFrame(clock.raf); }
  document.documentElement.classList.toggle("in-play", id === "play" || id === "dive" || id === "race"); // the scene takes the whole window: nothing scrolls behind it
  document.documentElement.classList.toggle("on-home", id === "home");
  modes();
  const playing = !!state && id === "play";
  $("#steps").hidden = !playing;
  updateHeader();
  window.scrollTo(0, 0);
}
function updateHeader() {
  const playing = !!state && screen === "play";
  if (playing) document.querySelectorAll("#steps i").forEach((d, i) => { d.className = i < state.round || (i === state.round && state.phase === "done") ? "done" : i === state.round ? "now" : ""; });
  $("#top-meta").textContent = playing && totalSoFar() > 0 ? `${fmt(totalSoFar())} m` : `Daily #${dayNumber()}`;
}

// ---------- The two modes, and the menu ----------
// Icebreaker (the daily game) and Submarine Race sit in the header. They give way while a question is being answered (in either mode),
// so nothing pulls you out mid-guess; everywhere else one tap switches.
function modes() {
  const raceLive = document.documentElement.classList.contains("race-live");
  const hide = screen === "play" || screen === "dive" || (screen === "race" && raceLive);
  document.documentElement.classList.toggle("no-modes", hide);
  const on = screen === "race" ? "race" : "daily";
  document.querySelectorAll("#modes .mode").forEach(b => { if (b.dataset.mode === on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
  const ink = () => { const b = document.querySelector(`#modes .mode[data-mode="${on}"]`), nav = $("#modes"); if (!b || !nav.offsetWidth) return;
    nav.style.setProperty("--ink-x", b.offsetLeft + 12 + "px"); nav.style.setProperty("--ink-w", b.offsetWidth - 24 + "px"); };
  requestAnimationFrame(ink);
}
function openHowTo() { const d = $("#howto"); if (!d.open) { d.showModal(); store.set("seen-howto", true); $("#howto-btn").classList.remove("fresh"); $("#howto-label").textContent = "How to play"; } }

// ---------- Home ----------
let nextTimer = 0;
function renderHome() {
  const today = todayResult(), n = streakNow().count;
  const theme = DAYX && DAYX.theme ? ` · ${DAYX.theme.name}` : "";
  $("#home-day").textContent = today ? `Daily #${dayNumber()}${theme} done · ${fmt(today.total)} m` : `Daily #${dayNumber()}${theme} · ${CATS.length || 5} questions${TIME_MS ? ` · ${TIME_MS / 1000} s each` : ""}`;
  $("#home-streak").textContent = n ? `${n}-day streak` : "";
  signalHome();
  if (!$("#play").disabled) $("#play").textContent = PLAYTEST ? (today ? `Play day ${dayNumber()} again` : `Play day ${dayNumber()}`) : today ? "See today's results" : "Play today's Icebreaker";
  const tick = () => {
    if (!today || PLAYTEST) { $("#home-next").textContent = ""; return; }
    const left = Math.max(0, localMidnight().getTime() + 86400000 - Date.now()), h = Math.floor(left / 3600000), m = Math.floor(left % 3600000 / 60000);
    $("#home-next").textContent = `Next dive in ${h}h ${String(m).padStart(2, "0")}m`;
  };
  clearInterval(nextTimer); tick(); nextTimer = setInterval(tick, 30000);
  // First visit: the How to play link says so, gently. Never a pop-up, and gone once anything has been played.
  const fresh = !store.get("seen-howto", false) && !today && !n && !store.get("game:" + dayNumber(), null);
  $("#howto-btn").classList.toggle("fresh", fresh); $("#howto-label").textContent = fresh ? "New here? How to play" : "How to play";
  state = null; show("home");
}

// ---------- The clock: one melting icicle per question ----------
// Time only runs while the player can type a guess. It stops for every reveal and camera move and picks up where it
// left off, so nobody pays for animation. It is measured against the real clock, so it keeps running if the page is
// hidden or closed mid-question: looking something up in another tab does not stop it.
const clock = { on: false, deadline: 0, timer: 0, raf: 0, shown: -1, ice: null };
const timeLeft = r => clock.on && cur() === r ? Math.max(0, clock.deadline - Date.now()) : Math.max(0, r.left == null ? TIME_MS : r.left);
// The question's panel of ice (frost.js): it cracks with the clock, so it is drawn wherever the clock is.
let frost = null;
const panel = () => frost || (window.Frost && $("#q-ice") ? (frost = window.Frost.create($("#q-ice")), $("#q-ice").classList.add("look-" + frost.look(), window.Frost.LOOKS[frost.look()].ink === "dark" ? "ink-dark" : "ink-light"), frost) : null);
function clockDraw() {
  if (!TIME_MS || !state || screen !== "play") return;
  const r = cur(), ms = timeLeft(r), secs = Math.ceil(ms / 1000), box = $("#melt");
  if (panel() && state.phase === "play") frost.set(ms / TIME_MS);
  if (!clock.ice) clock.ice = window.IceTimer.create($("#melt-ice"));
  clock.ice.set(ms / TIME_MS, { paused: !clock.on, urgent: secs <= 5 ? 1 - ms / 5000 : 0 });
  box.classList.toggle("paused", !clock.on && ms > 0); box.classList.toggle("low", secs <= 10 && ms > 0); box.classList.toggle("last", secs <= 5 && ms > 0); box.classList.toggle("out", ms <= 0);
  if (secs !== clock.shown) {
    clock.shown = secs; $("#melt-n").textContent = secs;
    if (secs % 5 === 0 || secs <= 5) box.setAttribute("aria-label", `Time left: ${secs} second${secs === 1 ? "" : "s"}`);
  }
}
function clockStart() {
  if (!TIME_MS || !state || screen !== "play" || state.phase !== "play" || clock.on || busy) return;
  const r = cur(); if (r.done || r.guesses.length >= GUESSES) return;
  if (r.left == null) r.left = TIME_MS;
  if (r.left <= 0) { timeUp(); return; }
  clock.on = true; clock.deadline = Date.now() + r.left; r.at = Date.now(); save();
  clearInterval(clock.timer); clock.timer = setInterval(clockTick, 200);
  const frame = () => { if (!clock.on) return; clockDraw(); clock.raf = requestAnimationFrame(frame); };
  cancelAnimationFrame(clock.raf); clock.raf = requestAnimationFrame(frame);
  clockDraw();
}
function clockStop() {
  if (!clock.on) return;
  const r = cur(); r.left = Math.max(0, clock.deadline - Date.now()); r.at = 0;
  clock.on = false; clearInterval(clock.timer); cancelAnimationFrame(clock.raf); save(); clockDraw();
}
function clockTick() {
  if (!clock.on || !state) return;
  const r = cur(), ms = Math.max(0, clock.deadline - Date.now()), secs = Math.ceil(ms / 1000);
  if (secs !== r.sec) {                                   // once a second: remember it, and mark the last few
    r.sec = secs; r.left = ms; r.at = Date.now(); save();
    if (secs === 10) Sound.play("crack");
    if (secs <= 5 && secs >= 1) { Sound.play("drip", { step: 5 - secs }); clock.ice && clock.ice.drip(); const box = $("#melt"); box.classList.remove("beat"); void box.offsetWidth; box.classList.add("beat"); }
  }
  if (document.hidden) clockDraw();
  if (ms <= 0) timeUp();
}
// Out of time: the last of the ice goes, and the question ends with whatever has been found.
function timeUp() {
  const r = cur(); if (!state || r.done) return;
  clock.on = false; clearInterval(clock.timer); cancelAnimationFrame(clock.raf);
  r.left = 0; r.at = 0; r.timeout = true; busy = true; save(); clockDraw();
  clock.ice && clock.ice.dissolve(); Sound.play("melt"); Sound.play("shatter"); if (panel()) frost.shatter();
  $("#answer").blur(); setHint(bestOf(r) ? `Time's up. Your ${depthOf(bestOf(r).share)} m counts.` : "Time's up.");
  setTimeout(() => { if (state && cur() === r) { busy = false; finishQuestion(); } }, 750 / SPEED);   // the last of the ice dissolving
}

// ---------- A question ----------
function bergItem(cat, r, g, n) {
  const row = g.name ? cat.answers.find(a => a.a === g.name) : null, players = r.players || SAMPLE_PLAYERS;
  const dv = state && state.rounds.includes(r) ? diveOf(r, g) : null;
  return { n, name: guessName(cat, g), share: g.share, shareText: shareFor(r, g.share), est: !liveStats(r), blurb: row && row.b || "",
    ...(dv ? { at: dv.at, gain: dv.gain, keep: dv.keep, earn: dv.depth, mode: Rounds.kind(cat), mine: Rounds.mineAt(cat, g) >= 0 } : {}),
    // A count of players only from real ones: a simulated sample is never presented as people.
    countText: row && liveStats(r) ? `${fmt(r.stats.counts.get(g.name) || 1)} of ${fmt(r.stats.players)}` : "", rankText: g.rank || "", sight: sightLine(g.sight) };
}
const sightLine = key => { const e = key && Wildlife && Wildlife.ENCOUNTERS.find(x => x.key === key); return e ? e.line : ""; };
function ensureBerg() {
  if (berg) return;
  berg = window.Iceberg.create($("#ib"), { speed: SPEED });
  if (window.Scenery) scen = window.Scenery.create(berg, $("#ib"));   // mines and route set pieces (experimental days only)
  berg.onDepth((d, b) => { if (screen === "play") Sound.setAmbience("play", d, b, berg.view.metres); });
  berg.onRender(placeSlab); berg.onResize(placeSlab);
  berg.onFocus(i => { document.querySelectorAll("#slots .slot, #sum li").forEach(n => n.classList.toggle("active", +n.dataset.bi === i)); });
  // The animals that live in the water (wildlife.js). The game runs the same without them.
  if (Wildlife) {
    life = Wildlife.create(berg, { low: store.get("fx", "full") === "low" });
    life.onSight(sp => { if (state && screen === "play") logSighting(cur(), sp.key); });
  }
  // Keep the camera composed in whatever part of the window the controls leave free.
  const watch = new ResizeObserver(() => syncFrame(0));
  [".dock", ".q", "#play-panel", "#done-panel", '[data-screen="play"]'].forEach(sel => watch.observe($(sel)));
}
// Which part of the window is free of controls right now, as insets for the scene.
function sceneFrame() {
  const play = $('[data-screen="play"]'), top = Math.round($(".top").getBoundingClientRect().bottom), wide = !matchMedia("(max-width: 920px)").matches;
  if (state && state.phase === "done") { const d = $("#done-panel"); return wide ? { l: 0, r: d.offsetWidth, t: top, b: 0 } : { l: 0, r: 0, t: top, b: Math.max(0, play.clientHeight - d.offsetTop) }; }
  // Room is kept above the summit for the question's block of ice. Its height, not its position, decides this: the
  // block follows the summit (placeSlab), so measuring where it is would chase the camera round in circles.
  // The whole column (the panel and the guesses) sits on the centre line, and the iceberg is centred beneath it.
  const box = play.getBoundingClientRect(), slabBottom = top - box.top + 6 + $(".q-berg").offsetHeight;
  play.style.setProperty("--q-bottom", Math.round(slabBottom) + "px"); play.style.setProperty("--p-height", "0px");
  // The camera works only below the column: the summit rests just beneath it, and answers and their labels are framed
  // in the water below, never behind the question or the answer box.
  return { l: 0, r: 0, t: Math.round(slabBottom + box.top) + (wide ? 4 : 2), b: 0, h: 0 };
}
// The question's block of ice rests on the summit: its point on the peak, wherever the camera has the iceberg. When an
// answer takes the camera down and the summit leaves the window, the block waits at the top until it comes back.
const PEAK_AT = { x: 492, y: 42 };   // the summit in the artwork (iceberg.js: CX + 12, PEAK)
function placeSlab() {
  const slab = $(".q-berg"), v = berg && berg.view; if (!slab || !v || screen !== "play") return;
  const box = (slab.offsetParent || document.body).getBoundingClientRect(), ib = $("#ib").getBoundingClientRect(), top = $(".top").getBoundingClientRect().bottom - box.top + 6;   // measured from the block's own containing box
  const w = slab.offsetWidth, h = slab.offsetHeight, px = ib.left - box.left + v.x0 + PEAK_AT.x * v.z, py = ib.top - box.top + v.y0 + PEAK_AT.y * v.z;
  const f = v.frame || { l: 0, r: 0 }, lo = f.l + 8, hi = box.width - f.r - w - 8;
  // Always on the centre line (the camera keeps the summit there at rest); only its height follows the summit.
  // Fixed in place, so the answer box never moves under the player's fingers while the camera travels.
  const x = Math.round(Math.max(lo, Math.min(hi, (box.width - w) / 2))), y = Math.round(top);
  slab.style.transform = `translate(${x}px, ${y}px)`; slab.classList.toggle("afloat", py - h + 1 < top - 0.5); slab.classList.add("placed");
}
function syncFrame(ms) { if (berg && screen === "play" && state) berg.setFrame(sceneFrame(), ms); }
// A light record of what has been seen: per question (for the results) and for good (for a collection, one day).
function logSighting(r, key) {
  r.seen = r.seen || []; if (r.seen.includes(key)) return;
  r.seen.push(key); save();
  const all = store.get("sightings", {}); all[key] = all[key] || { n: 0, first: state.day }; all[key].n++; store.set("sightings", all);
}
// ---------- Round types: what each one shows, and the risk decision (rounds.js holds the rules) ----------
// Under the question: the forbidden answers as small chips, or, for a target, a sonar strip of popularity (common on the
// left, rare on the right) with the target band lit and a ping for each guess so far.
function roundExtras(cat, r) {
  const box = $("#round-extra"); if (!box) return;
  box.textContent = ""; box.className = "round-extra"; const k = Rounds.kind(cat);
  // Every special round names itself, with a ? that brings back its full rules (the clock waits while they're open).
  if (k !== "standard") {
    const head = el("div", "rx-head"); head.append(el("span", "rx-kind", Rounds.label(cat)));
    if (r.brief) head.append(el("span", "rx-rule", Rounds.rule(cat)));
    const more = el("button", "rx-more", "?"); more.type = "button"; more.title = "How this round works"; more.setAttribute("aria-label", `How ${Rounds.label(cat)} works`);
    more.onclick = () => explainRound(cat, r); head.append(more); box.append(head);
  }
  if (k === "forbidden") {
    box.classList.add("forbid"); box.append(el("span", "rx-lbl", "Off limits"));
    (cat.mode.forbid || []).forEach(a => { const row = cat.answers.find(x => x.a === a); box.append(el("span", "chip", row ? display(row) : a)); });
  } else if (k === "target" || k === "mines") {
    box.classList.add("sonar"); if (k === "mines") box.classList.add("mined");
    const lo = -5, hi = 0, x = s => 100 * (1 - (Math.log10(Math.max(1e-5, Math.min(1, s))) - lo) / (hi - lo));
    const strip = el("div", "sonar-strip");
    const zone = (b, cls) => { const z = el("i", cls); z.style.left = x(Math.min(1, b.hi)) + "%"; z.style.width = Math.max(1.2, x(b.lo) - x(Math.min(1, b.hi))) + "%"; strip.append(z); return z; };
    if (k === "target") zone(Rounds.band(cat), "sonar-band");
    else (cat.mode.mines || []).forEach((b, i) => { const z = zone(b, "sonar-mine" + (okGuesses(r).some(g => Rounds.mineAt(cat, g) === i) ? " gone" : "")); z.title = `Mine: ${Rounds.pct(b.lo)} to ${Rounds.pct(b.hi)} of players`; });
    for (const [s, t] of [[1, "100%"], [0.1, "10%"], [0.01, "1%"], [0.001, "0.1%"], [0.0001, "0.01%"]]) { const m = el("span", "sonar-tick", t); m.style.left = x(s) + "%"; strip.append(m); }
    okGuesses(r).forEach(g => { const v = valueOf(r, g), boom = k === "mines" && Rounds.mineAt(cat, g) >= 0;
      const p = el("b", "sonar-ping" + (boom ? " boom" : k === "mines" ? (Rounds.skims(cat, g) >= 0 ? " hit" : " near") : v >= Rounds.TARGET_MAX ? " hit" : v > 0 ? " near" : "")); p.style.left = x(g.share) + "%"; p.title = `${guessName(cat, g)}: ${pctText(g.share)}`; strip.append(p); });
    box.append(el("span", "rx-lbl", k === "target" ? `Target: ${Rounds.band(cat).text}` : `Mines at ${(cat.mode.mines || []).map(b => `${Rounds.pct(b.lo)}–${Rounds.pct(b.hi)}`).join(" and ")} of players`), strip);
  } else if (k === "risk" && r.choice) {
    box.classList.add("riskline");
    box.append(el("span", "rx-lbl", r.choice.kind === "risk" ? `At risk: +${r.choice.stake} m. Beat it and every metre past it counts ×${Rounds.RISK_MULT}.` : r.choice.kind === "secure" ? `Kept: +${r.choice.stake} m with the bonus makes +${Rounds.keepValue(r.choice.stake)} m` : "Playing on: best of three"));
  } else box.hidden = true;
  if (box.childNodes.length) box.hidden = false;
}
// A card over the scene, for a round's rules or a decision. Resolves with the chosen button's value. Enter takes the
// first; number keys pick by position. The clock is never running while one is open.
function roundCard({ eyebrow, title, body, extra, buttons }) {
  return new Promise(resolve => {
    const host = $("#round-card"); host.textContent = ""; host.hidden = false;
    const card = el("div", "rc"); if (eyebrow) card.append(el("p", "eyebrow", eyebrow));
    card.append(el("h3", null, title)); if (body) card.append(el("p", "rc-body", body)); if (extra) card.append(extra);
    const row = el("div", "rc-actions"), bs = buttons.map((b, i) => { const x = el("button", "btn" + (i ? " ghost" : ""), b.label); x.type = "button"; if (b.note) x.append(el("small", null, b.note)); x.onclick = () => done(b.value); row.append(x); return x; });
    card.append(row); host.append(card);
    const key = e => { if (e.key === "Enter") { e.preventDefault(); done(buttons[0].value); } else { const n = +e.key; if (n >= 1 && n <= buttons.length && buttons.length > 1) { e.preventDefault(); done(buttons[n - 1].value); } } };
    const done = v => { removeEventListener("keydown", key, true); host.hidden = true; host.textContent = ""; $("#answer").focus({ preventScroll: true }); resolve(v); };
    addEventListener("keydown", key, true); setTimeout(() => bs[0].focus({ preventScroll: true }), 30);
  });
}
// The rules of a new kind of round, once per question, before its clock starts.
// Familiar kinds of round (seen INTRO_FULL times already) skip the card: their rule sits in one line under the question
// instead, with the ? beside it for the full card.
const INTRO_FULL = 2;
function introCard(cat, r, label) {
  const extra = el("div"), copy = $("#round-extra").cloneNode(true); copy.removeAttribute("id"); copy.querySelectorAll(".rx-head").forEach(x => x.remove()); extra.append(copy);
  return roundCard({ eyebrow: `Question ${state.round + 1} · ${Rounds.label(cat)}${DAYX && DAYX.theme ? " · " + DAYX.theme.name : ""}`, title: cat.prompt || cat.title, body: Rounds.rule(cat), extra,
    buttons: [{ label, value: 1 }] });
}
async function roundIntro(cat, r) {
  const k = Rounds.kind(cat);
  if (k === "standard" || r.introduced || !state || cur() !== r || state.phase !== "play") return;
  const seen = store.get("kinds-seen", {});
  if ((seen[k] || 0) >= INTRO_FULL) { r.introduced = true; r.brief = true; save(); roundExtras(cat, r); return; }
  await introCard(cat, r, "Start");
  seen[k] = (seen[k] || 0) + 1; store.set("kinds-seen", seen);
  r.introduced = true; save();
}
// The rules again, mid-question. The clock keeps running behind them: rules are read before a question starts (the
// first two times as a card, the clock waiting), so the ? can never be used to buy thinking time.
async function explainRound(cat, r) {
  if (!state || cur() !== r || $("#round-card").hidden === false) return;
  await introCard(cat, r, clock.on ? "Back to it (the clock is running)" : "Got it");
}
// Risk and reward: decide once the first verified answer is in (and there is a guess left to use).
// (A first answer worth nothing has nothing to stake: that round simply plays on.)
const riskPending = (cat, r) => { if (Rounds.kind(cat) !== "risk" || r.choice || r.done || !okGuesses(r).length || r.guesses.length >= GUESSES) return false;
  if (valueOf(r, okGuesses(r)[0]) <= 0) { r.choice = { kind: "continue", stake: 0, at: r.guesses.length, auto: true }; save(); return false; } return true; };
async function askRisk(cat, r) {
  clockStop();
  const first = okGuesses(r)[0], stake = valueOf(r, first), left = GUESSES - r.guesses.length;
  const v = await roundCard({ eyebrow: "Risk and reward", title: `${guessName(cat, first)} is worth +${stake} m`,
    body: `It hasn't moved you yet. Choose what happens to it. Earlier questions are safe whatever you choose.`,
    buttons: [
      { label: `Keep it: +${Rounds.keepValue(stake)} m`, note: ` · +${stake} m plus a ${Math.round(Rounds.KEEP_BONUS * 100)}% bonus, question over`, value: "secure" },
      { label: "Play on", note: ` · best of three, nothing at stake`, value: "continue" },
      { label: `Risk it`, note: ` · beat +${stake} m with your ${left === 1 ? "last guess" : left + " guesses"} and the gain counts ×${Rounds.RISK_MULT}; miss and this question earns 0`, value: "risk" },
    ] });
  if (!state || cur() !== r) return;
  r.choice = { kind: v, stake, at: r.guesses.length }; save();
  roundExtras(cat, r); renderSlots(); updateHeader();
  if (v === "secure") { finishQuestion(); return; }
  if (v === "continue" || v === "risk") {
    // The first answer's distance now counts (play on) or is staked (risk): move down for play on, stay for risk.
    if (v === "continue" && stake > 0) { berg.setDive({ base: diveBefore(state.round), at: diveNow() }); syncFrame(0); }
    const left2 = GUESSES - r.guesses.length;
    setHint(v === "risk" ? `Risked +${stake} m. Beat it with your next ${left2 === 1 ? "guess" : left2 + " guesses"} and the gain counts ×${Rounds.RISK_MULT}, or this question earns nothing.` : `+${stake} m counts. Best of three from here.`, v === "risk" ? "warn" : "good");
  }
}
function setHint(text, kind) { const h = $("#hint"); h.className = "hint" + (kind ? " " + kind : ""); h.textContent = text || ""; const a = $("#q-ask"); if (a && !a.dataset.keep) a.hidden = true; }
// "Did you mean Raven?" inside the ice panel, under the box: Enter (or the button) for yes; Escape, or editing the
// answer, to keep it as typed. It says nothing about rarity, offers one answer only, and the clock keeps running.
let confirmFor = null, keepTyped = "";
function askCorrection(name, raw) {
  setHint("");
  const a = $("#q-ask"); a.textContent = ""; a.hidden = false;
  const yes = el("button", "ask-yes", name), no = el("button", "ask-no", "Keep \u201c" + raw + "\u201d");
  yes.type = no.type = "button"; yes.onpointerdown = no.onpointerdown = e => e.preventDefault();
  yes.onclick = acceptCorrection; no.onclick = declineCorrection;
  a.append(el("span", "ask-q", "Did you mean "), yes, el("span", null, "?"), no, el("span", "ask-keys", "Enter \u00b7 yes \u2003 Esc \u00b7 keep"));
  $("#answer").select();
}
function acceptCorrection() {
  if (!confirmFor || !state || busy) return;
  const cat = CATS[state.round], r = cur(), c = confirmFor;
  if (r.guesses.length >= GUESSES) return;
  if (r.guesses.some(g => g.name === c.row.a)) { confirmFor = null; setHint(`You've already tried ${display(c.row)}. No guess used.`, "warn"); Sound.play("duplicate"); $("#answer").select(); return; }
  place(cat, r, c.row, c.raw, "confirmed");
}
function declineCorrection() {
  if (!confirmFor) return;
  keepTyped = confirmFor.key; unknownKey = confirmFor.key; confirmFor = null;   // kept as typed: it goes for review (one press)
  submit();
}

// animated: true for the first question (the push in to the tip), "surface" between questions (rise to the tip).
// ---------- Routes and chains (experimental, playtest only) ----------
// A route: at one point in the day the player picks which questions the rest of the dive uses. A chain: a question
// whose exact version depends on the answer that counted in an earlier one (a country, then an animal native to it).
// What was picked is saved (state.paths: round -> question key), so a reload rebuilds the same day.
function allVariants() {
  const out = new Map(), add = q => { if (q && q.key) out.set(q.key, q); };
  CATS.forEach(add);
  if (DAYX && DAYX.branch) DAYX.branch.routes.forEach(r => r.questions.forEach(add));
  CATS.forEach(q => { if (q.chain) { Object.values(q.chain.by).forEach(add); add(q.chain.fallback); } });
  return out;
}
let VARIANTS = null;
function applyPaths(paths) {
  VARIANTS = VARIANTS || allVariants();
  for (const [i, key] of Object.entries(paths)) { const q = VARIANTS.get(key); if (q && /^\d+$/.test(i)) CATS[+i] = paths["p" + i] || paths["h" + i] ? { ...q, prompt: paths["p" + i] || q.prompt, hint: paths["h" + i] || q.hint } : q; }
}
function setPath(i, q) {
  VARIANTS = VARIANTS || allVariants();
  CATS[i] = q; state.paths = state.paths || {}; state.paths[i] = q.key; state.rounds[i].key = q.key;
  if (VARIANTS.get(q.key) && VARIANTS.get(q.key).prompt !== q.prompt) state.paths["p" + i] = q.prompt;   // a chain question written for your answer
  if (VARIANTS.get(q.key) && VARIANTS.get(q.key).hint !== q.hint) state.paths["h" + i] = q.hint;
}
async function resolvePaths() {
  const i = state.round; if (!DAYX || i >= CATS.length || state.phase !== "play" || state.rounds[i].guesses.length) return;
  const b = DAYX.branch;
  if (b && i === b.at && !(state.paths && state.paths.route)) {
    const v = await roundCard({ eyebrow: "The water splits", title: "Choose your route", body: "The rest of today's dive follows the route you pick. (Prototype: routes aren't scored against each other yet.)",
      buttons: b.routes.map(r => ({ label: r.label, note: " · " + r.blurb, value: r.key })) });
    const route = b.routes.find(r => r.key === v) || b.routes[0];
    route.questions.forEach((q, k) => setPath(b.at + k, q)); state.paths.route = route.key; save();
    if (berg) berg.setDive({ base: diveBefore(i), at: diveNow() });   // the camera stays where you are
    // Travel there: the place slides in from the side you chose, the water streams past, the sound of it changes.
    if (scen) scen.setRoute(route.key, { dir: b.routes.indexOf(route) % 2 ? 1 : -1, y0: window.Iceberg.yX(diveNow()) - 150, seed: state.day });
    Sound.play("routego"); if (Sound.setRoute) Sound.setRoute(route.key);
  }
  const cat = CATS[i];
  if (cat && cat.chain && !(state.paths && state.paths[i])) {
    const from = state.rounds[cat.chain.from], fromCat = CATS[cat.chain.from], b1 = bestOf(from);
    let key = b1 && b1.name;
    if (cat.chain.fam) { const c0 = bestOf(state.rounds[cat.chain.country_from]), row = b1 && fromCat.answers.find(a => a.a === b1.name); key = c0 && row ? `${c0.name}|${row.fam}` : null; }
    let next = (key && cat.chain.by[key]) || cat.chain.fallback || Object.values(cat.chain.by)[0];
    const last = b1 ? guessName(fromCat, b1) : "your last answer";
    if (/\{last\}/.test(next.prompt)) next = { ...next, prompt: next.prompt.replace("{last}", last) };
    if (/\{last\}/.test(next.hint || "")) next = { ...next, hint: next.hint.replace("{last}", last) };   // the fallback says why it's general
    setPath(i, next); save();
  }
}
async function startQuestion(animated) {
  await resolvePaths();
  await loadKb(CATS[state.round]);
  const cat = CATS[state.round], r = cur(), rising = animated === "surface" && berg && berg.count > 0 && screen === "play";
  ensureBerg(); prep(cat); // build the lookup now, so the first guess is judged instantly
  clearTimeout(autoFinish); busy = false; unknownKey = ""; queued = false; confirmFor = null; keepTyped = "";
  const kind = Rounds.kind(cat);
  $("#q-num").textContent = `Question ${state.round + 1} of ${CATS.length}` + (kind !== "standard" || CATS.some(c => c.mode) ? ` · ${Rounds.label(cat)}` : "");
  roundExtras(cat, r);
  Icons.put($("#q-icon"), cat.icon);
  $("#q-title").textContent = cat.prompt || cat.title;
  $("#q-hint").textContent = cat.hint || "";
  setHint("");
  const done = state.phase === "done";
  $('[data-screen="play"]').classList.toggle("playing", !done); $('[data-screen="play"]').classList.toggle("done", done);
  if (rising) { const d = $("#done-panel"); d.classList.add("leaving"); setTimeout(() => { d.hidden = true; d.classList.remove("leaving"); }, 220); }
  else $("#done-panel").hidden = !done;
  if (!rising) { show("play"); syncFrame(0); } else updateHeader();
  // The water stays as it is between questions, and so does the camera's depth. A visiting giant leaves. A fresh start (or a reload) fills the water anew.
  if (life) { if (rising) life.dismiss(); else life.reset(state.day * 10 + state.round + 1); }
  // Real counts for this question, if a database is connected. Depths are fixed from what's known when you guess.
  r.stats = null;
  const shown = okGuesses(r);
  let ready = Promise.resolve();
  const base = diveBefore(state.round);
  if (shown.length || done) { shown.forEach((g, i) => { g.bi = i; }); berg.restore(shown.map(g => bergItem(cat, r, g, r.guesses.indexOf(g) + 1)), { base, at: diveNow() }); tagBest(cat, r); }
  else if (rising) ready = berg.carry(sceneFrame(), 620, base);   // the dive goes on from where the last question left you
  else {
    // Pressing Play: the camera comes down the iceberg from the summit to the waterline before the first question.
    // Coming back to a dive already under way (a reload, another screen): you are simply where you were.
    const descent = animated === true && state.round === 0 && !state.practice && base === 0;
    ready = berg.enter(animated && !matchMedia("(prefers-reduced-motion: reduce)").matches, { descent, at: base }) || ready;
    if (descent) { const slab = $(".q-berg"); slab.classList.add("arriving"); ready.then(() => slab.classList.remove("arriving")); const skip = e => { if (e.type === "keydown" && e.key === "Tab") return; berg.skipIntro(); off(); }, off = () => { removeEventListener("pointerdown", skip, true); removeEventListener("keydown", skip, true); };
      addEventListener("pointerdown", skip, true); addEventListener("keydown", skip, true); ready.then(off); }
  }
  syncRoute(); sceneryFor(cat, r, ready);
  // The clock. A reload never hands time back: whatever passed while the page was away has gone too.
  clearInterval(clock.timer); cancelAnimationFrame(clock.raf); clock.on = false; clock.shown = -1;
  $("#melt").hidden = !TIME_MS;
  if (!TIME_MS && !done && panel()) { frost.reset(`${state.day}-${state.round}`); frost.set(1); ready.then(() => frost.form()); }   // no clock: the panel still forms, and never cracks
  if (TIME_MS && !done) {
    if (r.left == null) r.left = TIME_MS;
    if (r.at) { r.left = Math.max(0, r.left - (Date.now() - r.at)); r.at = 0; }
    if (clock.ice) clock.ice.reset();
    if (panel()) { frost.reset(`${state.day}-${state.round}`); frost.set(r.left / TIME_MS); ready.then(() => { if (state && cur() === r && state.phase === "play") frost.form(); }); }
    clockDraw();
    // It starts once the question is in view and the box is ready, and, for a new kind of round, once its rules have
    // been read (the card waits for a key or a tap; the clock doesn't run behind it). A risk decision left open by a
    // reload is asked again before the clock carries on.
    ready.then(() => roundIntro(cat, r)).then(() => riskPending(cat, r) ? askRisk(cat, r) : null)
      .then(() => { if (state && cur() === r && state.phase === "play" && !busy) clockStart(); });
  }
  if (done) { renderDone(cat, r); syncFrame(0); return ready; }
  renderSlots(); if (!rising) syncFrame(0);
  const input = $("#answer"); input.value = "";
  if (animated) Sound.play("question");
  input.focus({ preventScroll: true });
  // While this question is being played, get the next one's answer lookup ready (it is already on this device).
  idle(() => { loadLexicon(); const next = state && CATS[state.round + 1]; if (next) loadKb(next).then(() => prep(next)); });
  // A reload after the last guess landed but before the results appeared: carry on to the results.
  if (r.guesses.length >= GUESSES) finishQuestion();
  return ready;
}
// What this question puts in the water: a chosen route stays for the rest of the day; mines only for their round.
function sceneryFor(cat, r, ready) {
  if (!scen) return;
  const key = state.paths && state.paths.route, b = DAYX && DAYX.branch;
  if (key && b && scen.route !== key) { scen.setRoute(key, { instant: true, y0: window.Iceberg.yX(diveBefore(b.at)) - 150, seed: state.day }); if (Sound.setRoute) Sound.setRoute(key); }
  if (!key && Sound.setRoute) Sound.setRoute(null);
  scen.clearMines();
  if (Rounds.kind(cat) === "mines" && state.phase === "play" && !r.done) ready.then(() => {
    if (!state || cur() !== r) return;
    scen.setMines(cat.mode.mines, state.day * 10 + state.round);
    okGuesses(r).forEach(g => { const i = Rounds.mineAt(cat, g); if (i >= 0) scen.explode(i, true); });   // a reload: the ones already set off stay gone
  });
}
function tagBest(cat, r) {
  const b = bestOf(r);
  const tag = Rounds.kind(cat) === "target" ? "Closest to the target · this one counts" : "Deepest discovery · this one counts";
  okGuesses(r).forEach(g => berg.setTag(g.bi, g === b && okGuesses(r).length > 1 ? tag : ""));
}

function renderSlots(revealing = -1, landed = -1) {
  const cat = CATS[state.round], r = cur(), best = bestOf(r), list = $("#slots");
  if (revealing < 0) roundExtras(cat, r);
  list.textContent = "";
  for (let i = 0; i < GUESSES; i++) {
    const g = r.guesses[i], li = el("li");
    const b = el(g && g.status === "ok" && i !== revealing ? "button" : "div", "slot"); if (b.tagName === "BUTTON") b.type = "button";
    const n = el("span", "slot-n"), main = el("div", "slot-main"), depth = el("span", "slot-depth");
    n.append(el("span", null, String(i + 1)));
    if (!g) {
      const next = i === r.guesses.length;
      b.classList.add(next ? "next" : "empty");
      main.append(el("span", "slot-name", `Guess ${i + 1}`)); depth.textContent = "–";
      b.setAttribute("aria-label", `Guess ${i + 1}: not used yet`);
    } else if (i === revealing) {
      b.classList.add("revealing");
      main.append(el("span", "slot-name", guessName(cat, g)), el("span", "slot-sub", "Diving…")); depth.textContent = "···";
    } else if (g.status === "ok") {
      const d = depthOf(g.share), tier = tierOfDepth(d);
      b.classList.add("done", "tier-" + tier.key); if (g === best) b.classList.add("best"); if (i === landed) b.classList.add("land");
      b.dataset.bi = g.bi;
      const sub = el("span", "slot-sub"); sub.append(shareFor(r, g.share), el("span", "wide", ` ${liveStats(r) ? "of players" : "est."} · `), el("b", null, tier.name));
      main.append(el("span", "slot-name", guessName(cat, g)), sub);
      depth.append("+" + valueOf(r, g), el("small", null, "m"));
      if (g === best && okGuesses(r).length > 1) b.append(el("span", "slot-tag", "Counts"));
      b.title = "Show on the iceberg";
      b.onclick = () => berg.focus(g.bi);
    } else {
      const wait = g.status === "pending";
      b.classList.add(wait ? "pending" : "miss");
      n.innerHTML = wait ? ICON.wait : ICON.no;
      main.append(el("span", "slot-name", g.typed), el("span", "slot-sub", wait ? (g.checking ? "Being checked…" : "Waiting for review") : g.reason || "Didn't count"));
      depth.textContent = wait ? "pending" : "no depth";
    }
    b.prepend(n); b.append(main, depth); li.append(b); list.append(li);
  }
  // Finishing early: one tap, with what you'd keep and what you'd leave unused in plain sight.
  const left = GUESSES - r.guesses.length, fin = $("#finish"), note = $("#finish-note");
  fin.hidden = !(r.guesses.length > 0 && left > 0 && revealing < 0);
  fin.textContent = best ? `Finish with +${scoreOf(r)} m` : "Finish this question";
  if (Rounds.kind(cat) === "risk" && r.choice && r.choice.kind === "risk") fin.textContent = scoreOf(r) ? `Finish with +${scoreOf(r)} m` : "Give up the risk (earns 0)";
  // While a guess is being revealed the row keeps its place (an empty row would collapse and nudge the scene).
  note.textContent = fin.hidden ? (r.guesses.length === 0 ? "3 guesses. Only your rarest counts." : revealing >= 0 || left > 0 ? "\u00a0" : "") : `${left} guess${left === 1 ? "" : "es"} unused`;
  updateHeader();
}

function rankText(cat, r, share) {
  // What part of all answers given were more common than this one.
  let above = 0, total = 0;
  for (const row of cat.answers) { const s = shareOf(row); total += s; if (s > share) above += s; }
  if (above === 0) return "The most common answer";
  return `Rarer than ${Math.min(99, Math.floor(100 * above / (total || 1)))}% of answers given`;
}

// What was typed but didn't become a guess (a short form that could mean several jobs, a likely slip not yet sent): kept,
// so the results show everything the player tried. Sent later, it leaves this list.
function tried(r, text, outcome) { r.tried = (r.tried || []).filter(x => V.normalize(x.text) !== V.normalize(text)); r.tried.push({ text, outcome }); }
function untried(r, text) { if (r.tried) r.tried = r.tried.filter(x => V.normalize(x.text) !== V.normalize(text)); }
// Everything a guess can turn out to be is decided here, in the browser, at once.
let queued = false;   // a guess typed and sent while the last one was still travelling: it goes in as soon as that lands
function submit() {
  if (state && screen === "play" && state.phase === "play" && busy) { if ($("#answer").value.trim() && cur().guesses.length < GUESSES) { queued = true; berg.hurry(); } return; }
  if (!state || screen !== "play" || state.phase !== "play" || busy) return;
  const input = $("#answer"), form = $("#entry"), cat = CATS[state.round], r = cur(), P = prep(cat);
  if (document.activeElement !== input) input.focus({ preventScroll: true });
  const text = input.value.trim();
  if (!text || r.guesses.length >= GUESSES) return;
  const given = { rows: new Map(), texts: new Set() };
  r.guesses.forEach(g => { if (g.name) given.rows.set(g.name, g); else given.texts.add(g.key); });
  // A "Did you mean ...?" is waiting and the box still holds what was typed: Enter means yes.
  if (confirmFor && V.normalize(text) === confirmFor.key) return acceptCorrection();
  if (keepTyped && V.normalize(text) === keepTyped) given.noCorrect = true;
  const j = V.judge(text, P, given);
  if (!j) return;
  const shake = () => { form.classList.remove("shake"); void form.offsetWidth; form.classList.add("shake"); };

  if (j.status === "dup") { // free: nothing is used up
    const name = j.row ? display(j.row) : j.text, same = V.variants(V.normalize(j.text)).includes(V.normalize(name)), prev = j.row && given.rows.get(j.row.a);
    // The same answer under another of its names: no new discovery, and no guess used.
    setHint(same || (prev && V.normalize(prev.aka || prev.typed) === V.normalize(j.text)) ? `You've already tried ${name}. No guess used.` : `You've already discovered this answer (${name}). No guess used.`, "warn");
    Sound.play("duplicate"); input.select(); unknownKey = "";
    const slot = document.querySelectorAll("#slots .slot")[r.guesses.findIndex(g => j.row ? g.name === j.row.a : g.key === j.key)];
    if (slot) { slot.classList.remove("land"); void slot.offsetWidth; slot.classList.add("land"); }
    return;
  }
  if (j.status === "invalid") { // free a few times, so a slip never costs a guess, but not endlessly
    r.misses++; r.rejects.push({ text: j.text, reason: j.reason }); unknownKey = "";
    Sound.play("invalid"); shake();
    if (r.misses > FREE_MISSES) {
      r.guesses.push({ status: "miss", typed: j.text, key: j.key, reason: j.reason });
      input.value = ""; setHint(`${j.reason}. That used a guess.`, "warn"); save(); renderSlots(); afterGuess(false);
    } else {
      setHint(`${j.reason}. No guess used.${r.misses === FREE_MISSES ? " The next miss uses one." : ""}`, "warn");
      input.select(); save();
    }
    return;
  }
  if (j.status === "ambiguous") {   // "PM": which one? Free, and kept in the list of what was tried
    tried(r, j.text, "ambiguous"); Sound.play("pending"); setHint(`${j.reason}. No guess used.`, "warn"); input.select(); save();
    return;
  }
  if (j.status === "confirm") {
    // A likely misspelling: one answer offered, never swapped in silently, and nothing about its rarity shown until it is
    // accepted. The clock keeps running, so asking gives no free thinking time, and only three offers are made per
    // question (one per guess), so it can't be used to fish for answers.
    r.checks = (r.checks || 0) + 1;
    if (r.checks > 3) { keepTyped = j.key; return submit(); }
    confirmFor = { key: j.key, row: j.row, raw: j.text };
    Sound.play("pending"); askCorrection(display(j.row), j.text);
    return;
  }
  if (j.status === "pending") {
    // Not on the list. It is kept, at once, as a guess waiting for review: never thrown away, never scored as rare.
    // Only when it looks like a slip of something on the list does the first Enter stop to say so (and that attempt
    // is remembered too, in case the player moves on).
    // On another category's list ("terrodactyl" on birds: pterodactyl, a prehistoric animal): said once, at no cost.
    const other = !unknownKey || unknownKey !== j.key ? V.elsewhere(j.text, LEXICON, String(cat.prompt || "").replace(/^Name /, "")) : null;
    if (other && unknownKey !== j.key) {
      unknownKey = j.key; Sound.play("pending"); input.select(); tried(r, j.text, "other list");
      setHint(`${other.fixed ? `“${j.text}” looks like ${other.name}: ` : `${other.name.replace(/^./, c => c.toUpperCase())} `}that's on our list for ${other.labels.slice(0, 2).join(" and ")}, not this question. Not sent: try another, or press Enter again if you think it counts here (uses a guess).`, "warn");
      return;
    }
    if ((j.suggest || j.near) && unknownKey !== j.key) {
      unknownKey = j.key; Sound.play("pending"); input.select(); tried(r, j.text, "not sent");
      setHint(j.suggest ? `Did you mean ${j.suggest.slice(0, -1).join(", ")}${j.suggest.length > 1 ? " or " : ""}${j.suggest[j.suggest.length - 1]}? Not sent yet: fix it, or press Enter again to send “${j.text}” for review (uses a guess).`
        : `“${j.text}” isn't on our list, and it's close to an answer that is. Not sent yet: check the spelling, or press Enter again to send it for review (uses a guess).`, "warn");
      return;
    }
    unknownKey = ""; untried(r, j.text);
    const g = { status: "pending", typed: j.text, key: j.key, checking: !!BACKEND.verifyUrl };
    r.guesses.push(g); input.value = "";
    Sound.play(r.guesses.length === GUESSES ? "final" : "submit", { step: r.guesses.length - 1 });
    setHint(BACKEND.verifyUrl ? `“${j.text}” isn't on our list yet. Sent for checking: if it's approved, its depth is added. That used a guess.`
      : `“${j.text}” isn't on our list yet. Kept for review: if it's approved, its depth is added. That used a guess.`, "pending");
    live.flag(state.day, state.round + 1, j.text, "pending");
    save(); renderSlots(); reviewGuess(cat, r, g); afterGuess(false);
    return;
  }
  // A recognised answer: place it, then go and find it.
  place(cat, r, j.row, j.text, j.via, j);
}
// Puts a recognised answer in the next slot. A corrected spelling is sent to the server as the answer's own name (so
// the server's check matches exactly) and what was typed is kept to show beside it.
function place(cat, r, row, raw, via, j) {
  const input = $("#answer"); unknownKey = ""; confirmFor = null; keepTyped = "";
  // Forbidden in this round: the answer itself or any of its other names and spellings (they all lead to this row).
  if (row && Rounds.isForbidden(cat, row)) {
    r.misses++; r.rejects.push({ text: raw, reason: `${display(row)} is off limits this round` });
    Sound.play("invalid"); const form = $("#entry"); form.classList.remove("shake"); void form.offsetWidth; form.classList.add("shake");
    if (r.misses > FREE_MISSES) { r.guesses.push({ status: "miss", typed: raw, key: V.normalize(raw), reason: "Off limits this round" }); input.value = ""; setHint(`${display(row)} is off limits this round. That used a guess.`, "warn"); save(); renderSlots(); afterGuess(false); }
    else { setHint(`${display(row)} is off limits this round. No guess used.`, "warn"); input.select(); save(); }
    return;
  }
  // Anything not typed exactly is sent as the answer's own name, so the server scores it as that answer: the same
  // depth, the same counts, one answer however it was written.
  const share = row ? shareOf(row) : REVIEWED_SHARE, canon = !!row && via !== "exact";
  const g = { status: "ok", typed: canon ? display(row) : raw, key: V.normalize(canon ? display(row) : raw), name: row ? row.a : null, share, via, rank: rankText(cat, r, share) };
  const differs = canon && V.normalize(raw) !== V.normalize(g.typed);
  // "gray" for grey, "colour" for color: a spelling of the same word, shown as the answer. A different name is kept as written.
  if (differs && via === "alias" && V.editCost(V.normalize(raw), V.normalize(g.typed), 2) > 2) g.aka = String(raw).trim().replace(/^./, c => c.toUpperCase());
  else if (differs) g.raw = raw;
  r.guesses.push(g); input.value = ""; untried(r, raw);
  const name = row ? display(row) : g.typed;
  if (via === "specific") g.note = j && j.detail ? `you typed “${raw}”: counted as ${name}` : null;
  setHint(via === "specific" ? `Accepted as: ${name}${j && j.detail ? ` (${j.detail})` : ""}. ${j && j.note ? j.note.replace(/^./, c => c.toUpperCase()) + "." : ""}` : via === "typo" ? `Accepted as: ${name} (spelling corrected).` : via === "confirmed" ? "" : g.aka ? `Accepted as: ${name} (another name for it).` : g.raw ? `Accepted as: ${name}.` : "", via === "typo" || via === "specific" || g.raw || g.aka ? "fixed" : "");
  Sound.play(r.guesses.length === GUESSES ? "final" : "submit", { step: r.guesses.length - 1 });
  save(); reveal(cat, r, g);
}

async function reveal(cat, r, g) {
  clockStop(); busy = true;
  const index = r.guesses.indexOf(g), before = okGuesses(r).filter(x => x !== g && x.bi != null), prevBest = before.reduce((b, x) => !b || x.share < b.share ? x : b, null);
  const d = depthOf(g.share), deeper = !prevBest || g.share < prevBest.share, special = d >= 200 && deeper, beneath = Iceberg.isBeyond(d);
  g.bi = berg.count;
  renderSlots(index);
  // Beneath the iceberg: its own long descent and its own discovery sound, whether or not it is your deepest.
  // The great squid that comes for an answer this deep sets off while the camera is still on its way down, so it is
  // already rising beside the answer when the camera arrives.
  const dv = diveOf(r, g);
  const guest = life && life.encounterFor(d, r.guests || [], dv.at); let early = 0;
  berg.onTravel((it, dir, ms) => {
    if (beneath && dir > 0) Sound.play("descend", { seconds: ms / 1000 }); else { Sound.play("travel", { dir, seconds: ms / 1000 }); if (special && !beneath) Sound.play("rare", { lead: ms / 1000 }); }
    if (life) life.calm(ms + 2600);
    if (guest && dir > 0 && it && !early) early = setTimeout(() => { early = -1; if (state && cur() === r) { life.encounter(guest.key, { x: it.x, y: it.y }); Sound.play("encounter", { kind: guest.key }); } }, Math.max(0, ms - 2400));   // already rising, and beside the answer as you arrive
  });
  // An exceptional find has the stage to itself: the question's column steps aside while it is revealed.
  const col = $(".q-berg"); if (special) col.classList.add("aside");
  await berg.add(bergItem(cat, r, g, index + 1), { special });
  col.classList.remove("aside");
  if (!state || cur() !== r) return;
  busy = false;
  // A risk round: the first verified answer waits for a decision (the clock waits too).
  let decided = false;
  if (riskPending(cat, r)) { await askRisk(cat, r); decided = true; }
  if (!state || cur() !== r) return;
  if (state.phase === "play" && !r.done) clockStart();
  // An answer this deep does not go unnoticed. Each of the great squid comes once per question, at its own depth.
  if (guest) {
    r.guests = (r.guests || []).concat(guest.key); g.sight = guest.key; logSighting(r, guest.key);
    setTimeout(() => { if (state && cur() === r) berg.setSight(g.bi, guest.line); }, 700 / SPEED);   // after the label's own reveal
    // No camera journey (skipped, or reduced motion): it comes now.
    // No camera journey (reduced motion) or the descent was skipped before it set off: it comes now.
    if (early > 0) clearTimeout(early);
    if (early >= 0 && berg.view.focus) { const at = berg.view.focus; life.encounter(guest.key, at); Sound.play("encounter", { kind: guest.key }); }
  }
  // Landed: say what was found, and whether it beat your deepest.
  renderSlots(-1, index); tagBest(cat, r);
  const mine = Rounds.mineAt(cat, g);
  if (mine >= 0) { if (scen) scen.explode(mine); Sound.play("mine"); }
  else if (beneath) Sound.play("unfathomable"); else if (!special) Sound.play("reveal", { depth: Math.min(1, d / 260), m: d });
  const left = GUESSES - r.guesses.length, more = left ? ` ${plural(left, "guess")} left.` : "";
  const counted = /^Accepted as/.test($("#hint").textContent) ? $("#hint").textContent + " " : "";
  setTimeout(() => {
    if (!state || cur() !== r || state.phase !== "play" || decided || confirmFor) return;   // never cover a question being asked
    const at = fmt(dv.at), vt = Rounds.verdict(cat, g, dv.had, dv.now);
    if (vt) { setHint(counted + vt + more, dv.gain > 0 ? "good" : ""); return; }
    if (Rounds.kind(cat) === "risk" && r.choice && r.choice.kind === "risk") {
      const won = dv.now > 0; setHint(counted + (won ? `Risk paid off: +${valueOf(r, g)} m beats your +${r.choice.stake} m, and the gain counts ×${Rounds.RISK_MULT}: +${dv.now} m.` : `+${valueOf(r, g)} m doesn't beat your +${r.choice.stake} m.${more ? more : " The risk is lost: this question earns nothing."}`) + (won ? more : ""), won ? "good" : "warn"); return;
    }
    if (!prevBest) setHint(counted + (d === 0 ? `${liveStats(r) ? pctText(g.share) + " of players said" : "A common answer (" + estText(g.share) + " of players, estimated)"}: no distance. Can you go rarer?` : `+${d} m. You're down to ${at} m.`) + more, d >= 100 ? "good" : "");
    else if (deeper) { if (!special) Sound.play("deeper", { depth: Math.min(1, d / 260), m: d }); setHint(`${counted}+${d} m beats your +${depthOf(prevBest.share)} m: ${dv.gain} m further down, to ${at} m.${more}`, "good"); }
    else { Sound.play("neutral"); setHint(counted + (g.share === prevBest.share ? `+${d} m, level with your best. You stay at ${at} m.` : `+${d} m. Your +${depthOf(prevBest.share)} m still counts: you stay at ${at} m.`) + more); }
  }, 260 / SPEED);
  afterGuess(special, beneath);
  if (queued) { queued = false; if (r.guesses.length < GUESSES) setTimeout(submit, 0); }
}
// After any guess that used a slot: carry on, or wrap the question up once all three are used.
// The results follow the last answer as soon as it has landed and its annotation has drawn: a short beat for an
// ordinary answer, a little longer for a rare one and for one beneath the iceberg, so the find gets its moment.
// Enter (or a tap on the scene) moves on at once.
function afterGuess(special, beneath) {
  const r = cur();
  if (r.guesses.length < GUESSES) { $("#answer").focus({ preventScroll: true }); return; }
  clearTimeout(autoFinish); clockStop();
  autoFinish = setTimeout(() => { if (state && cur() === r && state.phase === "play") finishQuestion(); }, (beneath ? 1400 : special ? 800 : 380) / SPEED);
}

// Ask the review service about one unknown guess (only if one is configured). The guess already holds its slot.
async function reviewGuess(cat, r, g) {
  if (!BACKEND.verifyUrl) return;
  const verdicts = await requestReview(cat, [g.typed]);
  g.checking = false;
  const v = verdicts && verdicts.find(x => V.normalize(x.text || "") === V.normalize(g.typed));
  // The reviewer thinks it's a misspelling of a listed answer: never applied silently, the player is asked.
  if (v && v.status === "ok" && v.relationship === "spelling") {
    const row = cat.answers.find(a => V.normalize(a.a) === V.normalize(v.canonical));
    if (row && state && state.rounds.indexOf(r) === state.round && state.phase === "play") { askPendingCorrection(cat, r, g, row); save(); return; }
    v.status = "pending";
  }
  if (v && (v.status === "ok" || v.status === "invalid")) {
    // The reviewer's usual name for it may be any listed name of an answer (an alias or a regional spelling): then it
    // is that answer, with that answer's depth and counts, not a new and rarer one.
    let row = v.canonical ? cat.answers.find(a => a.a === V.normalize(v.canonical)) : null;
    if (!row && v.canonical && v.status === "ok") { const j = V.judge(v.canonical, prep(cat), { rows: new Map(), texts: new Set(), noCorrect: true }); if (j && j.status === "ok" && j.row && j.via !== "review") row = j.row; }
    if (row && r.guesses.some(x => x !== g && x.name === row.a)) { v.status = "invalid"; v.reason = `Same answer as ${display(row)}, already discovered`; row = null; }
    V.remember(prep(cat), g.typed, { status: v.status, row: row ? row.a : undefined, reason: v.reason });
    applyVerdict(cat, r, g, v.status, row, v.reason);
  }
  save();
  if (!state || state.rounds.indexOf(r) !== state.round || screen !== "play") return;
  if (state.phase === "done") { startQuestion(false); return; }
  if (g.status === "ok") { // approved: it takes its place on the iceberg as soon as the camera is free
    while (busy) await new Promise(res => setTimeout(res, 150));
    if (state && state.rounds.indexOf(r) === state.round && state.phase === "play" && g.bi == null) { await reveal(cat, r, g); return; }
    if (state && state.rounds.indexOf(r) === state.round && state.phase === "done") startQuestion(false);
    return;
  }
  renderSlots();
}
// A guess already sent for review comes back as a likely misspelling: "Did you mean X?" in the ice panel. Yes scores it
// as X; no leaves it waiting for a person. Nothing about X's rarity shows until the player says yes.
function askPendingCorrection(cat, r, g, row) {
  const ask = $("#q-ask"); if (!ask) return;
  ask.hidden = false; ask.textContent = "";
  const yes = el("button", "ask-yes", display(row)), no = el("button", "ask-no", "No, keep \u201c" + g.typed + "\u201d");
  yes.type = no.type = "button";
  yes.onclick = async () => { ask.hidden = true; applyVerdict(cat, r, g, "ok", row); save(); while (busy) await new Promise(res => setTimeout(res, 150)); if (state && cur() === r && g.bi == null && state.phase === "play") reveal(cat, r, g); else renderSlots(); };
  no.onclick = () => { ask.hidden = true; $("#answer").focus(); };
  ask.append(el("span", null, `\u201c${g.typed}\u201d \u2014 did you mean `), yes, el("span", null, "?"), no);
}
function applyVerdict(cat, r, g, status, row, reason) {
  if (status === "invalid") { g.status = "miss"; g.reason = reason || "Reviewed: doesn't count"; return; }
  if (row && r.guesses.some(x => x !== g && x.status === "ok" && x.name === row.a)) { g.status = "miss"; g.reason = `Same answer as ${display(row)}`; return; }
  g.status = "ok"; g.name = row ? row.a : null; g.via = "review";
  g.share = row ? shareOf(row) : REVIEWED_SHARE; g.rank = rankText(cat, r, g.share);
  g.note = row ? "" : "Approved by review. It sits in Midwater until enough players have given it.";
}
// Verdicts remembered on this device (from an earlier review) are applied to anything still pending.
function recheckPending() {
  if (!state) return;
  state.rounds.forEach((r, i) => r.guesses.filter(g => g.status === "pending").forEach(g => {
    const cat = CATS[i], j = V.judge(g.typed, prep(cat), null);
    if (j && j.status === "ok") applyVerdict(cat, r, g, "ok", j.row || null); else if (j && j.status === "invalid") applyVerdict(cat, r, g, "invalid", null, j.reason);
  }));
}

// On to the next question. Starts at once; a second press while it is under way does nothing.
let moving = false;
function nextQuestion() {
  if (!state || state.phase !== "done" || moving) return;
  state.round++; state.phase = "play"; save();
  if (state.round >= CATS.length) { finishDay(); return; }
  moving = true; Sound.play("click");
  startQuestion("surface").finally(() => { moving = false; });
}

// ---------- After the question: your dive, then everyone's answers ----------
function finishQuestion() {
  const cat = CATS[state.round], r = cur();
  clearTimeout(autoFinish);
  if (r.done) return;
  clockStop();
  if (!r.timeout && panel()) frost.dissolve();
  r.done = true; state.phase = "done"; save();
  const best = bestOf(r);
  if (!state.practice) live.record(state.day, state.round + 1, okGuesses(r).map(g => g.name).filter(Boolean), best ? best.name : null, scoreOf(r))
    .then(() => live.counts(state ? state.day : 0, state ? state.round + 1 : 0)).then(c => { if (c && state && cur() === r && state.phase === "done") { r.stats = c; renderDone(cat, r); } });
  $('[data-screen="play"]').classList.remove("playing"); $('[data-screen="play"]').classList.add("done");
  $("#done-panel").hidden = false; $("#done-panel").scrollTop = 0;
  renderDone(cat, r);
  Sound.play("round");
  // The panel slides in and the iceberg glides aside for it, ending on your deepest answer.
  if (best && berg.focused !== best.bi) { syncFrame(0); berg.focus(best.bi, { auto: true }); } else syncFrame(520);
}

// Real counts for a question, once enough real players have answered it (released only after you finish it).
const liveStats = r => !!(r && r.stats && r.stats.players >= BOARD_MIN_PLAYERS);
// The share as it may honestly be shown: real counts once enough players have answered, otherwise the reference estimate.
const shareFor = (r, s) => liveStats(r) ? pctText(s) : estText(s);
const ofPlayers = r => liveStats(r) ? "of players" : "of players (estimated)";
// "You and 3 others said this" / "Nobody else said this": real players only, never the sample.
function crowdLine(r, name) {
  if (!liveStats(r) || !name) return "";
  const others = Math.max(0, (r.stats.counts.get(name) || 1) - 1);
  return others === 0 ? "Nobody else said this" : `You and ${fmt(others)} other${others === 1 ? "" : "s"} said this`;
}
function boardFor(cat, r) {
  // Real counts are used once enough players have answered the question today; until then, the rarity table.
  const stats = r.stats, isLive = !!(stats && stats.players >= BOARD_MIN_PLAYERS), players = isLive ? stats.players : SAMPLE_PLAYERS;
  const seen = row => isLive ? (stats.counts.get(row.a) || 0) / stats.players : shareOf(row);
  const ranked = cat.answers.map(row => ({ row, share: seen(row) })).sort((a, b) => b.share - a.share || shareOf(b.row) - shareOf(a.row) || a.row.a.localeCompare(b.row.a));
  const mine = new Set(okGuesses(r).map(g => g.name).filter(Boolean));
  const countOf = x => isLive ? (stats.counts.get(x.row.a) || 0) : Math.max(1, Math.round(x.share * players));
  // Only answers enough players gave can be listed as "rarest". With sample data the list sticks to the hand-made
  // answers (plus anything you said), so it reads like a real day.
  // Some real words are accepted but never listed (row.h), so the boards stay fit for any audience.
  const shown = ranked.filter(x => !x.row.h || mine.has(x.row.a));
  const eligible = shown.filter(x => isLive ? (stats.counts.get(x.row.a) || 0) >= BOARD_MIN_COUNT : (!x.row.x || mine.has(x.row.a)));
  const item = x => ({ name: display(x.row), share: Math.max(x.share, 1e-6), count: countOf(x), me: mine.has(x.row.a) });
  return { isLive, players, common: shown.slice(0, 5).map(item), rare: eligible.slice(-5).reverse().map(item), top: shown.find(x => !mine.has(x.row.a)) };
}

function renderDone(cat, r) {
  const best = bestOf(r), board = boardFor(cat, r), left = GUESSES - r.guesses.length;
  $("#done-q").textContent = `Question ${state.round + 1} of ${CATS.length} · ${cat.prompt || cat.title}`;
  const at = diveBefore(state.round + 1), reg = Iceberg.regionOf(at);
  $("#best-lbl").textContent = best ? `Best answer · now ${fmt(at)} m down, ${reg.name}` : r.timeout && !r.guesses.length ? `Time ran out · still ${fmt(at)} m down` : `No distance this time · still ${fmt(at)} m down`;
  $("#best-name").textContent = best ? guessName(cat, best) : "Nothing counted";
  const bd = $("#best-depth"); bd.textContent = ""; bd.append("+" + scoreOf(r), el("small", null, "m"));
  // Your guesses, in the order you made them. Tapping one flies the camera to it.
  const sum = $("#sum"); sum.textContent = "";
  $("#sum-aside").textContent = r.timeout ? `time ran out${left ? ` · ${left} unused` : ""}` : okGuesses(r).length > 1 ? "tap one to compare" : left ? `${left} unused` : "";
  r.guesses.forEach((g, i) => {
    const li = el("li");
    if (g.status === "ok") {
      const d = depthOf(g.share), tier = tierOfDepth(d);
      li.className = "tier-" + tier.key + (g === best ? " best" : ""); li.dataset.bi = g.bi;
      const b = el("button", "sum-row"); b.type = "button";
      const n = el("span", "sum-n"); n.append(el("span", null, String(i + 1)));
      // An answer from a reference list that nobody had estimated: its rarity is a cautious first guess until players give it.
      const row = g.name && cat.answers.find(a => a.a === g.name), provisional = row && row.pv;
      const sub = el("span", "sum-sub"); sub.append(el("span", "zone", tier.name), el("span", null, provisional ? "rarity estimated from reference data, not yet measured" : `${shareFor(r, g.share)} ${ofPlayers(r)}`));
      const shown = g.raw || g.typed, typed = !g.aka && V.normalize(shown) !== V.normalize(guessName(cat, g));
      if (g.aka && row) sub.append(el("span", "aka", `Also known as ${display(row)}`));
      const crowd = crowdLine(r, g.name); if (crowd) sub.append(el("span", "crowd" + (crowd.startsWith("Nobody") ? " alone" : ""), crowd));
      if (g.note) sub.append(el("span", null, g.note)); else if (typed) sub.append(el("span", null, `you typed “${shown}”`));
      const dep = el("span", "sum-depth"); dep.textContent = `+${valueOf(r, g)} m`;
      b.append(n, el("span", "sum-name", guessName(cat, g)), dep, sub);
      b.onclick = () => berg.focus(g.bi);
      li.append(b);
    } else { li.className = "off" + (g.status === "pending" ? " wait" : ""); li.append(offRow(String(i + 1), g, g.status === "pending", () => renderDone(cat, r))); }
    sum.append(li);
  });
  // Answers that didn't count and didn't use a guess are listed too, so they can be disputed.
  r.rejects.filter(x => !r.guesses.some(g => g.status === "miss" && g.typed === x.text)).forEach(x => { const li = el("li", "off"); li.append(offRow("", x, false, () => renderDone(cat, r))); sum.append(li); });
  // Typed but never sent (a short form that needed the full name, a likely slip): shown, so nothing seems to vanish.
  (r.tried || []).forEach(x => { const li = el("li", "off tried"); li.append(offRow("", { typed: x.text, reason: x.outcome === "ambiguous" ? "Needed the full name" : x.outcome === "other list" ? "On another category's list, not sent" : "Typed but not sent" }, false, () => renderDone(cat, r))); sum.append(li); });
  if (!r.guesses.length && !r.rejects.length && !(r.tried || []).length) { const li = el("li"); li.append(el("p", "forgot", "No guesses this time.")); sum.append(li); }
  const forgot = $("#forgot"); forgot.textContent = ""; forgot.hidden = !board.top;
  if (board.top) forgot.append("The most common answer you didn't give: ", el("b", null, display(board.top.row)), ` (${board.isLive ? pctText(board.top.share) : estText(board.top.share) + ", estimated"}).`);
  const waiting = r.guesses.some(g => g.status === "pending");
  $("#review-note").textContent = !waiting ? "" : BACKEND.verifyUrl ? "Answers marked ? are being checked. If one is approved, its depth is added."
    : "Answers marked ? weren't on today's list. They're saved for review, and approved answers are recognised from then on.";

  // What was in the water on the way down.
  const seenEl = $("#seen"), seen = (r.seen || []).map(k => Wildlife && Wildlife.species().find(x => x.key === k)).filter(Boolean);
  seenEl.hidden = !seen.length; seenEl.textContent = "";
  if (seen.length) {
    // The rare ones first, then a few of the rest: a note, not a catalogue.
    const order = [...seen.filter(x => x.rare), ...seen.filter(x => !x.rare)], few = order.slice(0, 4), more = order.length - few.length;
    seenEl.append(el("b", null, "Seen on this dive: "));
    few.forEach((sp, i) => { seenEl.append(sp.rare ? el("i", null, sp.name.toLowerCase()) : sp.name.toLowerCase(), i < few.length - 1 ? ", " : ""); });
    seenEl.append(more > 0 ? ` and ${more} more.` : ".");
  }

  // Everyone's answers: only shown now, so they can't steer your guesses.
  // Until enough real players have answered this question, the figures are the question's estimated rarities: said so
  // plainly, with how many real players have answered so far, and no invented head-counts.
  const sofar = r.stats && r.stats.players ? r.stats.players : 0;
  $("#players").textContent = board.isLive ? `Actual answers · ${fmt(board.players)} players today` : `Estimated popularity${sofar ? ` · ${fmt(sofar)} real player${sofar === 1 ? "" : "s"} so far` : ""}`;
  $("#sample-note").hidden = board.isLive;
  $("#sample-text").textContent = `These are reference estimates of how popular each answer is, not counts of what real players said${sofar ? ` (only ${fmt(sofar)} real player${sofar === 1 ? " has" : "s have"} answered so far)` : ""}. Real counts replace them once ${BOARD_MIN_PLAYERS} players have answered. Today's depths stay as they were scored when you played.`;
  const min = Math.min(...[...board.common, ...board.rare].map(x => x.share), 0.001);
  const lo = Math.floor(Math.log10(min) - 0.001), hi = 0; // whole decades: ... 0.01%, 0.1%, 1%, 10%, 100%
  const pos = s => Math.max(0, Math.min(1, (Math.log10(s) - lo) / (hi - lo)));
  const bars = (list, target) => {
    target.textContent = "";
    list.forEach(x => {
      const li = el("li", x.me ? "me" : ""); if (x.me) li.title = "You gave this answer";
      const track = el("span", "track"), fill = el("i"); fill.style.width = `${Math.max(1.5, 100 * pos(x.share))}%`; track.append(fill);
      const val = el("span", "bar-val"); val.append(el("b", null, board.isLive ? pctText(x.share) : estText(x.share)), board.isLive ? ` · ${fmt(x.count)}` : "");
      val.title = board.isLive ? `${pctText(x.share)} of players (${fmt(x.count)} of ${fmt(board.players)})` : `estimated popularity: ${estText(x.share)} of players (a reference estimate, not a count of real answers)`;
      const name = el("span", "bar-name", x.name); name.title = x.name;
      li.append(name, track, val); target.append(li);
    });
  };
  bars(board.common, $("#common")); bars(board.rare, $("#rare"));
  const axis = $("#axis"); axis.textContent = "";
  for (let d = lo; d <= hi; d++) {
    const t = el("span", d === lo ? "first" : d === hi ? "last" : "", `${+(Math.pow(10, d + 2)).toFixed(Math.max(0, -d - 2))}%`);
    t.style.left = `${100 * (d - lo) / (hi - lo)}%`; axis.append(t);
  }
  const rules = $("#rules"); rules.textContent = ""; (cat.rules || []).forEach(t => rules.append(el("li", null, t)));
  $("#next").textContent = state.round + 1 < CATS.length ? "Next question" : `See your ${Brand.noun}`;
  updateHeader();
}
// A guess or answer that has no depth: waiting for review, or didn't count. Either can be disputed.
function offRow(number, g, waiting, rerender) {
  const row = el("div", "sum-row"), n = el("span", "sum-n"); n.innerHTML = waiting ? ICON.wait : ICON.no;
  const sub = el("span", "sum-sub"); sub.append(el("span", null, waiting ? (g.sent ? "Sent for review" : "Waiting for review · no depth yet") : `${g.reason || "Didn't count"}${number ? " · used a guess" : " · didn't use a guess"}`));
  const b = el("button", "dispute", g.sent ? "Sent" : waiting ? "I think this counts" : "Dispute"); b.type = "button"; b.disabled = !!g.sent;
  b.onclick = () => { g.sent = true; live.flag(state.day, state.round + 1, g.typed || g.text, waiting ? "pending-dispute" : "dispute"); save(); rerender(); };
  row.append(n, el("span", "sum-name", g.typed || g.text), b, sub);
  return row;
}

// ---------- Streaks, history and the account ----------
// A streak grows by one for each game day finished in a row. Miss a day and it starts again; the longest is kept.
// Signed-in players' streaks come from the database, which counts the dives themselves.
function streakNow() {
  const s = store.get("streak", { count: 0, last: 0 }), today = dayNumber();
  if (Account && Account.signedIn) {
    const st = Account.profile.stats; let count = st.streak_last_day >= today - 1 ? st.streak_raw : 0;      // alive until this player's own midnight
    if (s.last === today && st.streak_last_day < today) count = st.streak_last_day === today - 1 ? st.streak_raw + 1 : 1;   // just finished: the account is still catching up
    return { count, longest: Math.max(st.longest, count), played: st.dives };
  }
  return { count: s.last >= today - 1 ? s.count : 0, longest: Math.max(s.longest || 0, s.count || 0), played: s.played || 0 };
}
function bumpStreak(day) {
  const s = store.get("streak", { count: 0, last: 0 });
  if (s.last === day) return false;                        // already counted today: a refresh or a replay adds nothing
  const extended = s.last === day - 1 && s.count > 0;
  s.count = extended ? s.count + 1 : 1; s.last = day; s.played = (s.played || 0) + 1; s.longest = Math.max(s.longest || 0, s.count);
  delete s.freezes; store.set("streak", s);
  return extended;
}
// Which set of five questions a day uses, and its file.
let DAY_COUNT = 1; const setCache = new Map();
const setOf = day => day > STATIC_DAYS && BACKEND.url ? day : ((day - 1) % (LEGACY_DAYS || DAY_COUNT)) + 1;   // a prepared day is its own set
const loadSet = id => { if (!setCache.has(id)) setCache.set(id, dayContent(id).then(d => (d && d.questions) || [])); return setCache.get(id); };
// A day's five questions. The first few days (STATIC_DAYS: the ones already played when prepared content began) ship
// as files. Every later day is prepared in advance and kept off the public site: the database hands each one out only
// once that day has begun somewhere (day_content in supabase/0006_content.sql), and this device keeps a copy so a
// reload or a lost connection doesn't lose the day. With no database (tests, previews) the files are used in rotation.
let LEGACY_DAYS = 15, STATIC_DAYS = 15;
async function dayContent(n) {
  if (PLAYTEST) return fetch(`pt/${n}.json`).then(r => r.ok ? r.json() : null).catch(() => null);
  const fromFile = () => fetch(`days/${n}.json`).then(r => r.ok ? r.json() : null).catch(() => null);
  const online = !!(BACKEND.url && BACKEND.anonKey);
  if (n <= STATIC_DAYS || (!online && n <= LEGACY_DAYS)) return fromFile();
  const cached = store.get("content:" + n, null);
  if (cached && cached.questions) return cached;
  if (online) {
    // No prepared content for a day: the database falls back to an earlier day's set in rotation (private.day_set),
    // so the game loads that same day's questions, from wherever that day's questions come.
    const rotation = () => { const r = ((n - 1) % LEGACY_DAYS) + 1; return r === n ? fromFile() : dayContent(r); };
    try {
      const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 8000);
      const r = await fetch(`${BACKEND.url}/rest/v1/rpc/day_content`, { method: "POST", signal: ctl.signal,
        headers: { apikey: BACKEND.anonKey, Authorization: `Bearer ${BACKEND.anonKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ p_day: n }) });
      clearTimeout(timer);
      if (r.ok) {
        const d = await r.json();
        if (d && d.questions) { store.set("content:" + n, d); return d; }
        if (d === null) return rotation();
      } else if (r.status === 404) return rotation();   // no day_content function: a database from before 0006, which always rotates
    } catch { /* no answer: never guess a different set, which would be scored against the wrong table */ }
    if (n <= LEGACY_DAYS) return null;   // this day's file is the old bank, which the database may no longer be using for it
  }
  return fromFile();   // a local preview build may carry the files
}
const dateOf = day => new Date(LAUNCH[0], LAUNCH[1] - 1, LAUNCH[2] + day - 1);
// A finished day on this device, as the guesses the database scores: what was typed and what it counted as.
function guessesOf(game) {
  const out = [];
  // The database records only the encounters it knows (supabase/0002: giant, bigfin, colossal). The newer ones are
  // kept on this device until supabase/0009 widens that list; sending them would make the whole dive fail to save.
  const known = ["giant", "bigfin", "colossal"];
  game.rounds.forEach((r, i) => r.guesses.slice(0, GUESSES).forEach((g, j) => out.push({ round: i + 1, slot: j + 1, typed: String(g.typed || "").slice(0, 60), answer: g.status === "ok" ? g.name || null : null, status: g.status, sight: known.includes(g.sight) ? g.sight : null })));
  return out;
}
const finishedGame = day => { const g = store.get("game:" + day, null); return g && g.v === 3 && g.finished && !g.practice ? g : null; };
// Hand a finished day in to the player's account. Safe to call again: the database keeps one dive per day.
async function handIn(day) {
  const game = finishedGame(day);
  if (!game || !Account || !Account.signedIn) return null;
  try {
    const res = await Account.rpc("submit_dive", { p_day: day, p_guesses: guessesOf(game) });
    const rec = store.get("day:" + day, null); if (rec) { rec.owner = Account.profile.username; rec.server = { total: res.total, max_depth: res.max_depth, rank: res.rank, players: res.players }; store.set("day:" + day, rec); }
    await Account.refresh();
    if (screen === "end") { const n = streakNow().count; $("#e-streak").textContent = n ? `${n}-day streak` : ""; }
    return res;
  } catch (e) {
    if (e.code === "day_closed") return syncProgress();     // finished offline and the day has gone: it goes in as history
    return null;
  }
}
// After signing in: move this device's guest days into the account, and bring the account's today onto this device.
let syncing = null;
function syncProgress() {
  if (!Account || !Account.signedIn) return Promise.resolve();
  if (syncing) return syncing;
  syncing = (async () => {
    const me = Account.profile.username, today = dayNumber(), mine = [];
    for (let d = Math.max(1, today - 89); d <= today; d++) { const rec = store.get("day:" + d, null), game = finishedGame(d); if (rec && rec.v === 3 && game && (!rec.owner || rec.owner === me) && !rec.server) mine.push({ day: d, guesses: guessesOf(game) }); }
    try {
      if (mine.length) {
        const res = await Account.rpc("import_dives", { p_dives: mine });
        res.forEach(x => { const rec = store.get("day:" + x.day, null); if (rec && x.state !== "refused") { rec.owner = me; rec.server = rec.server || {}; store.set("day:" + x.day, rec); } });
      }
      // The account is the record. If it has a dive for today that this device doesn't, today is done here too.
      const dive = await Account.rpc("get_dive", { p_username: me, p_day: today }).catch(() => null);
      if (dive) adoptDive(dive);
      await Account.refresh();
    } catch { /* offline: try again next time */ }
    syncing = null;
    if (screen === "home") renderHome();
    else if (screen === "end" && window.Hub) window.Hub.endOfDay();
  })();
  return syncing;
}
// Rebuild today's local record from the account's dive (played on another device, or kept in place of a guest result).
function adoptDive(dive) {
  const day = dive.day, local = store.get("day:" + day, null);
  if (local && local.server && local.total === dive.total) return;
  if (day !== dayNumber() || !CATS.length) return;
  const rounds = CATS.map((c, i) => ({ key: c.key, misses: 0, rejects: [], done: true, left: 0, at: 0,
    guesses: dive.guesses.filter(g => g.round === i + 1).sort((a, b) => a.slot - b.slot).map(g => ({ status: g.status, typed: g.typed || g.answer || "", key: V.normalize(g.typed || g.answer || ""), name: g.status === "ok" ? g.answer : null, share: g.share, sight: g.sight || undefined })) }));
  const game = { v: 3, day, practice: false, round: CATS.length, phase: "done", finished: true, rounds };
  store.set("game:" + day, game);
  const keep = state; state = game; const rec = daySummary(); state = keep;
  rec.owner = Account.profile.username; rec.server = { total: dive.total, max_depth: dive.max_depth, rank: dive.rank, players: dive.players };
  store.set("day:" + day, rec);
  if (state && state.day === day && !state.practice) { state = null; renderHome(); }   // a game in progress here is over: the account already has today
}

// ---------- End of day ----------
function daySummary() {
  const rounds = state.rounds.map((r, i) => {
    const b = bestOf(r), d = scoreOf(r), kind = Rounds.kind(CATS[i]), c = r.choice;
    // tier: how rare the best answer itself was (its colour, the red for Unfathomable), whatever the round paid for it.
    const extra = { kind, risk: kind === "risk" && c ? (c.kind === "risk" ? (d > 0 ? "won" : "lost") : c.kind) : null, stake: c ? c.stake : null };
    return b ? { title: CATS[i].title, icon: CATS[i].icon, name: guessName(CATS[i], b), share: b.share, depth: d, tier: tierOfDepth(depthOf(b.share)).key, tierName: tierOfDepth(depthOf(b.share)).name, ...extra } : { title: CATS[i].title, icon: CATS[i].icon, name: null, depth: 0, ...extra };
  });
  return { v: 3, day: state.day, total: rounds.reduce((s, r) => s + r.depth, 0), rounds };
}
// ---------- The Deep Signal (community rollover, prototype: playtest only, mock state) ----------
// A community challenge on some days: find a verified answer rarer than a threshold. It is checked once, when the day
// closes, against everyone's final answers (so playing early or late makes no difference). If anyone finds one, the
// whole community unlocks something for the journal and finders get a mark; if nobody does, it rolls over and the
// prize grows, and after a few rollovers the threshold eases so it can't stay locked. No money, no entry, no wager,
// and it never touches depth or rankings. Here the state and the overnight check are simulated, and labelled so.
function signalHome() {
  let box = $("#home-signal"); const sg = DAYX && DAYX.signal;
  if (!sg || !PLAYTEST) { if (box) box.remove(); return; }
  if (!box) { box = el("p", "title-signal"); box.id = "home-signal"; $("#home-status").after(box); }
  box.textContent = ""; box.append(el("b", null, "The Deep Signal"), ` · not found for ${sg.rollovers} days, so the prize has grown · today: find a verified answer under ${Rounds.pct(sg.threshold)} of players. Checked when the day closes. `, el("i", null, "Prototype"));
}
function signalEnd(day) {
  const host = $("#e-seen"), sg = DAYX && DAYX.signal; const old = $("#e-signal"); if (old) old.remove();
  if (!sg || !PLAYTEST || !host) return;
  const box = el("div", "e-signal"); box.id = "e-signal";
  const cands = day.rounds.filter((r, i) => r.name && r.share <= sg.threshold && (() => { const row = CATS[i] && CATS[i].answers.find(a => display(a) === r.name || a.a === r.name); return !row || !row.pv; })());
  box.append(el("b", null, "The Deep Signal"), el("span", null, cands.length
    ? ` · you may have found it: ${cands.map(r => `${r.name} (${Rounds.pct(r.share)}, estimated)`).join(", ")}. It's checked tonight against everyone's final answers.`
    : ` · none of your answers were under ${Rounds.pct(sg.threshold)} this time. Someone else's might be.`));
  const sim = el("button", "btn ghost small", "Simulate tonight's check"); sim.type = "button";
  sim.onclick = () => {
    const found = cands.length > 0, out = el("p", "e-signal-out");
    out.textContent = found ? `Simulated: the signal was found. Unlocked: ${sg.unlock}. For you: ${sg.finder}.`
      : sg.rollovers + 1 >= sg.max ? `Simulated: not found. It has rolled over ${sg.max} times, so next time the threshold eases to ${Rounds.pct(sg.threshold * 2)}.`
      : `Simulated: not found. It rolls over (${sg.rollovers + 1} of ${sg.max}); the prize grows.`;
    sim.replaceWith(out);
  };
  box.append(sim, el("small", null, " Prototype: no real players are counted here.")); host.after(box);
}
function finishDay() {
  state.finished = true; save();
  const day = daySummary();
  if (!state.practice) {
    day.owner = Account && Account.signedIn ? Account.profile.username : ""; store.set("day:" + state.day, day);
    day.extended = bumpStreak(state.day);
    handIn(state.day);
    live.recordDay(state.day, day.total, day.rounds.map(r => r.depth));
  }
  renderEnd(day, true, state.practice);
}
function shareData(day, practice) {
  const streak = practice ? 0 : streakNow().count;
  const found = day.rounds.filter(r => r.name).sort((a, b) => b.depth - a.depth)[0];
  return { day: day.day, total: day.total, streak, sample: !live.on(),
    rounds: day.rounds.map(r => r.name ? { depth: r.depth, share: r.share, tier: r.tier, tierName: r.tierName, kind: r.kind, risk: r.risk } : (r.kind ? { depth: 0, none: true, kind: r.kind, risk: r.risk } : null)),
    deepest: found ? { depth: found.depth, tierName: found.tierName, name: found.name } : null };
}
function renderEnd(day, fresh, practice) {
  const data = shareData(day, practice);
  const list = $("#e-rounds"); list.textContent = "";
  day.rounds.forEach((r, i) => {
    const li = el("li", r.name ? "tier-" + r.tier : "");
    const ic = el("span", "cat-icon"); Icons.put(ic, r.icon);
    const main = el("div", "e-main"); main.append(el("span", "e-name", r.name || "No depth"));
    const cat = el("span", "e-cat"); cat.append(`${i + 1} · ${r.title}`); if (r.name) cat.append(" · ", el("b", null, r.tierName)); main.append(cat);
    if (r.name) main.firstChild.title = r.name;
    const depth = el("span", "e-depth"); depth.append("+" + r.depth, el("small", null, "m"));
    li.append(ic, main, depth); list.append(li);
  });
  // Where the dive ended (the running total), and separately the single rarest answer of the day.
  $("#e-deepest").textContent = ""; $("#e-deepest").append(el("b", null, Iceberg.regionOf(day.total).name), data.deepest ? " · rarest answer " : "");
  if (data.deepest) $("#e-deepest").append(el("b", null, `${data.deepest.name} (+${data.deepest.depth} m)`));
  $("#e-rank").textContent = "";
  if (!practice) live.ranking(day.day, day.total).then(rk => { if (rk && screen === "end") $("#e-rank").textContent = `Deeper than ${Math.round(100 * rk.below / rk.players)}% of ${fmt(rk.players)} players today`; });
  // A link back to the game, when it is hosted somewhere people can open.
  data.link = /^https:$/.test(location.protocol) && !/claude|anthropic|localhost/.test(location.hostname) ? location.host + (location.pathname === "/" ? "" : location.pathname) : "";
  $("#e-card").textContent = Share.text(data);
  $("#e-streak").textContent = data.streak ? `${data.streak}-day streak` : "";
  drawStreak(day.day, data.streak, fresh && day.extended);
  if (window.Hub) window.Hub.endOfDay(practice ? null : day);
  // The field journal: what today's answers reached, and what's new (journal.js). Animals only glimpsed don't count.
  const seenEl = $("#e-seen"); seenEl.textContent = "";
  if (window.Journal && !practice) {
    const got = Journal.today(day), fresh = got.filter(f => f.isNew);
    if (fresh.length) { seenEl.className = "e-found"; seenEl.append("New in your field journal: ", ...fresh.flatMap((f, i) => [i ? ", " : "", Object.assign(document.createElement("b"), { textContent: f.sp.name })])); }
    else if (got.length) seenEl.textContent = `Your answers reached ${got.length === 1 ? "one animal" : got.length + " animals"} today, all already in your field journal.`;
  }
  signalEnd(day);
  $("#e-note").textContent = practice ? "Practice dive: this doesn't change your daily result or streak." : `A new ${Brand.noun} surfaces tomorrow.`;
  Share.draw($("#share-canvas"), data); Share.draw($("#end-berg"), data, { only: true });
  state = null; show("end");
  // The total counts up once, as the day's little finale.
  const totalEl = $("#e-total");
  if (fresh) Sound.play("day");
  if (!fresh || SPEED > 1 || matchMedia("(prefers-reduced-motion: reduce)").matches) { totalEl.textContent = fmt(day.total); return; }
  const t0 = performance.now(), dur = 1100;
  const step = now => { const k = Math.min(1, (now - t0) / dur); totalEl.textContent = fmt(Math.round(day.total * (1 - Math.pow(1 - k, 3)))); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}

// The last seven days as a row of diamonds; today's lights up when it extends the streak.
function drawStreak(day, count, celebrate) {
  const box = $("#e-days"); box.textContent = ""; box.hidden = !count;
  if (!count) return;
  for (let d = day - 6; d <= day; d++) {
    const done = d >= 1 && (d > day - count || !!store.get("day:" + d, null));
    box.append(el("i", (done ? "on" : "") + (d === day ? " today" + (celebrate ? " pop" : "") : "")));
  }
  box.setAttribute("aria-label", `${count}-day streak`);
}

// ---------- Sound controls ----------
function wireSound() {
  const btn = $("#sound-btn"), panel = $("#sound-panel"), on = $("#snd-on"), sfx = $("#snd-sfx"), amb = $("#snd-amb");
  Sound.onChange(p => {
    on.checked = !p.muted; sfx.value = Math.round(p.sfx * 100); amb.value = Math.round(p.amb * 100);
    $("#snd-sfx-out").textContent = sfx.value + "%"; $("#snd-amb-out").textContent = amb.value + "%";
    sfx.disabled = amb.disabled = p.muted;
    btn.querySelectorAll(".wave").forEach(w => { w.style.display = p.muted ? "none" : ""; });
    btn.querySelector(".cross").hidden = !p.muted; btn.querySelector(".cross").style.display = p.muted ? "" : "none";
    btn.setAttribute("aria-label", p.muted ? "Sound is off. Sound settings" : "Sound settings");
  });
  const open = v => { panel.hidden = !v; btn.setAttribute("aria-expanded", String(v)); };
  btn.onclick = e => { e.stopPropagation(); open(panel.hidden); };
  panel.onclick = e => e.stopPropagation();
  document.addEventListener("click", () => open(false));
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && confirmFor && screen === "play") { e.preventDefault(); declineCorrection(); return; } if (e.key === "Escape") open(false); });
  on.onchange = () => { Sound.set({ muted: !on.checked }); if (on.checked) Sound.play("click"); };
  sfx.oninput = () => Sound.set({ sfx: sfx.value / 100 });
  sfx.onchange = () => Sound.play("submit");
  amb.oninput = () => Sound.set({ amb: amb.value / 100 });
  const fx = $("#fx-low"); fx.checked = store.get("fx", "full") === "low";
  fx.onchange = () => { store.set("fx", fx.checked ? "low" : "full"); if (life) life.setLow(fx.checked); };
  // Interface sounds: a soft click on buttons, a whisper on hover for the main ones (mouse only).
  document.addEventListener("click", e => { const b = e.target.closest("button"); if (b && b.id !== "add" && !b.classList.contains("dispute")) Sound.play("click"); }, true);
  document.addEventListener("pointerover", e => { if (e.pointerType !== "mouse" || !e.target.closest) return; const b = e.target.closest(".btn, button.slot, button.sum-row, .ib-nav button"); if (b && !b.contains(e.relatedTarget)) Sound.play("hover"); });
}

// ---------- Wiring ----------
function fitViewport() {
  // Keeps the question exactly as tall as the visible area, including when a phone keyboard is open.
  const vv = window.visualViewport, h = vv ? vv.height : innerHeight;
  document.documentElement.style.setProperty("--vvh", h + "px");
  if (screen === "play") { window.scrollTo(0, 0); syncFrame(0); }
}
async function saveCard() {
  const btn = $("#save-card"), canvas = $("#share-canvas"), name = `${Brand.slug}-${dayNumber()}.png`;
  try {
    const blob = await Share.blob(canvas), file = new File([blob], name, { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] }) && matchMedia("(pointer: coarse)").matches) { await navigator.share({ files: [file], text: $("#e-card").textContent }); return; }
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    btn.textContent = "Saved"; setTimeout(() => { btn.textContent = "Save image"; }, 2000);
  } catch { /* the share sheet was closed: nothing to do */ }
}
async function boot() {
  fitViewport();
  (window.visualViewport || window).addEventListener("resize", fitViewport);
  wireSound();
  // Today's five questions live in their own file: days/<n>.json. The calendar decides which one; when the bank
  // runs out it starts again from day 1. (Day 0 is a fixed set used by the automated tests.)
  try {
    const index = await (await fetch("days/index.json")).json();
    LEGACY_DAYS = index.count || 15; STATIC_DAYS = Math.min(LEGACY_DAYS, index.static || LEGACY_DAYS);
    // From day 16 on, each day has its own prepared questions; without them (no database here), the original bank repeats.
    const want = PARAMS.has("test") && PARAMS.has("day") ? +PARAMS.get("day") : dayNumber();
    // The common-word list only sharpens the typo check, so the game doesn't wait for it.
    fetch("words.json").then(r => r.json()).then(words => { if (words && words.commonWords) V.setCommonWords(words.commonWords); }).catch(() => {});
    // The larger dictionary only stops real words being "corrected"; it loads when the page is idle.
    (window.requestIdleCallback || (f => setTimeout(f, 1500)))(() => fetch("realwords.txt").then(r => r.ok ? r.text() : "").then(t => { if (t && V.setRealWords) V.setRealWords(t); }).catch(() => {}));
    let day = await dayContent(want);
    if (!day && !BACKEND.url) day = await dayContent(((want - 1) % LEGACY_DAYS) + 1);
    CATS = day.questions || []; DAY_COUNT = index.count || 1; DAYX = day;
    SAMPLE_PLAYERS = day.samplePlayers || index.samplePlayers || SAMPLE_PLAYERS;
  } catch { CATS = []; }
  if (!CATS.length) { $("#play").textContent = "Couldn't load today's questions"; $("#home-streak").textContent = "Check your connection, then refresh the page to try again."; show("home"); return; }
  { const b = $("#play"); b.disabled = false; b.classList.remove("busy"); b.removeAttribute("aria-busy"); }   // ready: Play works from here
  $("#howto-time").textContent = TIME_MS ? `You have ${TIME_MS / 1000} seconds a question. The clock only runs while you can type.` : "There's no clock: take your time.";
  if (PARAMS.has("reset")) { store.del("game:" + dayNumber()); store.del("game:practice"); store.del("day:" + dayNumber()); }

  $("#entry").onsubmit = e => { e.preventDefault(); submit(); };
  $("#add").onpointerdown = e => e.preventDefault(); // tapping the button never takes focus (or the phone keyboard) away
  $("#answer").oninput = () => {
    const v = V.normalize($("#answer").value);
    if (confirmFor && v !== confirmFor.key) { confirmFor = null; setHint(""); }
    if (keepTyped && v !== keepTyped) keepTyped = "";
    if (unknownKey && v !== unknownKey) { unknownKey = ""; setHint(""); }
  };
  $("#finish").onclick = () => { if (!busy) finishQuestion(); };
  $("#next").onclick = nextQuestion;
  $("#play").onclick = () => {
    const today = todayResult();
    // A practice dive (today's questions, not counted) is kept for testing and recordings only: ?practice in the address.
    if (today && PLAYTEST) { store.del("game:" + dayNumber()); store.del("day:" + dayNumber()); }   // playtest: always a fresh run
    else if (today && PARAMS.has("practice")) { newGame(true); Sound.unlock(); Sound.play("start"); startQuestion(true); return; }
    else if (today) { state = null; return renderEnd(today, false, false); }
    newGame(false); Sound.unlock(); Sound.play("start"); startQuestion(true);
  };
  for (const id of ["#race-btn", "#end-race"]) $(id).onclick = e => { e.preventDefault(); Sound.unlock(); location.hash = "#race"; };
  // The two modes.
  document.querySelectorAll("#modes .mode").forEach(b => b.onclick = () => {
    Sound.unlock();
    if (b.dataset.mode === "race") { if (screen !== "race") location.hash = "#race"; return; }
    if (screen === "race" || screen === "hub" || location.hash) { history.replaceState(null, "", location.pathname + location.search); if (window.Race) window.Race.close(); if (window.Viewer) window.Viewer.close(); }
    if (screen !== "play") renderHome();
  });
  addEventListener("resize", () => modes());
  // The menu: everything that isn't one of the two ways to play.
  const menu = $("#menu-panel"), menuBtn = $("#menu-btn");
  const closeMenu = () => { menu.hidden = true; menuBtn.setAttribute("aria-expanded", "false"); };
  menuBtn.onclick = e => { e.stopPropagation(); const open = menu.hidden; $("#sound-panel").hidden = true; menu.hidden = !open; menuBtn.setAttribute("aria-expanded", String(open));
    if (open) { const signedIn = Account && Account.signedIn; $("#menu-account span").textContent = signedIn ? "Profile" : "Sign in"; menu.querySelector("button").focus(); } };
  menu.addEventListener("click", e => { const b = e.target.closest("[data-go]"); if (!b) return; closeMenu();
    if (b.dataset.go === "howto") return openHowTo();
    if (!window.Hub) return;
    if (b.dataset.go === "account" && Account && Account.signedIn) { location.hash = "#u/" + encodeURIComponent(Account.profile.username); return; }
    window.Hub.open(b.dataset.go); });
  document.addEventListener("click", e => { if (!menu.hidden && !e.target.closest("#menu-panel, #menu-btn")) closeMenu(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !menu.hidden) { closeMenu(); menuBtn.focus(); } });
  $("#howto-btn").onclick = openHowTo;

  $("#home").onclick = renderHome;
  $("#brand").onclick = () => { if (screen === "race") { if (window.Race) window.Race.close(); history.replaceState(null, "", location.pathname + location.search); renderHome(); return; } if (screen === "hub" || screen === "dive") { if (window.Hub) window.Hub.leave(); return; } if (screen === "end" || screen === "home") renderHome(); };
  // The profile button opens your dive log; pressed again while you're on it, it takes you back. From any other page
  // (rankings, friends) it goes to the log rather than closing.
  $("#acct-btn").onclick = () => { if (!window.Hub) return; if (screen === "hub" && location.hash === "#log") window.Hub.leave(); else window.Hub.open("log"); };
  $("#save-card").onclick = saveCard;
  $("#copy").onclick = async () => {
    const text = $("#e-card").textContent;
    try { await navigator.clipboard.writeText(text); $("#copy").textContent = "Copied"; }
    catch { const range = document.createRange(); range.selectNodeContents($("#e-card")); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range); $("#copy").textContent = "Selected, copy it"; }
    setTimeout(() => { $("#copy").textContent = "Copy text"; }, 2000);
  };
  // Keys after a question: arrows step through your guesses, Enter moves on.
  // Skipping: during a long reveal, Enter, Space or Escape (or a tap on the water) brings it to its end quickly.
  const hurry = () => { if (berg && screen === "play" && state && busy) berg.hurry(); };
  $("#ib").addEventListener("pointerdown", e => { if (!e.target.closest("button")) hurry(); });
  // While a question is open the keyboard always belongs to the answer box: Enter sends what's typed wherever the
  // focus is (after a click on the water or the guesses, say), and typing a letter puts the focus back in the box.
  // Other fields, buttons and links keep their own keys.
  document.addEventListener("keydown", e => {
    if (screen !== "play" || !state || state.phase !== "play" || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const input = $("#answer"), t = e.target;
    if (t === input || (t.closest && t.closest("input, textarea, select, button, a, summary, [contenteditable], .pt-bar, .pt-panel"))) return;
    if (e.key === "Enter" && input.value.trim()) { e.preventDefault(); submit(); return; }
    if (e.key.length === 1 && e.key !== " " && !input.disabled) input.focus({ preventScroll: true });
  }, true);
  document.addEventListener("keydown", e => {
    if (screen === "play" && state && state.phase === "play" && busy && ["Enter", " ", "Escape"].includes(e.key) && !(e.key === " " && e.target.closest("input"))) { hurry(); if (e.key !== "Enter") e.preventDefault(); }
    if (screen === "play" && state && state.phase === "play" && e.key === "Enter" && !busy && cur().guesses.length >= GUESSES) { e.preventDefault(); finishQuestion(); return; }
    if (screen !== "play" || !state || state.phase !== "done" || e.target.closest("input, button, summary")) return;
    if (e.key === "ArrowDown") { e.preventDefault(); berg.step(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); berg.step(-1); }
    else if (e.key === "Enter") $("#next").click();
  });

  if (PARAMS.has("test")) {
    window.ICEBERG_TEST = {
      judge: (text, i) => { const j = V.judge(text, prep(CATS[i]), null); return j ? { status: j.status, answer: j.row ? j.row.a : null, via: j.via, reason: j.reason } : null; },
      shareOf: (name, i) => { const row = CATS[i].answers.find(a => a.a === name); return row ? row.s : null; },
      get cats() { return CATS; }, depthOf, get frost() { return frost; },
      summit: () => { const v = berg && berg.view, ib = $("#ib").getBoundingClientRect(); return v ? { x: ib.left + v.x0 + PEAK_AT.x * v.z, y: ib.top + v.y0 + PEAK_AT.y * v.z } : null; }, get clock() { return { on: clock.on, left: state ? timeLeft(cur()) : 0, total: TIME_MS, ice: clock.ice ? { length: clock.ice.length, fraction: clock.ice.fraction, melted: clock.ice.melted, drops: clock.ice.drops } : null }; }, get state() { return state; }, get screen() { return screen; }, get berg() { return berg; }, get busy() { return busy; }, get life() { return life; },
    };
  }
  // What the other screens (account, log, friends, rankings, the dive viewer) may use.
  window.Game = { LAUNCH, GUESSES, today: dayNumber, dateOf, setOf, loadSet, store, fmt, pctText, display, streak: streakNow, finishedGame, syncProgress, handIn,
    playtest: PLAYTEST, get cats() { return CATS; }, get round() { return state ? state.round : -1; },
    get screen() { return screen; }, get playing() { return !!state; }, show, home: renderHome, modes, backend: () => live.on(),
    days: () => { const out = []; for (let d = Math.max(1, dayNumber() - 380); d <= dayNumber(); d++) { const r = store.get("day:" + d, null); if (r && r.v === 3) out.push(r); } return out; },
    openEnd: () => { const t = todayResult(); if (t && cameFrom === "end") renderEnd(t, false, false); else renderHome(); } };
  if (Account) {
    Account.onChange(() => { if (window.Hub) window.Hub.changed(); if (Account.signedIn) syncProgress(); else if (screen === "home") renderHome(); });
    // With no database, the social screens can be previewed with invented, labelled players (demo.js). That preview is
    // only ever offered with ?demo in the address or inside a preview frame, never on the live game's own page.
    const demoOk = !live.on() && !!window.DemoBackend && (PARAMS.has("demo") || /claude|anthropic/.test(location.hostname) || window.self !== window.top);
    window.Game.demo = { offered: demoOk, on: demoOk && (PARAMS.has("demo") || store.get("demo-on", false)), set(v) { store.set("demo-on", !!v); location.hash = v ? "#friends" : ""; location.reload(); } };
    Account.init(window.Game.demo.on ? { demo: window.DemoBackend } : BACKEND).then(() => { if (window.Hub) { window.Hub.changed(); window.Hub.start(); } });
  }
  // Pick up where you left off: a game in progress is never reset by a reload.
  const saved = [store.get("game:" + dayNumber(), null), store.get("game:practice", null)].find(g => g && !g.finished);
  if (saved && saved.paths) applyPaths(saved.paths);
  if (saved && saved.v === 3 && saved.day === dayNumber() && saved.rounds && saved.rounds.length === CATS.length && saved.rounds.every((r, i) => r.key === CATS[i].key)) {
    state = saved; state.rounds.forEach(r => { r.guesses.forEach(g => { g.checking = false; delete g.bi; }); });
    recheckPending(); save();
    if (state.round >= CATS.length) { finishDay(); return; }
    startQuestion(false);
    return;
  }
  renderHome(); if (window.HomeArt) window.HomeArt.fit();
  // The submarine beside "Submarine Race" on the title screen: the race's own artwork, one craft, drawn once.
  if (window.SubArt) document.querySelectorAll("canvas.sub-art").forEach(c => { const g = c.getContext("2d"); g.clearRect(0, 0, c.width, c.height); SubArt.draw(g, 20, 13, SubArt.look(0), 0, { dir: 1 }); });
  // While the home screen is up and nothing else is happening, build the scene and work out the sound's raw
  // material, so pressing Play doesn't have to wait for either.
  idle(() => { if (screen === "home") ensureBerg(); });
  idle(() => Sound.prepare && Sound.prepare());
}
boot();
