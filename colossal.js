// The colossal squid (Mesonychoteuthis hamiltoni): the one animal that lives beneath the iceberg.
//
// It is drawn fresh every frame, pixel by pixel, at the scene's own pixel size, so it can turn, breathe and move
// its ten limbs freely and be lit only where light actually reaches it. Nothing here is a sprite.
//
// Anatomy, from Te Papa's specimens and the scientific descriptions:
//   - a broad, heavy mantle (about 2.5 m long and 1 m across), tapering to a point at the back;
//   - very large, muscular paired fins at the back, together heart-shaped, about half the mantle's length;
//   - a short head with the largest eyes of any animal (about 27 cm), each with a long light organ beside the lens
//     that glows all the time;
//   - eight thick arms with two rows of hooks among serrated suckers, and two longer tentacles ending in clubs that
//     carry swivelling hooks;
//   - reddish skin from its pigment cells.
// It is drawn side-on, as zoological plates show squid: the near fin above the mantle, the far fin below it, one eye.
// It travels tail first, as squid do when they jet, with the arms streaming behind.
//
//   Colossal.create(seed)                    a new animal (its own limb rhythms)
//   Colossal.step(sq, dt)                    move it on
//   Colossal.draw(body, glow, sq, lights, o) draw it: body into one canvas context, its own light (the glowing light
//                                            organs, eyeshine, the faintest rim) into another, drawn above the dark.
//   lights: [{ x, y, r, k, col: [r, g, b] }] in the canvas's pixels. o: { ambient, fog, alpha }.
(function () {
  "use strict";
  const TAU = Math.PI * 2;
  // Proportions, in art pixels at scale 1. A mantle of 150 makes the whole animal about 360 long: at the scene's
  // usual pixel size that is wider than any screen.
  const ML = 150, HEAD = 30, EYE = { x: -15, y: -4, r: 10.5 };
  // Skin: deep crimson on the back, warmer and paler underneath, with darker pigment cells over all of it.
  const DORSAL = [0.30, 0.065, 0.075], VENTRAL = [0.68, 0.31, 0.25], FIN = [0.46, 0.14, 0.13], ARM = [0.46, 0.15, 0.14];
  const WATER = [0.012, 0.018, 0.035];

  // ---------- The body's outline (local coordinates: head-mantle join at 0, the tail at +ML, y down) ----------
  // Half-height of the mantle along its length: full and heavy in front, drawn to a point behind.
  const mantleH = (u, squeeze) => {
    if (u < 0 || u > 1) return 0;
    const front = 0.86 + 0.14 * Math.sin(Math.min(u, 0.3) / 0.3 * Math.PI / 2);
    return 32 * front * Math.pow(Math.max(0, 1 - Math.pow(u, 2.2)), 0.75) * (1 - squeeze);
  };
  const sag = u => 2.2 * Math.sin(u * Math.PI);                     // the back is very slightly arched
  // The fins: from just past half-way, out to a broad, rounded front edge, back to a point beyond the tail.
  // Together they make a heart: a rounded front lobe that rises steeply from the mantle, then a long sweep back to
  // a point just past the tail.
  const FIN0 = 0.46, FIN1 = 1.1;
  const finF = (u, t, wave) => {
    if (u < FIN0 || u > FIN1) return 0;
    const v = (u - FIN0) / (FIN1 - FIN0);
    const lobe = Math.pow(Math.sin(Math.PI * Math.pow(v, 0.5)), 0.42) * (1 - 0.12 * v);
    return 56 * lobe * (1 + wave * Math.sin(t * 1.5 - v * 4.6));
  };
  // The head: a short neck behind the eye, the eye's bulge, the narrower crown where the arms begin.
  const headH = x => { const k = -x / HEAD; return 24 + 4.2 * Math.sin(Math.min(1, k * 1.25) * Math.PI) - 5 * Math.max(0, k - 0.8) / 0.2; };

  // ---------- Limbs ----------
  // Eight arms and two tentacles leave the crown at the front of the head. Half are on the far side (drawn first,
  // in shadow), half on the near side. Each has its own rhythm so no two move together.
  function limbsFor(rnd) {
    const L = [];
    // Thick, muscular arms that leave the head as one heavy bundle and loosen towards the tips.
    const arm = (y, ang, len, r0, near) => L.push({ kind: "arm", y, ang, len, r0, near, f1: 0.3 + rnd() * 0.18, f2: 0.11 + rnd() * 0.07, p1: rnd() * TAU, p2: rnd() * TAU, a1: 0.026 + rnd() * 0.012, a2: 0.016 + rnd() * 0.008, curl: (rnd() - 0.5) * 0.012 + y * 0.0004 });
    arm(-12, -0.15, 94, 6.2, false); arm(-4, -0.05, 102, 6.8, false); arm(4, 0.04, 100, 6.8, false); arm(11, 0.14, 92, 6.2, false);
    arm(-14, -0.19, 88, 6.6, true); arm(-5, -0.07, 98, 7.2, true); arm(5, 0.07, 96, 7.2, true); arm(13, 0.18, 86, 6.6, true);
    // The tentacles: longer and thinner, each ending in a hooked club.
    L.push({ kind: "tent", y: -2, ang: -0.02, len: 186, r0: 3.2, near: false, f1: 0.21, f2: 0.09, p1: rnd() * TAU, p2: rnd() * TAU, a1: 0.014, a2: 0.01, curl: -0.004 });
    L.push({ kind: "tent", y: 3, ang: 0.03, len: 178, r0: 3.4, near: true, f1: 0.19, f2: 0.08, p1: rnd() * TAU, p2: rnd() * TAU, a1: 0.015, a2: 0.011, curl: 0.004 });
    return L;
  }
  const SEG = 30;
  // A limb's centre line: a chain of short segments whose bend is the sum of two waves running from base to tip,
  // stronger towards the tip, plus a slow curl. While the mantle jets, the limbs straighten and trail.
  function limbPoints(sq, l) {
    const pts = [], ds = l.len / SEG, stream = 1 - 0.55 * sq.jet;
    let a = Math.PI + l.ang * (1 + 0.6 * sq.spread), x = -HEAD + 1, y = l.y * 0.92;
    for (let j = 0; j <= SEG; j++) {
      const s = j / SEG;
      const r = l.kind === "tent"
        ? (s < 0.8 ? l.r0 * (1 - 0.5 * s) : l.r0 * (0.6 + 0.8 * Math.sin((s - 0.8) / 0.2 * Math.PI)) * (1 - 0.55 * Math.max(0, s - 0.92) / 0.08))
        : l.r0 * (1.08 - 0.9 * Math.pow(s, 1.1));
      pts.push({ x, y, r: Math.max(0.6, r), s });
      const bend = stream * ((0.25 + 0.75 * s) * l.a1 * Math.sin(sq.t * l.f1 * TAU - s * 2.6 + l.p1) + (0.4 + 0.6 * s) * l.a2 * Math.sin(sq.t * l.f2 * TAU - s * 4.3 + l.p2)) + l.curl * stream;
      a += bend * ds * 0.55;
      x += Math.cos(a) * ds; y += Math.sin(a) * ds;
    }
    return pts;
  }

  // ---------- Making and moving one ----------
  function create(seed = 1) {
    let rs = Math.max(1, seed % 2147483646); const rnd = () => (rs = (rs * 16807) % 2147483647) / 2147483647;
    return { t: 0, x: 0, y: 0, dir: 1, angle: 0, scale: 1, vx: 0, vy: 0, speed: 9, jet: 0, spread: 0, squeeze: 0, cycle: 5.6 + rnd() * 1.2, ph: rnd() * 10, heading: 0, limbs: limbsFor(rnd) };
  }
  // The mantle fills slowly and empties fast: each emptying is a push, tail first, and the limbs fall in behind.
  function step(sq, dt) {
    sq.t += dt;
    const c = ((sq.t + sq.ph) % sq.cycle) / sq.cycle;
    const contract = c < 0.16 ? Math.sin(c / 0.16 * Math.PI / 2) : Math.max(0, 1 - (c - 0.16) / 0.5);
    sq.squeeze = 0.075 * contract;
    sq.jet += ((c < 0.22 ? 1 : 0) - sq.jet) * Math.min(1, dt * (c < 0.22 ? 3 : 0.7));
    sq.spread = 0.5 + 0.5 * Math.sin(sq.t * 0.21 + sq.ph);
    // It turns slowly, as a heavy thing does.
    sq.angle += (sq.heading + 0.09 * Math.sin(sq.t * 0.13 + sq.ph) - sq.angle) * Math.min(1, dt * 0.35);
    const v = sq.speed * (0.45 + 1.1 * sq.jet) * sq.scale;
    sq.x += Math.cos(sq.angle) * sq.dir * v * dt; sq.y += Math.sin(sq.angle) * v * dt * sq.dir;
  }

  // ---------- Drawing ----------
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) / 16 - 0.5);
  const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  let buf = null, glowBuf = null, cnv = null, gcnv = null, W = 0, H = 0, data = null, gdata = null;
  function surface(w, h) {
    if (w === W && h === H && buf) return;
    W = w; H = h;
    cnv = document.createElement("canvas"); cnv.width = w; cnv.height = h; buf = cnv.getContext("2d").createImageData(w, h); data = buf.data;
    gcnv = document.createElement("canvas"); gcnv.width = w; gcnv.height = h; glowBuf = gcnv.getContext("2d").createImageData(w, h); gdata = glowBuf.data;
  }

  // Light reaching one point with the given surface normal: the lights in the scene, falling off with distance,
  // a faint wet sheen where a light catches the skin, and almost nothing else.
  const out = [0, 0, 0];
  function shade(X, Y, nx, ny, nz, lights, ambient, sheen) {
    let r = ambient, g = ambient, b = ambient * 1.15;
    for (let i = 0; i < lights.length; i++) {
      const L = lights[i], dx = L.x - X, dy = L.y - Y, d2 = dx * dx + dy * dy, rr = L.r * L.r;
      if (d2 >= rr) continue;
      const q = 1 - d2 / rr, fall = q * q * L.k, h = L.r * 0.45, inv = 1 / Math.sqrt(d2 + h * h);
      const lx = dx * inv, ly = dy * inv, lz = h * inv;
      const lam = Math.max(0, nx * lx + ny * ly + nz * lz) * 0.82 + 0.18;
      let sp = 0;
      if (sheen) { const hx = lx, hy = ly, hz = lz + 1, hl = 1 / Math.sqrt(hx * hx + hy * hy + hz * hz); const nh = Math.max(0, (nx * hx + ny * hy + nz * hz) * hl); sp = Math.pow(nh, 22) * sheen * fall; }
      r += fall * lam * L.col[0] + sp; g += fall * lam * L.col[1] + sp; b += fall * lam * L.col[2] + sp;
    }
    out[0] = r; out[1] = g; out[2] = b;
    return out;
  }
  // Write one pixel: colour lit, faded into the water by distance, posterised with an ordered dither so it stays
  // pixel art rather than a smooth render.
  // Highlights roll off instead of clipping to white: wet red skin in a lamp stays red.
  const roll = c => c < 0.55 ? c : 0.55 + 0.42 * (1 - Math.exp(-(c - 0.55) * 2.4));
  let DIM = null;
  function put(X, Y, cr, cg, cb, a, fog) {
    if (X < 0 || Y < 0 || X >= W || Y >= H) return;
    cr = roll(cr); cg = roll(cg); cb = roll(cb);
    if (DIM && X > DIM.l && X < DIM.r && Y > DIM.t && Y < DIM.b) { cr *= 0.3; cg *= 0.3; cb *= 0.3; }   // behind words: stay back
    const d = BAYER[(Y & 3) * 4 + (X & 3)] / 34, i = (Y * W + X) * 4;
    cr = cr * (1 - fog) + WATER[0] * fog; cg = cg * (1 - fog) + WATER[1] * fog; cb = cb * (1 - fog) + WATER[2] * fog;
    data[i] = Math.max(0, Math.min(255, Math.round((cr + d) * 34) / 34 * 255));
    data[i + 1] = Math.max(0, Math.min(255, Math.round((cg + d) * 34) / 34 * 255));
    data[i + 2] = Math.max(0, Math.min(255, Math.round((cb + d) * 34) / 34 * 255));
    data[i + 3] = Math.round(a * 255);
  }
  function glowAt(X, Y, r, g, b, a) {
    if (X < 0 || Y < 0 || X >= W || Y >= H || a <= 0.01) return;
    const i = (Y * W + X) * 4, k = Math.min(1, a);
    gdata[i] = Math.max(gdata[i], r * k); gdata[i + 1] = Math.max(gdata[i + 1], g * k); gdata[i + 2] = Math.max(gdata[i + 2], b * k); gdata[i + 3] = 255;
  }

  let lastMs = 0;
  function draw(body, glow, sq, lights, o = {}) {
    const t0 = performance.now();
    surface(body.canvas.width, body.canvas.height);
    data.fill(0); gdata.fill(0);
    const ambient = o.ambient == null ? 0.022 : o.ambient, fog = o.fog || 0, alpha = o.alpha == null ? 1 : o.alpha, sc = sq.scale, dir = sq.dir;
    DIM = o.dim || null;
    const ca = Math.cos(sq.angle), sa = Math.sin(sq.angle);
    // local -> canvas, and canvas -> local
    const toX = (lx, ly) => sq.x + (dir * lx * ca - ly * sa) * sc, toY = (lx, ly) => sq.y + (dir * lx * sa + ly * ca) * sc;
    const lit = lights.map(L => ({ ...L, col: L.col || [1, 0.9, 0.85] }));
    const rim = Math.max(0.1, 0.34 * (1 - fog));

    // The limbs, as tubes: far ones first, darker; the near ones after the body.
    const limbs = sq.limbs.map(l => ({ l, pts: limbPoints(sq, l) }));
    const drawLimb = ({ l, pts }) => {
      const dark = l.near ? 1 : 0.42;
      // Fill the limb continuously: discs placed closer together than their own radius, so thin tips stay solid.
      const dense = [];
      for (let j = 0; j < pts.length - 1; j++) {
        const p = pts[j], q = pts[j + 1], ax = toX(p.x, p.y), ay = toY(p.x, p.y), bx = toX(q.x, q.y), by = toY(q.x, q.y);
        let tx = bx - ax, ty = by - ay; const len = Math.hypot(tx, ty) || 1; tx /= len; ty /= len;
        const n = Math.max(1, Math.ceil(len / Math.max(0.6, Math.min(p.r, q.r) * sc * 0.55)));
        for (let k = 0; k < n; k++) { const f = k / n; dense.push({ cx: ax + (bx - ax) * f, cy: ay + (by - ay) * f, R: (p.r + (q.r - p.r) * f) * sc, s: p.s + (q.s - p.s) * f, tx, ty, d: (j + f) * len }); }
      }
      let lastHook = -99;
      for (let i = dense.length - 1; i >= 0; i--) {
        const { cx, cy, R, s, tx, ty, d } = dense[i], ri = Math.ceil(R);
        for (let oy = -ri; oy <= ri; oy++) for (let ox = -ri; ox <= ri; ox++) {
          const X = Math.round(cx) + ox, Y = Math.round(cy) + oy, ddx = X - cx, ddy = Y - cy;
          if (ddx * ddx + ddy * ddy > R * R + 0.25) continue;
          const v = Math.max(-1, Math.min(1, (ddx * -ty + ddy * tx) / Math.max(0.8, R)));      // across the tube, -1..1
          const nz = Math.sqrt(Math.max(0, 1 - v * v));
          // a proper unit normal for a tube lying in the picture: round across, facing the viewer in the middle
          let nx = -ty * v, ny = tx * v - 0.15 * nz, nzz = nz; const nl = 1 / Math.hypot(nx, ny, nzz); nx *= nl; ny *= nl; nzz *= nl;
          const c = shade(X, Y, nx, ny, nzz, lit, ambient, 0.12);
          const m = (0.9 + 0.14 * hash(X * 3 + Math.round(d), Y) - (hash((X + Math.round(d)) >> 1, Y >> 1) > 0.9 ? 0.18 : 0)) * (0.6 + 0.4 * nz);
          // shaded like the mantle: darker along the top of each arm, paler beneath
          const belly = Math.max(0, Math.min(1, (v * (l.near ? 1 : -1) + 0.4) / 1.4)) * 0.45 + 0.1;
          let tr = DORSAL[0] + (VENTRAL[0] - DORSAL[0]) * belly, tg = DORSAL[1] + (VENTRAL[1] - DORSAL[1]) * belly, tb = DORSAL[2] + (VENTRAL[2] - DORSAL[2]) * belly;
          // suckers: small pale rings spaced along the inner face, from a little way out to near the tip
          if (l.near && v > 0.55 && s > 0.12 && s < 0.9 && R > 1.6 && (Math.round(d / 3.2) % 2 === 0) && ((X + Y) & 1) === 0) { tr = 0.5; tg = 0.3; tb = 0.27; }
          put(X, Y, tr * Math.min(1.6, c[0]) * m * dark, tg * Math.min(1.6, c[1]) * m * dark, tb * Math.min(1.6, c[2]) * m * dark, alpha, fog);
        }
        // Hooks: small, hard, pale points that catch the light. Arms carry two rows through the middle; the clubs at
        // the tentacles' ends carry the swivelling ones.
        const hooked = l.kind === "arm" ? l.near && s > 0.34 && s < 0.68 : s > 0.83 && s < 0.97;
        if (hooked && d - lastHook > (l.kind === "arm" ? 9 : 4.5)) {
          lastHook = d;
          const side = l.near ? 1 : -1, hx = Math.round(cx + -ty * R * 0.75 * side), hy = Math.round(cy + tx * R * 0.75 * side);
          const c = shade(hx, hy, 0, 0, 1, lit, ambient, 0.9), k = Math.min(1, (c[0] + c[1]) * 0.5);
          put(hx, hy, 0.7 * Math.min(1.5, c[0]) + 0.02, 0.6 * Math.min(1.5, c[1]) + 0.02, 0.5 * Math.min(1.5, c[2]) + 0.02, alpha, fog);
          if (k > 0.4) glowAt(hx, hy, 220, 200, 178, (k - 0.4) * 0.45 * (1 - fog));
        }
      }
    };
    limbs.filter(x => !x.l.near).forEach(drawLimb);

    // The body: mantle, fins, head, funnel and eye, filled row by row inside a box around it.
    const corners = [[-HEAD - 4, -54], [ML * FIN1 + 4, -54], [-HEAD - 4, 54], [ML * FIN1 + 4, 54]].map(([lx, ly]) => [toX(lx, ly), toY(lx, ly)]);
    const x0 = Math.max(0, Math.floor(Math.min(...corners.map(c => c[0])))), x1 = Math.min(W - 1, Math.ceil(Math.max(...corners.map(c => c[0]))));
    const y0 = Math.max(0, Math.floor(Math.min(...corners.map(c => c[1])))), y1 = Math.min(H - 1, Math.ceil(Math.max(...corners.map(c => c[1]))));
    const inv = 1 / sc;
    // What a canvas pixel is: 0 nothing, 1 mantle, 2 near fin, 3 far fin, 4 head, 5 funnel, 6 eye.
    const classify = (X, Y) => {
      const dx = (X + 0.5 - sq.x) * inv, dy = (Y + 0.5 - sq.y) * inv;
      const lxr = dx * ca + dy * sa, ly = -dx * sa + dy * ca, lx = lxr * dir;
      L_X = lx; L_Y = ly;
      if (lx >= 0 && lx <= ML * FIN1) {
        const u = lx / ML, cy = sag(u), h = mantleH(u, sq.squeeze), f = finF(u, sq.t, 0.06);
        const vv = (ly - cy) / Math.max(1, h), rim = 9 * Math.pow(Math.abs(vv), 2.6);                 // the mantle's opening curves back at top and bottom
        if (Math.abs(ly - cy) <= h && lx >= rim) { L_V = vv; L_U = u; return 1; }
        if (f > 0 && ly < cy && cy - ly <= f) { L_V = (cy - ly - h) / Math.max(1, f - h); L_U = u; return 2; }
        if (f > 0 && ly > cy && ly - cy <= f * 0.82) { L_V = (ly - cy - h) / Math.max(1, f * 0.82 - h); L_U = u; return 3; }
        if (lx < 14 && ly > 0 && ly < h + 7 - lx * 0.25 && ly > h - 1) { L_V = 0; return 5; }
      }
      if (lx < 9.2 && lx >= -HEAD) {
        const hh = headH(Math.min(lx, -0.01)), ex = lx - EYE.x, ey = ly - EYE.y;
        if (ex * ex + ey * ey <= EYE.r * EYE.r) { L_U = ex / EYE.r; L_V = ey / EYE.r; return 6; }
        if (Math.abs(ly) <= hh) { L_V = ly / hh; L_U = lx / HEAD; return 4; }
        if (lx > -12 && ly > 0 && ly < hh + 7 + lx * 0.25) { L_V = 0; return 5; }
      }
      return 0;
    };
    let L_X = 0, L_Y = 0, L_U = 0, L_V = 0;
    for (let Y = y0; Y <= y1; Y++) for (let X = x0; X <= x1; X++) {
      const k = classify(X, Y); if (!k) continue;
      const lx = L_X, ly = L_Y, u = L_U, v = L_V;
      let tr, tg, tb, nx = 0, ny, nz, sheen = 0.5;
      if (k === 1 || k === 4) {
        // A rounded body lit from in front: the normal turns up at the back and down at the belly.
        ny = Math.max(-1, Math.min(1, v)); nz = Math.sqrt(Math.max(0.02, 1 - ny * ny)); nx = k === 1 ? -0.25 * Math.max(0, u - 0.55) * dir : 0;
        const belly = Math.max(0, Math.min(1, (v + 0.15) / 1.1));
        tr = DORSAL[0] + (VENTRAL[0] - DORSAL[0]) * belly; tg = DORSAL[1] + (VENTRAL[1] - DORSAL[1]) * belly; tb = DORSAL[2] + (VENTRAL[2] - DORSAL[2]) * belly;
        // pigment cells: fine speckle and a scatter of larger dark spots, fixed to the skin (local coordinates)
        // fine speckle, and small round dark pigment spots scattered over it (not squares: a spot is a disc in skin space)
        const gx = Math.floor(lx * 0.9), gy = Math.floor(ly * 0.9), sp = hash(gx, gy);
        const cxs = Math.floor(lx / 4.2), cys = Math.floor(ly / 4.2), hs = hash(cxs, cys), sx = (cxs + 0.5 + (hash(cys, cxs) - 0.5) * 0.5) * 4.2, sy = (cys + 0.5 + (hs - 0.5) * 0.5) * 4.2;
        const spot = hs > 0.72 && (lx - sx) * (lx - sx) + (ly - sy) * (ly - sy) < 1.1 + 1.6 * hs;
        let m = (0.92 + 0.12 * sp - (spot ? 0.17 : 0)) * (0.55 + 0.45 * nz);   // rounder: darker towards the edges
        if (k === 1 && lx - 9 * Math.pow(Math.abs(v), 2.6) < 1.6) m *= 0.72;                          // the shadow under the mantle's rim
        if (k === 1 && v < -0.62 && v > -0.78 && u < 0.8) m *= 0.86;               // a faint ridge along the back
        if (k === 4 && lx > -3) m *= 0.82;
        if (k === 4 && Math.hypot(lx - EYE.x, ly - EYE.y) < EYE.r + 2.4) m *= 0.7;     // the socket round the eye
        tr *= m; tg *= m; tb *= m; sheen = 0.55;
      } else if (k === 2 || k === 3) {
        // The fins: thinner and flatter, with fine muscle lines running out to the edge; the far one in shadow.
        ny = k === 2 ? -0.35 - 0.3 * v : 0.5; nz = 0.85; nx = 0;
        const line = 0.95 + 0.05 * Math.sin((lx * 0.55 + (k === 2 ? -ly : ly) * 0.9) * 0.62) + 0.04 * (hash(Math.floor(lx * 0.8), Math.floor(ly * 0.8)) - 0.5);
        const edge = v > 0.88 ? 0.78 : 1;
        tr = FIN[0] * line * edge; tg = FIN[1] * line * edge; tb = FIN[2] * line * edge;
        if (k === 3) { tr *= 0.5; tg *= 0.5; tb *= 0.55; }
        sheen = 0.3;
      } else if (k === 5) {
        ny = 0.6; nz = 0.8; tr = VENTRAL[0] * 0.8; tg = VENTRAL[1] * 0.8; tb = VENTRAL[2] * 0.85;
      } else {
        // The eye: a dark, wet dome. Its lid, the iris ring, a huge black pupil, and the lens catching the light.
        const rr = Math.hypot(u, v);
        nx = u * 0.8; ny = v * 0.8; nz = Math.sqrt(Math.max(0.05, 1 - rr * rr * 0.64));
        if (rr > 0.86) { tr = 0.3; tg = 0.08; tb = 0.09; }
        else if (rr > 0.72) { tr = 0.16; tg = 0.12; tb = 0.14; }
        else { tr = 0.025; tg = 0.03; tb = 0.04; }
        sheen = 2.2;
      }
      let c = shade(X, Y, nx, ny, nz, lit, ambient, sheen);
      put(X, Y, tr * c[0], tg * c[1], tb * c[2], alpha, fog);
      // Rim: the outline catches what little light there is, so the shape reads even in the dark. Only the upper
      // edge, as if from far above.
      if (k <= 4 && !classify(X, Y - 1)) glowAt(X, Y, 120, 58, 56, rim * alpha * (k === 3 ? 0.4 : 1));
      if (k === 6) {
        // Eyeshine: the eye throws back whatever light reaches it, a pale grey-green, strongest at the lens.
        const rr = Math.hypot(u, v);
        const lens = rr < 0.5 ? (1 - rr / 0.5) : 0, lightIn = Math.min(1.4, c[0] + c[1]);
        if (lens > 0) glowAt(X, Y, 150, 190, 186, (0.05 + 0.32 * lightIn) * lens * alpha * (1 - fog * 0.6));
        if ((u + 0.34) * (u + 0.34) + (v + 0.36) * (v + 0.36) < 0.028) glowAt(X, Y, 230, 236, 240, (0.12 + 0.6 * lightIn) * alpha * (1 - fog * 0.5));   // the small bright highlight on the lens
      }
    }
    // The light organ beside each lens: a long, steady band of pale blue-green that never goes out. In the dark it is
    // the first thing anyone sees.
    for (let j = -6; j <= 6; j++) for (let w = 0; w < 2; w++) {
      const lx = EYE.x + EYE.r * 0.78 + w, ly = EYE.y + j * 0.9;
      const X = Math.round(toX(lx, ly)), Y = Math.round(toY(lx, ly)), k = 1 - Math.abs(j) / 7;
      glowAt(X, Y, 110, 222, 210, (0.55 + 0.25 * Math.sin(sq.t * 0.6)) * k * alpha * (1 - fog * 0.35));
    }
    limbs.filter(x => x.l.near).forEach(drawLimb);

    cnv.getContext("2d").putImageData(buf, 0, 0);
    gcnv.getContext("2d").putImageData(glowBuf, 0, 0);
    body.drawImage(cnv, 0, 0);
    if (glow) { const op = glow.globalCompositeOperation; glow.globalCompositeOperation = "lighter"; glow.drawImage(gcnv, 0, 0); glow.globalCompositeOperation = op; }
    lastMs = lastMs ? lastMs * 0.9 + (performance.now() - t0) * 0.1 : performance.now() - t0;
  }

  // Roughly where it is: for keeping a camera or a light near it.
  const bounds = sq => ({ x: sq.x, y: sq.y, len: (ML + HEAD + 182) * sq.scale });
  window.Colossal = { create, step, draw, bounds, ML, HEAD, get ms() { return lastMs; } };
})();
