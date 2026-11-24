// Exploring a finished dive: your own from another day, or a friend's.
// It is the game's own scene, read-only: the same iceberg, camera, annotations, depth gauge, darkness and wildlife,
// with every guess back at the depth it was scored at. Start on the whole dive, pick a question, pick a guess, or
// let it replay. "Compare" puts two players' deepest answers on the one iceberg, yours solid and theirs hollow.
// Nothing here can change anyone's results: it only ever reads.
(function () {
  "use strict";
  const A = window.Account, $ = s => document.querySelector(s), G = () => window.Game, I = window.Iceberg;
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const m = n => `${Number(n).toLocaleString("en-US")} m`;
  let berg = null, life = null, dive = null, mine = null, q = -1, run = 0, replaying = false, watch = null, met = new Set();

  // ---------- Loading a dive into one shape, wherever it comes from ----------
  // { name, avatar, own, day, total, max_depth, hidden, qs: [{ title, prompt, icon, guesses: [{ slot, name, share, depth, status, best, sight }], best }] }
  async function shape(day, set, list, meta) {
    const game = G(), cats = await game.loadSet(set);
    const qs = cats.map((c, i) => {
      const guesses = list.filter(g => g.round === i + 1).sort((a, b) => a.slot - b.slot).map(g => {
        const row = g.answer ? c.answers.find(a => a.a === g.answer) : null;
        return { slot: g.slot, status: g.status, share: g.share, depth: g.depth, best: !!g.best, sight: g.sight || "", blurb: row && row.b || "",
          name: meta.hidden && g.status === "ok" ? "Hidden answer" : row ? game.display(row) : g.answer || g.typed || "", rank: g.status === "ok" && g.share != null ? rarer(c, g.share) : "" };
      });
      return { title: c.title, prompt: c.prompt || c.title, icon: c.icon, guesses, best: guesses.find(g => g.best) || null };
    });
    return { ...meta, day, qs };
  }
  const rarer = (c, share) => { let above = 0, total = 0; for (const a of c.answers) { total += a.s; if (a.s > share) above += a.s; } return above === 0 ? "The most common answer" : `Rarer than ${Math.min(99, Math.floor(100 * above / (total || 1)))}% of answers given`; };
  async function fromServer(username, day) {
    const d = await A.rpc("get_dive", { p_username: username, p_day: day });
    return shape(day, d.set, d.guesses, { name: d.username, avatar: d.avatar, own: d.own, total: d.total, max_depth: d.max_depth, hidden: d.answers_hidden, rank: d.rank, players: d.players, ranked: d.ranked });
  }
  async function fromDevice(day) {
    const game = G(), g = game.finishedGame(day); if (!g) return null;
    const list = [];
    g.rounds.forEach((r, i) => { const ok = r.guesses.filter(x => x.status === "ok"), best = ok.reduce((b, x) => !b || x.share < b.share ? x : b, null);
      r.guesses.slice(0, game.GUESSES).forEach((x, j) => list.push({ round: i + 1, slot: j + 1, status: x.status, answer: x.status === "ok" ? x.name : null, typed: x.typed, share: x.status === "ok" ? x.share : null, depth: x.status === "ok" ? I.depthOf(x.share) : null, best: x === best, sight: x.sight })); });
    const total = list.filter(x => x.best).reduce((t, x) => t + x.depth, 0);
    return shape(day, game.setOf(day), list, { name: A && A.signedIn ? A.profile.username : "You", avatar: A && A.signedIn ? A.profile.avatar : "dumbo", own: true, total, max_depth: Math.max(0, ...list.filter(x => x.best).map(x => x.depth)), hidden: false });
  }
  const isMe = name => !name || name === "me" || (A && A.signedIn && name.toLowerCase() === A.profile.username.toLowerCase());
  async function load(username, day) {
    if (isMe(username)) { const local = await fromDevice(day); if (local) return local; if (!A || !A.signedIn) throw new Error("That dive isn't on this device."); return fromServer(A.profile.username, day); }
    if (!A || !A.signedIn) throw new Error("Sign in to explore a friend's dive.");
    return fromServer(username, day);
  }

  // ---------- The scene ----------
  function ensure() {
    if (berg) return;
    berg = I.create($("#ib2"), { speed: new URLSearchParams(location.search).has("fast") ? 4 : 1 });
    berg.onDepth(d => { if (G().screen === "dive") window.Sound.setAmbience("play", d); });
    berg.onTravel((it, dir, ms) => { if (replaying) window.Sound.play("travel", { dir, seconds: ms / 1000 }); if (life) life.calm(ms + 2000); });
    berg.onLand((i, it) => { if (replaying) window.Sound.play("reveal", { depth: Math.min(1, it.depth / 260), m: it.depth }); });
    berg.onFocus(i => { document.querySelectorAll("#v-slots .slot").forEach(n => n.classList.toggle("active", +n.dataset.bi === i)); greet(i); });
    if (window.Wildlife) life = window.Wildlife.create(berg, { low: G().store.get("fx", "full") === "low" });
    watch = new ResizeObserver(() => frame(0)); [".dive .dock", ".dive .q", "#v-panel", ".dive"].forEach(s => watch.observe($(s)));
  }
  function frame(ms) {
    if (!berg || G().screen !== "dive") return;
    const sec = $(".dive"), top = Math.round($(".top").getBoundingClientRect().bottom);
    if (!matchMedia("(max-width: 920px)").matches) { const k = $(".dive .dock"); berg.setFrame({ l: k.offsetLeft + k.offsetWidth + 20, r: 0, t: top, b: 0 }, ms); return; }
    const a = $(".dive .q").getBoundingClientRect(), p = $("#v-panel").getBoundingClientRect(), box = sec.getBoundingClientRect();
    sec.style.setProperty("--q-bottom", Math.round(a.bottom - box.top) + "px"); sec.style.setProperty("--p-height", Math.round(box.bottom - p.top) + "px");
    berg.setFrame({ l: 0, r: 0, t: Math.round(a.bottom - box.top) + 4, b: Math.round(box.bottom - p.top) + 4 }, ms);
  }
  // A recorded encounter comes back when its answer is looked at.
  let items = [];
  function greet(i) {
    const it = items[i]; if (!it || !it.sightKey || !life || met.has(it.id) || !berg.view.focus) return;
    met.add(it.id); const at = berg.view.focus; setTimeout(() => { if (G().screen === "dive") life.encounter(it.sightKey, at); }, 900);
  }
  const SIGHT = () => Object.fromEntries((window.Wildlife ? window.Wildlife.ENCOUNTERS : []).map(e => [e.key, e.line]));
  // One guess as the scene wants it.
  function item(d, qi, g, who) {
    const game = G(), them = who === "them", label = mine ? (them ? d.name : "You") : null;
    return { id: `${who}:${qi}:${g.slot}`, n: g.slot, name: g.name, share: g.share, shareText: game.pctText(g.share), countText: "", rankText: g.rank, blurb: g.blurb, sight: SIGHT()[g.sight] || "", sightKey: g.sight || "",
      who: them ? "them" : "me", label, dx: mine ? (them ? -17 : 17) : undefined, side: mine ? (them ? -1 : 1) : undefined,
      meta: `${them || !d.own || mine ? (them ? d.name : mine ? "You" : d.name) + " · " : ""}Question ${qi + 1} · guess ${g.slot}` };
  }

  // ---------- The dock: whose dive, the five questions, the guesses ----------
  function head() {
    const game = G(), d = dive, date = game.dateOf(d.day).toLocaleDateString("en-US", { day: "numeric", month: "long" });
    $("#v-day").textContent = `Daily #${d.day} · ${date}`;
    const av = $("#v-av"); av.textContent = ""; av.className = "av"; const c = document.createElement("canvas"); if (window.Wildlife) window.Wildlife.portrait(c, mine ? mine.avatar : d.avatar); av.append(c);
    if (mine) {
      const diff = mine.total - d.total, deep = mine.max_depth - d.max_depth;
      $("#v-title").textContent = `You and ${d.name}`;
      $("#v-sub").textContent = `You ${m(mine.total)} · ${d.name} ${m(d.total)} · ${diff === 0 ? "level" : diff > 0 ? `you're ${m(diff)} ahead` : `${d.name} is ${m(-diff)} ahead`}. Deepest answer: ${deep === 0 ? "the same depth" : deep > 0 ? `yours, by ${m(deep)}` : `${d.name}'s, by ${m(-deep)}`}.`;
    } else {
      $("#v-title").textContent = d.own ? "Your dive" : `${d.name}'s dive`;
      $("#v-sub").textContent = `${m(d.total)} total · deepest ${m(d.max_depth)}${d.rank && d.players ? ` · #${d.rank} of ${d.players}` : ""}${d.hidden ? " · answers hidden by " + d.name : ""}`;
    }
    $("#v-vs").hidden = !!mine || d.own || !canCompare; $("#v-replay").hidden = !!mine;
    $("#v-all").disabled = q < 0 && !replaying;
  }
  let canCompare = false;
  function questions() {
    const list = $("#v-qs"); list.textContent = "";
    const deepest = Math.max(0, ...dive.qs.map(x => x.best ? x.best.depth : 0));
    dive.qs.forEach((x, i) => {
      const li = el("li"), b = el("button", "v-q" + (x.best && x.best.depth === deepest && deepest > 0 && !mine ? " deepest" : "")); b.type = "button"; if (i === q) b.setAttribute("aria-current", "true");
      const ic = el("span", "cat-icon"); window.IcebergIcons.put(ic, x.icon);
      const main = el("div"); main.append(el("div", "t", `${i + 1} · ${x.title}`));
      const d = el("div", "d");
      if (mine) {
        const a = mine.qs[i].best, t = x.best, ad = a ? a.depth : 0, td = t ? t.depth : 0;
        main.append(el("div", "a", `${a ? a.name : "nothing"} · ${t ? t.name : "nothing"}`));
        const them = el("small", td > ad ? "up" : ""); them.append(el("span", "nm", dive.name + " "), m(td));
        d.append(el("b", ad >= td ? "up" : "", m(ad)), them);
        b.setAttribute("aria-label", `Question ${i + 1}, ${x.title}: you ${ad} metres, ${dive.name} ${td} metres`);
      } else {
        main.append(el("div", "a", x.best ? x.best.name : x.guesses.length ? "nothing counted" : "no guess"));
        d.append(el("b", null, x.best ? m(x.best.depth) : "0 m"));
        b.setAttribute("aria-label", `Question ${i + 1}, ${x.title}: ${x.best ? x.best.name + ", " + x.best.depth + " metres" : "no depth"}`);
      }
      b.append(ic, main, d); b.onclick = () => pick(i); li.append(b); list.append(li);
    });
  }
  function slots() {
    const list = $("#v-slots"); list.textContent = ""; list.hidden = q < 0 || !!mine;
    if (list.hidden) return;
    const x = dive.qs[q]; let bi = 0;
    for (let s = 1; s <= G().GUESSES; s++) {
      const g = x.guesses.find(k => k.slot === s), li = el("li"), ok = g && g.status === "ok";
      const b = el(ok ? "button" : "div", "slot " + (!g ? "empty" : ok ? "done tier-" + I.tierOfDepth(g.depth).key + (g.best ? " best" : "") : g.status === "pending" ? "pending" : "miss")); if (ok) { b.type = "button"; b.dataset.bi = bi; const at = bi++; b.onclick = () => { stopReplay(); berg.focus(at); }; }
      const n = el("span", "slot-n"); n.append(el("span", null, String(s)));
      const main = el("div", "slot-main"); main.append(el("span", "slot-name", g ? g.name : "Not used"));
      if (ok) { const sub = el("span", "slot-sub"); sub.append(G().pctText(g.share), el("span", "wide", " of players · "), el("b", null, I.tierOfDepth(g.depth).name)); main.append(sub); }
      else if (g) main.append(el("span", "slot-sub", g.status === "pending" ? "Waiting for review" : "Didn't count"));
      const depth = el("span", "slot-depth"); if (ok) { depth.append(String(g.depth), el("small", null, "m")); } else depth.textContent = g ? "no depth" : "–";
      if (ok && g.best && x.guesses.filter(k => k.status === "ok").length > 1) b.append(el("span", "slot-tag", "Deepest"));
      b.prepend(n); b.append(main, depth); li.append(b); list.append(li);
    }
  }
  const draw = () => { head(); questions(); slots(); requestAnimationFrame(() => frame(0)); };

  // ---------- Views ----------
  function whole(glide) {
    stopReplay(); q = -1; draw();
    items = [];
    dive.qs.forEach((x, i) => { if (x.best) items.push({ ...item(dive, i, x.best, mine ? "them" : "me"), n: i + 1, label: mine ? `${i + 1} ${dive.name}` : String(i + 1) }); });
    if (mine) mine.qs.forEach((x, i) => { if (x.best) items.push({ ...item(mine, i, x.best, "me"), n: i + 1, label: `${i + 1} You` }); });
    if (life) life.reset(dive.day * 10 + 7);
    berg.overview(items, { glide });
  }
  function pick(i, glide = true) {
    stopReplay(); q = i; draw();
    const x = dive.qs[i];
    items = mine ? [mine.qs[i].best && item(mine, i, mine.qs[i].best, "me"), x.best && item(dive, i, x.best, "them")].filter(Boolean)
      : x.guesses.filter(g => g.status === "ok").map(g => item(dive, i, g, "me"));
    if (life) life.reset(dive.day * 10 + i + 1);
    if (!items.length) { berg.restore([]); return; }
    berg.restore(items, { glide });
    if (!mine) x.guesses.filter(g => g.status === "ok").forEach((g, j) => { if (g.best && x.guesses.filter(k => k.status === "ok").length > 1) berg.setTag(j, dive.own ? "Deepest discovery" : "Their deepest discovery"); });
  }
  // Replay: the guesses again in the order they were made, question by question. Any tap stops it.
  function stopReplay() { if (!replaying) return; replaying = false; run++; $("#v-replay").textContent = "Replay"; }
  async function replay() {
    if (replaying) { stopReplay(); if (q >= 0) pick(q, false); else whole(false); return; }
    replaying = true; const mineRun = ++run, wait = ms => new Promise(r => setTimeout(r, ms / (new URLSearchParams(location.search).has("fast") ? 4 : 1)));
    $("#v-replay").textContent = "Stop";
    for (let i = Math.max(0, q); i < dive.qs.length && run === mineRun; i++) {
      q = i; draw(); items = []; if (life) life.reset(dive.day * 10 + i + 1);
      const ok = dive.qs[i].guesses.filter(g => g.status === "ok");
      await berg.enter(true); if (run !== mineRun) return;
      for (const g of ok) { const it = item(dive, i, g, "me"); items.push(it); await berg.add(it, { special: g.depth >= 200 && g.best }); if (run !== mineRun) return; await wait(1500); if (run !== mineRun) return; }
      if (!ok.length) await wait(700);
    }
    if (run === mineRun) { replaying = false; $("#v-replay").textContent = "Replay"; whole(true); }
  }

  async function open(username, day, versus) {
    const game = G(); game.show("dive"); ensure(); stopReplay();
    dive = null; mine = null; q = -1; met = new Set(); canCompare = false;
    const msg = $("#v-msg"); msg.hidden = false; msg.textContent = "Bringing the dive up…"; $("#v-qs").textContent = ""; $("#v-slots").hidden = true; $("#v-title").textContent = ""; $("#v-sub").textContent = ""; $("#v-day").textContent = `Daily #${day}`; $("#v-av").textContent = "";
    berg.setFrame({ l: 0, r: 0, t: 64, b: 0 }, 0); berg.overview([]); requestAnimationFrame(() => frame(0));
    try {
      dive = await load(username, day);
      if (!dive.own) { const me = await load("me", day).catch(() => null); canCompare = !!me; if (versus) { if (!me) throw new Error("You don't have a dive for that day to compare."); mine = me; } }
      if (game.screen !== "dive") return;
      msg.hidden = true; whole(false);
    } catch (e) { msg.textContent = e.message || "That dive can't be opened."; $("#v-vs").hidden = true; $("#v-replay").hidden = true; }
  }
  function close() { stopReplay(); if (berg) berg.stop(); }

  const wire = () => {
    if (!$("#v-all")) return;
    $("#v-all").onclick = () => whole(true);
    $("#v-replay").onclick = replay;
    $("#v-vs").onclick = () => window.Hub.open("vs", dive.name, dive.day);
    $("#v-close").onclick = () => window.Hub.back();
    document.addEventListener("keydown", e => { if (!G() || G().screen !== "dive" || !dive || e.target.closest("input")) return; if (e.key === "Escape") $("#v-close").click(); else if (e.key === "ArrowDown") { e.preventDefault(); berg.step(1); } else if (e.key === "ArrowUp") { e.preventDefault(); berg.step(-1); } else if (/^[1-5]$/.test(e.key)) pick(+e.key - 1); });
  };
  wire();
  window.Viewer = { open, close, get state() { return { name: dive && dive.name, q, compare: !!mine, replaying, items: items.length, total: dive && dive.total }; }, get berg() { return berg; }, get life() { return life; } };
})();
