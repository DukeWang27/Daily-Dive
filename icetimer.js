// The melting-ice timer: a small icicle beside the answer box that is the question's clock.
// It is drawn fresh each frame from the fraction of time left, so what you see is always the real remaining time:
// the icicle shortens and thins, a smaller one beside it goes first, drops fall from the tip a little more often as
// time runs down, and the meltwater gathers underneath. When the time is gone the last of it lets go and dissolves.
// Pixel art on a tiny canvas (one art pixel = two screen pixels), in the same ice colours as the iceberg.
(function () {
  "use strict";
  const W = 17, H = 22, CX = 8.5;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Light falls from the upper left, as on the iceberg.
  const TONES = ["#f6fbff", "#dcefff", "#bcdcf6", "#93c3ea"];
  const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));

  function create(canvas) {
    canvas.width = W; canvas.height = H;
    const g = canvas.getContext("2d"), img = g.createImageData(W, H), px = img.data;
    let frac = 1, paused = true, urgent = 0, raf = 0, last = 0, t = 0, nextDrip = 2, drops = [], ripple = 0, gone = 0, shown = -1;

    // Blend one art pixel over what is already there.
    const put = (x, y, c, a) => {
      if (x < 0 || y < 0 || x >= W || y >= H || a <= 0) return;
      const i = (y * W + x) * 4, k = Math.min(1, a), b = px[i + 3] / 255, out = k + b * (1 - k);
      for (let j = 0; j < 3; j++) px[i + j] = (c[j] * k + px[i + j] * b * (1 - k)) / out;
      px[i + 3] = out * 255;
    };
    // One icicle: widest where it joins the ledge, tapering to a tip. Edges are softened by coverage, so it shrinks
    // smoothly rather than a whole pixel at a time.
    function icicle(cx, top, len, half, lean, bright) {
      if (len <= 0.2) return;
      for (let y = 0; y < Math.ceil(len + 1); y++) {
        const u = y / len, hw = half * Math.pow(Math.max(0, 1 - u), 0.72) + 0.25 * (1 - u), xc = cx + lean * u * u, ay = Math.max(0, Math.min(1, len - y + 0.35));
        if (hw <= 0 || ay <= 0) continue;
        for (let x = Math.floor(xc - hw - 1); x <= Math.ceil(xc + hw + 1); x++) {
          const d = x + 0.5 - xc, cov = Math.max(0, Math.min(1, hw - Math.abs(d) + 0.5)) * ay; if (cov <= 0) continue;
          const s = d / (hw + 0.01), tone = s < -0.35 ? 0 : s < 0.2 ? 1 : s < 0.62 ? 2 : 3;
          put(x, top + y, rgb(TONES[Math.max(0, tone - (bright && tone > 0 && y < len * 0.5 ? 1 : 0))]), cov * 0.96);
        }
      }
    }
    function paint() {
      px.fill(0);
      const f = gone ? 0 : frac, melt = 1 - f, water = [118, 196, 240], glint = [226, 244, 255];
      // Meltwater gathering underneath.
      const level = 1 + 2.4 * melt + (gone ? 0.6 : 0), surface = H - level;
      for (let y = Math.floor(surface); y < H; y++) for (let x = 1; x < W - 1; x++) {
        const a = Math.max(0, Math.min(1, y + 1 - surface)) * (0.34 + 0.3 * (y - surface) / (level + 0.01));
        put(x, y, water, a * (x === 1 || x === W - 2 ? 0.5 : 1));
      }
      const sy = Math.floor(surface);
      for (let x = 2; x < W - 2; x++) if ((x * 7 + Math.floor(t * 1.5)) % 5 === 0) put(x, sy, glint, 0.35);
      if (ripple > 0) { const r = Math.round((1 - ripple) * 4) + 1, cx = Math.round(tipX()); for (const dx of [-r, r]) put(cx + dx, sy, glint, ripple * 0.9); put(cx, sy, glint, ripple * 0.5); }
      // The frosted ledge the ice hangs from, thinning as it goes.
      const ledge = 1 + 1.3 * f;
      for (let x = 1; x < W - 1; x++) { const jag = ((x * 5) % 3 === 0 ? 0.6 : 0) * f, h = ledge + jag; for (let y = 0; y < Math.ceil(h); y++) put(x, y, rgb(y === 0 ? TONES[0] : TONES[1]), Math.min(1, h - y) * (0.55 + 0.4 * f)); }
      // Three icicles. The small ones are gone well before the big one.
      const flash = urgent > 0 && Math.sin(t * 5) > 0.2;
      icicle(CX - 4.6, 1, 8.5 * Math.max(0, (f - 0.38) / 0.62), 0.9 + 1.2 * f, -0.3, false);
      icicle(CX + 4.4, 1, 5.5 * Math.max(0, (f - 0.62) / 0.38), 0.8 + 0.9 * f, 0.3, false);
      if (!gone) icicle(CX, 1, mainLen(), 1.5 + 2.6 * Math.pow(f, 0.6), 0.5, flash);
      // A drop swelling at the tip, and drops on their way down.
      for (const d of drops) { put(Math.round(d.x - 0.5), Math.round(d.y), [200, 232, 255], 0.95); if (d.v > 6 || d.big) put(Math.round(d.x - 0.5), Math.round(d.y) - 1, [170, 216, 250], 0.6); if (d.big) put(Math.round(d.x - 0.5) + 1, Math.round(d.y), [170, 216, 250], 0.7); }
      g.putImageData(img, 0, 0);
    }
    const mainLen = () => 2.4 + 14.2 * frac;
    const tipX = () => CX + 0.5;
    const tipY = () => 1 + mainLen();

    function frame(now) {
      raf = requestAnimationFrame(frame);
      if (canvas.offsetParent === null) { last = now; return; }
      const dt = Math.min(0.1, (now - last) / 1000 || 0.016); last = now;
      if (paused && !drops.length && ripple <= 0 && !gone) { if (shown !== frac) { paint(); shown = frac; } return; }
      t += dt;
      // Drops come a little more often as the ice runs out: one every three seconds at first, about one a second at the end.
      if (!paused && !gone && frac > 0) { nextDrip -= dt; if (nextDrip <= 0) { release(false); nextDrip = 0.9 + 2.3 * Math.pow(frac, 1.3); } }
      const floor = H - (1 + 2.4 * (1 - frac)) - 1;
      for (const d of drops) { d.v += 70 * dt; d.y += d.v * dt; if (d.y >= floor) { d.dead = true; ripple = d.big ? 1.6 : 1; } }
      drops = drops.filter(d => !d.dead);
      if (ripple > 0) ripple = Math.max(0, ripple - dt * 2.4);
      if (gone && !drops.length && ripple <= 0) { paint(); cancelAnimationFrame(raf); raf = 0; return; }
      paint(); shown = frac;
    }
    function release(big) { drops.push({ x: tipX(), y: tipY(), v: 0, big }); }
    const run = () => { if (!raf && !reduce) { last = performance.now(); raf = requestAnimationFrame(frame); } else if (reduce) paint(); };

    const api = {
      // fraction: time left, 1 to 0. paused: the clock is stopped (an answer is being revealed). urgent: 0 to 1 over the last seconds.
      set(fraction, o = {}) { frac = Math.max(0, Math.min(1, fraction)); paused = !!o.paused; urgent = o.urgent || 0; gone = 0; run(); if (reduce) paint(); },
      drip() { if (!reduce && !gone) { release(false); run(); } },        // in step with the sound of the last few seconds
      // Time is up: the last of the ice lets go, falls and dissolves into the water.
      dissolve() { frac = 0; paused = true; gone = 1; if (reduce) { paint(); return; } release(true); run(); },
      reset() { frac = 1; paused = true; urgent = 0; gone = 0; drops = []; ripple = 0; nextDrip = 2; shown = -1; run(); if (reduce) paint(); },
      get fraction() { return gone ? 0 : frac; }, get length() { return gone ? 0 : mainLen(); }, get drops() { return drops.length; }, get melted() { return !!gone; },
      destroy() { cancelAnimationFrame(raf); raf = 0; },
    };
    paint();
    return api;
  }
  window.IceTimer = { create };
})();
