// Iceberg: three guesses per question. How deep can you go?
// Five questions a day. Each guess is revealed on the iceberg at once: the fewer players who share it, the deeper
// it sits. Only the deepest answer of each question counts, and depth in metres is the score.
// Other pieces: validate.js (answer checking), audio.js (sound), sea.js (background), iceberg.js (artwork, depth scale,
// the explorable iceberg), share.js (share card), icons.js (category icons), categories.json (today's questions).

// ---------- Settings ----------
// Everything works with these left empty: statistics are then sample estimates and unknown answers stay "pending".
//   url + anonKey: a Supabase project (run supabase.sql) for real player counts, rankings and review requests.
//   verifyUrl: an endpoint that reviews unknown answers (see api/verify.js). Never put a secret key in this file.
const BACKEND = { url: "", anonKey: "", verifyUrl: "" };
const LAUNCH_DAY = Date.UTC(2026, 10, 23); // Daily #1
const GUESSES = 3;                // per question
const FREE_MISSES = 3;            // answers that don't count are free up to this many per question; after that each uses a guess
const IMAGINARY_PLAYERS = 200;    // early-estimate weight blended with real counts
const BOARD_MIN_COUNT = 5;        // a rare answer needs this many real players before it's listed (no one-off junk)
const RANK_MIN_PLAYERS = 30;      // a ranking is only shown once this many real players have finished the day
const REVIEWED_SHARE = 0.03;      // approved by review but not yet counted: sits in Midwater (52 m), never the maximum
const PARAMS = new URLSearchParams(location.search);
const SPEED = PARAMS.has("fast") ? 4 : 1;
if (PARAMS.get("verify")) BACKEND.verifyUrl = PARAMS.get("verify"); // for testing a review endpoint without editing this file
const { depthOf, tierOfDepth } = window.Iceberg;
const V = window.IcebergValidate, Sound = window.Sound, Sea = window.Sea || { mood() {} }, Icons = window.IcebergIcons, Share = window.IcebergShare;
let SAMPLE_PLAYERS = 50000;       // shown with sample statistics, clearly labelled as simulated (set from categories.json)

// ---------- Small helpers ----------
const $ = sel => document.querySelector(sel);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const store = {
  get(k, d) { try { const v = localStorage.getItem("iceberg:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("iceberg:" + k, JSON.stringify(v)); } catch { /* private mode: fine */ } },
  del(k) { try { localStorage.removeItem("iceberg:" + k); } catch { /* fine */ } },
};
const dayNumber = () => Math.floor((Date.now() - LAUNCH_DAY) / 86400000) + 1;
// Today's finished result, if there is one. Results saved by the earlier timed version of the game are ignored.
const todayResult = () => { const d = store.get("day:" + dayNumber(), null); return d && d.v === 3 ? d : null; };
const playerId = (() => { let id = store.get("pid", null); if (!id) { id = Math.random().toString(36).slice(2) + Date.now().toString(36); store.set("pid", id); } return id; })();
const fmt = n => n.toLocaleString("en-US");
const pctText = s => s >= 0.1 ? `${Math.round(s * 100)}%` : s >= 0.01 ? `${(s * 100).toFixed(1)}%` : s >= 0.001 ? `${(s * 100).toFixed(2)}%` : `${(s * 100).toFixed(3)}%`;
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
  // Share of unique players who gave each answer at least once.
  async counts(day, round) {
    if (!live.on()) return null;
    try {
      const q = `day=eq.${day}&round=eq.${round}`;
      const [players, answers] = await Promise.all([
        fetch(`${BACKEND.url}/rest/v1/round_players?${q}`, { headers: live.headers() }).then(r => r.json()),
        fetch(`${BACKEND.url}/rest/v1/answer_counts?${q}`, { headers: live.headers() }).then(r => r.json()),
      ]);
      return { players: players[0]?.n || 0, counts: new Map(answers.map(r => [r.answer, r.n])) };
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
    if (!live.on()) return;
    try { await live.post("flags", { day, round, player: playerId, text, kind }); } catch { /* ignore */ }
  },
};
// Review of unknown answers. Never blocks play: the guess is already placed as "pending" when this runs.
// Contract: POST verifyUrl { category, title, rules, answers: [text] } -> { results: [{ text, status: "ok"|"invalid", canonical?, reason? }] }
async function requestReview(cat, texts) {
  if (!BACKEND.verifyUrl || !texts.length) return null;
  try {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 8000);
    const res = await fetch(BACKEND.verifyUrl, { method: "POST", headers: { "Content-Type": "application/json" }, signal: ctl.signal,
      body: JSON.stringify({ category: cat.key, title: cat.prompt || cat.title, rules: cat.rules || [], answers: texts.slice(0, 6) }) });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data.results) ? data.results : null;
  } catch { return null; }
}
function shareOf(row, stats) {
  if (!stats || !stats.players) return row.s;
  const n = stats.counts.get(row.a) || 0;
  return (n + row.s * IMAGINARY_PLAYERS) / (stats.players + IMAGINARY_PLAYERS);
}

// ---------- State (saved after every change, so a reload never resets a question) ----------
let CATS = [], state = null, berg = null, screen = "home", busy = false, unknownKey = "", autoFinish = 0;
const prepared = new Map();
const prep = cat => { if (!prepared.has(cat.key)) prepared.set(cat.key, V.prepare(cat)); return prepared.get(cat.key); };
const saveKey = s => s.practice ? "game:practice" : "game:" + s.day;
const save = () => { if (state) store.set(saveKey(state), state); };
function newGame(practice) {
  state = { v: 3, day: dayNumber(), practice, round: 0, phase: "play", finished: false,
    rounds: CATS.map(c => ({ key: c.key, guesses: [], rejects: [], misses: 0, done: false })) };
  save();
}
const cur = () => state.rounds[state.round];
const okGuesses = r => r.guesses.filter(g => g.status === "ok");
// The deepest answer wins; equal shares keep the earlier guess.
const bestOf = r => okGuesses(r).reduce((b, g) => !b || g.share < b.share ? g : b, null);
const scoreOf = r => { const b = bestOf(r); return b ? depthOf(b.share) : 0; };
const totalSoFar = () => state ? state.rounds.reduce((s, r) => s + scoreOf(r), 0) : 0;
const guessName = (cat, g) => { const row = g.name && cat.answers.find(a => a.a === g.name); return row ? display(row) : g.typed; };

function show(id) {
  screen = id;
  for (const s of document.querySelectorAll("[data-screen]")) s.hidden = s.dataset.screen !== id;
  Sea.mood(id); Sound.setAmbience(id, 0);
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

// ---------- Home ----------
let nextTimer = 0;
function renderHome() {
  const streak = store.get("streak", { count: 0, last: 0, freezes: 0 });
  const today = todayResult();
  $("#home-streak").textContent = streak.count ? `${streak.count}-day streak${streak.freezes ? ` · ${streak.freezes} freeze${streak.freezes > 1 ? "s" : ""} saved` : ""}` : "";
  $("#play").textContent = today ? "See today's results" : "Play today's iceberg";
  $("#practice").hidden = !today;
  const tick = () => {
    if (!today) { $("#home-next").textContent = ""; return; }
    const left = 86400000 - ((Date.now() - LAUNCH_DAY) % 86400000), h = Math.floor(left / 3600000), m = Math.floor(left % 3600000 / 60000);
    $("#home-next").textContent = `Next iceberg in ${h}h ${String(m).padStart(2, "0")}m`;
  };
  clearInterval(nextTimer); tick(); nextTimer = setInterval(tick, 30000);
  state = null; $("main").classList.remove("fill"); show("home");
}

// ---------- A question ----------
function bergItem(cat, r, g, n) {
  const row = g.name ? cat.answers.find(a => a.a === g.name) : null, players = r.players || SAMPLE_PLAYERS;
  return { n, name: guessName(cat, g), share: g.share, shareText: pctText(g.share), blurb: row && row.b || "",
    countText: row ? `${fmt(Math.max(1, Math.round(g.share * players)))} of ${fmt(players)}` : "", rankText: g.rank || "" };
}
function ensureBerg() {
  if (berg) return;
  berg = window.Iceberg.create($("#ib"), { speed: SPEED });
  berg.onDepth(d => { if (screen === "play") Sound.setAmbience("play", d); });
  berg.onFocus(i => { document.querySelectorAll("#slots .slot, #sum li").forEach(n => n.classList.toggle("active", +n.dataset.bi === i)); });
}
function setHint(text, kind) { const h = $("#hint"); h.className = "hint" + (kind ? " " + kind : ""); h.textContent = text || ""; }

async function startQuestion(animated) {
  const cat = CATS[state.round], r = cur();
  ensureBerg(); prep(cat); // build the lookup now, so the first guess is judged instantly
  clearTimeout(autoFinish); busy = false; unknownKey = "";
  $("#q-num").textContent = `Question ${state.round + 1} of ${CATS.length}`;
  Icons.put($("#q-icon"), cat.icon);
  $("#q-title").textContent = cat.prompt || cat.title;
  $("#q-hint").textContent = cat.hint || "";
  setHint("");
  const done = state.phase === "done";
  $('[data-screen="play"]').classList.toggle("playing", !done);
  $("main").classList.toggle("fill", !done);
  $("#play-panel").style.display = done ? "none" : "grid"; $("#done-panel").hidden = !done;
  show("play");
  // Real counts for this question, if a database is connected. Depths are fixed from what's known when you guess.
  r.stats = null; live.counts(state.day, state.round + 1).then(s => { if (state && cur() === r) { r.stats = s; if (s && s.players) r.players = s.players; } });
  const shown = okGuesses(r);
  if (shown.length || done) { shown.forEach((g, i) => { g.bi = i; }); berg.restore(shown.map(g => bergItem(cat, r, g, r.guesses.indexOf(g) + 1))); tagBest(cat, r); }
  else berg.enter(animated && !matchMedia("(prefers-reduced-motion: reduce)").matches);
  if (done) { renderDone(cat, r); return; }
  renderSlots();
  const input = $("#answer"); input.value = "";
  if (animated) Sound.play("question");
  input.focus({ preventScroll: true });
  // A reload after the last guess landed but before the results appeared: carry on to the results.
  if (r.guesses.length >= GUESSES) finishQuestion();
}
function tagBest(cat, r) {
  const b = bestOf(r);
  okGuesses(r).forEach(g => berg.setTag(g.bi, g === b && okGuesses(r).length > 1 ? "Your deepest" : ""));
}

function renderSlots(revealing = -1, landed = -1) {
  const cat = CATS[state.round], r = cur(), best = bestOf(r), list = $("#slots");
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
      const sub = el("span", "slot-sub"); sub.append(pctText(g.share), el("span", "wide", " of players · "), el("b", null, tier.name));
      main.append(el("span", "slot-name", guessName(cat, g)), sub);
      depth.append(String(d), el("small", null, "m"));
      if (g === best && okGuesses(r).length > 1) b.append(el("span", "slot-tag", "Deepest"));
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
  fin.textContent = best ? `Finish with ${depthOf(best.share)} m` : "Finish this question";
  note.textContent = fin.hidden ? (r.guesses.length === 0 ? "3 guesses. Only your deepest counts." : "") : `${left} guess${left === 1 ? "" : "es"} unused`;
  updateHeader();
}

function rankText(cat, r, share) {
  // What part of all answers given were more common than this one.
  let above = 0, total = 0;
  for (const row of cat.answers) { const s = shareOf(row, r.stats); total += s; if (s > share) above += s; }
  if (above === 0) return "The most common answer";
  return `Rarer than ${Math.min(99, Math.floor(100 * above / (total || 1)))}% of answers given`;
}

// Everything a guess can turn out to be is decided here, in the browser, at once.
function submit() {
  if (!state || screen !== "play" || state.phase !== "play" || busy) return; // a guess is mid-reveal: ignore extra presses
  const input = $("#answer"), form = $("#entry"), cat = CATS[state.round], r = cur(), P = prep(cat);
  if (document.activeElement !== input) input.focus({ preventScroll: true });
  const text = input.value.trim();
  if (!text || r.guesses.length >= GUESSES) return;
  const given = { rows: new Map(), texts: new Set() };
  r.guesses.forEach(g => { if (g.name) given.rows.set(g.name, g); else given.texts.add(g.key); });
  const j = V.judge(text, P, given);
  if (!j) return;
  const shake = () => { form.classList.remove("shake"); void form.offsetWidth; form.classList.add("shake"); };

  if (j.status === "dup") { // free: nothing is used up
    const name = j.row ? display(j.row) : j.text, same = V.normalize(j.text) === V.normalize(name);
    setHint(same ? `You've already tried ${name}. No guess used.` : `${j.text} counts as ${name}, which you've already tried.`, "warn");
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
  if (j.status === "pending") {
    if (unknownKey !== j.key) { // first press: a chance to fix a typo before it costs anything
      unknownKey = j.key; Sound.play("pending"); input.select();
      setHint(j.suggest ? `Did you mean ${j.suggest.slice(0, -1).join(", ")} or ${j.suggest[j.suggest.length - 1]}? Fix it, or Enter again sends “${j.text}” for review.`
        : `“${j.text}” isn't on today's list. Enter again sends it for review and uses a guess.`, "warn");
      return;
    }
    unknownKey = "";
    const g = { status: "pending", typed: j.text, key: j.key, checking: !!BACKEND.verifyUrl };
    r.guesses.push(g); input.value = "";
    Sound.play(r.guesses.length === GUESSES ? "final" : "submit", { step: r.guesses.length - 1 });
    setHint(BACKEND.verifyUrl ? "Sent for checking. Its depth appears if it's approved." : "Saved for review. No depth until it's approved.");
    live.flag(state.day, state.round + 1, j.text, "pending");
    save(); renderSlots(); reviewGuess(cat, r, g); afterGuess(false);
    return;
  }
  // A recognised answer: place it, then go and find it.
  unknownKey = "";
  const share = j.row ? shareOf(j.row, r.stats) : REVIEWED_SHARE;
  const g = { status: "ok", typed: j.text, key: j.key, name: j.row ? j.row.a : null, share, via: j.via, rank: rankText(cat, r, share) };
  r.guesses.push(g); input.value = "";
  const name = guessName(cat, g);
  setHint(j.via === "typo" || (j.via !== "exact" && V.normalize(j.text) !== V.normalize(name)) ? `Counted as ${name}.` : "");
  Sound.play(r.guesses.length === GUESSES ? "final" : "submit", { step: r.guesses.length - 1 });
  save(); reveal(cat, r, g);
}

async function reveal(cat, r, g) {
  busy = true;
  const index = r.guesses.indexOf(g), before = okGuesses(r).filter(x => x !== g && x.bi != null), prevBest = before.reduce((b, x) => !b || x.share < b.share ? x : b, null);
  const d = depthOf(g.share), deeper = !prevBest || g.share < prevBest.share, special = d >= 200 && deeper;
  g.bi = berg.count;
  renderSlots(index);
  berg.onTravel((it, dir, ms) => { Sound.play("travel", { dir, seconds: ms / 1000 }); if (special) Sound.play("rare", { lead: ms / 1000 }); });
  await berg.add(bergItem(cat, r, g, index + 1), { special });
  if (!state || cur() !== r) return;
  busy = false;
  // Landed: say what was found, and whether it beat your deepest.
  renderSlots(-1, index); tagBest(cat, r);
  if (!special) Sound.play("reveal", { depth: Math.min(1, d / 260) });
  const left = GUESSES - r.guesses.length, more = left ? ` ${plural(left, "guess")} left.` : "";
  const counted = $("#hint").textContent.startsWith("Counted as") ? $("#hint").textContent + " " : "";
  setTimeout(() => {
    if (!state || cur() !== r || state.phase !== "play") return;
    if (!prevBest) setHint(counted + (d === 0 ? `On the tip: ${pctText(g.share)} of players said this. Can you go rarer?` : `${d} m down. Can you go deeper?`) + more, d >= 100 ? "good" : "");
    else if (deeper) { if (!special) Sound.play("deeper", { depth: Math.min(1, d / 260) }); setHint(`${counted}New deepest: ${d} m, ${d - depthOf(prevBest.share)} m further down.${more}`, "good"); }
    else { Sound.play("neutral"); setHint(counted + (g.share === prevBest.share ? `Level with your deepest (${depthOf(prevBest.share)} m).` : `Not deeper. Your ${depthOf(prevBest.share)} m still counts.`) + more); }
  }, 260 / SPEED);
  afterGuess(special);
}
// After any guess that used a slot: carry on, or wrap the question up once all three are used.
function afterGuess(special) {
  const r = cur();
  if (r.guesses.length < GUESSES) { $("#answer").focus({ preventScroll: true }); return; }
  clearTimeout(autoFinish);
  autoFinish = setTimeout(() => { if (state && cur() === r && state.phase === "play") finishQuestion(); }, (special ? 3000 : 1900) / SPEED);
}

// Ask the review service about one unknown guess (only if one is configured). The guess already holds its slot.
async function reviewGuess(cat, r, g) {
  if (!BACKEND.verifyUrl) return;
  const verdicts = await requestReview(cat, [g.typed]);
  g.checking = false;
  const v = verdicts && verdicts.find(x => V.normalize(x.text || "") === V.normalize(g.typed));
  if (v && (v.status === "ok" || v.status === "invalid")) {
    const row = v.canonical ? cat.answers.find(a => a.a === V.normalize(v.canonical)) : null;
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
function applyVerdict(cat, r, g, status, row, reason) {
  if (status === "invalid") { g.status = "miss"; g.reason = reason || "Reviewed: doesn't count"; return; }
  if (row && r.guesses.some(x => x !== g && x.status === "ok" && x.name === row.a)) { g.status = "miss"; g.reason = `Same answer as ${display(row)}`; return; }
  g.status = "ok"; g.name = row ? row.a : null; g.via = "review";
  g.share = row ? shareOf(row, r.stats) : REVIEWED_SHARE; g.rank = rankText(cat, r, g.share);
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

// ---------- After the question: your dive, then everyone's answers ----------
function finishQuestion() {
  const cat = CATS[state.round], r = cur();
  clearTimeout(autoFinish);
  if (r.done) return;
  r.done = true; state.phase = "done"; save();
  const best = bestOf(r);
  if (!state.practice) live.record(state.day, state.round + 1, okGuesses(r).map(g => g.name).filter(Boolean), best ? best.name : null, scoreOf(r));
  $('[data-screen="play"]').classList.remove("playing"); $("main").classList.remove("fill");
  $("#play-panel").style.display = "none"; $("#done-panel").hidden = false;
  renderDone(cat, r);
  Sound.play("round");
  if (best && berg.focused !== best.bi) berg.focus(best.bi);
  window.scrollTo(0, 0);
}

function boardFor(cat, r) {
  const stats = r.stats, isLive = !!(stats && stats.players), players = isLive ? stats.players : SAMPLE_PLAYERS;
  const ranked = cat.answers.map(row => ({ row, share: shareOf(row, stats) })).sort((a, b) => b.share - a.share || a.row.a.localeCompare(b.row.a));
  const mine = new Set(okGuesses(r).map(g => g.name).filter(Boolean));
  const countOf = x => isLive ? (stats.counts.get(x.row.a) || 0) : Math.max(1, Math.round(x.share * players));
  // Only answers enough players gave can be listed as "rarest". With sample data the list sticks to the hand-made
  // answers (plus anything you said), so it reads like a real day.
  const eligible = ranked.filter(x => isLive ? (stats.counts.get(x.row.a) || 0) >= BOARD_MIN_COUNT : (!x.row.x || mine.has(x.row.a)));
  const item = x => ({ name: display(x.row), share: x.share, count: countOf(x), me: mine.has(x.row.a) });
  return { isLive, players, common: ranked.slice(0, 5).map(item), rare: eligible.slice(-5).reverse().map(item), top: ranked.find(x => !mine.has(x.row.a)) };
}

function renderDone(cat, r) {
  const best = bestOf(r), board = boardFor(cat, r), left = GUESSES - r.guesses.length;
  $("#best-lbl").textContent = best ? "Your deepest" : "No depth this time";
  $("#best-name").textContent = best ? guessName(cat, best) : "Nothing counted";
  const bd = $("#best-depth"); bd.textContent = ""; bd.append(String(scoreOf(r)), el("small", null, "m"));
  // Your guesses, in the order you made them. Tapping one flies the camera to it.
  const sum = $("#sum"); sum.textContent = "";
  $("#sum-aside").textContent = okGuesses(r).length > 1 ? "tap one to compare" : left ? `${left} unused` : "";
  r.guesses.forEach((g, i) => {
    const li = el("li");
    if (g.status === "ok") {
      const d = depthOf(g.share), tier = tierOfDepth(d);
      li.className = "tier-" + tier.key + (g === best ? " best" : ""); li.dataset.bi = g.bi;
      const b = el("button", "sum-row"); b.type = "button";
      const n = el("span", "sum-n"); n.append(el("span", null, String(i + 1)));
      const sub = el("span", "sum-sub"); sub.append(el("span", "zone", tier.name), el("span", null, `${pctText(g.share)} of players`));
      const typed = V.normalize(g.typed) !== V.normalize(guessName(cat, g));
      if (g.note) sub.append(el("span", null, g.note)); else if (typed) sub.append(el("span", null, `you typed “${g.typed}”`));
      const dep = el("span", "sum-depth"); dep.textContent = `${d} m`;
      b.append(n, el("span", "sum-name", guessName(cat, g)), dep, sub);
      b.onclick = () => berg.focus(g.bi);
      li.append(b);
    } else { li.className = "off" + (g.status === "pending" ? " wait" : ""); li.append(offRow(String(i + 1), g, g.status === "pending", () => renderDone(cat, r))); }
    sum.append(li);
  });
  // Answers that didn't count and didn't use a guess are listed too, so they can be disputed.
  r.rejects.filter(x => !r.guesses.some(g => g.status === "miss" && g.typed === x.text)).forEach(x => { const li = el("li", "off"); li.append(offRow("", x, false, () => renderDone(cat, r))); sum.append(li); });
  if (!r.guesses.length && !r.rejects.length) { const li = el("li"); li.append(el("p", "forgot", "No guesses this time.")); sum.append(li); }
  const forgot = $("#forgot"); forgot.textContent = ""; forgot.hidden = !board.top;
  if (board.top) forgot.append("The most common answer you didn't give: ", el("b", null, display(board.top.row)), ` (${pctText(board.top.share)}).`);
  const waiting = r.guesses.some(g => g.status === "pending");
  $("#review-note").textContent = !waiting ? "" : BACKEND.verifyUrl ? "Answers marked ? are being checked. If one is approved, its depth is added."
    : "Answers marked ? weren't on today's list. They're saved for review, and approved answers are recognised from then on.";

  // Everyone's answers: only shown now, so they can't steer your guesses.
  $("#players").textContent = board.isLive ? `${fmt(board.players)} players today` : `Sample data · ${fmt(board.players)} simulated players`;
  $("#sample-note").hidden = board.isLive;
  $("#sample-text").textContent = `These figures come from ${fmt(board.players)} simulated players, for testing. Real counts replace them once the game's database is connected.`;
  const min = Math.min(...[...board.common, ...board.rare].map(x => x.share), 0.001);
  const lo = Math.floor(Math.log10(min) - 0.001), hi = 0; // whole decades: ... 0.01%, 0.1%, 1%, 10%, 100%
  const pos = s => Math.max(0, Math.min(1, (Math.log10(s) - lo) / (hi - lo)));
  const bars = (list, target) => {
    target.textContent = "";
    list.forEach(x => {
      const li = el("li", x.me ? "me" : ""); if (x.me) li.title = "You gave this answer";
      const track = el("span", "track"), fill = el("i"); fill.style.width = `${Math.max(1.5, 100 * pos(x.share))}%`; track.append(fill);
      const val = el("span", "bar-val"); val.append(el("b", null, pctText(x.share)), ` · ${fmt(x.count)}`);
      val.title = `${pctText(x.share)} of players (${fmt(x.count)} of ${fmt(board.players)})`;
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
  $("#next").textContent = state.round + 1 < CATS.length ? "Next question" : "See your iceberg";
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

// ---------- End of day ----------
function daySummary() {
  const rounds = state.rounds.map((r, i) => {
    const b = bestOf(r), d = scoreOf(r);
    return b ? { title: CATS[i].title, icon: CATS[i].icon, name: guessName(CATS[i], b), share: b.share, depth: d, tier: tierOfDepth(d).key, tierName: tierOfDepth(d).name } : { title: CATS[i].title, icon: CATS[i].icon, name: null, depth: 0 };
  });
  return { v: 3, day: state.day, total: rounds.reduce((s, r) => s + r.depth, 0), rounds };
}
function finishDay() {
  state.finished = true; save();
  const day = daySummary();
  if (!state.practice) {
    store.set("day:" + state.day, day);
    const s = store.get("streak", { count: 0, last: 0, freezes: 0 });
    if (s.last !== state.day) {
      const gap = state.day - s.last;
      if (s.last && gap === 2 && s.freezes > 0) { s.freezes--; s.count += 1; }
      else if (!s.last || gap !== 1) s.count = 0;
      s.count += 1; s.last = state.day; s.played = (s.played || 0) + 1;
      if (s.played % 7 === 0) s.freezes = Math.min(2, s.freezes + 1);
      store.set("streak", s);
    }
    live.recordDay(state.day, day.total, day.rounds.map(r => r.depth));
  }
  renderEnd(day, true, state.practice);
}
function shareData(day, practice) {
  const streak = practice ? 0 : store.get("streak", { count: 0 }).count;
  const found = day.rounds.filter(r => r.name).sort((a, b) => b.depth - a.depth)[0];
  return { day: day.day, total: day.total, streak, sample: !live.on(),
    rounds: day.rounds.map(r => r.name ? { depth: r.depth, share: r.share, tier: r.tier, tierName: r.tierName } : null),
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
    const depth = el("span", "e-depth"); depth.append(String(r.depth), el("small", null, "m"));
    li.append(ic, main, depth); list.append(li);
  });
  $("#e-deepest").textContent = ""; if (data.deepest) $("#e-deepest").append("Deepest find: ", el("b", null, `${data.deepest.name} · ${data.deepest.depth} m`));
  $("#e-rank").textContent = "";
  if (!practice) live.ranking(day.day, day.total).then(rk => { if (rk && screen === "end") $("#e-rank").textContent = `Deeper than ${Math.round(100 * rk.below / rk.players)}% of ${fmt(rk.players)} players today`; });
  $("#e-card").textContent = Share.text(data);
  $("#e-streak").textContent = data.streak ? `${data.streak}-day streak` : "";
  $("#e-note").textContent = practice ? "Practice dive: this doesn't change your daily result or streak." : "A new iceberg surfaces tomorrow.";
  Share.draw($("#share-canvas"), data);
  state = null; $("main").classList.remove("fill"); show("end");
  // The total counts up once, as the day's little finale.
  const totalEl = $("#e-total");
  if (fresh) Sound.play("day");
  if (!fresh || SPEED > 1 || matchMedia("(prefers-reduced-motion: reduce)").matches) { totalEl.textContent = fmt(day.total); return; }
  const t0 = performance.now(), dur = 1100;
  const step = now => { const k = Math.min(1, (now - t0) / dur); totalEl.textContent = fmt(Math.round(day.total * (1 - Math.pow(1 - k, 3)))); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
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
  document.addEventListener("keydown", e => { if (e.key === "Escape") open(false); });
  on.onchange = () => { Sound.set({ muted: !on.checked }); if (on.checked) Sound.play("click"); };
  sfx.oninput = () => Sound.set({ sfx: sfx.value / 100 });
  sfx.onchange = () => Sound.play("submit");
  amb.oninput = () => Sound.set({ amb: amb.value / 100 });
  // Interface sounds: a soft click on buttons, a whisper on hover for the main ones (mouse only).
  document.addEventListener("click", e => { const b = e.target.closest("button"); if (b && b.id !== "add" && !b.classList.contains("dispute")) Sound.play("click"); }, true);
  document.addEventListener("pointerover", e => { if (e.pointerType !== "mouse" || !e.target.closest) return; const b = e.target.closest(".btn, button.slot, button.sum-row, .ib-nav button"); if (b && !b.contains(e.relatedTarget)) Sound.play("hover"); });
}

// ---------- Wiring ----------
function fitViewport() {
  // Keeps the question exactly as tall as the visible area, including when a phone keyboard is open.
  const vv = window.visualViewport, h = vv ? vv.height : innerHeight;
  document.documentElement.style.setProperty("--vvh", h + "px");
  if (screen === "play" && state && state.phase === "play" && matchMedia("(max-width: 920px)").matches) window.scrollTo(0, 0);
}
async function saveCard() {
  const btn = $("#save-card"), canvas = $("#share-canvas"), name = `iceberg-${dayNumber()}.png`;
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
  let data = null;
  try { data = await (await fetch("categories.json")).json(); } catch { data = window.ICEBERG_CATEGORIES || null; }
  CATS = data ? (Array.isArray(data) ? data : data.categories || []) : [];
  if (data && data.commonWords) V.setCommonWords(data.commonWords);
  if (data && data.samplePlayers) SAMPLE_PLAYERS = data.samplePlayers;
  if (!CATS.length) { $("#home-streak").textContent = "Couldn't load today's questions. Refresh to try again."; show("home"); return; }
  if (PARAMS.has("reset")) { store.del("game:" + dayNumber()); store.del("game:practice"); store.del("day:" + dayNumber()); }

  $("#entry").onsubmit = e => { e.preventDefault(); submit(); };
  $("#add").onpointerdown = e => e.preventDefault(); // tapping the button never takes focus (or the phone keyboard) away
  $("#answer").oninput = () => { if (unknownKey && V.normalize($("#answer").value) !== unknownKey) { unknownKey = ""; setHint(""); } };
  $("#finish").onclick = () => { if (!busy) finishQuestion(); };
  $("#next").onclick = () => { if (!state) return; state.round++; state.phase = "play"; save(); if (state.round < CATS.length) startQuestion(true); else finishDay(); };
  $("#play").onclick = () => {
    const today = todayResult();
    if (today) { state = null; return renderEnd(today, false, false); }
    newGame(false); Sound.unlock(); Sound.play("start"); startQuestion(true);
  };
  $("#practice").onclick = () => { newGame(true); Sound.play("start"); startQuestion(true); };
  $("#home").onclick = renderHome;
  $("#brand").onclick = () => { if (screen === "end" || screen === "home") renderHome(); };
  $("#save-card").onclick = saveCard;
  $("#copy").onclick = async () => {
    const text = $("#e-card").textContent;
    try { await navigator.clipboard.writeText(text); $("#copy").textContent = "Copied"; }
    catch { const range = document.createRange(); range.selectNodeContents($("#e-card")); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range); $("#copy").textContent = "Selected, copy it"; }
    setTimeout(() => { $("#copy").textContent = "Copy text"; }, 2000);
  };
  // Keys after a question: arrows step through your guesses, Enter moves on.
  document.addEventListener("keydown", e => {
    if (screen !== "play" || !state || state.phase !== "done" || e.target.closest("input, button, summary")) return;
    if (e.key === "ArrowDown") { e.preventDefault(); berg.step(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); berg.step(-1); }
    else if (e.key === "Enter") $("#next").click();
  });

  if (PARAMS.has("test")) {
    window.ICEBERG_TEST = {
      judge: (text, i) => { const j = V.judge(text, prep(CATS[i]), null); return j ? { status: j.status, answer: j.row ? j.row.a : null, via: j.via, reason: j.reason } : null; },
      shareOf: (name, i) => { const row = CATS[i].answers.find(a => a.a === name); return row ? row.s : null; },
      depthOf, get state() { return state; }, get screen() { return screen; }, get berg() { return berg; }, get busy() { return busy; },
    };
  }
  // Pick up where you left off: a game in progress is never reset by a reload.
  const saved = [store.get("game:" + dayNumber(), null), store.get("game:practice", null)].find(g => g && !g.finished);
  if (saved && saved.v === 3 && saved.day === dayNumber() && saved.rounds && saved.rounds.length === CATS.length) {
    state = saved; state.rounds.forEach(r => { r.guesses.forEach(g => { g.checking = false; delete g.bi; }); });
    recheckPending(); save();
    if (state.round >= CATS.length) { finishDay(); return; }
    startQuestion(false);
    return;
  }
  renderHome();
}
boot();
