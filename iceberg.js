// Iceberg artwork, depth scale and the explorable iceberg players guess against.
// The artwork is one tall pixel-art world drawn once on a small canvas and shown at a whole-number scale, so pixels
// stay square and crisp. The camera pans vertically, and all text lives in a separate screen-space layer, so labels
// are never scaled or blurred.
(function () {
  "use strict";

  // ---------- World geometry (art pixels) ----------
  const WW = 400, WH = 780, CX = 200, W = 178, PEAK = 42, BOTTOM = 742;

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
  const SVG = {
    up: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 10 4-4 4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    down: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };

  // ---------- The explorable iceberg ----------
  // One iceberg per question. Each guess is added with add(): the camera travels from wherever it is to that answer's
  // real depth, a marker lands and a card shows what the game found. Nothing restarts from the surface between guesses.
  function create(host, opts = {}) {
    const speed = opts.speed || 1;
    host.classList.add("ib");
    host.innerHTML = `
      <div class="ib-world"><canvas width="${WW}" height="${WH}"></canvas></div>
      <canvas class="ib-snow"></canvas>
      <div class="ib-shade"></div>
      <div class="ib-glow"></div>
      <div class="ib-bestline" hidden></div>
      <div class="ib-layer"></div>
      <div class="ib-hud"><span class="ib-depth">0 m</span></div>
      <div class="ib-nav" hidden><button type="button" class="ib-prev" aria-label="Shallower guess">${SVG.up}</button><button type="button" class="ib-next" aria-label="Deeper guess">${SVG.down}</button></div>`;
    const $ = sel => host.querySelector(sel);
    const world = $(".ib-world"), canvas = $(".ib-world canvas"), layer = $(".ib-layer"), snow = $(".ib-snow"), sg = snow.getContext("2d");
    const shade = $(".ib-shade"), glow = $(".ib-glow"), depthEl = $(".ib-depth"), hud = $(".ib-hud"), nav = $(".ib-nav"), bestLine = $(".ib-bestline");
    paint(canvas);

    const TIP_VIEW = (PEAK + W) / 2 + 8;
    let compact = false, U = 2, Z = 2, camW = 0, camH = 0, camY = TIP_VIEW, aim = 0, focusIdx = -1, bestIdx = -1, items = [], raf = 0, snowRaf = 0, busy = false;
    let run = { cancelled: true };
    const handlers = { focus: () => {}, depth: () => {}, travel: () => {}, land: () => {} };
    let seed = 20261123; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647; // fixed seed: same drift every visit
    const flakes = Array.from({ length: 130 }, () => ({ x: rnd() * WW, y: W + rnd() * (WH - W), s: 0.3 + rnd() * 0.7, ph: rnd() * 6.28 }));
    const XSLOT = [18, -18, 0]; // markers sit left, right and centre of the ice so equal depths never stack

    function measure() {
      camW = host.clientWidth; camH = host.clientHeight;
      U = Math.max(2, Math.min(6, Math.floor(Math.min(camW * 0.78 / 190, camH * 0.86 / (W - PEAK + 30)))));
      U = Math.max(U, Math.ceil(camW / WW));
      canvas.style.width = WW * U + "px"; canvas.style.height = WH * U + "px";
      snow.width = Math.max(1, Math.ceil(camW / 3)); snow.height = Math.max(1, Math.ceil(camH / 3));
      compact = camH < 330; host.classList.toggle("ib-compact", compact); // little room (a phone keyboard is open): a shorter card
    }
    const wideZ = () => Math.min(U, Math.max(camW / WW, camH / (BOTTOM - PEAK + 50)));
    const viewHalf = (z = Z) => camH / (2 * z);
    const clampCam = (y, z = Z) => { const h = viewHalf(z); return h * 2 >= WH ? WH / 2 : Math.max(h - 4, Math.min(WH - h, y)); };
    const tx = () => Math.round(camW / 2 - CX * Z), ty = () => Math.round(camH / 2 - camY * Z);
    const depthNow = () => Math.min(1, Math.max(0, (camY - W - viewHalf(U) * 0.3) / (BOTTOM - W - viewHalf(U) * 0.9)));
    // Where a focused answer sits in the frame: a little above centre, or lower when the frame is short, so its
    // card always fits above it without touching the depth gauge.
    const focusFrac = () => Math.min(0.72, Math.max(0.43, ((compact ? 84 : 182) + 72) / Math.max(1, camH)));
    const focusY = it => it.y - (focusFrac() - 0.5) * camH / U;

    function render() {
      const X0 = tx(), Y0 = ty();
      world.style.transform = Z === U ? `translate3d(${X0}px, ${Y0}px, 0)` : `translate3d(${X0}px, ${Y0}px, 0) scale(${Z / U})`;
      const depth = depthNow();
      // The light narrows with depth: a wide soft vignette near the surface, a small pool around the answer in the abyss.
      const it = focusIdx >= 0 ? items[focusIdx] : null;
      const fx = it ? X0 + it.x * Z : camW / 2, fy = it ? Y0 + it.y * Z : camH / 2;
      const r = Math.round((1 - Math.pow(depth, 0.7)) * Math.max(camW, camH) * 0.75 + 110);
      shade.style.setProperty("--x", fx + "px"); shade.style.setProperty("--y", fy + "px"); shade.style.setProperty("--r", r + "px");
      shade.style.opacity = Math.min(1, depth * 1.25).toFixed(3);
      const gauge = metres(aim);
      depthEl.textContent = gauge + " m";
      hud.classList.toggle("on", gauge > 0 && Z === U);
      // Your deepest so far: a quiet line across the ice.
      const best = bestIdx >= 0 ? items[bestIdx] : null;
      if (best && best.depth > 0 && best.shown) { bestLine.hidden = false; bestLine.style.transform = `translateY(${Math.round(Y0 + best.y * Z)}px)`; } else bestLine.hidden = true;
      // Markers and small labels, placed in screen space so text is never scaled.
      const placed = [];
      for (const m of items) {
        const sx = X0 + m.x * Z, sy = Y0 + m.y * Z;
        m.mark.style.transform = `translate(${sx}px, ${sy}px)`;
        if (!m.pill) continue;
        const w = m.pill.offsetWidth, h = m.pill.offsetHeight;
        let px = Math.round(Math.max(8, Math.min(camW - w - 8, m.side < 0 ? sx - 16 - w : sx + 16))), py = Math.round(sy - h / 2);
        for (const q of placed) if (px < q.r + 4 && q.l - 4 < px + w && py < q.b + 3 && q.t - 3 < py + h) py = q.b + 4; // two answers at one depth: stack the labels
        m.pill.style.transform = `translate(${px}px, ${py}px)`;
        m.rect = { l: px, t: py, r: px + w, b: py + h };
        if (m.shown) placed.push(m.rect);
        m.under = py < 44 && px < 110 || py + h > camH - 8 || py < 4;
      }
      const card = layer.querySelector(".ib-card");
      let cr = null;
      if (it && card) {
        const sx = X0 + it.x * Z, sy = Y0 + it.y * Z, cw = card.offsetWidth, ch = card.offsetHeight;
        const left = Math.max(10, Math.min(camW - cw - 10, sx - cw / 2));
        const above = sy - 22 - ch >= (compact ? 6 : 46);
        const top = above ? sy - 22 - ch : Math.min(camH - ch - 8, sy + 22);
        card.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
        cr = { l: left, t: top, r: left + cw, b: top + ch };
        glow.style.transform = `translate(${sx}px, ${sy}px)`;
        glow.style.opacity = (0.3 + depth * 0.6).toFixed(3);
      } else glow.style.opacity = 0;
      // Nothing overlaps: hide any small label or other marker the card would cover.
      items.forEach((m, j) => {
        const mx = X0 + m.x * Z, my = Y0 + m.y * Z;
        const hitPill = cr && m.rect && m.rect.l < cr.r + 6 && cr.l - 6 < m.rect.r && m.rect.t < cr.b + 6 && cr.t - 6 < m.rect.b;
        if (m.pill) m.pill.classList.toggle("dim", !m.shown || j === focusIdx || m.under || !!hitPill);
        m.mark.classList.toggle("dim", !m.shown || (!!cr && j !== focusIdx && mx > cr.l - 10 && mx < cr.r + 10 && my > cr.t - 10 && my < cr.b + 10));
      });
      handlers.depth(depth);
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

    function cardFor(it) {
      const c = document.createElement("div"); c.className = "ib-card tier-" + it.tier.key + (it.best ? " deepest" : "");
      const top = document.createElement("div"); top.className = "ib-top";
      const eyebrow = document.createElement("div"); eyebrow.className = "ib-eyebrow"; eyebrow.textContent = it.tier.name;
      const n = document.createElement("div"); n.className = "ib-n"; n.textContent = "Guess " + it.n;
      top.append(eyebrow, n);
      const name = document.createElement("div"); name.className = "ib-name"; name.textContent = it.name;
      const dep = document.createElement("div"); dep.className = "ib-pts"; dep.textContent = it.depth > 0 ? it.depth + " m" : "0 m";
      const stat = document.createElement("div"); stat.className = "ib-stat"; stat.textContent = it.shareText + " of players";
      if (it.countText) { const sp = document.createElement("span"); sp.textContent = " · " + it.countText; stat.append(sp); }
      const rank = document.createElement("div"); rank.className = "ib-rank"; rank.textContent = it.rankText || "";
      c.append(top, name, dep, stat, rank);
      if (it.blurb && it.depth >= 100) { const b = document.createElement("div"); b.className = "ib-blurb"; b.textContent = it.blurb; c.append(b); }
      if (it.tag) { const tag = document.createElement("div"); tag.className = "ib-tag"; tag.textContent = it.tag; c.append(tag); }
      return c;
    }
    function showCard(i, silent) {
      layer.querySelectorAll(".ib-card").forEach(n => n.remove());
      focusIdx = i;
      items.forEach((m, j) => m.mark.classList.toggle("focus", j === i));
      glow.classList.toggle("rare", i >= 0 && items[i].depth >= 200);
      if (i < 0) { render(); return; }
      const card = cardFor(items[i]); layer.append(card); render();
      requestAnimationFrame(() => card.classList.add("in"));
      handlers.focus(i, !!silent);
    }
    function build(a) {
      // a: { n, name, share, shareText, countText, rankText, blurb }
      const i = items.length, depth = depthOf(a.share);
      const it = { ...a, depth, tier: tierOfDepth(depth), y: depthY(a.share), x: CX + XSLOT[i % 3], side: i % 2 === 0 ? 1 : -1, shown: false, best: false, tag: "" };
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
      items.forEach((m, j) => { if (m.shown && (bestIdx < 0 || m.share < items[bestIdx].share)) bestIdx = j; });
      items.forEach((m, j) => { m.best = j === bestIdx; m.mark.classList.toggle("best", m.best); m.pill.classList.toggle("best", m.best); });
      nav.hidden = items.filter(m => m.shown).length < 2;
    }

    // Start of a question: a clean iceberg, the whole tip in view, then a short push in.
    async function enter(animated = true) {
      stop(); const r = run = { cancelled: false };
      layer.innerHTML = ""; items = []; focusIdx = -1; bestIdx = -1; nav.hidden = true; busy = false;
      measure();
      if (!animated) { Z = U; camY = clampCam(TIP_VIEW); aim = 0; render(); return; }
      Z = wideZ(); camY = Math.min(viewHalf(Z), WH / 2); aim = 0; render();
      const z0 = Z, y0 = camY;
      await wait(250 / speed, r);
      await animate(1100 / speed, r, k => { const e = easeInOut(k); Z = z0 + (U - z0) * e; camY = Math.max(viewHalf(Z), y0 + (TIP_VIEW - y0) * e); render(); });
      if (!r.cancelled) { Z = U; camY = clampCam(TIP_VIEW); render(); }
    }
    // One guess: a beat of anticipation, the journey, the landing. Resolves when the answer is revealed.
    async function add(a, o = {}) {
      stop(); const r = run = { cancelled: false }; busy = true; Z = U;
      const it = build(a), i = items.length - 1;
      showCard(-1);
      await wait((o.special ? 420 : 280) / speed, r);
      const target = focusY(it), dist = Math.abs(clampCam(target) - camY);
      const ms = o.special ? Math.min(2300, Math.max(1500, 900 + dist * U * 1.3)) : Math.min(1500, Math.max(650, 450 + dist * U * 0.9));
      handlers.travel(it, clampCam(target) > camY ? 1 : -1, ms / speed);
      await moveTo(target, ms / speed, r, o.special ? easeInOutSlow : easeInOut, it.y);
      it.shown = true; const prevBest = bestIdx; markBest();
      it.tag = o.tag || "";
      camY = clampCam(target); aim = it.y; busy = false;
      showCard(i, true);
      handlers.land(i, it, { best: bestIdx === i, firstBest: prevBest < 0 });
      return it;
    }
    // After a reload: put every earlier guess back without replaying anything.
    function restore(list, o = {}) {
      stop(); run = { cancelled: true };
      layer.innerHTML = ""; items = []; focusIdx = -1; bestIdx = -1; busy = false;
      measure(); Z = U;
      list.forEach(a => { const it = build(a); it.shown = true; it.tag = a.tag || ""; });
      markBest();
      const at = o.focus != null ? o.focus : bestIdx;
      if (at >= 0) { camY = clampCam(focusY(items[at])); aim = items[at].y; showCard(at, true); } else { camY = clampCam(TIP_VIEW); aim = 0; render(); }
    }
    async function focus(i) {
      if (!items[i] || !items[i].shown || busy) return;
      stop(); const r = run = { cancelled: false };
      showCard(-1);
      const target = focusY(items[i]);
      await moveTo(target, Math.min(1100, Math.max(450, 350 + Math.abs(clampCam(target) - camY) * U * 0.7)) / speed, r, easeInOut, items[i].y);
      if (!r.cancelled) { aim = items[i].y; showCard(i); }
    }
    function setTag(i, text) { if (items[i]) { items[i].tag = text; if (focusIdx === i) showCard(i, true); } }
    // Step through guesses in depth order (for comparing them).
    function step(d) {
      const order = items.map((m, j) => j).filter(j => items[j].shown).sort((p, q) => items[q].share - items[p].share);
      if (order.length < 2) return;
      const at = Math.max(0, order.indexOf(focusIdx < 0 ? bestIdx : focusIdx));
      const next = order[Math.max(0, Math.min(order.length - 1, at + d))];
      if (next !== focusIdx) focus(next);
    }

    $(".ib-prev").onclick = () => step(-1);
    $(".ib-next").onclick = () => step(1);
    const ro = new ResizeObserver(() => {
      if (!host.clientWidth || !host.clientHeight) return;
      const keep = camY; measure(); if (run.cancelled || !busy) Z = U;
      camY = focusIdx >= 0 && !busy ? clampCam(focusY(items[focusIdx])) : clampCam(keep); render();
    });
    ro.observe(host);
    measure(); render(); snowRaf = requestAnimationFrame(drawSnow);
    return {
      enter, add, restore, focus, step, setTag,
      get busy() { return busy; }, get focused() { return focusIdx; }, get best() { return bestIdx; }, get count() { return items.length; },
      get depth() { return metres(aim); },
      onFocus: f => { handlers.focus = f; }, onDepth: f => { handlers.depth = f; }, onTravel: f => { handlers.travel = f; }, onLand: f => { handlers.land = f; },
      destroy: () => { stop(); cancelAnimationFrame(snowRaf); ro.disconnect(); },
    };
  }

  window.Iceberg = { create, paint, TIERS, tierFor, tierOfDepth, depthOf, depthY, yOfDepth, metres, SURFACE_SHARE, MAX_M, WORLD: { WW, WH, W, PEAK, CX, BOTTOM } };
})();
