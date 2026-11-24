// Demonstration data, for looking at the friends, rankings and dive-viewer screens when no database is connected.
// Every player here is invented by this file and labelled "Demonstration data" on screen. It is never used when a
// real database is configured, and it is never offered on the live game: only with ?demo in the address or inside
// the Claude preview. Your own dives in the demonstration are the real ones played on this device.
(function () {
  "use strict";
  const NAMES = ["demo_orca", "demo_kelp", "demo_tern", "demo_fjord", "demo_brine", "demo_floe", "demo_skua", "demo_narwhal", "demo_lichen", "demo_cairn", "demo_petrel", "demo_moraine", "demo_squall", "demo_eider", "demo_berg",
    "demo_auk", "demo_frost", "demo_tarn", "demo_gyre", "demo_shoal", "demo_reef", "demo_swell", "demo_drift", "demo_rime"];
  const PICS = ["angler", "moon", "squid", "comb", "snail", "dumbo"];
  const G = () => window.Game, I = window.Iceberg;
  const hash = s => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
  const rng = seed => { let x = seed % 2147483646 + 1; return () => (x = (x * 16807) % 2147483647) / 2147483647; };
  const state = () => { try { return JSON.parse(localStorage.getItem("iceberg:demo") || "null") || fresh(); } catch { return fresh(); } };
  const fresh = () => ({ username: "you", avatar: "dumbo", friends: NAMES.slice(0, 4), incoming: [NAMES[4]], outgoing: [], blocked: [], settings: { searchable: true, ranked: true, share_dives: true, share_answers: true, share_calendar: true } });
  const save = s => { try { localStorage.setItem("iceberg:demo", JSON.stringify(s)); } catch { /* fine */ } };
  const err = code => { const e = new Error(code); return window.Account.fail(e); };
  const who = name => { const i = NAMES.findIndex(n => n.toLowerCase() === String(name).toLowerCase()); return i < 0 ? null : { username: NAMES[i], avatar: PICS[i % PICS.length], skill: 0.25 + (hash(NAMES[i]) % 60) / 100, keen: 0.55 + (hash(NAMES[i] + "k") % 40) / 100 }; };
  // An invented player's dive for a day: a few plausible answers per question, chosen the same way every time.
  const cache = new Map();
  async function dive(p, day) {
    const key = p.username + ":" + day; if (cache.has(key)) return cache.get(key);
    const r = rng(hash(key)); if (day < 1 || r() > p.keen) { cache.set(key, null); return null; }
    const set = G().setOf(day), cats = await G().loadSet(set), guesses = [];
    cats.forEach((c, i) => {
      const pool = c.answers.filter(a => !a.x && !a.h).sort((a, b) => b.s - a.s), n = 1 + Math.floor(r() * 3), used = new Set();
      for (let s = 1; s <= n; s++) { const a = pool[Math.min(pool.length - 1, Math.floor(Math.pow(r(), 1.6 - p.skill) * pool.length * (0.35 + p.skill * 0.6)))]; if (used.has(a.a)) continue; used.add(a.a); guesses.push({ round: i + 1, slot: s, status: "ok", answer: a.a, typed: a.a, share: a.s, depth: I.depthOf(a.s), best: false, sight: null }); }
      const best = guesses.filter(g => g.round === i + 1).reduce((b, g) => !b || g.share < b.share ? g : b, null); if (best) { best.best = true; best.sight = best.depth >= 300 ? "colossal" : best.depth >= 250 ? "bigfin" : best.depth >= 200 ? "giant" : null; }
    });
    const bests = guesses.filter(g => g.best), d = { username: p.username, avatar: p.avatar, own: false, day, set, total: bests.reduce((t, g) => t + g.depth, 0), max_depth: Math.max(0, ...bests.map(g => g.depth)), deepest_answer: (bests.slice().sort((a, b) => b.depth - a.depth)[0] || {}).answer || null, guesses, answers_hidden: false };
    cache.set(key, d); return d;
  }
  // My real dives on this device.
  const mineAll = () => G().days().map(r => { const best = r.rounds.filter(x => x.name).sort((a, b) => b.depth - a.depth)[0]; return { day: r.day, total: r.total, max_depth: best ? best.depth : 0, deepest_answer: best ? best.name : null }; });
  const mineOn = day => mineAll().find(d => d.day === day) || null;
  const canSee = day => day < G().today() || !!mineOn(day);        // the same rule the database enforces
  async function board(day, names, s) {
    const rows = []; for (const n of names) { const d = await dive(who(n), day); if (d) rows.push({ username: d.username, avatar: d.avatar, total: d.total, max_depth: d.max_depth, me: false, friend: s.friends.includes(n) }); }
    const me = mineOn(day); if (me) rows.push({ username: s.username, avatar: s.avatar, total: me.total, max_depth: me.max_depth, me: true, friend: false });
    rows.sort((a, b) => b.total - a.total || b.max_depth - a.max_depth || a.username.localeCompare(b.username)); rows.forEach((r, i) => { r.rank = i + 1; });
    return rows;
  }
  const withRank = async (d, s) => { if (!d) return d; const rows = await board(d.day, NAMES.filter(n => !s.blocked.includes(n)), s), row = rows.find(r => r.username === (d.username || s.username)); return { ...d, rank: row ? row.rank : null, players: rows.length, ranked: true }; };
  const statsOf = (days, today) => { const set = new Set(days.map(d => d.day)); let streak = 0; for (let d = set.has(today) ? today : today - 1; set.has(d); d--) streak++; let longest = 0, run = 0; for (let d = 1; d <= today; d++) { run = set.has(d) ? run + 1 : 0; longest = Math.max(longest, run); }
    const top = days.slice().sort((a, b) => b.total - a.total)[0], deep = days.slice().sort((a, b) => b.max_depth - a.max_depth)[0];
    return { streak, streak_raw: streak, streak_last_day: days.length ? Math.max(...set) : 0, longest, dives: days.length, first_day: days.length ? Math.min(...set) : null, average: days.length ? Math.round(days.reduce((t, d) => t + d.total, 0) / days.length) : 0, best_total: top ? top.total : 0, best_total_day: top ? top.day : null, best_depth: deep ? deep.max_depth : 0, best_depth_day: deep ? deep.day : null, best_depth_answer: deep ? deep.deepest_answer : null }; };
  const relation = (s, n) => s.friends.includes(n) ? "friend" : s.outgoing.includes(n) ? "requested" : s.incoming.includes(n) ? "incoming" : "none";
  const history = async (p, today) => { const out = []; for (let d = Math.max(1, today - 370); d <= today; d++) { const x = await dive(p, d); if (x) out.push({ day: d, total: x.total, max_depth: x.max_depth, deepest_answer: canSee(d) ? x.deepest_answer : null }); } return out; };

  const calls = {
    async me() { const s = state(), today = G().today(); return { username: s.username, avatar: s.avatar, since: G().dateOf(1).toISOString(), settings: s.settings, stats: statsOf(mineAll(), today), requests: s.incoming.length, latest_day: today }; },
    async username_check({ p_username }) { const ok = /^[A-Za-z][A-Za-z0-9_]{2,19}$/.test(p_username || ""), taken = !!who(p_username); return { ok: ok && !taken, reason: !ok ? "format" : taken ? "taken" : null }; },
    async change_username({ p_username }) { const c = await calls.username_check({ p_username }); if (!c.ok) throw err("username_" + c.reason); const s = state(); s.username = p_username; save(s); return calls.me(); },
    async update_settings({ p }) { const s = state(); for (const k of Object.keys(s.settings)) if (typeof p[k] === "boolean") s.settings[k] = p[k]; if (PICS.includes(p.avatar)) s.avatar = p.avatar; save(s); return calls.me(); },
    async delete_account() { try { localStorage.removeItem("iceberg:demo"); } catch { /* fine */ } },
    async submit_dive({ p_day }) { const s = state(), me = mineOn(p_day) || { total: 0, max_depth: 0 }, st = statsOf(mineAll(), G().today()), r = await withRank({ day: p_day, username: s.username }, s); return { day: p_day, total: me.total, max_depth: me.max_depth, saved: true, streak: st.streak, longest: st.longest, extended: st.streak > 1, rank: r.rank, players: r.players, ranked: true }; },
    async import_dives() { return []; },
    async my_dives() { const s = state(), out = []; for (const d of mineAll()) out.push(await withRank({ ...d, username: s.username }, s)); return out; },
    async get_dive({ p_username, p_day }) { const s = state(); if (p_username.toLowerCase() === s.username.toLowerCase()) throw err("no_dive"); const p = who(p_username); if (!p || s.blocked.includes(p.username)) throw err("not_found"); if (!s.friends.includes(p.username)) throw err("friends_only"); if (!canSee(p_day)) throw err("locked"); const d = await dive(p, p_day); if (!d) throw err("no_dive"); return withRank(d, s); },
    async profile_of({ p_username }) {
      const s = state(), today = G().today();
      if (p_username.toLowerCase() === s.username.toLowerCase()) { const me = await calls.me(); return { username: me.username, avatar: me.avatar, since: me.since, relation: "self", latest_day: today, can_explore: true, stats: me.stats, calendar: await calls.my_dives(), friends: s.friends.length }; }
      const p = who(p_username); if (!p || s.blocked.includes(p.username)) throw err("not_found");
      const rel = relation(s, p.username), cal = await history(p, today), st = statsOf(cal, today), day1 = st.best_depth_day;
      return { username: p.username, avatar: p.avatar, since: G().dateOf(1).toISOString(), relation: rel, latest_day: today, can_explore: rel === "friend", calendar: rel === "friend" ? cal : null,
        stats: rel === "friend" ? { ...st, best_depth_answer: day1 && canSee(day1) ? st.best_depth_answer : null } : { streak: st.streak, longest: st.longest, dives: st.dives, first_day: st.first_day } };
    },
    async search_users({ p_query }) { const s = state(), q = String(p_query || "").toLowerCase(); return NAMES.filter(n => (n.startsWith(q) || n.replace("demo_", "").startsWith(q)) && !s.blocked.includes(n)).slice(0, 8).map(n => ({ username: n, avatar: who(n).avatar, relation: relation(s, n) })); },
    async friend_request({ p_username }) { const s = state(), p = who(p_username); if (!p) throw err("not_found"); if (s.incoming.includes(p.username)) { s.incoming = s.incoming.filter(n => n !== p.username); s.friends.push(p.username); save(s); return "friend"; } if (!s.friends.includes(p.username) && !s.outgoing.includes(p.username)) s.outgoing.push(p.username); save(s); return "requested"; },
    async friend_respond({ p_username, p_accept }) { const s = state(), p = who(p_username); if (!p || !s.incoming.includes(p.username)) throw err("no_request"); s.incoming = s.incoming.filter(n => n !== p.username); if (p_accept) s.friends.push(p.username); save(s); return p_accept ? "friend" : "none"; },
    async friend_remove({ p_username }) { const s = state(), p = who(p_username); if (!p) throw err("not_found"); s.friends = s.friends.filter(n => n !== p.username); s.outgoing = s.outgoing.filter(n => n !== p.username); save(s); return "none"; },
    async block_user({ p_username, p_block }) { const s = state(), p = who(p_username); if (!p) throw err("not_found"); if (p_block === false) s.blocked = s.blocked.filter(n => n !== p.username); else { s.blocked.push(p.username); for (const k of ["friends", "incoming", "outgoing"]) s[k] = s[k].filter(n => n !== p.username); } save(s); return p_block === false ? "none" : "blocked"; },
    async friends({ p_day }) {
      const s = state(), open = canSee(p_day), me = mineOn(p_day), list = [];
      for (const n of s.friends) { const p = who(n), d = await dive(p, p_day), st = statsOf(await history(p, G().today()), G().today()); list.push({ username: n, avatar: p.avatar, streak: st.streak, done: !!d, total: d && open ? d.total : null, max_depth: d && open ? d.max_depth : null, can_explore: true }); }
      list.sort((a, b) => (b.total || -1) - (a.total || -1) || a.username.localeCompare(b.username));
      const card = n => ({ username: n, avatar: who(n).avatar });
      return { day: p_day, unlocked: open, me: me ? { total: me.total, max_depth: me.max_depth } : null, friends: list, incoming: s.incoming.map(card), outgoing: s.outgoing.map(card), blocked: s.blocked };
    },
    async leaderboard({ p_day, p_scope, p_limit }) {
      const s = state(), names = (p_scope === "friends" ? s.friends : NAMES).filter(n => !s.blocked.includes(n));
      if (!canSee(p_day)) { let n = 0; for (const x of NAMES) if (await dive(who(x), p_day)) n++; return { day: p_day, scope: p_scope, locked: true, players: p_scope === "global" ? n : null }; }
      const rows = await board(p_day, names, s), me = rows.find(r => r.me);
      return { day: p_day, scope: p_scope, locked: false, players: rows.length, me: me ? { rank: me.rank, total: me.total, max_depth: me.max_depth, top: Math.ceil(100 * me.rank / rows.length) } : null, rows: rows.slice(0, p_limit || 50) };
    },
    async day_summary({ p_day }) { const s = state(), me = mineOn(p_day); if (!me) return { done: false }; const all = await board(p_day, NAMES.filter(n => !s.blocked.includes(n)), s), fr = await board(p_day, s.friends, s), mine = all.find(r => r.me), fm = fr.find(r => r.me);
      return { done: true, total: me.total, max_depth: me.max_depth, rank: mine.rank, players: all.length, ranked: true, friends: s.friends.length, friends_done: fr.length - 1, friends_beaten: fr.length - fm.rank }; },
  };
  window.DemoBackend = { rpc: (name, args) => { if (!calls[name]) return Promise.reject(err("not_found")); return calls[name](args || {}); } };
})();
