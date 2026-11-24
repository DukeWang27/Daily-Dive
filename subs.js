// The racers' submarines: small pixel-art craft drawn at the same pixel size as the rest of the world.
// Each one is built from parts (hull, tower, fins, lamp, propeller) in its racer's colour, so new designs can be
// added later by adding parts, without touching the race.
//   SubArt.draw(g, x, y, look, t, o)   look = SubArt.look(seat): { hull, shape }; o: { thrust 0..1, dir, alpha }
//   SubArt.lights(L, x, y, look, t, o) draws its windows and lamp onto the light layer (seen through the dark)
(function () {
  "use strict";
  // One colour per seat: soft, cool-leaning tones that sit with the sea, distinct enough to tell apart at a glance.
  const HULLS = [
    { name: "ice", base: "#e3eef6", hi: "#ffffff", lo: "#9db3c7", trim: "#5e7690" },
    { name: "aqua", base: "#5fd8c8", hi: "#a8f5ea", lo: "#2f9a8e", trim: "#1d6560" },
    { name: "coral", base: "#ee9a82", hi: "#ffc9b8", lo: "#b8634f", trim: "#7d3d31" },
    { name: "sand", base: "#e2c08a", hi: "#f6e2bd", lo: "#a98652", trim: "#6e5532" },
    { name: "kelp", base: "#98cc7e", hi: "#cdeeba", lo: "#5f914a", trim: "#3d602f" },
    { name: "sky", base: "#7fbde9", hi: "#c2e3fa", lo: "#4880b0", trim: "#2c5378" },
    { name: "lilac", base: "#b6a3e6", hi: "#ddd2fb", lo: "#7a67ad", trim: "#4e4278" },
    { name: "rose", base: "#ea92b0", hi: "#fbc7d8", lo: "#ad5a77", trim: "#723a4f" },
  ];
  const SHAPES = ["scout", "bathy", "torpedo"];   // three hull designs, one per seat in turn
  const look = seat => ({ hull: HULLS[((seat % 8) + 8) % 8], shape: SHAPES[((seat % 3) + 3) % 3], seat });

  const px = (g, x, y, c, w = 1, h = 1) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
  // A rounded hull from rows of half-widths: the shape is defined once and shaded by row.
  function hull(g, x, y, rows, H) {
    rows.forEach(([l, r], i) => {
      const c = i === 0 ? H.hi : i === 1 ? H.hi : i >= rows.length - 2 ? H.lo : H.base;
      px(g, x + l, y + i, c, r - l, 1);
      px(g, x + l, y + i, H.trim, 1, 1); px(g, x + r - 1, y + i, i < rows.length / 2 ? H.hi : H.lo, 1, 1);
    });
  }
  // Each design faces right; x, y is the craft's centre.
  const DESIGNS = {
    scout: { w: 26, h: 13, rows: [[7, 17], [4, 21], [2, 23], [1, 24], [1, 24], [2, 23], [4, 21], [7, 17]], top: 4, tower: [10, 15], windows: [[8, 6], [12, 6], [16, 6]], lamp: [24, 7] },
    bathy: { w: 22, h: 14, rows: [[6, 15], [3, 18], [2, 19], [1, 20], [1, 20], [1, 20], [2, 19], [3, 18], [6, 15]], top: 4, tower: [8, 13], windows: [[10, 7]], big: true, lamp: [20, 8] },
    torpedo: { w: 30, h: 11, rows: [[6, 22], [3, 26], [1, 28], [1, 28], [3, 26], [6, 22]], top: 4, tower: [12, 17], windows: [[9, 6], [13, 6], [17, 6], [21, 6]], lamp: [28, 6] },
  };
  function draw(g, cx, cy, lk, t, o = {}) {
    const D = DESIGNS[lk.shape], H = lk.hull, dir = o.dir || 1, thrust = o.thrust || 0;
    const bob = Math.round(Math.sin(t * 1.6 + lk.seat) * (1 - thrust) * 1.2);
    const x0 = Math.round(cx - D.w / 2), y0 = Math.round(cy - D.h / 2) + bob;
    g.save(); g.globalAlpha = o.alpha == null ? 1 : o.alpha;
    if (dir < 0) { g.translate(x0 * 2 + D.w, 0); g.scale(-1, 1); }
    const hy = y0 + D.top;
    // Tower (the "sail") with a small periscope, then the hull.
    px(g, x0 + D.tower[0], hy - 3, H.lo, D.tower[1] - D.tower[0], 3); px(g, x0 + D.tower[0], hy - 3, H.base, D.tower[1] - D.tower[0] - 1, 1);
    px(g, x0 + D.tower[0] + 1, hy - 5, H.trim, 1, 2); px(g, x0 + D.tower[0] + 1, hy - 5, H.trim, 3, 1);
    hull(g, x0, hy, D.rows, H);
    // A stripe and rivets, so the hull reads as built, not drawn.
    const mid = hy + Math.floor(D.rows.length / 2);
    px(g, x0 + D.rows[0][0], mid, H.trim, D.rows[0][1] - D.rows[0][0], 1);
    // Fins at the stern, and the propeller: three frames, faster with thrust.
    px(g, x0 - 1, hy + 1, H.lo, 3, 1); px(g, x0 - 1, hy + D.rows.length - 2, H.lo, 3, 1);
    const f = Math.floor(t * (8 + thrust * 22)) % 3, pxl = x0 - 3, pyc = hy + Math.floor(D.rows.length / 2);
    px(g, pxl + 1, pyc, "#3a4a5e", 2, 1);
    if (f === 0) { px(g, pxl, pyc - 2, "#c9d6e3", 1, 2); px(g, pxl, pyc + 1, "#c9d6e3", 1, 2); }
    else if (f === 1) { px(g, pxl, pyc - 1, "#c9d6e3", 1, 3); }
    else { px(g, pxl - 1, pyc - 2, "#8fa3b8", 1, 1); px(g, pxl, pyc, "#c9d6e3", 1, 1); px(g, pxl - 1, pyc + 2, "#8fa3b8", 1, 1); }
    // Windows: dark glass with a lit centre (the light itself is drawn on the light layer).
    for (const [wx, wy] of D.windows) { px(g, x0 + wx - 1, hy + wy - 4, H.trim, 3, 3); px(g, x0 + wx, hy + wy - 3, "#ffe7a8", 1, 1); }
    if (D.big) { px(g, x0 + D.windows[0][0] - 2, hy + D.windows[0][1] - 5, H.trim, 5, 5); px(g, x0 + D.windows[0][0] - 1, hy + D.windows[0][1] - 4, "#2a3a4f", 3, 3); px(g, x0 + D.windows[0][0], hy + D.windows[0][1] - 3, "#ffe7a8", 1, 1); }
    // The lamp at the bow.
    px(g, x0 + D.lamp[0], hy + D.lamp[1] - 4, "#f4fbff", 1, 2);
    g.restore();
    return { x0, y0, w: D.w, h: D.h, stern: dir > 0 ? x0 - 3 : x0 + D.w + 3, bow: dir > 0 ? x0 + D.w : x0, mid: hy + Math.floor(D.rows.length / 2) };
  }
  // Lit windows and a forward beam, on the light layer (screen-blended over the dark). Brighter in deep water.
  function lights(L, cx, cy, lk, t, o = {}) {
    const D = DESIGNS[lk.shape], dir = o.dir || 1, k = o.dark == null ? 1 : o.dark, thrust = o.thrust || 0;
    const bob = Math.round(Math.sin(t * 1.6 + lk.seat) * (1 - thrust) * 1.2);
    const x0 = Math.round(cx - D.w / 2), y0 = Math.round(cy - D.h / 2) + bob, hy = y0 + D.top;
    const X = x => dir > 0 ? x0 + x : x0 + D.w - 1 - x;
    L.globalAlpha = 0.9 * k;
    for (const [wx, wy] of D.windows) { L.fillStyle = "#ffe7a8"; L.fillRect(X(wx), hy + wy - 3, 1, 1); L.globalAlpha = 0.25 * k; L.fillRect(X(wx) - 1, hy + wy - 3, 3, 1); L.fillRect(X(wx), hy + wy - 4, 1, 3); L.globalAlpha = 0.9 * k; }
    // The beam: a widening cone of faint light ahead and slightly down, in rows, so it stays pixel art.
    const bx = X(D.lamp[0]), by = hy + D.lamp[1] - 3, len = 46;
    for (let i = 1; i < len; i++) {
      const spread = 1 + i * 0.42, a = 0.13 * k * Math.pow(1 - i / len, 1.6);
      L.globalAlpha = a; L.fillStyle = "#cfeeff";
      L.fillRect(bx + dir * i, Math.round(by + i * 0.18 - spread / 2), 1, Math.max(1, Math.round(spread)));
    }
    L.globalAlpha = 0.5 * k; L.fillStyle = "#f4fbff"; L.fillRect(bx, by, 1, 2);
    L.globalAlpha = 1;
  }
  const size = lk => DESIGNS[lk.shape];
  window.SubArt = { look, draw, lights, size, HULLS, SHAPES };
})();
