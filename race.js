// The submarine race: live races against other players, vertical, down through the ocean.
//
// Everyone gets the same questions at the same moment and has three guesses each. Each guess moves your submarine
// down by however much it beats your best answer on that question, so a question can never be worth more than its
// rarest answer. Whoever has descended furthest after the last question wins.
//
// The database runs the race (supabase/0004_race.sql): the clock, the questions, the guesses, the distances, who
// may see what. This file only draws it and asks. Its parts:
//   World    the ocean from the iceberg's tip to the trench, drawn as pixel art in tiles, plus the camera
//   Scene    the canvases, submarines, wildlife, darkness, labels, race map
//   Flow     the race home, lobby, questions, the break between questions, results
(function () {
  "use strict";
  const A = window.Account, I = window.Iceberg, $ = s => document.querySelector(s), G = () => window.Game;
  const { WW, WH, CX, TOP_Y, PXM } = I.WORLD;
  const h = (spec, attrs, ...kids) => { const id = (spec.match(/#([\w-]+)/) || [])[1], [tag, ...cls] = spec.replace(/#[\w-]+/, "").split("."), n = document.createElement(tag || "div"); if (cls.length) n.className = cls.join(" "); if (id) n.id = id;
    if (attrs && (typeof attrs !== "object" || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
    for (const [k, v] of Object.entries(attrs || {})) { if (v == null || v === false) continue; if (k.startsWith("on")) n[k] = v; else if (k in n && k !== "list") n[k] = v; else n.setAttribute(k, v === true ? "" : v); }
    for (const k of kids.flat()) if (k != null && k !== false) n.append(k); return n; };
  const fmt = n => Number(n).toLocaleString("en-US"), m = n => `${fmt(Math.round(n))} m`;
  const PARAMS = new URLSearchParams(location.search), FAST = PARAMS.has("fast") ? 3 : 1, reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ================================================================================================================
  // World: one tall pixel-art ocean. A metre of race distance is the same height as a metre on the daily iceberg.
  // ================================================================================================================
  const yOf = metres => TOP_Y + metres * PXM;
  const mOf = y => (y - TOP_Y) / PXM;
  // The regions on the way down (metres). Each has its own water colour, walls and life.
  const ZONES = [
    { from: 0, name: "The iceberg", water: "#0b2a4a" },
    { from: 330, name: "Twilight water", water: "#082140" },
    { from: 750, name: "The cliffs", water: "#061a35" },
    { from: 1300, name: "The canyons", water: "#05152c" },
    { from: 2100, name: "The abyss", water: "#041024" },
    { from: 3100, name: "The trench", water: "#030b1b" },
  ];
  const zoneAt = metres => { let z = 0; ZONES.forEach((x, i) => { if (metres >= x.from) z = i; }); return z; };
  const LANE0 = 590, LANE_W = 46;                      // racers' lanes, right of the iceberg, kept clear of the walls
  const laneX = seat => LANE0 + seat * LANE_W;
  const mix = (a, b, t) => { const p = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16)); const x = p(a), y = p(b); return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join(""); };
  const lerpZone = metres => { const z = zoneAt(metres), next = ZONES[z + 1]; if (!next) return ZONES[z].water; const t = Math.max(0, Math.min(1, (metres - ZONES[z].from) / (next.from - ZONES[z].from))); return mix(ZONES[z].water, next.water, t); };
  // Smooth noise from a few sines: walls that wander but never jitter.
  const wob = (y, s) => Math.sin(y * 0.011 + s) * 22 + Math.sin(y * 0.027 + s * 2.1) * 11 + Math.sin(y * 0.061 + s * 3.7) * 5;
  // Where the rock begins on each side at a given row. The lanes (x 570..940) always stay open.
  const ease = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
  function walls(y) {
    const d = mOf(y), XO = 480;
    let L = -XO - 20, R = WW + XO + 20;
    // The cliffs rise out of the dark to the left of the lanes, then the canyon closes in from both sides, opens out
    // over the abyssal plain, and narrows again into the trench. The lanes (x 570..940) always stay open.
    const cliff = 380 + wob(y, 1) * 1.6, canyonL = 430 + wob(y, 1) * 2 + Math.sin(y * 0.0045) * 70, canyonR = 1030 + wob(y, 5) * 1.5 - Math.sin(y * 0.0038 + 1) * 50;
    const plainL = 120 + wob(y, 1) * 1.2, plainR = 1300, trenchL = 515 + wob(y, 1) * 0.5, trenchR = 985 + wob(y, 5) * 0.4;
    if (d > 600) L = -XO + (cliff + XO) * ease((d - 600) / 220);
    if (d > 1250) L = cliff + (canyonL - cliff) * ease((d - 1250) / 150);
    if (d > 1150) R = WW + XO + (canyonR - WW - XO) * ease((d - 1150) / 250);
    if (d > 2000) { const k = ease((d - 2000) / 250); L = canyonL + (plainL - canyonL) * k; R = canyonR + (plainR - canyonR) * k; }
    if (d > 3000) { const k = ease((d - 3000) / 220); L = plainL + (trenchL - plainL) * k; R = plainR + (trenchR - plainR) * k; }
    return [Math.min(552, L), Math.max(946, R)];
  }
  // The world in tiles of 256 rows, drawn once each and kept. Tiles reach XOFF art pixels past the world on each side,
  // so a wide window never shows an edge.
  const TH = 256, XOFF = 480, TW = WW + XOFF * 2, tiles = new Map();
  let icebergArt = null;
  function tile(i) {
    if (tiles.has(i)) return tiles.get(i);
    const c = document.createElement("canvas"); c.width = TW; c.height = TH;
    const g = c.getContext("2d"), y0 = i * TH;
    if (y0 < WH) {
      if (!icebergArt) { icebergArt = document.createElement("canvas"); icebergArt.width = WW; icebergArt.height = WH; I.paint(icebergArt); }
      const hh = Math.min(TH, WH - y0);
      g.drawImage(icebergArt, 0, y0, WW, hh, XOFF, 0, WW, hh);
      g.drawImage(icebergArt, 2, y0, 1, hh, 0, 0, XOFF, hh);                 // the sky and sea carry on past the picture
      g.drawImage(icebergArt, WW - 3, y0, 1, hh, XOFF + WW, 0, XOFF, hh);
      // The picture's lower edge fades into the open water below it.
      for (let r = 0; r < hh; r++) { const y = y0 + r, k = (y - (WH - 150)) / 150; if (k > 0) { g.globalAlpha = Math.min(1, k * k); g.fillStyle = lerpZone(mOf(y)); g.fillRect(0, r, TW, 1); } }
      g.globalAlpha = 1;
    }
    let seed = 1000 + i * 7919; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let r = 0; r < TH; r++) {
      const y = y0 + r; if (y < WH) continue;
      const d = mOf(y);
      g.fillStyle = lerpZone(d); g.fillRect(0, r, TW, 1);
      // Faint distant ridges in the water, a shade lighter, so the deep never reads as flat black.
      const ridge = 0.5 + 0.5 * Math.sin(y * 0.006 + 2) * Math.sin(y * 0.0021);
      if (d > 500 && ridge > 0.55) { g.globalAlpha = 0.05 + 0.05 * (ridge - 0.55); g.fillStyle = "#16304f"; const x = XOFF + 120 + Math.sin(y * 0.01) * 60; g.fillRect(Math.round(x), r, Math.round(160 + 80 * ridge), 1); g.globalAlpha = 1; }
      // Rock: base colour, a darker inner band, strata, and a lit rim along the edge.
      const [L, R] = walls(y);
      const rock = (x0, x1, rimX, face) => {
        if (x1 <= x0) return;
        x0 += XOFF; x1 += XOFF; rimX += XOFF;
        g.fillStyle = "#0f2036"; g.fillRect(Math.round(x0), r, Math.round(x1 - x0), 1);
        if (Math.floor(y / 7) % 3 === 0) { g.fillStyle = "#132842"; g.fillRect(Math.round(x0), r, Math.round(x1 - x0), 1); }      // strata
        g.fillStyle = "#1a3352"; g.fillRect(Math.round(face < 0 ? rimX - 6 : rimX), r, 6, 1);
        g.fillStyle = d < 1500 ? "#3a618c" : "#2d5274"; g.fillRect(Math.round(face < 0 ? rimX - 1 : rimX), r, 1, 1);          // the edge catching what light there is
      };
      if (L > -XOFF) rock(-XOFF, L, L, -1);
      if (R < WW + XOFF) rock(R, WW + XOFF, R, 1);
    }
    // Details on the rock face: ledges, sponges, sea pens, a few living lights, and vents in the trench.
    for (let k = 0; k < 14; k++) {
      const y = y0 + Math.floor(rnd() * TH); if (y < WH + 20) continue;
      const d = mOf(y), [L, R] = walls(y), left = rnd() < 0.7, edge = (left ? L : R) + XOFF;
      if ((left && L < 10) || (!left && R > WW - 10)) continue;
      const r = y - y0, dir = left ? 1 : -1, kind = rnd();
      if (kind < 0.35) { g.fillStyle = "#1a3150"; g.fillRect(Math.round(edge - (left ? 14 : 0)), r, 14, 2); g.fillStyle = "#2c4a6e"; g.fillRect(Math.round(edge - (left ? 14 : 0)), r, 14, 1); }       // ledge
      else if (kind < 0.6) { const c = d > 2000 ? "#3d6b7a" : "#5d6f86"; for (let s = 0; s < 4; s++) { g.fillStyle = c; g.fillRect(Math.round(edge + dir * s), r - s * 2, 1, 2 + s); } }                               // sea pen
      else if (kind < 0.8 && d > 1000) { g.globalAlpha = 0.9; g.fillStyle = "#7df0df"; g.fillRect(Math.round(edge + dir * (2 + rnd() * 6)), r, 1, 1); g.globalAlpha = 0.25; g.fillRect(Math.round(edge + dir * 2), r - 1, 3, 3); g.globalAlpha = 1; }   // a glowing speck
      else if (d > 3000) { g.fillStyle = "#1c2a3a"; g.fillRect(Math.round(edge + dir * 2), r - 10, 4, 10); g.fillStyle = "#e08f78"; g.fillRect(Math.round(edge + dir * 3), r - 12, 1, 2); g.fillStyle = "#f2d6c9"; g.fillRect(Math.round(edge + dir * 4), r - 13, 1, 3); }   // a vent with tube worms
    }
    tiles.set(i, c);
    return c;
  }

  // ================================================================================================================
  // Scene
  // ================================================================================================================
  const S = { host: null, c: {}, g: {}, u: 2, w: 0, h: 0, camX: LANE0 + 160, camY: yOf(0), fx: 0, fy: 0, free: { l: 0, r: 0, t: 0, b: 0 }, labels: new Map(), subs: new Map(), raf: 0, last: 0, t: 0, frame: 0, life: null, lifeHooks: [], bubbles: [], edgeKey: "" };
  function mount() {
    if (S.host) return;
    S.host = $("#rc");
    for (const k of ["world", "back", "subs", "front", "dark", "lume", "lamps"]) { const c = document.createElement("canvas"); c.className = "rc-layer rc-" + k; S.host.append(c); S.c[k] = c; S.g[k] = c.getContext("2d"); }
    S.labelBox = h("div.rc-labels"); S.map = h("div.rc-map", { "aria-hidden": "true" }); S.edge = h("div.rc-edges"); S.host.append(S.labelBox, S.edge, S.map);
    new ResizeObserver(() => size(true)).observe(S.host); size(true);
    // The daily game's wildlife, reused: an adapter makes the race camera look like the iceberg's to it.
    if (window.Wildlife) {
      const adapter = { life: { back: S.c.back, front: S.c.front, lume: S.c.lume }, onRender: f => S.lifeHooks.push(f),
        get view() {
          const wy = wildY(mOf(S.camY)), f = S.free, y0 = Math.round(S.fy - wy * S.u);
          // Each submarine's lamp lights the water ahead of it (the colossal squid is lit only by these).
          const lights = [...S.subs.values()].map(s => ({ x: s.x + 26, y: (S.y0 + s.y * S.u - y0) / S.u + 3, r: 58, k: 1.1, col: s.beneath ? [1, 0.8, 0.74] : [0.86, 0.94, 1] }));
          return { x0: S.x0, y0, u: S.u, z: S.u, w: S.w, h: S.h, camY: wy, axis: S.x0 + CX * S.u, frame: { l: f.l, r: S.w - f.r, t: f.t, b: S.h - f.b }, depth: Math.min(1, mOf(S.camY) / 1800), settled: true, busy: false, note: null, focus: null, lights };
        } };
      S.life = window.Wildlife.create(adapter, { low: G().store.get("fx", "full") === "low" });
    }
    loop(0);
  }
  // Race depth to the wildlife's own depth scale (0..330): the shallows' animals near the top, the abyss's below 2 km.
  const wildM = metres => metres <= 300 ? metres * 0.6 : 180 + 150 * (1 - Math.exp(-(metres - 300) / 900));
  const wildY = metres => TOP_Y + wildM(metres) * PXM;
  const phone = () => S.w <= 920;
  // The open water the controls leave: the camera frames the submarines inside it.
  function freeArea() {
    const box = S.host.getBoundingClientRect(), top = Math.round(document.querySelector(".top").getBoundingClientRect().bottom - box.top), d = dock();
    if (!d) return { l: 0, r: S.w, t: top, b: S.h };
    if (phone()) {
      const q = d.querySelector(".q"), p = d.querySelector("#r-panel");
      if (d.classList.contains("playing") && q && p) return { l: 0, r: S.w - 34, t: Math.round(q.getBoundingClientRect().bottom - box.top) + 6, b: Math.round(p.getBoundingClientRect().top - box.top) - 4 };
      return { l: 0, r: S.w - 34, t: top, b: Math.round(d.getBoundingClientRect().top - box.top) };
    }
    return { l: Math.round(d.getBoundingClientRect().right - box.left) + 24, r: S.w - 74, t: top, b: S.h };
  }
  function seats() { const list = [...S.subs.values()].map(x => x.seat); return list.length ? [Math.min(...list), Math.max(...list)] : [0, 0]; }
  // Zoom: as large as fits, so every lane is in view on a wide screen. It is fixed for a race (the field doesn't change size).
  function size(force) {
    S.w = S.host.clientWidth; S.h = S.host.clientHeight; if (!S.w) return;
    S.free = freeArea();
    const [a, b] = seats(), span = (b - a) * LANE_W + 44, fw = S.free.r - S.free.l;
    const u = phone() ? Math.max(2, Math.min(3, Math.floor(S.w / (span + 40)))) : Math.max(2, Math.min(4, Math.round(S.h / 270), Math.floor(fw / (span + 70))));
    if (u === S.u && !force) return;
    S.u = u;
    const cw = Math.ceil(S.w / S.u) + 2, ch = Math.ceil(S.h / S.u) + 2;
    for (const k of ["world", "subs", "dark", "lamps", "back", "front", "lume"]) { const c = S.c[k]; c.width = cw; c.height = ch; c.style.width = cw * S.u + "px"; c.style.height = ch * S.u + "px"; }
  }
  // The camera follows my submarine down. Across, it keeps every lane in view when they fit, otherwise it follows me.
  function cameraTarget() {
    const me = [...S.subs.values()].find(s => s.me), [a, b] = seats(), mid = (laneX(a) + laneX(b)) / 2, f = S.free;
    S.fx = (f.l + f.r) / 2; S.fy = f.t + (f.b - f.t) * (phone() ? 0.4 : 0.42);
    if (!me) return { x: mid, y: yOf(0) };
    const fits = ((b - a) * LANE_W + 44) * S.u <= f.r - f.l;
    return { x: fits ? mid : me.x, y: me.y };
  }
  function loop(now) {
    S.raf = requestAnimationFrame(loop);
    if (!S.host || S.host.offsetParent === null) { S.last = now; return; }
    const dt = Math.min(0.05, (now - S.last) / 1000 || 0.016); S.last = now; S.t += dt;
    if (++S.frame % 15 === 0) size(false);
    // Submarines ease towards where the server says they are: quick to start, gentle to arrive.
    for (const s of S.subs.values()) {
      const target = yOf(s.dist), gap = target - s.y;
      s.vy += (gap * 4.5 - s.vy * 3.2) * dt * FAST; s.y += s.vy * dt;
      if (Math.abs(gap) < 0.2 && Math.abs(s.vy) < 0.5) { s.y = target; s.vy = 0; }
      s.thrust = Math.max(0, Math.min(1, s.vy / 60));
      if (s.thrust > 0.15 && !reduce && Math.random() < s.thrust * 0.8) S.bubbles.push({ x: s.x - 14 + Math.random() * 4, y: s.y - 2 + Math.random() * 3, vy: -8 - Math.random() * 10, life: 1.4 + Math.random() });
      s.x += (laneX(s.seat) - s.x) * Math.min(1, dt * 2);
    }
    const tgt = cameraTarget();
    S.camX += (tgt.x - S.camX) * Math.min(1, dt * 2.5); S.camY += (tgt.y - S.camY) * Math.min(1, dt * 3.2 * FAST);
    render();
  }
  function render() {
    if (!S.w) return;
    const u = S.u;
    S.x0 = Math.round(S.fx - S.camX * u); S.y0 = Math.round(S.fy - S.camY * u);
    const ox = ((S.x0 % u) + u) % u, oy = ((S.y0 % u) + u) % u, bx = (S.x0 - ox) / u + 1, by = (S.y0 - oy) / u + 1;
    for (const k of ["world", "subs", "dark", "lamps"]) S.c[k].style.transform = `translate(${ox - u}px, ${oy - u}px)`;
    const W = S.c.world.width, H = S.c.world.height, g = S.g.world;
    // World tiles.
    g.fillStyle = "#060c22"; g.fillRect(0, 0, W, H);
    const top = -by, i0 = Math.floor(Math.max(0, top) / TH), i1 = Math.floor((top + H) / TH);
    for (let i = i0; i <= i1; i++) g.drawImage(tile(i), bx - XOFF, i * TH + by);
    // Submarines, their bubbles and their lights.
    const sg = S.g.subs; sg.clearRect(0, 0, W, H);
    for (const b of S.bubbles) { b.y += b.vy * 0.016; b.life -= 0.016; sg.fillStyle = "rgba(200,232,255,.55)"; sg.globalAlpha = Math.max(0, Math.min(1, b.life)); sg.fillRect(Math.round(b.x + bx + Math.sin(b.y * 0.3)), Math.round(b.y + by), 1, 1); }
    sg.globalAlpha = 1; S.bubbles = S.bubbles.filter(b => b.life > 0).slice(-400);
    const order = [...S.subs.values()].sort((a, b) => (a.me ? 1 : 0) - (b.me ? 1 : 0));        // mine on top
    for (const s of order) { s.box = window.SubArt.draw(sg, Math.round(s.x + bx), Math.round(s.y + by), s.look, S.t, { thrust: s.thrust, alpha: s.here === false ? 0.45 : 1 }); }
    // The dark: deeper water swallows the light, except around each submarine.
    const depth = mOf(S.camY), dark = Math.min(0.5, Math.max(0, (depth - 200) / 2800) * 0.5), dg = S.g.dark;
    dg.clearRect(0, 0, W, H);
    if (dark > 0.01) {
      dg.globalCompositeOperation = "source-over"; dg.fillStyle = `rgba(1,3,10,${dark.toFixed(3)})`; dg.fillRect(0, 0, W, H);
      dg.globalCompositeOperation = "destination-out";
      for (const s of S.subs.values()) { const x = s.x + bx, y = s.y + by, gr = dg.createRadialGradient(x + 8, y, 2, x + 18, y + 4, 52); gr.addColorStop(0, "rgba(0,0,0,.95)"); gr.addColorStop(1, "rgba(0,0,0,0)"); dg.fillStyle = gr; dg.fillRect(x - 60, y - 60, 140, 120); }
      dg.globalCompositeOperation = "source-over";
    }
    S.lifeHooks.forEach(f => { try { f(); } catch { /* wildlife never breaks the race */ } });
    drawLights(bx, by, dark);
    placeLabels();
  }
  // The submarines' windows and lamps, on their own light layer above the dark.
  function drawLights(bx, by, dark) {
    const L = S.g.lamps; L.clearRect(0, 0, S.c.lamps.width, S.c.lamps.height);
    for (const s of S.subs.values()) {
      window.SubArt.lights(L, Math.round(s.x + bx), Math.round(s.y + by), s.look, S.t, { thrust: s.thrust, dark: 0.35 + dark * 0.75 });
      if (s.beneath) {   // an Unfathomable find this question: a low red light breathing round the submarine
        const x = s.x + bx, y = s.y + by, k = 0.22 + 0.06 * Math.sin(S.t * 1.05), gr = L.createRadialGradient(x, y, 2, x, y, 46);
        gr.addColorStop(0, `rgba(224,92,80,${k.toFixed(3)})`); gr.addColorStop(1, "rgba(224,92,80,0)"); L.fillStyle = gr; L.fillRect(x - 48, y - 48, 96, 96);
      }
    }
  }
  // Names and depths over the submarines, as ordinary text. A racer outside the open water gets a marker at its edge.
  function placeLabels() {
    const u = S.u, seen = new Set(), f = S.free, edgeTop = [], edgeBot = [];
    for (const s of S.subs.values()) {
      seen.add(s.name);
      let el = S.labels.get(s.name);
      if (!el) { el = h("div.rc-tag", h("span.n"), h("b.d"), h("span.x")); S.labelBox.append(el); S.labels.set(s.name, el); }
      el.style.setProperty("--who", s.look.hull.base);
      el.classList.toggle("me", !!s.me); el.classList.toggle("away", s.here === false); el.classList.toggle("beneath", !!s.beneath);
      const n = s.me ? "You" : s.name, d = m(s.dist), x = s.note || "";
      if (el.dataset.k !== n + d + x) { el.dataset.k = n + d + x; el.querySelector(".n").textContent = n; el.querySelector(".d").textContent = d; el.querySelector(".x").textContent = x; el.classList.toggle("has-note", !!x); }
      const sx = S.x0 + s.x * u, sy = S.y0 + s.y * u;
      const vis = sy > f.t + 20 && sy < f.b + 8 && sx > f.l - 20 && sx < f.r + 30;
      el.hidden = !vis;
      if (vis) el.style.transform = `translate(${Math.round(sx)}px, ${Math.round(sy - (s.box ? s.box.h / 2 + 6 : 10) * u)}px)`;
      else if (sy <= f.t + 20) edgeTop.push(s); else edgeBot.push(s);
    }
    for (const [k, el] of S.labels) if (!seen.has(k)) { el.remove(); S.labels.delete(k); }
    // Racers out of view: small markers at the top or bottom of the open water, with how far away they are.
    const me = [...S.subs.values()].find(s => s.me), myD = me ? me.dist : 0;
    const key = [f.l, f.r, f.t, f.b, ...edgeTop.map(s => "t" + s.name + Math.round(s.dist) + !!s.beneath), ...edgeBot.map(s => "b" + s.name + Math.round(s.dist) + !!s.beneath), Math.round(myD)].join();
    if (key !== S.edgeKey) {
      S.edgeKey = key; S.edge.textContent = "";
      const chip = (s, where) => h("span.rc-edge.rc-" + where + (s.beneath ? ".beneath" : ""), { style: `--who:${s.look.hull.base}` }, h("i"), (s.me ? "You" : s.name) + " ", h("b", (where === "up" ? "↑ " : "↓ ") + m(Math.abs(s.dist - myD))));
      const row = (list, where, style) => h("div.rc-edge-row.rc-" + where, { style: `left:${f.l + 8}px; right:${S.w - f.r + 8}px; ${style}` }, list.slice(0, 4).map(s => chip(s, where)));
      if (edgeTop.length) S.edge.append(row(edgeTop.sort((a, b) => b.dist - a.dist), "up", `top:${f.t + 8}px`));
      if (edgeBot.length) S.edge.append(row(edgeBot.sort((a, b) => a.dist - b.dist), "down", `top:${f.b - 34}px`));
      S.map.style.top = f.t + (phone() ? 8 : 22) + "px"; S.map.style.height = Math.max(80, f.b - f.t - (phone() ? 16 : 60)) + "px";
    }
    drawMap();
  }
  // The race map: everyone's depth on one line, with the regions marked. Always in view at the right edge.
  function drawMap() {
    const subs = [...S.subs.values()]; if (!subs.length) { S.map.textContent = ""; return; }
    const deepest = Math.max(400, ...subs.map(s => s.dist)) * 1.15;
    const key = subs.map(s => s.name + Math.round(s.dist) + !!s.beneath).join() + Math.round(deepest);
    if (S.mapKey === key) return; S.mapKey = key;
    S.map.textContent = "";
    S.map.append(h("i.rc-map-line"));
    ZONES.forEach((z, i) => { if (i && z.from < deepest) S.map.append(h("span.rc-map-zone", { style: `top:${(z.from / deepest) * 100}%` }, z.name.replace("The ", ""))); });
    for (const s of subs) S.map.append(h("b.rc-map-dot" + (s.me ? ".me" : "") + (s.beneath ? ".beneath" : ""), { style: `top:${(s.dist / deepest) * 100}%; --who:${s.look.hull.base}`, title: `${s.name}: ${m(s.dist)}` }));
  }
  // Keep the submarines in step with the race's players.
  function syncSubs(players, first) {
    const keep = new Set();
    for (const p of players) {
      keep.add(p.username);
      let s = S.subs.get(p.username);
      if (!s) { s = { name: p.username, seat: p.seat, look: window.SubArt.look(p.seat), x: laneX(p.seat), y: yOf(p.distance || 0), vy: 0, dist: p.distance || 0, thrust: 0 }; S.subs.set(p.username, s); }
      s.me = !!p.me; s.here = p.here; s.seat = p.seat; s.look = window.SubArt.look(p.seat);
      if (s.finds != null && (p.finds || 0) > s.finds) s.newFind = true;
      s.finds = p.finds || 0;
      if (first) { s.dist = p.distance; s.y = yOf(p.distance); } else if (!(s.me && s.dist > p.distance)) s.dist = p.distance;   // my own moves come straight from my guess
    }
    for (const k of [...S.subs.keys()]) if (!keep.has(k)) S.subs.delete(k);
  }

  // ================================================================================================================
  // Flow
  // ================================================================================================================
  let race = null, view = "home", poll = 0, offset = 0, cat = null, P = null, catQid = 0, pool = null, unknownKey = "", busy = false, lastStatus = "", lastRound = 0, lastPlayers = [], rankBefore = 0, lastZone = 0, channel = null, encountered = new Set();
  const dock = () => $("#rdock");
  const say = (text, kind) => { const e = $("#r-hint"); if (e) { e.textContent = text || ""; e.className = "hint" + (kind ? " " + kind : ""); } };
  const serverNow = () => Date.now() + offset;
  async function call(fn, args) {
    const t0 = Date.now(), res = await A.rpc(fn, args);
    if (res && res.now) { const rtt = Date.now() - t0; offset = new Date(res.now).getTime() + rtt / 2 - Date.now(); }
    return res;
  }
  async function loadPool() { if (!pool) pool = await fetch("race/index.json").then(r => r.json()).then(j => new Map(j.questions.map(q => [q.id, q]))); return pool; }
  const qfile = new Map();
  const loadQ = qid => { if (!qfile.has(qid)) qfile.set(qid, fetch(`race/${qid}.json`).then(r => r.json()).then(j => j.questions[0])); return qfile.get(qid); };

  // ----- Opening the race screen -----
  async function open(code) {
    busyOpen = true; try { await openInner(code); } finally { busyOpen = false; }
  }
  async function openInner(code) {
    const game = G(); if (game.screen !== "race") game.show("race"); mount();
    document.documentElement.classList.add("in-race");
    window.Sound.setAmbience("race", 0);
    if (!A || !A.signedIn) return showHome();
    await loadPool().catch(() => null);
    if (race && (!code || code === race.code)) { try { race = await call("race_state", { p_race: race.id }); return enter(); } catch { race = null; } }
    // After a reload or a lost connection: back into the race this device was last in, if it is still going.
    const saved = !code && remembered();
    if (code || saved) { try { race = await call("race_join", { p_code: code || saved }); if (saved && race.status === "finished") { race = null; remember(""); return showHome(); } return enter(); } catch (e) { remember(""); return showHome(saved ? "" : e.message); } }
    showHome();
  }
  const remember = code => { try { if (code) localStorage.setItem("iceberg:race", code); else localStorage.removeItem("iceberg:race"); } catch { /* fine */ } };
  const remembered = () => { try { return localStorage.getItem("iceberg:race") || ""; } catch { return ""; } };
  // Signing in (or the account finishing loading) while on the race screen: show what this player can now do.
  if (A) A.onChange(() => { const g = G(); if (g && g.screen === "race" && view === "home" && !busyOpen) open(); });
  let busyOpen = false;
  function close() { stopPolling(); document.documentElement.classList.remove("in-race"); if (channel) { try { channel.unsubscribe(); } catch { /* fine */ } channel = null; } }
  function stopPolling() { clearTimeout(poll); poll = 0; }
  function schedule(ms) { clearTimeout(poll); poll = setTimeout(tick, ms); }
  async function tick() {
    if (!race || G().screen !== "race") return;
    try { race = await call("race_state", { p_race: race.id }); update(); }
    catch (e) { if (/not_in_race|race_not_found/.test(e.code || e.message)) { race = null; return showHome(); } }
    schedule(race && (race.status === "question" || race.status === "between") ? 900 : race && race.status === "lobby" ? 1500 : 4000);
  }
  // Realtime: a nudge on the race's channel makes everyone ask for the new state at once (polling still runs).
  function listen() {
    if (channel || !A.channel) return;
    channel = A.channel("race-" + race.id, () => { clearTimeout(poll); tick(); });
  }
  const nudge = () => { try { if (channel) channel.send({ type: "broadcast", event: "poke", payload: {} }); } catch { /* polling covers it */ } };

  // ----- The race home: quick race, private race, join, practice -----
  async function showHome(error) {
    view = "home"; stopPolling(); race = null; syncSubs([], true); lastStatus = ""; { const meta = $("#top-meta"); if (meta) meta.textContent = "Submarine race"; }
    const box = dock(); box.textContent = ""; box.className = "rdock home";
    box.append(h("div.q", h("p.eyebrow", "Submarine race"), h("h2.r-title", "Race to the bottom"),
      h("p.q-hint", "Live races against real players. Same questions, same clock, three guesses each. Your rarest answer on each question takes your sub deeper. Deepest at the end wins.")));
    if (!A || A.state === "off") { box.append(h("p.note-line", "Races need the game's database, which isn't connected to this copy.")); return; }
    if (!A.signedIn) { box.append(h("p.note-line", "Races are for players with an account, so everyone in a race is a real person."), h("div.row", h("button.btn", { type: "button", onclick: () => window.Hub.open("account") }, "Sign in or create an account"))); return; }
    const waiting = h("span.r-wait", "…");
    const code = h("input", { type: "text", maxLength: 6, placeholder: "CODE", autocapitalize: "characters", autocomplete: "off", spellcheck: false, "aria-label": "Race code" });
    const err = h("p.msg.bad", { role: "status" }, error || "");
    box.append(
      h("div.r-choices",
        h("button.btn.wide", { type: "button", id: "r-quick", onclick: e => act(e.currentTarget, async () => { race = await call("race_quick"); enter(); }, err) }, "Quick race"),
        h("p.fine.center", waiting),
        h("button.btn.ghost.wide", { type: "button", id: "r-private", onclick: e => act(e.currentTarget, async () => { race = await call("race_create", { p_kind: "private" }); enter(); }, err) }, "Race with friends"),
        h("form.r-join", { onsubmit: e => { e.preventDefault(); act(e.submitter, async () => { race = await call("race_join", { p_code: code.value.trim() }); enter(); }, err); } }, code, h("button.btn.ghost.small", { type: "submit" }, "Join")),
        h("button.link", { type: "button", id: "r-practice", onclick: e => act(e.currentTarget, async () => { race = await call("race_create", { p_kind: "practice", p_questions: 5, p_seconds: 30 }); enter(); }, err) }, "Practice alone")),
      err);
    // Friends' invitations, and your race record.
    try {
      const [n, inv, rec] = await Promise.all([A.rpc("race_waiting"), A.rpc("race_invites"), A.rpc("race_record", { p_username: A.profile.username })]);
      waiting.textContent = n ? `${n} ${n === 1 ? "player is" : "players are"} waiting for a race` : "Nobody is waiting right now: you'll open a new race and others can join.";
      if (inv.length) box.insertBefore(h("div.r-invites", h("h3", "Invitations"), inv.map(x => h("div.r-inv", h("span", h("b", x.from), ` · ${x.players} in the lobby`), h("button.btn.small.solid", { type: "button", onclick: e => act(e.currentTarget, async () => { race = await call("race_join", { p_code: x.code }); enter(); }, err) }, "Join")))), box.querySelector(".r-choices"));
      if (rec.races) box.append(h("p.r-record", h("span", h("b", fmt(rec.races)), rec.races === 1 ? " race" : " races"), h("span", h("b", fmt(rec.wins)), rec.wins === 1 ? " win" : " wins"), h("span", "best ", h("b", m(rec.best)))));
    } catch { waiting.textContent = ""; }
  }
  async function act(btn, fn, err) { if (btn) btn.disabled = true; try { await fn(); } catch (e) { if (err) err.textContent = e.message; if (btn) btn.disabled = false; } }

  // ----- In a race -----
  function enter() {
    if (!race) return showHome();
    if (race.code && location.hash !== "#race/" + race.code) history.replaceState(null, "", location.pathname + location.search + "#race/" + race.code);
    remember(race.code); syncSubs(race.players, true); listen(); lastStatus = ""; lastRound = 0; update(); schedule(900);
  }
  function update() {
    if (!race) return;
    const st = race.status;
    if (st === "closed") { race = null; remember(""); return showHome("That race has closed."); }
    syncSubs(race.players, false);
    soundsFor(race);
    const mine = race.players.find(p => p.me), meta = $("#top-meta"); if (meta) meta.textContent = st === "lobby" ? "Submarine race" : `Race · ${m(mine ? mine.distance : 0)}`;
    const changed = st !== lastStatus || race.round !== lastRound;
    lastStatus = st; lastRound = race.round; lastPlayers = race.players.map(p => p.username);
    if (st === "lobby") return lobby(changed);
    if (st === "question") return question(changed);
    if (st === "between") return between(changed);
    if (st === "finished") return results(changed);
  }
  // Sounds and small events from one state to the next: arrivals, readiness, overtakes, new regions.
  let prev = null;
  function soundsFor(r) {
    const S2 = window.Sound, names = r.players.map(p => p.username);
    if (prev && prev.id === r.id) {
      if (names.some(n => !prev.names.includes(n))) S2.play("join");
      if (prev.names.some(n => !names.includes(n))) S2.play("leave");
      const readyNow = r.players.filter(p => p.ready).length; if (r.status === "lobby" && readyNow > prev.ready) S2.play("ready");
      if (prev.status === "lobby" && r.status === "question") S2.play("go");
      if (prev.status === "question" && r.status === "between") S2.play("reveal_all");
      if (r.status === "finished" && prev.status !== "finished") { const me = (r.results || []).find(x => x.username === r.me); S2.play(me && me.place === 1 && r.results.length > 1 ? "win" : "lose"); }
      if (prev.status === "finished" && r.status === "lobby") S2.play("rematch");
      const rank = rankOf(r);
      if (r.status === "question" && prev.rank && rank !== prev.rank) S2.play("overtake", { dir: rank < prev.rank ? 1 : -1 });
      if (rank < prev.rank && r.status === "question") { const passed = r.players.filter(p => !p.me).sort((a, b) => b.distance - a.distance)[rank - 1]; if (passed) flash(`You passed ${passed.username}`); }
    }
    // Another racer's Unfathomable find: everyone sees their submarine light up red and hears it, but not the answer.
    for (const s of S.subs.values()) if (s.newFind) { s.newFind = false; if (!s.me) { s.beneath = r.round; if (prev && prev.id === r.id) { flash(`${s.name} found something Unfathomable`); S2.play("unfathomable"); } } }
    if (r.status !== "question") for (const s of S.subs.values()) s.beneath = 0;
    const me = r.players.find(p => p.me), z = zoneAt(me ? me.distance : 0);
    if (prev && z > lastZone) { S2.play("zone", { level: z }); flash(`${ZONES[z].name}`); }
    lastZone = z;
    S2.setAmbience("race", Math.min(1, (me ? me.distance : 0) / 2600));
    prev = { id: r.id, names, ready: r.players.filter(p => p.ready).length, status: r.status, rank: rankOf(r) };
  }
  const rankOf = r => { const sorted = r.players.slice().sort((a, b) => b.distance - a.distance); return sorted.findIndex(p => p.me) + 1; };
  function flash(text) { const f = $("#r-flash"); if (!f) return; f.textContent = text; f.classList.remove("on"); void f.offsetWidth; f.classList.add("on"); }

  // ----- Lobby -----
  function lobby(changed) {
    view = "lobby";
    const r = race, meHost = r.host === r.me, box = dock();
    if (changed || !box.querySelector(".r-lobby")) {
      box.textContent = ""; box.className = "rdock lobby";
      const link = location.origin + location.pathname + "#race/" + r.code;
      box.append(h("div.r-lobby",
        h("p.eyebrow", r.kind === "public" ? "Quick race" : "Private race"),
        r.kind === "private" ? h("div.r-code", h("span", "Code"), h("b#r-code", r.code), h("button.btn.small.ghost", { type: "button", id: "r-copy", onclick: e => { copy(link, e.currentTarget); } }, "Copy invite link")) : h("p.r-title", "Waiting for racers"),
        h("p.note-line#r-lobby-note"),
        h("ul.r-players#r-players"),
        meHost && r.kind === "private" ? settingsRow(r) : h("p.fine#r-settings-line"),
        h("div.row.r-actions#r-actions"),
        r.kind === "private" ? h("div.r-friends#r-friends") : null,
        h("p.msg.bad#r-err", { role: "status" })));
      if (r.kind === "private") inviteList();
    }
    const list = $("#r-players"); list.textContent = "";
    r.players.forEach(p => list.append(h("li", { style: `--who:${window.SubArt.look(p.seat).hull.base}` }, h("i.r-dot"), h("span.r-name", p.me ? `${p.username} (you)` : p.username), p.host ? h("span.tag", "Host") : null,
      h("span.r-state" + (p.ready ? ".ok" : ""), p.here === false ? "connecting…" : p.ready ? "Ready" : "Not ready"))));
    const ready = r.players.filter(p => p.ready).length, need = r.players.length;
    const note = $("#r-lobby-note");
    if (r.kind === "public") {
      const left = r.lobby_until ? Math.max(0, Math.ceil((new Date(r.lobby_until).getTime() - serverNow()) / 1000)) : null;
      note.textContent = r.players.length < 2 ? "Waiting for at least one more racer. The race starts by itself." : left != null ? `Starting in ${left} s · ${r.players.length} of ${r.max_players} racers` : "";
      if (left != null) window.Sound.play("count", { last: left <= 1 });
    } else note.textContent = `${need} of ${r.max_players} racers · ${ready} ready`;
    const sline = $("#r-settings-line"); if (sline) sline.textContent = `${r.q_count} questions · ${r.seconds} seconds each`;
    const acts = $("#r-actions"); acts.textContent = "";
    const err = $("#r-err");
    const me = r.players.find(p => p.me);
    if (r.kind === "private" && !meHost) acts.append(h("button.btn" + (me.ready ? ".ghost" : ""), { type: "button", id: "r-ready", onclick: e => act(e.currentTarget, async () => { race = await call("race_ready", { p_race: r.id, p_ready: !me.ready }); nudge(); update(); }, err) }, me.ready ? "Not ready" : "I'm ready"));
    if (meHost && r.kind === "private") { const can = need >= 2 && ready >= need; acts.append(h("button.btn", { type: "button", id: "r-start", disabled: !can, onclick: e => act(e.currentTarget, async () => { race = await call("race_start", { p_race: r.id }); nudge(); update(); }, err) }, can ? "Start the race" : need < 2 ? "Waiting for racers" : "Waiting for everyone to be ready")); }
    acts.append(h("button.link", { type: "button", id: "r-leave", onclick: () => leave() }, "Leave"));
  }
  function settingsRow(r) {
    const sel = (label, opts, cur, key) => h("label.r-set", label, h("select", { onchange: () => setting() }, opts.map(([v, t]) => { const o = h("option", { value: v }, t); if (v === cur) o.selected = true; return o; })));
    return h("div.r-settings", sel("Length", [[5, "Sprint · 5"], [10, "Standard · 10"], [15, "Expedition · 15"]], r.q_count, "q"), sel("Time", [[20, "20 s"], [30, "30 s"], [45, "45 s"]], r.seconds, "s"), sel("Racers", [2, 3, 4, 5, 6, 7, 8].map(n => [n, `up to ${n}`]), r.max_players, "n"));
  }
  // All three menus are sent together, as they stand now, so two quick changes can't undo each other.
  async function setting() {
    const r = race, [q, s, n] = [...document.querySelectorAll(".r-settings select")].map(x => +x.value);
    try { race = await call("race_settings", { p_race: r.id, p_questions: q, p_seconds: s, p_max: n }); nudge(); update(); } catch (e) { const er = $("#r-err"); if (er) er.textContent = e.message; }
  }
  async function inviteList() {
    const box = $("#r-friends"); if (!box) return;
    try {
      const f = await A.rpc("friends", { p_day: G().today() }), here = new Set(race.players.map(p => p.username));
      const list = f.friends.filter(x => !here.has(x.username));
      if (!list.length) { box.textContent = ""; return; }
      box.append(h("h3", "Invite friends"), h("ul.rows", list.slice(0, 8).map(x => h("li", h("span"), h("span.name", x.username), h("button.btn.small.ghost", { type: "button", onclick: e => act(e.currentTarget, async () => { await A.rpc("race_invite", { p_race: race.id, p_username: x.username }); e.target.textContent = "Invited"; }, $("#r-err")) }, "Invite")))));
    } catch { /* fine */ }
  }
  async function copy(text, btn) { try { await navigator.clipboard.writeText(text); btn.textContent = "Copied"; } catch { btn.textContent = text; } setTimeout(() => { btn.textContent = "Copy invite link"; }, 2500); }
  async function leave() { const r = race; race = null; remember(""); stopPolling(); history.replaceState(null, "", location.pathname + location.search + "#race"); try { await A.rpc("race_leave", { p_race: r.id }); nudge(); } catch { /* gone anyway */ } showHome(); }

  // ----- A question -----
  let ice = null, iceFrame = 0;
  async function question(changed) {
    view = "question";
    const r = race, box = dock();
    if (changed) {
      box.textContent = ""; box.className = "rdock playing";
      unknownKey = ""; busy = false; encountered.clear();
      const qinfo = pool && pool.get(r.qid);
      box.append(h("div.q", h("p.eyebrow", h("span#r-qnum", `Question ${r.round} of ${r.q_count}`), h("span.r-mydepth#r-mydepth")), h("div.q-title", h("span.q-icon.cat-icon#r-qicon", { "aria-hidden": "true" }), h("h2#r-qtitle", qinfo ? qinfo.title : "…"))),
        h("div#r-panel",
          h("form.entry#r-entry", { autocomplete: "off", novalidate: true, onsubmit: e => { e.preventDefault(); submit(); } },
            h("div.melt#r-melt", { role: "timer" }, h("canvas#r-ice", { "aria-hidden": "true" }), h("span.melt-n#r-secs", String(r.seconds))),
            h("label.sr", { for: "r-answer" }, "Your guess"),
            h("input#r-answer", { type: "text", maxLength: 60, autocomplete: "off", autocapitalize: "none", spellcheck: false, enterkeyhint: "go", placeholder: "Type a guess" }),
            h("button#r-add", { type: "submit", "aria-label": "Submit guess", onpointerdown: e => e.preventDefault() }, (() => { const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("viewBox", "0 0 24 24"); s.innerHTML = '<path d="M12 4v15M6 13l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>'; return s; })())),
          h("p.hint#r-hint", { role: "status", "aria-live": "polite" }),
          h("ol.r-tries#r-tries", { "aria-label": "Your three guesses" }),
          h("div.r-standing#r-standing", { "aria-label": "Live ranking" }),
          h("div.finish-row", h("button.btn.ghost#r-done", { type: "button", onclick: () => act(null, async () => { race = await call("race_done", { p_race: race.id }); nudge(); update(); }) }, "Done with this question"),
            h("button.link#r-leave", { type: "button", onclick: () => { if (confirm("Leave this race? You can't rejoin it once you leave.")) leave(); } }, "Leave race"))));
      ice = window.IceTimer.create($("#r-ice"));
      if (qinfo) window.IcebergIcons.put($("#r-qicon"), qinfo.icon);
      $("#r-answer").oninput = () => { if (unknownKey && window.IcebergValidate.normalize($("#r-answer").value) !== unknownKey) { unknownKey = ""; say(""); } };
      if (catQid !== r.qid) { cat = null; P = null; catQid = r.qid; loadQ(r.qid).then(c => { if (catQid === r.qid) { cat = c; P = window.IcebergValidate.prepare(c); } }); }
      window.Sound.play("question");
      cancelAnimationFrame(iceFrame); const step = () => { if (view !== "question") return; clockDraw(); iceFrame = requestAnimationFrame(step); }; step();
      setTimeout(() => { const a = $("#r-answer"); if (a) a.focus({ preventScroll: true }); }, 50);
    }
    tries(); standing();
  }
  // The shared clock: the server's deadline, not this device's. It never pauses: everyone has the same time.
  function clockDraw() {
    const r = race; if (!r || !ice) return;
    const start = new Date(r.round_start).getTime(), end = new Date(r.round_end).getTime(), now = serverNow(), total = end - start;
    const before = now < start, left = Math.max(0, end - now), secs = before ? Math.ceil((start - now) / 1000) : Math.ceil(left / 1000);
    ice.set(before ? 1 : left / total, { paused: before, urgent: !before && secs <= 5 ? 1 - left / 5000 : 0 });
    const box = $("#r-melt"); if (!box) return;
    box.classList.toggle("low", !before && secs <= 10); box.classList.toggle("last", !before && secs <= 5); box.classList.toggle("out", !before && left <= 0); box.classList.toggle("paused", before);
    const n = $("#r-secs"); if (n && n.textContent !== String(secs)) { n.textContent = String(secs); if (before) window.Sound.play("count", { last: secs <= 1 }); else if (secs <= 5 && secs >= 1) window.Sound.play("drip", { step: 5 - secs }); }
    const input = $("#r-answer"); if (input) { input.disabled = !before && left <= 0; input.placeholder = before ? `Starting in ${secs}…` : "Type a guess"; }
  }
  function myRound() { return (race.mine || []).filter(g => g.round === race.round); }
  function tries() {
    const list = $("#r-tries"); if (!list) return;
    const mine = myRound(), best = mine.filter(g => g.status === "ok").reduce((b, g) => !b || g.depth > b.depth ? g : b, null);
    list.textContent = "";
    for (let i = 1; i <= 3; i++) {
      const g = mine.find(x => x.slot === i);
      const name = g ? (g.status === "ok" ? (cat ? (cat.answers.find(a => a.a === g.answer) || {}).d || g.answer : g.answer) : g.typed) : "";
      list.append(h("li.r-try" + (!g ? (i === mine.length + 1 ? ".next" : ".empty") : g.status === "ok" ? ".ok" + (g === best ? ".best" : "") + (window.Iceberg.isBeyond(g.depth) ? ".beyond" : "") : ".pending"),
        h("span.slot-n", String(i)), h("span.r-try-name", g ? name : `Guess ${i}`), h("span.r-try-d", g ? (g.status === "ok" ? m(g.depth) : "no depth") : "–")));
    }
    const me = race.players.find(p => p.me), d = $("#r-mydepth"); if (d && me) d.textContent = `Your depth ${m(me.distance)}`;
    const done = $("#r-done"); if (done) done.hidden = mine.length >= 3 || (me && me.done);
  }
  // A compact live ranking: positions and depths only, never answers.
  function standing() {
    const box = $("#r-standing"); if (!box) return;
    const ps = race.players.slice().sort((a, b) => b.distance - a.distance);
    box.textContent = "";
    ps.forEach((p, i) => box.append(h("div.r-row" + (p.me ? ".me" : ""), { style: `--who:${window.SubArt.look(p.seat).hull.base}` }, h("span.r-pos", String(i + 1)), h("i.r-dot"), h("span.r-name", p.me ? "You" : p.username),
      h("span.r-used", { title: "guesses used" }, "•".repeat(p.used) + "◦".repeat(Math.max(0, 3 - p.used))), h("b", m(p.distance)))));
  }
  async function submit() {
    const r = race; if (!r || r.status !== "question" || busy) return;
    const input = $("#r-answer"), text = input.value.trim(); if (!text) return;
    if (serverNow() < new Date(r.round_start).getTime()) return;
    if (!P) { say("Loading the question…"); return; }
    const mine = myRound();
    if (mine.length >= 3) { say("That's all three guesses for this question.", "warn"); return; }
    const V = window.IcebergValidate, given = { rows: new Map(mine.filter(g => g.answer).map(g => [g.answer, g])), texts: new Set(mine.filter(g => !g.answer).map(g => V.normalize(g.typed))) };
    const j = V.judge(text, P, given); if (!j) return;
    if (j.status === "dup") { say(`Already tried. No guess used.`, "warn"); window.Sound.play("duplicate"); input.select(); return; }
    if (j.status === "invalid") { say(`${j.reason}. No guess used.`, "warn"); window.Sound.play("invalid"); const f = $("#r-entry"); f.classList.remove("shake"); void f.offsetWidth; f.classList.add("shake"); input.select(); return; }
    if (j.status === "pending" && unknownKey !== j.key) { unknownKey = j.key; window.Sound.play("pending"); say(j.suggest ? `Did you mean ${j.suggest.join(" or ")}? Enter again to send “${j.text}” anyway (no depth).` : `“${j.text}” isn't one we know. Enter again uses a guess for no depth.`, "warn"); input.select(); return; }
    unknownKey = ""; busy = true; input.value = "";
    window.Sound.play(mine.length === 2 ? "final" : "submit", { step: mine.length });
    try {
      const res = await call("race_guess", { p_race: r.id, p_round: r.round, p_typed: text, p_answer: j.status === "ok" && j.row ? j.row.a : null });
      busy = false;
      if (res.status === "dup") { say("Already tried. No guess used.", "warn"); return; }
      (race.mine = race.mine || []).push({ round: r.round, slot: res.slot, typed: text, answer: res.answer, status: res.status, share: res.share, depth: res.depth });
      const me = race.players.find(p => p.me); if (me) { me.distance = res.distance; me.used = res.slot; }
      const beneath = res.status === "ok" && window.Iceberg.isBeyond(res.depth);
      const sub = [...S.subs.values()].find(s => s.me);
      if (sub) { sub.dist = res.distance; sub.note = res.status === "ok" ? `${j.row ? (j.row.d || j.row.a) : text} · ${beneath ? "Unfathomable" : G().pctText(res.share)}` : ""; if (beneath) { sub.beneath = r.round; sub.finds = (sub.finds || 0) + 1; } setTimeout(() => { if (sub.note && sub.dist === res.distance) sub.note = ""; }, beneath ? 6500 : 3200); }
      if (res.status !== "ok") say(`Saved for review: no depth.${res.left ? ` ${res.left} left.` : ""}`);
      else if (beneath) { say(`Unfathomable: ${res.depth} m, ${G().pctText(res.share)} of players.${res.moved > 0 ? ` Down ${res.moved} m.` : ""}${res.left ? ` ${res.left} left.` : ""}`, "beyond"); if (res.moved > 0) window.Sound.play("thrust", { size: Math.min(1, res.moved / 260) }); window.Sound.play("unfathomable"); }
      else if (res.moved > 0) { say(`${res.depth} m · ${G().pctText(res.share)} of players. Down ${res.moved} m.${res.left ? ` ${res.left} left.` : ""}`, "good"); window.Sound.play("thrust", { size: Math.min(1, res.moved / 260) }); window.Sound.play(res.depth >= 200 ? "rare" : "reveal", { m: res.depth, lead: 0.6 }); }
      else { say(`${res.depth} m · not deeper than your best, so you stay at ${m(res.distance)}.${res.left ? ` ${res.left} left.` : ""}`); window.Sound.play("neutral"); }
      // An exceptional answer: something large comes past your submarine.
      if (res.status === "ok" && res.depth >= 200 && S.life && sub && !encountered.has(r.round)) {
        encountered.add(r.round);
        const kind = res.depth >= 300 ? "colossal" : res.depth >= 250 ? "bigfin" : "giant", e = S.life.encounterFor ? S.life.encounterFor(res.depth, []) : null;
        // Placed in the wildlife's own coordinates, where the submarine is on screen.
        setTimeout(() => { const wy = wildY(mOf(S.camY)) + (sub.y - S.camY); S.life.encounter((e && e.key) || kind, { x: sub.x, y: wy }); window.Sound.play("encounter", { kind: (e && e.key) || kind }); }, 700);
      }
      tries(); standing(); nudge();
      if (res.left === 0) say("All three used. Waiting for the others…");
    } catch (e) { busy = false; say(e.message, "warn"); if (/round_closed/.test(e.code || "")) tick(); }
    input.focus({ preventScroll: true });
  }

  // ----- Between questions: everyone's best answer, then on to the next -----
  async function between(changed) {
    view = "between";
    const r = race, box = dock();
    if (!changed) { const n = $("#r-next"); if (n) n.textContent = `Next question in ${Math.max(0, Math.ceil((new Date(r.between_until).getTime() - serverNow()) / 1000))} s`; return; }
    box.textContent = ""; box.className = "rdock between";
    const q = await loadQ(r.qid).catch(() => null), title = (pool && pool.get(r.qid) || {}).title || "";
    const best = {};
    for (const g of [...(r.revealed || []).filter(x => x.round === r.round), ...myRound().map(x => ({ ...x, username: r.me }))]) if (g.status === "ok" && (!best[g.username] || g.depth > best[g.username].depth)) best[g.username] = g;
    const top = Math.max(0, ...Object.values(best).map(g => g.depth));
    const nameOf = g => q ? ((q.answers.find(a => a.a === g.answer) || {}).d || g.answer) : g.answer;
    const rows = r.players.slice().sort((a, b) => ((best[b.username] || {}).depth || 0) - ((best[a.username] || {}).depth || 0));
    box.append(h("div.r-between", h("p.eyebrow", `Question ${r.round} of ${r.q_count} · ${title}`), h("h2.r-title", "Deepest answers"),
      h("ul.r-best", rows.map(p => { const g = best[p.username]; return h("li" + (g && g.depth === top && top > 0 ? ".won" : "") + (p.me ? ".me" : "") + (g && window.Iceberg.isBeyond(g.depth) ? ".beyond" : ""), { style: `--who:${window.SubArt.look(p.seat).hull.base}` },
        h("i.r-dot"), h("span.r-name", p.me ? "You" : p.username), h("span.r-ans", g ? nameOf(g) : "nothing counted"), h("span.r-pct", g ? G().pctText(g.share) : ""), h("b", g ? m(g.depth) : "0 m")); })),
      h("p.fine#r-next"), h("button.link#r-leave", { type: "button", onclick: () => { if (confirm("Leave this race? You can't rejoin it once you leave.")) leave(); } }, "Leave race")));
    // The answers, briefly, above each submarine.
    for (const s of S.subs.values()) { const g = best[s.name]; s.note = g ? nameOf(g) : ""; }
    window.Sound.play("standings", { n: r.players.length });
    setTimeout(() => { for (const s of S.subs.values()) s.note = ""; }, 6500);
  }

  // ----- Results -----
  async function results(changed) {
    view = "results";
    if (!changed) return;
    const r = race, box = dock(); box.textContent = ""; box.className = "rdock results";
    const res = r.results || [], me = res.find(x => x.username === r.me), win = res[0];
    for (const s of S.subs.values()) s.note = "";
    const titles = await Promise.all((r.questions || []).map(id => loadQ(id).catch(() => null)));
    const rowsFor = username => (r.questions || []).map((qid, i) => {
      const src = username === r.me ? (r.mine || []) : (r.revealed || []).filter(g => g.username === username);
      const g = src.filter(x => x.round === i + 1 && x.status === "ok").reduce((b, x) => !b || x.depth > b.depth ? x : b, null), q = titles[i];
      return { title: (pool && pool.get(qid) || {}).title || (q && q.title) || "", name: g ? (q ? ((q.answers.find(a => a.a === g.answer) || {}).d || g.answer) : g.answer) : "", depth: g ? g.depth : 0 };
    });
    const playerOf = n => r.players.find(p => p.username === n) || { seat: 0 };
    box.append(h("div.r-results",
      h("p.eyebrow", `${r.kind === "practice" ? "Practice" : "Race"} over · ${r.q_count} questions`),
      h("h2.r-title", res.length > 1 ? (win && win.username === r.me ? "You won" : `${win ? win.username : ""} wins`) : "Your expedition"),
      me ? h("p.r-sum", h("b", m(me.distance)), ` · deepest ${me.deepest} m · ${me.rounds_won} question${me.rounds_won === 1 ? "" : "s"} won${res.length > 1 ? ` · place ${me.place} of ${res.length}` : ""}`) : null,
      h("ol.r-final", res.map(x => { const p = playerOf(x.username); return h("li" + (x.username === r.me ? ".me" : ""), { style: `--who:${window.SubArt.look(p.seat).hull.base}` },
        h("span.r-pos", String(x.place)), h("i.r-dot"), h("span.r-name", x.username === r.me ? "You" : x.username),
        h("span.r-meta", `deepest ${x.deepest} m · ${x.rounds_won} won`), h("b", m(x.distance)),
        h("span.r-links", h("button.link", { type: "button", onclick: () => window.Viewer.openRace(r.id, r.match, x.username) }, "Explore"),
          x.username !== r.me && p.friend === false ? h("button.link", { type: "button", onclick: e => act(e.currentTarget, async () => { await A.rpc("friend_request", { p_username: x.username }); e.target.textContent = "Request sent"; }) }, "Add friend") : null)); })),
      h("details.r-answers", h("summary", "Best answer on each question"), h("div.scroll", h("table", h("tr", h("th", "Question"), ...res.map(x => h("th", x.username === r.me ? "You" : x.username))),
        ...(r.questions || []).map((_, i) => h("tr", h("td", rowsFor(r.me)[i].title), ...res.map(x => { const c = rowsFor(x.username)[i]; return h("td" + (window.Iceberg.isBeyond(c.depth) ? ".beyond" : ""), c.name ? `${c.name} · ${c.depth} m` : "–"); })))))),
      h("div.row.r-actions",
        h("button.btn", { type: "button", id: "r-rematch", onclick: e => act(e.currentTarget, async () => { race = await call("race_rematch", { p_race: r.id }); nudge(); update(); }) }, r.kind === "public" ? "Race again" : r.kind === "practice" ? "Practice again" : "Rematch"),
        h("button.btn.ghost", { type: "button", onclick: () => leave() }, "Leave"))));
  }

  // Tests only: put submarines at chosen depths to look at the deeper water (never reachable from the game itself).
  const preview = PARAMS.has("test") ? (list, o = {}) => {
    const g = G(); g.show("race"); mount(); view = "preview"; dock().textContent = ""; syncSubs(list.map((d, i) => ({ username: i ? "Racer" + i : "You", seat: i, distance: d, me: !i, here: true })), true); S.camY = yOf(list[0]);
    if (o.squid && S.life) { const me = [...S.subs.values()].find(s => s.me); me.beneath = 1; setTimeout(() => S.life.encounter("colossal", { x: me.x, y: wildY(mOf(S.camY)) }), 50); }
  } : undefined;
  window.Race = { open, close, preview, get state() { return race; }, get view() { return view; }, get scene() { return { subs: [...S.subs.values()].map(s => ({ name: s.name, dist: s.dist, y: s.y, me: s.me, beneath: !!s.beneath })), camY: S.camY, u: S.u, zone: ZONES[zoneAt(mOf(S.camY))].name, guests: S.life ? S.life.guests : [], flash: ($("#r-flash") || {}).textContent || "" }; }, ZONES, walls, yOf };
})();
