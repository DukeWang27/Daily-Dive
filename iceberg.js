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
  // Below the iceberg. The iceberg holds every answer down to 1 in 10,000 players (300 m). An answer rarer than
  // that, with the evidence to back it, leaves the ice altogether: it sits in open water beneath the iceberg's tip,
  // in a region of its own, Challenger Deep. The scene's world runs on past the artwork to make room (SH).
  const BEYOND_M = MAX_M, BEYOND_Y = BOTTOM + 150, PXD = 3, SH = 1400;
  // Evidence. Every rarity table is built from a sample of players (today: 120,000 simulated three-guess players per
  // question; later, real counts). An answer only counts as rarer than 1 in 10,000 when at least 3 of that sample
  // gave it. Below that, nobody can tell "very rare" from "noise", so the answer stays at the bottom of the iceberg
  // (299 m) and never reaches Challenger Deep. Unknown answers, answers waiting for review and answers approved by review
  // have no place in a table, so they can never get there either.
  const EVIDENCE = { players: 120000, min: 3 };
  const evidenced = share => Math.round(share * EVIDENCE.players) >= EVIDENCE.min;
  const TIERS = [
    // Rarity tiers: how rare one answer is. Named as rarity, so they are never confused with the ocean's regions
    // (REGIONS, below), which are about where the whole dive has got to. Keys are unchanged (colours, saved results).
    { key: "tip", name: "Common", from: 0 },          // 1 in 10 players or more: +0 m
    { key: "shallows", name: "Uncommon", from: 1 },   // to 50 m: 1 in 10 to about 1 in 30
    { key: "mid", name: "Rare", from: 50 },           // 50 to 100 m: about 1 in 30 to 1 in 100
    { key: "deep", name: "Very rare", from: 100 },    // 100 to 200 m: 1 in 100 to 1 in 1,000
    { key: "abyss", name: "Exceptional", from: 200 }, // 200 to 299 m: 1 in 1,000 to 1 in 10,000
    { key: "beyond", name: "Unfathomable", from: 300 }, // rarer than 1 in 10,000, with evidence: the red annotations
  ];
  const depthOf = share => {
    if (share >= SURFACE_SHARE) return 0;
    const d = Math.max(1, Math.round(100 * Math.log10(SURFACE_SHARE / share)));
    return d >= BEYOND_M && !evidenced(share) ? BEYOND_M - 1 : d;
  };
  const isBeyond = m => m >= BEYOND_M;
  const tierOfDepth = m => m <= 0 ? TIERS[0] : m < 50 ? TIERS[1] : m < 100 ? TIERS[2] : m < 200 ? TIERS[3] : m < BEYOND_M ? TIERS[4] : TIERS[5];
  const tierFor = share => tierOfDepth(depthOf(share));
  // Where a depth sits in the world: on the iceberg's scale down to 299 m, then, past a break, in the open water
  // beneath its tip at a scale of its own.
  const yOfDepth = m => m < BEYOND_M ? TOP_Y + Math.max(0, m) * PXM : Math.min(SH - 50, BEYOND_Y + (m - BEYOND_M) * PXD);
  const Y_ICE_END = yOfDepth(BEYOND_M - 0.5);
  // Where an answer sits in the artwork. Above-water answers spread up the tip by how common they are.
  function depthY(share) {
    if (share >= SURFACE_SHARE) {
      const t = Math.min(1, (share - SURFACE_SHARE) / 0.3);
      return W - 16 - t * (W - 16 - (PEAK + 44));
    }
    const m = 100 * Math.log10(SURFACE_SHARE / share);
    return isBeyond(depthOf(share)) ? yOfDepth(Math.max(BEYOND_M, m)) : TOP_Y + Math.min(BEYOND_M - 0.6, m) * PXM;
  }
  const metres = y => Math.max(0, Math.round(y <= Y_ICE_END ? (y - TOP_Y) / PXM : y >= BEYOND_Y ? BEYOND_M + (y - BEYOND_Y) / PXD : BEYOND_M - 0.5 + (y - Y_ICE_END) / (BEYOND_Y - Y_ICE_END) * 0.5));

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


  // ---------- The expedition: one column of ocean, from the surface down ----------
  // A day's dive is one continuous descent. Where you are is your running total: each question's best answer adds its
  // depth to it, and nothing ever takes you back up. The iceberg is only the start. Below it the water goes on, region
  // by region, on the iceberg's own scale (PXM art pixels to the metre), so 100 m looks the same everywhere.
  // Regions follow the running total (where you are), never the rarity of one answer (how rare that answer is).
  // A typical day ends somewhere in the Midnight Zone; The Unknown needs answers rarer than 1 in 10,000 along the way.
  const XM = 2000, XH = Math.ceil(TOP_Y + XM * PXM + 160);
  const yX = m => TOP_Y + Math.max(0, m) * PXM, mX = y => Math.max(0, (y - TOP_Y) / PXM);
  const REGIONS = [
    { key: "surface", name: "Surface Waters", from: 0, dark: 0 },
    { key: "twilight", name: "Twilight Zone", from: 300, dark: 0.55 },
    { key: "midnight", name: "Midnight Zone", from: 600, dark: 0.85 },
    { key: "abyss", name: "The Abyss", from: 1000, dark: 0.95 },
    { key: "trench", name: "The Trenches", from: 1300, dark: 0.97 },
    { key: "unknown", name: "The Unknown", from: 1500, dark: 0.93 },
  ];
  const regionOf = m => REGIONS.reduce((r, x) => (m >= x.from ? x : r), REGIONS[0]);
  // The sea's own colour at a depth: blue fading to indigo, to black, then in The Unknown a faint violet-red that
  // shouldn't be there.
  const SEA_STOPS = [[0, "#1f6597"], [120, "#0d3a62"], [340, "#0a2446"], [600, "#08183c"], [1000, "#050d28"], [1300, "#05091c"], [1500, "#09061c"], [1700, "#160a24"], [XM, "#10061c"]];
  function seaAt(m) {
    for (let i = 1; i < SEA_STOPS.length; i++) if (m <= SEA_STOPS[i][0]) { const [a, ca] = SEA_STOPS[i - 1], [b, cb] = SEA_STOPS[i]; return mix(ca, cb, Math.max(0, (m - a) / (b - a))); }
    return SEA_STOPS[SEA_STOPS.length - 1][1];
  }
  // The rock of the deep: where the floor and the trench walls are, at a world row (art pixels). Each side is a list of
  // [y, x] points; the open water between them is the column the dive goes down.
  const FLOOR_M = 1235, TRENCH_M = 1500;
  const ROCK = (() => {
    let s = 913; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const side = sgn => {
      const pts = [], y0 = yX(FLOOR_M - 70), yF = yX(FLOOR_M), yT = yX(TRENCH_M), yU = yX(1640);
      // The abyssal plain comes in from the edge of the world, low and uneven, to the trench's rim.
      for (let k = 0; k <= 8; k++) { const x = CX + sgn * (CX - k * (CX - 180) / 8); pts.push([x, yF - (k === 8 ? 6 : 0) + Math.round(Math.sin(k * 1.7 + sgn) * 3 + (r() - 0.5) * 4)]); }
      // The trench wall: down and in, in ledges.
      for (let y = yF + 8; y < yT; y += 14 + Math.round(r() * 10)) { const k = (y - yF) / (yT - yF); pts.push([CX + sgn * (176 - k * 66 + (r() - 0.5) * 16), y]); }
      // Then the wall falls away and the cavern of The Unknown opens out.
      pts.push([CX + sgn * 112, yT], [CX + sgn * 150, yT + 30], [CX + sgn * 230, yT + 60], [CX + sgn * 300, yU - 40], [CX + sgn * 360, yU], [CX + sgn * 420, yU + 90], [CX + sgn * CX, yU + 120]);
      return { pts, y0 };
    };
    return { L: side(-1), R: side(1) };
  })();
  // Where the rock is on one row: the open water's edges [left, right], or null above the floor.
  function rockAt(y) {
    const edge = pts => { for (let i = 1; i < pts.length; i++) { const [ax, ay] = pts[i - 1], [bx, by] = pts[i]; if ((y >= ay && y <= by) || (y >= by && y <= ay)) return ax + (bx - ax) * (by === ay ? 0 : (y - ay) / (by - ay)); } return null; };
    const l = edge(ROCK.L.pts), r = edge(ROCK.R.pts);
    return l == null && r == null ? null : [l == null ? 0 : l, r == null ? WW : r];
  }
  // Lights fixed in the world (a research station's portholes, a vent's glow, glyphs on the ruins). The scene draws
  // them on its light layer so they show through the dark. x, y in art pixels; r: glow radius; blink: seconds per cycle.
  const LAMPS = [];

  // ---------- The artwork ----------
  // The world is painted in two layers so that wildlife can swim between them: the sea and sky, then the iceberg.
  function paintSea(g, H = WH) {
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
    if (H > SH) paintExpedition(g, H); else if (H > WH) paintBeneath(g, H);
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

  // Beneath the iceberg: open water that keeps on darkening to almost black. Nothing is drawn here but the water
  // itself, a hint of the cold far-off haze and a very few motes; the emptiness is the point.
  function paintBeneath(g, H) {
    const top = "#03091a", mid = "#020610", low = "#010206";
    for (let y = WH - 6; y < H; y += 6) {
      const t = (y - WH) / (H - WH);
      g.fillStyle = t < 0.25 ? mix(top, mid, Math.max(0, t) / 0.25) : mix(mid, low, Math.min(1, (t - 0.25) / 0.5));
      g.fillRect(0, y, WW, 6);
      if (y > WH) { for (let x = (y / 6) % 2; x < WW; x += 2) g.fillRect(x, y - 1, 1, 1); }
    }
    // A wide, faint haze where the last of the light from above gives out, under the iceberg's tip.
    for (let y = BOTTOM - 40; y < BEYOND_Y + 40; y++) {
      const k = 1 - Math.abs((y - BOTTOM) / (BEYOND_Y - BOTTOM + 40));
      if (k <= 0) continue;
      const hw = 60 + (y - BOTTOM + 40) * 0.9;
      g.globalAlpha = 0.05 * k * k; g.fillStyle = "#3a6a9c"; g.fillRect(Math.round(CX - hw), y, Math.round(hw * 2), 1);
    }
    g.globalAlpha = 1;
    let seed = 41; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 90; i++) { const y = BOTTOM + rnd() * (H - BOTTOM); g.fillStyle = "#24364f"; g.globalAlpha = 0.25 + rnd() * 0.3; g.fillRect(Math.floor(rnd() * WW), Math.floor(y), 1, 1); }
    g.globalAlpha = 1;
  }

  // ---------- Beneath the iceberg: the rest of the expedition ----------
  // Painted once, top to bottom. Everything here is dark, as it should be: the scene's own darkness lets only the pool
  // of light around you show it, and the lights listed in LAMPS glow through.
  function paintExpedition(g, H) {
    let seed = 1203; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    LAMPS.length = 0;
    // The water itself, banded every 6 rows with a dither between bands so it reads smooth.
    for (let y = W; y < H; y += 6) {
      g.fillStyle = seaAt(mX(y)); g.fillRect(0, y, WW, 6);
      if (y > W) { g.fillStyle = seaAt(mX(y + 3)); for (let x = (y / 6) % 2; x < WW; x += 2) g.fillRect(x, y - 1, 1, 1); }
    }
    // Twilight: the very last of the light from above, as faint slanting shafts that give out by about 500 m.
    [[CX - 300, 30], [CX - 120, 24], [CX + 70, 30], [CX + 260, 24]].forEach(([x, w]) => {
      for (let y = yX(300); y < yX(520); y += 2) { const k = 1 - (y - yX(300)) / (yX(520) - yX(300)), dx = (y - yX(300)) * 0.18; g.globalAlpha = 0.035 * k; g.fillStyle = "#6fb3e6"; g.fillRect(Math.round(x - dx), y, w, 2); }
    });
    g.globalAlpha = 1;
    // A haze where the plain begins, so the floor rises out of something rather than starting on a line.
    for (let y = yX(FLOOR_M - 90); y < yX(FLOOR_M + 10); y++) { g.globalAlpha = 0.05 * Math.sin(Math.PI * (y - yX(FLOOR_M - 90)) / (yX(100))); g.fillStyle = "#1b2b44"; g.fillRect(0, y, WW, 1); }
    g.globalAlpha = 1;

    // The rock: the abyssal plain, the trench walls under it, and the cavern of The Unknown below that.
    for (const [S, edgeX] of [[ROCK.L, 0], [ROCK.R, WW]]) {
      const pts = S.pts, poly = [...pts, [edgeX, H], [edgeX, pts[0][1]]];
      fillPoly(g, poly, "#0b1426");
      // Strata and texture: darker bands and speckles across the rock, warmer in The Unknown.
      for (let y = Math.floor(pts[0][1]); y < H; y += 3) {
        const sp = rockAt(y); if (!sp) continue;
        const inner = edgeX === 0 ? sp[0] : sp[1], unk = mX(y) > TRENCH_M;
        for (let x = (edgeX === 0 ? 0 : Math.ceil(inner)) + (y & 1); edgeX === 0 ? x < inner : x < WW; x += 2) {
          const v = Math.sin(x * 0.07 + y * 0.31) + Math.sin(y * 0.05 - x * 0.013) * 1.4;
          if (v > 1.45) { g.fillStyle = unk ? "#1a0d1e" : "#0e1a30"; g.fillRect(x, y, 1, 1); }
          else if (rnd() < 0.012) { g.fillStyle = unk ? "#32162a" : "#1b2c48"; g.fillRect(x, y, 1, 1); }
        }
      }
      // A rim of faint light along every edge that faces the open water, so the shapes read in the dark.
      for (let i = 1; i < pts.length; i++) line(g, pts[i - 1], pts[i], mX(pts[i][1]) > TRENCH_M + 20 ? "#6a2c48" : "#3a5680", 0.95);
      for (let i = 1; i < pts.length; i++) line(g, [pts[i - 1][0], pts[i - 1][1] + 1], [pts[i][0], pts[i][1] + 1], mX(pts[i][1]) > TRENCH_M + 20 ? "#3a1a2e" : "#1f3352", 0.85);
    }
    const floorAt = x => { for (let y = yX(FLOOR_M - 30); y < yX(FLOOR_M + 30); y++) { const sp = rockAt(y); if (sp && (x < sp[0] || x > sp[1])) return y; } return yX(FLOOR_M); };
    // Sediment mounds and the odd stone on the plain.
    for (let i = 0; i < 46; i++) {
      const left = i % 2 === 0, x = left ? 8 + rnd() * (CX - 200) : CX + 192 + rnd() * (CX - 200), y = floorAt(x);
      const w = 3 + Math.floor(rnd() * 9); g.fillStyle = rnd() < 0.5 ? "#0c1628" : "#101c31"; g.fillRect(Math.round(x), y - 1, w, 1); if (w > 6) g.fillRect(Math.round(x) + 2, y - 2, w - 4, 1);
    }
    // Sea pens and glass sponges standing on the plain: thin pale stalks.
    for (let i = 0; i < 18; i++) {
      const left = i % 2 === 0, x = Math.round(left ? 20 + rnd() * (CX - 230) : CX + 210 + rnd() * (CX - 230)), y = floorAt(x), h = 5 + Math.floor(rnd() * 8);
      g.fillStyle = "#2a3d5c"; g.fillRect(x, y - h, 1, h);
      g.fillStyle = "#3b5378"; for (let k = 2; k < h; k += 2) { g.fillRect(x - 1, y - k, 1, 1); g.fillRect(x + 1, y - k - 1, 1, 1); }
    }

    // A wreck on the plain, on the left: an old steamer lying on her side, broken-backed, long since furred with silt.
    {
      const x0 = CX - 312, y0 = floorAt(CX - 260) - 2;
      const hull = [[x0, y0 - 10], [x0 + 12, y0 - 16], [x0 + 52, y0 - 18], [x0 + 60, y0 - 14], [x0 + 70, y0 - 19], [x0 + 104, y0 - 17], [x0 + 118, y0 - 9], [x0 + 112, y0], [x0 + 6, y0]];
      fillPoly(g, hull, "#0e1828"); fillPoly(g, [[x0 + 54, y0 - 16], [x0 + 66, y0 - 13], [x0 + 64, y0], [x0 + 56, y0]], "#070d1a");   // the break amidships
      line(g, [x0 + 12, y0 - 16], [x0 + 52, y0 - 18], "#24385a", 0.9); line(g, [x0 + 70, y0 - 19], [x0 + 104, y0 - 17], "#24385a", 0.9);
      for (let k = 0; k < 7; k++) { g.fillStyle = "#04070f"; g.fillRect(x0 + 18 + k * 12 + (k > 3 ? 6 : 0), y0 - 11, 2, 2); }       // portholes, dark
      g.fillStyle = "#132138"; g.fillRect(x0 + 30, y0 - 30, 9, 13); g.fillRect(x0 + 80, y0 - 27, 7, 10);                         // funnels, one fallen
      line(g, [x0 + 90, y0 - 19], [x0 + 112, y0 - 40], "#1c2d48", 0.9);                                                             // the mast, leaning
      line(g, [x0 + 100, y0 - 30], [x0 + 108, y0 - 26], "#1c2d48", 0.7);
      g.fillStyle = "#0b1322"; for (let k = 0; k < 30; k++) g.fillRect(x0 + Math.floor(rnd() * 118), y0 - Math.floor(rnd() * 3), 1 + Math.floor(rnd() * 3), 1); // silt along the hull
    }
    // A lost submarine on the right, nose down in the silt, its tower still upright.
    {
      const x0 = CX + 200, y0 = floorAt(CX + 230) - 1;
      fillPoly(g, [[x0, y0 - 6], [x0 + 6, y0 - 11], [x0 + 52, y0 - 13], [x0 + 62, y0 - 9], [x0 + 64, y0 - 4], [x0 + 58, y0], [x0 + 3, y0]], "#101a2b");
      g.fillStyle = "#0b1322"; g.fillRect(x0 + 22, y0 - 21, 12, 9); g.fillRect(x0 + 25, y0 - 26, 2, 5);   // conning tower, periscope
      line(g, [x0 + 6, y0 - 11], [x0 + 52, y0 - 13], "#25395a", 0.9); line(g, [x0 + 22, y0 - 21], [x0 + 34, y0 - 21], "#25395a", 0.8);
      g.fillStyle = "#04070f"; [10, 16, 40, 46].forEach(dx => g.fillRect(x0 + dx, y0 - 7, 2, 2));
      LAMPS.push({ x: x0 + 31, y: y0 - 17, col: "#ff8a6a", k: 0.5, r: 1, blink: 3.6 });                    // one indicator still blinking
    }
    // A research station bolted to the right-hand trench wall: two modules, struts into the rock, lit windows.
    {
      const y0 = yX(1385), sp = rockAt(y0), wx = sp ? sp[1] : CX + 160, x0 = Math.round(wx - 44);
      fillPoly(g, [[x0, y0 - 9], [x0 + 30, y0 - 9], [x0 + 34, y0 - 5], [x0 + 34, y0 + 5], [x0 + 30, y0 + 9], [x0, y0 + 9], [x0 - 4, y0 + 5], [x0 - 4, y0 - 5]], "#1a2a40");
      fillPoly(g, [[x0 + 8, y0 + 9], [x0 + 22, y0 + 9], [x0 + 22, y0 + 18], [x0 + 8, y0 + 18]], "#15233a");
      line(g, [x0 - 4, y0 - 9], [x0 + 34, y0 - 9], "#3a5478", 0.9);
      for (const sy of [y0 - 3, y0 + 3]) line(g, [x0 + 34, sy], [wx + 4, sy + 2], "#2a3c58", 0.9);   // struts into the wall
      g.fillStyle = "#1f2f48"; g.fillRect(x0 + 13, y0 - 18, 1, 9); g.fillRect(x0 + 11, y0 - 18, 5, 1);   // aerial
      [[x0 + 3, y0 - 2], [x0 + 11, y0 - 2], [x0 + 19, y0 - 2], [x0 + 13, y0 + 12]].forEach(([x, y], i) => { g.fillStyle = "#e9c98a"; g.fillRect(x, y, 3, 2); LAMPS.push({ x: x + 1, y, col: "#ffd79a", k: 0.55, r: 2, blink: i === 3 ? 0 : 0 }); });
      LAMPS.push({ x: x0 + 13, y: y0 - 19, col: "#ff6a5a", k: 0.8, r: 1, blink: 2.4 });
    }
    // Hydrothermal vents on a ledge of the left-hand wall: black chimneys, a glow at their mouths (the smoke is live).
    {
      const y0 = yX(1458), sp = rockAt(y0), wx = sp ? sp[0] : CX - 140;
      [[wx - 26, 16, 4], [wx - 14, 24, 5], [wx - 3, 12, 3]].forEach(([x, h, w]) => {
        fillPoly(g, [[x - w / 2 - 1, y0], [x - w / 2 + 1, y0 - h], [x + w / 2 - 1, y0 - h], [x + w / 2 + 1, y0]], "#0a0d16");
        g.fillStyle = "#24161a"; for (let k = 2; k < h; k += 3) g.fillRect(Math.round(x - w / 2 + 1), y0 - k, 1, 1);
        g.fillStyle = "#c2552e"; g.fillRect(Math.round(x - 1), y0 - h, 2, 1);
        LAMPS.push({ x: Math.round(x), y: y0 - h, col: "#ff7a3c", k: 0.7, r: 2, blink: 0, vent: true });
      });
      fillPoly(g, [[wx - 40, y0], [wx + 4, y0], [wx + 6, y0 + 4], [wx - 42, y0 + 4]], "#070c18");
    }
    // The Unknown. Ruins on a ledge to the left: columns, a fallen arch. Nobody built these.
    {
      const y0 = yX(1660), sp = rockAt(y0), wx = sp ? sp[0] : CX - 300, x0 = CX - 262;
      fillPoly(g, [[wx - 4, y0], [x0 + 104, y0], [x0 + 96, y0 + 6], [x0 + 70, y0 + 10], [wx - 4, y0 + 14]], "#140c1a");   // a ledge out from the cavern wall
      line(g, [wx - 4, y0], [x0 + 104, y0], "#5a2a46", 0.9);
      [0, 22, 44, 66].forEach((dx, i) => { const h = [34, 26, 38, 14][i]; g.fillStyle = "#170f1c"; g.fillRect(x0 + dx, y0 - h, 6, h); g.fillStyle = "#2a1a2c"; g.fillRect(x0 + dx, y0 - h, 6, 1); g.fillRect(x0 + dx, y0 - h, 1, h); });
      fillPoly(g, [[x0 - 2, y0 - 38], [x0 + 50, y0 - 42], [x0 + 50, y0 - 38], [x0 - 2, y0 - 34]], "#170f1c");   // a lintel, still in place
      fillPoly(g, [[x0 + 70, y0 - 2], [x0 + 92, y0 - 8], [x0 + 94, y0 - 4], [x0 + 72, y0 + 1]], "#140d18");      // and one that fell
      [[x0 + 2, y0 - 22], [x0 + 24, y0 - 15], [x0 + 46, y0 - 26]].forEach(([x, y]) => { g.fillStyle = "#4fd6c4"; g.fillRect(x + 2, y, 1, 3); g.fillRect(x + 1, y + 1, 3, 1); LAMPS.push({ x: x + 2, y: y + 1, col: "#7df0df", k: 0.6, r: 2, blink: 5.5 }); });
    }
    // Further down on the right, a standing stone covered in the same marks.
    {
      const y0 = yX(1880), x0 = CX + 214;
      fillPoly(g, [[x0 - 22, y0 + 6], [x0 + 34, y0 + 6], [x0 + 30, y0 + 12], [x0 - 18, y0 + 12]], "#0c0812");
      fillPoly(g, [[x0, y0 + 6], [x0 + 2, y0 - 44], [x0 + 10, y0 - 50], [x0 + 14, y0 - 44], [x0 + 14, y0 + 6]], "#150d1a");
      line(g, [x0 + 2, y0 - 44], [x0 + 10, y0 - 50], "#3a2236", 0.9);
      for (let k = 0; k < 6; k++) { const y = y0 - 38 + k * 7; g.fillStyle = "#c04a5a"; g.fillRect(x0 + 5, y, 4, 1); g.fillRect(x0 + 6 + (k % 2) * 2, y + 2, 1, 2); LAMPS.push({ x: x0 + 7, y: y + 1, col: "#ff6259", k: 0.4, r: 1, blink: 7 + k * 0.6 }); }
    }
    // Far below everything, a red glow with no source.
    for (let y = yX(1820); y < H; y += 2) { const k = (y - yX(1820)) / (H - yX(1820)); g.globalAlpha = 0.06 * k; g.fillStyle = "#5a1020"; g.fillRect(CX - 300, y, 600, 2); }
    g.globalAlpha = 1;
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
    // Frozen in the ice at about 165 m, tilted as if it came down hard a very long time ago: a small flying saucer.
    // It's painted into the ice itself, so it darkens with depth like everything else and only shows when the light
    // reaches it. Nothing in the game mentions it.
    {
      const UFO = ["         EEee          ", "       Eeeeeeee        ", "      Eeeeeeeeee       ", "  HHHHHHHHHHHHHHHHHH   ",
        "hHHHHHHHHHHHHHHHHHHHh  ", "hhyhhhyhhhrhhhyhhhyhh  ", "  ssssssssssssssssss   ", "     s  s    s  s      "];
      const pal = { E: "#e3f6ff", e: "#8fcfe4", H: "#b9c2cf", h: "#7d8798", y: "#ffd36b", r: "#ff7a6b", s: "#4a5466" };
      const ux = CX - 44, uy = yOfDepth(165);
      UFO.forEach((row, i) => [...row].forEach((ch, x) => { if (pal[ch]) { g.fillStyle = pal[ch]; g.fillRect(ux + x - Math.floor(i / 3), Math.round(uy) + i + Math.floor(x / 8), 1, 1); } }));
      // The ice over it: a frosted glaze, and the cracks it made going in.
      fillPoly(g, [[ux - 6, uy - 5], [ux + 26, uy - 3], [ux + 28, uy + 12], [ux - 2, uy + 14], [ux - 8, uy + 6]], "#cfeaf8", 0.3);
      [[[ux + 22, uy - 2], [ux + 31, uy - 9]], [[ux + 24, uy + 9], [ux + 33, uy + 15]], [[ux - 5, uy + 2], [ux - 13, uy - 3]], [[ux + 9, uy + 12], [ux + 7, uy + 20]]].forEach(([a, b]) => line(g, a, b, "#d9f1ff", 0.45));
    }
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
  function paint(canvas) { const g = canvas.getContext("2d"); paintSea(g, Math.max(WH, canvas.height)); paintIce(g); }
  function paintLayers(sea, ice) { paintSea(sea.getContext("2d"), sea.height); ice.getContext("2d").clearRect(0, 0, ice.width, ice.height); paintIce(ice.getContext("2d")); }
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
  // The game's motion: ease in and out for journeys, ease out for things arriving (they start at speed and settle).
  const easeInOut = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const easeOutQuart = t => 1 - Math.pow(1 - t, 4);
  const easeInOutSlow = t => t < 0.5 ? 16 * t ** 5 : 1 - Math.pow(-2 * t + 2, 5) / 2; // longer glide, gentler landing
  // The way down beneath the iceberg: gathers pace, then slows long before the end, so the last stretch is a drift.
  const easeDescent = t => { const q = t * t * (3 - 2 * t); return 1 - Math.pow(1 - q, 1.8); };
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
      <div class="ib-world ib-sea"></div>
      <canvas class="ib-life ib-life-back"></canvas>
      <div class="ib-world ib-ice"><canvas width="${WW}" height="${WH}"></canvas></div>
      <canvas class="ib-life ib-life-front"></canvas>
      <canvas class="ib-snow"></canvas>
      <div class="ib-shade"></div>
      <canvas class="ib-life ib-life-lume"></canvas>
      <div class="ib-glow"></div>
      <div class="ib-veil"></div>
      <div class="ib-bestline" hidden></div>
      <div class="ib-route" aria-hidden="true"><i class="ib-rope"></i></div>
      <svg class="ib-lines" aria-hidden="true"><path class="ib-leader" pathLength="1" fill="none"/></svg>
      <div class="ib-layer"></div>
      <div class="ib-gauge" aria-hidden="true"><div class="ib-rail"><div class="ib-scale"></div></div><div class="ib-read"><span class="ib-depth">0 m</span></div></div>
      <div class="ib-nav" hidden><button type="button" class="ib-prev" aria-label="Shallower guess">${SVG.up}</button><button type="button" class="ib-next" aria-label="Deeper guess">${SVG.down}</button></div>`;
    const $ = sel => host.querySelector(sel);
    const seaW = $(".ib-sea"), iceW = $(".ib-ice"), iceC = $(".ib-ice canvas"), layer = $(".ib-layer"), snow = $(".ib-snow"), sg = snow.getContext("2d");
    const route = $(".ib-route"), rope = $(".ib-rope"), veil = $(".ib-veil"), shade = $(".ib-shade"), glow = $(".ib-glow"), depthEl = $(".ib-depth"), gauge = $(".ib-gauge"), scale = $(".ib-scale"), read = $(".ib-read"), nav = $(".ib-nav"), bestLine = $(".ib-bestline"), leader = $(".ib-leader");
    const life = { back: $(".ib-life-back"), front: $(".ib-life-front"), lume: $(".ib-life-lume") };
    // The sea runs the whole depth of the dive, far taller than any screen. It is painted once, then cut into tiles,
    // and only the tiles in view are shown: one huge layer costs every frame, even where nobody can see it.
    const TILE = 512, seaFull = document.createElement("canvas"); seaFull.width = WW; seaFull.height = XH;
    paintLayers(seaFull, iceC);
    const tiles = [];
    for (let y = 0; y < XH; y += TILE) {
      const c = document.createElement("canvas"); c.width = WW; c.height = Math.min(TILE, XH - y);
      c.getContext("2d").drawImage(seaFull, 0, y, WW, c.height, 0, 0, WW, c.height);
      c.style.position = "absolute"; c.style.left = "0"; c.style.top = "0"; seaW.append(c); tiles.push({ c, y, h: c.height, on: true });
    }

    const TIP_Y = (PEAK + W) / 2 + 8;
    let compact = false, stack = false, U = 2, Z = 2, camW = 0, camH = 0, camY = TIP_Y, aim = 0, axis = 0, focusIdx = -1, bestIdx = -1, items = [], raf = 0, snowRaf = 0, busy = false;
    let introRun = null, frame = { l: 0, r: 0, t: 0, b: 0, h: 0 }, frameRun = null, gaugeW = 84, noteBox = null, wide = false;   // wide: the whole iceberg in view, every marker labelled
    let run = { cancelled: true };
    const handlers = { focus: () => {}, depth: () => {}, travel: () => {}, land: () => {}, render: () => {}, resize: () => {} };
    let seed = 20261123; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647; // fixed seed: same drift every visit
    const flakes = Array.from({ length: 1100 }, () => ({ x: rnd() * WW, y: W + rnd() * (XH - W), s: 0.3 + rnd() * 0.7, ph: rnd() * 6.28, keep: rnd() }));
    for (const f of flakes) { f.fall = mX(f.y) > TRENCH_M ? -1.4 : 2.2; f.red = `rgb(255,${110 + Math.round(f.s * 60)},120)`; }   // red motes in The Unknown drift up
    // The dive so far: base, where this question started; at, where you are now (both running totals in metres).
    let dive = { base: 0, at: 0 }, ways = [], browsing = false;   // browsing: the player chose to look back up at an answer
    const XSLOT = [18, -18, 0]; // markers sit left, right and centre of the ice so equal depths never stack

    // Where the iceberg's centre line sits on screen: in the middle of the free area, nudged aside on wide windows
    // so an annotation has open water to sit in.
    // The iceberg is centred in the free area, on the same line as the question above it, at every size.
    const axisFor = f => { const w = camW - f.l - f.r; return f.l + w * 0.5; };
    function measure() {
      camW = host.clientWidth; camH = host.clientHeight;
      const fw = camW - frame.l - frame.r, fh = camH - frame.t - frame.b;
      stack = fw < 620;                 // narrow: the annotation sits under its marker instead of beside the ice
      compact = fh < 330;               // very little room (a phone keyboard is open): a shorter annotation
      gaugeW = stack ? 40 : 84;
      // The tip must fit beneath the room kept above it for the question (frame.h).
      U = Math.max(2, Math.min(4, Math.floor(Math.min(fw * 0.68 / 190, (fh - (frame.h || 0)) * 0.9 / (W - PEAK + 30)))));
      const ax = axisFor(frame);
      U = Math.min(6, Math.max(U, Math.ceil(Math.max(ax, camW - ax) / CX))); // the sea always reaches both edges
      if (!frameRun) axis = ax;
      iceC.style.width = WW * U + "px"; iceC.style.height = iceC.height * U + "px";
      for (const tl of tiles) { tl.c.style.width = WW * U + "px"; tl.c.style.height = tl.h * U + "px"; tl.c.style.transform = `translateY(${tl.y * U}px)`; }
      snow.width = Math.max(1, Math.ceil(camW / 3)); snow.height = Math.max(1, Math.ceil(camH / 3));
      // Wildlife is drawn at the artwork's own pixel size, one canvas pixel per art pixel.
      for (const c of Object.values(life)) { c.width = Math.ceil(camW / U) + 2; c.height = Math.ceil(camH / U) + 2; c.style.width = c.width * U + "px"; c.style.height = c.height * U + "px"; }
      host.classList.toggle("ib-compact", compact); host.classList.toggle("ib-stack", stack);
      // The depth scale: a tick every 10 m, a figure every 50 m, the zone names where they begin.
      scale.textContent = "";
      const tick = (m, y, extra) => { const t = document.createElement("i"); t.style.top = Math.round(y * U) + "px"; if (m % 50 === 0) { t.className = "major" + (extra || ""); t.dataset.m = m; } else if (extra) t.className = extra.trim(); scale.append(t); };
      // The scale is your running depth: every 10 m along the iceberg, every 50 m below it, a figure every 100 m down there.
      for (let m = 0; m <= XM; m += m < 300 ? 10 : 50) { const t = document.createElement("i"); t.style.top = Math.round(yX(m) * U) + "px"; if (m < 300 ? m % 50 === 0 : m % 100 === 0) { t.className = "major"; t.dataset.m = m; } scale.append(t); }
      const brk = document.createElement("b"); brk.className = "ib-break"; brk.style.top = Math.round(BOTTOM * U) + "px"; scale.append(brk);   // the iceberg ends here
      REGIONS.slice(1).forEach(z => { const s = document.createElement("span"); s.className = "region-" + z.key; s.textContent = z.name; s.style.top = Math.round(yX(z.from) * U) + "px"; scale.append(s); });
      handlers.resize();
    }
    const wideZ = (span = BOTTOM - PEAK + 50) => Math.min(U, Math.max(Math.max(axis, camW - axis) / CX, (camH - frame.t - frame.b) / span));
    // How far down the camera may go: the artwork, or past it to the deepest answer beneath the iceberg.
    const floorY = () => XH;
    const viewHalf = (z = Z) => camH / (2 * z);
    // The camera may run a little past the top and bottom of the artwork, by as much as the controls cover, so the
    // tip and the very deepest answers can still be framed in the free part of the window.
    // At the tip the view may reach a little above the artwork (frame.h, the room kept for the question): that is open sky.
    const clampCam = (y, z = Z) => { const h = viewHalf(z), lo = h - (frame.t + (frame.h || 0)) / z, hi = floorY() - h + frame.b / z; return lo >= hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, y)); };
    const tx = () => Math.round(axis - CX * Z), ty = () => Math.round(camH / 2 - camY * Z);
    // Depth at the middle of the open water (below whatever the frame keeps clear at the top), in metres.
    const camM = () => mX(camY + (frame.t + (camH - frame.t - frame.b) / 2 - camH / 2) / Z);
    const smooth = k => { k = Math.min(1, Math.max(0, k)); return k * k * (3 - 2 * k); };
    // 0 at the surface, 1 by the iceberg's lower half: how dark the water is.
    const depthNow = () => Math.min(1, Math.max(0, (camM() - 8) / 300));
    // The pool of light the camera carries: wide near the surface, a small circle round the answer in the deep, and
    // narrower again beneath the iceberg.
    const poolR = () => { const bk = beyondNow(); return Math.round(((1 - Math.pow(depthNow(), 0.7)) * Math.max(camW, camH) * 0.75 + 130) * (1 - bk * 0.55) + bk * 190); };
    // 0 on the iceberg, rising to 1 as the camera passes its tip and goes on into the open water beneath it.
    // Measured at the middle of the open water (below whatever the frame keeps clear at the top), not the window's middle.
    // 0 in the upper ocean, 1 from the Midnight Zone down: the light you carry narrows to a small pool.
    const beyondNow = () => smooth((camM() - 420) / 420);
    const playerY = () => yX(dive.at);
    // Where a focused answer sits on screen: near the middle of the free area, or high in it when the annotation
    // has to go underneath.
    // The controls above grow and shrink a little as you play (a hint line, the Finish button). The framing uses the
    // tallest they have been, so those changes never nudge the camera. (Not while a panel covers the lower half.)
    let maxT = 0, maxW = 0;
    const lineT = () => frame.b > camH * 0.25 ? frame.t : Math.max(frame.t, maxT);
    const focusLine = () => lineT() + (camH - lineT() - frame.b) * (stack ? (compact ? 0.22 : 0.3) : 0.46);
    const focusY = it => it.y - (focusLine() - camH / 2) / U;
    // Where the camera rests with nothing in focus: on you, wherever the dive has got to; at the very start, the tip.
    const restY = () => dive.at > 0 ? clampCam(focusY({ y: playerY() })) : clampCam(tipY());
    // h: headroom kept above the summit when the camera is at the tip (the question's block of ice rests there). It
    // only moves the tip's framing; answers further down are framed in the whole free area as before.
    // With room kept for the question above (a tall frame.t), the summit sits just beneath it, so as much of the
    // water as possible stays in view; otherwise the tip is centred in the free area.
    const tipY = () => frame.t > 200 ? Math.max(TIP_Y - (frame.t + (camH - frame.t - frame.b) / 2 - camH / 2) / U, PEAK - (frame.t + 14 - camH / 2) / U)
      : Math.min(TIP_Y - (frame.t + (frame.h || 0) + (camH - frame.t - (frame.h || 0) - frame.b) / 2 - camH / 2) / U, PEAK - (frame.t + (frame.h || 0) + 4 - camH / 2) / U);

    function render() {
      const X0 = tx(), Y0 = ty();
      // Only the sea tiles in view (with a little margin) are shown.
      const vTop = -Y0 / Z - 40, vBot = (camH - Y0) / Z + 40;
      for (const tl of tiles) { const on = tl.y + tl.h > vTop && tl.y < vBot; if (on !== tl.on) { tl.on = on; tl.c.style.display = on ? "" : "none"; } }
      seaW.style.transform = iceW.style.transform = Z === U ? `translate3d(${X0}px, ${Y0}px, 0)` : `translate3d(${X0}px, ${Y0}px, 0) scale(${Z / U})`;
      const depth = depthNow();
      // The light narrows with depth: a wide soft vignette near the surface, a small pool around the answer in the abyss.
      const it = focusIdx >= 0 ? items[focusIdx] : null;
      const fx = it ? X0 + it.x * Z : axis, fy = it ? Y0 + it.y * Z : focusLine();
      const bk = beyondNow();
      const r = poolR();
      shade.style.setProperty("--x", fx + "px"); shade.style.setProperty("--y", fy + "px"); shade.style.setProperty("--r", r + "px");
      shade.style.opacity = Math.min(1, depth * 1.25).toFixed(3);
      host.style.setProperty("--beyond", bk.toFixed(3)); host.classList.toggle("ib-beneath", bk > 0.5);
      const cm = camM(), reg = regionOf(cm);
      if (host.dataset.region !== reg.key) host.dataset.region = reg.key;
      host.style.setProperty("--unknown", smooth((cm - 1420) / 160).toFixed(3));
      iceW.style.opacity = (1 - smooth((camY - BOTTOM) / 260) * 0.85).toFixed(3);   // the iceberg falls away into the dark above
      // The line you came down: from the waterline to where you are, with a small mark where each question ended.
      const rx = Math.round(X0 + CX * Z), top = Math.round(Y0 + W * Z), bot = Math.round(Y0 + playerY() * Z);
      route.hidden = !(dive.at > 0 || ways.length);
      rope.style.transform = `translate(${rx}px, ${top}px)`; rope.style.height = Math.max(0, bot - top) + "px";
      for (const w of ways) w.el.style.transform = `translate(${rx}px, ${Math.round(Y0 + yX(w.m) * Z)}px)`;
      // Depth gauge: the scale slides with the water, the reading rides at the depth the camera is aimed at.
      // The reading is where you are in the dive (the running total), never the rarity of one answer.
      const settled = Z === U, m = it && !busy && aim === it.y && it.at != null ? it.at : Math.round(mX(aim));
      depthEl.textContent = m.toLocaleString("en-US") + " m"; read.classList.toggle("beyond", !!(it && isBeyond(it.depth) && !busy));
      gauge.classList.toggle("on", settled); gauge.style.right = frame.r + "px";
      scale.style.transform = `translateY(${Y0}px)`;
      read.classList.toggle("on", m > 0 && settled);
      nav.style.left = frame.l + 14 + "px"; nav.style.bottom = frame.b + 14 + "px";
      read.style.transform = `translateY(${Math.round(Math.max(frame.t + 14, Math.min(camH - frame.b - 14, Y0 + aim * Z)))}px)`;
      // Your deepest so far: a quiet line across the water.
      const best = bestIdx >= 0 ? items[bestIdx] : null;
      if (best && best.depth > 0 && best.shown && settled) { bestLine.hidden = false; bestLine.style.transform = `translateY(${Math.round(Y0 + best.y * Z)}px)`; } else bestLine.hidden = true;
      // Markers and their small labels, placed in screen space so text is never scaled.
      const placed = [], right = camW - frame.r - Math.max(gaugeW, read.classList.contains("on") ? read.offsetWidth + 12 : 0) - 6;
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
          flip = (roomR < Math.min(nw, 190) || roomR < nw) && roomL > roomR;
          left = Math.round(flip ? Math.max(frame.l + 12, Math.min(sx - 40 - nw, iceL - 24 - nw)) : Math.max(sx + 24, Math.min(Math.max(sx + 40, iceR + 24), right - nw)));
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
        leader.classList.toggle("beyond", it.tier.key === "beyond");
      } else { glow.style.opacity = 0; leader.setAttribute("d", ""); }
      noteBox = nr;
      // Nothing overlaps: hide any small label or other marker the annotation would cover.
      items.forEach((k, j) => {
        const mx = X0 + k.x * Z, my = Y0 + k.y * Z;
        const hitPill = nr && k.rect && k.rect.l < nr.r + 6 && nr.l - 6 < k.rect.r && k.rect.t < nr.b + 6 && nr.t - 6 < k.rect.b;
        if (k.pill) k.pill.classList.toggle("dim", !k.shown || j === focusIdx || k.under || !!hitPill || (!settled && !wide));
        k.mark.classList.toggle("dim", !k.shown || (!!nr && j !== focusIdx && mx > nr.l - 10 && mx < nr.r + 10 && my > nr.t - 10 && my < nr.b + 10));
      });
      handlers.depth(depth, bk);
      handlers.render();
    }

    // Marine snow in screen space at a coarse pixel size: it drifts on its own and slides past as the camera moves.
    function drawSnow(now) {
      if (!host.isConnected || host.offsetParent === null) { snowRaf = 0; return; }   // off screen: rest until it is seen again
      snowRaf = requestAnimationFrame(drawSnow);
      sg.clearRect(0, 0, snow.width, snow.height);
      const X0 = tx(), Y0 = ty(), depth = depthNow(), t = now / 1000;
      // What drifts in the water changes with the region: marine snow thinning with depth, a few blue sparks in the
      // Midnight Zone, silt stirred up in the trenches, and in The Unknown, red motes that drift up instead of down.
      // Only flakes near the view are drawn, each colour worked out once; brightness goes through globalAlpha rather
      // than a new colour string per flake per frame.
      const top = -Y0 / Z - 60, bot = (camH - Y0) / Z + 60, fade = 1 - depth * 0.55;
      for (const f of flakes) {
        const wy = W + (((f.y - W + t * f.fall * f.s) % (XH - W)) + (XH - W)) % (XH - W);
        if (wy < top || wy > bot) continue;
        const sx = (X0 + (f.x + Math.sin(t * 0.3 + f.ph) * 2) * Z) / 3, sy = (Y0 + wy * Z) / 3;
        if (sx < 0 || sy < 0 || sx >= snow.width || sy >= snow.height) continue;
        const m = mX(wy), keep = m < 300 ? 1 : m < 600 ? 0.75 : m < 1000 ? 0.5 : m < FLOOR_M ? 0.3 : m < TRENCH_M ? 0.55 : 0.6;
        if (f.keep > keep) continue;
        if (m > TRENCH_M + 20) { sg.fillStyle = f.red; sg.globalAlpha = 0.12 + f.s * 0.3; }
        else if (m > FLOOR_M) { sg.fillStyle = "#968c82"; sg.globalAlpha = 0.1 + f.s * 0.2; }
        else if (m > 600 && f.keep < 0.06) { sg.fillStyle = "#8ff3e6"; sg.globalAlpha = 0.15 + 0.55 * (0.5 + 0.5 * Math.sin(t * 2.3 + f.ph * 7)); }
        else { sg.fillStyle = "#bee1ff"; sg.globalAlpha = (0.18 + f.s * 0.35) * fade; }
        sg.fillRect(Math.round(sx), Math.round(sy), 1, 1);
      }
      sg.globalAlpha = 1;
    }

    // Every wait and move can be stopped part-way; when it is, its promise still settles (stop() settles them all),
    // so nothing that was waiting on it is left hanging.
    let settle = [];
    const hold = resolve => { settle.push(resolve); return () => { settle = settle.filter(f => f !== resolve); resolve(); }; };
    const wait = (ms, r) => new Promise(res => { const resolve = hold(res), t0 = performance.now(); const step = now => { if (r.cancelled || now - t0 >= ms) return resolve(); raf = requestAnimationFrame(step); }; raf = requestAnimationFrame(step); });
    // r.hurry (set by hurry()): whatever is left of the move plays out over a quarter of a second instead.
    function animate(ms, r, fn) {
      return new Promise(res => {
        const resolve = hold(res);
        if (ms <= 0) { fn(1); return resolve(); }
        let t0 = performance.now(), dur = ms, hurried = false;
        const step = now => {
          if (r.cancelled) return resolve();
          if (r.hurry && !hurried && dur > 300) { hurried = true; const k0 = Math.min(1, (now - t0) / dur); dur = 260; t0 = now - k0 * dur; }
          const k = Math.min(1, (now - t0) / dur); fn(k); if (k < 1) raf = requestAnimationFrame(step); else resolve();
        };
        raf = requestAnimationFrame(step);
      });
    }
    function moveTo(target, ms, r, ease = easeInOut, aTo = target) {
      const from = camY, to = clampCam(target), aFrom = aim;
      // No distance to cover (an answer that doesn't take you deeper): still a short beat, so its reveal visibly lands.
      if (Math.abs(to - from) < 0.5) { camY = to; aim = aTo; render(); return wait(Math.min(ms, 560), r); }
      return animate(ms, r, k => { const e = ease(k); camY = from + (to - from) * e; aim = aFrom + (aTo - aFrom) * e; render(); });
    }
    // Anything interrupted mid-move is finished off first: a guess sent while the camera is still rising between
    // questions must not find the last question's answers still on the iceberg.
    let pendingClear = null;
    const stop = () => { run.cancelled = true; cancelAnimationFrame(raf); const s = settle; settle = []; s.forEach(f => f()); if (pendingClear) pendingClear(); veil.style.opacity = 0; };

    // What the game found, in reading order: the answer, how many players gave it, how deep that puts it, how rare
    // that is, then the small print. No box around it: a hairline, the text, and the water behind.
    function noteFor(it) {
      const c = document.createElement("div"); c.className = "ib-note tier-" + it.tier.key + (it.best ? " deepest" : "");
      const add = (cls, ...parts) => { const d = document.createElement("div"); d.className = cls; d.append(...parts); c.append(d); return d; };
      const b = text => { const e = document.createElement("b"); e.textContent = text; return e; };
      add("ib-name", it.name);
      // Rarity (this answer, among everyone's), then distance (what it adds to your dive), then where that leaves you.
      const zone = document.createElement("span"); zone.className = "ib-zone"; zone.textContent = it.tier.name;
      add("ib-share", b(it.shareText), it.est ? " of players (est.) " : " of players ", zone);
      if (it.at == null) { if (it.depth > 0) add("ib-below", b(it.depth + " m"), " deep"); }
      else if (it.mine) add("ib-below", b("Mine"), " · no distance, guess spent", it.keep ? ` · your +${it.keep} m still counts` : "");
      else if (it.gain > 0) add("ib-below", b("+" + (it.earn != null ? it.earn : it.depth) + " m"), (it.earn != null ? it.earn : it.depth) > it.gain ? ` (${it.gain} m further than your last best)` : "", " · down to ", b(it.at.toLocaleString("en-US") + " m"));
      else if (it.keep != null) add("ib-below", b("+" + (it.earn != null ? it.earn : it.depth) + " m"), (it.earn != null ? it.earn : it.depth) === it.keep ? " · level with your best, no further down" : ` · your +${it.keep} m still counts`);
      else if (it.mode === "risk") add("ib-below", b("+" + (it.earn != null ? it.earn : it.depth) + " m"), " · on offer: your choice next");
      else add("ib-below", b("+0 m"), " · said by too many to take you down");
      if (it.at != null && it.gain > 0) { const r = regionOf(it.at), was = regionOf(it.at - it.gain); if (r !== was) add("ib-region", "Into ", b(r.name)); }
      if (it.rankText) add("ib-rank", it.rankText);
      add("ib-meta", it.meta || "Guess " + it.n + (it.countText ? " · " + it.countText + " players" : ""));
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
      glow.classList.toggle("rare", i >= 0 && items[i].depth >= 200 && !isBeyond(items[i].depth));
      glow.classList.toggle("beyond", i >= 0 && isBeyond(items[i].depth));
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
      // a.who: "them" draws another player's marker (hollow) so two dives can share one iceberg. a.dx / a.side place it by hand.
      // In a dive, an answer sits where it leaves you: further down if it beat your best, else where you already are.
      const y = a.at != null && a.at > 0 ? yX(a.at) : depthY(a.share);
      const it = { ...a, depth, tier: tierOfDepth(depth), y, x: CX + (a.dx != null ? a.dx : XSLOT[i % 3]), side: a.side || (i % 2 === 0 ? 1 : -1), shown: false, best: false, tag: "", sight: "" };
      const m = document.createElement("button"); m.type = "button"; m.className = "ib-mark dim tier-" + it.tier.key + (a.who === "them" ? " them" : ""); m.setAttribute("aria-label", `${a.label ? a.label + ": " : "Guess " + it.n + ": "}${it.name}, ${depth} metres`);
      m.onclick = () => focus(i); layer.append(m); it.mark = m;
      const p = document.createElement("button"); p.type = "button"; p.className = "ib-pill dim tier-" + it.tier.key + (a.who === "them" ? " them" : ""); p.title = it.name;
      const nm = document.createElement("span"); nm.textContent = (a.label ? a.label + " · " : "") + it.name; const d = document.createElement("b"); d.textContent = (a.at != null ? "+" : "") + (a.earn != null ? a.earn : depth) + " m";
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
    async function enter(animated = true, o = {}) {
      stop(); const r = run = introRun = { cancelled: false };
      layer.innerHTML = ""; items = []; focusIdx = -1; bestIdx = -1; nav.hidden = true; busy = false; wide = false; host.classList.remove("ib-drawn");
      measure();
      if (o.at != null) dive = { base: o.at, at: o.at };
      if (dive.at > 0) { Z = U; camY = restY(); aim = playerY(); render(); r.cancelled = true; return; }   // resuming a dive already under way: you are where you were
      if (!animated) { Z = U; camY = clampCam(tipY()); aim = 0; render(); return; }
      if (o.descent) {
        // The day's first question: close on the summit, then down the face of the iceberg to the waterline, the
        // camera pulling back as it goes. Any tap or key ends it at once (skipIntro).
        const z0 = Math.min(U * 2.4, 9); Z = z0; camY = clampCam(PEAK + 4, z0); aim = 0; render();
        const y0 = camY;
        await animate(1700 / speed, r, k => { const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; Z = z0 + (U - z0) * e; camY = clampCam(y0 + (tipY() - y0) * e); render(); });
        if (!r.cancelled) { Z = U; camY = clampCam(tipY()); render(); r.cancelled = true; }   // finished: nothing is running any more
        return;
      }
      Z = wideZ(); camY = clampCam(WH / 2); aim = 0; render();
      const z0 = Z, y0 = camY;
      await animate(900 / speed, r, k => { const e = easeOutQuart(k); Z = z0 + (U - z0) * e; camY = clampCam(y0 + (tipY() - y0) * e); render(); });
      if (!r.cancelled) { Z = U; camY = clampCam(tipY()); render(); r.cancelled = true; }   // finished: nothing is running any more
    }
    // Between questions: everything from the last one fades, and the camera rises back to the iceberg's tip while
    // the frame recomposes for the controls. From beneath the iceberg it doesn't make you watch the whole way up:
    // the dark closes in, and opens again just under the surface for the last of the rise. Resolves when the tip is
    // in place. f: the new frame (the free part of the window once the controls are back).
    async function surface(f, ms = 820) {
      stop(); const r = run = { cancelled: false }; busy = false; wide = false; nav.hidden = true;
      const fromY = camY, z0 = Z, axis0 = axis, aim0 = aim, deep = beyondNow() > 0.2 || fromY > BOTTOM;
      if (frameRun) frameRun.cancelled = true; frameRun = null;
      if (f) frame = { l: f.l || 0, r: f.r || 0, t: f.t || 0, b: f.b || 0 };
      host.classList.add("ib-clearing"); host.classList.remove("ib-drawn");
      let cleared = false;
      const clear = () => { if (cleared) return; cleared = true; pendingClear = null; layer.innerHTML = ""; items = []; focusIdx = -1; bestIdx = -1; leader.setAttribute("d", ""); host.classList.remove("ib-clearing"); };
      measure(); const axis1 = axisFor(frame);
      pendingClear = () => { clear(); axis = axis1; Z = U; };
      if (deep && !reduce) {
        // out of the deep: the dark closes in over a fifth of a second, the camera is brought up beneath the surface,
        // and the dark lifts while it rises the rest of the way
        const mid = W + 120;
        await animate(200 / speed, r, k => { veil.style.opacity = easeInOut(k).toFixed(3); });
        if (r.cancelled) return;
        clear(); Z = U; camY = mid; axis = axis1; aim = 0; render();
        const to = clampCam(tipY());
        await animate(Math.max(400, ms - 200) / speed, r, k => { const e = easeOutQuart(k); veil.style.opacity = (1 - e).toFixed(3); camY = mid + (to - mid) * e; render(); });
        veil.style.opacity = 0;
        if (r.cancelled) return;
      } else {
        const to = () => clampCam(tipY());
        await animate((reduce ? 0 : ms) / speed, r, k => { const e = easeInOut(k); if (k > 0.25) clear(); Z = z0 + (U - z0) * e; axis = axis0 + (axis1 - axis0) * e; camY = fromY + (to() - fromY) * e; aim = aim0 * (1 - e); render(); });
        if (r.cancelled) return;   // a guess took over (stop() has already cleared the old answers)
      }
      clear();
      if (!r.cancelled) { Z = U; axis = axis1; camY = clampCam(tipY()); aim = 0; render(); r.cancelled = true; }   // finished: nothing is running any more
    }
    // Between questions, the dive goes on: the last question's answers fade and the frame recomposes for the controls,
    // but the camera stays at the depth it reached. The next guess travels from there, down or back up. Resolves once
    // the frame is in place. f: the new frame, as for surface().
    async function carry(f, ms = 620, at) {
      stop(); const r = run = { cancelled: false }; busy = false; wide = false; nav.hidden = true;
      if (at != null) dive = { base: at, at };
      const z0 = Z, axis0 = axis, aim0 = aim;
      if (frameRun) frameRun.cancelled = true; frameRun = null;
      if (f) frame = { l: f.l || 0, r: f.r || 0, t: f.t || 0, b: f.b || 0 };
      host.classList.add("ib-clearing"); host.classList.remove("ib-drawn");
      let cleared = false;
      const clear = () => { if (cleared) return; cleared = true; pendingClear = null; layer.innerHTML = ""; items = []; focusIdx = -1; bestIdx = -1; leader.setAttribute("d", ""); host.classList.remove("ib-clearing"); };
      measure(); const axis1 = axisFor(frame), cam0 = camY;
      pendingClear = () => { clear(); axis = axis1; Z = U; };
      // On to the next question from where you are. (On a narrow screen the results panel lifted the view; this puts
      // the composition back, with the old answers fading, and no depth changes.)
      const to = () => browsing || stack ? restY() : Math.max(cam0, restY());
      if (to() < cam0 - 4 && !browsing && !reduce) {
        // Recomposing upward (a narrow screen, after the results lifted the view): never shown as a journey up. The
        // dark closes in for a moment, the view is set, and it opens again where you are.
        await animate(180 / speed, r, k => { veil.style.opacity = easeInOut(k).toFixed(3); });
        if (r.cancelled) return;
        clear(); Z = U; axis = axis1; camY = to(); aim = playerY(); render();
        await animate(380 / speed, r, k => { veil.style.opacity = (1 - easeOutQuart(k)).toFixed(3); });
        veil.style.opacity = 0; browsing = false;
        if (!r.cancelled) { camY = to(); render(); r.cancelled = true; }
        return;
      }
      await animate((reduce ? 0 : ms) / speed, r, k => { const e = easeInOut(k); if (k > 0.25) clear(); Z = z0 + (U - z0) * e; axis = axis0 + (axis1 - axis0) * e; camY = cam0 + (to() - cam0) * e; aim = aim0 + (playerY() - aim0) * e; render(); });
      clear(); browsing = false;
      if (!r.cancelled) { Z = U; axis = axis1; camY = to(); aim = playerY(); render(); r.cancelled = true; }
    }
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    // One guess: a beat of anticipation, the journey, the landing. Resolves when the marker lands and the annotation
    // starts to draw; the box is ready for the next guess from that moment.
    async function add(a, o = {}) {
      stop(); const r = run = { cancelled: false }; busy = true; Z = U; wide = false; browsing = false;
      const it = build(a), i = items.length - 1;
      if (a.at != null) dive.at = Math.max(dive.at, a.at);
      showNote(-1);
      await wait((o.special ? 140 : 40) / speed, r);   // a breath, so the slot's change reads first; the camera is moving well inside a tenth of a second
      // In a dive the camera only ever goes down: an answer that doesn't beat your best is revealed where you are.
      const target = a.at != null ? Math.max(camY, clampCam(focusY(it))) : focusY(it), dist = Math.abs(clampCam(target) - camY);
      const deep = isBeyond(it.depth);
      // Beneath the iceberg: a long, unhurried descent past the tip and on into the dark.
      const ms = deep ? Math.min(3600, Math.max(2400, 1600 + dist * U * 0.6)) : o.special ? Math.min(2300, Math.max(1500, 900 + dist * U * 1.3)) : Math.min(1500, Math.max(650, 450 + dist * U * 0.9));
      handlers.travel(it, clampCam(target) > camY ? 1 : -1, ms / speed);
      await moveTo(target, ms / speed, r, deep ? easeDescent : o.special ? easeInOutSlow : easeInOut, it.y);
      it.shown = true; const prevBest = bestIdx; markBest();
      it.tag = o.tag || ""; it.sight = o.sight || "";
      camY = clampCam(target); aim = it.y; busy = false;
      it.mark.classList.add("landed");
      showNote(i, true, true);
      handlers.land(i, it, { best: bestIdx === i, firstBest: prevBest < 0 });
      return it;
    }
    // After a reload: put every earlier guess back without replaying anything.
    // glide: instead of cutting to the answer, travel there from wherever the camera is (used when exploring a finished dive).
    function restore(list, o = {}) {
      stop(); run = { cancelled: true };
      if (o.at != null) dive = { base: o.base != null ? o.base : o.at, at: o.at };
      const from = { y: camY, z: Z, had: items.length > 0 || wide };
      layer.innerHTML = ""; items = []; focusIdx = -1; bestIdx = -1; busy = false; wide = false;
      measure(); Z = U;
      list.forEach(a => { const it = build(a); it.shown = true; it.tag = a.tag || ""; it.sight = a.sight || ""; });
      markBest();
      const at = o.focus != null ? o.focus : bestIdx;
      if (at >= 0 && o.glide && from.had) { Z = from.z; camY = from.y; render(); focus(at); return; }
      if (at >= 0) { camY = clampCam(focusY(items[at])); aim = items[at].y; showNote(at, true); } else { camY = restY(); aim = dive.at > 0 ? playerY() : 0; render(); }
    }
    // The whole iceberg in one view, every answer marked and labelled: the summary of a finished dive.
    function overview(list, o = {}) {
      stop(); const r = run = { cancelled: false };
      const from = { y: camY, z: Z, had: items.length > 0 };
      layer.innerHTML = ""; items = []; focusIdx = -1; bestIdx = -1; busy = false; nav.hidden = true; host.classList.remove("ib-drawn");
      measure();
      list.forEach(a => { const it = build(a); it.shown = true; });
      markBest(); nav.hidden = true; wide = true; aim = 0;
      // Frame every marker: the middle of the span from the waterline to the deepest answer.
      const ys = items.map(k => k.y).concat(o.at != null ? [yX(o.at)] : []), lo = Math.min(W - 20, ...ys), hi = Math.max(W + 220, ...ys);
      const zTo = wideZ(Math.max(BOTTOM, hi + 40) - PEAK + 50);
      // If it can't all fit (a find far beneath the iceberg), keep the deepest answer in view and let the tip go.
      const yTo = items.length ? Math.max((lo + hi) / 2, hi + (frame.b + 70) / zTo - viewHalf(zTo)) : WH / 2;
      if (!o.glide || !from.had) { Z = zTo; camY = clampCam(yTo); render(); return; }
      Z = from.z; camY = from.y; render();
      animate(800 / speed, r, k => { const e = easeInOut(k); Z = from.z + (zTo - from.z) * e; camY = clampCam(from.y + (yTo - from.y) * e); render(); }).then(() => { if (!r.cancelled) { Z = zTo; camY = clampCam(yTo); render(); } });
    }
    async function focus(i, o = {}) {
      if (!items[i] || !items[i].shown || busy) return;
      if (!o.auto) browsing = true;
      // The results opening on your best answer: in a dive it is where you already are. If it is on screen in the free
      // area, the camera stays put (no reframing that would read as moving) and the annotation simply comes back.
      if (o.auto && dive.at > 0 && Z === U && !stack) { const sy = ty() + items[i].y * Z; if (sy > frame.t + 40 && sy < camH - frame.b - 60) { stop(); run = { cancelled: true }; aim = items[i].y; showNote(i); return; } }
      stop(); const r = run = { cancelled: false };
      showNote(-1); wide = false;
      if (Z !== U) {                                   // coming from the wide view: push in and travel in one move
        const z0 = Z, y0 = camY;
        await animate(950 / speed, r, k => { const e = easeInOut(k); Z = z0 + (U - z0) * e; camY = clampCam(y0 + (focusY(items[i]) - y0) * e); render(); });
        if (r.cancelled) return; Z = U;
      }
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
      const next = { l: f.l || 0, r: f.r || 0, t: f.t || 0, b: f.b || 0, h: f.h || 0 };
      if (next.l === frame.l && next.r === frame.r && next.t === frame.t && next.b === frame.b && next.h === (frame.h || 0)) return;
      if (frameRun) frameRun.cancelled = true; frameRun = null;
      const from = { ...frame }, axis0 = axis, cam0 = camY, u0 = U;
      frame = next; measure();
      if (camW !== maxW) { maxW = camW; maxT = 0; }
      if (frame.b < camH * 0.25 && frame.r < camW * 0.2) maxT = Math.max(maxT, frame.t);
      // During a dive a change of layout never lifts the camera: it only ever goes down (or stays).
      const settle = () => { const y = busy ? camY : focusIdx >= 0 ? clampCam(focusY(items[focusIdx])) : items.length ? clampCam(camY) : restY(); return dive.at > 0 && !wide && !browsing ? Math.max(camY, y) : y; };
      // The opening push-in is still running (it reads the new frame by itself), or the whole-dive overview has its own zoom.
      const intro = Z !== U && !run.cancelled && (run === introRun || wide);
      if (ms <= 0 || U !== u0 || busy || intro) { axis = axisFor(frame); if (!busy && !intro) { Z = U; camY = settle(); } render(); return; }
      const axis1 = axisFor(frame), cam1 = settle(), fr = frameRun = { cancelled: false };
      const mixF = k => ({ l: from.l + (next.l - from.l) * k, r: from.r + (next.r - from.r) * k, t: from.t + (next.t - from.t) * k, b: from.b + (next.b - from.b) * k, h: (from.h || 0) + (next.h - (from.h || 0)) * k });
      animate(ms / speed, fr, k => { const e = easeInOut(k); frame = mixF(e); axis = axis0 + (axis1 - axis0) * e; if (!busy) camY = cam0 + (cam1 - cam0) * e; render(); })
        .then(() => { if (fr.cancelled) return; frameRun = null; frame = next; axis = axis1; if (!busy) camY = settle(); render(); });
    }

    $(".ib-prev").onclick = () => step(-1);
    $(".ib-next").onclick = () => step(1);
    const ro = new ResizeObserver(() => {
      if (!host.clientWidth || !host.clientHeight) return;
      const keep = camY; measure(); if (run.cancelled || !busy) Z = U;
      const y = focusIdx >= 0 && !busy ? clampCam(focusY(items[focusIdx])) : items.length ? clampCam(keep) : restY();
      camY = dive.at > 0 && !wide && !browsing ? Math.max(clampCam(keep), y) : y; render();
    });
    ro.observe(host);
    measure(); render(); snowRaf = requestAnimationFrame(drawSnow);
    // Shown again (a screen change): pick the drawing back up.
    new IntersectionObserver(e => { if (e.some(x => x.isIntersecting) && !snowRaf) snowRaf = requestAnimationFrame(drawSnow); }).observe(host);
    return {
      enter, add, restore, overview, focus, step, setTag, setSight, setFrame, surface, carry, life, stop,
      // The dive so far (running totals in metres), and the marks where earlier questions ended: [{ m, label }].
      setDive(d) { dive = { base: Math.max(0, d.base || 0), at: Math.max(0, d.at || 0) }; render(); },
      setRoute(list) {
        ways.forEach(w => w.el.remove()); ways = (list || []).map(w => { const el = document.createElement("i"); el.className = "ib-way" + (w.cls ? " " + w.cls : ""); if (w.label) el.dataset.label = w.label; route.append(el); return { m: w.m, el }; });
        render();
      },
      get dive() { return { ...dive }; },
      // End an opening move early and settle at the tip (a tap or a key during the descent).
      skipIntro() { if (run.cancelled || items.length) return; run.cancelled = true; Z = U; camY = restY(); render(); },
      // Skip ahead: a long move in progress (the descent beneath the iceberg, a slow reveal) finishes quickly.
      hurry() { if (!run.cancelled) run.hurry = true; },
      get wide() { return wide; },
      get busy() { return busy; }, get focused() { return focusIdx; }, get best() { return bestIdx; }, get count() { return items.length; },
      get depth() { const it = focusIdx >= 0 ? items[focusIdx] : null; return it && !busy && aim === it.y ? it.depth : metres(aim); },
      // For anything that draws into the scene (wildlife): where the artwork is on screen right now.
      get view() {
        const it = focusIdx >= 0 ? items[focusIdx] : null, bk = beyondNow();
        // What lights the water, in artwork pixels: the answer in view, its light warmer beneath the iceberg.
        const lights = it ? [{ x: it.x, y: it.y, r: poolR() * 1.7 / U, k: 1.0, col: isBeyond(it.depth) ? [1, 0.78, 0.72] : [0.86, 0.94, 1] }] : [];
        // Beneath the iceberg the answer's red glow reaches a long way, very faintly: enough to show a great shape.
        if (it && isBeyond(it.depth)) lights.push({ x: it.x, y: it.y, r: 280, k: 0.2, col: [1, 0.5, 0.45] });
        return { x0: tx(), y0: ty(), u: U, z: Z, w: camW, h: camH, camY, axis, frame, depth: depthNow(), beyond: bk, settled: Z === U, busy, note: noteBox, lights, focus: it ? { x: it.x, y: it.y } : null,
          metres: camM(), region: regionOf(camM()).key, at: dive.at, player: { x: CX, y: playerY() }, veiled: +veil.style.opacity > 0.02 };
      },
      onFocus: f => { handlers.focus = f; }, onDepth: f => { handlers.depth = f; }, onTravel: f => { handlers.travel = f; }, onLand: f => { handlers.land = f; },
      // Several parts listen to the camera (the animals, the question on the summit), so these add rather than replace.
      onRender: f => { const prev = handlers.render; handlers.render = () => { prev(); f(); }; }, onResize: f => { const prev = handlers.resize; handlers.resize = () => { prev(); f(); }; },
      destroy: () => { stop(); cancelAnimationFrame(snowRaf); ro.disconnect(); },
    };
  }

  window.Iceberg = { create, paint, XM, XH, yX, mX, REGIONS, regionOf, rockAt, LAMPS, seaAt, FLOOR_M, TRENCH_M, paintIce: canvas => { const g = canvas.getContext("2d"); g.clearRect(0, 0, canvas.width, canvas.height); paintIce(g); }, TIERS, tierFor, tierOfDepth, depthOf, depthY, yOfDepth, metres, iceSpan, iceEdge, isBeyond, evidenced, SURFACE_SHARE, MAX_M, BEYOND_M, EVIDENCE, WORLD: { WW, WH, W, PEAK, CX, BOTTOM, TOP_Y, PXM, SH, BEYOND_Y, PXD } };
})();
