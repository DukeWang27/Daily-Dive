// Set pieces in the water for the experimental rounds (playtest only): sea mines that bob on their chains and burst,
// and the four routes of a branching day (shipwreck, research station, cavern, trench), each painted as a place you
// travel into. Drawn at the artwork's own pixel size, like the wildlife, on two canvases of its own: one behind the
// iceberg (the far parts of a route), one in front of it (the near parts and the mines, still shaded by the deep) and
// one for light (portholes, windows, glowing life).
// The game runs the same without it.
(function () {
  "use strict";
  const I = window.Iceberg, { WW, CX } = I.WORLD;
  const mod = (a, n) => ((a % n) + n) % n;
  const ease = k => { k = Math.max(0, Math.min(1, k)); return 1 - Math.pow(1 - k, 3); };
  const rng = s => () => (s = (s * 16807) % 2147483647) / 2147483647;

  // ---------- Route art, painted once when the route is chosen ----------
  // Each route has a far layer (big shapes, dim, slow) and a near one (detail, faster), plus a light layer. RH is how
  // far down the art runs below the point where you chose: the rest of the day.
  const RH = 760;
  function canvas(w, h) { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
  function px(g, x, y, w, h, col, a = 1) { g.globalAlpha = a; g.fillStyle = col; g.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h))); g.globalAlpha = 1; }
  function poly(g, pts, col, a = 1) { g.globalAlpha = a; g.fillStyle = col; g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); g.fill(); g.globalAlpha = 1; }
  function circ(g, x, y, r, col, a = 1) { g.globalAlpha = a; g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, 6.283); g.fill(); g.globalAlpha = 1; }
  // A jagged wall of rock from the side of the art to an edge that wanders: side -1 left, 1 right.
  function wall(g, side, edge, col, hi, r) {
    const pts = [[side < 0 ? 0 : WW, 0]];
    for (let y = 0; y <= RH; y += 6) pts.push([edge(y) + (r() - 0.5) * 6, y]);
    pts.push([side < 0 ? 0 : WW, RH]); poly(g, pts, col);
    for (let y = 4; y < RH; y += 7 + r() * 9) { const x = edge(y); px(g, side < 0 ? x - 3 - r() * 8 : x + 1, y, 2 + r() * 6, 1, hi, 0.6); }
  }

  const ROUTES = {
    // A wreck on its side: the hull, its ribs where it broke, rust running down, the mast still reaching up.
    wreck(far, near, lume, r) {
      const f = far.getContext("2d"), n = near.getContext("2d"), L = lume.getContext("2d");
      wall(f, -1, y => CX - 250 + Math.sin(y / 90) * 18, "#0c1218", "#18222b", r); wall(f, 1, y => CX + 260 + Math.sin(y / 70 + 2) * 20, "#0c1218", "#18222b", r);
      // The seabed it lies on.
      poly(f, [[0, 330], [CX - 120, 300], [CX + 60, 318], [WW, 290], [WW, RH], [0, RH]], "#0d141b");
      // The hull: a long dark shape tipped over to the left, plank lines along it.
      const hx = CX - 228, hy = 170, len = 190, tilt = 0.2;
      const P = (u, v) => [hx + u * Math.cos(tilt) - v * Math.sin(tilt), hy + u * Math.sin(tilt) + v * Math.cos(tilt)];
      poly(n, [P(0, 0), P(len, 0), P(len + 22, 30), P(len - 6, 62), P(10, 66), P(-12, 34)], "#2a2521");
      poly(n, [P(0, 0), P(len, 0), P(len + 6, 8), P(-4, 8)], "#3b332c");
      for (let v = 14; v < 62; v += 9) for (let u = 4; u < len; u += 2) { const [x, y] = P(u, v); if (r() < 0.55) px(n, x, y, 1, 1, "#1f1b18"); }
      // Rust: streaks running down the side, and blooms round the portholes.
      for (let k = 0; k < 26; k++) { const [x, y] = P(8 + r() * (len - 10), 6 + r() * 30); px(n, x, y, 1, 4 + r() * 18, r() < 0.5 ? "#7a3f22" : "#94512c", 0.75); }
      for (let k = 0; k < 7; k++) { const [x, y] = P(24 + k * 24, 22); circ(n, x, y, 3.2, "#5d3420"); circ(n, x, y, 2, "#0a0c0e"); if (k === 2 || k === 5) circ(L, x, y, 2, "#ffcf8a", 0.32); }
      // The broken end: ribs showing.
      for (let k = 0; k < 6; k++) { const [x, y] = P(len - 4 + k * 4, 6 + k * 2); px(n, x, y, 1, 36 - k * 4, "#3a3029"); }
      // The mast, leaning up and out, with a little rigging still on it.
      for (let k = 0; k < 120; k++) { const [x, y] = P(80 - k * 0.55, -k * 0.92); px(n, x, y, 2, 1, k % 9 ? "#2e2823" : "#4b3e33"); }
      for (let k = 0; k < 40; k++) { const [x, y] = P(80 - k * 1.4, -70 + k * 1.6); if (k % 2) px(n, x, y, 1, 1, "#4a463f", 0.7); }
      // Life moving in: anemones and weed on the hull, a scatter of shells.
      for (let k = 0; k < 18; k++) { const [x, y] = P(r() * len, -1); px(n, x, y - 2, 1, 2 + r() * 3, ["#c85a7c", "#e08a5a", "#6ab48a"][k % 3]); }
      for (let k = 0; k < 9; k++) { const x = CX - 160 + r() * 260, y = 296 + r() * 30; for (let j = 0; j < 26; j++) px(n, x + Math.sin(j / 4) * 2, y - j, 1, 1, "#2d5a3e", 0.8); }
      // An anchor and a chain on the seabed, a crate split open.
      const ax = CX + 120, ay = 300; px(n, ax, ay - 18, 2, 18, "#3a3631"); px(n, ax - 7, ay - 4, 16, 2, "#3a3631"); px(n, ax - 8, ay - 7, 2, 4, "#3a3631"); px(n, ax + 8, ay - 7, 2, 4, "#3a3631"); circ(n, ax + 1, ay - 20, 3, "#3a3631"); circ(n, ax + 1, ay - 20, 1.4, "#0d141b");
      for (let k = 0; k < 30; k++) px(n, ax + 4 + k * 2, ay + 2 + Math.sin(k / 3) * 1.5, 1, 1, "#4a3a2c");
      px(n, CX + 168, 292, 18, 12, "#3b2f25"); px(n, CX + 168, 292, 18, 1, "#57463a"); px(n, CX + 174, 292, 1, 12, "#2a211b");
      // Deeper down, more of it: a second smaller wreck far off.
      poly(f, [[CX + 150, 520], [CX + 250, 506], [CX + 262, 528], [CX + 156, 540]], "#141b21");
    },
    // A research station on a rock shelf: modules with lit windows, a dome, pipes, a tower with a beacon, a cable up.
    station(far, near, lume, r) {
      const f = far.getContext("2d"), n = near.getContext("2d"), L = lume.getContext("2d");
      wall(f, -1, y => CX - 270 + Math.sin(y / 110) * 14, "#0b131a", "#17212a", r); wall(f, 1, y => CX + 250 + Math.sin(y / 60) * 10 - (y > 260 ? 40 : 0), "#0b131a", "#17212a", r);
      poly(n, [[CX + 50, 236], [CX + 120, 226], [CX + 210, 230], [WW, 222], [WW, 280], [CX + 60, 270]], "#141c24");
      const mod1 = (x, y, w, h) => { px(n, x, y, w, h, "#3a4656"); px(n, x, y, w, 2, "#5b6c80"); px(n, x, y + h - 2, w, 2, "#262f3a");
        for (let k = 3; k < w - 4; k += 6) { px(n, x + k, y + 5, 3, 3, "#0c1014"); circ(L, x + k + 1.5, y + 6.5, 2.6, "#ffe6a0", 0.42); }
        for (let k = 0; k < w; k += 4) px(n, x + k, y + h - 5, 2, 1, "#c9a227", 0.8); };
      mod1(CX + 76, 204, 46, 22); mod1(CX + 132, 196, 58, 30); mod1(CX + 200, 210, 40, 18);
      // A dome with a big window, a tower with an antenna, a light on top.
      circ(n, CX + 160, 196, 16, "#46566a"); px(n, CX + 144, 196, 33, 6, "#3a4656"); circ(n, CX + 160, 192, 8, "#0c1014"); circ(L, CX + 160, 192, 9, "#bfe6ff", 0.34);
      px(n, CX + 214, 140, 4, 70, "#334050"); px(n, CX + 215, 112, 1, 28, "#7a8696"); for (let k = 0; k < 70; k += 8) px(n, CX + 212, 144 + k, 8, 1, "#4a586a");
      // Pipes between the modules and a cable rising out of sight to the surface.
      px(n, CX + 122, 214, 10, 3, "#59646f"); px(n, CX + 190, 218, 10, 3, "#59646f"); px(n, CX + 100, 226, 1, 20, "#59646f");
      for (let y = 0; y < 196; y += 2) px(n, CX + 170 + Math.sin(y / 40) * 3, y, 1, 2, "#3e4b58", 0.9);
      // Equipment on the seabed: a sampling frame, a crate of instruments, a sensor post on the far side.
      px(n, CX + 58, 222, 14, 1, "#6a7480"); px(n, CX + 58, 222, 1, 10, "#6a7480"); px(n, CX + 71, 222, 1, 10, "#6a7480"); px(n, CX + 240, 216, 12, 8, "#c9a227", 0.75);
      px(n, CX - 150, 150, 2, 120, "#2b3642"); circ(n, CX - 149, 148, 4, "#e05a44"); circ(L, CX - 149, 148, 5, "#ff8a70", 0.3);
      // A second, older module further down, dark.
      px(f, CX + 120, 470, 60, 22, "#1a222b"); px(f, CX + 120, 470, 60, 1, "#26303a");
    },
    // A cave: walls close in to a narrow way through, teeth of rock above and below, living light in the cracks.
    cavern(far, near, lume, r) {
      const f = far.getContext("2d"), n = near.getContext("2d"), L = lume.getContext("2d");
      const narrow = y => 150 - 70 * Math.sin(Math.min(1, y / 420) * Math.PI) + Math.sin(y / 23) * 8;
      wall(f, -1, y => CX - narrow(y) - 40, "#0d1016", "#1b2029", r); wall(f, 1, y => CX + narrow(y) + 40, "#0d1016", "#1b2029", r);
      wall(n, -1, y => CX - narrow(y), "#181c24", "#2b3240", r); wall(n, 1, y => CX + narrow(y), "#181c24", "#2b3240", r);
      // Teeth of rock: stalactites hanging from ledges, stalagmites rising.
      for (let k = 0; k < 22; k++) { const side = k % 2 ? 1 : -1, y = 30 + k * 32 + r() * 10, x0 = CX + side * narrow(y), w = 5 + r() * 7, h = 10 + r() * 22;
        const xi = x0 - side * (2 + r() * 14), down = r() < 0.6; poly(n, [[xi - w / 2, y], [xi + w / 2, y], [xi + (r() - 0.5) * 3, y + (down ? h : -h)]], "#20252f"); }
      // Living light: clusters of glowing specks in the rock, a few hanging threads.
      for (let k = 0; k < 40; k++) { const side = r() < 0.5 ? -1 : 1, y = r() * RH, x = CX + side * (narrow(y) + 2 + r() * 30), col = r() < 0.6 ? "#5ff6d0" : "#7fb8ff";
        for (let j = 0; j < 4 + r() * 6; j++) circ(L, x + (r() - 0.5) * 8, y + (r() - 0.5) * 8, 0.8 + r() * 0.8, col, 0.5 + r() * 0.4); }
      for (let k = 0; k < 9; k++) { const x = CX + (r() - 0.5) * 140, y = 20 + r() * 500; for (let j = 0; j < 18 + r() * 20; j++) px(L, x, y + j, 1, 1, "#9ffbe6", 0.5 * (1 - j / 38)); }
    },
    // The trench: sheer walls on both sides, closing in and going down further than the light reaches.
    trench(far, near, lume, r) {
      const f = far.getContext("2d"), n = near.getContext("2d"), L = lume.getContext("2d");
      // Far off, enormous columns of rock: a sense of how big the place is.
      for (let k = 0; k < 3; k++) { const x = CX - 210 + k * 180 + r() * 30, w = 26 + r() * 24, pts = [];
        for (let y = 0; y <= RH; y += 10) pts.push([x + Math.sin(y / 47 + k) * 6 + (r() - 0.5) * 4, y]);
        for (let y = RH; y >= 0; y -= 10) pts.push([x + w * (0.7 + 0.3 * Math.sin(y / 90 + k)) + (r() - 0.5) * 4, y]);
        poly(f, pts, "#0b121b", 0.85); for (let y = 0; y < RH; y += 3 + r() * 5) px(f, pts[Math.floor(y / 10)][0], y, 1, 2, "#1a2633", 0.7); }
      const gap = y => 230 - y * 0.16;
      wall(n, -1, y => CX - gap(y) + Math.sin(y / 31) * 6, "#080b10", "#141a22", r); wall(n, 1, y => CX + gap(y) + Math.sin(y / 27 + 1) * 6, "#080b10", "#141a22", r);
      for (let k = 0; k < 16; k++) { const side = k % 2 ? 1 : -1, y = 20 + k * 46, x = CX + side * gap(y); px(n, side < 0 ? x - 30 : x, y, 30, 3, "#1a212a"); }
      // Darker the further down: a veil over the water itself.
      const g = f.createLinearGradient(0, 0, 0, RH); g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(0.35, "rgba(0,0,0,.28)"); g.addColorStop(1, "rgba(0,0,0,.55)"); f.fillStyle = g; f.fillRect(0, 0, WW, RH);
      // Now and then a faint light far down: something lives here.
      for (let k = 0; k < 6; k++) circ(L, CX + (r() - 0.5) * 220, 260 + r() * 480, 1.2, "#ffb3a6", 0.45);
    },
  };

  function create(berg, host) {
    const back = document.createElement("canvas"), front = document.createElement("canvas"), lume = document.createElement("canvas");
    back.className = "ib-life ib-scen"; front.className = "ib-life ib-scen"; lume.className = "ib-life ib-scen ib-life-lume";
    // The route behind the iceberg; mines in the open water in front of it (still under the dark of the deep); light on top.
    host.querySelector(".ib-sea").after(back); host.querySelector(".ib-life-front").after(front); host.querySelector(".ib-life-lume").after(lume);
    const gb = back.getContext("2d"), gf = front.getContext("2d"), gl = lume.getContext("2d");
    let mines = [], bursts = [], route = null, raf = 0, last = 0;
    const size = () => { const v = berg.view; for (const c of [back, front, lume]) { const w = Math.ceil(v.w / v.u) + 2, h = Math.ceil(v.h / v.u) + 2; if (c.width !== w || c.height !== h) { c.width = w; c.height = h; c.style.width = w * v.u + "px"; c.style.height = h * v.u + "px"; } } };

    function frame(now) {
      raf = 0; const t = now / 1000, dt = Math.min(0.05, last ? t - last : 0); last = t;
      const v = berg.view; size();
      const u = v.u, ox = mod(v.x0, u), oy = mod(v.y0, u), bx = (v.x0 - ox) / u + 1, by = (v.y0 - oy) / u + 1;
      for (const c of [back, front, lume]) c.style.transform = `translate(${ox - u}px, ${oy - u}px)`;
      gb.clearRect(0, 0, back.width, back.height); gf.clearRect(0, 0, front.width, front.height); gl.clearRect(0, 0, lume.width, lume.height);
      const X = x => Math.round(x + bx), Y = y => Math.round(y + by);
      // The route: the near layer slides in faster than the far one while you travel across.
      if (route) {
        const k = ease((now - route.t0) / route.dur), off = (1 - k) * route.dir * 230, a = Math.min(1, (now - route.t0) / 500);
        gb.globalAlpha = a; gb.drawImage(route.far, X(off * 0.45), Y(route.y0)); gb.globalAlpha = 1; gf.globalAlpha = a; gf.drawImage(route.near, X(off), Y(route.y0)); gf.globalAlpha = 1;
        gl.globalAlpha = a * (0.75 + 0.25 * Math.sin(t * 1.3)); gl.drawImage(route.lume, X(off), Y(route.y0)); gl.globalAlpha = 1;
        // While travelling: the water itself streams past.
        if (k < 1) for (const p of route.motes) { const x = mod(p.x + off * p.f * 1.8, WW), y = route.y0 - 120 + p.y; px(gb, X(x), Y(y), 1 + (p.f > 1), 1, "#bfe6ff", 0.25 * (1 - k)); }
        // A turning fan on the station, the wreck's mast creaking: small things that move.
        if (route.key === "station") { const cx = X(CX + 230 + off), cy = Y(route.y0 + 200), ang = t * 2.2; for (let b = 0; b < 3; b++) { const q = ang + b * 2.094; for (let s = 1; s < 6; s++) px(gb, cx + Math.cos(q) * s, cy + Math.sin(q) * s, 1, 1, "#7a8696"); }
          if (Math.sin(t * 3.1) > 0.6) { px(gl, X(CX + 215 + off), Y(route.y0 + 110), 2, 2, "#ff5a4a", 0.9); } }
      }
      // Mines: bobbing on their chains, a slow light blinking on each; or bursting.
      for (const m of mines) {
        if (m.gone) continue;
        const x = m.x + Math.sin(t * 0.5 + m.ph) * 0.8, y = m.y + Math.sin(t * 0.9 + m.ph) * 1.6, cx = X(x), cy = Y(y);
        for (let j = 7; j < 90; j += 2) px(gf, cx + Math.round(Math.sin(j / 30 + t * 0.4 + m.ph) * (j / 45)), cy + j, 1, 1, j % 4 ? "#3e4652" : "#2a3038", Math.max(0, 1 - j / 90));
        for (const [dx, dy] of [[0, -7], [0, 6], [-7, 0], [6, 0], [-5, -5], [4, -5], [-5, 4], [4, 4]]) px(gf, cx + dx, cy + dy, 1 + (dy === 0 && dx > 0), 1 + (dx === 0 && dy > 0), "#4a5262");
        circ(gf, cx + 0.5, cy + 0.5, 5.2, "#2b3140"); circ(gf, cx - 1, cy - 1, 2.4, "#4c5668"); px(gf, cx + 2, cy + 1, 2, 2, "#7a4126", 0.8); px(gf, cx - 3, cy + 2, 1, 1, "#7a4126", 0.8);
        const blink = Math.sin(t * 2 + m.ph) > 0.85; px(gf, cx, cy - 4, 1, 1, blink ? "#ffd1a0" : "#704a30"); if (blink) circ(gl, cx + 0.5, cy - 3.5, 3, "#ffb06a", 0.45);
      }
      // A burst: one soft flash, two rings going out, bubbles rising, a few bits sinking. Nothing more.
      bursts = bursts.filter(b => now - b.t0 < 2600);
      for (const b of bursts) {
        const s = (now - b.t0) / 1000, cx = X(b.x), cy = Y(b.y);
        if (s < 0.45) circ(gl, cx, cy, 8 + s * 18, "#ffb070", 0.5 * (1 - s / 0.45));
        for (const [d, k] of [[0, 1], [0.18, 0.6]]) { const q = s - d; if (q <= 0 || q > 1.3) continue; gl.globalAlpha = 0.55 * k * (1 - q / 1.3); gl.strokeStyle = "#ffe0c0"; gl.lineWidth = 1; gl.beginPath(); gl.arc(cx, cy, 4 + q * 22, 0, 6.283); gl.stroke(); gl.globalAlpha = 1; }
        for (const p of b.bub) { const yy = cy + p.vy * s, xx = cx + p.x + Math.sin(s * 3 + p.ph) * 2; if (s < p.life) px(gf, xx, yy, p.r, p.r, "#cfeaff", 0.7 * (1 - s / p.life)); }
        for (const p of b.bits) px(gf, cx + p.vx * Math.min(s, 1.2), cy + p.vy * s + 6 * s * s, 1, 1, "#3a404a", Math.max(0, 1 - s / 2.4));
        // The chain, cut loose, sinks away.
        for (let j = 7; j < 60; j += 2) px(gf, cx, cy + j + s * 14, 1, 1, "#3e4652", Math.max(0, 0.9 - s / 1.6) * (1 - j / 60));
      }
      if (route || mines.some(m => !m.gone) || bursts.length) raf = requestAnimationFrame(frame);
    }
    const kick = () => { if (!raf) { last = 0; raf = requestAnimationFrame(frame); } };
    berg.onRender(kick); berg.onResize(kick);

    return {
      // mines: [{ side }] in order common to rare. They sit just below where you are, top to bottom in that order,
      // the way the sonar strip lists them left to right.
      setMines(list, at) {
        const p = berg.view.player, r = rng(Math.round(at || 1) * 31 + 7);
        mines = (list || []).map((_, i) => ({ x: CX + (i % 2 ? 1 : -1) * (46 + r() * 30), y: p.y + 34 + i * 34, ph: r() * 6, gone: false }));
        kick();
      },
      explode(i, quiet) {
        const m = mines[i]; if (!m || m.gone) return; m.gone = true; if (quiet) return; const r = rng(i * 97 + 11);
        bursts.push({ x: m.x, y: m.y, t0: performance.now(), bub: Array.from({ length: 16 }, () => ({ x: (r() - 0.5) * 10, vy: -(12 + r() * 20), ph: r() * 6, r: r() < 0.3 ? 2 : 1, life: 1.2 + r() * 1.2 })),
          bits: Array.from({ length: 6 }, () => ({ vx: (r() - 0.5) * 24, vy: (r() - 0.6) * 10 })) });
        kick();
      },
      clearMines() { mines = []; },
      get mines() { return mines.map(m => ({ x: m.x, y: m.y, gone: m.gone })); },
      // Travel into a route: painted below where you are now (art y0), sliding in from the side you chose.
      setRoute(key, opts = {}) {
        if (!key || !ROUTES[key]) { route = null; return; }
        const r = rng((opts.seed || 1) * 7 + key.length), far = canvas(WW, RH), near = canvas(WW, RH), lm = canvas(WW, RH);
        ROUTES[key](far, near, lm, r);
        const y0 = opts.y0 != null ? opts.y0 : berg.view.player.y - 150;
        route = { key, far, near, lume: lm, y0, dir: opts.dir || 1, t0: opts.instant ? -1e9 : performance.now(), dur: opts.instant ? 1 : 2600,
          motes: Array.from({ length: 70 }, () => ({ x: r() * WW, y: r() * 360, f: 0.5 + r() })) };
        kick();
      },
      get route() { return route ? route.key : null; },
      destroy() { cancelAnimationFrame(raf); back.remove(); front.remove(); lume.remove(); },
    };
  }
  window.Scenery = { create, ROUTES: Object.keys(ROUTES) };
})();
