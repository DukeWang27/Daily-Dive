// Iceberg: five 20-second rounds. Name as many as you can; the rarer your answer, the deeper it sinks.
// This file is the game flow. Other pieces: validate.js (answer checking), audio.js (sound), sea.js (background),
// iceberg.js (artwork, camera, reveal), icons.js (category icons), categories.json (today's categories).

// ---------- Settings ----------
// Everything works with these left empty: statistics are then sample estimates and unknown answers stay "pending".
//   url + anonKey: a Supabase project (run supabase.sql) for real player counts and dispute reports.
//   verifyUrl: an endpoint that reviews unknown answers (see api/verify.js). Never put a secret key in this file.
const BACKEND = { url: "", anonKey: "", verifyUrl: "" };
const LAUNCH_DAY = Date.UTC(2026, 10, 23); // Daily #1
const PREVIEW_SECONDS = 3;
const IMAGINARY_PLAYERS = 200;   // early-estimate weight blended with real counts
const BOARD_MIN_COUNT = 5;       // a rare answer needs this many real players before it's listed (no one-off junk)
const SAMPLE_PLAYERS = 2400;     // shown with sample statistics, clearly labelled as simulated
const REVIEWED_SHARE = 0.03;     // an answer approved by review but not yet counted scores as Midwater, never the maximum
const PARAMS = new URLSearchParams(location.search);
const SPEED = PARAMS.has("fast") ? 5 : 1;
if (PARAMS.get("verify")) BACKEND.verifyUrl = PARAMS.get("verify"); // for testing a review endpoint without editing this file
const { TIERS, tierFor, depthY, metres } = window.Iceberg;
const V = window.IcebergValidate, Sound = window.Sound, Sea = window.Sea || { mood() {}, urgency() {} }, Icons = window.IcebergIcons;
const TIER_EMOJI = { tip: "⬜", shallows: "🟦", mid: "🔷", deep: "🟪", abyss: "⬛" };

// ---------- Small helpers ----------
const $ = sel => document.querySelector(sel);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const store = {
  get(k, d) { try { const v = localStorage.getItem("iceberg-timed:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("iceberg-timed:" + k, JSON.stringify(v)); } catch { /* private mode: fine */ } },
};
const dayNumber = () => Math.floor((Date.now() - LAUNCH_DAY) / 86400000) + 1;
const playerId = (() => { let id = store.get("pid", null); if (!id) { id = Math.random().toString(36).slice(2) + Date.now().toString(36); store.set("pid", id); } return id; })();
const fmt = n => n.toLocaleString("en-US");
const shareText = s => s >= 0.05 ? `${Math.round(s * 100)}%` : `1 in ${fmt(Math.max(2, Math.round(1 / Math.max(s, 1e-5))))}`;
const pctText = s => s >= 0.1 ? `${Math.round(s * 100)}%` : s >= 0.01 ? `${(s * 100).toFixed(1)}%` : `${(s * 100).toFixed(2)}%`;
const display = row => row.d || row.a;
const MARK = {
  ok: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="m2.5 6.2 2.2 2.2 4.8-4.9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  no: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="m3.5 3.5 5 5m0-5-5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  maybe: "?",
};
const STATUS_LABEL = { ok: "Counted", maybe: "Checking later", no: "Doesn't count" };

// ---------- Live counts (optional) ----------
const live = {
  on: () => !!(BACKEND.url && BACKEND.anonKey),
  headers: () => ({ apikey: BACKEND.anonKey, Authorization: `Bearer ${BACKEND.anonKey}`, "Content-Type": "application/json" }),
  async record(day, round, answers, excluded) {
    if (!live.on()) return;
    try { await fetch(`${BACKEND.url}/rest/v1/round_plays`, { method: "POST", headers: { ...live.headers(), Prefer: "return=minimal" }, body: JSON.stringify({ day, round, player: playerId, answers, excluded }) }); } catch { /* offline: sample stats still work */ }
  },
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
  // A dispute ("I think this counts") or an unknown answer waiting for review. Kept locally too, so nothing is lost offline.
  async flag(day, round, text, kind) {
    const log = store.get("flags", []); log.push({ day, round, text, kind, at: Date.now() }); store.set("flags", log.slice(-200));
    if (!live.on()) return;
    try { await fetch(`${BACKEND.url}/rest/v1/flags`, { method: "POST", headers: { ...live.headers(), Prefer: "return=minimal" }, body: JSON.stringify({ day, round, player: playerId, text, kind }) }); } catch { /* ignore */ }
  },
};
// Review of unknown answers. Never blocks typing: it runs after the round, and the game is complete without it.
// Contract: POST verifyUrl { category, title, rules, answers: [text] } -> { results: [{ text, status: "ok"|"invalid", canonical?, reason? }] }
async function requestReview(cat, texts) {
  if (!BACKEND.verifyUrl || !texts.length) return null;
  try {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 8000);
    const res = await fetch(BACKEND.verifyUrl, { method: "POST", headers: { "Content-Type": "application/json" }, signal: ctl.signal,
      body: JSON.stringify({ category: cat.key, title: cat.title, rules: cat.rules || [], answers: texts.slice(0, 20) }) });
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

// ---------- State ----------
let CATS = [], state = null, berg = null, screen = "home";
const prepared = new Map();
const prep = cat => { if (!prepared.has(cat.key)) prepared.set(cat.key, V.prepare(cat)); return prepared.get(cat.key); };
const roundSeconds = () => store.get("longTimer", false) ? 30 : 20;
function newGame(practice) {
  state = { day: dayNumber(), practice, round: 0, rounds: CATS.map(c => ({ key: c.key, entries: [], points: 0, excluded: false, results: null })) };
}
const totalSoFar = () => state ? state.rounds.reduce((s, r) => s + r.points, 0) : 0;
function show(id) {
  screen = id;
  for (const s of document.querySelectorAll("[data-screen]")) s.hidden = s.dataset.screen !== id;
  document.body.classList.toggle("deep", id === "results");
  document.querySelector("main").classList.toggle("fill", id === "round");
  Sea.mood(id); Sea.urgency(0);
  Sound.setAmbience(id === "results" ? "reveal" : id === "preview" ? "round" : id, 0);
  const playing = !!state && id !== "home" && id !== "end";
  $("#steps").hidden = !playing;
  if (playing) document.querySelectorAll("#steps i").forEach((d, i) => { d.className = i < state.round ? "done" : i === state.round ? "now" : ""; });
  $("#top-meta").textContent = playing && state.round > 0 ? `${totalSoFar()} pts` : `Daily #${dayNumber()}`;
  if (id !== "round") window.scrollTo(0, 0);
}

// ---------- Home ----------
let nextTimer = 0;
function renderHome() {
  const streak = store.get("streak", { count: 0, last: 0, freezes: 0 });
  const today = store.get("day:" + dayNumber(), null);
  $("#home-streak").textContent = streak.count ? `${streak.count}-day streak${streak.freezes ? ` · ${streak.freezes} freeze${streak.freezes > 1 ? "s" : ""} saved` : ""}` : "";
  $("#play").textContent = today ? "See today's results" : "Play today's iceberg";
  $("#practice").hidden = !today;
  $("#timer-option").checked = store.get("longTimer", false);
  const tick = () => {
    if (!today) { $("#home-next").textContent = ""; return; }
    const left = 86400000 - ((Date.now() - LAUNCH_DAY) % 86400000), h = Math.floor(left / 3600000), m = Math.floor(left % 3600000 / 60000);
    $("#home-next").textContent = `Next iceberg in ${h}h ${String(m).padStart(2, "0")}m`;
  };
  clearInterval(nextTimer); tick(); nextTimer = setInterval(tick, 30000);
  state = null; show("home");
}

// ---------- Round preview (3, 2, 1) ----------
let previewRaf = 0;
function startRound() {
  const cat = CATS[state.round];
  $("#pre-num").textContent = `Round ${state.round + 1} of ${CATS.length}`;
  Icons.put($("#pre-icon"), cat.icon);
  $("#pre-title").textContent = cat.title;
  $("#pre-hint").textContent = cat.hint;
  show("preview");
  Sound.play("question");
  prep(cat); // build the lookup now, so the first keystroke is instant
  const total = PREVIEW_SECONDS * 1000 / SPEED, start = performance.now(), ring = $("#pre-ring"), num = $("#pre-count");
  cancelAnimationFrame(previewRaf);
  const step = now => {
    const k = Math.min(1, (now - start) / total);
    ring.style.strokeDashoffset = (220 * k).toFixed(1);
    num.textContent = Math.max(1, Math.ceil(PREVIEW_SECONDS * (1 - k)));
    if (k < 1) previewRaf = requestAnimationFrame(step); else playRound();
  };
  previewRaf = requestAnimationFrame(step);
}

// ---------- Answering ----------
// Built for flow: Enter submits and clears at once, focus never leaves the box, and nothing here waits on the network,
// an animation or a sound. Rarity, points and depth are deliberately not shown until the reveal.
let roundRaf = 0, roundEnd = 0;
function timerColour(leftSec) {
  // Ice blue for most of the round, warming to amber, then coral for the last five seconds.
  const mixc = (a, b, t) => `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(",")})`;
  const blue = [143, 208, 245], amber = [242, 180, 90], coral = [255, 143, 143];
  if (leftSec > 10) return mixc(blue, blue, 0);
  if (leftSec > 5) return mixc(blue, amber, (10 - leftSec) / 5);
  return mixc(amber, coral, Math.min(1, (5 - leftSec) / 2.5));
}
function playRound() {
  const cat = CATS[state.round], r = state.rounds[state.round], P = prep(cat);
  const given = { rows: new Map(), texts: new Set() }; // what's been said this round (for duplicate checks)
  $("#play-title").textContent = cat.title;
  Icons.put($("#play-icon"), cat.icon);
  $("#play-hint").textContent = cat.hint;
  const list = $("#answers"), input = $("#answer"), form = $("#entry"), section = $('[data-screen="round"]');
  list.textContent = ""; list.append(el("li", "answers-empty", "Your answers will stack up here."));
  input.value = ""; input.disabled = false;
  section.classList.remove("sinking", "hurry"); section.style.removeProperty("--clock");
  const countEl = $("#count"); countEl.textContent = "0"; $("#count-label").textContent = "answers";
  show("round");
  input.focus({ preventScroll: true });

  const rowsByKey = new Map();
  const bump = () => { countEl.classList.remove("bump"); void countEl.offsetWidth; countEl.classList.add("bump"); };
  function addRow(kind, label, key) {
    list.querySelector(".answers-empty")?.remove();
    const li = el("li", `ans ${kind} enter${kind === "ok" ? " fresh" : ""}`);
    const mark = el("span", "mark " + kind); mark.innerHTML = MARK[kind]; mark.setAttribute("role", "img"); mark.setAttribute("aria-label", STATUS_LABEL[kind]);
    const t = el("span", "t", label); t.title = label;
    li.append(mark, t); list.prepend(li); list.scrollTop = 0;
    rowsByKey.set(key, li);
  }
  function flashExisting(key) {
    const li = rowsByKey.get(key); if (!li) return;
    li.classList.remove("again", "fresh", "enter"); void li.offsetWidth; li.classList.add("again");
    li.scrollIntoView({ block: "nearest" });
  }
  function submit() {
    const text = input.value.trim(); input.value = "";
    if (document.activeElement !== input) input.focus({ preventScroll: true });
    if (!text) return;
    const j = V.judge(text, P, given);
    if (!j) return;
    if (j.status === "dup") { Sound.play("duplicate"); flashExisting(j.row ? "row:" + j.row.a : "text:" + j.key); return; }
    if (j.status === "ok") {
      const key = j.row ? "row:" + j.row.a : "text:" + j.key;
      if (j.row) given.rows.set(j.row.a, j); else given.texts.add(j.key);
      r.entries.push({ status: "ok", typed: j.text, key: j.key, name: j.row ? j.row.a : null, via: j.via });
      addRow("ok", j.row ? display(j.row) : j.text, key);
      countEl.textContent = r.entries.filter(e => e.status === "ok").length; $("#count-label").textContent = countEl.textContent === "1" ? "answer" : "answers"; bump();
      Sound.play("submit");
    } else {
      given.texts.add(j.key);
      r.entries.push({ status: j.status, typed: j.text, key: j.key, reason: j.reason });
      addRow(j.status === "pending" ? "maybe" : "no", j.text, "text:" + j.key);
      Sound.play(j.status === "pending" ? "pending" : "invalid");
      if (j.status === "invalid") { form.classList.remove("shake"); void form.offsetWidth; form.classList.add("shake"); }
    }
  }
  form.onsubmit = e => { e.preventDefault(); submit(); };
  $("#add").onpointerdown = e => e.preventDefault(); // tapping the button never takes focus (or the phone keyboard) away
  input.onkeydown = e => { if (e.key === "Escape") input.value = ""; };
  const onHide = () => { if (document.visibilityState === "hidden") r.excluded = true; };
  const onPaste = e => { e.preventDefault(); r.excluded = true; };
  const refocus = () => { if (screen === "round" && !input.disabled) setTimeout(() => { if (screen === "round" && !input.disabled && document.activeElement === document.body) input.focus({ preventScroll: true }); }, 0); };
  document.addEventListener("visibilitychange", onHide);
  input.addEventListener("paste", onPaste);
  input.addEventListener("blur", refocus);

  // The clock runs on the system timer, so it stays accurate whatever animations or audio are doing.
  const seconds = roundSeconds(), total = seconds * 1000 / SPEED, start = performance.now();
  const bar = $("#time-bar"), clock = $("#time-left");
  let lastShown = -1, ended = false;
  function end() {
    if (ended) return; ended = true;
    clearTimeout(roundEnd); cancelAnimationFrame(roundRaf);
    if (input.value.trim()) submit();
    input.disabled = true; input.blur();
    document.removeEventListener("visibilitychange", onHide);
    input.removeEventListener("paste", onPaste); input.removeEventListener("blur", refocus);
    bar.style.transform = "scaleX(0)"; clock.textContent = "0";
    Sound.play("timeup"); Sea.urgency(0);
    section.classList.add("sinking"); // the screen slips under the surface, straight into the dive
    const results = finishRound();
    setTimeout(async () => { await results; showResults(cat, r); }, 650 / SPEED);
  }
  const tick = now => {
    const leftMs = Math.max(0, total - (now - start)), leftSec = leftMs * SPEED / 1000;
    bar.style.transform = `scaleX(${(leftMs / total).toFixed(4)})`;
    const shown = Math.ceil(leftSec);
    if (shown !== lastShown) {
      lastShown = shown; clock.textContent = shown;
      if (shown <= 5 && shown > 0) { Sound.play("tick", { left: shown }); clock.classList.remove("beat"); void clock.offsetWidth; clock.classList.add("beat"); }
    }
    section.style.setProperty("--clock", timerColour(leftSec));
    section.classList.toggle("hurry", leftSec <= 5);
    Sea.urgency(leftSec <= 5 ? (5 - leftSec) / 5 : 0);
    if (leftMs > 0) roundRaf = requestAnimationFrame(tick); else end();
  };
  clearTimeout(roundEnd); cancelAnimationFrame(roundRaf);
  roundEnd = setTimeout(end, total + 30); // the round ends on time even if the tab can't draw
  roundRaf = requestAnimationFrame(tick);
}

// ---------- Scoring ----------
async function finishRound() {
  const cat = CATS[state.round], r = state.rounds[state.round];
  const before = await live.counts(state.day, state.round + 1);
  const names = r.entries.filter(e => e.status === "ok" && e.name).map(e => e.name);
  if (!state.practice) live.record(state.day, state.round + 1, names, r.excluded);
  r.lockStats = before;
  r.results = computeResults(cat, r, before, before);
  r.points = r.results.points;
  r.entries.filter(e => e.status === "pending").forEach(e => live.flag(state.day, state.round + 1, e.typed, "pending"));
}

function computeResults(cat, r, lockStats, boardStats) {
  // Scores lock with the numbers known when the round ended; the board can use fresher live counts.
  const ranked = cat.answers.map(row => ({ row, share: shareOf(row, boardStats) })).sort((a, b) => b.share - a.share || a.row.a.localeCompare(b.row.a));
  const byName = new Map(cat.answers.map(row => [row.a, row]));
  const totalMentions = ranked.reduce((s, x) => s + x.share, 0) || 1;
  // Rarity rank: what share of all answers given were more common than this one.
  const rankText = share => {
    const above = ranked.filter(x => x.share > share);
    if (!above.length) return "The most common answer";
    if (above.length < 5) return `#${above.length + 1} most common answer`;
    const pct = Math.min(99, Math.floor(100 * above.reduce((s, x) => s + x.share, 0) / totalMentions));
    return `Rarer than ${pct}% of answers given`;
  };
  const isLive = !!(boardStats && boardStats.players);
  const players = isLive ? boardStats.players : SAMPLE_PLAYERS;
  const countOf = (row, share) => isLive ? (boardStats.counts.get(row.a) || 0) : Math.max(1, Math.round(share * players));

  const mine = r.entries.filter(e => e.status === "ok").map(e => {
    const row = e.name ? byName.get(e.name) : null;
    const share = row ? shareOf(row, lockStats) : REVIEWED_SHARE;
    const typedDiffers = row && V.normalize(e.typed) !== V.normalize(row.a);
    return {
      name: row ? display(row) : e.typed, key: row ? row.a : e.key, share, shareText: shareText(share), tier: tierFor(share), rankText: rankText(share),
      countText: row ? `${fmt(countOf(row, share))} of ${fmt(players)}` : "", blurb: row && row.b || "", family: row && row.f || "",
      note: !row ? "Approved by review. Scores as Midwater until enough players have said it." : typedDiffers ? `You typed “${e.typed}”` : "", reviewed: !row,
    };
  }).sort((a, b) => b.share - a.share);
  // Category caps: only the rarest few of a family score (3 vehicle makes), so one idea can't be farmed for points.
  const caps = cat.caps || {};
  for (const fam of Object.keys(caps)) {
    const inFam = mine.filter(m => m.family === fam).sort((a, b) => a.share - b.share);
    inFam.slice(caps[fam].n).forEach(m => { m.capped = true; m.note = `Only ${caps[fam].n} ${caps[fam].label} score per round`; });
  }
  const scored = mine.filter(m => !m.capped);
  const mineSet = new Set(mine.map(m => m.key));
  // Only answers enough players gave can appear as "rarest": one-off typos and jokes never get rewarded on the board.
  // With sample data the board sticks to the hand-made list (plus anything you said), so it reads like a real day.
  const eligible = ranked.filter(({ row, share }) => isLive ? (boardStats.counts.get(row.a) || 0) >= BOARD_MIN_COUNT : share * players >= 1 && (!row.x || mineSet.has(row.a)));
  const board = x => ({ name: display(x.row), share: x.share, count: countOf(x.row, x.share), me: mineSet.has(x.row.a) });
  return {
    mine, scored, isLive, players,
    points: scored.reduce((s, m) => s + m.tier.pts, 0),
    common: ranked.slice(0, 5).map(board),
    rare: eligible.slice(-5).reverse().map(board),
    forgot: ranked.find(x => !mineSet.has(x.row.a)),
    notCounted: r.entries.filter(e => e.status !== "ok").map(e => ({ text: e.typed, key: e.key, status: e.status, reason: e.reason })),
  };
}

// ---------- Results: the dive, then your answers and everyone's ----------
let revealed = -1;
function setPoints(n) { $("#res-points").textContent = `+${n}`; }
function showResults(cat, r) {
  const res = r.results;
  $("#res-title").textContent = cat.title;
  Icons.put($("#res-icon"), cat.icon);
  $("#res-round").textContent = `Round ${state.round + 1} of ${CATS.length}`;
  $("#res-next").textContent = state.round + 1 < CATS.length ? "Next round" : "See your day";
  const section = $('[data-screen="results"]'); section.classList.add("revealing");
  document.querySelectorAll(".after").forEach(n => { n.hidden = true; });
  show("results");
  if (!berg) {
    berg = window.Iceberg.create($("#ib"), { speed: SPEED });
    berg.onStart(() => { Sound.play("descend"); });
    berg.onDepth(d => { if (screen === "results") Sound.setAmbience(berg.done ? "results" : "reveal", d); });
    berg.onReveal((i, it, special) => { if (special) Sound.play("rare"); else Sound.play("reveal", { depth: Math.min(1, metres(it.y) / 280) }); });
    berg.onFocus((i, silent) => {
      const cur = state && state.rounds[state.round].results; if (!cur) return;
      revealed = Math.max(revealed, i);
      document.querySelectorAll("#sum li[data-i]").forEach(li => { const j = +li.dataset.i; li.classList.toggle("active", j === i); if (j <= revealed && li.classList.contains("hide")) { li.classList.remove("hide"); li.classList.add("show"); } });
      if (!berg.done) { setPoints(cur.scored.slice(0, revealed + 1).reduce((s, m) => s + m.tier.pts, 0)); $("#watch-text").textContent = `Answer ${i + 1} of ${cur.scored.length}`; }
      else if (!silent) Sound.play("reveal", { depth: Math.min(1, metres(depthY(cur.scored[i].share)) / 280) });
    });
    berg.onDone(revealDone);
  }
  revealed = -1;
  berg.setAnswers(res.scored);
  setPoints(0);
  renderPanel(cat, r);
  $("#watching").hidden = false;
  $("#watch-text").textContent = res.scored.length ? "Diving…" : "Nothing to reveal this round";
  berg.play();
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) berg.skip(); // no camera moves: go straight to the finished iceberg
  reviewPending(cat, r);
}
function revealDone() {
  if (!state || screen !== "results") return;
  const r = state.rounds[state.round];
  setPoints(r.points);
  $("#watching").hidden = true;
  $('[data-screen="results"]').classList.remove("revealing");
  document.querySelectorAll("#sum li").forEach(li => { li.classList.remove("hide"); });
  document.querySelectorAll(".after").forEach(n => { n.hidden = false; });
  $("#nc-section").hidden = !r.results.notCounted.length;
  $("#forgot").hidden = !$("#forgot").textContent;
  $("#sum-aside").textContent = r.results.scored.length > 1 ? "tap one to revisit" : "";
  Sound.play("round"); Sound.setAmbience("results");
}

function renderPanel(cat, r) {
  const res = r.results;
  // Your answers. Each row: name, how many said it, where it landed, points. Tapping one flies the camera to it.
  const sum = $("#sum"); sum.textContent = "";
  $("#sum-aside").textContent = "";
  res.scored.forEach((m, i) => {
    const li = el("li", "tier-" + m.tier.key + " hide"); li.dataset.i = i;
    const b = el("button", "sum-row"); b.type = "button";
    const deep = metres(depthY(m.share));
    const sub = el("span", "sum-sub"); sub.append(el("span", "zone", m.tier.name), el("span", null, deep > 0 ? `${deep} m down` : "above the water"));
    if (m.note) sub.append(el("span", null, m.note));
    b.append(el("span", "sum-dot"), el("span", "sum-name", m.name), el("span", "sum-freq", m.shareText), el("span", "sum-pts", `+${m.tier.pts}`), sub);
    b.onclick = () => berg.focus(i);
    li.append(b); sum.append(li);
  });
  res.mine.filter(m => m.capped).forEach(m => {
    const li = el("li", "tier-" + m.tier.key + " hide");
    const row = el("div", "sum-row zero"); const sub = el("span", "sum-sub"); sub.append(el("span", null, m.note));
    row.append(el("span", "sum-dot"), el("span", "sum-name", m.name), el("span", "sum-freq", m.shareText), el("span", "sum-pts", "+0"), sub);
    li.append(row); sum.append(li);
  });
  if (!res.mine.length) { const li = el("li", "hide"); li.append(el("p", "forgot", "No answers counted this round. It happens. The next one's yours.")); sum.append(li); }
  const forgot = $("#forgot"); forgot.textContent = "";
  if (res.forgot) { forgot.append("Most players said ", el("b", null, display(res.forgot.row)), ` (${shareText(res.forgot.share)}).`); }

  renderNotCounted(cat, r);

  // Everyone's answers. Both lists share one labelled log scale: every mark on the axis is 10× rarer than the last.
  $("#players").textContent = res.isLive ? `${fmt(res.players)} players today` : `Sample data · ${fmt(res.players)} simulated players`;
  $("#sample-note").hidden = res.isLive;
  const min = Math.min(...[...res.common, ...res.rare].map(x => x.share), 0.001);
  const lo = Math.floor(Math.log10(min) - 0.001), hi = 0; // whole decades: ... 0.01%, 0.1%, 1%, 10%, 100%
  const pos = s => Math.max(0, Math.min(1, (Math.log10(s) - lo) / (hi - lo)));
  const bars = (list, target) => {
    target.textContent = "";
    list.forEach(x => {
      const li = el("li", x.me ? "me" : ""); if (x.me) li.title = "You said this";
      const track = el("span", "track"), fill = el("i"); fill.style.width = `${Math.max(1.5, 100 * pos(x.share))}%`; track.append(fill);
      const val = el("span", "bar-val"); val.append(el("b", null, pctText(x.share)), ` · ${fmt(x.count)}`);
      val.title = `${pctText(x.share)} of players (${fmt(x.count)} of ${fmt(res.players)})`;
      const name = el("span", "bar-name", x.name); name.title = x.name;
      li.append(name, track, val); target.append(li);
    });
  };
  bars(res.common, $("#common")); bars(res.rare, $("#rare"));
  const axis = $("#axis"); axis.textContent = "";
  for (let d = lo; d <= hi; d++) {
    const label = d >= -2 ? `${Math.pow(10, d + 2)}%` : `${+(Math.pow(10, d + 2)).toFixed(-d - 2)}%`;
    const t = el("span", d === lo ? "first" : d === hi ? "last" : "", label); t.style.left = `${100 * (d - lo) / (hi - lo)}%`; axis.append(t);
  }
  const rules = $("#rules"); rules.textContent = ""; (cat.rules || []).forEach(t => rules.append(el("li", null, t)));
}

function renderNotCounted(cat, r) {
  const res = r.results, nc = $("#nc"); nc.textContent = "";
  const pending = res.notCounted.filter(x => x.status === "pending").length;
  $("#nc-aside").textContent = `${res.notCounted.length} answer${res.notCounted.length === 1 ? "" : "s"}`;
  res.notCounted.forEach(x => {
    const li = el("li", "nc");
    const mark = el("span", "mark " + (x.status === "pending" ? "maybe" : "no")); mark.innerHTML = MARK[x.status === "pending" ? "maybe" : "no"];
    const wrap = el("div", "t-wrap"); const t = el("div", "t", x.text); t.title = x.text;
    wrap.append(t, el("div", "why", x.status === "pending" ? (x.reviewing ? "Being checked now…" : x.sent ? "Sent for review" : "Waiting for review · no points yet") : x.reason || "Doesn't count"));
    const b = el("button", null, x.sent ? "Sent" : x.status === "pending" ? "I think this counts" : "Dispute"); b.type = "button"; b.disabled = !!x.sent;
    b.onclick = () => { x.sent = true; live.flag(state.day, state.round + 1, x.text, x.status === "pending" ? "pending-dispute" : "dispute"); Sound.play("click"); renderNotCounted(cat, r); };
    li.append(mark, wrap, b); nc.append(li);
  });
  $("#review-note").textContent = !res.notCounted.length ? "" : BACKEND.verifyUrl
    ? "Answers marked ? are checked automatically. If one is approved, its points are added before the day ends."
    : pending ? "Answers marked ? weren't in today's list. They're saved for review, and approved answers will be recognised in future games." : "Think we got one wrong? Dispute it and it goes to review.";
}

// Ask the review service about unknown answers (only if one is configured). Runs alongside the dive, never before it.
async function reviewPending(cat, r) {
  const waiting = r.results.notCounted.filter(x => x.status === "pending");
  if (!BACKEND.verifyUrl || !waiting.length) return;
  waiting.forEach(x => { x.reviewing = true; });
  const verdicts = await requestReview(cat, waiting.map(x => x.text));
  waiting.forEach(x => { x.reviewing = false; });
  if (verdicts) {
    const P = prep(cat);
    for (const v of verdicts) {
      const entry = r.entries.find(e => e.status === "pending" && V.normalize(e.typed) === V.normalize(v.text || ""));
      if (!entry || (v.status !== "ok" && v.status !== "invalid")) continue;
      const row = v.canonical ? cat.answers.find(a => a.a === V.normalize(v.canonical)) : null;
      V.remember(P, entry.typed, { status: v.status, row: row ? row.a : undefined, reason: v.reason });
      if (v.status === "invalid") { entry.status = "invalid"; entry.reason = v.reason || "Reviewed: doesn't count"; continue; }
      const already = r.entries.some(e => e.status === "ok" && row && e.name === row.a);
      if (already) { entry.status = "invalid"; entry.reason = `Same answer as ${display(row)}`; continue; }
      entry.status = "ok"; entry.name = row ? row.a : null; entry.via = "review";
    }
    r.results = computeResults(cat, r, r.lockStats, r.lockStats); r.points = r.results.points;
  }
  if (state && state.rounds[state.round] === r && screen === "results") {
    if (verdicts && berg.done) { // approved answers join the iceberg without replaying the dive
      revealed = r.results.scored.length; berg.setAnswers(r.results.scored); renderPanel(cat, r); berg.skip(); revealDone();
    } else if (verdicts) { berg.setAnswers(r.results.scored); renderPanel(cat, r); revealed = -1; berg.play(); }
    else renderNotCounted(cat, r);
  }
}

// ---------- End of day ----------
function finishDay() {
  const total = totalSoFar();
  const summary = state.rounds.map((r, i) => ({ title: CATS[i].title, icon: CATS[i].icon, points: r.points,
    tiers: r.results ? r.results.scored.map(m => m.tier.key) : [], deepest: r.results && r.results.scored.length ? r.results.scored[r.results.scored.length - 1] : null }));
  const day = { total, rounds: summary.map(s => ({ ...s, deepest: s.deepest ? { name: s.deepest.name, share: s.deepest.share, tier: s.deepest.tier.key } : null })) };
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
  }
  renderEnd(day, true);
}
function shareCard(day) {
  const streak = store.get("streak", { count: 0 });
  const order = ["tip", "shallows", "mid", "deep", "abyss"];
  const lines = day.rounds.map((r, i) => `${i + 1} ${r.tiers.length ? [...r.tiers].sort((a, b) => order.indexOf(a) - order.indexOf(b)).slice(0, 12).map(k => TIER_EMOJI[k]).join("") + (r.tiers.length > 12 ? `+${r.tiers.length - 12}` : "") : "–"}`);
  const deepest = day.rounds.map(r => r.deepest).filter(Boolean).sort((a, b) => a.share - b.share)[0];
  const last = [deepest ? `Deepest: ${shareText(deepest.share)}` : "", streak.count ? `streak ${streak.count}` : ""].filter(Boolean).join(" · ");
  return [`Iceberg #${dayNumber()} · ${day.total} pts`, ...lines, last].filter(Boolean).join("\n");
}
function renderEnd(day, fresh) {
  const practice = !!(state && state.practice);
  const list = $("#e-rounds"); list.textContent = "";
  day.rounds.forEach(r => {
    const li = el("li");
    const left = el("div", "e-cat"); const ic = el("span", "cat-icon"); Icons.put(ic, r.icon); left.append(ic, el("span", null, r.title));
    const deep = el("div", "e-deep" + (r.deepest ? " tier-" + r.deepest.tier : ""), r.deepest ? `${r.deepest.name} · ${shareText(r.deepest.share)}` : "no answers");
    if (r.deepest) deep.title = r.deepest.name;
    li.append(left, deep, el("span", "e-pts", `${r.points}`));
    list.append(li);
  });
  $("#e-card").textContent = shareCard(day);
  const s = store.get("streak", { count: 0, freezes: 0 });
  $("#e-streak").textContent = s.count ? `${s.count}-day streak` : "";
  $("#e-note").textContent = practice ? "Practice run: this doesn't change your daily score or streak." : "A new iceberg surfaces tomorrow.";
  state = null; show("end");
  // The total counts up once, as the day's little finale.
  const totalEl = $("#e-total");
  if (!fresh || SPEED > 1 || matchMedia("(prefers-reduced-motion: reduce)").matches) { totalEl.textContent = day.total; if (fresh) Sound.play("day"); return; }
  Sound.play("day");
  const t0 = performance.now(), dur = 900;
  const step = now => { const k = Math.min(1, (now - t0) / dur); totalEl.textContent = Math.round(day.total * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(step); };
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
  document.addEventListener("click", e => { const b = e.target.closest("button"); if (b && b.id !== "add" && !b.closest(".nc")) Sound.play("click"); }, true);
  document.addEventListener("pointerover", e => { if (e.pointerType === "mouse" && e.target.closest && e.target.closest(".btn, .sum-row, .ib-controls button, .ib-nav button")) { const b = e.target.closest(".btn, .sum-row, .ib-controls button, .ib-nav button"); if (!b.contains(e.relatedTarget)) Sound.play("hover"); } });
}

// ---------- Wiring ----------
function fitViewport() {
  // Keeps the answering screen exactly as tall as the visible area, including when a phone keyboard is open.
  const vv = window.visualViewport, h = vv ? vv.height : innerHeight;
  document.documentElement.style.setProperty("--vvh", h + "px");
  if (screen === "round") window.scrollTo(0, 0);
}
async function boot() {
  fitViewport();
  (window.visualViewport || window).addEventListener("resize", fitViewport);
  wireSound();
  let data = null;
  try { data = await (await fetch("categories.json")).json(); } catch { data = window.ICEBERG_CATEGORIES || null; }
  CATS = data ? (Array.isArray(data) ? data : data.categories || []) : [];
  if (data && data.commonWords) V.setCommonWords(data.commonWords);
  if (!CATS.length) { $("#home-streak").textContent = "Couldn't load today's categories. Refresh to try again."; show("home"); return; }
  $("#play").onclick = () => {
    const today = store.get("day:" + dayNumber(), null);
    if (today) { state = null; return renderEnd(today, false); }
    newGame(false); Sound.unlock(); Sound.play("start"); startRound();
  };
  $("#practice").onclick = () => { newGame(true); Sound.play("start"); startRound(); };
  $("#res-next").onclick = () => { if (!state) return; state.round++; if (state.round < CATS.length) startRound(); else finishDay(); };
  $("#home").onclick = renderHome;
  $("#brand").onclick = () => { if (screen === "end" || screen === "home") renderHome(); };
  $("#timer-option").onchange = e => store.set("longTimer", e.target.checked);
  $("#copy").onclick = async () => {
    const text = $("#e-card").textContent;
    try { await navigator.clipboard.writeText(text); $("#copy").textContent = "Copied"; }
    catch { const range = document.createRange(); range.selectNodeContents($("#e-card")); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range); $("#copy").textContent = "Selected, copy it"; }
    setTimeout(() => { $("#copy").textContent = "Copy result"; }, 2000);
  };
  // Keys on the results screen: space pauses the dive, arrows step through answers, Enter moves on.
  document.addEventListener("keydown", e => {
    if (screen !== "results" || !berg || e.target.closest("input, button, summary")) return;
    if (e.key === " ") { e.preventDefault(); berg.toggle(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); berg.step(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); berg.step(-1); }
    else if (e.key === "Enter" && berg.done) $("#res-next").click();
  });
  renderHome();
  if (PARAMS.has("test")) {
    // Test hook: jump straight to a round's results with given answers (no typing needed).
    window.ICEBERG_TEST = {
      results(roundIndex, answers) {
        newGame(true); state.round = roundIndex;
        const cat = CATS[roundIndex], r = state.rounds[roundIndex], P = prep(cat), given = { rows: new Map(), texts: new Set() };
        answers.forEach(a => {
          const j = V.judge(a, P, given); if (!j || j.status === "dup") return;
          if (j.status === "ok") { if (j.row) given.rows.set(j.row.a, j); else given.texts.add(j.key); r.entries.push({ status: "ok", typed: j.text, key: j.key, name: j.row ? j.row.a : null, via: j.via }); }
          else { given.texts.add(j.key); r.entries.push({ status: j.status, typed: j.text, key: j.key, reason: j.reason }); }
        });
        r.results = computeResults(cat, r, null, null); r.points = r.results.points;
        showResults(cat, r);
      },
      judge: (text, i) => { const j = V.judge(text, prep(CATS[i]), null); return j ? { status: j.status, answer: j.row ? j.row.a : null, via: j.via, reason: j.reason } : null; },
      get state() { return state; }, get screen() { return screen; }, get berg() { return berg; },
    };
  }
}
boot();
