// Iceberg renderer, camera and answer reveal.
// The artwork is one tall pixel-art world drawn once on a small canvas and shown at a whole-number scale, so pixels
// stay square and crisp. The camera only pans vertically (no zoom), and all text lives in a separate screen-space
// layer, so labels are never scaled or blurred.
(function () {
  "use strict";

  // ---------- World geometry (art pixels) ----------
  const WW = 400, WH = 780, CX = 200, W = 178, PEAK = 42, BOTTOM = 742;

  const TIERS = [
    { min: 0.30, key: "tip", name: "The Tip", pts: 1 },
    { min: 0.10, key: "shallows", name: "Shallows", pts: 2 },
    { min: 0.03, key: "mid", name: "Midwater", pts: 4 },
    { min: 0.005, key: "deep", name: "The Deep", pts: 7 },
    { min: 0, key: "abyss", name: "The Abyss", pts: 10 },
  ];
  const tierFor = share => TIERS.find(t => share >= t.min);

  // Rarer answers sit deeper. Common answers (30%+) sit on the tip; the rest go below the water on a log scale.
  function depthY(share) {
    if (share >= 0.3) {
      const t = (Math.min(share, 0.9) - 0.3) / 0.6;
      return W - 20 - t * (W - 20 - (PEAK + 46));
    }
    const t = Math.min(1, Math.max(0, (Math.log10(1 / share) - 0.52) / 2.5));
    return W + 24 + t * (BOTTOM - 70 - (W + 24));
  }
  const metres = y => Math.max(0, Math.round((y - W) * 0.5));

  // ---------- Crisp drawing helpers (no anti-aliasing) ----------
  function fillPoly(g, pts, color, alpha = 1) {
    g.fillStyle = color; g.globalAlpha = alpha;
    const ys = pts.map(p => p[1]), y0 = Math.ceil(Math.min(...ys)), y1 = Math.floor(Math.max(...ys));
    for (let y = y0; y <= y1; y++) {
      const yc = y + 0.5, xs = [];
      for (let i = 0; i < pts.length; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
        if ((ay <= yc && by > yc) || (by <= yc && ay > yc)) xs.push(ax + (yc - ay) / (by - ay) * (bx - ax));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.round(xs[k]), xb = Math.round(xs[k + 1]);
        if (xb > xa) g.fillRect(xa, y, xb - xa, 1);
      }
    }
    g.globalAlpha = 1;
  }
  function line(g, a, b, color, alpha = 1) {
    g.fillStyle = color; g.globalAlpha = alpha;
    let [x0, y0] = a.map(Math.round), [x1, y1] = b.map(Math.round);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) { g.fillRect(x0, y0, 1, 1); if (x0 === x1 && y0 === y1) break; const e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx; } if (e2 <= dx) { err += dx; y0 += sy; } }
    g.globalAlpha = 1;
  }
  function disc(g, cx, cy, r, color, alpha = 1) {
    g.fillStyle = color; g.globalAlpha = alpha;
    for (let y = -r; y <= r; y++) { const h = Math.floor(Math.sqrt(r * r - y * y)); g.fillRect(cx - h, cy + y, h * 2 + 1, 1); }
    g.globalAlpha = 1;
  }
  const mix = (a, b, t) => { const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); const A = p(a), B = p(b);
    return "#" + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, "0")).join(""); };

  // ---------- The artwork ----------
  function paint(canvas) {
    const g = canvas.getContext("2d");
    // Sky: stepped gradient, a faint horizon glow, a few stars, the moon.
    const skyBands = 11;
    for (let i = 0; i < skyBands; i++) {
      const y0 = Math.round(i * W / skyBands), y1 = Math.round((i + 1) * W / skyBands);
      g.fillStyle = mix("#060c22", "#1c3566", i / (skyBands - 1)); g.fillRect(0, y0, WW, y1 - y0);
    }
    const stars = [[14, 18], [37, 44], [61, 12], [88, 30], [104, 58], [150, 20], [171, 49], [222, 66], [12, 77], [46, 96], [196, 104], [229, 22], [78, 70], [133, 8], [212, 136], [28, 128]].map(([x, y]) => [x + 80, y])
      .concat([[10, 30], [34, 90], [58, 52], [366, 40], [388, 98], [344, 120], [376, 14], [22, 140]]);
    stars.forEach(([x, y], i) => { g.fillStyle = i % 4 === 0 ? "#ffffff" : "#8ea8d6"; g.fillRect(x, y, 1, 1); });
    disc(g, 276, 36, 15, "#1a2f60"); disc(g, 276, 36, 11, "#213a70"); disc(g, 276, 36, 8, "#f2edd2");
    g.fillStyle = "#ddd5ab"; g.fillRect(273, 33, 3, 2); g.fillRect(279, 38, 2, 2); g.fillRect(274, 40, 1, 1);

    // Sea: smooth stepped bands that fall to near-black.
    const seaTop = "#1f6597", seaMid = "#0d3a62", seaLow = "#03091a";
    for (let y = W; y < WH; y += 6) {
      const t = (y - W) / (WH - W);
      g.fillStyle = t < 0.35 ? mix(seaTop, seaMid, t / 0.35) : mix(seaMid, seaLow, Math.min(1, (t - 0.35) / 0.55));
      g.fillRect(0, y, WW, 6);
    }
    // Ordered dither where one band meets the next, so the gradient reads smooth without losing the pixel look.
    for (let y = W + 6; y < WH; y += 6) {
      const t = (y - W) / (WH - W);
      g.fillStyle = t < 0.35 ? mix(seaTop, seaMid, t / 0.35) : mix(seaMid, seaLow, Math.min(1, (t - 0.35) / 0.55));
      for (let x = (y / 6) % 2; x < WW; x += 2) g.fillRect(x, y - 1, 1, 1);
      for (let x = 0; x < WW; x += 4) g.fillRect(x + ((y / 6) % 2) * 2, y - 2, 1, 1);
    }
    // Distant icebergs on the horizon, lit from the moon's side, with faint reflections.
    [[34, 30, 15], [358, 40, 20], [392, 18, 8]].forEach(([bx, bw, bh]) => {
      for (let y = 0; y < bh; y++) {
        const k = y / bh, half = bw / 2 * (0.12 + 0.88 * k), cx = bx - bw * 0.1 + bw * 0.1 * k;
        const l = Math.round(cx - half), r = Math.round(cx + half);
        g.fillStyle = "#24426b"; g.fillRect(l, W - bh + y, r - l, 1);
        g.fillStyle = "#4a73a0"; g.fillRect(Math.round(cx), W - bh + y, Math.max(1, Math.round(r - cx) - 1), 1);
        g.globalAlpha = 0.16 * (1 - k); g.fillStyle = "#4a73a0"; g.fillRect(l, W + bh - y, r - l, 1); g.globalAlpha = 1;
      }
    });
    // Surface glints and the moon's reflection.
    [[8, 3], [30, 5], [58, 2], [96, 4], [300, 3], [330, 2], [366, 4], [44, 7], [388, 6]].forEach(([x, d]) => { g.fillStyle = "#3d82b6"; g.fillRect(x, W + d, 6, 1); });
    for (let i = 0; i < 7; i++) { g.fillStyle = "#e9e3c4"; g.globalAlpha = 0.55 - i * 0.07; g.fillRect(286 + ((i * 5) % 9) - 4, W + 3 + i * 3, 10 - i, 1); }
    g.globalAlpha = 1;
    // Faint light shafts from the surface.
    [[CX - 90, 26], [CX - 30, 18], [CX + 60, 22]].forEach(([x, w]) => fillPoly(g, [[x, W], [x + w, W], [x + w - 40, W + 260], [x - 40, W + 260]], "#8fd0f5", 0.05));

    // Distant ocean liner, small and quiet.
    const sx0 = 64;
    g.fillStyle = "#0e1220"; g.fillRect(sx0, W - 4, 26, 3); g.fillRect(sx0 + 2, W - 1, 22, 1);
    g.fillStyle = "#d9d3c3"; g.fillRect(sx0 + 3, W - 7, 19, 3);
    g.fillStyle = "#c79437"; [7, 12, 17].forEach(x => g.fillRect(sx0 + x, W - 11, 2, 4));
    g.fillStyle = "#ffe3a0"; for (let i = 0; i < 6; i++) g.fillRect(sx0 + 4 + i * 3, W - 3, 1, 1);

    // ---- Underwater mass ----
    const u = [[CX - 68, W], [CX - 86, W + 44], [CX - 94, W + 118], [CX - 84, W + 214], [CX - 64, W + 312], [CX - 42, W + 410], [CX - 18, W + 492],
      [CX + 2, BOTTOM], [CX + 24, W + 486], [CX + 48, W + 392], [CX + 68, W + 290], [CX + 84, W + 186], [CX + 92, W + 100], [CX + 82, W + 38], [CX + 70, W]];
    const c = [[CX - 30, W + 62], [CX + 28, W + 74], [CX - 10, W + 176], [CX + 42, W + 210], [CX - 32, W + 270], [CX + 10, W + 316], [CX - 6, W + 430]];
    const UR = ["#86c4ea", "#67acdc", "#5096c9", "#3f7fb4", "#31699c", "#255583"];
    const uf = [[[u[0], u[1], c[0]], 1], [[u[1], u[2], c[0]], 2], [[u[2], c[2], c[0]], 2], [[u[0], c[0], c[1]], 0], [[u[0], c[1], u[14]], 0],
      [[u[14], c[1], u[13]], 1], [[u[13], c[1], u[12]], 2], [[u[12], c[1], c[3]], 3], [[c[0], c[2], c[1]], 1], [[c[1], c[2], c[3]], 2],
      [[u[12], c[3], u[11]], 3], [[u[2], u[3], c[2]], 3], [[u[3], c[4], c[2]], 3], [[c[2], c[4], c[5]], 2], [[c[2], c[5], c[3]], 2],
      [[c[3], c[5], u[10]], 3], [[c[3], u[10], u[11]], 4], [[u[3], u[4], c[4]], 4], [[u[4], c[5], c[4]], 3], [[u[4], u[5], c[5]], 4],
      [[c[5], u[5], c[6]], 3], [[c[5], c[6], u[9]], 4], [[c[5], u[9], u[10]], 4], [[u[5], u[6], c[6]], 4], [[u[6], u[7], c[6]], 5],
      [[c[6], u[7], u[8]], 5], [[c[6], u[8], u[9]], 5]];
    fillPoly(g, u, UR[3]);
    uf.forEach(([pts, tone]) => fillPoly(g, pts, UR[tone]));
    // Soft facet seams.
    [[c[0], c[1]], [c[0], c[2]], [c[1], c[3]], [c[2], c[5]], [c[4], c[5]], [c[5], c[6]], [c[2], c[4]]].forEach(([a, b]) => line(g, a, b, "#9fd3f2", 0.18));
    // Bake depth into the ice: it darkens with the sea around it.
    for (let y = W; y < WH; y += 6) {
      const t = Math.min(1, Math.max(0, (y - W - 20) / (BOTTOM - W - 20)));
      fillPolyClipped(g, u, y, 6, "#020814", Math.pow(t, 1.15) * 0.82);
    }

    // Caustics: rippled moonlight on the ice just under the surface, fading with depth.
    g.fillStyle = "#c4e8ff";
    for (let y = W + 3; y < W + 110; y++) {
      const fade = Math.pow(1 - (y - W) / 110, 1.6);
      for (const [xa, xb] of spans(u, y)) for (let x = xa; x < xb; x++) {
        const v = Math.sin(x * 0.31 + y * 0.83) + Math.sin(x * 0.12 - y * 0.37 + 1.7) + Math.sin((x + y) * 0.07);
        if (v > 2.05) { g.globalAlpha = 0.32 * fade; g.fillRect(x, y, 1, 1); }
      }
    }
    g.globalAlpha = 1;
    // Rim light on the moon-facing side of the underwater mass.
    [[u[14], u[13]], [u[13], u[12]], [u[12], u[11]], [u[11], u[10]]].forEach(([p, q], i) => line(g, [p[0] - 1, p[1]], [q[0] - 1, q[1]], "#a9dcf7", 0.42 - i * 0.1));
    // Far down, a few faint living lights on the ice.
    [[CX - 22, W + 432], [CX + 14, W + 410], [CX - 4, W + 470], [CX + 26, W + 372], [CX - 34, W + 360], [CX + 2, W + 520], [CX - 12, W + 395]].forEach(([x, y], i) => {
      g.fillStyle = i % 3 ? "#5fb4ff" : "#b693ff"; g.globalAlpha = 0.55; g.fillRect(x, y, 1, 1); g.globalAlpha = 0.18; g.fillRect(x - 1, y, 3, 1); g.fillRect(x, y - 1, 1, 3);
    });
    g.globalAlpha = 1;

    // ---- Above water ----
    const a = [[CX - 66, W], [CX - 56, W - 24], [CX - 42, W - 50], [CX - 24, W - 96], [CX - 12, W - 78], [CX + 12, PEAK], [CX + 28, W - 96], [CX + 40, W - 64], [CX + 54, W - 34], [CX + 68, W]];
    const b = [[CX - 36, W - 18], [CX - 14, W - 46], [CX + 6, W - 72], [CX + 14, W - 30], [CX + 40, W - 20]];
    const bw1 = [CX - 20, W], bw2 = [CX + 20, W];
    const AR = ["#f7fcff", "#e2f2fd", "#c9e6f8", "#a9d4f1", "#8bbfe6", "#6ea9da"];
    fillPoly(g, a, AR[2]);
    [[[a[0], a[1], b[0]], 3], [[a[1], a[2], b[0]], 2], [[a[2], a[3], b[1]], 2], [[a[2], b[1], b[0]], 3], [[a[3], a[4], b[1]], 1],
      [[a[4], b[2], b[1]], 2], [[a[4], a[5], b[2]], 3], [[a[5], a[6], b[2]], 0], [[a[6], a[7], b[2]], 1], [[b[2], a[7], b[3]], 1],
      [[b[1], b[2], b[3]], 2], [[a[7], a[8], b[4]], 1], [[a[7], b[4], b[3]], 2], [[a[8], a[9], b[4]], 2], [[b[0], b[1], bw1], 3],
      [[b[1], b[3], bw1], 2], [[b[3], bw2, bw1], 3], [[b[3], b[4], bw2], 1], [[b[4], a[9], bw2], 2], [[a[0], b[0], bw1], 4]]
      .forEach(([pts, tone]) => fillPoly(g, pts, AR[tone]));
    // Crest highlights and crevices: thin, deliberate lines. The moon is up and to the right, so the right ridges catch it.
    [[a[5], a[6]], [a[3], a[4]], [a[6], a[7]], [a[7], a[8]]].forEach(([p, q], i) => line(g, p, q, "#ffffff", i === 3 ? 0.6 : 0.9));
    line(g, [a[8][0], a[8][1]], [a[9][0], a[9][1]], "#f2faff", 0.45);
    [[a[5], b[2]], [b[2], b[3]], [b[1], bw1], [a[4], b[2]]].forEach(([p, q]) => line(g, p, q, "#7fb3dc", 0.55));
    // Waterline: a bright seam where ice meets sea, then a little foam.
    line(g, [CX - 70, W], [CX + 72, W], "#d7eefb", 1);
    [-62, -48, -30, -8, 14, 34, 52, 64].forEach(dx => { g.fillStyle = "#eaf6ff"; g.fillRect(CX + dx, W + 1, 3, 1); });
  }

  // The filled x-ranges of a polygon on one pixel row.
  function spans(pts, y) {
    const yc = y + 0.5, xs = [];
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
      if ((ay <= yc && by > yc) || (by <= yc && ay > yc)) xs.push(ax + (yc - ay) / (by - ay) * (bx - ax));
    }
    xs.sort((p, q) => p - q);
    const out = []; for (let k = 0; k + 1 < xs.length; k += 2) out.push([Math.round(xs[k]), Math.round(xs[k + 1])]);
    return out;
  }
  // Fill one horizontal band of a polygon (used to darken the ice with depth).
  function fillPolyClipped(g, pts, y0, h, color, alpha) {
    if (alpha <= 0.005) return;
    g.fillStyle = color; g.globalAlpha = alpha;
    for (let y = y0; y < y0 + h; y++) {
      const yc = y + 0.5, xs = [];
      for (let i = 0; i < pts.length; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
        if ((ay <= yc && by > yc) || (by <= yc && ay > yc)) xs.push(ax + (yc - ay) / (by - ay) * (bx - ax));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) { const xa = Math.round(xs[k]), xb = Math.round(xs[k + 1]); if (xb > xa) g.fillRect(xa, y, xb - xa, 1); }
    }
    g.globalAlpha = 1;
  }

  // ---------- Motion ----------
  const easeInOut = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const easeInOutSlow = t => t < 0.5 ? 16 * t ** 5 : 1 - Math.pow(-2 * t + 2, 5) / 2; // longer glide, gentler landing
  const easeOut = t => 1 - Math.pow(1 - t, 3);
  const SVG = {
    pause: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3v10M11 3v10" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
    play: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.2v9.6L13 8z" fill="currentColor"/></svg>',
    skip: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3.5v9l6-4.5zM9 3.5v9l6-4.5z" fill="currentColor"/></svg>',
    replay: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8a4.5 4.5 0 1 0 1.4-3.3M3.5 2.5v2.6h2.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    up: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 10 4-4 4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    down: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };

  // ---------- Public component ----------
  function create(host, opts = {}) {
    const speed = opts.speed || 1;
    host.classList.add("ib");
    host.innerHTML = `
      <div class="ib-world"><canvas width="${WW}" height="${WH}"></canvas></div>
      <canvas class="ib-snow"></canvas>
      <div class="ib-shade"></div>
      <div class="ib-glow"></div>
      <div class="ib-layer"></div>
      <div class="ib-hud"><span class="ib-depth">0 m</span></div>
      <div class="ib-empty" hidden><b>Nothing sank this round</b>Answers you get right show up here.</div>
      <div class="ib-nav" hidden><button type="button" class="ib-prev" aria-label="Shallower answer">${SVG.up}</button><button type="button" class="ib-next" aria-label="Deeper answer">${SVG.down}</button></div>
      <div class="ib-controls">
        <button type="button" class="ib-pause" aria-label="Pause">${SVG.pause}<span>Pause</span></button>
        <button type="button" class="ib-skip">${SVG.skip}<span>Skip</span></button>
        <button type="button" class="ib-replay" hidden>${SVG.replay}<span>Replay</span></button>
      </div>`;
    const $ = sel => host.querySelector(sel);
    const world = $(".ib-world"), canvas = $(".ib-world canvas"), layer = $(".ib-layer"), snow = $(".ib-snow"), sg = snow.getContext("2d");
    const shade = $(".ib-shade"), glow = $(".ib-glow"), depthEl = $(".ib-depth"), hud = $(".ib-hud"), empty = $(".ib-empty"), nav = $(".ib-nav");
    const pauseBtn = $(".ib-pause"), skipBtn = $(".ib-skip"), replayBtn = $(".ib-replay");
    paint(canvas);

    let U = 2, Z = 2, camW = 0, camH = 0, camY = (PEAK + W) / 2 + 8, aim = 0, focusIdx = -1, items = [], raf = 0, snowRaf = 0;
    let run = { cancelled: true }, paused = false, done = false;
    const handlers = { done: () => {}, focus: () => {}, depth: () => {}, reveal: () => {}, start: () => {} };
    let seed = 20261123; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647; // fixed seed: same drift every visit
    const flakes = Array.from({ length: 130 }, () => ({ x: rnd() * WW, y: W + rnd() * (WH - W), s: 0.3 + rnd() * 0.7, ph: rnd() * 6.28 }));

    function measure() {
      camW = host.clientWidth; camH = host.clientHeight;
      U = Math.max(2, Math.min(6, Math.floor(Math.min(camW * 0.78 / 190, camH * 0.86 / (W - PEAK + 30)))));
      U = Math.max(U, Math.ceil(camW / WW));
      canvas.style.width = WW * U + "px"; canvas.style.height = WH * U + "px";
      snow.width = Math.ceil(camW / 3); snow.height = Math.ceil(camH / 3);
    }
    const wideZ = () => Math.min(U, Math.max(camW / WW, camH / (BOTTOM - PEAK + 50)));
    const viewHalf = (z = Z) => camH / (2 * z);
    const clampCam = (y, z = Z) => { const h = viewHalf(z); return h * 2 >= WH ? WH / 2 : Math.max(h - 4, Math.min(WH - h, y)); };
    const tx = () => Math.round(camW / 2 - CX * Z), ty = () => Math.round(camH / 2 - camY * Z);
    const depthOf = () => Math.min(1, Math.max(0, (camY - W - viewHalf(U) * 0.3) / (BOTTOM - W - viewHalf(U) * 0.9)));

    function render() {
      const X0 = tx(), Y0 = ty();
      world.style.transform = Z === U ? `translate3d(${X0}px, ${Y0}px, 0)` : `translate3d(${X0}px, ${Y0}px, 0) scale(${Z / U})`;
      const depth = depthOf();
      // The light narrows as you go down: a wide soft vignette near the surface, a small pool around the answer in the abyss.
      const it = focusIdx >= 0 ? items[focusIdx] : null;
      const fx = it ? X0 + it.x * Z : camW / 2, fy = it ? Y0 + it.y * Z : camH / 2;
      const r = Math.round((1 - Math.pow(depth, 0.7)) * Math.max(camW, camH) * 0.75 + 110);
      shade.style.setProperty("--x", fx + "px"); shade.style.setProperty("--y", fy + "px"); shade.style.setProperty("--r", r + "px");
      shade.style.opacity = Math.min(1, depth * 1.25).toFixed(3);
      const gauge = metres(aim);
      depthEl.textContent = gauge + " m";
      hud.classList.toggle("on", gauge > 2 && Z === U);
      for (const m of items) {
        const sx = X0 + m.x * Z, sy = Y0 + m.y * Z;
        m.mark.style.transform = `translate(${sx}px, ${sy}px)`;
        if (m.pill) {
          const w = m.pill.offsetWidth, left = m.side < 0 ? sx - 16 - w : sx + 16;
          const px = Math.round(Math.max(8, Math.min(camW - w - 8, left))), py = Math.round(sy - m.pill.offsetHeight / 2);
          m.pill.style.transform = `translate(${px}px, ${py}px)`;
          m.under = py < 46 && px < 120 || py + m.pill.offsetHeight > camH - 56; // tucked under the depth gauge or the buttons
          if (!it) m.pill.classList.toggle("dim", m.under);
        }
      }
      const card = layer.querySelector(".ib-card");
      if (it) {
        const sx = X0 + it.x * Z, sy = Y0 + it.y * Z;
        if (card) {
          const cw = card.offsetWidth, ch = card.offsetHeight;
          const left = Math.max(12, Math.min(camW - cw - 12, sx - cw / 2));
          const above = sy - 24 - ch > 52;
          card.style.transform = `translate(${Math.round(left)}px, ${Math.round(above ? sy - 24 - ch : sy + 24)}px)`;
          const cl = left, ct = above ? sy - 24 - ch : sy + 24, cr = cl + cw, cb = ct + ch;
          // Hide any small label the card would cover, so nothing ever overlaps.
          items.forEach((m, j) => {
            if (!m.pill) return;
            const pm = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(m.pill.style.transform);
            const pl = pm ? +pm[1] : 0, pt = pm ? +pm[2] : 0, pr = pl + m.pill.offsetWidth, pb = pt + m.pill.offsetHeight;
            m.pill.classList.toggle("dim", j === focusIdx || m.under || (pl < cr + 6 && cl - 6 < pr && pt < cb + 6 && ct - 6 < pb));
          });
          // Same for another answer's marker sitting behind the card.
          items.forEach((m, j) => { const mx = X0 + m.x * Z, my = Y0 + m.y * Z; m.mark.classList.toggle("dim", j !== focusIdx && mx > cl - 10 && mx < cr + 10 && my > ct - 10 && my < cb + 10); });
        }
        glow.style.transform = `translate(${sx}px, ${sy}px)`;
        glow.style.opacity = (0.3 + depth * 0.6).toFixed(3);
      } else { glow.style.opacity = 0; items.forEach(m => m.mark.classList.remove("dim")); }
      handlers.depth(depth);
    }

    // Marine snow drawn in screen space at a coarse pixel size: it drifts on its own and slides past as the camera moves.
    function drawSnow(now) {
      snowRaf = requestAnimationFrame(drawSnow);
      if (!host.isConnected || host.offsetParent === null) return;
      sg.clearRect(0, 0, snow.width, snow.height);
      const X0 = tx(), Y0 = ty(), depth = depthOf(), t = now / 1000;
      for (const f of flakes) {
        const wy = W + ((f.y - W + t * 2.2 * f.s) % (WH - W)), sx = (X0 + (f.x + Math.sin(t * 0.3 + f.ph) * 2) * Z) / 3, sy = (Y0 + wy * Z) / 3;
        if (sx < 0 || sy < 0 || sx >= snow.width || sy >= snow.height) continue;
        const a = (0.18 + f.s * 0.35) * (1 - depth * 0.55);
        sg.fillStyle = `rgba(190,225,255,${a.toFixed(3)})`; sg.fillRect(Math.round(sx), Math.round(sy), 1, 1);
      }
    }

    // Pausable timing: waits and moves only advance while the reveal isn't paused.
    function wait(ms, r) {
      return new Promise(resolve => {
        let left = ms, prev = performance.now();
        const step = now => { if (r.cancelled) return resolve(); if (!paused) left -= now - prev; prev = now; if (left <= 0) return resolve(); raf = requestAnimationFrame(step); };
        raf = requestAnimationFrame(step);
      });
    }
    function animate(ms, r, fn) {
      return new Promise(resolve => {
        if (ms <= 0) { fn(1); return resolve(); }
        let el = 0, prev = performance.now();
        const step = now => { if (r.cancelled) return resolve(); if (!paused) el += now - prev; prev = now; const k = Math.min(1, el / ms); fn(k); if (k < 1) raf = requestAnimationFrame(step); else resolve(); };
        raf = requestAnimationFrame(step);
      });
    }
    function moveTo(target, ms, r, ease = easeInOut) {
      const from = camY, to = clampCam(target), aFrom = aim, aTo = target - viewHalf() * 0.12;
      if (Math.abs(to - from) < 0.5) { camY = to; aim = aTo; render(); return Promise.resolve(); }
      return animate(ms, r, k => { const e = ease(k); camY = from + (to - from) * e; aim = aFrom + (aTo - aFrom) * e; render(); });
    }
    // Opening shot: the whole iceberg, then a smooth push in to the tip. Ends at exactly scale U, so pixels land crisp.
    function intro(r) {
      Z = wideZ(); camY = Math.min(viewHalf(Z), WH / 2); aim = 0; render(); // widest view that fills the frame, sky at the top
      const z0 = Z, y0 = camY, y1 = (PEAK + W) / 2 + 8;
      return wait(450 / speed, r).then(() => animate(1500 / speed, r, k => {
        const e = easeInOut(k); Z = z0 + (U - z0) * e; camY = Math.max(viewHalf(Z), y0 + (y1 - y0) * e); render();
      })).then(() => { Z = U; camY = clampCam(y1); render(); });
    }
    let pace = { hold: 1500, travel: 1 };
    const travelTime = (from, to, slow) => Math.round(Math.min(slow ? 3200 : 2300, Math.max(800, 600 + Math.abs(to - from) * U * (slow ? 1.4 : 1.0))) * (slow ? 1 : pace.travel) / speed);
    const focusY = it => it.y + viewHalf() * 0.12; // keep the answer a little above centre, room for its card

    function cardFor(it, i) {
      const c = document.createElement("div"); c.className = "ib-card tier-" + it.tier.key + (it.deepest ? " deepest" : "");
      const top = document.createElement("div"); top.className = "ib-top";
      const eyebrow = document.createElement("div"); eyebrow.className = "ib-eyebrow"; eyebrow.textContent = it.tier.name + " · " + metres(it.y) + " m";
      const n = document.createElement("div"); n.className = "ib-n"; n.textContent = `${i + 1} / ${items.length}`;
      top.append(eyebrow, n);
      const name = document.createElement("div"); name.className = "ib-name"; name.textContent = it.name;
      const stat = document.createElement("div"); stat.className = "ib-stat"; stat.textContent = it.shareText + " of players";
      if (it.countText) { const sp = document.createElement("span"); sp.textContent = " · " + it.countText; stat.append(sp); }
      const rank = document.createElement("div"); rank.className = "ib-rank"; rank.textContent = it.rankText;
      const pts = document.createElement("div"); pts.className = "ib-pts"; pts.textContent = "+" + it.tier.pts;
      c.append(top, name, stat, rank, pts);
      if (it.blurb && it.tier.pts >= 7) { const b = document.createElement("div"); b.className = "ib-blurb"; b.textContent = it.blurb; c.append(b); }
      if (it.deepest) { const tag = document.createElement("div"); tag.className = "ib-tag"; tag.textContent = "Your deepest answer"; c.append(tag); }
      return c;
    }
    function showCard(i, silent) {
      layer.querySelectorAll(".ib-card").forEach(n => n.remove());
      focusIdx = i;
      items.forEach((m, j) => { m.mark.classList.toggle("focus", j === i); if (m.pill) m.pill.classList.toggle("dim", j === i); });
      glow.classList.toggle("rare", i >= 0 && items[i].deepest && items[i].tier.pts >= 7);
      if (i < 0) { render(); return; }
      const card = cardFor(items[i], i); layer.append(card); render();
      requestAnimationFrame(() => card.classList.add("in"));
      handlers.focus(i, !!silent);
    }
    function addPill(it, i) {
      if (it.pill) return;
      const p = document.createElement("div"); p.className = "ib-pill tier-" + it.tier.key; p.title = it.name;
      const n = document.createElement("span"); n.textContent = it.name; const s = document.createElement("b"); s.textContent = it.shareText;
      p.append(n, s); p.onclick = () => focus(i); layer.append(p); it.pill = p;
    }

    function setAnswers(list) {
      // list: [{ name, share, shareText, countText, rankText, blurb }]
      stop(); layer.innerHTML = ""; focusIdx = -1; done = false;
      measure(); Z = U;
      const sorted = [...list].sort((p, q) => q.share - p.share);
      items = sorted.map((a, i) => ({ ...a, tier: tierFor(a.share), y: depthY(a.share), side: i % 2 === 0 ? 1 : -1 }));
      // Keep markers apart so labels never overlap (same-side labels need more room than alternating ones).
      const gapAll = Math.ceil(16 / U), gapSide = Math.ceil(36 / U);
      for (let i = 1; i < items.length; i++) {
        const prev = items[i - 1]; let y = Math.max(items[i].y, prev.y + gapAll);
        for (let j = i - 1; j >= 0; j--) if (items[j].side === items[i].side) { y = Math.max(y, items[j].y + gapSide); break; }
        items[i].y = Math.min(y, BOTTOM - 26);
      }
      items.forEach(it => { it.x = CX + it.side * 18; });
      if (items.length) items[items.length - 1].deepest = items.length > 1 || items[0].tier.key !== "tip";
      items.forEach((it, i) => { const m = document.createElement("div"); m.className = "ib-mark tier-" + it.tier.key; m.hidden = true; m.title = it.name; m.onclick = () => focus(i); layer.append(m); it.mark = m; });
      // Pacing: a few answers get a generous moment each; a long list moves briskly so the whole dive stays short.
      const n = items.length;
      pace = { hold: n <= 5 ? 1500 : Math.max(750, 1500 - (n - 5) * 65), travel: n <= 6 ? 1 : Math.max(0.55, 1 - (n - 6) * 0.04) };
      empty.hidden = true; nav.hidden = true;
      camY = clampCam((PEAK + W) / 2 + 8); aim = 0; render();
    }

    async function play() {
      stop(); const r = run = { cancelled: false }; done = false; setPaused(false);
      skipBtn.hidden = false; pauseBtn.hidden = false; replayBtn.hidden = true; nav.hidden = true; empty.hidden = true;
      items.forEach(it => { it.mark.hidden = true; if (it.pill) { it.pill.remove(); it.pill = null; } });
      showCard(-1);
      handlers.start();
      await intro(r);
      if (!items.length && !r.cancelled) { empty.hidden = false; await wait(1600 / speed, r); }
      for (let i = 0; i < items.length && !r.cancelled; i++) {
        const it = items[i], last = i === items.length - 1, special = last && it.deepest && it.tier.pts >= 7;
        if (special) await wait(300 / speed, r); // a breath before the final descent
        await moveTo(focusY(it), travelTime(camY, focusY(it), special), r, special ? easeInOutSlow : easeInOut);
        if (r.cancelled) break;
        if (special) { handlers.reveal(i, it, true); await wait(1100 / speed, r); if (r.cancelled) break; } // the swell rises before the light comes on
        else handlers.reveal(i, it, false);
        it.mark.hidden = false; showCard(i);
        await wait((special ? 2600 : pace.hold) / speed, r);
        if (r.cancelled) break;
        if (!last) { addPill(it, i); showCard(-1); }
      }
      if (!r.cancelled) finish();
    }
    function finish() {
      stop(); done = true; setPaused(false);
      Z = U; empty.hidden = !!items.length;
      items.forEach((it, i) => { it.mark.hidden = false; addPill(it, i); });
      const last = items.length - 1;
      if (last >= 0) { camY = clampCam(focusY(items[last])); aim = items[last].y; showCard(last, true); }
      else { camY = clampCam((PEAK + W) / 2 + 8); aim = 0; }
      skipBtn.hidden = true; pauseBtn.hidden = true; replayBtn.hidden = false; nav.hidden = items.length < 2; render();
      handlers.done();
    }
    function stop() { run.cancelled = true; cancelAnimationFrame(raf); }
    function setPaused(p) {
      paused = p;
      pauseBtn.innerHTML = p ? `${SVG.play}<span>Resume</span>` : `${SVG.pause}<span>Pause</span>`;
      pauseBtn.setAttribute("aria-label", p ? "Resume" : "Pause");
    }
    function skip() { if (!done) finish(); }
    async function focus(i) {
      if (!items[i]) return;
      if (!done) finish();
      stop(); const r = run = { cancelled: false };
      showCard(-1);
      await moveTo(focusY(items[i]), travelTime(camY, focusY(items[i]), false) * 0.7, r);
      if (!r.cancelled) showCard(i);
    }
    const step = d => { if (!done) return; const i = Math.max(0, Math.min(items.length - 1, (focusIdx < 0 ? items.length - 1 : focusIdx) + d)); if (i !== focusIdx) focus(i); };

    skipBtn.onclick = skip;
    pauseBtn.onclick = () => setPaused(!paused);
    replayBtn.onclick = () => play();
    $(".ib-prev").onclick = () => step(-1);
    $(".ib-next").onclick = () => step(1);
    const ro = new ResizeObserver(() => { const keep = camY; measure(); if (done || run.cancelled) Z = U; camY = clampCam(keep); render(); });
    ro.observe(host);
    measure(); render(); snowRaf = requestAnimationFrame(drawSnow);
    return {
      setAnswers, play, skip, focus, step,
      pause: () => !done && setPaused(true), resume: () => setPaused(false), toggle: () => !done && setPaused(!paused),
      get done() { return done; }, get paused() { return paused; }, get focused() { return focusIdx; },
      onDone: f => { handlers.done = f; }, onFocus: f => { handlers.focus = f; }, onDepth: f => { handlers.depth = f; },
      onReveal: f => { handlers.reveal = f; }, onStart: f => { handlers.start = f; },
      destroy: () => { stop(); cancelAnimationFrame(snowRaf); ro.disconnect(); },
    };
  }

  window.Iceberg = { create, TIERS, tierFor, depthY, metres, paint, WORLD: { WW, WH, W, PEAK, CX } };
})();
