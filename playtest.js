// Playtest tools, only in the private playtest build (window.PLAYTEST or ?playtest): pick any day, replay it, and keep
// notes on each question and each day. Notes go to the artifact's database when the page runs as a claude.ai artifact
// (so they can be read back), and are always kept on this device too. Nothing here reaches the live game.
(function () {
  const G = () => window.Game;
  if (!(window.PLAYTEST || new URLSearchParams(location.search).has("playtest"))) return;
  const $ = s => document.querySelector(s);
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const local = {
    get(k, d) { try { const v = localStorage.getItem("iceberg-pt:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("iceberg-pt:" + k, JSON.stringify(v)); } catch { /* fine */ } },
    del(k) { try { localStorage.removeItem("iceberg-pt:" + k); } catch { /* fine */ } },
  };
  const day = local.get("pt-day", 1);
  const GROUPS = { live: "Live days (already played on the site)", prepared: "Prepared days (scheduled, not yet public)", new: "New sample days (for review, rough rarity)",
    mix: "The rotating daily mix (211-224): two rarity rounds, a target, a forbidden and one special, in a different order each day",
    experimental: "Experimental round types (practice days 191-195, full expeditions 201-208)", prototype: "Prototypes: routes (209), chains (210, 226-227), the community sounding (225)" };

  // ---------- Notes: device first, the artifact database when there is one ----------
  let db = null, dbState = "device";
  const notes = local.get("notes", {});   // id -> {day, q, key, prompt, text, at}
  const idOf = (d, q) => `d${d}-${q === "day" ? "day" : "q" + (q + 1)}`;
  (async () => {
    try {
      if (!window.claude || !window.claude.use) return;
      db = await window.claude.use("db"); if (!db) return;
      const snap = await Promise.race([db.collection("notes").get(), new Promise((_, no) => setTimeout(() => no(new Error("slow")), 10000))]);
      (snap.docs || snap || []).forEach(d => { const v = d.data ? d.data() : d; const id = d.id || v.id; if (id && v && (!notes[id] || (v.at || 0) > (notes[id].at || 0))) notes[id] = v; });
      local.set("notes", notes); dbState = "saved"; paintAll();
    } catch { db = null; }
  })();
  const pending = new Map();
  function saveNote(d, q, text) {
    const cats = G() ? G().cats : [], c = q === "day" ? null : cats[q];
    const id = idOf(d, q), row = { day: d, q: q === "day" ? "day" : q + 1, key: c ? c.key : "", prompt: c ? c.prompt || c.title : "(whole day)", text, at: Date.now() };
    if (!text.trim()) delete notes[id]; else notes[id] = row;
    local.set("notes", notes); status("Saved on this device");
    if (!db) return;
    clearTimeout(pending.get(id)); pending.set(id, setTimeout(async () => {
      try { const ref = db.collection("notes").doc(id); if (text.trim()) await ref.set(row); else await ref.delete(); status("Saved"); }
      catch { status("Saved on this device (couldn't reach the notes store)"); }
    }, 700));
  }

  // ---------- Answer reports: "I think this counts" and "Dispute" in the results ----------
  // Each report keeps the question, what was typed and what the game decided, with the notes (and in the artifact's
  // database when there is one), so missing answers found while playing can be added to the lists.
  const reports = local.get("reports", []);
  window.PTReport = (r) => {
    const row = { ...r, at: Date.now() }; reports.push(row); local.set("reports", reports.slice(-500));
    if (db) db.collection("reports").doc(`${row.day}-${row.round}-${row.at}`).set(row).catch(() => {});
  };
  window.PTReports = () => reports.slice();

  // ---------- The bar and the two panels ----------
  const css = el("style"); css.textContent = `
    .pt-bar { position: fixed; left: 50%; transform: translateX(-50%); bottom: max(10px, env(safe-area-inset-bottom)); z-index: 60; display: flex; gap: 4px; align-items: center;
      padding: 4px; border-radius: 12px; background: rgba(6, 14, 34, .92); border: 1px solid var(--line-2); box-shadow: 0 6px 24px rgba(0,0,0,.4); font: 600 13px var(--ui); max-width: calc(100vw - 20px); }
    .pt-bar button { font: inherit; color: var(--text); background: none; border: 0; padding: 8px 11px; border-radius: 8px; cursor: pointer; white-space: nowrap; }
    .pt-bar button:hover { background: rgba(143,208,245,.1); } .pt-bar .pt-day { color: var(--accent); }
    .pt-bar .pt-tag { color: var(--faint); font: 600 10.5px var(--ui); letter-spacing: .08em; text-transform: uppercase; padding: 0 6px 0 8px; }
    .pt-panel { position: fixed; z-index: 61; inset: auto 10px 66px auto; width: min(420px, calc(100vw - 20px)); max-height: min(70vh, 640px); overflow: auto;
      background: var(--panel-solid); border: 1px solid var(--line-2); border-radius: 14px; padding: 16px; color: var(--text); font: 14px/1.45 var(--ui); box-shadow: 0 12px 40px rgba(0,0,0,.5); }
    .pt-panel.pt-days { inset: 66px auto auto 50%; transform: translateX(-50%); width: min(720px, calc(100vw - 20px)); max-height: calc(100vh - 150px); }
    .pt-panel h3 { margin: 0 0 4px; font: 700 15px var(--ui); } .pt-panel h4 { margin: 18px 0 6px; font: 700 12px var(--ui); color: var(--muted); letter-spacing: .06em; text-transform: uppercase; }
    .pt-panel p { margin: 0 0 8px; color: var(--muted); } .pt-panel .pt-q { color: var(--text); font-weight: 600; margin: 10px 0 6px; }
    .pt-panel textarea { width: 100%; box-sizing: border-box; min-height: 84px; resize: vertical; background: rgba(0,0,0,.25); color: var(--text); border: 1px solid var(--line-2); border-radius: 10px; padding: 10px; font: 14px/1.45 var(--ui); }
    .pt-panel textarea:focus { outline: 2px solid var(--accent); outline-offset: 0; }
    .pt-x { float: right; background: none; border: 0; color: var(--muted); font: 600 13px var(--ui); cursor: pointer; padding: 4px 6px; }
    .pt-status { font-size: 12px; color: var(--faint); margin-top: 8px; min-height: 1em; }
    .pt-list { display: grid; gap: 6px; } .pt-row { display: grid; grid-template-columns: 64px 1fr auto; gap: 10px; align-items: start; text-align: left; width: 100%;
      background: rgba(143,208,245,.04); border: 1px solid var(--line); border-radius: 10px; padding: 9px 11px; color: var(--text); font: 13px/1.4 var(--ui); cursor: pointer; }
    .pt-row:hover { border-color: var(--line-2); background: rgba(143,208,245,.08); } .pt-row.on { border-color: var(--accent); }
    .pt-row b { font: 700 13px var(--ui); color: var(--accent); } .pt-row span { color: var(--muted); } .pt-row i { font-style: normal; font-size: 11.5px; color: var(--lumen); white-space: nowrap; }
    .pt-filter { width: 100%; box-sizing: border-box; margin: 8px 0 4px; background: rgba(0,0,0,.25); color: var(--text); border: 1px solid var(--line-2); border-radius: 10px; padding: 9px 10px; font: 14px var(--ui); }
    .pt-all { white-space: pre-wrap; font-size: 13px; color: var(--muted); }
    #race-btn, #end-race, .modes .mode[data-mode="race"] { display: none !important; }
    .pt-bar .pt-tog { display: none; }
    @media (max-width: 760px) { .pt-bar { top: 58%; bottom: auto; left: 0; transform: none; font-size: 12.5px; border-radius: 0 12px 12px 0; border-left: 0; }
      .pt-bar .pt-tag { display: none; } .pt-bar button { padding: 7px 8px; }
      .pt-bar .pt-tog { display: block; color: var(--accent); padding: 10px 7px; font: 700 10.5px var(--ui); letter-spacing: .06em; writing-mode: vertical-rl; transform: rotate(180deg); }
      .pt-bar.pt-min > :not(.pt-tog) { display: none; }
      .pt-panel { inset: calc(var(--top-h, 56px) + var(--modes-h, 0px) + 54px) 10px auto 10px; width: auto; max-height: calc(100vh - 140px); }
      .pt-panel.pt-days { inset: calc(var(--top-h, 56px) + var(--modes-h, 0px) + 54px) 10px auto 10px; transform: none; width: auto; } }`;
  document.head.append(css);

  const bar = el("div", "pt-bar"); bar.setAttribute("role", "toolbar"); bar.setAttribute("aria-label", "Playtest");
  const tag = el("span", "pt-tag", "Playtest");
  const bDay = el("button", "pt-day", `Day ${day} ▾`), bAgain = el("button", null, "Replay"), bNext = el("button", null, "Next ›"), bNotes = el("button", null, "Notes");
  const bTog = el("button", "pt-tog", "TEST"); bTog.setAttribute("aria-label", "Playtest tools");
  // The clock to try: 20, 30 or 45 seconds a question. Applies from the next question you load (the page reloads).
  const secs = (() => { try { return +localStorage.getItem("iceberg-pt:seconds") || 20; } catch { return 20; } })();
  const bClock = el("button", "pt-clock", `${secs} s`); bClock.title = "Seconds per question (playtest only): 20, 30 or 45";
  bClock.onclick = () => { const next = { 20: 30, 30: 45, 45: 20 }[secs] || 20; try { localStorage.setItem("iceberg-pt:seconds", String(next)); } catch { } location.reload(); };
  bar.append(bTog, tag, bDay, bAgain, bNext, bNotes, bClock); bar.classList.add("pt-min");
  bTog.onclick = () => { bar.classList.toggle("pt-min"); if (bar.classList.contains("pt-min")) close(); };
  const keep = n => { n.addEventListener("keydown", e => { e.stopPropagation(); if (e.key === "Escape") close(); }); n.addEventListener("pointerdown", e => e.stopPropagation()); return n; };
  keep(bar);
  let list = null, open = null;
  const close = () => { if (open) { open.remove(); open = null; } };
  const go = n => { local.set("pt-day", n); local.del("game:" + n); local.del("day:" + n); local.del("game:practice"); location.hash = ""; location.reload(); };
  bAgain.onclick = () => go(day);
  bNext.onclick = async () => { const L = await loadList(); const i = L.findIndex(d => d.n === day); go((L[i + 1] || L[0]).n); };
  async function loadList() { if (!list) list = fetch("pt/list.json").then(r => r.json()).then(j => j.days).catch(() => []); return list; }
  loadList().then(L => { const i = L.findIndex(d => d.n === day); if (i === L.length - 1) bNext.textContent = "First ›"; });

  bDay.onclick = async () => {
    if (open && open.classList.contains("pt-days")) return close(); close();
    const p = keep(el("div", "pt-panel pt-days")); open = p;
    const x = el("button", "pt-x", "Close"); x.onclick = close;
    p.append(x, el("h3", null, "Every day"), el("p", null, "Pick any day to play it from the start. Days you've played and days with notes are marked."));
    const f = el("input", "pt-filter"); f.placeholder = "Search the questions"; f.type = "search"; p.append(f);
    const body = el("div"); p.append(body); document.body.append(p);
    const L = await loadList();
    const paint = () => {
      body.textContent = ""; const q = f.value.trim().toLowerCase();
      for (const g of Object.keys(GROUPS)) {
        const rows = L.filter(d => d.group === g && (!q || d.questions.some(t => t.toLowerCase().includes(q))));
        if (!rows.length) continue;
        body.append(el("h4", null, GROUPS[g] + ` · ${rows.length}`)); const box = el("div", "pt-list"); body.append(box);
        for (const d of rows) {
          const b = el("button", "pt-row" + (d.n === day ? " on" : "")); const played = local.get("day:" + d.n, null), noted = Object.values(notes).some(v => v.day === d.n);
          b.append(el("b", null, `Day ${d.n}`), el("span", null, d.questions.join(" · ")), el("i", null, [played ? `✓ ${(played.total || 0).toLocaleString("en-US")} m` : "", noted ? "notes" : ""].filter(Boolean).join(" · ")));
          b.onclick = () => go(d.n); box.append(b);
        }
      }
    };
    f.oninput = paint; paint(); const on = body.querySelector(".pt-row.on"); if (on) on.scrollIntoView({ block: "center" });
  };

  let statusEl = null; const status = t => { if (statusEl) statusEl.textContent = t; };
  bNotes.onclick = () => {
    if (open && open.classList.contains("pt-notes")) return close(); close();
    const p = keep(el("div", "pt-panel pt-notes")); open = p;
    const x = el("button", "pt-x", "Close"); x.onclick = close;
    const cats = G() ? G().cats : [], r = G() ? G().round : -1, at = r >= 0 && r < cats.length ? r : -1;
    p.append(x, el("h3", null, `Notes · day ${day}`), el("p", null, "Thoughts and revisions. They save as you type. The clock keeps running while you write, so between questions is easiest."));
    const area = (label, q) => {
      const t = keep(el("textarea")); const n = notes[idOf(day, q)]; t.value = n ? n.text : ""; t.placeholder = q === "day" ? "The day as a whole: balance, order, difficulty…" : "This question: wording, answers that should count, rarity…";
      let timer = 0; t.oninput = () => { status("…"); clearTimeout(timer); timer = setTimeout(() => saveNote(day, q, t.value), 400); };
      p.append(el("div", "pt-q", label), t); return t;
    };
    let first = null;
    if (at >= 0) first = area(`Question ${at + 1}: ${cats[at].prompt || cats[at].title}`, at);
    area("The whole day", "day");
    const others = cats.map((c, i) => i).filter(i => i !== at);
    if (others.length) {
      const d = el("details"); const s = el("summary", null, "Other questions today"); s.style.cssText = "cursor:pointer;margin-top:14px;color:var(--muted);font-weight:600"; d.append(s); p.append(d);
      others.forEach(i => { const before = p.children.length; area(`Question ${i + 1}: ${cats[i].prompt || cats[i].title}`, i); while (p.children.length > before) d.append(p.children[before]); });
    }
    statusEl = el("div", "pt-status", db ? "Notes are kept with this playtest page." : "Notes are kept on this device."); p.append(statusEl);
    const all = el("details"); all.append(Object.assign(el("summary", null, "All my notes"), { style: "cursor:pointer;margin-top:10px;color:var(--muted);font-weight:600" }));
    const pre = el("div", "pt-all"); all.append(pre); all.ontoggle = () => { pre.textContent = Object.values(notes).sort((a, b) => a.day - b.day || String(a.q).localeCompare(String(b.q))).map(v => `Day ${v.day} · ${v.q === "day" ? "whole day" : "Q" + v.q + " " + v.prompt}\n${v.text}`).join("\n\n") || "None yet."; };
    p.append(all);
    document.body.append(p); (first || p.querySelector("textarea")).focus({ preventScroll: true });
  };
  function paintAll() { if (open && open.classList.contains("pt-notes") && !open.contains(document.activeElement)) { close(); bNotes.click(); } }
  document.addEventListener("keydown", e => { if (e.key === "Escape" && open) close(); });
  const mount = () => document.body.append(bar);
  if (document.body) mount(); else addEventListener("DOMContentLoaded", mount);
})();
