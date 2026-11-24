// The sea behind every screen. A small pixel canvas (one art pixel = 3-4 screen pixels) redrawn at ~30 fps:
// night sky, distant icebergs on the horizon, slow light shafts and drifting "marine snow". The horizon moves with
// the game's mood: high on the home screen, near the top while answering (just under the surface), gone in the deep.
(function () {
  "use strict";
  const canvas = document.getElementById("sea");
  if (!canvas) return;
  const g = canvas.getContext("2d");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const MOODS = { home: 0.5, preview: 0.2, round: 0.17, results: -0.06, end: 0.42 };
  let settled = false, W = 0, H = 0, px = 4, horizon = 0.5, target = 0.5, urgency = 0, urgencyNow = 0, t0 = performance.now(), last = 0, raf = 0;
  let stars = [], snow = [], bergs = [];

  // Small deterministic random, so the scenery is the same on every visit.
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const rgb = c => `rgb(${c[0]},${c[1]},${c[2]})`;

  function resize() {
    px = 3;
    W = Math.ceil(innerWidth / px); H = Math.ceil(innerHeight / px);
    canvas.width = W; canvas.height = H;
    seed = 7; stars = Array.from({ length: Math.round(W * H / 900) }, () => ({ x: Math.floor(rnd() * W), y: rnd(), b: rnd(), tw: rnd() * 6.28 }));
    snow = Array.from({ length: Math.round(W * H / 1400) }, () => ({ x: rnd() * W, y: rnd(), v: 0.004 + rnd() * 0.01, a: 0.2 + rnd() * 0.45, ph: rnd() * 6.28 }));
    bergs = [[0.035, 0.08, 0.05], [0.8, 0.14, 0.09], [0.95, 0.06, 0.04]].map(([x, w, h]) => ({ x: x * W, w: Math.max(14, w * W), h: Math.max(6, h * W * 0.5) }));
    draw(performance.now());
  }

  function draw(now) {
    const t = (now - t0) / 1000;
    horizon += (target - horizon) * (reduce ? 1 : 0.05);
    urgencyNow += (urgency - urgencyNow) * 0.08;
    const hy = Math.round(horizon * H);
    // Sky: stepped bands, darker at the top.
    const skyBands = 8;
    for (let i = 0; i < skyBands; i++) {
      const y0 = Math.round(i * hy / skyBands), y1 = Math.round((i + 1) * hy / skyBands);
      g.fillStyle = rgb(mix([4, 8, 24], [20, 40, 82], i / (skyBands - 1))); g.fillRect(0, y0, W, y1 - y0);
    }
    for (const s of stars) {
      const y = Math.round(s.y * hy * 0.92); if (y >= hy - 2) continue;
      const tw = reduce ? 0.7 : 0.5 + 0.5 * Math.sin(t * 0.8 + s.tw);
      g.fillStyle = s.b > 0.85 ? `rgba(255,255,255,${0.35 + tw * 0.4})` : `rgba(150,180,225,${0.15 + tw * 0.25})`;
      g.fillRect(s.x, y, 1, 1);
    }
    // Water: bands falling to near-black, darker as time runs out.
    const deep = [2, 5, 14], top = mix([16, 64, 108], [10, 36, 70], urgencyNow * 0.6);
    const band = Math.max(2, Math.round(H / 60));
    for (let y = hy; y < H; y += band) {
      const k = (y - hy) / Math.max(1, H - hy);
      g.fillStyle = rgb(mix(top, deep, Math.min(1, Math.pow(k, 0.7) * 1.05))); g.fillRect(0, y, W, band);
    }
    // Distant icebergs on the horizon, with a faint reflection.
    if (hy > 4) for (const b of bergs) {
      const peak = Math.round(b.x - b.w * 0.12);
      for (let y = 0; y < b.h; y++) {
        const k = y / b.h, half = b.w / 2 * (0.15 + 0.85 * k), cx = peak + (b.x - peak) * k;
        const l = Math.round(cx - half), r = Math.round(cx + half);
        g.fillStyle = "#1c3558"; g.fillRect(l, hy - b.h + y, r - l, 1);
        g.fillStyle = "#35587f"; g.fillRect(Math.round(cx), hy - b.h + y, Math.max(1, Math.round((r - cx) * 0.8)), 1); // moonlit side
        g.globalAlpha = 0.18 * (1 - k); g.fillStyle = "#4d77a3"; g.fillRect(l, hy + b.h - y, r - l, 1); g.globalAlpha = 1;
      }
    }
    // Horizon glint and slow shimmer lines just under the surface.
    if (hy > 0 && hy < H) {
      g.fillStyle = "rgba(160,205,240,.22)"; g.fillRect(0, hy, W, 1);
      for (let i = 0; i < 14; i++) {
        const y = hy + 2 + (i % 5) * 2 + Math.floor(i / 5);
        const x = ((i * 53.7 + (reduce ? 0 : t * (i % 2 ? 2.2 : -1.6))) % (W + 20) + W + 20) % (W + 20) - 10;
        g.fillStyle = `rgba(120,180,230,${0.18 - (i % 5) * 0.025})`; g.fillRect(Math.round(x), y, 4 + (i % 3) * 2, 1);
      }
    }
    // Light shafts from the surface, swaying very slowly.
    const shaftAlpha = 0.045 * (1 - urgencyNow * 0.6) * Math.min(1, (H - hy) / (H * 0.4));
    if (shaftAlpha > 0.003) {
      g.fillStyle = `rgba(150,210,250,${shaftAlpha})`;
      [[0.22, 0.05], [0.5, 0.03], [0.7, 0.06]].forEach(([fx, fw], i) => {
        const sway = reduce ? 0 : Math.sin(t * 0.15 + i * 2) * W * 0.03;
        const x = fx * W + sway, w = fw * W, len = H - hy;
        g.beginPath(); g.moveTo(x, hy); g.lineTo(x + w, hy); g.lineTo(x + w - len * 0.35, H); g.lineTo(x - len * 0.35, H); g.closePath(); g.fill();
      });
    }
    // Marine snow: tiny specks drifting down through the water.
    for (const s of snow) {
      const y = hy + ((s.y + (reduce ? 0 : t * s.v)) % 1) * (H - hy);
      const x = s.x + (reduce ? 0 : Math.sin(t * 0.4 + s.ph) * 1.5);
      g.fillStyle = `rgba(190,225,255,${s.a * 0.32})`; g.fillRect(Math.round(x), Math.round(y), 1, 1);
    }
  }

  function loop(now) {
    raf = requestAnimationFrame(loop);
    if (now - last < 33) return; // ~30 fps is plenty for slow water
    last = now; draw(now);
  }
  function start() { cancelAnimationFrame(raf); if (reduce) { draw(performance.now()); return; } raf = requestAnimationFrame(loop); }
  addEventListener("resize", resize);
  document.addEventListener("visibilitychange", () => { if (document.hidden) cancelAnimationFrame(raf); else start(); });
  resize(); start();

  window.Sea = {
    homeLine(f) { MOODS.home = Math.max(0.2, Math.min(0.8, f)); if (target !== MOODS.round && document.querySelector('[data-screen="home"]:not([hidden])')) { target = MOODS.home; if (!settled) { settled = true; horizon = target; } if (reduce) { horizon = target; draw(performance.now()); } } },
    mood(name) {
      // While playing, the surface sits just under the header: everything you do happens underwater.
      const top = document.querySelector(".top");
      if (top && (name === "round" || name === "end")) MOODS[name] = (top.getBoundingClientRect().bottom + 2) / innerHeight;
      target = MOODS[name] ?? 0.4; if (reduce) { horizon = target; draw(performance.now()); }
    },
    urgency(u) { urgency = Math.max(0, Math.min(1, u)); },
  };
})();
