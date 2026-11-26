// Question and answer review, inside the private playtest (opened from its bar). Loaded only there.
// Every question in the bank with its answers, other names, estimated rarity, reference coverage and automatic checks;
// search by question or by answer; approve, reject or mark a question for work; flag wrong answers; add missing ones;
// and the answers reported while playing ("I think this counts", "Dispute"), with what the game decided.
// Decisions are saved on this device and, inside the claude.ai artifact, in its database (collection "review"), where
// they can be read back and applied to the answer lists. Nothing here changes the live game by itself.
(function () {
  "use strict";
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  const est = s => s == null ? "no estimate" : s >= 0.1 ? `~${Math.round(s * 20) * 5}%` : s >= 0.01 ? `~${Math.round(s * 100)}%` : s >= 0.001 ? `~${+(s * 100).toFixed(1)}%` : s >= 0.0001 ? "under 0.1%" : "under 0.01%";
  const CHECK = { thin: "Thin list", "no-reference": "No reference list", "few-names": "Few other names", "low-coverage": "Low coverage", broad: "Broad prompt", judgement: "Needs a bar", "no-rules": "No rules" };
  // The review statuses a question moves through before it can enter the live rotation.
  const STATUS = { draft: "Draft", research: "Needs research", expand: "Needs answer expansion", clarify: "Needs clarification", playtest: "Ready for playtesting", approved: "Approved for production", rejected: "Rejected" };
  let data = null, host = null, store = null, decisions = {}, tab = "questions", filt = { q: "", status: "", source: "", check: "" }, open = null, limit = 80;

  function save(id) {
    const d = decisions[id]; d.at = Date.now();
    store.local.set("review", decisions);
    const db = store.db(); if (db) db.collection("review").doc(id).set(d).catch(() => {});
  }
  const dec = id => (decisions[id] = decisions[id] || { id, status: "", note: "", added: [], flagged: {} });

  async function load() {
    decisions = store.local.get("review", {});
    const db = store.db();
    if (db) try { const snap = await db.collection("review").get(); (snap.docs || snap || []).forEach(d => { const v = d.data ? d.data() : d; if (v && v.id && (!decisions[v.id] || (v.at || 0) > (decisions[v.id].at || 0))) decisions[v.id] = v; }); store.local.set("review", decisions); } catch { }
    if (!data) data = await fetch("pt/review.json").then(r => r.json());
  }

  function shell() {
    host = el("div", "rv"); host.setAttribute("role", "dialog"); host.setAttribute("aria-label", "Question review");
    const top = el("div", "rv-top"), x = el("button", "rv-x", "Close"); x.onclick = close;
    const tabs = el("div", "rv-tabs");
    for (const [k, t] of [["questions", "Questions"], ["answers", "Find an answer"], ["reports", "Reported while playing"], ["coverage", "Weakest coverage"]]) {
      const b = el("button", k === tab ? "on" : "", t); b.onclick = () => { tab = k; open = null; render(); }; tabs.append(b);
    }
    top.append(el("b", null, "Question review"), tabs, x);
    host.append(top, el("div", "rv-body")); document.body.append(host);
    addEventListener("keydown", esc, true);
  }
  const esc = e => { if (e.key === "Escape" && host) { e.stopPropagation(); if (open) { open = null; render(); } else close(); } };
  function close() { removeEventListener("keydown", esc, true); if (host) host.remove(); host = null; }
  const body = () => host.querySelector(".rv-body");
  const chip = (t, cls) => el("span", "rv-chip " + (cls || ""), t);

  function render() {
    host.querySelectorAll(".rv-tabs button").forEach(b => b.classList.toggle("on", b.textContent.startsWith({ questions: "Questions", answers: "Find", reports: "Reported", coverage: "Weakest" }[tab])));
    const b = body(); b.textContent = ""; b.scrollTop = 0;
    if (open) return detail(b, open);
    ({ questions, answers, reports, coverage })[tab](b);
  }

  // ---------- Questions ----------
  function questions(b) {
    const bar = el("div", "rv-filters"), q = el("input", "rv-search"); q.placeholder = "Search questions"; q.value = filt.q;
    q.oninput = () => { filt.q = q.value; limit = 80; list(); };
    const sel = (key, opts) => { const s = el("select"); for (const [v, t] of opts) { const o = el("option", null, t); o.value = v; s.append(o); } s.value = filt[key]; s.onchange = () => { filt[key] = s.value; limit = 80; list(); }; return s; };
    bar.append(q, sel("status", [["", "Any status"], ["none", "Not reviewed"], ...Object.entries(STATUS)]),
      sel("source", [["", "Anywhere"], ["curated", "Curated set (new)"], ["live", "Live"], ["scheduled", "Scheduled"], ["bank", "Bank"], ["v3 candidate", "v3 candidates"], ["v4 candidate", "v4 candidates"], ["experimental", "Experimental"]]),
      sel("check", [["", "Any check"], ["ok", "Passes every check"], ...Object.entries(CHECK)]));
    const counts = el("p", "rv-count"), ul = el("div", "rv-list");
    b.append(bar, counts, ul);
    function list() {
      const n = norm(filt.q);
      const rows = data.questions.filter(x => (!n || norm(x.prompt).includes(n) || x.id.includes(n)) && (!filt.source || x.sources.includes(filt.source))
        && (!filt.status || (filt.status === "none" ? !(decisions[x.id] && decisions[x.id].status) : decisions[x.id] && decisions[x.id].status === filt.status))
        && (!filt.check || (filt.check === "ok" ? !x.checks.length : x.checks.some(c => c[0] === filt.check))));
      const done = data.questions.filter(x => decisions[x.id] && decisions[x.id].status).length;
      counts.textContent = `${rows.length} of ${data.questions.length} questions · ${done} reviewed`;
      ul.textContent = "";
      rows.slice(0, limit).forEach(x => {
        const r = el("button", "rv-row"), d = decisions[x.id];
        r.append(el("span", "rv-prompt", x.prompt), el("span", "rv-meta", `${x.n} answers · ${x.aliases} other names${x.reference ? ` · reference ${Math.round(100 * x.reference.covered)}%` : ""} · ${x.sources.join(", ")}${x.days.length ? ` · day ${x.days.slice(0, 3).join(", ")}` : ""}`));
        const chips = el("span", "rv-chips"); x.checks.forEach(c => chips.append(chip(CHECK[c[0]] || c[0], "warn")));
        if (d && d.status) chips.prepend(chip(STATUS[d.status], d.status));
        r.append(chips); r.onclick = () => { open = x; render(); }; ul.append(r);
      });
      if (rows.length > limit) { const m = el("button", "rv-more", `Show more (${rows.length - limit})`); m.onclick = () => { limit += 200; list(); }; ul.append(m); }
    }
    list(); q.focus();
  }

  function detail(b, x) {
    const d = dec(x.id);
    const back = el("button", "rv-back", "‹ All questions"); back.onclick = () => { open = null; render(); };
    b.append(back, el("h2", null, x.prompt));
    if (x.hint) b.append(el("p", "rv-hint", x.hint));
    const meta = el("p", "rv-meta", `${x.id} · ${x.sources.join(", ")}${x.days.length ? ` · days ${x.days.join(", ")}` : ""}${x.mode ? ` · ${x.mode} round` : ""}${x.kb_name ? ` · reference list: ${x.kb_name}` : ""}`); b.append(meta);
    if (x.rules.length) { const ul = el("ul", "rv-rules"); x.rules.forEach(r => ul.append(el("li", null, r))); b.append(el("h4", null, "What counts"), ul); }
    if (x.checks.length) { const ul = el("ul", "rv-checks"); x.checks.forEach(c => ul.append(el("li", null, `${CHECK[c[0]] || c[0]}: ${c[1]}`))); b.append(el("h4", null, "Automatic checks"), ul); }
    if (x.verdict) b.append(el("h4", null, "Researcher's verdict"), el("p", null, `${x.verdict[0] || "—"}: ${x.verdict[1] || ""}`));
    if (x.granularity) b.append(el("p", "rv-meta", `One answer is: ${x.granularity}${x.mechanic ? ` · round: ${x.mechanic}` : ""}`));
    if (x.invalid && x.invalid.length) { const ul = el("ul", "rv-rules"); x.invalid.forEach(t => ul.append(el("li", null, t))); b.append(el("h4", null, "Plausible answers that don't count"), ul); }
    if (x.gaps && x.gaps.length) {
      // Answers an independent tester (who never saw this list) gave as valid, that the list doesn't have yet.
      b.append(el("h4", null, `Missing, found by the independent test (${x.gaps.length})`));
      const ul = el("ul", "rv-rules");
      x.gaps.forEach(t => { const li = el("li", null, t + " "), added = (d.added || []).some(a => norm(a.a) === norm(t));
        const bt = el("button", "rv-link", added ? "added" : "add as an answer"); bt.disabled = added;
        bt.onclick = () => { d.added = d.added || []; d.added.push({ a: t, al: [], from: "challenge test" }); save(x.id); render(); }; li.append(bt); ul.append(li); });
      b.append(ul);
    }
    if (x.notes) b.append(el("h4", null, "Research notes"), el("p", "rv-meta", x.notes));
    if (x.sources_urls && x.sources_urls.length) { const p = el("p", "rv-meta", "Sources: "); x.sources_urls.forEach((u, i) => { if (/^https:\/\//.test(u)) { const a = el("a", null, u.replace(/^https:\/\/(www\.)?/, "").slice(0, 60)); a.href = u; a.target = "_blank"; a.rel = "noopener"; p.append(i ? " · " : "", a); } }); b.append(p); }
    if (x.reference) b.append(el("p", "rv-meta", `Reference list ${x.reference.name}: ${x.reference.size} entries, ${Math.round(100 * x.reference.covered)}% already on this question's own list. Not on it, for example: ${x.reference.missing.join(", ")}.`));

    // Decision.
    const box = el("div", "rv-decide");
    for (const [k, t] of Object.entries(STATUS)) { const bt = el("button", "rv-st " + k + (d.status === k ? " on" : ""), t); bt.onclick = () => { d.status = d.status === k ? "" : k; save(x.id); render(); }; box.append(bt); }
    const note = el("textarea", "rv-note"); note.placeholder = "Notes: what to change, a better wording, answers that worry you"; note.value = d.note || "";
    let tm = 0; note.oninput = () => { clearTimeout(tm); tm = setTimeout(() => { d.note = note.value; save(x.id); }, 400); };
    const pr = el("input", "rv-reword"); pr.placeholder = "Suggested wording (optional)"; pr.value = d.prompt || "";
    pr.oninput = () => { clearTimeout(tm); tm = setTimeout(() => { d.prompt = pr.value; save(x.id); }, 400); };
    b.append(el("h4", null, "Your decision"), box, pr, note);

    // Add a missing answer.
    const add = el("form", "rv-add"), an = el("input"), aa = el("input"), ab = el("button", null, "Add answer");
    an.placeholder = "Missing answer"; aa.placeholder = "Other names, comma separated (optional)";
    add.onsubmit = e => { e.preventDefault(); const a = an.value.trim(); if (!a) return; d.added = d.added || []; d.added.push({ a, al: aa.value.split(",").map(s => s.trim()).filter(Boolean) }); save(x.id); render(); };
    add.append(an, aa, ab);
    b.append(el("h4", null, `Answers you've added (${(d.added || []).length})`), add);
    if ((d.added || []).length) { const ul = el("ul", "rv-added"); d.added.forEach((r, i) => { const li = el("li", null, r.a + (r.al.length ? ` (${r.al.join(", ")})` : "")); const rm = el("button", "rv-link", "remove"); rm.onclick = () => { d.added.splice(i, 1); save(x.id); render(); }; li.append(" ", rm); ul.append(li); }); b.append(ul); }

    // The answers themselves.
    const f = el("input", "rv-search"); f.placeholder = `Search ${x.n} answers`;
    const tbl = el("div", "rv-answers");
    b.append(el("h4", null, "Accepted answers (estimated popularity, most common first)"), f, tbl);
    const rows = x.answers.slice().sort((a, c) => (c[1] || 0) - (a[1] || 0));
    const paint = () => {
      const n = norm(f.value); tbl.textContent = "";
      const show = rows.filter(r => !n || norm(r[0]).includes(n) || r[2].some(a => norm(a).includes(n)));
      show.slice(0, 300).forEach(r => {
        const flagged = d.flagged && d.flagged[r[0]];
        const row = el("div", "rv-ans" + (flagged ? " flagged" : ""));
        row.append(el("span", "rv-a", r[0]), el("span", "rv-al", r[2].join(", ")), el("span", "rv-s", (r[3] ? "est. from reference · " : r[4] ? r[4].replace("_", " ") + " · " : "") + est(r[1])));
        const fl = el("button", "rv-link", flagged ? "unflag" : "flag as wrong");
        fl.onclick = () => { d.flagged = d.flagged || {}; if (flagged) delete d.flagged[r[0]]; else d.flagged[r[0]] = prompt("Why is this wrong? (optional)") || "wrong"; save(x.id); paint(); };
        row.append(fl); tbl.append(row);
      });
      if (show.length > 300) tbl.append(el("p", "rv-meta", `${show.length - 300} more: search to narrow`));
    };
    f.oninput = paint; paint();
  }

  // ---------- One answer across every question ----------
  function answers(b) {
    const q = el("input", "rv-search"); q.placeholder = "Search every question's answers and other names (e.g. sbrinz, quant)";
    const out = el("div", "rv-list"); b.append(q, out);
    q.oninput = () => {
      const n = norm(q.value); out.textContent = ""; if (n.length < 2) return;
      let hits = 0;
      for (const x of data.questions) {
        const m = x.answers.filter(r => norm(r[0]).includes(n) || r[2].some(a => norm(a).includes(n)));
        if (!m.length) continue;
        const r = el("button", "rv-row"); r.append(el("span", "rv-prompt", x.prompt), el("span", "rv-meta", m.slice(0, 6).map(a => `${a[0]} (${est(a[1])})`).join(" · ") + (m.length > 6 ? ` · +${m.length - 6}` : "")));
        r.onclick = () => { open = x; tab = "questions"; render(); }; out.append(r);
        if (++hits >= 150) break;
      }
      if (!hits) out.append(el("p", "rv-meta", "On no question's list. If it should count somewhere, open that question and add it."));
    };
    q.focus();
  }

  // ---------- Reported while playing ----------
  function reports(b) {
    const list = (window.PTReports ? window.PTReports() : []).slice().reverse();
    b.append(el("p", "rv-meta", list.length ? `${list.length} answers reported from the results screen ("I think this counts" or "Dispute"), newest first.` : "Nothing reported yet. In the results after a question, press “I think this counts” or “Dispute” next to an answer and it appears here."));
    list.forEach(r => {
      const x = data.questions.find(q => q.id === r.key);
      const row = el("div", "rv-report");
      row.append(el("b", null, `“${r.text}”`), el("span", "rv-meta", ` · ${r.prompt || r.key} · day ${r.day} · the game said: ${r.reason || r.result || r.kind} · ${new Date(r.at).toLocaleString()}`));
      if (x) {
        const d = dec(x.id), added = (d.added || []).some(a => norm(a.a) === norm(r.text));
        const ok = el("button", "rv-link", added ? "added to answers" : "add to this question's answers"); ok.disabled = added;
        ok.onclick = () => { d.added = d.added || []; d.added.push({ a: r.text, al: [], from: "report" }); save(x.id); render(); };
        const go = el("button", "rv-link", "open question"); go.onclick = () => { open = x; tab = "questions"; render(); };
        row.append(" ", ok, " ", go);
      }
      b.append(row);
    });
  }

  // ---------- Weakest coverage ----------
  function coverage(b) {
    b.append(el("p", "rv-meta", "Questions in use or scheduled, weakest first: lists that cover least of an independent reference list, then short lists with no reference list at all. These are where fair, rarer answers are most often turned away."));
    const rows = data.questions.filter(x => x.sources.some(s => ["live", "scheduled", "set"].includes(s)))
      .sort((a, c) => ((a.reference ? a.reference.covered : 1) - (c.reference ? c.reference.covered : 1)) || (a.n - c.n)).slice(0, 120);
    const ul = el("div", "rv-list"); b.append(ul);
    rows.forEach(x => {
      const r = el("button", "rv-row");
      r.append(el("span", "rv-prompt", x.prompt), el("span", "rv-meta", x.reference ? `covers ${Math.round(100 * x.reference.covered)}% of ${x.reference.size} in ${x.reference.name}` : `${x.n} answers, no reference list`));
      r.onclick = () => { open = x; tab = "questions"; render(); }; ul.append(r);
    });
  }

  const css = el("style"); css.textContent = `
    .rv { position: fixed; inset: 0; z-index: 80; background: var(--bg, #040917); color: var(--text, #eaf3ff); display: flex; flex-direction: column; font: 14px/1.45 var(--ui, system-ui); }
    .rv-top { display: flex; align-items: center; gap: 12px; padding: 10px 16px; border-bottom: 1px solid var(--line-2, rgba(143,208,245,.2)); flex-wrap: wrap; }
    .rv-top > b { font-size: 15px; } .rv-tabs { display: flex; gap: 4px; flex-wrap: wrap; flex: 1; }
    .rv button { font: inherit; color: inherit; cursor: pointer; } .rv-tabs button, .rv-x { background: none; border: 0; padding: 7px 10px; border-radius: 8px; color: var(--muted, #93a9cc); }
    .rv-tabs button.on { background: rgba(143,208,245,.14); color: var(--text, #fff); } .rv-x:hover, .rv-tabs button:hover { color: var(--text, #fff); }
    .rv-body { flex: 1; overflow: auto; padding: 14px 16px 60px; max-width: 980px; width: 100%; box-sizing: border-box; margin: 0 auto; }
    .rv-filters { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; } .rv select, .rv input, .rv textarea { font: inherit; color: inherit; background: rgba(0,0,0,.3); border: 1px solid var(--line-2, rgba(143,208,245,.25)); border-radius: 8px; padding: 8px 10px; box-sizing: border-box; }
    .rv-search { flex: 1; min-width: 200px; width: 100%; } .rv-filters .rv-search { width: auto; }
    .rv-count, .rv-meta { color: var(--muted, #93a9cc); font-size: 12.5px; margin: 4px 0; }
    .rv-list { display: grid; gap: 6px; } .rv-row { text-align: left; background: rgba(143,208,245,.05); border: 1px solid transparent; border-radius: 10px; padding: 9px 12px; display: grid; gap: 3px; }
    .rv-row:hover { border-color: var(--line-2, rgba(143,208,245,.3)); } .rv-prompt { font-weight: 600; }
    .rv-chips { display: flex; gap: 4px; flex-wrap: wrap; } .rv-chip { font-size: 11px; font-weight: 600; padding: 1px 7px; border-radius: 999px; background: rgba(143,208,245,.12); color: var(--accent, #8fd0f5); }
    .rv-chip.warn { background: rgba(255,180,120,.12); color: #ffc49a; } .rv-chip.approved { background: rgba(125,240,180,.15); color: #8ff0bd; } .rv-chip.rejected { background: rgba(255,120,120,.15); color: #ff9c9c; } .rv-chip.draft, .rv-chip.research, .rv-chip.expand, .rv-chip.clarify { background: rgba(255,220,120,.15); color: #ffe08a; } .rv-chip.playtest { background: rgba(125,240,180,.1); color: #8ff0bd; }
    .rv-more, .rv-back { background: none; border: 0; color: var(--accent, #8fd0f5); padding: 8px 0; }
    .rv h2 { margin: 6px 0; font-size: 20px; } .rv h4 { margin: 18px 0 6px; font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted, #93a9cc); }
    .rv-hint { color: var(--muted, #93a9cc); margin: 0; } .rv ul { margin: 0; padding-left: 18px; color: var(--muted, #93a9cc); }
    .rv-decide { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; } .rv-st { border: 1px solid var(--line-2, rgba(143,208,245,.25)); background: none; border-radius: 8px; padding: 7px 12px; }
    .rv-st.on { background: #7a6420; border-color: #7a6420; } .rv-st.on.approved, .rv-st.on.playtest { background: #1f6f49; border-color: #1f6f49; } .rv-st.on.rejected { background: #7a2a2a; border-color: #7a2a2a; }
    .rv a { color: var(--accent, #8fd0f5); }
    .rv-note { width: 100%; min-height: 70px; margin-top: 6px; } .rv-reword { width: 100%; }
    .rv-add { display: flex; gap: 6px; flex-wrap: wrap; } .rv-add input { flex: 1; min-width: 180px; } .rv-add button { background: var(--accent, #8fd0f5); color: #06112a; border: 0; border-radius: 8px; padding: 8px 12px; font-weight: 700; }
    .rv-answers { margin-top: 6px; display: grid; } .rv-ans { display: grid; grid-template-columns: minmax(120px, 1.2fr) 2fr auto auto; gap: 8px; padding: 5px 2px; border-bottom: 1px solid rgba(143,208,245,.08); align-items: baseline; }
    .rv-ans.flagged .rv-a { text-decoration: line-through; color: #ff9c9c; } .rv-al { color: var(--muted, #93a9cc); font-size: 12.5px; overflow-wrap: anywhere; } .rv-s { color: var(--faint, #62799e); font-size: 12px; white-space: nowrap; }
    .rv-link { background: none; border: 0; color: var(--accent, #8fd0f5); padding: 0; font-size: 12.5px; text-decoration: underline; text-underline-offset: 2px; } .rv-link:disabled { color: var(--muted); text-decoration: none; cursor: default; }
    .rv-report { padding: 8px 0; border-bottom: 1px solid rgba(143,208,245,.08); }
    @media (max-width: 640px) { .rv-ans { grid-template-columns: 1fr auto; } .rv-al { grid-column: 1 / -1; order: 3; } }`;
  document.head.append(css);

  window.PTReview = { async open(s) { store = s; shell(); body().append(el("p", "rv-meta", "Loading the question bank…")); try { await load(); } catch { body().textContent = "Couldn't load the question bank."; return; } render(); } };
})();
