// The pages around the game: the dive log (profile and calendar), friends, rankings, settings and sign-in.
// One page, "the hub", with a few tabs. It reads everything through account.js, so what a player can see here is
// decided by the database, not by this file. Guests get the log for this device and an invitation to sign in.
(function () {
  "use strict";
  const A = window.Account, $ = s => document.querySelector(s), G = () => window.Game;
  // h("div.cls", { onclick }, child, ...): a small element builder. Strings become text, so nothing typed by a player is ever read as markup.
  function h(spec, attrs, ...kids) {
    const [tag, ...cls] = spec.split("."), n = document.createElement(tag || "div");
    if (cls.length) n.className = cls.join(" ");
    if (attrs && (typeof attrs !== "object" || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
    for (const [k, v] of Object.entries(attrs || {})) { if (v == null || v === false) continue; if (k.startsWith("on")) n[k] = v; else if (k === "html") n.innerHTML = v; else if (k in n && k !== "list") n[k] = v; else n.setAttribute(k, v === true ? "" : v); }
    for (const k of kids.flat()) if (k != null && k !== false) n.append(k);
    return n;
  }
  const ICON = {
    person: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5 15.5 7 12 10.5 8.5 7z"/><path d="M4.5 20c.6-4 3.6-6 7.5-6s6.900 2 7.500 6"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  };
  const fmt = n => Number(n).toLocaleString("en-US"), m = n => `${fmt(n)} m`;
  const dateText = (day, long) => G().dateOf(day).toLocaleDateString("en-US", long ? { weekday: "long", day: "numeric", month: "long", year: "numeric" } : { day: "numeric", month: "short" });
  const avatar = (key, cls = "") => { const c = document.createElement("canvas"); if (window.Wildlife) window.Wildlife.portrait(c, key || "dumbo"); return h("span.av" + (cls ? "." + cls : ""), { "aria-hidden": "true" }, c); };
  const plural = (n, w) => `${fmt(n)} ${w}${n === 1 ? "" : "s"}`;
  const body = () => $("#hub-body");
  let route = { view: "" }, token = 0, rankState = { scope: "global", day: 0 }, lastPage = null, mode = "in";

  // ---------- Getting about ----------
  const go = (...parts) => { const hash = "#" + parts.filter(x => x != null && x !== "").join("/"); if (location.hash === hash) show(); else location.hash = hash; };
  function parse() {
    const raw = decodeURIComponent(location.hash.replace(/^#\/?/, ""));
    if (!raw || raw.includes("=")) return null;                  // empty, or a sign-in link on its way back from Supabase
    const [view, a, b] = raw.split("/");
    return ["log", "friends", "ranks", "settings", "account", "u", "dive", "vs"].includes(view) ? { view, a, b } : null;
  }
  function show() {
    const r = parse(), game = G(); if (!game) return;
    if (!r) { route = { view: "" }; if (game.screen === "hub" || game.screen === "dive") { if (window.Viewer) window.Viewer.close(); game.openEnd(); } return; }
    if (r.view === "account" && route.view !== "account") mode = "in";      // arriving fresh: start at "Sign in"
    if (game.playing && game.screen === "play") { history.replaceState(null, "", location.pathname + location.search); return; }   // not in the middle of a question
    route = r;
    if (r.view === "dive" || r.view === "vs") { if (window.Viewer) window.Viewer.open(r.a, +r.b || game.today(), r.view === "vs"); return; }
    if (window.Viewer) window.Viewer.close();
    lastPage = location.hash; game.show("hub"); render();
  }
  const leave = () => { history.replaceState(null, "", location.pathname + location.search); show(); };
  addEventListener("hashchange", show);

  function tabs() {
    const st = A ? A.state : "off", reqs = st === "in" && A.profile.requests ? A.profile.requests : 0, cur = route.view === "u" ? "friends" : route.view;
    const tab = (id, label, n) => h("button", { type: "button", "aria-current": cur === id ? "page" : null, onclick: () => go(id) }, label, n ? h("span.n", String(n)) : null);
    const list = [tab("log", "Dive log")];
    if (st !== "off") list.push(tab("friends", "Friends", reqs), tab("ranks", "Rankings"), st === "in" ? tab("settings", "Settings") : tab("account", st === "new" ? "Finish signing up" : "Sign in"));
    const nav = $("#hub-tabs"); nav.textContent = ""; nav.append(...list);
    const flag = $("#hub-demo"); flag.hidden = !(A && A.demo);
    if (!flag.hidden && !flag.querySelector("button")) flag.append(" ", h("button.link", { type: "button", onclick: () => G().demo.set(false) }, "Leave the demonstration"));
  }
  function render() {
    if (G().screen !== "hub") return;
    tabs(); const mine = ++token, box = body(); box.textContent = ""; window.scrollTo(0, 0);
    const st = A ? A.state : "off", v = route.view;
    const view = v === "account" ? account : st === "new" ? account : v === "u" ? t => log(route.a, t) : v === "friends" ? friends : v === "ranks" ? ranks : v === "settings" ? settings : t => log(null, t);
    Promise.resolve(view(mine)).catch(e => { if (mine === token) { box.textContent = ""; box.append(h("p.note-line", e.message || "Something went wrong."), h("button.btn.ghost.small", { type: "button", onclick: render }, "Try again")); } });
  }
  const stale = t => t !== token;
  const wait = () => { body().append(h("p.note-line.wait", "Loading…")); };
  const needAccount = what => { body().append(h("div.lead", h("h2.title", what.title), h("p.note-line", what.text), h("div.row", h("button.btn", { type: "button", onclick: () => go("account") }, "Sign in or create an account")))); };
  async function act(btn, fn, after) {
    if (btn) btn.disabled = true;
    try { await fn(); await A.refresh(); if (after) after(); else render(); }
    catch (e) { if (btn) { btn.disabled = false; const row = btn.closest("li, .row, form") || btn.parentNode; let msg = row.querySelector(".msg"); if (!msg) { msg = h("span.msg.bad"); row.append(msg); } msg.textContent = e.message; } }
  }

  // ---------- The dive log: a profile, and the calendar ----------
  // Colour by the day's total depth. One scale everywhere, shown in the key beneath the calendar.
  const LEVELS = [[800, "l4", "800 m or more"], [500, "l3", "500 m"], [200, "l2", "200 m"], [0, "l1", "a finished dive"]];
  const levelOf = total => LEVELS.find(l => total >= l[0])[1];
  function calendar(days, opts) {
    const game = G(), today = game.today(), byDay = new Map(days.map(d => [d.day, d])), wrap = h("div.cal-wrap"), grid = h("div.cal", { role: "grid", "aria-label": "Dive calendar: one square per day" }), detail = h("div.cal-day", { "aria-live": "polite" });
    const end = game.dateOf(today), startCol = new Date(end); startCol.setDate(end.getDate() - end.getDay() - 52 * 7);     // 53 weeks, Sunday at the top
    let picked = null, lastMonth = -1;
    const pick = (day, cell) => {
      if (picked) picked.classList.remove("sel"); picked = cell; cell.classList.add("sel");
      const d = byDay.get(day), parts = [h("b", dateText(day, true)), ` · Daily #${day}`];
      detail.textContent = "";
      if (day > today) parts.push(" · not yet");
      else if (!d) parts.push(day === today ? " · not finished yet" : " · no dive");
      else {
        parts.push(` · ${m(d.total)} total · deepest ${m(d.max_depth)}`);
        if (d.deepest_answer) parts.push(" (", h("i", d.deepest_answer), ")");
        if (d.rank && d.players) parts.push(` · ${d.ranked === false ? "would place" : "placed"} #${fmt(d.rank)} of ${fmt(d.players)}`);
      }
      detail.append(h("span", parts));
      if (d && opts.open && opts.open(d)) detail.append(h("button.link", { type: "button", onclick: () => opts.open(d)() }, "Open this dive"));
    };
    for (let w = 0; w < 53; w++) {
      const first = new Date(startCol); first.setDate(startCol.getDate() + w * 7);
      const label = h("span.m"); for (let k = 0; k < 7; k++) { const dt = new Date(first); dt.setDate(first.getDate() + k); if (dt.getDate() === 1) { if (dt.getMonth() !== lastMonth) { label.textContent = dt.toLocaleDateString("en-US", { month: "short" }); lastMonth = dt.getMonth(); } } }
      grid.append(label);
      for (let k = 0; k < 7; k++) {
        const dt = new Date(first); dt.setDate(first.getDate() + k);
        const day = Math.round((dt - game.dateOf(1)) / 86400000) + 1, d = byDay.get(day);
        const cls = day < 1 ? "pre" : day > today ? "future" : d ? levelOf(d.total) + (d.max_depth >= 200 ? " abyss" : "") : day === today ? "open" : "none";
        const state = day < 1 ? "" : day > today ? "not yet" : d ? `${m(d.total)}` : day === today ? "not finished yet" : "no dive";
        const cell = h("button." + cls.replace(/ /g, ".") + (day === today ? ".today" : ""), { type: "button", tabIndex: day < 1 ? -1 : 0, disabled: day < 1, "aria-label": day < 1 ? null : `${dt.toLocaleDateString("en-US", { day: "numeric", month: "long" })}: ${state}`, "data-day": day });
        if (day >= 1) { cell.onclick = () => pick(day, cell); cell.onmouseenter = () => { if (matchMedia("(hover: hover)").matches) pick(day, cell); }; }
        grid.append(cell);
        if (day === (opts.select || today)) setTimeout(() => pick(day, cell), 0);
      }
    }
    wrap.append(grid); setTimeout(() => { wrap.scrollLeft = wrap.scrollWidth; }, 0);
    const key = h("div.cal-key", h("span", "Total depth for the day:"), h("span", h("i.none"), "no dive"), ...LEVELS.slice().reverse().map(l => h("span", h("i." + l[1]), l[2])), h("span", h("i.l2.abyss"), "an answer in the Abyss"));
    return h("div.cal-block", wrap, detail, key);
  }
  const stat = (label, value, sub) => h("div.stat", h("span", label), h("b", value), sub ? h("small", sub) : null);
  function statsGrid(s, own) {
    const cells = [stat("Daily streak", plural(s.streak || 0, "day")), stat("Longest streak", plural(s.longest || 0, "day")), stat("Total expeditions", fmt(s.dives || 0), s.first_day ? `since ${dateText(s.first_day)}` : "")];
    if (s.best_total !== undefined) cells.push(stat("Average depth", m(s.average || 0), "a day"), stat("Personal record", m(s.best_total || 0), s.best_total_day ? `Daily #${s.best_total_day}` : ""),
      stat("Deepest discovery", m(s.best_depth || 0), s.best_depth_answer ? s.best_depth_answer : s.best_depth_day ? (own ? `Daily #${s.best_depth_day}` : "answer hidden for now") : ""));
    return h("div.stats", cells);
  }
  function recent(days, open, own) {
    if (!days.length) return h("p.note-line", own === false ? "No dives yet." : "No dives yet. Finish today's and it will appear here.");
    return h("ul.rows", days.slice(-6).reverse().map(d => { const fn = open && open(d); return h("li", h("span.rank-n", "#" + d.day), h("div", h("div.name", dateText(d.day, false)), h("div.sub", d.deepest_answer ? `deepest: ${d.deepest_answer}` : `deepest ${m(d.max_depth)}`, d.rank && d.players ? ` · #${fmt(d.rank)} of ${fmt(d.players)}` : "")),
      h("div.val", m(d.total), fn ? h("button.link", { type: "button", onclick: fn }, "Open") : null)); }));
  }
  // What this device remembers, for guests (and as the base everyone starts from).
  function localLog() {
    const game = G(), days = game.days().map(r => { const best = r.rounds.filter(x => x.name).sort((a, b) => b.depth - a.depth)[0]; return { day: r.day, total: r.total, max_depth: best ? best.depth : 0, deepest_answer: best ? best.name : null, local: true }; });
    const st = game.streak(), top = days.slice().sort((a, b) => b.total - a.total)[0], deep = days.slice().sort((a, b) => b.max_depth - a.max_depth)[0];
    return { days, stats: { streak: st.count, longest: st.longest, dives: days.length, first_day: days.length ? days[0].day : null, average: days.length ? Math.round(days.reduce((t, d) => t + d.total, 0) / days.length) : 0,
      best_total: top ? top.total : 0, best_total_day: top ? top.day : null, best_depth: deep ? deep.max_depth : 0, best_depth_day: deep ? deep.day : null, best_depth_answer: deep ? deep.deepest_answer : null } };
  }
  async function log(username, t) {
    const game = G(), box = body(), st = A ? A.state : "off", own = !username || (st === "in" && username.toLowerCase() === A.profile.username.toLowerCase());
    if (!own && st !== "in") return needAccount({ title: "Players' logs", text: "Sign in to see other players." });
    let p, days, stats;
    if (st === "in") { wait(); p = await A.rpc("profile_of", { p_username: own ? A.profile.username : username }); if (stale(t)) return; box.textContent = ""; days = p.calendar; stats = p.stats; if (own) stats.streak = game.streak().count; }
    else { const l = localLog(); days = l.days; stats = l.stats; }
    const openDay = d => (own || (p && p.can_explore)) ? () => go("dive", own ? (st === "in" ? A.profile.username : "me") : p.username, d.day) : null;
    box.append(h("div.who", avatar(p ? p.avatar : "dumbo", "big"), h("div", h("p.eyebrow", own ? "Your dive log" : "Dive log"), h("h2.title", p ? p.username : "Guest"),
      h("p.note-line", p ? `Diving since ${G().dateOf(1) && new Date(p.since).toLocaleDateString("en-US", { month: "long", year: "numeric" })}` : "Kept on this device only."))));
    if (!own) box.append(relationRow(p));
    box.append(statsGrid(stats, own));
    if (days) box.append(h("div.section", h("h3", "Calendar"), calendar(days, { open: openDay })), h("div.section", h("h3", own ? "Recent dives" : "Their recent dives"), recent(days, openDay, own)));
    else box.append(h("p.note-line", p.relation === "friend" ? `${p.username} keeps their calendar private.` : "Friends can see each other's calendar and dives."));
    if (own && st === "in") box.append(h("div.row", h("button.btn.ghost.small", { type: "button", onclick: () => go("friends") }, plural(+p.friends || 0, "friend")), h("button.btn.ghost.small", { type: "button", onclick: () => go("ranks") }, "Today's rankings")));
    if (own && st === "off" && G().demo && G().demo.offered) box.append(h("div.invite", h("p", h("b", "Friends, rankings and accounts "), "need the game's database, which isn't connected to this copy. You can still see how they look."), h("button.btn.small.ghost", { type: "button", onclick: () => G().demo.set(true) }, "Preview with demonstration data")));
    if (own && st === "out") box.append(h("div.invite", h("p", h("b", "Keep this log. "), "With a free account your streak and dives follow you to any device, and you can add friends and join the daily rankings."), h("button.btn.small", { type: "button", onclick: () => go("account") }, "Create an account")));
    if (!own && p.can_explore) { const today = game.today(), theirs = (days || []).find(d => d.day === today); if (theirs) box.append(h("div.row", h("button.btn.small", { type: "button", onclick: () => go("dive", p.username, today) }, "Explore today's dive"), h("button.btn.ghost.small", { type: "button", onclick: () => go("vs", p.username, today) }, "Compare with mine"))); }
  }
  function relationRow(p) {
    const u = p.username, row = h("div.row.rel");
    const b = (label, fn, cls = "ghost") => h("button.btn.small." + cls, { type: "button", onclick: e => act(e.currentTarget, fn) }, label);
    if (p.relation === "friend") row.append(h("span.tag", "Friends"), b("Remove friend", () => A.rpc("friend_remove", { p_username: u })));
    else if (p.relation === "requested") row.append(h("span.tag", "Request sent"), b("Cancel request", () => A.rpc("friend_remove", { p_username: u })));
    else if (p.relation === "incoming") row.append(b("Accept request", () => A.rpc("friend_respond", { p_username: u, p_accept: true }), "solid"), b("Decline", () => A.rpc("friend_respond", { p_username: u, p_accept: false })));
    else row.append(b("Add friend", () => A.rpc("friend_request", { p_username: u }), "solid"));
    row.append(h("button.link.quiet", { type: "button", onclick: e => { if (confirm(`Block ${u}? You won't see each other, and any friendship ends.`)) act(e.currentTarget, () => A.rpc("block_user", { p_username: u }), () => go("friends")); } }, "Block"));
    return row;
  }

  // ---------- Friends ----------
  async function friends(t) {
    const box = body();
    if (!A || A.state !== "in") return needAccount({ title: "Friends", text: "Add friends by username, see who has finished today, and explore each other's icebergs once you have both dived." });
    const game = G(), today = game.today(); wait();
    const f = await A.rpc("friends", { p_day: today }); if (stale(t)) return; box.textContent = "";
    const results = h("ul.rows.results"), input = h("input", { type: "search", placeholder: "Find a player by username", autocomplete: "off", autocapitalize: "none", spellcheck: false, maxLength: 20, "aria-label": "Find a player by username" });
    let timer = 0;
    input.oninput = () => { clearTimeout(timer); const q = input.value.trim(); if (q.length < 2) { results.textContent = ""; return; }
      timer = setTimeout(async () => { try { const list = await A.rpc("search_users", { p_query: q }); if (input.value.trim() !== q) return; results.textContent = "";
        if (!list.length) results.append(h("li.none", h("span"), h("span.sub", `No player's name starts with “${q}”.`), h("span")));
        list.forEach(u => results.append(h("li", avatar(u.avatar, "s"), h("button.name.linkish", { type: "button", onclick: () => go("u", u.username) }, u.username),
          u.relation === "friend" ? h("span.tag", "Friends") : u.relation === "requested" ? h("span.tag", "Request sent") : h("button.btn.small.solid", { type: "button", onclick: e => act(e.currentTarget, () => u.relation === "incoming" ? A.rpc("friend_respond", { p_username: u.username, p_accept: true }) : A.rpc("friend_request", { p_username: u.username })) }, u.relation === "incoming" ? "Accept" : "Add friend"))));
      } catch (e) { results.textContent = ""; results.append(h("li.none", h("span"), h("span.sub.msg.bad", e.message), h("span"))); } }, 280); };
    box.append(h("div.lead", h("h2.title", "Friends"), h("label.field", input), results));
    if (f.incoming.length) box.append(h("div.section", h("h3", "Requests for you"), h("ul.rows", f.incoming.map(u => h("li", avatar(u.avatar, "s"), h("button.name.linkish", { type: "button", onclick: () => go("u", u.username) }, u.username),
      h("span.row", h("button.btn.small.solid", { type: "button", onclick: e => act(e.currentTarget, () => A.rpc("friend_respond", { p_username: u.username, p_accept: true })) }, "Accept"), h("button.btn.small.ghost", { type: "button", onclick: e => act(e.currentTarget, () => A.rpc("friend_respond", { p_username: u.username, p_accept: false })) }, "Decline")))))));
    const mine = f.me, done = f.friends.filter(x => x.done).length;
    const status = x => { if (!x.done) return ["Not yet today", ""]; if (!f.unlocked) return ["Finished today", "score hidden until you dive"]; const d = x.total - mine.total, dd = x.max_depth - mine.max_depth;
      return [m(x.total), `${d === 0 ? "level with you" : d > 0 ? `${m(d)} ahead of you` : `${m(-d)} behind you`} · deepest ${m(x.max_depth)}${dd > 0 ? ", deeper than yours" : ""}`]; };
    box.append(h("div.section", h("h3", "Today", h("span.aside", f.friends.length ? `${done} of ${f.friends.length} finished${mine ? ` · you: ${m(mine.total)}` : " · you haven't dived yet"}` : "")),
      f.friends.length ? h("ul.rows", f.friends.map(x => { const [val, sub] = status(x); return h("li" + (x.done ? "" : ".dim"), avatar(x.avatar, "s"), h("div", h("button.name.linkish", { type: "button", onclick: () => go("u", x.username) }, x.username), h("div.sub", x.streak ? `${x.streak}-day streak` : "no streak", sub ? " · " + sub : "")),
        h("div.val", val, x.done && f.unlocked && x.can_explore ? h("span.row", h("button.link", { type: "button", onclick: () => go("dive", x.username, today) }, "Explore"), h("button.link", { type: "button", onclick: () => go("vs", x.username, today) }, "Compare")) : null)); }))
        : h("p.note-line", "No friends yet. Search for a username above; they'll need to accept.")));
    if (!f.unlocked && done) box.append(h("p.note-line.locked", h("span", { html: ICON.lock }), "Friends' scores and icebergs open as soon as you finish today's dive."));
    if (f.outgoing.length) box.append(h("div.section", h("h3", "Waiting for an answer"), h("ul.rows", f.outgoing.map(u => h("li", avatar(u.avatar, "s"), h("span.name", u.username), h("button.btn.small.ghost", { type: "button", onclick: e => act(e.currentTarget, () => A.rpc("friend_remove", { p_username: u.username })) }, "Cancel"))))));
    if (f.blocked.length) box.append(h("details.section", h("summary", `Blocked (${f.blocked.length})`), h("ul.rows", f.blocked.map(u => h("li", h("span"), h("span.name", u), h("button.btn.small.ghost", { type: "button", onclick: e => act(e.currentTarget, () => A.rpc("block_user", { p_username: u, p_block: false })) }, "Unblock"))))));
  }

  // ---------- Rankings ----------
  async function ranks(t) {
    const box = body(), game = G(), today = game.today(), st = A ? A.state : "off";
    if (route.a && +route.a >= 1) rankState.day = Math.min(today, +route.a); if (!rankState.day) rankState.day = today;
    if (st !== "in") rankState.scope = "global";
    const day = rankState.day, scope = rankState.scope;
    const head = h("div.lead", h("h2.title", "Rankings"),
      h("div.day-step", h("button.icon-btn", { type: "button", disabled: day <= 1, "aria-label": "Earlier day", onclick: () => { rankState.day = day - 1; go("ranks", day - 1); } }, "‹"), h("span", h("b", `Daily #${day}`), ` · ${day === today ? "today" : dateText(day)}`), h("button.icon-btn", { type: "button", disabled: day >= today, "aria-label": "Later day", onclick: () => { rankState.day = day + 1; go("ranks", day + 1); } }, "›")),
      h("div.seg", { role: "tablist" }, ["global", "friends"].map(s => h("button", { type: "button", role: "tab", "aria-selected": String(scope === s), disabled: s === "friends" && st !== "in", onclick: () => { rankState.scope = s; render(); } }, s === "global" ? "Everyone" : "Friends"))));
    box.append(head); wait();
    let lb; try { lb = await A.rpc("leaderboard", { p_day: day, p_scope: scope, p_limit: 50, p_offset: 0 }); } catch (e) { if (stale(t)) return; box.querySelector(".wait").remove(); if (e.code === "not_signed_in" || st !== "in") { box.append(h("p.note-line", "Sign in to see rankings.")); return; } throw e; }
    if (stale(t)) return; box.querySelector(".wait").remove();
    if (lb.locked) { box.append(h("div.locked-panel", h("span.big", { html: ICON.lock }), h("p", h("b", day === today ? "Finish today's dive to see today's rankings." : "Finish that day's dive to see its rankings."), lb.players ? ` ${plural(lb.players, "player")} ${lb.players === 1 ? "has" : "have"} finished so far.` : ""), h("p.note-line", "Rankings show how deep everyone went, so they stay closed until you have had your own go. Earlier days are open.")),
      st === "in" && day === today ? h("div.row", h("button.btn", { type: "button", onclick: () => { leave(); } }, "Back to the game")) : null); return; }
    if (lb.me) box.append(h("p.standing", scope === "global" ? [h("b", `#${fmt(lb.me.rank)}`), ` of ${plural(lb.players, "ranked player")}`, lb.players >= 20 ? ` · top ${lb.me.top}%` : ""] : [h("b", `#${fmt(lb.me.rank)}`), ` of ${lb.players} among your friends`]));
    else if (st === "in" && scope === "global" && A.profile.settings.ranked === false) box.append(h("p.note-line", "You've chosen not to appear in the global ranking (Settings)."));
    if (!lb.rows.length) box.append(h("p.note-line", scope === "friends" ? "None of your friends dived that day." : "Nobody is ranked for that day."));
    else box.append(h("ol.rows.board", lb.rows.map(r => h("li" + (r.me ? ".me" : ""), h("span.rank-n", fmt(r.rank)), h("div.who-s", avatar(r.avatar, "s"), st === "in" && !r.me ? h("button.name.linkish", { type: "button", onclick: () => go("u", r.username) }, r.username) : h("span.name", r.username), r.me ? h("span.tag", "You") : r.friend ? h("span.tag", "Friend") : null),
      h("div.val", m(r.total), h("small", `deepest ${m(r.max_depth)}`))))));
    box.append(h("p.fine", "Ranked by the day's total depth: the deepest answer on each of the five questions, added up. Equal totals are split by the deepest single answer, then by who finished first. ", scope === "global" ? "Only players with an account who have finished the day are listed." : ""));
  }

  // ---------- Sign-in ----------
  function account() {
    const box = body(), st = A ? A.state : "off";
    if (st === "off") { box.append(h("p.note-line", "Accounts aren't switched on for this copy of the game.")); return; }
    if (A.recovery) return newPassword();
    if (st === "new") return chooseName();
    if (st === "in") { go("settings"); return; }
    const email = h("input", { type: "email", autocomplete: "email", required: true, placeholder: "you@example.com" }), pass = h("input", { type: "password", autocomplete: mode === "in" ? "current-password" : "new-password", required: true, minLength: 6, placeholder: mode === "in" ? "Password" : "At least 6 characters" });
    const msg = h("p.msg", { role: "status" }), submit = h("button.btn", { type: "submit" }, mode === "in" ? "Sign in" : "Create account");
    const form = h("form.form", { novalidate: true, onsubmit: async e => { e.preventDefault(); msg.className = "msg"; msg.textContent = ""; submit.disabled = true;
      try {
        if (mode === "forgot") { await A.recover(email.value.trim()); msg.className = "msg good"; msg.textContent = "If there's an account with that email, a link to set a new password is on its way."; }
        else if (mode === "in") await A.signIn(email.value.trim(), pass.value);
        else { const r = await A.signUp(email.value.trim(), pass.value); if (r.confirm) { msg.className = "msg good"; msg.textContent = "Check your email and follow the link to confirm your address. Then come back and sign in."; } }
      } catch (err) { msg.className = "msg bad"; msg.textContent = err.message; }
      submit.disabled = false; } },
      h("label.field", "Email", email), mode === "forgot" ? null : h("label.field", "Password", pass), msg,
      h("div.row", submit, mode === "in" ? h("button.link", { type: "button", onclick: () => { mode = "forgot"; render(); } }, "Forgot password?") : null));
    if (mode === "forgot") submit.textContent = "Email me a link";
    box.append(h("div.lead", h("h2.title", mode === "in" ? "Sign in" : mode === "up" ? "Create an account" : "Reset your password"),
      h("p.note-line", mode === "up" ? "Free. Keeps your streak and dives on any device, and lets you add friends and join the daily rankings. Your email is only used to sign you in: other players never see it." : mode === "in" ? "Welcome back." : "Enter the email you signed up with.")),
      form,
      mode === "forgot" || !A.google ? null : h("div.or", h("span", "or")), mode === "forgot" || !A.google ? null : h("button.btn.ghost", { type: "button", onclick: e => act(e.currentTarget, () => A.google(), () => {}) }, "Continue with Google"),
      h("p.note-line", mode === "in" ? ["New here? ", h("button.link", { type: "button", onclick: () => { mode = "up"; render(); } }, "Create an account")] : ["Already have one? ", h("button.link", { type: "button", onclick: () => { mode = "in"; render(); } }, "Sign in")]),
      h("p.fine", "You can always play without an account. Anything you've already played on this device moves across when you sign in. ", h("a", { href: "privacy.html" }, "Privacy")));
  }
  function nameField(current) {
    const input = h("input", { type: "text", autocomplete: "username", autocapitalize: "none", spellcheck: false, maxLength: 20, value: current || "", placeholder: "3 to 20 letters, numbers or _" }), msg = h("span.msg", { role: "status" });
    let timer = 0, okName = "";
    input.oninput = () => { clearTimeout(timer); okName = ""; const v = input.value.trim(); msg.className = "msg"; msg.textContent = ""; if (v.length < 3) return;
      timer = setTimeout(async () => { try { const r = await A.rpc("username_check", { p_username: v }); if (input.value.trim() !== v) return; msg.className = "msg " + (r.ok ? "good" : "bad"); msg.textContent = r.ok ? `${v} is free.` : A.fail("username_" + r.reason).message; if (r.ok) okName = v; } catch { /* checked again when it is sent */ } }, 300); };
    return { el: h("label.field", "Username", input, msg), input, msg };
  }
  function avatarPicker(current) {
    let value = current || "dumbo";
    const row = h("div.avatars", { role: "radiogroup", "aria-label": "Picture" }, (window.Wildlife ? window.Wildlife.PORTRAITS : ["dumbo"]).map(k => { const b = h("button", { type: "button", role: "radio", "aria-checked": String(k === value), "aria-label": k, onclick: () => { value = k; row.querySelectorAll("button").forEach(x => x.setAttribute("aria-checked", String(x === b))); } }, avatar(k)); return b; }));
    return { el: h("div.field", "Picture", row), get value() { return value; } };
  }
  function chooseName() {
    const box = body(), name = nameField(""), pic = avatarPicker("dumbo"), submit = h("button.btn", { type: "submit" }, "Start diving");
    box.append(h("div.lead", h("h2.title", "Choose a username"), h("p.note-line", "This is how friends find you and how you appear in rankings. It's public, so don't use your real name unless you want to. ", h("a", { href: "privacy.html" }, "Privacy"))),
      h("form.form", { novalidate: true, onsubmit: async e => { e.preventDefault(); submit.disabled = true; try { await A.claim(name.input.value.trim(), pic.value); go("log"); } catch (err) { name.msg.className = "msg bad"; name.msg.textContent = err.message; submit.disabled = false; } } }, name.el, pic.el, h("div.row", submit, h("button.link", { type: "button", onclick: () => A.signOut().then(render) }, "Sign out"))));
  }
  function newPassword() {
    const box = body(), pass = h("input", { type: "password", autocomplete: "new-password", minLength: 6, placeholder: "At least 6 characters" }), msg = h("p.msg", { role: "status" });
    box.append(h("div.lead", h("h2.title", "Set a new password")), h("form.form", { novalidate: true, onsubmit: async e => { e.preventDefault(); try { await A.setPassword(pass.value); go("log"); } catch (err) { msg.className = "msg bad"; msg.textContent = err.message; } } }, h("label.field", "New password", pass), msg, h("div.row", h("button.btn", { type: "submit" }, "Save password"))));
  }

  // ---------- Settings ----------
  function settings() {
    const box = body();
    if (!A || A.state !== "in") return account();
    const p = A.profile, s = p.settings, name = nameField(p.username), pic = avatarPicker(p.avatar);
    const toggle = (key, label, sub) => { const input = h("input", { type: "checkbox", role: "switch", checked: !!s[key], onchange: () => act(null, () => A.rpc("update_settings", { p: { [key]: input.checked } }), () => {}) }); return h("label.toggle-row", h("span", label, h("small", sub)), input); };
    const pass = h("input", { type: "password", autocomplete: "new-password", minLength: 6, placeholder: "New password" }), pmsg = h("span.msg", { role: "status" });
    const confirmBox = h("input", { type: "text", autocomplete: "off", placeholder: `Type ${p.username} to confirm`, "aria-label": "Type your username to confirm" });
    box.append(h("div.lead", h("h2.title", "Settings"), h("p.note-line", A.demo ? "A demonstration account. Changes here stay on this device." : A.email ? `Signed in as ${A.email}. Other players never see your email.` : "")),
      h("div.section", h("h3", "You"), h("form.form", { novalidate: true, onsubmit: e => { e.preventDefault(); const v = name.input.value.trim(); act(e.submitter, async () => { if (v !== p.username) await A.rpc("change_username", { p_username: v }); if (pic.value !== p.avatar) await A.rpc("update_settings", { p: { avatar: pic.value } }); }).then(() => {}); } }, name.el, pic.el,
        h("div.row", h("button.btn.small", { type: "submit" }, "Save"), h("span.fine", "A username can be changed once every two weeks.")))),
      h("div.section", h("h3", "Privacy"),
        toggle("searchable", "Let players find me by username", "Off: only people who already know your exact username can send a request."),
        toggle("ranked", "Show me in the global ranking", "Off: you still get your own place, but your name isn't listed."),
        toggle("share_dives", "Let friends explore my finished icebergs", "Only ever friends, and only once they have finished that day themselves."),
        toggle("share_answers", "…including the answers I gave", "Off: friends see how deep you went, not what you said."),
        toggle("share_calendar", "Let friends see my calendar", "Strangers never see it.")),
      A.demo ? null : h("div.section", h("h3", "Password"), h("form.form", { novalidate: true, onsubmit: async e => { e.preventDefault(); try { await A.setPassword(pass.value); pass.value = ""; pmsg.className = "msg good"; pmsg.textContent = "Password changed."; } catch (err) { pmsg.className = "msg bad"; pmsg.textContent = err.message; } } }, h("label.field", "New password", pass, pmsg), h("div.row", h("button.btn.small.ghost", { type: "submit" }, "Change password")))),
      A.demo ? null : h("div.section", h("h3", "Account"), h("div.row", h("button.btn.small.ghost", { type: "button", id: "sign-out", onclick: () => A.signOut().then(() => go("log")) }, "Sign out")),
        h("details.danger", h("summary", "Delete my account"), h("p.note-line", "This removes your username, every dive, your streak and your friends, for good. It can't be undone."),
          h("div.row", confirmBox, h("button.btn.small.ghost", { type: "button", onclick: e => { if (confirmBox.value.trim().toLowerCase() !== p.username.toLowerCase()) { confirmBox.focus(); return; } act(e.currentTarget, () => A.remove(), () => go("log")); } }, "Delete for good")))));
  }

  // ---------- The end of the day: what finishing unlocks ----------
  // "1 friend has finished today, and you're ahead of them." Plain sentences for every case.
  function friendsLine(total, done, beaten, level) {
    if (!total) return "Add friends to compare icebergs.";
    if (!done) return total === 1 ? "Your friend hasn't finished yet." : "None of your friends has finished yet.";
    const ahead = done - beaten - level;
    if (done === 1) return `1 friend has finished today, and ${beaten ? "you're ahead of them" : level ? "you're level with them" : "they're ahead of you"}.`;
    const how = beaten === done ? "You're ahead of all of them." : ahead === done ? "All of them are ahead of you." : beaten ? `You're ahead of ${beaten} of them.` : `You're level with ${level} of them, and ${ahead} ${ahead === 1 ? "is" : "are"} ahead of you.`;
    return `${done} friends have finished today. ${how}`;
  }
  async function endOfDay(day) {
    const box = $("#e-social"); if (!box) return;
    const st = A ? A.state : "off", game = G(), today = game.today();
    box.textContent = ""; box.hidden = st === "off" || day === null;
    if (box.hidden) return;
    if (st !== "in") { box.append(h("p", h("b", "Keep this dive. "), "Create a free account to save your streak, add friends and see where you ranked today."), h("div.row", h("button.btn.small", { type: "button", onclick: () => go("account") }, st === "new" ? "Choose a username" : "Create an account"))); return; }
    const line = h("p.standing", "Saving your dive…"), sub = h("p.note-line"); box.append(line, sub,
      h("div.row", h("button.btn.small.ghost", { type: "button", onclick: () => go("ranks", today) }, "Rankings"), h("button.btn.small.ghost", { type: "button", onclick: () => go("friends") }, "Friends"), h("button.btn.small.ghost", { type: "button", onclick: () => go("log") }, "Your log")));
    for (let i = 0; i < 6; i++) {                                    // the dive may still be on its way to the database
      let s = null; try { s = await A.rpc("day_summary", { p_day: day ? day.day : today }); } catch { /* try again */ }
      if (s && s.done) {
        line.textContent = ""; line.append(s.ranked === false ? `Your place today: #${fmt(s.rank)} of ${fmt(s.players)} (you're not listed)` : h("b", `Ranked #${fmt(s.rank)}`), s.ranked === false ? "" : ` of ${plural(s.players, "player")} so far`);
        sub.textContent = friendsLine(+s.friends, +s.friends_done, +s.friends_beaten, +(s.friends_level || 0));
        return;
      }
      await new Promise(r => setTimeout(r, 700));
    }
    line.textContent = "Your dive is saved on this device and will be sent when you're back online.";
  }

  window.Hub = {
    open: (view, a, b) => go(view || "log", a, b), leave, start: show, endOfDay,
    back() { if (lastPage) location.hash = lastPage; else leave(); },      // from a dive, to the page it was opened from
    changed() { const btn = $("#acct-btn"); if (btn) { const st = A ? A.state : "off"; btn.classList.toggle("alert", st === "in" && +A.profile.requests > 0); btn.title = st === "in" ? A.profile.username : "Dive log"; } if (G() && G().screen === "hub") render(); },
    icon: ICON.person,
  };
})();
