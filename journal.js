// The field journal: the animals your answers have actually reached, kept for good. (Prototype.)
//
// What counts as a discovery, and what doesn't. Animals drifting past the camera are scenery and are not logged.
// An entry is made only by a verified answer: each question's best answer reaches a depth, and the journal records
// the animal that lives at that depth. When several live there, which one you meet is fixed by the day and the
// question, so everyone who reaches the same depth on the same question meets the same animal. That keeps it fair
// and comparable between friends ("you found the viperfish on question 4 too?"), and it means a new day can bring
// a different animal at the same depth. The great squid are logged only when an answer is deep enough to bring one,
// exactly as in the dive; the colossal squid needs Challenger Deep, which needs real player evidence.
//
// Nothing can be bought, ground out or rerolled: one dive a day, five questions, and the journal follows from the
// answers. It is worked out from the dives already saved, so it fills in from a player's history and keeps no
// state of its own that could drift from the results or be edited to cheat.
(function () {
  "use strict";
  const W = window.Wildlife, I = window.Iceberg;
  if (!W || !I) return;
  const all = W.species(), residents = all.filter(s => !s.rare), great = all.filter(s => s.rare);
  // Where an animal belongs in the journal: the region of the ocean it lives in (by the dive's running depth).
  const mid = s => s.rare ? s.region || 300 : (s.zone[0] + s.zone[1]) / 2;
  const regionOf = s => I.regionOf(s.zone && s.zone[1] < 0 ? 0 : Math.round(mid(s)));
  const ORDER = I.REGIONS.map(t => t.key);

  // The resident animal a depth reaches on a given day and question. Above the water (0 m: an answer many people
  // gave) there are only seabirds.
  function residentAt(depth, day, round) {
    let here = residents.filter(s => depth <= 0 ? s.zone[1] < 0 : s.zone[0] <= depth && depth <= s.zone[1]);
    if (!here.length) here = residents.filter(s => s.zone[1] >= 0).sort((a, b) => Math.abs(mid(a) - depth) - Math.abs(mid(b) - depth)).slice(0, 1);
    here.sort((a, b) => (a.key < b.key ? -1 : 1));
    let x = (Math.imul(day, 2654435761) + Math.imul(round, 40503)) >>> 0;
    x = (x ^ (x >>> 15)) >>> 0; x = Math.imul(x, 2246822519) >>> 0; x = (x ^ (x >>> 13)) >>> 0;   // kept unsigned: a negative index picks nothing
    return here[x % here.length];
  }
  // The great encounter an answer brings: its own rarity (depth) and where the dive had got to (at), by the same rule
  // and order as the dive itself (wildlife.js, encounterFor).
  const PRIORITY = ["giant", "bigfin", "megalodon", "coil", "colossal"];
  const greatAt = (depth, at) => great.filter(s => depth >= s.min && at >= (s.region || 0) && (!s.fiction || depth > 0)).sort((a, b) => PRIORITY.indexOf(b.key) - PRIORITY.indexOf(a.key))[0] || null;

  // What one finished day adds. The dive is one descent: each question's best answer takes you further down, and the
  // animal living where it leaves you (the running total) is recorded, with any great encounter the answer brought.
  function finds(rec) {
    const out = []; let run = 0;
    (rec.rounds || []).forEach((r, i) => {
      if (!r || !r.name) return;                       // no verified answer: nothing reached
      const d = r.depth || 0; run += d;
      const at = { day: rec.day, round: i + 1, depth: d, at: run, title: r.title, answer: r.name };
      out.push({ sp: residentAt(run, rec.day, i + 1), ...at });
      const g = greatAt(d, run); if (g) out.push({ sp: g, ...at });
    });
    return out;
  }
  // In the labelled demonstration (a preview page with no database), an empty journal shows a made-up history
  // instead, so the page can be seen as a player would see it after a couple of weeks. Never used with real data.
  const R = (title, name, depth) => ({ title, name, depth });
  const SAMPLE = [
    [R("Birds", "raven", 12), R("Cheese", "feta", 64), R("Countries", "Bhutan", 148), R("Sports", "sepak takraw", 212), R("Words", "quagmire", 0)],
    [R("Fish", "cod", 3), R("Trees", "rowan", 96), R("Gods", "Anubis", 171), R("Tools", "spokeshave", 257), R("Colours", "teal", 40)],
    [R("Fruit", "durian", 120), R("Jobs", "farrier", 188), R("Dances", "polka", 55), R("Words", "squib", 233), R("Flowers", "daisy", 0)],
    [R("Instruments", "theremin", 131), R("Weather", "sleet", 22), R("Pasta", "orecchiette", 162), R("Gems", "tanzanite", 205), R("Kitchen", "zester", 77)],
  ].map((rounds, i) => ({ v: 3, day: i + 1, total: 0, rounds }));
  // Shown only with no real history, and only in the demonstration, on a preview page, or with ?journal-sample.
  const sampleOk = () => (window.Account && window.Account.demo) || /claude|anthropic/.test(location.hostname) || window.self !== window.top || new URLSearchParams(location.search).has("journal-sample");
  let showingSample = false;
  const history = () => { const d = window.Game ? window.Game.days() : []; showingSample = !d.length && sampleOk(); return showingSample ? SAMPLE : d; };
  // The whole journal, from every saved day.
  function compute(days = history()) {
    const log = new Map(); let deepest = null, dives = 0, furthest = null;
    for (const rec of days.slice().sort((a, b) => a.day - b.day)) {
      dives++;
      for (const f of finds(rec)) {
        const e = log.get(f.sp.key);
        if (!e) log.set(f.sp.key, { first: f, n: 1, deepest: f });
        else { e.n++; if (f.depth > e.deepest.depth) e.deepest = f; }
      }
      (rec.rounds || []).forEach((r, i) => { if (r && r.name && (!deepest || r.depth > deepest.depth)) deepest = { day: rec.day, round: i + 1, depth: r.depth, title: r.title, answer: r.name }; });
      const tot = (rec.rounds || []).reduce((a, r) => a + (r && r.depth || 0), 0); if (!furthest || tot > furthest.total) furthest = { day: rec.day, total: tot };
    }
    return { log, deepest, furthest, dives, total: all.length };
  }
  // What today's dive added, and which of those are new to the journal.
  function today(rec) {
    if (!rec) return [];
    const before = compute(window.Game.days().filter(d => d.day < rec.day)).log;
    const seen = new Set();
    return finds(rec).filter(f => !seen.has(f.sp.key) && seen.add(f.sp.key)).map(f => ({ ...f, isNew: !before.has(f.sp.key) }));
  }

  // ---------- Pictures ----------
  const SIZE = s => s.key === "colossal" ? [150, 96] : s.key === "shark" || s.key === "bigfin" || s.key === "giant" ? [120, 64] : [80, 44];
  // Cut a drawing down to the animal itself, so small creatures don't sit lost in an empty frame.
  function crop(src) {
    const g = src.getContext("2d"), { width: w, height: h } = src, px = g.getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (px[(y * w + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) return src;
    const c = document.createElement("canvas"); c.width = x1 - x0 + 3; c.height = y1 - y0 + 3;
    c.getContext("2d").drawImage(src, x0 - 1, y0 - 1, c.width, c.height, 0, 0, c.width, c.height);
    return c;
  }
  function picture(s, { time = 1.2, dark = false } = {}) {
    const raw = document.createElement("canvas"), [cw, ch] = SIZE(s);
    W.sheet(raw, time, 1, { keys: [s.key], cols: 1, cw, ch, clear: true, bare: true });
    const c = crop(raw);
    if (dark) {   // undiscovered: a silhouette only
      const g = c.getContext("2d"); g.globalCompositeOperation = "source-in"; g.fillStyle = "#2a4a73"; g.fillRect(0, 0, c.width, c.height);
    }
    // Whole-pixel scaling keeps the pixel art crisp: as large as fits the picture column, never blurred.
    const k = Math.max(1, Math.min(4, Math.floor(84 / c.width), Math.floor(48 / c.height)));
    c.style.width = c.width * k + "px"; c.style.height = c.height * k + "px";
    c.className = "jn-pic" + (dark ? " dark" : ""); c.setAttribute("aria-hidden", "true");
    return c;
  }
  let anim = 0;
  function animate(canvas, s) {
    cancelAnimationFrame(anim);
    const t0 = performance.now(), [cw, ch] = SIZE(s);
    const loop = now => {
      if (!canvas.isConnected) return;
      W.sheet(canvas, 1.2 + (now - t0) / 1000, 3, { keys: [s.key], cols: 1, cw, ch, clear: true, bare: true });
      anim = requestAnimationFrame(loop);
    };
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) anim = requestAnimationFrame(loop);
  }

  // ---------- The page ----------
  function render(box, h, add) {
    const G = window.Game, j = compute(), fmt = G.fmt, m = n => `${fmt(n)} m`;
    const date = d => G.dateOf(d).toLocaleDateString("en-US", { day: "numeric", month: "short" });
    const found = j.log.size;
    add(box, h("div.lead.jn-lead",
      h("h2.title", "Field journal"),
      showingSample ? h("p.jn-sample", "Example entries, made up to show how the journal fills in. Play a dive to start your own.") : null,
      h("p.note-line", found
        ? `${found} of ${j.total} animals recorded over ${j.dives === 1 ? "one dive" : fmt(j.dives) + " dives"}. Each entry was reached by one of your answers.`
        : "Nothing recorded yet. Each question's best answer takes your dive further down, and the animal living where it leaves you goes in here. Some things only come to an answer rare enough."),
      j.furthest ? h("p.jn-record", h("span", "Deepest dive"), h("b", m(j.furthest.total)), h("span.jn-src", `${I.regionOf(j.furthest.total).name} · ${date(j.furthest.day)}`)) : null,
      j.deepest ? h("p.jn-record", h("span", "Rarest answer"), h("b", "+" + m(j.deepest.depth)), h("span.jn-src", `“${j.deepest.answer}” · ${j.deepest.title} · ${date(j.deepest.day)}`)) : null));
    const byRegion = new Map(ORDER.map(k => [k, []]));
    for (const s of all) byRegion.get(regionOf(s).key).push(s);
    for (const key of ORDER) {
      const list = byRegion.get(key).sort((a, b) => mid(a) - mid(b)); if (!list.length) continue;
      const reg = I.REGIONS.find(t => t.key === key), got = list.filter(s => j.log.has(s.key)).length;
      const sec = h("section.section.jn-region" + (key === "unknown" ? ".beyond" : ""), h("h3", reg.name, h("span.jn-count", `${got} of ${list.length}`)));
      const ul = h("ul.jn-list");
      for (const s of list) {
        const e = j.log.get(s.key);
        if (!e) {
          // Locked entries hint at where, never at how: a region for the great ones, nothing at all for the inventions.
          const where = s.fiction ? "No record. Only rumours." : s.rare ? `Unconfirmed reports of something very large in ${I.regionOf(s.region || 0).name}.`
            : `Unidentified · somewhere between ${m(Math.max(0, s.zone[0]))} and ${m(s.zone[1])}`;
          ul.append(h("li.jn-row.unknown", s.rare ? h("span.jn-pic.mystery", { "aria-hidden": "true" }, "?") : picture(s, { dark: true }), h("div", h("div.jn-name", "Not yet recorded"), h("div.jn-sub", where))));
          continue;
        }
        const f = e.first, row = h("li.jn-row" + (s.rare ? ".great" : ""), { tabindex: "0", role: "button", "aria-expanded": "false" },
          picture(s),
          h("div", h("div.jn-name", s.name, s.latin ? h("i", ` ${s.latin}`) : null, s.fiction ? h("span.jn-fiction", " · not a real animal") : null),
            h("div.jn-sub", `First recorded ${date(f.day)} at ${m(f.at != null ? f.at : f.depth)}: “${f.answer}” for ${f.title}`),
            e.n > 1 ? h("div.jn-sub", `Recorded ${fmt(e.n)} times`) : null));
        const open = () => {
          const was = row.getAttribute("aria-expanded") === "true";
          box.querySelectorAll(".jn-row[aria-expanded=true]").forEach(r => { r.setAttribute("aria-expanded", "false"); const d = r.querySelector(".jn-detail"); if (d) d.remove(); });
          if (was) return;
          row.setAttribute("aria-expanded", "true");
          const big = document.createElement("canvas"); big.className = "jn-big"; big.setAttribute("aria-hidden", "true");
          W.sheet(big, 1.2, 3, { keys: [s.key], cols: 1, cw: SIZE(s)[0], ch: SIZE(s)[1], clear: true, bare: true });
          row.append(h("div.jn-detail", big, h("p", s.fiction ? s.real : s.real + "."), s.rare ? null : h("p.jn-sub", `In the dive, between ${m(Math.max(0, s.zone[0]))} and ${m(s.zone[1])}.`)));
          animate(big, s);
        };
        row.onclick = open; row.onkeydown = ev => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); open(); } };
        ul.append(row);
      }
      add(sec, ul); add(box, sec);
    }
    add(box, h("p.note-line.jn-foot", "Animals you only glimpse in passing aren't recorded: an entry needs an answer that took your dive there. Everyone who reaches the same depth on the same question meets the same animal. Nothing here can be bought."));
  }

  window.Journal = { compute, today, finds, residentAt, render };
})();
