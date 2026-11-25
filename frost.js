// The question's panel of ice. It is drawn on a small canvas behind the question and the answer box, in the game's
// pixel style, and it does four things:
//   set(f)     cracks spread across it as the question's time runs out: f is the share of the real time left (1 to 0),
//              taken from the game's own clock, so the cracks stop whenever the clock stops (reveals, checks, a hidden
//              tab) and pick up exactly where they were. Nothing here keeps time of its own.
//   shatter()  time's up: the last crack runs through, the panel breaks into pieces that fall away (about 600 ms).
//   dissolve() all three guesses used: the ice clears away quietly (about 450 ms).
//   form()     a new question: frost grows in from the edges and the panel sets (about 500 ms).
// Three looks are offered for review (LOOKS): Arctic glass, Glacial crystal and Ancient slab. ?panel=a|b|c picks one.
(function () {
  const PX = 2;                                     // one pixel of ice art = 2 CSS pixels, like the rest of the scene
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

  // A small seeded random source: the same question always cracks the same way, on every screen.
  const rng = seed => { let s = (seed >>> 0) || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; };
  const hash = str => { let h = 2166136261; for (const c of String(str)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

  const LOOKS = {
    // A: thin, clear sheet ice. Mostly see-through, a bright rim, frost only in the corners, glass-like cracks.
    a: { name: "Arctic glass", edge: 0.35, chip: 2, tint: [8, 26, 52, 0.62], body: [170, 214, 245, 0.13], rim: [236, 248, 255, 0.9], rimLow: [120, 170, 210, 0.55],
      frost: 0.55, facets: 0, strata: 0, bubbles: 0, glint: 0.9, ink: "light", crack: { core: [250, 253, 255, 0.95], side: [150, 205, 240, 0.55], shade: [4, 14, 30, 0.45] }, style: "radial" },
    // B: faceted glacier ice, cut like the iceberg below it. Deeper blue, crystal facets, cracks along the cleavage.
    b: { name: "Glacial crystal", edge: 0.6, chip: 3, tint: [6, 24, 50, 0.7], body: [60, 140, 200, 0.2], rim: [200, 240, 255, 0.85], rimLow: [70, 150, 210, 0.6],
      frost: 0.4, facets: 7, strata: 0, bubbles: 0, glint: 1, ink: "light", crack: { core: [232, 250, 255, 0.95], side: [110, 220, 245, 0.6], shade: [2, 12, 28, 0.5] }, style: "cleave" },
    // C: old, thick, compacted ice. Milky and nearly opaque, layered, with trapped bubbles and chipped edges.
    c: { name: "Ancient slab", edge: 1, chip: 4, tint: [0, 0, 0, 0], body: [214, 234, 246, 0.9], rim: [250, 253, 255, 0.95], rimLow: [150, 186, 214, 0.9],
      frost: 0.3, facets: 0, strata: 6, bubbles: 14, glint: 0.5, ink: "dark", crack: { core: [40, 78, 112, 0.75], side: [255, 255, 255, 0.7], shade: [90, 130, 165, 0.45] }, style: "fracture" },
  };
  const pick = () => { const q = new URLSearchParams(location.search).get("panel"); return LOOKS[q] ? q : "b"; };

  const rgba = (c, k = 1) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${(c[3] * k).toFixed(3)})`;

  // Bresenham: crack lines one whole pixel wide, never smeared.
  function line(g, x0, y0, x1, y1, plot) {
    x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1; let e = dx + dy;
    for (let n = 0; n < 4000; n++) { plot(x0, y0); if (x0 === x1 && y0 === y1) break; const e2 = 2 * e; if (e2 >= dy) { e += dy; x0 += sx; } if (e2 <= dx) { e += dx; y0 += sy; } }
  }

  function create(host, opts = {}) {
    const canvas = document.createElement("canvas"); canvas.className = "frost-art"; canvas.setAttribute("aria-hidden", "true");
    host.prepend(canvas);
    const g = canvas.getContext("2d");
    let look = LOOKS[opts.look || pick()], key = opts.look || pick(), seed = 1, W = 0, H = 0, PAD = 4;
    let base = null, outline = [], cracks = [], progress = 0, drawn = -1, anim = 0, guard = 0, state = "idle";

    // The panel's outline: a rectangle with an uneven, chipped edge (how uneven depends on the look).
    function shape(R) {
      const pts = [], step = 6, j = look.chip, k = look.edge;
      const side = (ax, ay, bx, by, nx, ny) => { const len = Math.hypot(bx - ax, by - ay), n = Math.max(2, Math.round(len / step));
        for (let i = 0; i < n; i++) { const t = i / n, bite = R() < 0.18 * k ? -j * (0.5 + R()) : (R() - 0.5) * j * 0.5 * k; pts.push([ax + (bx - ax) * t + nx * bite, ay + (by - ay) * t + ny * bite]); } };
      const c = look.style === "cleave" ? 5 : look.style === "fracture" ? 3 : 2;   // corner cut
      const x0 = PAD, y0 = PAD, x1 = W - PAD, y1 = H - PAD;
      side(x0 + c, y0, x1 - c, y0, 0, -1); side(x1, y0 + c, x1, y1 - c, 1, 0); side(x1 - c, y1, x0 + c, y1, 0, 1); side(x0, y1 - c, x0, y0 + c, -1, 0);
      return pts;
    }
    const pathOf = (q, pts) => { q.beginPath(); pts.forEach((p, i) => i ? q.lineTo(p[0], p[1]) : q.moveTo(p[0], p[1])); q.closePath(); };

    // Everything that does not change while the question is open, drawn once: the body, its facets or layers,
    // bubbles, the frosted edge, the rim and the reflections.
    function paintBase() {
      const R = rng(seed);
      base = document.createElement("canvas"); base.width = W; base.height = H;
      const q = base.getContext("2d");
      outline = shape(R);
      q.save(); pathOf(q, outline); q.clip();
      if (look.tint[3]) { q.fillStyle = rgba(look.tint); q.fillRect(0, 0, W, H); }            // keeps the words readable over anything
      const body = q.createLinearGradient(0, 0, 0, H); body.addColorStop(0, rgba(look.body, 1.25)); body.addColorStop(1, rgba(look.body, 0.8));
      q.fillStyle = body; q.fillRect(0, 0, W, H);
      // Facets (crystal): a few planes of slightly different light, cut from points on the edges.
      for (let i = 0; i < look.facets; i++) {
        const a = [R() * W, 0], b = [R() * W, H], c = [i % 2 ? 0 : W, R() * H];
        q.beginPath(); q.moveTo(...a); q.lineTo(...b); q.lineTo(...c); q.closePath();
        q.fillStyle = R() < 0.5 ? `rgba(190, 235, 255, ${0.04 + R() * 0.07})` : `rgba(0, 20, 50, ${0.06 + R() * 0.08})`; q.fill();
        q.strokeStyle = `rgba(210, 245, 255, ${0.025 + R() * 0.03})`; q.lineWidth = 1; q.stroke();   // faint: only cracks are lines
      }
      // Layers (ancient ice): faint bands laid down over centuries.
      for (let i = 0; i < look.strata; i++) {
        const y = H * (0.15 + 0.75 * (i / look.strata)) + (R() - 0.5) * 4; q.fillStyle = `rgba(${R() < 0.5 ? "160, 196, 222" : "255, 255, 255"}, ${0.12 + R() * 0.12})`;
        for (let x = 0; x < W; x += 2) { const yy = Math.round(y + Math.sin(x / (9 + i * 3) + i) * 1.4); q.fillRect(x, yy, 2, 1); }
      }
      // Trapped air.
      for (let i = 0; i < look.bubbles; i++) {
        const x = Math.round(R() * W), y = Math.round(H * (0.2 + R() * 0.7)), r = R() < 0.7 ? 1 : 2;
        q.fillStyle = "rgba(255, 255, 255, 0.55)"; q.fillRect(x, y - r, 1, 1); q.fillStyle = "rgba(120, 160, 190, 0.35)"; q.fillRect(x, y, r, r);
      }
      // A soft reflection band across the face, and a short bright streak.
      const sh = q.createLinearGradient(0, 0, W, H); sh.addColorStop(0.18, "rgba(255, 255, 255, 0)"); sh.addColorStop(0.3, `rgba(255, 255, 255, ${0.06 * look.glint})`); sh.addColorStop(0.42, "rgba(255, 255, 255, 0)");
      q.fillStyle = sh; q.fillRect(0, 0, W, H);
      q.fillStyle = `rgba(255, 255, 255, ${0.35 * look.glint})`; for (let x = 0; x < Math.min(18, W * 0.1); x++) q.fillRect(PAD + 6 + x, PAD + 2, 1, 1);
      // Frost: crystals gathering at the edges and corners, thinning towards the middle (dithered, not blurred).
      // (one image written in a single pass: thousands of one-pixel draws would be slow on a weak phone)
      const fr = rng(seed ^ 0x9e3779b9), fz = q.createImageData(W, H), fa = fz.data;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const dx = Math.min(x, W - 1 - x), dy = Math.min(y, H - 1 - y);
        if (dx > 40 && dy > 7) continue;                  // the middle stays clear
        const corner = Math.max(0, 1 - Math.hypot(Math.min(dx, 40), Math.min(dy, 40)) / 26), edge = Math.max(0, 1 - Math.min(dx, dy) / 7);
        const p = look.frost * (0.55 * edge + 0.75 * corner * corner);
        if (fr() < p * 0.5) { const i = (y * W + x) * 4; fa[i] = 235; fa[i + 1] = 248; fa[i + 2] = 255; fa[i + 3] = Math.round(255 * (0.25 + fr() * 0.4)); }
      }
      const fc = document.createElement("canvas"); fc.width = W; fc.height = H; fc.getContext("2d").putImageData(fz, 0, 0); q.drawImage(fc, 0, 0);
      q.restore();
      // The rim: lit along the top and left, darker along the bottom and right, one pixel wide.
      for (let i = 0; i < outline.length; i++) {
        const a = outline[i], b = outline[(i + 1) % outline.length], lit = (b[0] - a[0]) > 0.1 && Math.abs(b[1] - a[1]) < 6 || (b[1] - a[1]) < -0.1 && Math.abs(b[0] - a[0]) < 6;
        line(q, a[0], a[1], b[0], b[1], (x, y) => { q.fillStyle = rgba(lit ? look.rim : look.rimLow); q.fillRect(x, y, 1, 1); });
      }
    }

    // The crack pattern for this question, in place before the time starts: each crack has the moment it begins and
    // grows from there. Lengths are fractions, so it survives a resize.
    function planCracks() {
      const R = rng(seed ^ 0x51ed27), list = [];
      const add = (pts, born, span, depth) => list.push({ pts, born, span, depth, len: pts.reduce((s, p, i) => i ? s + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0, 0) });
      const walk = (x, y, ang, n, stepLen, wobble) => { const pts = [[x, y]]; for (let i = 0; i < n; i++) { ang += (R() - 0.5) * wobble; x += Math.cos(ang) * stepLen; y += Math.sin(ang) * stepLen; pts.push([x, y]); } return pts; };
      // Where the ice gives first: near one top corner, away from the words.
      const ox = R() < 0.5 ? 0.06 + R() * 0.14 : 0.8 + R() * 0.14, oy = 0.1 + R() * 0.2;
      if (look.style === "radial") {
        const n = 7; for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + R() * 0.5, pts = walk(ox, oy, a, 6 + (R() * 5 | 0), 0.05 + R() * 0.03, 0.5); add(pts, i * 0.06, 0.45 + R() * 0.2, 0);
          if (R() < 0.7) { const m = pts[2 + (R() * 3 | 0)]; add(walk(m[0], m[1], a + (R() < 0.5 ? 0.9 : -0.9), 4, 0.04, 0.6), 0.3 + R() * 0.3, 0.3, 1); } }
        for (let i = 0; i < 3; i++) { const r = 0.06 + i * 0.06, pts = []; for (let a = 0; a <= 6.4; a += 0.4) pts.push([ox + Math.cos(a) * r * (0.9 + R() * 0.2), oy + Math.sin(a) * r * 1.8 * (0.9 + R() * 0.2)]); add(pts, 0.5 + i * 0.13, 0.25, 1); }
      } else if (look.style === "cleave") {
        const n = 6; for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + R() * 0.4, pts = walk(ox, oy, a, 3 + (R() * 3 | 0), 0.09 + R() * 0.05, 0.9); add(pts, i * 0.07, 0.5, 0);
          for (let k = 1; k < pts.length - 1; k++) if (R() < 0.55) add(walk(pts[k][0], pts[k][1], a + (R() < 0.5 ? 1.05 : -1.05), 2 + (R() * 2 | 0), 0.07, 0.3), 0.25 + k * 0.12 + R() * 0.1, 0.3, 1); }
      } else {
        for (let i = 0; i < 4; i++) { const y = 0.2 + i * 0.2 + (R() - 0.5) * 0.1, fromLeft = i % 2 === 0, pts = walk(fromLeft ? 0 : 1, y, fromLeft ? 0 : Math.PI, 12, 0.085, 0.55); add(pts, i * 0.14, 0.55, 0);
          for (let k = 2; k < pts.length - 1; k += 3) if (R() < 0.7) add(walk(pts[k][0], pts[k][1], (R() < 0.5 ? -1 : 1) * Math.PI / 2 + (R() - 0.5), 3, 0.06, 0.6), 0.3 + i * 0.12, 0.3, 1); }
      }
      // In the last seconds: a few more, quick ones.
      for (let i = 0; i < 4; i++) { const x = R(), y = R(); add(walk(x, y, R() * 6.3, 3, 0.06, 0.8), 0.78 + i * 0.04, 0.15, 1); }
      return list;
    }

    // How far the cracks have got: barely anything in the first fifth of the time, then spreading steadily,
    // quickening at the end. Continuous all the way.
    const spread = f => { const used = 1 - Math.max(0, Math.min(1, f)); return Math.max(0, (used - 0.12) / 0.88); };

    function draw(p) {
      if (!W || !base) return;
      g.clearRect(0, 0, W, H); g.drawImage(base, 0, 0);
      if (p <= 0) return;
      const c = look.crack, sx = W - PAD * 2, sy = H - PAD * 2;
      g.save(); pathOf(g, outline); g.clip();
      // Where a crack passes behind the words, it is drawn faintly, so the question always reads.
      const words = wordBoxes || measureWords();
      const behind = (x, y) => words.some(w => x >= w[0] && x <= w[2] && y >= w[1] && y <= w[3]);
      const plot = (col, ox, oy) => (x, y) => { g.globalAlpha = behind(x, y) ? 0.28 : 1; g.fillStyle = col; g.fillRect(x + ox, y + oy, 1, 1); };
      for (const k of cracks) {
        const t = Math.max(0, Math.min(1, (p - k.born) / k.span)); if (!t) continue;
        let left = t * k.len;
        const core = rgba(c.core, k.depth ? 0.8 : 1), side = rgba(c.side, k.depth ? 0.7 : 1), shade = rgba(c.shade);
        for (let i = 1; i < k.pts.length && left > 0; i++) {
          const a = k.pts[i - 1], b = k.pts[i], seg = Math.hypot(b[0] - a[0], b[1] - a[1]), u = Math.min(1, left / seg); left -= seg;
          const x0 = PAD + a[0] * sx, y0 = PAD + a[1] * sy, x1 = PAD + (a[0] + (b[0] - a[0]) * u) * sx, y1 = PAD + (a[1] + (b[1] - a[1]) * u) * sy;
          line(g, x0, y0, x1, y1, plot(shade, 0, 1));
          if (!k.depth) line(g, x0, y0, x1, y1, plot(side, 1, 0));
          line(g, x0, y0, x1, y1, plot(core, 0, 0));
        }
      }
      g.globalAlpha = 1; g.restore();
    }

    // Where the words are, in ice pixels: measured when the panel is sized, not on every redraw (that would force layout).
    let wordBoxes = null;
    function measureWords() {
      const hb = host.getBoundingClientRect();
      return (wordBoxes = [...host.querySelectorAll("h2, .q-hint, .eyebrow")].map(e => e.getBoundingClientRect()).filter(r => r.width)
        .map(r => [(r.left - hb.left) / PX + PAD - 2, (r.top - hb.top) / PX + PAD - 1, (r.right - hb.left) / PX + PAD + 2, (r.bottom - hb.top) / PX + PAD + 1]));
    }
    function size() {
      const r = host.getBoundingClientRect(); if (!r.width) return false;
      const w = Math.ceil(r.width / PX) + PAD * 2, h = Math.ceil(r.height / PX) + PAD * 2;
      if (w === W && h === H && base) return true;
      W = w; H = h; canvas.width = W; canvas.height = H; wordBoxes = null;
      canvas.style.width = W * PX + "px"; canvas.style.height = H * PX + "px"; canvas.style.left = canvas.style.top = -PAD * PX + "px";
      paintBase(); drawn = -1; if (state === "idle") draw(progress); return true;
    }
    const ro = window.ResizeObserver ? new ResizeObserver(() => { if (state !== "gone") size(); }) : null; if (ro) ro.observe(host);

    const api = {
      look: () => key,
      // A new question: new cracks, and the panel forms.
      // The panel stays clear (no ice, no words) until form() is called, which reveals it; a safety net makes sure it
      // never stays hidden.
      reset(id) { seed = hash(id) || 1; wordBoxes = null; cracks = planCracks(); base = null; W = 0; progress = 0; drawn = -1; cancelAnimationFrame(anim); clearTimeout(guard);
        state = "waiting"; host.classList.remove("shattered", "dissolved"); host.classList.add("forming"); size(); g.clearRect(0, 0, W, H);
        guard = setTimeout(() => { if (state === "waiting") api.form(); }, 4000); },
      // About ten redraws a second at most: the cracks still grow smoothly.
      set(f) { const p = spread(f); if (Math.abs(p - drawn) < 0.004 && drawn >= 0) return; progress = p; drawn = p; if (state === "idle") draw(p); },
      // The panel crystallises: frost grows from the edges inward, then the words appear.
      form() {
        cancelAnimationFrame(anim); clearTimeout(guard); state = "forming"; host.classList.add("forming"); host.classList.remove("shattered", "dissolved");
        if (!size() || reduced()) { state = "idle"; host.classList.remove("forming"); draw(progress); return Promise.resolve(); }
        const T = 480, t0 = performance.now(), R = rng(seed ^ 0x77), mask = new Float32Array(W * H);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const d = Math.min(x, W - 1 - x, (y) * 2.2, (H - 1 - y) * 2.2) / (Math.min(W, H * 2.2) / 2); mask[y * W + x] = Math.min(1, d * 0.75 + R() * 0.3); }
        return new Promise(done => {
          const step = now => {
            const k = Math.min(1, (now - t0) / T);
            draw(progress); const img = g.getImageData(0, 0, W, H), a = img.data;
            for (let i = 0; i < W * H; i++) if (mask[i] > k * 1.05) { const edge = mask[i] < k * 1.05 + 0.08; a[i * 4 + 3] = edge ? 140 : 0; if (edge) { a[i * 4] = a[i * 4 + 1] = a[i * 4 + 2] = 240; } }
            g.putImageData(img, 0, 0);
            if (k < 1) anim = requestAnimationFrame(step); else { state = "idle"; host.classList.remove("forming"); draw(progress); done(); }
          };
          anim = requestAnimationFrame(step);
        });
      },
      // All guesses used: the ice clears away, pixel by pixel.
      dissolve() {
        cancelAnimationFrame(anim); if (state === "gone") return; state = "gone"; host.classList.add("dissolved");
        if (!W || reduced()) { g.clearRect(0, 0, W, H); return; }
        const T = 440, t0 = performance.now(), R = rng(seed ^ 0x3c), order = new Float32Array(W * H); for (let i = 0; i < order.length; i++) order[i] = R();
        draw(progress); const start = g.getImageData(0, 0, W, H);
        const step = now => {
          const k = Math.min(1, (now - t0) / T), img = new ImageData(new Uint8ClampedArray(start.data), W, H), a = img.data;
          for (let i = 0; i < W * H; i++) { const y = (i / W) | 0, lift = order[i] * 0.8 + (1 - y / H) * 0.2; if (lift < k) a[i * 4 + 3] = 0; else if (lift < k + 0.06) { a[i * 4] = a[i * 4 + 1] = a[i * 4 + 2] = 255; a[i * 4 + 3] = 160; } }
          g.putImageData(img, 0, 0); if (k < 1) anim = requestAnimationFrame(step); else g.clearRect(0, 0, W, H);
        };
        anim = requestAnimationFrame(step);
      },
      // Time's up: one last crack runs right through, and the panel falls apart. Runs alongside the game's own
      // timeout (which is already recorded); it never holds anything up.
      shatter() {
        cancelAnimationFrame(anim); if (state === "gone" || !W) return; state = "gone"; host.classList.add("shattered");
        draw(1); if (reduced()) { g.clearRect(0, 0, W, H); return; }
        const box = canvas.getBoundingClientRect(), fly = document.createElement("canvas"), FALL = 260;
        fly.className = "frost-fly"; fly.width = W; fly.height = H + FALL / PX; Object.assign(fly.style, { left: box.left + "px", top: box.top + "px", width: W * PX + "px", height: (H * PX + FALL) + "px" });
        document.body.append(fly); const f = fly.getContext("2d"), src = document.createElement("canvas"); src.width = W; src.height = H; src.getContext("2d").drawImage(canvas, 0, 0);
        g.clearRect(0, 0, W, H);
        // Pieces: a jittered grid, each piece a quadrilateral with its own push, spin and weight.
        const R = rng(seed ^ 0xa5), cols = Math.max(4, Math.round(W / 34)), rows = 3, P = [];
        const pt = []; for (let j = 0; j <= rows; j++) { pt[j] = []; for (let i = 0; i <= cols; i++) pt[j][i] = [W * i / cols + (i && i < cols ? (R() - 0.5) * W / cols * 0.6 : 0), H * j / rows + (j && j < rows ? (R() - 0.5) * H / rows * 0.6 : 0)]; }
        for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
          const q = [pt[j][i], pt[j][i + 1], pt[j + 1][i + 1], pt[j + 1][i]], cx = q.reduce((s, p) => s + p[0], 0) / 4, cy = q.reduce((s, p) => s + p[1], 0) / 4;
          P.push({ q, cx, cy, vx: (cx / W - 0.5) * 40 + (R() - 0.5) * 20, vy: -10 - R() * 25, spin: (R() - 0.5) * 3, delay: R() * 0.12 + (1 - cy / H) * 0.05 });
        }
        const dust = Array.from({ length: 26 }, () => ({ x: R() * W, y: R() * H, vx: (R() - 0.5) * 30, vy: -R() * 30, life: 0.5 + R() * 0.5 }));
        const T = 620, t0 = performance.now();
        const step = now => {
          const s = (now - t0) / 1000, k = Math.min(1, (now - t0) / T); f.clearRect(0, 0, fly.width, fly.height);
          for (const p of P) {
            const t = Math.max(0, s - p.delay), x = p.vx * t, y = p.vy * t + 0.5 * 520 * t * t, a = p.spin * t;
            f.save(); f.globalAlpha = Math.max(0, 1 - Math.max(0, k - 0.55) / 0.45); f.translate(p.cx + x, p.cy + y); f.rotate(a); f.translate(-p.cx, -p.cy);
            f.beginPath(); p.q.forEach((v, i) => i ? f.lineTo(v[0], v[1]) : f.moveTo(v[0], v[1])); f.closePath(); f.clip(); f.drawImage(src, 0, 0);
            f.restore();
          }
          for (const d of dust) { const t = s; if (t > d.life) continue; f.globalAlpha = 1 - t / d.life; f.fillStyle = "#eaf6ff"; f.fillRect(Math.round(d.x + d.vx * t), Math.round(d.y + d.vy * t + 200 * t * t), 1, 1); }
          f.globalAlpha = 1;
          if (k < 1) anim = requestAnimationFrame(step); else fly.remove();
        };
        anim = requestAnimationFrame(step);
      },
      destroy() { cancelAnimationFrame(anim); if (ro) ro.disconnect(); canvas.remove(); },
    };
    return api;
  }
  window.Frost = { create, LOOKS };
})();
