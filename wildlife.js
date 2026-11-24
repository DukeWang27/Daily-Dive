// Life in the water. Every animal here is a real species, drawn as pixel art at the same pixel size as the iceberg,
// and each lives in its own band of depth: the camera finds different company the further down an answer takes it.
// The animals stay in the world rather than on the screen, so travelling down and back up passes the same ones.
//
// How it is put together:
//   SPECIES   one entry per animal: its name, where it really lives, the depth band it keeps to in the game, how it
//             is drawn and how it moves. Adding an animal means adding one entry; nothing else needs to know.
//   create()  populates one question's water and draws it into three small canvases that iceberg.js provides:
//             "back" (behind the iceberg), "front" (in front of it) and "lume" (living light, drawn above the
//             darkness so it still shows in the abyss).
//   Encounters are the rare, large animals. They are not residents: the game calls encounter() when an answer
//   reaches a depth worth marking, and one passes by.
(function () {
  "use strict";
  const I = window.Iceberg, { WH, W, CX, BOTTOM, TOP_Y, PXM } = I.WORLD;
  const yM = m => TOP_Y + m * PXM;                     // where a game depth (metres) sits in the artwork
  const TAU = Math.PI * 2;

  // ---------- Pixel drawing ----------
  // Sprites face right. art() builds one from rows of characters and a palette; an array in the palette marks a
  // light-producing pixel: [light colour, strength, body colour underneath].
  function canvasOf(w, h) { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
  function finish(c, lights) {
    const f = canvasOf(c.width, c.height), g = f.getContext("2d"); g.translate(c.width, 0); g.scale(-1, 1); g.drawImage(c, 0, 0);
    return { w: c.width, h: c.height, c, f, lights: lights || [] };
  }
  function art(rows, pal) {
    const h = rows.length, w = Math.max(...rows.map(r => r.length)), c = canvasOf(w, h), g = c.getContext("2d"), lights = [];
    rows.forEach((row, y) => [...row].forEach((ch, x) => {
      const col = pal[ch]; if (!col) return;
      if (Array.isArray(col)) { lights.push([x, y, col[0], col[1]]); if (col[2]) { g.fillStyle = col[2]; g.fillRect(x, y, 1, 1); } return; }
      g.fillStyle = col; g.fillRect(x, y, 1, 1);
    }));
    return finish(c, lights);
  }
  // Larger animals are built from filled outlines, then detailed pixel by pixel.
  function shape(w, h, fn) { const c = canvasOf(w, h), g = c.getContext("2d"), lights = []; fn(g, lights); return finish(c, lights); }
  function poly(g, pts, color, alpha = 1) {
    g.fillStyle = color; g.globalAlpha = alpha;
    const ys = pts.map(p => p[1]), y0 = Math.ceil(Math.min(...ys) - 0.5), y1 = Math.floor(Math.max(...ys) - 0.5);
    for (let y = y0; y <= y1; y++) {
      const yc = y + 0.5, xs = [];
      for (let i = 0; i < pts.length; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
        if ((ay <= yc && by > yc) || (by <= yc && ay > yc)) xs.push(ax + (yc - ay) / (by - ay) * (bx - ax));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) { const xa = Math.round(xs[k]), xb = Math.round(xs[k + 1]); if (xb > xa) g.fillRect(xa, y, xb - xa, 1); }
    }
    g.globalAlpha = 1;
  }
  function ell(g, cx, cy, rx, ry, color, alpha = 1) {
    g.fillStyle = color; g.globalAlpha = alpha;
    for (let y = Math.ceil(cy - ry); y <= Math.floor(cy + ry); y++) {
      const k = 1 - ((y + 0.5 - cy) / ry) ** 2; if (k <= 0) continue;
      const half = rx * Math.sqrt(k), xa = Math.round(cx - half), xb = Math.round(cx + half); if (xb > xa) g.fillRect(xa, y, xb - xa, 1);
    }
    g.globalAlpha = 1;
  }
  const px = (g, x, y, color, alpha = 1) => { g.fillStyle = color; g.globalAlpha = alpha; g.fillRect(Math.round(x), Math.round(y), 1, 1); g.globalAlpha = 1; };
  // Recolour only what is already drawn (shading, markings).
  function over(g, fn) { g.globalCompositeOperation = "source-atop"; fn(); g.globalCompositeOperation = "source-over"; }
  // One-pixel line, for tentacles and fins that are drawn fresh every frame.
  function stroke(g, x0, y0, x1, y1, color, alpha) {
    g.fillStyle = color; g.globalAlpha = alpha;
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (let n = 0; n < 400; n++) { g.fillRect(x0, y0, 1, 1); if (x0 === x1 && y0 === y1) break; const e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx; } if (e2 <= dx) { err += dx; y0 += sy; } }
    g.globalAlpha = 1;
  }
  // A limb that sways: a chain of short segments whose bend travels from root to tip.
  function limb(g, x, y, len, ang, sway, ph, color, alpha, bendAt, bendTo) {
    let px0 = x, py0 = y; const n = Math.max(2, Math.round(len / 3));
    for (let i = 1; i <= n; i++) {
      const u = i / n, a = (bendAt != null && u > bendAt ? bendTo : ang) + Math.sin(ph - u * 3.2) * sway * u;
      const nx = px0 + Math.cos(a) * len / n, ny = py0 + Math.sin(a) * len / n;
      stroke(g, px0, py0, nx, ny, color, alpha * (1 - u * 0.45)); px0 = nx; py0 = ny;
    }
    return [px0, py0];
  }
  // Draw a sprite. With a wave, the body bends from a fixed head to a swinging tail, column by column.
  function blit(g, s, x, y, dir, wave, alpha = 1) {
    const src = dir < 0 ? s.f : s.c; g.globalAlpha = alpha;
    if (!wave || !wave.amp) { g.drawImage(src, x, y); g.globalAlpha = 1; return; }
    const from = wave.from || 0;
    for (let i = 0; i < s.w; i++) {
      const u = dir < 0 ? i / (s.w - 1) : 1 - i / (s.w - 1), k = Math.max(0, (u - from) / (1 - from)); // 0 at the head, 1 at the tail
      g.drawImage(src, i, 0, 1, s.h, x + i, y + Math.round(Math.sin(wave.ph - u * (wave.k || 3)) * wave.amp * k), 1, s.h);
    }
    g.globalAlpha = 1;
  }
  // Living light: one bright pixel with a faint cross of glow around it.
  function light(D, x, y, color, a) {
    const L = D.L; if (!L || a <= 0.02) return;
    L.fillStyle = color; L.globalAlpha = Math.min(1, a); L.fillRect(x, y, 1, 1);
    if (!D.low) { L.globalAlpha = Math.min(1, a) * 0.3; L.fillRect(x - 1, y, 3, 1); L.fillRect(x, y - 1, 1, 3); }
    L.globalAlpha = 1;
  }
  function halo(D, x, y, color, a, r) {
    const L = D.L; if (!L) return; L.fillStyle = color;
    for (let k = D.low ? 1 : r; k >= 1; k--) { L.globalAlpha = a * (k === 1 ? 1 : 0.5 / k); for (let j = -k + 1; j < k; j++) { const h = k - 1 - Math.abs(j); L.fillRect(x - h, y + j, h * 2 + 1, 1); } }
    L.globalAlpha = 1;
  }
  const dots = (D, s, x, y, dir, a) => { const L = D.L; if (!L) return; for (const [lx, ly, col, k] of s.lights) { L.fillStyle = col; L.globalAlpha = Math.max(0, Math.min(1, a * k)); L.fillRect(x + (dir < 0 ? s.w - 1 - lx : lx), y + ly, 1, 1); } L.globalAlpha = 1; };
  const lights = (D, s, x, y, dir, a) => { for (const [lx, ly, col, k] of s.lights) light(D, x + (dir < 0 ? s.w - 1 - lx : lx), y + ly, col, a * k); };

  // ---------- The artwork ----------
  const LUME = "#8ff3e6", LUME_B = "#a9e6ff";
  const A = {};
  const aukPal = { k: "#141c29", w: "#dfe8f2", o: "#0b1018" };
  A.auk = [art(["..kk...", "kkkkkko", ".wwww.."], aukPal), art([".......", "kkkkkko", ".wkkw..", "..kk..."], aukPal)];
  const fishPal = { d: "#4c6c8c", s: "#a9c6da", w: "#dcebf5", h: "#c6dbe9", t: "#7f9db6", e: "#16202e" };
  A.capelin = [art(["t.dddd.", ".tssseh", "t.www.."], fishPal), art(["..dddd.", "ttssseh", "..www.."], fishPal)];
  const codPal = { d: "#565f6c", s: "#8f9aa3", w: "#c9d2d6", t: "#6d7781", e: "#0d131b", m: "#aab4ba" };
  A.cod = [
    art(["t...d.dd.d..", "tt.ddddddddd.", ".tsssssssesm", "tt.wwwwwwww.", "t...w..w...."], codPal),
    art(["....d.dd.d..", "t..ddddddddd.", "ttsssssssesm", "t..wwwwwwww.", "....w..w...."], codPal),
  ];
  A.seal = shape(36, 13, g => {
    poly(g, [[3, 6.5], [7, 4.2], [13, 2.4], [21, 1.6], [27, 2.4], [31, 3.8], [34, 5.4], [34.6, 6.6], [33, 8], [29, 9.2], [22, 10.2], [13, 9.8], [7, 8.4]], "#a7b6c6");
    over(g, () => {
      g.fillStyle = "#c2cfdb"; g.fillRect(0, 8, 36, 1); g.fillStyle = "#d6e2ec"; g.fillRect(0, 9, 36, 4); // pale belly
      g.fillStyle = "#8696a8"; g.fillRect(0, 0, 36, 3);                      // darker back
      poly(g, [[11, 3], [15, 2], [23, 2], [26, 4], [23, 6], [19, 4.4], [15, 5.4], [12, 6.6]], "#263140", 0.9); // the harp
      poly(g, [[29, 2], [36, 2], [36, 9], [30, 8.2]], "#232c39");            // dark face
    });
    poly(g, [[0, 3.6], [4, 5.6], [4, 7.6], [0, 9.6], [1.6, 6.6]], "#62717f"); // hind flippers
    poly(g, [[22, 9.6], [25.4, 9.6], [23.4, 13], [21, 13]], "#62717f");       // fore flipper
    px(g, 32, 5, "#b9c9d8"); px(g, 35, 6, "#0c1118");
  });
  const lanPal = { b: "#1b2a42", t: "#263a5a", r: "#35507a", E: "#a6d6ee", L: [LUME, 1, "#2f6f7c"] };
  A.lantern = [art(["t.rrrr..", "tbbbbbEb", "t.bLbLb."], lanPal), art(["..rrrr..", "tbbbbbEb", "t.bLbLb."], lanPal)];
  A.squid = shape(17, 7, g => {                                             // mantle and fins; arms are drawn live
    poly(g, [[4, 3.5], [6, 2], [12, 1.6], [15.5, 3], [17, 3.5], [15.5, 4.2], [12, 5.4], [6, 5]], "#6a7c93");
    poly(g, [[12, 1.6], [14.4, 0], [16.4, 2.6]], "#8296ae"); poly(g, [[12, 5.4], [14.4, 7], [16.4, 4.4]], "#8296ae"); // fins
    over(g, () => { g.fillStyle = "#93a7bd"; g.fillRect(5, 2, 10, 1); g.fillStyle = "#55667c"; g.fillRect(5, 5, 9, 1); });
    px(g, 5, 3, "#eaf4ff"); px(g, 4, 3, "#101722");
  });
  const angPal = { b: "#131b2a", r: "#31476a", t: "#1c2940", e: "#7f9cbd", T: "#d5e6f4", i: "#3d5376", m: "#070b13", L: [LUME_B, 1, "#e9fbff"] };
  A.angler = art([
    "..............iL..",
    ".....rrrrrr..i....",
    "...rrbbbbbbrri....",
    "..rbbbbbbbbbbi....",
    "t.bbbbbbbbbebbb...",
    "ttbbbbbbbbbbbTmT..",
    "tbbbbbbbbbbbmmmmT.",
    "ttbbbbbbbbbbmmmm..",
    "t.bbbbbbbbbbTmTmT.",
    "...bbbbbbbbbbbbbb.",
    "....bbbbbbbbbbb...",
    "......bbbbbbb....."], angPal);
  const vipPal = { b: "#1f3150", r: "#4f73a6", t: "#2b4369", e: "#c4e8fb", F: "#e6f1fa", L: [LUME, 0.9, "#2f6f7c"], d: "#5a80b4", j: "#16233a" };
  A.viper = art([
    "...................d......",
    ".....rrrrrrrrrrrrrrdrrr...",
    "tt.rbbbbbbbbbbbbbbbbbbbbr.",
    ".ttbbbbbbbbbbbbbbbbbbbebbF",
    "tt.bLbbLbbLbbLbbLbbLbjjFjF",
    ".....................bbbF."], vipPal);
  A.shark = shape(96, 26, g => {
    const c = "#1a2a42";
    poly(g, [[14, 13], [24, 10], [40, 7.4], [58, 6.4], [74, 7], [86, 9], [93, 12], [95.4, 14.4], [93, 17], [86, 18.6], [72, 19.6], [54, 19.4], [38, 18], [24, 16]], c);
    poly(g, [[0, 2], [6, 6], [15, 12.4], [15, 15], [8, 17.6], [3, 24], [5, 15.4], [4, 10.4]], c);   // tail
    poly(g, [[50, 7], [54, 3.4], [59, 6.6]], c); poly(g, [[30, 9], [33, 6.4], [36, 8.4]], c);       // small dorsal fins, set far back
    poly(g, [[66, 18.6], [72, 19.4], [64, 25], [62, 24]], c); poly(g, [[38, 17.6], [42, 18.2], [37, 21.6]], c); // pectoral, pelvic
    over(g, () => { g.fillStyle = "#2b4062"; g.fillRect(0, 0, 96, 9); g.fillStyle = "#101c30"; g.fillRect(0, 17, 96, 9); });
    px(g, 89, 12, "#6f8fb5"); px(g, 80, 13, "#101c30"); px(g, 80, 15, "#101c30"); px(g, 78, 14, "#101c30");
  });
  const snaPal = { h: "rgba(233,241,250,.92)", b: "rgba(208,223,240,.82)", f: "rgba(180,204,232,.36)", e: "#1a2334", t: "rgba(208,223,240,.55)", p: "rgba(240,214,214,.5)" };
  A.snail = art([
    ".........fffffhhhh..",
    ".....ffffbbbbhhhhhh.",
    "tttttttbbbbbbphhhehh",
    ".....ffffbbbbhhhhhh.",
    ".........fffff.hh..."], snaPal);
  // The three great squid. Mantle, fins and head are sprites; arms and tentacles are drawn live so they trail and sway.
  A.giant = shape(46, 13, (g, L) => {
    poly(g, [[10, 6.5], [14, 3.4], [26, 2.4], [36, 3.6], [42, 5.4], [46, 6.5], [42, 7.6], [36, 9.4], [26, 10.6], [14, 9.6]], "#2a3a55");
    poly(g, [[34, 3.6], [39, 0], [45, 5.6]], "#3a4f72"); poly(g, [[34, 9.4], [39, 13], [45, 7.4]], "#3a4f72");   // arrow-shaped fins at the tip
    poly(g, [[4, 6.5], [7, 4], [11, 4.4], [11, 8.6], [7, 9]], "#243450");                                         // head
    over(g, () => { g.fillStyle = "#4a6188"; g.fillRect(0, 0, 46, 4); g.fillStyle = "#1a2740"; g.fillRect(0, 9, 46, 4); });
    ell(g, 7.5, 6.5, 2, 2, "#d9ecff"); px(g, 7, 6, "#0b1019"); L.push([7, 5, "#d9ecff", 0.5]);
    for (let x = 14; x < 44; x += 3) L.push([x, x < 36 ? 2 : 4, "#7f9cc4", 0.22]);                                 // a faint rim so it reads in the dark
  });
  A.colossal = shape(74, 30, (g, L) => {
    poly(g, [[14, 15], [18, 8], [30, 5], [46, 5.4], [58, 8], [68, 12.4], [74, 15], [68, 17.6], [58, 22], [46, 24.6], [30, 25], [18, 22]], "#2b3852");
    poly(g, [[44, 5.4], [56, 0], [70, 9], [72, 14]], "#394b6c"); poly(g, [[44, 24.6], [56, 30], [70, 21], [72, 16]], "#394b6c"); // broad paddle fins
    poly(g, [[4, 15], [8, 9.6], [15, 9], [15, 21], [8, 20.4]], "#253350");
    over(g, () => { g.fillStyle = "#4c618a"; g.fillRect(0, 0, 74, 9); g.fillStyle = "#192540"; g.fillRect(0, 21, 74, 9); });
    ell(g, 9.5, 15, 3.4, 3.4, "#e3f1ff"); ell(g, 9.5, 15, 1.6, 1.6, "#0a0f18"); L.push([8, 13, "#e3f1ff", 0.7], [10, 13, "#e3f1ff", 0.35]);
    for (let x = 20; x < 70; x += 4) L.push([x, x < 46 ? 5 : x < 58 ? 3 : 8, "#7f9cc4", 0.22]);
  });
  A.bigfin = shape(21, 15, (g, L) => {
    poly(g, [[10.5, 0], [13, 3], [14, 9], [12.6, 14], [8.4, 14], [7, 9], [8, 3]], "#c3d1e2");                   // mantle, tip up
    poly(g, [[8, 2], [0, 5], [1, 9], [7.4, 9]], "#a9bbd2"); poly(g, [[13, 2], [21, 5], [20, 9], [13.6, 9]], "#a9bbd2"); // the big fins
    over(g, () => { g.fillStyle = "#e4eef8"; g.fillRect(9, 0, 2, 12); g.fillStyle = "#8ea3be"; g.fillRect(0, 8, 21, 1); });
    px(g, 8, 12, "#18202e"); px(g, 12, 12, "#18202e");
    L.push([10, 1, "#cfe0f2", 0.3], [2, 6, "#cfe0f2", 0.2], [18, 6, "#cfe0f2", 0.2]);
  });

  // ---------- Movement helpers ----------
  // Swim along, re-entering from the far side once out of sight. "gap" is extra distance out of view, so a lone
  // animal passes now and then rather than circling constantly.
  function cruise(c, dt, E, speed, gap = 0) {
    c.x += c.dir * speed * (1 - 0.5 * E.calm) * dt;
    const m = c.len + 6;
    if (c.dir > 0 && c.x > E.hi + m + gap) { c.x = E.lo - m; if (c.rehome) c.rehome(E); }
    else if (c.dir < 0 && c.x < E.lo - m - gap) { c.x = E.hi + m; if (c.rehome) c.rehome(E); }
    else if (c.x > E.hi + m + gap + 40 || c.x < E.lo - m - gap - 40) c.x = c.dir > 0 ? E.lo - m : E.hi + m; // the view changed: come back in
  }
  // Keep clear of the annotation: ease above or below it, and back once it has gone.
  function clear(c, dt, E, y, half) {
    const a = E.avoid; let target = 0;
    if (a && c.pf === 1 && c.x + c.len > a.l && c.x - c.len < a.r && y + half > a.t && y - half < a.b) target = y < (a.t + a.b) / 2 ? a.t - half - y : a.b + half - y;
    c.oy += (target - c.oy) * Math.min(1, dt * (target ? 1.6 : 0.5));
    return c.oy;
  }

  // ---------- The species ----------
  // zone: the game depths (metres) it keeps to. real: where the animal actually lives. n: how many share a wide
  // screen. Each animal is { x, y, dir, ... } in artwork pixels; step() moves it, draw() paints it.
  const SPECIES = [];
  const define = def => SPECIES.push(def);
  const spawn = (E, r, extra) => ({ x: E.lo + r() * (E.hi - E.lo), dir: r() < 0.5 ? -1 : 1, ph: r() * TAU, oy: 0, pf: 1, len: 8, ...extra });
  const inZone = (zone, r, pad = 0) => yM(zone[0] + pad + r() * Math.max(1, zone[1] - zone[0] - pad * 2));

  define({ key: "auk", name: "Little auk", latin: "Alle alle", zone: [-80, -30], real: "Arctic seabird; dives to about 30 m for plankton", band: "surface", layer: "back", n: 1,
    make: (E, r) => ({ ...spawn(E, r, { len: 14 }), y: W - 60 - r() * 60, birds: Array.from({ length: 4 }, (_, i) => ({ ox: -i * 9 - r() * 4, oy: (i % 2 ? 1 : -1) * (2 + r() * 5) * (i ? 1 : 0), ph: r() * TAU })) }),
    step: (c, dt, E) => cruise(c, dt, E, 20, 260),
    draw: (c, D) => c.birds.forEach(b => { const s = A.auk[Math.floor(D.t * 7 + b.ph) % 2]; blit(D.g, s, D.X(c.x + b.ox * c.dir), D.Y(c.y + b.oy + Math.sin(D.t * 1.3 + b.ph) * 1.5), c.dir); }) });

  define({ key: "seal", name: "Harp seal", latin: "Pagophilus groenlandicus", zone: [4, 30], real: "Arctic and North Atlantic pack ice; usually above 100 m, dives to about 400 m", band: "surface", layer: "back", n: 1,
    make: (E, r) => ({ ...spawn(E, r, { len: 20 }), y0: yM(8 + r() * 14) }),
    step: (c, dt, E) => { cruise(c, dt, E, 15, 180); c.y = c.y0 + Math.sin(D_t(E) * 0.5 + c.ph) * 7 + clear(c, dt, E, c.y0, 9); },
    draw: (c, D) => blit(D.g, A.seal, D.X(c.x - 18), D.Y(c.y - 6), c.dir, { amp: 1.3, k: 2.6, ph: D.t * 3.4 + c.ph, from: 0.35 }, D.a) });

  // A school keeps formation around a lead point; each fish wanders a little inside it.
  const school = (key, name, latin, zone, real, sprites, n, spread, speed, layer, extra = {}) => define({ key, name, latin, zone, real, band: extra.band || "surface", layer, n: extra.n || 1, lit: extra.lit,
    make: (E, r) => ({ ...spawn(E, r, { len: spread[0] + 6 }), y0: inZone(zone, r, 4), fish: Array.from({ length: n }, () => ({ ox: (r() * 2 - 1) * spread[0], oy: (r() * 2 - 1) * spread[1], ph: r() * TAU, v: 0.6 + r() * 0.8 })) }),
    step: (c, dt, E) => { cruise(c, dt, E, speed, extra.gap || 40); c.y = c.y0 + Math.sin(D_t(E) * 0.23 + c.ph) * 6 + clear(c, dt, E, c.y0, spread[1] + 4); },
    draw: (c, D) => c.fish.forEach((f, i) => {
      if (D.low && i % 2) return;
      const s = sprites[Math.floor(D.t * 6 * f.v + f.ph) % 2], x = D.X(c.x + (f.ox + Math.sin(D.t * 0.5 * f.v + f.ph) * 3) * c.dir - s.w / 2), y = D.Y(c.y + f.oy + Math.sin(D.t * 0.8 * f.v + f.ph * 2) * 1.6 - 1);
      blit(D.g, s, x, y, c.dir, null, D.a);
      if (extra.lit) dots(D, s, x, y, c.dir, (0.5 + 0.5 * Math.sin(D.t * 1.7 + f.ph)) * D.a);
    }) });
  school("capelin", "Capelin", "Mallotus villosus", [6, 46], "Arctic and subarctic shoals; surface to about 300 m", A.capelin, 16, [22, 8], 13, "front");
  school("cod", "Polar cod", "Boreogadus saida", [2, 34], "Under Arctic sea ice, where it hides in cracks; surface to about 400 m", A.cod, 5, [16, 6], 8, "back");

  define({ key: "krill", name: "Arctic krill", latin: "Thysanoessa inermis", zone: [10, 60], real: "Swarms in the upper few hundred metres, rising at night", band: "surface", layer: "front", n: 1,
    make: (E, r) => ({ ...spawn(E, r, { len: 26 }), y0: inZone([10, 60], r, 6), bits: Array.from({ length: 26 }, () => ({ ox: (r() * 2 - 1) * 24, oy: (r() * 2 - 1) * 9, ph: r() * TAU, v: 0.7 + r() })) }),
    step: (c, dt, E) => { cruise(c, dt, E, 3.5, 30); c.y = c.y0 + Math.sin(D_t(E) * 0.15 + c.ph) * 5 + clear(c, dt, E, c.y0, 12); },
    draw: (c, D) => c.bits.forEach((b, i) => {
      if (D.low && i % 2) return;
      const x = D.X(c.x + b.ox + Math.sin(D.t * 1.6 * b.v + b.ph) * 2.4), y = D.Y(c.y + b.oy + Math.cos(D.t * 1.3 * b.v + b.ph) * 1.6);
      px(D.g, x, y, "#e2c8c0", 0.75 * D.a); px(D.g, x - c.dir, y + 1, "#c9aca6", 0.5 * D.a);
    }) });

  // Jellies pulse: a squeeze lifts them, then they sink slowly back.
  const pulse = (t, ph, period) => { const u = ((t + ph) % period) / period; return u < 0.28 ? Math.sin(u / 0.28 * Math.PI) : 0; };
  // A jellyfish bell seen from the side: a dome that narrows and deepens as it squeezes, a bright rim, a fringe.
  function bell(g, x, y, rx, ry, a, body, rim, fringe) {
    g.fillStyle = body; g.globalAlpha = a;
    for (let j = Math.ceil(-ry); j <= 0; j++) { const half = rx * Math.sqrt(Math.max(0, 1 - (j / ry) ** 2)); g.fillRect(Math.round(x - half), y + j, Math.max(1, Math.round(half * 2)), 1); }
    g.globalAlpha = 1;
    const n = Math.round(rx);
    for (let i = -n; i <= n; i++) px(g, x + i, y - Math.round(ry * Math.sqrt(Math.max(0, 1 - (i / (rx + 0.4)) ** 2))), rim, a * (Math.abs(i) === n ? 0.6 : 0.95));
    for (let i = -n + 1; i < n; i += 2) px(g, x + i, y + 1, fringe, a * 0.7);
  }
  define({ key: "moon", name: "Moon jelly", latin: "Aurelia aurita", zone: [8, 62], real: "Coastal seas worldwide, mostly near the surface", band: "surface", layer: "mix", n: 4,
    make: (E, r) => ({ ...spawn(E, r, { len: 6 }), y0: inZone([8, 62], r, 4), per: 2.2 + r() * 0.8 }),
    step: (c, dt, E) => { cruise(c, dt, E, 1.1); c.sq = pulse(D_t(E), c.ph, c.per); c.y = c.y0 + Math.sin(D_t(E) * 0.2 + c.ph) * 5 - c.sq * 2 + clear(c, dt, E, c.y0, 6); },
    draw: (c, D) => {
      const g = D.g, x = D.X(c.x), y = D.Y(c.y), rx = 5 - c.sq * 1.5, ry = 3.4 + c.sq * 1.3;
      for (const dx of [-1, 1]) { px(g, x + dx, y + 2, "#cfe6f8", 0.55 * D.a); px(g, x + dx + Math.round(Math.sin(D.t * 1.6 + c.ph + dx) * 0.6), y + 3, "#cfe6f8", 0.4 * D.a); }
      bell(g, x, y, rx, ry, D.a, "rgba(140,196,240,.36)", "rgba(214,238,255,.9)", "rgba(190,226,255,.7)");
      for (const [dx, dy] of [[-2, -1], [1, -1], [-2, -2], [1, -2]]) px(g, x + dx + (dx < 0 ? 0 : 0), y + dy - Math.round(c.sq), "rgba(236,247,255,.75)", D.a); // the four rings it is known by
    } });

  school("lantern", "Lanternfish", "Benthosema glaciale", [48, 112], "The glacier lanternfish; 300 to 1,000 m by day, rising at night", A.lantern, 9, [26, 9], 9, "front", { band: "mid", lit: true });

  define({ key: "comb", name: "Arctic comb jelly", latin: "Mertensia ovum", zone: [44, 108], real: "Arctic waters, surface to several hundred metres", band: "mid", layer: "mix", n: 3,
    make: (E, r) => ({ ...spawn(E, r, { len: 6 }), y0: inZone([44, 108], r, 4) }),
    step: (c, dt, E) => { cruise(c, dt, E, 1.4); c.y = c.y0 + Math.sin(D_t(E) * 0.3 + c.ph) * 6 + clear(c, dt, E, c.y0, 8); },
    draw: (c, D) => {
      const x = D.X(c.x - 3), y = D.Y(c.y - 4), g = D.g;
      ell(g, x + 3.5, y + 4.5, 3.5, 4.6, "rgba(150,205,245,.3)", D.a); ell(g, x + 3.5, y + 4.5, 2.2, 3.4, "rgba(205,234,255,.2)", D.a);
      px(g, x + 3, y, "rgba(215,238,255,.8)", D.a); px(g, x + 3, y + 8, "rgba(215,238,255,.6)", D.a);
      // The comb rows: a ripple of light running down each one.
      for (let row = 0; row < 3; row++) for (let i = 0; i < 7; i++) {
        const k = ((D.t * 7 + row * 2.3 + c.ph * 3 - i) % 7 + 7) % 7, a = k < 1 ? 1 : k < 2 ? 0.5 : 0.14;
        px(g, x + 1 + row * 2 + (row === 1 ? 0.5 : 0), y + 1 + i, "#d9f3ff", a * 0.85 * D.a);
        if (k < 1) light(D, x + 1 + row * 2, y + 1 + i, LUME_B, 0.5 * D.a);
      }
      // Two long fishing tentacles trail behind.
      limb(g, x + 2, y + 8, 12, Math.PI / 2 + 0.25 * c.dir, 0.5, D.t * 1.4 + c.ph, "#bfe2f8", 0.5 * D.a);
      limb(g, x + 5, y + 8, 9, Math.PI / 2 + 0.4 * c.dir, 0.5, D.t * 1.4 + c.ph + 1, "#bfe2f8", 0.4 * D.a);
    } });

  define({ key: "mane", name: "Lion's mane jellyfish", latin: "Cyanea capillata", zone: [56, 118], real: "Cold northern seas, mostly in the upper 20 m; the largest known jellyfish", band: "mid", layer: "back", n: 1,
    make: (E, r) => ({ ...spawn(E, r, { len: 12 }), y0: inZone([56, 118], r, 14), per: 3.4 }),
    step: (c, dt, E) => { cruise(c, dt, E, 1.6, 60); c.sq = pulse(D_t(E), c.ph, c.per); c.y = c.y0 + Math.sin(D_t(E) * 0.16 + c.ph) * 8 - c.sq * 3 + clear(c, dt, E, c.y0, 18); },
    draw: (c, D) => {
      const g = D.g, x = D.X(c.x), y = D.Y(c.y), rx = 9 - c.sq * 2.4, ry = 5 + c.sq * 1.2, t = D.t;
      for (let i = 0; i < 9; i++) limb(g, x + (i - 4) * rx / 4.4, y + 2, 16 + (i * 7 % 5) * 3 - c.sq * 3, Math.PI / 2 + (i - 4) * 0.05, 0.42, t * 1.1 + c.ph + i * 0.7, "#a9c8e2", 0.34 * D.a);
      for (let i = 0; i < 4; i++) limb(g, x + (i - 1.5) * 2, y + 2, 9 + (i % 2) * 3, Math.PI / 2 + (i - 1.5) * 0.12, 0.3, t * 0.9 + c.ph + i, "#d8c2c4", 0.55 * D.a); // the frilled mouth arms, faintly warm
      bell(g, x, y, rx, ry, D.a, "rgba(120,170,215,.44)", "rgba(214,236,255,.85)", "rgba(200,228,250,.6)");
      for (let i = -2; i <= 2; i++) px(g, x + i, y - Math.round(ry * 0.45) - (Math.abs(i) < 2 ? 1 : 0), "rgba(204,170,176,.5)", D.a);   // a faintly warm heart
      for (let i = -1; i <= 1; i++) px(g, x + i, y - Math.round(ry * 0.45) + 1, "rgba(204,170,176,.36)", D.a);
    } });

  define({ key: "siph", name: "Siphonophore", latin: "Marrus orthocanna", zone: [70, 150], real: "Arctic and cold deep water, about 200 to 2,000 m; a colony that hunts as one long chain", band: "mid", layer: "back", n: 1, lit: true,
    make: (E, r) => ({ ...spawn(E, r, { len: 44 }), y0: inZone([70, 150], r, 8) }),
    step: (c, dt, E) => { cruise(c, dt, E, 4.2, 50); c.y = c.y0 + Math.sin(D_t(E) * 0.2 + c.ph) * 7 + clear(c, dt, E, c.y0, 12); },
    draw: (c, D) => {
      const g = D.g, N = 20, t = D.t, run = (t * 5 + c.ph * 3) % (N + 8);
      for (let i = 0; i < N; i++) {
        const x = D.X(c.x - c.dir * i * 2.3), y = D.Y(c.y + Math.sin(t * 1.3 + c.ph - i * 0.42) * (1 + i * 0.17) + i * 0.45);
        px(g, x, y, i < 5 ? "#e6f3fc" : "#bcd9ee", (i < 5 ? 0.9 : 0.62) * D.a);
        if (i < 5) px(g, x, y + 1, "#bcd9ee", 0.5 * D.a);                                   // the swimming bells at the front
        else if (i % 3 === 0) { px(g, x, y + 1, "#a5c6e0", 0.45 * D.a); px(g, x - c.dir, y + 2 + ((t * 2 + i) & 1), "#a5c6e0", 0.3 * D.a); } // feeding tentacles
        const d = Math.abs(i - run); if (d < 2.5) light(D, x, y, LUME, (1 - d / 2.5) * 0.9 * D.a);   // a pulse of light runs down the chain
      }
      px(g, D.X(c.x + c.dir * 2), D.Y(c.y + Math.sin(t * 1.3 + c.ph) - 1), "#f2f9ff", 0.95 * D.a); px(g, D.X(c.x + c.dir), D.Y(c.y + Math.sin(t * 1.3 + c.ph) - 1), "#f2f9ff", 0.8 * D.a); // the float
    } });

  define({ key: "squid", name: "Armhook squid", latin: "Gonatus fabricii", zone: [60, 140], real: "The Arctic's commonest squid; young near the surface, adults to about 2,700 m", band: "mid", layer: "back", n: 2,
    make: (E, r) => ({ ...spawn(E, r, { len: 14 }), y0: inZone([60, 140], r, 6), per: 1.9 + r() * 0.5 }),
    // Jet propulsion: a squeeze of the mantle, a surge, a glide.
    step: (c, dt, E) => { c.sq = pulse(D_t(E), c.ph, c.per); cruise(c, dt, E, 5 + c.sq * 15, 50); c.y = c.y0 + Math.sin(D_t(E) * 0.25 + c.ph) * 7 + clear(c, dt, E, c.y0, 6); },
    draw: (c, D) => {
      const x = D.X(c.x - 8), y = D.Y(c.y - 3), bx = c.dir > 0 ? x + 4 : x + 12, back = c.dir > 0 ? Math.PI : 0;
      for (let i = 0; i < 5; i++) limb(D.g, bx, y + 2 + (i % 3), 6 + (i % 2) * 2 - c.sq * 1.5, back + (i - 2) * 0.16 * (1 - c.sq * 0.8), 0.35 * (1 - c.sq), D.t * 2.2 + c.ph + i, "#7f93ab", 0.85 * D.a);
      blit(D.g, A.squid, x, y, c.dir, null, D.a);
    } });

  define({ key: "angler", name: "Humpback anglerfish", latin: "Melanocetus johnsonii", zone: [112, 196], real: "Open ocean worldwide, about 200 to 1,500 m; the lure is lit by bacteria", band: "deep", layer: "back", n: 2, lit: true,
    make: (E, r) => ({ ...spawn(E, r, { len: 10 }), y0: inZone([112, 196], r, 6) }),
    step: (c, dt, E) => { cruise(c, dt, E, 2.6, 30); c.y = c.y0 + Math.sin(D_t(E) * 0.35 + c.ph) * 4 + clear(c, dt, E, c.y0, 8); },
    draw: (c, D) => {
      const x = D.X(c.x - 9), y = D.Y(c.y - 6), s = A.angler;
      blit(D.g, s, x, y, c.dir, { amp: 0.8, k: 2.2, ph: D.t * 2.2 + c.ph, from: 0.62 }, D.a);
      const glow = 0.55 + 0.45 * Math.sin(D.t * 1.5 + c.ph), lx = x + (c.dir < 0 ? s.w - 1 - 15 : 15);
      halo(D, lx, y, LUME_B, glow * D.a, 3);
    } });

  define({ key: "viper", name: "Sloane's viperfish", latin: "Chauliodus sloani", zone: [124, 200], real: "Deep open ocean, about 200 to 1,800 m; lights run along its belly", band: "deep", layer: "back", n: 2, lit: true,
    make: (E, r) => ({ ...spawn(E, r, { len: 14 }), y0: inZone([124, 200], r, 4) }),
    step: (c, dt, E) => { cruise(c, dt, E, 7, 60); c.y = c.y0 + Math.sin(D_t(E) * 0.3 + c.ph) * 5 + clear(c, dt, E, c.y0, 5); },
    draw: (c, D) => {
      const x = D.X(c.x - 13), y = D.Y(c.y - 3), w = { amp: 1.1, k: 4, ph: D.t * 4 + c.ph, from: 0.25 };
      blit(D.g, A.viper, x, y, c.dir, w, D.a);
      for (const [lx, ly, col, k] of A.viper.lights) { const u = 1 - lx / 25, dy = Math.round(Math.sin(w.ph - u * w.k) * w.amp * Math.max(0, (u - 0.25) / 0.75)); light(D, x + (c.dir < 0 ? 25 - lx : lx), y + ly + dy, col, k * (0.5 + 0.5 * Math.sin(D.t * 1.2 + lx)) * D.a); }
    } });

  define({ key: "dumbo", name: "Dumbo octopus", latin: "Grimpoteuthis", zone: [140, 232], real: "Deep sea floors worldwide, about 1,000 to 7,000 m; it flies with its ear-like fins", band: "deep", layer: "back", n: 2,
    make: (E, r) => ({ ...spawn(E, r, { len: 8 }), y0: inZone([140, 232], r, 6) }),
    step: (c, dt, E) => { cruise(c, dt, E, 2.2, 40); c.y = c.y0 - Math.cos(D_t(E) * 0.9 + c.ph) * 2 + Math.sin(D_t(E) * 0.18 + c.ph) * 6 + clear(c, dt, E, c.y0, 8); },
    draw: (c, D) => {
      const g = D.g, x = D.X(c.x), y = D.Y(c.y), flap = Math.sin(D.t * 0.9 + c.ph), a = D.a;
      poly(g, [[x - 3.6, y + 1], [x + 4.6, y + 1], [x + 6.6, y + 5.6], [x - 5.6, y + 5.6]], "#a2b5cd", a);            // the webbed skirt of arms
      for (let i = -5; i <= 5; i += 2) px(g, x + i + (i > 0 ? 1 : 0), y + 6 + (((i + 5) / 2) & 1), "#8499b5", a);
      ell(g, x + 0.5, y - 1, 4.8, 4.4, "#c3d1e2", a); ell(g, x - 0.6, y - 2.6, 2.6, 1.7, "#e3edf6", a);                // the rounded mantle
      px(g, x - 3, y + 1, "#141c2a", a); px(g, x + 3, y + 1, "#141c2a", a);
      for (const sgn of [-1, 1]) {                                                                                     // the "ears": fins that row it along
        const bx = x + (sgn < 0 ? -4 : 5), by = y - 3, tx = bx + sgn * 4, ty = by - Math.round(flap * 2.4) - 1;
        stroke(g, bx, by, tx, ty, "#b3c4d9", a); stroke(g, bx, by + 1, tx, ty + 1, "#b3c4d9", a); stroke(g, bx, by + 2, tx - sgn, ty + 2, "#96aac4", a);
      }
    } });

  define({ key: "shark", name: "Greenland shark", latin: "Somniosus microcephalus", zone: [150, 250], real: "Arctic and North Atlantic, surface to about 2,200 m; it can live for centuries", band: "deep", layer: "back", far: 0.72, n: 1,
    make: (E, r) => ({ ...spawn(E, r, { len: 50, pf: 0.72 }), y0: inZone([150, 250], r, 12) }),
    step: (c, dt, E) => { cruise(c, dt, E, 5.5, 520); c.y = c.y0 + Math.sin(D_t(E) * 0.1 + c.ph) * 8; },
    draw: (c, D) => blit(D.g, A.shark, D.X(c.x - 48), D.Y(c.y - 13), c.dir, { amp: 2.2, k: 2.4, ph: D.t * 1.5 + c.ph, from: 0.3 }, 0.6 * D.a) });

  define({ key: "snail", name: "Hadal snailfish", latin: "Pseudoliparis swirei", zone: [222, 300], real: "The Mariana Trench, about 6,000 to 8,000 m; the deepest fish ever filmed", band: "abyss", layer: "back", n: 3,
    make: (E, r) => ({ ...spawn(E, r, { len: 10 }), y0: inZone([222, 300], r, 4) }),
    step: (c, dt, E) => { cruise(c, dt, E, 3.6, 30); c.y = c.y0 + Math.sin(D_t(E) * 0.4 + c.ph) * 3 + clear(c, dt, E, c.y0, 5); },
    draw: (c, D) => { const x = D.X(c.x - 10), y = D.Y(c.y - 2); blit(D.g, A.snail, x, y, c.dir, { amp: 1.5, k: 4.4, ph: D.t * 3.2 + c.ph, from: 0.3 }, D.a); light(D, x + (c.dir < 0 ? 4 : 15), y + 2, "#dbe9f7", 0.16 * D.a); } });

  define({ key: "spark", name: "Glowing plankton", latin: "Metridia longa", zone: [190, 330], real: "A copepod of cold deep water that flashes blue when disturbed", band: "abyss", layer: "back", n: 1, lit: true,
    make: (E, r) => ({ ...spawn(E, r, { len: 0 }), x: 0, sparks: Array.from({ length: 16 }, () => ({ fx: r(), fy: r(), ph: r() * 40, per: 5 + r() * 9 })) }),
    step: () => {},
    draw: (c, D) => c.sparks.forEach((s, i) => {
      if (D.low && i % 2) return;
      const u = ((D.t + s.ph) % s.per) / s.per, n = Math.floor((D.t + s.ph) / s.per); if (u > 0.16) return;
      const jx = Math.sin(n * 12.9898 + i) * 0.5 + 0.5, jy = Math.sin(n * 78.233 + i * 3) * 0.5 + 0.5; // a new place every flash
      light(D, D.X(D.E.lo + ((s.fx + jx) % 1) * (D.E.hi - D.E.lo)), D.Y(yM(190 + ((s.fy + jy) % 1) * 140)), LUME, Math.sin(u / 0.16 * Math.PI) * 0.85);
    }) });

  // ---------- Encounters: the great squid ----------
  // Each is tied to a depth an answer has to reach. They pass behind the iceberg, slowly, and are not seen otherwise.
  const squidArms = (D, g, c, x, y, n, len, tent, col, a) => {
    const back = c.dir > 0 ? Math.PI : 0, t = D.t;
    for (let i = 0; i < n; i++) limb(g, x, y + (i - (n - 1) / 2) * 0.9, len * (0.8 + (i * 5 % 4) * 0.08), back + (i - (n - 1) / 2) * 0.09, 0.3, t * 1.3 + c.ph + i * 0.8, col, a);
    if (tent) for (let i = 0; i < 2; i++) {
      const [ex, ey] = limb(g, x, y + (i ? 1.5 : -1.5), tent, back + (i ? 0.07 : -0.07), 0.22, t * 0.9 + c.ph + i * 2, col, a * 0.9);
      stroke(g, ex, ey - 1, ex - c.dir * 4, ey - 1, col, a * 0.8); stroke(g, ex, ey + 1, ex - c.dir * 4, ey + 1, col, a * 0.8);   // the clubs
    }
  };
  const ENCOUNTERS = [
    { key: "giant", name: "Giant squid", latin: "Architeuthis dux", min: 200, real: "Deep ocean worldwide, about 300 to 1,000 m; first filmed alive in 2004", line: "A giant squid passes below",
      start: (c, E, at, side) => { c.dir = -side; c.x = side > 0 ? at.hi + 52 : at.lo - 30; c.y0 = at.below + 10; c.len = 80; c.speed = 20; },
      step: (c, dt, E) => { c.sq = pulse(D_t(E), c.ph, 3.2); c.x += c.dir * (c.speed * 0.55 + c.sq * c.speed) * dt; c.y = c.y0 + Math.sin(D_t(E) * 0.22 + c.ph) * 6; },
      draw: (c, D) => {
        const x = D.X(c.x - 23), y = D.Y(c.y - 6), hx = c.dir > 0 ? x + 4 : x + 41;
        squidArms(D, D.g, c, hx, y + 6, 8, 20, 46, "#2c3d5a", 0.9 * D.a);
        blit(D.g, A.giant, x, y, c.dir, null, D.a); lights(D, A.giant, x, y, c.dir, D.a);
      } },
    { key: "bigfin", name: "Bigfin squid", latin: "Magnapinna", min: 250, real: "Seen only a few dozen times, about 1,000 to 6,000 m; its arms hang metres below it from sharp 'elbows'", line: "A bigfin squid hangs in the dark",
      start: (c, E, at, side) => { const sp = I.iceSpan(at.y); c.dir = 1; c.x = Math.max(at.lo + 16, Math.min(at.hi - 16, at.x + side * (at.stacked ? 34 : 50 + (sp ? (sp[1] - sp[0]) / 2 : 0)))); c.y0 = at.stacked ? at.below + 2 : Math.max(at.top + 4, at.y - 44); c.len = 24; c.hover = true; },
      step: (c, dt, E) => { c.x += Math.sin(D_t(E) * 0.13 + c.ph) * 0.8 * dt; c.y0 -= 0.35 * dt; c.y = c.y0 + Math.sin(D_t(E) * 0.5 + c.ph) * 2; },
      draw: (c, D) => {
        const g = D.g, x = D.X(c.x - 10), y = D.Y(c.y), t = D.t, flap = Math.round(Math.sin(t * 1.1 + c.ph));
        // Ten arms: each runs straight out to an elbow, then drops, very long and very thin.
        for (let i = 0; i < 10; i++) {
          const k = (i - 4.5) / 4.5, ex = x + 10 + k * 17, ey = y + 16 + Math.abs(k) * 1.5 + Math.sin(t * 0.7 + i) * 0.6;
          stroke(g, x + 10 + k * 2, y + 14, ex, ey, "#b7c7da", 0.7 * D.a);
          limb(g, ex, ey, 60 + (i * 7 % 5) * 6, Math.PI / 2, 0.1, t * 0.5 + c.ph + i * 0.9, "#b7c7da", 0.5 * D.a);
          light(D, Math.round(ex), Math.round(ey), "#cfe0f2", 0.16 * D.a);
        }
        blit(g, A.bigfin, x, y + flap, 1, null, D.a); lights(D, A.bigfin, x, y + flap, 1, D.a);
      } },
    { key: "colossal", name: "Colossal squid", latin: "Mesonychoteuthis hamiltoni", min: 300, real: "The Southern Ocean, about 1,000 to 2,000 m; the heaviest invertebrate, with the largest eyes of any animal", line: "A colossal squid rises out of the dark",
      start: (c, E, at, side) => { c.dir = -side; c.x = side > 0 ? at.hi + 70 : at.lo - 42; c.y0 = at.below + 54; c.level = at.below + 20; c.len = 110; c.speed = 15; },
      step: (c, dt, E) => { c.sq = pulse(D_t(E), c.ph, 4); c.x += c.dir * (c.speed * 0.6 + c.sq * c.speed) * dt; c.y0 = Math.max(c.level, c.y0 - 3 * dt); c.y = c.y0 + Math.sin(D_t(E) * 0.18 + c.ph) * 5; },
      draw: (c, D) => {
        const x = D.X(c.x - 37), y = D.Y(c.y - 15), hx = c.dir > 0 ? x + 4 : x + 69;
        squidArms(D, D.g, c, hx, y + 15, 8, 30, 52, "#2a3854", 0.92 * D.a);
        blit(D.g, A.colossal, x, y, c.dir, null, D.a); lights(D, A.colossal, x, y, c.dir, D.a);
      } },
  ];
  const D_t = E => E.t;

  // ---------- One question's water ----------
  function create(berg, opts = {}) {
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const cv = berg.life, ctx = { back: cv.back.getContext("2d"), front: cv.front.getContext("2d"), lume: cv.lume.getContext("2d") };
    let low = !!opts.low, animals = [], guests = [], inView = [], made = 0, seed = 1, raf = 0, last = 0, t = 0, calm = 0, calmUntil = 0, built = "", cost = 0, frames = 0, auto = false;
    const seen = new Map(), handlers = { sight: () => {} };
    const E = { lo: 0, hi: 0, calm: 0, avoid: null, t: 0 };
    let rs = 1; const rnd = () => (rs = (rs * 16807) % 2147483647) / 2147483647;

    function range(v) { const bx = (v.x0 - mod(v.x0, v.u)) / v.u + 1; E.lo = -bx - 24; E.hi = -bx + cv.back.width + 24; return bx; }
    const mod = (a, n) => ((a % n) + n) % n;
    // Fill the water for this question. The same seed always gives the same animals in the same places.
    function populate() {
      const v = berg.view; range(v);
      rs = seed; animals = []; made++;
      const wide = Math.max(0.55, Math.min(1.5, (E.hi - E.lo) / 520));
      SPECIES.forEach(sp => {
        const n = Math.max(1, Math.round(sp.n * wide * (low && sp.n > 1 ? 0.5 : 1)));
        for (let i = 0; i < n; i++) { const c = sp.make(E, rnd); c.sp = sp; c.layer = sp.layer === "mix" ? (i % 2 ? "front" : "back") : sp.layer; animals.push(c); }
      });
      built = v.w + "x" + v.u + ":" + low;
      // Let everything settle into motion before it is first seen.
      for (let i = 0; i < 30; i++) step(0.4);
    }
    function step(dt) {
      t += dt; E.t = t; E.calm = calm;
      for (const c of animals) c.sp.step(c, dt, E);
      for (const c of guests) { c.age += dt; c.sp.step(c, dt, E); }
      guests = guests.filter(c => c.age < c.life && c.x > E.lo - 260 && c.x < E.hi + 260);
    }
    function draw() {
      const v = berg.view, u = v.u;
      const shown = v.settled && !document.hidden;
      for (const c of Object.values(cv)) c.style.opacity = v.settled ? 1 : 0;
      if (!shown) return;
      const t0 = performance.now();
      const ox = mod(v.x0, u), oy = mod(v.y0, u), bx = range(v), by = (v.y0 - oy) / u + 1;
      for (const k of ["back", "front", "lume"]) { cv[k].style.transform = `translate(${ox - u}px, ${oy - u}px)`; ctx[k].clearRect(0, 0, cv[k].width, cv[k].height); }
      // The annotation and its marker, in artwork pixels: animals steer round them and fade if they stray behind.
      const n = v.note;
      E.avoid = n ? { l: (n.l - v.x0) / u - 6, r: (n.r - v.x0) / u + 6, t: (n.t - v.y0) / u - 5, b: (n.b - v.y0) / u + 5 } : null;
      const top = -by - 40, bottom = top + cv.back.height + 80;
      const D = { t, low, E, L: ctx.lume, g: null, a: 1, X: x => Math.round(x) + bx, Y: null };
      // ghost: a second, faint copy on the light layer, so a great animal still shows as a shape in the dark.
      const paint = (c, ghost) => {
        const pf = c.pf || 1, yy = v.camY + (c.y - v.camY) * pf;
        if (c.sp.key !== "spark" && (yy < top - 80 || yy > bottom + 80)) return false;
        D.g = ctx[ghost ? "lume" : c.layer || "back"]; D.L = ghost ? null : ctx.lume; D.Y = y => Math.round(v.camY + (y - v.camY) * pf) + by;
        const a = E.avoid;
        // Behind the annotation an animal fades back; under the controls it all but disappears. Words always win.
        const sx = v.x0 + c.x * u, sy = v.y0 + yy * u, f = v.frame, ramp = d => Math.max(0, Math.min(1, d / 48));
        const open = c.sp.key === "spark" ? 1 : Math.min(ramp(sx - f.l + 40), ramp(v.w - f.r - sx + 40), ramp(sy - f.t + 30), ramp(v.h - f.b - sy + 30));
        D.a = (a && pf === 1 && !c.guest && c.x + c.len > a.l && c.x - c.len < a.r && c.y + 8 > a.t && c.y - 8 < a.b ? 0.3 : 1) * (c.fade != null ? c.fade : 1) * (ghost ? 0.85 : 1) * (0.2 + 0.8 * open);
        c.sp.draw(c, D);
        return yy > -by + 6 && yy < -by + cv.back.height - 6 && c.x > -bx + 4 && c.x < -bx + cv.back.width - 4;
      };
      if (guests.length) {
        for (const c of guests) { c.fade = Math.min(1, c.age / (c.hover ? 3 : 0.8), (c.life - c.age) / 3); paint(c); if (!low) paint(c, true); }
        // They pass behind the iceberg: cut its outline back out of the light layer.
        if (!low) for (let cy = 0; cy < cv.lume.height; cy++) { const sp = I.iceSpan(cy - by); if (sp) ctx.lume.clearRect(sp[0] + bx, cy, sp[1] - sp[0], 1); }
      }
      inView = [];
      for (const c of animals) if (paint(c) && c.sp.key !== "spark") { note(c.sp); if (!inView.includes(c.sp.key)) inView.push(c.sp.key); }
      // If drawing is slow on this device, quietly thin the water out.
      cost += performance.now() - t0; frames++;
      if (frames === 90) { if (!low && !auto && cost / frames > 7) { auto = true; low = true; populate(); } cost = 0; frames = 0; }
    }
    // A species counts as seen once it has been in view for a moment.
    function note(sp) {
      const s = seen.get(sp.key) || 0; if (s < 0) return;
      if (s + 1 >= 24) { seen.set(sp.key, -1); handlers.sight(sp); } else seen.set(sp.key, s + 1);
    }
    function loop(now) {
      raf = requestAnimationFrame(loop);
      const v = berg.view;
      if (cv.back.offsetParent === null) { last = now; return; } // the scene is not on screen (home, results): rest
      if (now - last < (low ? 48 : 31)) return;
      const dt = Math.min(0.1, (now - last) / 1000 || 0.033); last = now;
      if (built !== v.w + "x" + v.u + ":" + low) populate();
      calm += ((v.busy || now < calmUntil ? 1 : 0) - calm) * Math.min(1, dt * 3);
      step(dt); draw();
    }
    // Camera moved between our frames: redraw at once so the animals stay locked to the water.
    berg.onRender(() => { if (reduce || berg.view.busy || performance.now() - last > 20) { if (built !== berg.view.w + "x" + berg.view.u + ":" + low) populate(); draw(); } });

    const api = {
      // A new question: fresh water, the same every time for the same seed.
      reset(n) { seed = Math.max(1, Math.floor(n) % 2147483646); guests = []; seen.clear(); populate(); draw(); },
      // An answer has landed at this depth. Returns the animal that comes to meet it, if the depth earns one.
      encounterFor(depth, already = []) { let best = null; for (const e of ENCOUNTERS) if (depth >= e.min && !already.includes(e.key)) best = e; return best; },
      encounter(key, at) {
        const e = ENCOUNTERS.find(x => x.key === key); if (!e || guests.some(g => g.sp === e)) return null;
        const v = berg.view; range(v);
        // Arrive from the side with more open water, away from the annotation.
        const mid = (E.lo + E.hi) / 2, side = v.note ? ((v.note.l + v.note.r) / 2 > v.x0 + at.x * v.u ? -1 : 1) : (at.x > mid ? -1 : 1);
        const c = { sp: e, guest: true, layer: "back", pf: 1, ph: rnd() * TAU, oy: 0, age: reduce ? 4 : 0, life: e.key === "bigfin" ? 34 : 90, x: 0, y: 0, y0: 0, dir: 1, len: 40 };
        // Keep it clear of the words: below the annotation, and inside what the window shows.
        const u = v.u, where = { x: at.x, y: at.y, below: Math.max(at.y + 26, v.note ? (v.note.b - v.y0) / u + 8 : 0), stacked: !!v.note && v.note.t > v.y0 + at.y * u + 10, top: (v.frame.t - v.y0) / u, lo: (v.frame.l - v.x0) / u, hi: (v.w - v.frame.r - v.x0) / u - 30 };
        e.start(c, E, where, side);
        if (reduce) { if (!c.hover) c.x = at.x + side * 96; if (c.level) c.y0 = c.level; c.life = 1e9; } // no motion: it is simply there, beside the answer
        c.y = c.y0; guests.push(c); if (reduce) draw();
        return e;
      },
      calm(ms) { calmUntil = performance.now() + ms; },
      setLow(v) { low = !!v; auto = true; populate(); draw(); },
      get low() { return low; },
      onSight(f) { handlers.sight = f; },
      get count() { return animals.length; }, get guests() { return guests.map(g => g.sp.key); },
      // For checks and tuning: what is in view, how long drawing takes, and how many times the water has been refilled.
      stats: () => ({ animals: animals.length, guests: guests.length, low, cost: frames ? cost / frames : 0, inView: inView.slice(), made, reduce }),
      redraw: draw,
      destroy() { cancelAnimationFrame(raf); },
    };
    populate();
    if (reduce) draw(); else raf = requestAnimationFrame(loop);
    document.addEventListener("visibilitychange", () => { last = performance.now(); });
    return api;
  }

  // Every animal on one sheet, enlarged: for checking the artwork (tools/wildlife.html) and for a future collection.
  function sheet(canvas, time = 0, zoom = 5, o = {}) {
    const all = [...SPECIES.map(s => ({ s, enc: false })), ...ENCOUNTERS.map(s => ({ s, enc: true }))].filter(x => !o.keys || o.keys.includes(x.s.key));
    const cols = o.cols || 4, cw = o.cw || 150, ch = o.ch || 110, rows = Math.ceil(all.length / cols);
    const small = canvasOf(cols * cw, rows * ch), g = small.getContext("2d"), lume = canvasOf(small.width, small.height), L = lume.getContext("2d");
    g.fillStyle = "#0a2038"; g.fillRect(0, 0, small.width, small.height);
    const E = { lo: 0, hi: cw, calm: 0, avoid: null, t: time };
    let rs = 7; const r = () => (rs = (rs * 16807) % 2147483647) / 2147483647;
    all.forEach(({ s, enc }, i) => {
      const x0 = (i % cols) * cw, y0 = Math.floor(i / cols) * ch;
      g.fillStyle = i % 2 ? "#0b2540" : "#0a2038"; g.fillRect(x0, y0, cw, ch);
      const c = enc ? { sp: s, ph: 1, oy: 0, pf: 1, age: 9, life: 99, x: 0, y: 0, y0: 0, dir: 1, len: 40 } : s.make(E, r);
      if (enc) s.start(c, E, { x: cw / 2, y: 30, below: 30, top: -99, lo: 0, hi: cw }, 1);
      c.dir = 1; c.x = s.key === "spark" ? 0 : enc ? (s.key === "bigfin" ? cw / 2 : cw / 2 + 24) : cw / 2; c.sp = s;
      const home = c.y0 != null ? c.y0 : c.y; s.step(c, 0, E);
      const yShift = y0 + (s.key === "bigfin" ? 12 : ch / 2) - (c.y != null ? c.y : home);
      const D = { t: time, low: false, E, L, g, a: 1, X: x => Math.round(x) + x0, Y: y => Math.round(y + yShift) };
      if (s.key === "spark") { D.X = x => Math.round(x) + x0; D.Y = y => y0 + 10 + Math.round((y - yM(190)) / (140 * PXM) * (ch - 20)); }
      g.save(); g.beginPath(); g.rect(x0, y0, cw, ch); g.clip(); L.save(); L.beginPath(); L.rect(x0, y0, cw, ch); L.clip();
      s.draw(c, D); g.restore(); L.restore();
    });
    g.globalCompositeOperation = "screen"; g.drawImage(lume, 0, 0); g.globalCompositeOperation = "source-over";
    canvas.width = small.width * zoom; canvas.height = small.height * zoom;
    const G = canvas.getContext("2d"); G.imageSmoothingEnabled = false; G.drawImage(small, 0, 0, canvas.width, canvas.height);
    G.font = `600 ${Math.max(11, Math.round(zoom * 2.6))}px Inter, system-ui, sans-serif`; G.fillStyle = "#cfe3f5"; G.textBaseline = "top";
    all.forEach(({ s, enc }, i) => G.fillText(s.name + (enc ? `  ·  ${s.min} m+` : `  ·  ${Math.max(0, s.zone[0])}–${s.zone[1]} m`), ((i % cols) * cw + 4) * zoom, (Math.floor(i / cols) * ch + 3) * zoom));
  }

  window.Wildlife = {
    create, sheet,
    // The cast, for anything that wants to list it (a collection screen, the README).
    species: () => [...SPECIES.map(s => ({ key: s.key, name: s.name, latin: s.latin, band: s.band, zone: s.zone, real: s.real, rare: false })),
      ...ENCOUNTERS.map(s => ({ key: s.key, name: s.name, latin: s.latin, band: "abyss", min: s.min, real: s.real, line: s.line, rare: true }))],
    ENCOUNTERS: ENCOUNTERS.map(e => ({ key: e.key, name: e.name, min: e.min, line: e.line })),
  };
})();
