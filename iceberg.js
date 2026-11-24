// Iceberg artwork, depth scale and the explorable iceberg players guess against.
// The artwork is one tall pixel-art world drawn once on a small canvas and shown at a whole-number scale, so pixels
// stay square and crisp. The camera pans vertically, and all text lives in a separate screen-space layer, so labels
// are never scaled or blurred.
(function () {
  "use strict";

  // ---------- World geometry (art pixels) ----------
  const WW = 960, WH = 780, CX = 480, W = 178, PEAK = 42, BOTTOM = 742;

  // ---------- Depth: the game's one scale ----------
  // An answer 1 in 10 players give sits at the surface. Every 10 times rarer is 100 m deeper:
  //   10% -> 0 m,  1% -> 100 m,  0.1% -> 200 m,  0.01% -> 300 m.
  // Depth in metres is also the score, so "how deep" and "how many points" are the same number.
  const SURFACE_SHARE = 0.10, MAX_M = 300, TOP_Y = W + 14, PXM = (BOTTOM - 64 - TOP_Y) / MAX_M;
  const TIERS = [
    { key: "tip", name: "The Tip", from: 0 },        // 1 in 10 players or more: above the water, 0 m
    { key: "shallows", name: "Shallows", from: 1 },  // to 50 m: 1 in 10 to about 1 in 30
    { key: "mid", name: "Midwater", from: 50 },      // 50 to 100 m: about 1 in 30 to 1 in 100
    { key: "deep", name: "The Deep", from: 100 },    // 100 to 200 m: 1 in 100 to 1 in 1,000
    { key: "abyss", name: "The Abyss", from: 200 },  // below 200 m: rarer than 1 in 1,000
  ];
  const depthOf = share => share >= SURFACE_SHARE ? 0 : Math.max(1, Math.round(100 * Math.log10(SURFACE_SHARE / share)));
  const tierOfDepth = m => m <= 0 ? TIERS[0] : m < 50 ? TIERS[1] : m < 100 ? TIERS[2] : m < 200 ? TIERS[3] : TIERS[4];
  const tierFor = share => tierOfDepth(depthOf(share));
  // Where an answer sits in the artwork. Above-water answers spread up the tip by how common they are.
  function depthY(share) {
    if (share >= SURFACE_SHARE) {
      const t = Math.min(1, (share - SURFACE_SHARE) / 0.3);
      return W - 16 - t * (W - 16 - (PEAK + 44));
    }
    return TOP_Y + Math.min(MAX_M, 100 * Math.log10(SURFACE_SHARE / share)) * PXM;
  }
  const yOfDepth = m => TOP_Y + Math.min(MAX_M, m) * PXM;
  const metres = y => Math.max(0, Math.round((y - TOP_Y) / PXM));

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
  // The world is painted in two layers so that wildlife can swim between them: the sea and sky, then the iceberg.
  function paintSea(g) {
    // Sky: stepped gradient, stars, the moon.
    const skyBands = 11;
    for (let i = 0; i < skyBands; i++) {
      const y0 = Math.round(i * W / skyBands), y1 = Math.round((i + 1) * W / skyBands);
      g.fillStyle = mix("#060c22", "#1c3566", i / (skyBands - 1)); g.fillRect(0, y0, WW, y1 - y0);
    }
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 140; i++) { const x = Math.floor(rnd() * WW), y = Math.floor(rnd() * (W - 28)); g.fillStyle = i % 4 === 0 ? "#ffffff" : "#8ea8d6"; g.fillRect(x, y, 1, 1); }
    const mx = CX + 76;
    disc(g, mx, 36, 15, "#1a2f60"); disc(g, mx, 36, 11, "#213a70"); disc(g, mx, 36, 8, "#f2edd2");
    g.fillStyle = "#ddd5ab"; g.fillRect(mx - 3, 33, 3, 2); g.fillRect(mx + 3, 38, 2, 2); g.fillRect(mx - 2, 40, 1, 1);

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
    [[CX - 166, 30, 15], [CX + 158, 40, 20], [CX + 192, 18, 8], [CX - 262, 22, 10], [CX + 286, 26, 12], [CX - 396, 34, 16], [CX + 410, 30, 13], [CX - 452, 14, 6]].forEach(([bx, bw, bh]) => {
      for (let y = 0; y < bh; y++) {
        const k = y / bh, half = bw / 2 * (0.12 + 0.88 * k), cx = bx - bw * 0.1 + bw * 0.1 * k;
        const l = Math.round(cx - half), r = Math.round(cx + half);
        g.fillStyle = "#24426b"; g.fillRect(l, W - bh + y, r - l, 1);
        g.fillStyle = "#4a73a0"; g.fillRect(Math.round(cx), W - bh + y, Math.max(1, Math.round(r - cx) - 1), 1);
        g.globalAlpha = 0.16 * (1 - k); g.fillStyle = "#4a73a0"; g.fillRect(l, W + bh - y, r - l, 1); g.globalAlpha = 1;
      }
    });
    // Surface glints and the moon's reflection.
    for (let i = 0; i < 26; i++) { const x = Math.floor(rnd() * WW); if (Math.abs(x - CX) < 76) continue; g.fillStyle = "#3d82b6"; g.fillRect(x, W + 2 + Math.floor(rnd() * 6), 6, 1); }
    for (let i = 0; i < 7; i++) { g.fillStyle = "#e9e3c4"; g.globalAlpha = 0.55 - i * 0.07; g.fillRect(CX + 86 + ((i * 5) % 9) - 4, W + 3 + i * 3, 10 - i, 1); }
    g.globalAlpha = 1;
    // Faint light shafts from the surface.
    [[CX - 360, 26], [CX - 210, 22], [CX - 90, 26], [CX - 30, 18], [CX + 60, 22], [CX + 190, 26], [CX + 340, 22]].forEach(([x, w]) => fillPoly(g, [[x, W], [x + w, W], [x + w - 40, W + 260], [x - 40, W + 260]], "#8fd0f5", 0.05));

    // Distant ocean liner, small and quiet.
    const sx0 = CX - 136;
    g.fillStyle = "#0e1220"; g.fillRect(sx0, W - 4, 26, 3); g.fillRect(sx0 + 2, W - 1, 22, 1);
    g.fillStyle = "#d9d3c3"; g.fillRect(sx0 + 3, W - 7, 19, 3);
    g.fillStyle = "#c79437"; [7, 12, 17].forEach(x => g.fillRect(sx0 + x, W - 11, 2, 4));
    g.fillStyle = "#ffe3a0"; for (let i = 0; i < 6; i++) g.fillRect(sx0 + 4 + i * 3, W - 3, 1, 1);
  }

  function paintIce(g) {
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
      g.fillStyle = i % 3 ? "#5fb4ff" : "#7df0df"; g.globalAlpha = 0.55; g.fillRect(x, y, 1, 1); g.globalAlpha = 0.18; g.fillRect(x - 1, y, 3, 1); g.fillRect(x, y - 1, 1, 3);
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
  // One canvas with everything (home picture, share card), or the two layers separately (the game scene).
  function paint(canvas) { const g = canvas.getContext("2d"); paintSea(g); paintIce(g); }
  function paintLayers(sea, ice) { paintSea(sea.getContext("2d")); ice.getContext("2d").clearRect(0, 0, WW, WH); paintIce(ice.getContext("2d")); }
  // The iceberg's outline at a given world row: [left, right], or null where there is no ice. Wildlife steers by it.
  const ICE_U = [[CX - 68, W], [CX - 86, W + 44], [CX - 94, W + 118], [CX - 84, W + 214], [CX - 64, W + 312], [CX - 42, W + 410], [CX - 18, W + 492],
    [CX + 2, BOTTOM], [CX + 24, W + 486], [CX + 48, W + 392], [CX + 68, W + 290], [CX + 84, W + 186], [CX + 92, W + 100], [CX + 82, W + 38], [CX + 70, W]];
  const ICE_A = [[CX - 66, W], [CX - 56, W - 24], [CX - 42, W - 50], [CX - 24, W - 96], [CX - 12, W - 78], [CX + 12, PEAK], [CX + 28, W - 96], [CX + 40, W - 64], [CX + 54, W - 34], [CX + 68, W]];
  // The same for any row, above the water or below it (annotations start just past the ice).
  function iceEdge(y) { if (y >= W) return iceSpan(y); const sp = spans(ICE_A, Math.round(y)); return sp.length ? [sp[0][0], sp[sp.length - 1][1]] : null; }
  function iceSpan(y) { if (y < W || y > BOTTOM) return null; const sp = spans(ICE_U, Math.round(y)); return sp.length ? [sp[0][0], sp[sp.length - 1][1]] : null; }

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
  const SVG = {
    up: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 10 4-4 4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    down: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };

  // ---------- The explorable iceberg ----------
  // One iceberg per question, filling the whole window. Each guess is added with add(): the camera travels from
  // wherever it is to that answer's real depth, a marker lands and an annotation is drawn out from it. Nothing
  // restarts from the surface between guesses. The page tells the scene which part of the window is free of
  // controls (setFrame), and the camera composes the iceberg inside that part.
  function create(host, opts = {}) {
    const speed = opts.speed || 1;
    host.classList.add("ib");
    host.innerHTML = `
      <div class="ib-world ib-sea"><canvas width="${WW}" height="${WH}"></canvas></div>
      <canvas class="ib-life ib-life-back"></canvas>
      <div class="ib-world ib-ice"><canvas width="${WW}" height="${WH}"></canvas></div>
      <canvas class="ib-life ib-life-front"></canvas>
      <canvas class="ib-snow"></canvas>
      <div class="ib-shade"></div>
      <canvas class="ib-life ib-life-lume"></canvas>
      <div class="ib-glow"></div>
      <div class="ib-bestline" hidden></div>
      <svg class="ib-lines" aria-hidden="true"><path class="ib-leader" pathLength="1" fill="none"/></svg>
      <div class="ib-layer"></div>
      <div class="ib-gauge" aria-hidden="true"><div class="ib-rail"><div class="ib-scale"></div></div><div class="ib-read"><span class="ib-depth">0 m</span></div></div>
      <div class="ib-nav" hidden><button type="button" class="ib-prev" aria-label="Shallower guess">${SVG.up}</button><button type="button" class="ib-next" aria-label="Deeper guess">${SVG.down}</button></div>`;
    const $ = sel => host.querySelector(sel);
    const seaW = $(".ib-sea"), iceW = $(".ib-ice"), seaC = $(".ib-sea canvas"), iceC = $(".ib-ice canvas"), layer = $(".ib-layer"), snow = $(".ib-snow"), sg = snow.getContext("2d");
    const shade = $(".ib-shade"), glow = $(".ib-glow"), depthEl = $(".ib-depth"), gauge = $(".ib-gauge"), scale = $(".ib-scale"), read = $(".ib-read"), nav = $(".ib-nav"), bestLine = $(".ib-bestline"), leader = $(".ib-leader");
    const life = { back: $(".ib-life-back"), front: $(".ib-life-front"), lume: $(".ib-life-lume") };
    paintLayers(seaC, iceC);

    const TIP_Y = (PEAK + W) / 2 + 8;
    let compact = false, stack = false, U = 2, Z = 2, camW = 0, camH = 0, camY = TIP_Y, aim = 0, axis = 0, focusIdx = -1, bestIdx = -1, items = [], raf = 0, snowRaf = 0, busy = false;
    let frame = { l: 0, r: 0, t: 0, b: 0 }, frameRun = null, gaugeW = 84, noteBox = null;
    let run = { cancelled: true };
    const handlers = { focus: () => {}, depth: () => {}, travel: () => {}, land: () => {}, render: () => {}, resize: () => {} };
    let seed = 20261123; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647; // fixed seed: same drift every visit
    const flakes = Array.from({ length: 300 }, () => ({ x: rnd() * WW, y: W + rnd() * (WH - W), s: 0.3 + rnd() * 0.7, ph: rnd() * 6.28 }));
    const XSLOT = [18, -18, 0]; // markers sit left, right and centre of the ice so equal depths never stack

    // Where the iceberg's centre line sits on screen: in the middle of the free area, nudged aside on wide windows
    // so an annotation has open water to sit in.
    const axisFor = f => { const w = camW - f.l - f.r; return f.l + w * Math.max(0.4, Math.min(0.5, 0.5 - (w - 520) / 1600)); };
    function measure() {
      camW = host.clientWidth; camH = host.clientHeight;
      const fw = camW - frame.l - frame.r, fh = camH - frame.t - frame.b;
      stack = fw < 620;                 // narrow: the annotation sits under its marker instead of beside the ice
      compact = fh < 330;               // very little room (a phone keyboard is open): a shorter annotation
      gaugeW = stack ? 40 : 84;
      U = Math.max(2, Math.min(4, Math.floor(Math.min(fw * 0.68 / 190, fh * 0.9 / (W - PEAK + 30)))));
      const ax = axisFor(frame);
      U = Math.min(6, Math.max(U, Math.ceil(Math.max(ax, camW - ax) / CX))); // the sea always reaches both edges
      if (!frameRun) axis = ax;
      for (const c of [seaC, iceC]) { c.style.width = WW * U + "px"; c.style.height = WH * U + "px"; }
      snow.width = Math.max(1, Math.ceil(camW / 3)); snow.height = Math.max(1, Math.ceil(camH / 3));
      // Wildlife is drawn at the artwork's own pixel size, one canvas pixel per art pixel.
      for (const c of Object.values(life)) { c.width = Math.ceil(camW / U) + 2; c.height = Math.ceil(camH / U) + 2; c.style.width = c.width * U + "px"; c.style.height = c.height * U + "px"; }
      host.classList.toggle("ib-compact", compact); host.classList.toggle("ib-stack", stack);
      // The depth scale: a tick every 10 m, a figure every 50 m, the zone names where they begin.
      scale.textContent = "";
      for (let m = 0; m <= MAX_M; m += 10) {
        const t = document.createElement("i"); t.style.top = Math.round(yOfDepth(m) * U) + "px";
        if (m % 50 === 0) { t.className = "major"; t.dataset.m = m; }
        scale.append(t);
      }
      TIERS.slice(1).forEach(z => { const s = document.createElement("span"); s.className = "tier-" + z.key; s.textContent = z.name; s.style.top = Math.round(yOfDepth(z.from < 2 ? 0 : z.from) * U) + "px"; scale.append(s); });
      handlers.resize();
    }
    const wideZ = () => Math.min(U, Math.max(Math.max(axis, camW - axis) / CX, (camH - frame.t - frame.b) / (BOTTOM - PEAK + 50)));
    const viewHalf = (z = Z) => camH / (2 * z);
    // The camera may run a little past the top and bottom of the artwork, by as much as the controls cover, so the
    // tip and the very deepest answers can still be framed in the free part of the window.
    const clampCam = (y, z = Z) => { const h = viewHalf(z), lo = h - frame.t / z, hi = WH - h + frame.b / z; return lo >= hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, y)); };
    const tx = () => Math.round(axis - CX * Z), ty = () => Math.round(camH / 2 - camY * Z);
    const depthNow = () => Math.min(1, Math.max(0, (camY - W - viewHalf(U) * 0.3) / (BOTTOM - W - viewHalf(U) * 0.9)));
    // Where a focused answer sits on screen: near the middle of the free area, or high in it when the annotation
    // has to go underneath.
    const focusLine = () => frame.t + (camH - frame.t - frame.b) * (stack ? (compact ? 0.22 : 0.3) : 0.46);
    const focusY = it => it.y - (focusLine() - camH / 2) / U;
    const tipY = () => TIP_Y - (frame.t + (camH - frame.t - frame.b) / 2 - camH / 2) / U;

    function render() {
      const X0 = tx(), Y0 = ty();
      seaW.style.transform = iceW.style.transform = Z === U ? `translate3d(${X0}px, ${Y0}px, 0)` : `translate3d(${X0}px, ${Y0}px, 0) scale(${Z / U})`;
      const depth = depthNow();
      // The light narrows with depth: a wide soft vignette near the surface, a small pool around the answer in the abyss.
      const it = focusIdx >= 0 ? items[focusIdx] : null;
      const fx = it ? X0 + it.x * Z : axis, fy = it ? Y0 + it.y * Z : focusLine();
      const r = Math.round((1 - Math.pow(depth, 0.7)) * Math.max(camW, camH) * 0.75 + 130);
      shade.style.setProperty("--x", fx + "px"); shade.style.setProperty("--y", fy + "px"); shade.style.setProperty("--r", r + "px");
      shade.style.opacity = Math.min(1, depth * 1.25).toFixed(3);
      // Depth gauge: the scale slides with the water, the reading rides at the depth the camera is aimed at.
      const settled = Z === U, m = it && !busy && aim === it.y ? it.depth : metres(aim); // on an answer, its exact depth (the artwork stops at 300 m)
      depthEl.textContent = m + " m";
      gauge.classList.toggle("on", settled); gauge.style.right = frame.r + "px";
      scale.style.transform = `translateY(${Y0}px)`;
      read.classList.toggle("on", m > 0 && settled);
      nav.style.left = frame.l + 14 + "px"; nav.style.bottom = frame.b + 14 + "px";
      read.style.transform = `translateY(${Math.round(Math.max(frame.t + 14, Math.min(camH - frame.b - 14, Y0 + aim * Z)))}px)`;
      // Your deepest so far: a quiet line across the water.
      const best = bestIdx >= 0 ? items[bestIdx] : null;
      if (best && best.depth > 0 && best.shown && settled) { bestLine.hidden = false; bestLine.style.transform = `translateY(${Math.round(Y0 + best.y * Z)}px)`; } else bestLine.hidden = true;
      // Markers and their small labels, placed in screen space so text is never scaled.
      const placed = [], right = camW - frame.r - gaugeW - 6;
      for (const k of items) {
        const sx = X0 + k.x * Z, sy = Y0 + k.y * Z;
        k.mark.style.transform = `translate(${sx}px, ${sy}px)`;
        if (!k.pill) continue;
        const w = k.pill.offsetWidth, h = k.pill.offsetHeight;
        let px = Math.round(Math.max(frame.l + 8, Math.min(right - w, k.side < 0 ? sx - 14 - w : sx + 14))), py = Math.round(sy - h / 2);
        for (const q of placed) if (px < q.r + 4 && q.l - 4 < px + w && py < q.b + 3 && q.t - 3 < py + h) py = q.b + 4; // two answers at one depth: stack the labels
        k.pill.style.transform = `translate(${px}px, ${py}px)`;
        k.rect = { l: px, t: py, r: px + w, b: py + h };
        if (k.shown) placed.push(k.rect);
        k.under = py < frame.t + 4 || py + h > camH - frame.b - 4;
      }
      // The annotation: drawn out from the marker into open water, joined to it by one thin line.
      const note = layer.querySelector(".ib-note");
      let nr = null;
      if (it && note) {
        const sx = X0 + it.x * Z, sy = Y0 + it.y * Z, nw = note.offsetWidth, nh = note.offsetHeight;
        const top0 = frame.t + 8, bot0 = camH - frame.b - 8;
        let left, top, path, flip = false;
        if (stack) {
          left = Math.round(Math.max(frame.l + 14, Math.min(right - nw, sx)));
          const below = sy + 28 + nh <= bot0 || sy - 28 - nh < top0;
          top = Math.round(below ? Math.min(bot0 - nh, sy + 28) : sy - 28 - nh);
          const jy = below ? top - 10 : top + nh + 10, ey = below ? top : top + nh;
          path = left === Math.round(sx) ? `M${sx} ${sy + (below ? 10 : -10)}V${ey}` : `M${sx} ${sy + (below ? 10 : -10)}V${jy}H${left}V${ey}`;
        } else {
          const edge = iceEdge(it.y), iceR = edge ? X0 + edge[1] * Z : sx, iceL = edge ? X0 + edge[0] * Z : sx;
          const roomR = right - (iceR + 24), roomL = iceL - 24 - (frame.l + 12);
          flip = roomR < Math.min(nw, 190) && roomL > roomR;
          left = Math.round(flip ? Math.max(frame.l + 12, Math.min(sx - 40 - nw, iceL - 24 - nw)) : Math.max(sx + 40, Math.min(iceR + 24, right - nw)));
          const anchor = note.firstElementChild ? note.firstElementChild.offsetTop + note.firstElementChild.offsetHeight / 2 : 16;
          top = Math.round(Math.max(top0, Math.min(bot0 - nh, sy - anchor)));
          const ex = flip ? left + nw : left, ly = Math.max(top, Math.min(top + nh, sy));
          path = `M${sx + (flip ? -10 : 10)} ${sy}H${ex}` + (ly !== sy ? `V${ly}` : "");
        }
        note.classList.toggle("flip", flip);
        note.style.transform = `translate(${left}px, ${top}px)`;
        leader.setAttribute("d", path);
        nr = { l: left, t: top, r: left + nw, b: top + nh };
        glow.style.transform = `translate(${sx}px, ${sy}px)`;
        glow.style.opacity = (0.3 + depth * 0.6).toFixed(3);
      } else { glow.style.opacity = 0; leader.setAttribute("d", ""); }
      noteBox = nr;
      // Nothing overlaps: hide any small label or other marker the annotation would cover.
      items.forEach((k, j) => {
        const mx = X0 + k.x * Z, my = Y0 + k.y * Z;
        const hitPill = nr && k.rect && k.rect.l < nr.r + 6 && nr.l - 6 < k.rect.r && k.rect.t < nr.b + 6 && nr.t - 6 < k.rect.b;
        if (k.pill) k.pill.classList.toggle("dim", !k.shown || j === focusIdx || k.under || !!hitPill || !settled);
        k.mark.classList.toggle("dim", !k.shown || (!!nr && j !== focusIdx && mx > nr.l - 10 && mx < nr.r + 10 && my > nr.t - 10 && my < nr.b + 10));
      });
      handlers.depth(depth);
      handlers.render();
    }

    // Marine snow in screen space at a coarse pixel size: it drifts on its own and slides past as the camera moves.
    function drawSnow(now) {
      snowRaf = requestAnimationFrame(drawSnow);
      if (!host.isConnected || host.offsetParent === null) return;
      sg.clearRect(0, 0, snow.width, snow.height);
      const X0 = tx(), Y0 = ty(), depth = depthNow(), t = now / 1000;
      for (const f of flakes) {
        const wy = W + ((f.y - W + t * 2.2 * f.s) % (WH - W)), sx = (X0 + (f.x + Math.sin(t * 0.3 + f.ph) * 2) * Z) / 3, sy = (Y0 + wy * Z) / 3;
        if (sx < 0 || sy < 0 || sx >= snow.width || sy >= snow.height) continue;
        sg.fillStyle = `rgba(190,225,255,${((0.18 + f.s * 0.35) * (1 - depth * 0.55)).toFixed(3)})`; sg.fillRect(Math.round(sx), Math.round(sy), 1, 1);
      }
    }

    const wait = (ms, r) => new Promise(resolve => { const t0 = performance.now(); const step = now => { if (r.cancelled || now - t0 >= ms) return resolve(); raf = requestAnimationFrame(step); }; raf = requestAnimationFrame(step); });
    function animate(ms, r, fn) {
      return new Promise(resolve => {
        if (ms <= 0) { fn(1); return resolve(); }
        const t0 = performance.now();
        const step = now => { if (r.cancelled) return resolve(); const k = Math.min(1, (now - t0) / ms); fn(k); if (k < 1) raf = requestAnimationFrame(step); else resolve(); };
        raf = requestAnimationFrame(step);
      });
    }
    function moveTo(target, ms, r, ease = easeInOut, aTo = target) {
      const from = camY, to = clampCam(target), aFrom = aim;
      if (Math.abs(to - from) < 0.5) { camY = to; aim = aTo; render(); return wait(Math.min(ms, 250), r); }
      return animate(ms, r, k => { const e = ease(k); camY = from + (to - from) * e; aim = aFrom + (aTo - aFrom) * e; render(); });
    }
    const stop = () => { run.cancelled = true; cancelAnimationFrame(raf); };

    // What the game found, in reading order: the answer, how many players gave it, how deep that puts it, how rare
    // that is, then the small print. No box around it: a hairline, the text, and the water behind.
    function noteFor(it) {
      const c = document.createElement("div"); c.className = "ib-note tier-" + it.tier.key + (it.best ? " deepest" : "");
      const add = (cls, ...parts) => { const d = document.createElement("div"); d.className = cls; d.append(...parts); c.append(d); return d; };
      const b = text => { const e = document.createElement("b"); e.textContent = text; return e; };
      add("ib-name", it.name);
      add("ib-share", b(it.shareText), " of players");
      const zone = document.createElement("span"); zone.className = "ib-zone"; zone.textContent = it.tier.name;
      if (it.depth > 0) add("ib-below", b(it.depth + " m"), " below the surface ", zone); else add("ib-below", b("0 m"), " · above the waterline ", zone);
      if (it.rankText) add("ib-rank", it.rankText);
      add("ib-meta", "Guess " + it.n + (it.countText ? " · " + it.countText + " players" : ""));
      if (it.blurb && it.depth >= 100) add("ib-blurb", it.blurb);
      if (it.tag) add("ib-tag", it.tag);
      if (it.sight) add("ib-sight", it.sight);
      return c;
    }
    // fresh: the answer has just landed, so the annotation is drawn out in stages. Otherwise it simply appears.
    function showNote(i, silent, fresh) {
      layer.querySelectorAll(".ib-note").forEach(n => n.remove());
      focusIdx = i;
      items.forEach((k, j) => k.mark.classList.toggle("focus", j === i));
      glow.classList.toggle("rare", i >= 0 && items[i].depth >= 200);
      host.classList.remove("ib-drawn");
      if (i < 0) { render(); return; }
      const note = noteFor(items[i]); if (!fresh) note.classList.add("quick"); layer.append(note); render();
      void note.offsetWidth; // start the staged reveal from its first frame
      note.classList.add("in"); host.classList.add("ib-drawn"); host.classList.toggle("ib-quick", !fresh);
      handlers.focus(i, !!silent);
    }
    function build(a) {
      // a: { n, name, share, shareText, countText, rankText, blurb }
      const i = items.length, depth = depthOf(a.share);
      const it = { ...a, depth, tier: tierOfDepth(depth), y: depthY(a.share), x: CX + XSLOT[i % 3], side: i % 2 === 0 ? 1 : -1, shown: false, best: false, tag: "", sight: "" };
      const m = document.createElement("button"); m.type = "button"; m.className = "ib-mark dim tier-" + it.tier.key; m.setAttribute("aria-label", `Guess ${it.n}: ${it.name}, ${depth} metres`);
      m.onclick = () => focus(i); layer.append(m); it.mark = m;
      const p = document.createElement("button"); p.type = "button"; p.className = "ib-pill dim tier-" + it.tier.key; p.title = it.name;
      const nm = document.createElement("span"); nm.textContent = it.name; const d = document.createElement("b"); d.textContent = depth + " m";
      p.append(nm, d); p.onclick = () => focus(i); layer.append(p); it.pill = p;
      items.push(it);
      return it;
    }
    function markBest() {
      // The deepest answer wins; equal depths keep the earlier guess.
      bestIdx = -1;
      items.forEach((k, j) => { if (k.shown && (bestIdx < 0 || k.share < items[bestIdx].share)) bestIdx = j; });
      items.forEach((k, j) => { k.best = j === bestIdx; k.mark.classList.toggle("best", k.best); k.pill.classList.toggle("best", k.best); });
      nav.hidden = items.filter(k => k.shown).length < 2;
    }

    // Start of a question: a clean iceberg, all of it in view, then a short push in to the tip.
    async function enter(animated = true) {
      stop(); const r = run = { cancelled: false };
      layer.innerHTML = ""; items = []; focusIdx = -1; bestIdx = -1; nav.hidden = true; busy = false; host.classList.remove("ib-drawn");
      measure();
      if (!animated) { Z = U; camY = clampCam(tipY()); aim = 0; render(); return; }
      Z = wideZ(); camY = clampCam(WH / 2); aim = 0; render();
      const z0 = Z, y0 = camY;
      await wait(250 / speed, r);
      await animate(1100 / speed, r, k => { const e = easeInOut(k); Z = z0 + (U - z0) * e; camY = clampCam(y0 + (tipY() - y0) * e); render(); });
      if (!r.cancelled) { Z = U; camY = clampCam(tipY()); render(); }
    }
    // One guess: a beat of anticipation, the journey, the landing. Resolves when the marker lands and the annotation
    // starts to draw; the box is ready for the next guess from that moment.
    async function add(a, o = {}) {
      stop(); const r = run = { cancelled: false }; busy = true; Z = U;
      const it = build(a), i = items.length - 1;
      showNote(-1);
      await wait((o.special ? 420 : 280) / speed, r);
      const target = focusY(it), dist = Math.abs(clampCam(target) - camY);
      const ms = o.special ? Math.min(2300, Math.max(1500, 900 + dist * U * 1.3)) : Math.min(1500, Math.max(650, 450 + dist * U * 0.9));
      handlers.travel(it, clampCam(target) > camY ? 1 : -1, ms / speed);
      await moveTo(target, ms / speed, r, o.special ? easeInOutSlow : easeInOut, it.y);
      it.shown = true; const prevBest = bestIdx; markBest();
      it.tag = o.tag || ""; it.sight = o.sight || "";
      camY = clampCam(target); aim = it.y; busy = false;
      it.mark.classList.add("landed");
      showNote(i, true, true);
      handlers.land(i, it, { best: bestIdx === i, firstBest: prevBest < 0 });
      return it;
    }
    // After a reload: put every earlier guess back without replaying anything.
    function restore(list, o = {}) {
      stop(); run = { cancelled: true };
      layer.innerHTML = ""; items = []; focusIdx = -1; bestIdx = -1; busy = false;
      measure(); Z = U;
      list.forEach(a => { const it = build(a); it.shown = true; it.tag = a.tag || ""; it.sight = a.sight || ""; });
      markBest();
      const at = o.focus != null ? o.focus : bestIdx;
      if (at >= 0) { camY = clampCam(focusY(items[at])); aim = items[at].y; showNote(at, true); } else { camY = clampCam(tipY()); aim = 0; render(); }
    }
    async function focus(i) {
      if (!items[i] || !items[i].shown || busy) return;
      stop(); const r = run = { cancelled: false };
      showNote(-1);
      const target = focusY(items[i]);
      await moveTo(target, Math.min(1100, Math.max(450, 350 + Math.abs(clampCam(target) - camY) * U * 0.7)) / speed, r, easeInOut, items[i].y);
      if (!r.cancelled) { aim = items[i].y; showNote(i); }
    }
    function setTag(i, text) { if (items[i] && items[i].tag !== text) { items[i].tag = text; if (focusIdx === i) refreshNote(); } }
    function setSight(i, text) { if (items[i] && items[i].sight !== text) { items[i].sight = text; if (focusIdx === i) refreshNote(text); } }
    // Swap the open annotation's small print without replaying its reveal (a late line fades in by itself).
    function refreshNote(late) {
      const old = layer.querySelector(".ib-note"); if (!old || focusIdx < 0) return;
      const note = noteFor(items[focusIdx]); note.classList.add("quick", "in"); old.replaceWith(note);
      if (late) { const s = note.querySelector(".ib-sight"); if (s) s.classList.add("late"); }
      render();
    }
    // Step through guesses in depth order (for comparing them).
    function step(d) {
      const order = items.map((k, j) => j).filter(j => items[j].shown).sort((p, q) => items[q].share - items[p].share);
      if (order.length < 2) return;
      const at = Math.max(0, order.indexOf(focusIdx < 0 ? bestIdx : focusIdx));
      const next = order[Math.max(0, Math.min(order.length - 1, at + d))];
      if (next !== focusIdx) focus(next);
    }
    // The part of the window not covered by controls, as insets in pixels. The camera recomposes to suit, gliding
    // there when asked (the results panel sliding in, for example).
    function setFrame(f, ms = 0) {
      const next = { l: f.l || 0, r: f.r || 0, t: f.t || 0, b: f.b || 0 };
      if (next.l === frame.l && next.r === frame.r && next.t === frame.t && next.b === frame.b) return;
      if (frameRun) frameRun.cancelled = true; frameRun = null;
      const from = { ...frame }, axis0 = axis, cam0 = camY, u0 = U;
      frame = next; measure();
      const settle = () => busy ? camY : focusIdx >= 0 ? clampCam(focusY(items[focusIdx])) : items.length ? clampCam(camY) : clampCam(tipY());
      const intro = !run.cancelled && Z !== U; // the opening push-in is still running: it reads the new frame by itself
      if (ms <= 0 || U !== u0 || busy || intro) { axis = axisFor(frame); if (!busy && !intro) { Z = U; camY = settle(); } render(); return; }
      const axis1 = axisFor(frame), cam1 = settle(), fr = frameRun = { cancelled: false };
      const mixF = k => ({ l: from.l + (next.l - from.l) * k, r: from.r + (next.r - from.r) * k, t: from.t + (next.t - from.t) * k, b: from.b + (next.b - from.b) * k });
      animate(ms / speed, fr, k => { const e = easeInOut(k); frame = mixF(e); axis = axis0 + (axis1 - axis0) * e; if (!busy) camY = cam0 + (cam1 - cam0) * e; render(); })
        .then(() => { if (fr.cancelled) return; frameRun = null; frame = next; axis = axis1; if (!busy) camY = settle(); render(); });
    }

    $(".ib-prev").onclick = () => step(-1);
    $(".ib-next").onclick = () => step(1);
    const ro = new ResizeObserver(() => {
      if (!host.clientWidth || !host.clientHeight) return;
      const keep = camY; measure(); if (run.cancelled || !busy) Z = U;
      camY = focusIdx >= 0 && !busy ? clampCam(focusY(items[focusIdx])) : items.length ? clampCam(keep) : clampCam(tipY()); render();
    });
    ro.observe(host);
    measure(); render(); snowRaf = requestAnimationFrame(drawSnow);
    return {
      enter, add, restore, focus, step, setTag, setSight, setFrame, life,
      get busy() { return busy; }, get focused() { return focusIdx; }, get best() { return bestIdx; }, get count() { return items.length; },
      get depth() { const it = focusIdx >= 0 ? items[focusIdx] : null; return it && !busy && aim === it.y ? it.depth : metres(aim); },
      // For anything that draws into the scene (wildlife): where the artwork is on screen right now.
      get view() { return { x0: tx(), y0: ty(), u: U, z: Z, w: camW, h: camH, camY, axis, frame, depth: depthNow(), settled: Z === U, busy, note: noteBox, focus: focusIdx >= 0 ? { x: items[focusIdx].x, y: items[focusIdx].y } : null }; },
      onFocus: f => { handlers.focus = f; }, onDepth: f => { handlers.depth = f; }, onTravel: f => { handlers.travel = f; }, onLand: f => { handlers.land = f; },
      onRender: f => { handlers.render = f; }, onResize: f => { handlers.resize = f; },
      destroy: () => { stop(); cancelAnimationFrame(snowRaf); ro.disconnect(); },
    };
  }

  window.Iceberg = { create, paint, TIERS, tierFor, tierOfDepth, depthOf, depthY, yOfDepth, metres, iceSpan, iceEdge, SURFACE_SHARE, MAX_M, WORLD: { WW, WH, W, PEAK, CX, BOTTOM, TOP_Y, PXM } };
})();
