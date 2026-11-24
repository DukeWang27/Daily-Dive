// Iceberg sound. Everything is synthesised live with the Web Audio API: no files to download, nothing to license.
// Design: soft, rounded tones (sines, filtered noise, glassy bell partials) through a shared room reverb, so every
// sound feels like it belongs to the same cold, quiet sea. No square waves, no arcade beeps.
//
// Signal path:  voices -> sfx bus ─┐
//                         reverb ──┼─> master (mute) -> gentle compressor -> speakers
//               ambience -> amb bus┘
// The AudioContext is created on the first tap or key press (browsers block sound before that) and everything
// fails silently: with audio unavailable or muted, the game behaves exactly the same.
(function () {
  "use strict";
  const KEY = "iceberg:audio";
  const prefs = Object.assign({ muted: false, sfx: 0.8, amb: 0.55 }, (() => { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; } })());
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* private mode */ } };

  let ctx = null, out = null;
  const listeners = new Set();

  // ---------- Building blocks ----------
  function makeImpulse(c, seconds, decay) {
    const rate = c.sampleRate, len = Math.floor(rate * seconds), buf = c.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch); let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len, k = 0.15 + 0.8 * t; // the tail gets darker as it fades, like a big cold room
        lp += (Math.random() * 2 - 1 - lp) * (1 - k);
        d[i] = lp * Math.pow(1 - t, decay) * (i < rate * 0.012 ? i / (rate * 0.012) : 1);
      }
    }
    return buf;
  }
  function makeNoise(c, seconds, brown) {
    const len = Math.floor(c.sampleRate * seconds), buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; if (brown) { b = (b + 0.02 * w) / 1.02; d[i] = b * 3.5; } else d[i] = w; }
    if (brown) { const fade = Math.floor(c.sampleRate * 0.05); for (let i = 0; i < fade; i++) { const k = i / fade; d[len - fade + i] = d[len - fade + i] * (1 - k) + d[i] * k; } }
    return buf;
  }
  // A graph (buses + reverb) for any context: the live one, or an offline one used by the self-test.
  function buildGraph(c) {
    const g = {
      c, master: c.createGain(), sfx: c.createGain(), amb: c.createGain(), verb: c.createConvolver(), verbIn: c.createGain(),
      comp: c.createDynamicsCompressor(), white: makeNoise(c, 2, false), brown: makeNoise(c, 6, true), voices: [],
    };
    g.verb.buffer = makeImpulse(c, 3.2, 2.6);
    g.verbIn.gain.value = 0.9;
    g.comp.threshold.value = -16; g.comp.knee.value = 12; g.comp.ratio.value = 3; g.comp.attack.value = 0.004; g.comp.release.value = 0.25;
    g.sfx.connect(g.master); g.amb.connect(g.master); g.verbIn.connect(g.verb); g.verb.connect(g.master);
    g.master.connect(g.comp); g.comp.connect(c.destination);
    return g;
  }
  function env(param, t, peak, attack, decay, from = 0.0001) {
    param.cancelScheduledValues(t); param.setValueAtTime(from, t);
    param.linearRampToValueAtTime(peak, t + attack);
    param.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }
  // One tone: an oscillator with an envelope, optional pitch glide and filter, sent dry and to the reverb.
  function tone(g, { type = "sine", f, f0, glide = 0.02, t, gain = 0.2, attack = 0.004, decay = 0.3, wet = 0.2, lp, pan = 0 }) {
    const c = g.c, o = c.createOscillator(), a = c.createGain(); let last = a;
    o.type = type;
    if (f0) { o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f, t + glide); } else o.frequency.setValueAtTime(f, t);
    o.connect(a);
    if (lp) { const fl = c.createBiquadFilter(); fl.type = "lowpass"; fl.frequency.value = lp; fl.Q.value = 0.4; a.connect(fl); last = fl; }
    if (pan && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = pan; last.connect(p); last = p; }
    last.connect(g.sfx);
    if (wet) { const w = c.createGain(); w.gain.value = wet; last.connect(w); w.connect(g.verbIn); }
    env(a.gain, t, gain, attack, decay);
    o.start(t); o.stop(t + attack + decay + 0.05);
    return { o, a, end: t + attack + decay };
  }
  // Filtered noise burst (splashes, whooshes, clicks). sweep: [fromHz, toHz] for the filter.
  function noise(g, { t, dur, gain = 0.1, type = "bandpass", f = 1000, sweep, q = 0.8, attack = 0.005, wet = 0.2, brown = false, dest }) {
    const c = g.c, s = c.createBufferSource(), fl = c.createBiquadFilter(), a = c.createGain();
    s.buffer = brown ? g.brown : g.white; s.loop = true;
    fl.type = type; fl.Q.value = q;
    if (sweep) { fl.frequency.setValueAtTime(sweep[0], t); fl.frequency.exponentialRampToValueAtTime(sweep[1], t + dur); } else fl.frequency.value = f;
    s.connect(fl); fl.connect(a); a.connect(dest || g.sfx);
    if (wet) { const w = c.createGain(); w.gain.value = wet; a.connect(w); w.connect(g.verbIn); }
    env(a.gain, t, gain, attack, Math.max(0.01, dur - attack));
    s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
  }
  // Glassy bell: inharmonic partials that fade at different speeds. The signature sound of the reveal.
  function bell(g, { f, t, gain = 0.14, decay = 1.6, wet = 0.45, bright = 1, pan = 0 }) {
    const partials = [[1, 1, 1], [2.756, 0.42 * bright, 0.55], [5.404, 0.18 * bright, 0.3], [8.933, 0.07 * bright, 0.18]];
    partials.forEach(([ratio, amp, life]) => { if (f * ratio < 12000) tone(g, { f: f * ratio, t, gain: gain * amp, attack: 0.003, decay: decay * life, wet, pan }); });
    tone(g, { f: f * 0.5, t, gain: gain * 0.25, attack: 0.01, decay: decay * 0.7, wet: wet * 0.6 }); // a little body underneath
  }
  const note = n => 440 * Math.pow(2, (n - 69) / 12); // MIDI note -> Hz

  // ---------- The sound set ----------
  // Every sound is a function of (graph, startTime, options) so the self-test can render it offline.
  const PENTA = [76, 79, 81, 83, 86, 88, 91]; // E5 G5 A5 B5 D6 E6 G6: any order sounds pleasant
  const SOUNDS = {
    hover(g, t) { noise(g, { t, dur: 0.025, gain: 0.013, type: "highpass", f: 5000, wet: 0 }); },
    click(g, t) {
      tone(g, { f: 620, f0: 900, glide: 0.03, t, gain: 0.1, decay: 0.07, wet: 0.08 });
      noise(g, { t, dur: 0.02, gain: 0.03, f: 3500, q: 1.2, wet: 0 });
    },
    // Sending a guess: a soft water-drop pluck, a step higher with each guess of the question.
    submit(g, t, o = {}) {
      const f = note([76, 79, 83][Math.min(2, o.step || 0)]);
      tone(g, { f, f0: f * 0.72, glide: 0.035, t, gain: 0.27, attack: 0.002, decay: 0.2, wet: 0.16 });
      tone(g, { type: "triangle", f: f * 2, t, gain: 0.04, attack: 0.001, decay: 0.07, wet: 0, lp: 6000 });
      noise(g, { t, dur: 0.012, gain: 0.02, f: 5200, q: 2, wet: 0 });
    },
    // The last guess of a question: the same drop, with a low double pulse under it.
    final(g, t) {
      SOUNDS.submit(g, t, { step: 2 });
      tone(g, { f: 62, f0: 80, glide: 0.08, t: t + 0.02, gain: 0.2, attack: 0.004, decay: 0.22, wet: 0.15 });
      tone(g, { f: 62, f0: 76, glide: 0.08, t: t + 0.24, gain: 0.13, attack: 0.004, decay: 0.26, wet: 0.2 });
    },
    pending(g, t) { tone(g, { type: "triangle", f: note(69), t, gain: 0.12, decay: 0.16, wet: 0.2, lp: 1500 }); },
    duplicate(g, t) {
      tone(g, { f: note(69), t, gain: 0.1, decay: 0.09, wet: 0.1, lp: 1400 });
      tone(g, { f: note(64), t: t + 0.07, gain: 0.085, decay: 0.12, wet: 0.1, lp: 1200 });
    },
    invalid(g, t) {
      tone(g, { f: 105, f0: 190, glide: 0.11, t, gain: 0.22, attack: 0.003, decay: 0.16, wet: 0.08, lp: 700 });
      noise(g, { t, dur: 0.07, gain: 0.025, type: "lowpass", f: 600, wet: 0 });
    },
    start(g, t) {
      noise(g, { t, dur: 1.2, gain: 0.05, type: "lowpass", sweep: [300, 2400], attack: 0.5, wet: 0.5, brown: true });
      [62, 69, 74, 78, 81].forEach((n, i) => bell(g, { f: note(n), t: t + 0.1 + i * 0.075, gain: 0.05, decay: 2.2, wet: 0.6, bright: 0.6 }));
    },
    // Sonar ping: one clean tone with a soft echo off the ice.
    question(g, t) {
      const f = note(84);
      tone(g, { f, t, gain: 0.1, attack: 0.004, decay: 1.1, wet: 0.5 });
      tone(g, { f, t: t + 0.3, gain: 0.03, attack: 0.004, decay: 0.8, wet: 0.7, lp: 2500 });
      tone(g, { f: f / 2, t, gain: 0.04, attack: 0.01, decay: 0.6, wet: 0.3 });
    },
    // The camera sets off: water rushing past. Going down the sound sinks and darkens; coming up it lifts.
    travel(g, t, o = {}) {
      const dur = Math.max(0.5, Math.min(2.4, o.seconds || 1)), down = (o.dir || 1) > 0;
      noise(g, { t, dur: dur + 0.25, gain: 0.06, type: "lowpass", sweep: down ? [1100, 170] : [260, 1300], attack: dur * 0.35, wet: 0.45, brown: true });
      tone(g, { f: down ? 44 : 62, f0: down ? 58 : 48, glide: dur, t, gain: 0.07, attack: dur * 0.4, decay: dur * 0.8, wet: 0.2 });
    },
    // Each answer's reveal: a bell whose pitch and brightness drop with depth (0 = tip, 1 = abyss).
    reveal(g, t, o = {}) {
      const d = o.depth || 0, f = note(Math.round(86 - d * 22));
      bell(g, { f, t, gain: 0.12, decay: 1.4 + d * 1.6, wet: 0.35 + d * 0.35, bright: 1 - d * 0.5 });
    },
    // Deeper than before: the reward. A low pulse you feel, then three bells climbing, then a little light on top.
    deeper(g, t, o = {}) {
      const d = Math.min(1, o.depth || 0), root = 67 - Math.round(d * 7); // the deeper the find, the lower and fuller it sits
      tone(g, { f: 55, f0: 92, glide: 0.16, t, gain: 0.2, attack: 0.004, decay: 0.42, wet: 0.2 });
      [0, 7, 12].forEach((step, i) => bell(g, { f: note(root + step), t: t + 0.05 + i * 0.085, gain: 0.085, decay: 1.5 + d, wet: 0.5, bright: 0.75 }));
      tone(g, { f: note(root + 24), t: t + 0.32, gain: 0.03, attack: 0.02, decay: 1.2, wet: 0.8 });
    },
    // Not deeper this time: a calm, soft settle. Deliberately not a "wrong" sound.
    neutral(g, t) {
      tone(g, { type: "triangle", f: note(64), t, gain: 0.07, attack: 0.01, decay: 0.3, wet: 0.35, lp: 1400 });
      tone(g, { type: "triangle", f: note(62), t: t + 0.13, gain: 0.05, attack: 0.01, decay: 0.4, wet: 0.4, lp: 1200 });
    },
    // An exceptional find in the abyss: a slow swell from below that arrives as a wide, cold chord.
    // o.lead is how many seconds the swell lasts before the chord (timed to the camera's arrival).
    rare(g, t, o = {}) {
      const lead = Math.max(0.6, Math.min(2.6, o.lead || 1.15));
      noise(g, { t, dur: lead + 0.25, gain: 0.06, type: "lowpass", sweep: [120, 900], attack: lead * 0.9, wet: 0.6, brown: true });
      tone(g, { f: 36.7, t, gain: 0.16, attack: lead * 0.85, decay: 2.4, wet: 0.3 });
      [57, 64, 69, 71, 76, 83].forEach((n, i) => bell(g, { f: note(n), t: t + lead + i * 0.045, gain: 0.075, decay: 3.2, wet: 0.75, bright: 0.55, pan: (i % 2 ? 0.25 : -0.25) }));
    },
    // Something very large is passing: two slow, falling calls from far off. Quiet on purpose.
    encounter(g, t) {
      tone(g, { f0: 116, f: 82, glide: 1.4, t, gain: 0.075, attack: 0.5, decay: 2.6, wet: 0.85, lp: 500 });
      tone(g, { f0: 98, f: 73.4, glide: 1.6, t: t + 1.9, gain: 0.06, attack: 0.6, decay: 3, wet: 0.9, lp: 440 });
      bell(g, { f: note(88), t: t + 0.9, gain: 0.02, decay: 2.4, wet: 0.9, bright: 0.4, pan: 0.3 });
    },
    // The ice timer. A dry little crack when ten seconds are left, a water drop on each of the last five, and a soft
    // dissolve when the ice is gone. All quiet: urgency by atmosphere, never an alarm.
    crack(g, t) {
      noise(g, { t, dur: 0.05, gain: 0.07, type: "bandpass", f: 3200, q: 3, attack: 0.001, wet: 0.25 });
      noise(g, { t: t + 0.08, dur: 0.035, gain: 0.05, type: "bandpass", f: 4700, q: 4, attack: 0.001, wet: 0.3 });
      tone(g, { type: "triangle", f: 1900, t, gain: 0.018, attack: 0.001, decay: 0.05, wet: 0.2 });
    },
    drip(g, t, o = {}) { const k = o.step || 0; tone(g, { f0: 1280 + k * 70, f: 650 + k * 35, glide: 0.07, t, gain: 0.045 + k * 0.006, attack: 0.002, decay: 0.17, wet: 0.5 }); },
    melt(g, t) {
      noise(g, { t, dur: 1.1, gain: 0.045, type: "lowpass", sweep: [2200, 240], attack: 0.05, wet: 0.6 });
      tone(g, { f0: 520, f: 196, glide: 0.5, t: t + 0.05, gain: 0.055, attack: 0.02, decay: 1.2, wet: 0.6 });
      bell(g, { f: note(67), t: t + 0.35, gain: 0.03, decay: 1.6, wet: 0.7, bright: 0.4 });
    },
    round(g, t) { bell(g, { f: note(79), t, gain: 0.08, decay: 1.2, wet: 0.4, bright: 0.7 }); bell(g, { f: note(84), t: t + 0.14, gain: 0.08, decay: 1.6, wet: 0.45, bright: 0.7 }); },
    day(g, t) {
      [72, 76, 79, 84, 86, 91].forEach((n, i) => bell(g, { f: note(n), t: t + i * 0.12, gain: 0.07, decay: 2.2, wet: 0.55, bright: 0.65 }));
      noise(g, { t, dur: 1.6, gain: 0.03, type: "lowpass", sweep: [400, 2400], attack: 0.8, wet: 0.6, brown: true });
    },
  };

  // ---------- Ambience: one continuous bed whose character follows depth ----------
  // Surface: open, airy wave wash. Going down: the wash fades and darkens, a low drone grows. The abyss: near-silence,
  // a deep hum, and a rare, distant ping.
  function buildAmbience(g) {
    const c = g.c, A = { level: c.createGain() };
    A.level.gain.value = 0; A.level.connect(g.amb);
    const waves = c.createBufferSource(); waves.buffer = g.brown; waves.loop = true;
    A.waveFilter = c.createBiquadFilter(); A.waveFilter.type = "lowpass"; A.waveFilter.frequency.value = 1100; A.waveFilter.Q.value = 0.3;
    A.waveGain = c.createGain(); A.waveGain.gain.value = 0.35;
    const lfo = c.createOscillator(), lfoGain = c.createGain(); lfo.frequency.value = 0.09; lfoGain.gain.value = 0.16;
    lfo.connect(lfoGain); lfoGain.connect(A.waveGain.gain);
    waves.connect(A.waveFilter); A.waveFilter.connect(A.waveGain); A.waveGain.connect(A.level);
    const air = c.createBufferSource(); air.buffer = g.white; air.loop = true;
    A.airFilter = c.createBiquadFilter(); A.airFilter.type = "bandpass"; A.airFilter.frequency.value = 2400; A.airFilter.Q.value = 0.5;
    A.airGain = c.createGain(); A.airGain.gain.value = 0.012;
    air.connect(A.airFilter); A.airFilter.connect(A.airGain); A.airGain.connect(A.level);
    // The deep drone: two slightly detuned low sines and a soft fifth, through a closing filter.
    A.droneGain = c.createGain(); A.droneGain.gain.value = 0;
    A.droneFilter = c.createBiquadFilter(); A.droneFilter.type = "lowpass"; A.droneFilter.frequency.value = 500;
    A.droneFilter.connect(A.droneGain); A.droneGain.connect(A.level);
    A.oscs = [[55, "sine", 0.5], [55.4, "sine", 0.45], [82.4, "triangle", 0.12], [110.2, "sine", 0.08]].map(([f, type, amp]) => {
      const o = c.createOscillator(), a = c.createGain(); o.type = type; o.frequency.value = f; a.gain.value = amp; o.connect(a); a.connect(A.droneFilter); o.start(); return o;
    });
    const verbSend = c.createGain(); verbSend.gain.value = 0.25; A.droneGain.connect(verbSend); verbSend.connect(g.verbIn);
    waves.start(); air.start(); lfo.start();
    A.depth = 0; A.nextPing = 0;
    return A;
  }
  function applyDepth(A, c, d, level) {
    const t = c.currentTime, k = 0.5;
    A.waveGain.gain.setTargetAtTime(0.35 * Math.pow(1 - d, 1.6), t, k);
    A.waveFilter.frequency.setTargetAtTime(1100 - d * 850, t, k);
    A.airGain.gain.setTargetAtTime(0.012 * Math.max(0, 1 - d * 3), t, k);
    A.droneGain.gain.setTargetAtTime(0.32 * Math.min(1, d * 1.4), t, k);
    A.droneFilter.frequency.setTargetAtTime(520 - d * 380, t, k);
    A.oscs.forEach((o, i) => o.detune.setTargetAtTime(-d * 300 + (i === 1 ? 12 : 0), t, 1.2)); // the hum sinks as you do
    A.level.gain.setTargetAtTime(level, t, 0.8);
  }

  // ---------- Live engine ----------
  let A = null, ambMode = "off", ambDepth = 0, lastSubmit = 0, lastHover = 0, pingTimer = 0;
  const AMB_LEVEL = { off: 0, home: 0.8, play: 0.9, end: 0.8 };

  function ensure() {
    if (ctx) return ctx.state === "running";
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return false;
      ctx = new AC({ latencyHint: "interactive" });
      out = buildGraph(ctx);
      applyPrefs();
      A = buildAmbience(out);
      setAmbience(ambMode, ambDepth);
      pingTimer = setInterval(maybePing, 1000);
    } catch { ctx = null; return false; }
    return ctx.state === "running";
  }
  function unlock() { if (!ensure() && ctx && ctx.state === "suspended") ctx.resume().catch(() => {}); }
  ["pointerdown", "keydown", "touchend"].forEach(ev => window.addEventListener(ev, unlock, { capture: true, passive: true }));
  document.addEventListener("visibilitychange", () => { if (!ctx) return; if (document.hidden) ctx.suspend().catch(() => {}); else ctx.resume().catch(() => {}); });

  function applyPrefs() {
    if (!ctx) return;
    const t = ctx.currentTime;
    out.master.gain.setTargetAtTime(prefs.muted ? 0 : 1, t, 0.03);
    out.sfx.gain.setTargetAtTime(prefs.sfx * prefs.sfx, t, 0.03); // squared: sliders feel even to the ear
    out.amb.gain.setTargetAtTime(prefs.amb * prefs.amb * 0.9, t, 0.1);
    listeners.forEach(f => f(prefs));
  }
  function play(name, o = {}) {
    if (!ctx || ctx.state !== "running" || prefs.muted || !prefs.sfx || !SOUNDS[name]) return;
    const now = ctx.currentTime;
    if (name === "hover") { if (now - lastHover < 0.08) return; lastHover = now; }
    if (name === "submit" || name === "final") { if (now - lastSubmit < 0.05) return; lastSubmit = now; } // a double tap is one sound
    try {
      SOUNDS[name](out, now + 0.005, o);
    } catch { /* never let sound break the game */ }
  }
  function setAmbience(mode, depth) {
    ambMode = mode; if (depth != null) ambDepth = Math.max(0, Math.min(1, depth));
    if (A && ctx) applyDepth(A, ctx, ambMode === "play" ? ambDepth : 0, AMB_LEVEL[mode] ?? 0);
  }
  function maybePing() {
    if (!ctx || ctx.state !== "running" || prefs.muted || !prefs.amb || ambMode !== "play" || ambDepth < 0.65) return;
    if (Math.random() > 0.12) return;
    // A distant ping in the dark, on the ambience bus.
    const t = ctx.currentTime, f = note(88 - Math.floor(Math.random() * 3) * 5);
    try { tone({ ...out, sfx: out.amb }, { f, t, gain: 0.025, attack: 0.01, decay: 1.6, wet: 0.95, pan: Math.random() - 0.5 }); } catch { /* ignore */ }
  }

  // ---------- Self-test: render a sound offline and measure it (used by the automated tests) ----------
  async function renderTest(name, o = {}, seconds = 4) {
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const c = new OAC(2, Math.floor(44100 * seconds), 44100), g = buildGraph(c);
    g.master.gain.value = 1; g.sfx.gain.value = 0.64; g.amb.gain.value = 0;
    SOUNDS[name](g, 0.01, o);
    const buf = await c.startRendering(), d = buf.getChannelData(0);
    let peak = 0, sum = 0, nan = false, lastLoud = 0;
    for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (Number.isNaN(d[i])) nan = true; if (v > peak) peak = v; sum += v * v; if (v > 0.001) lastLoud = i; }
    return { name, peak: +peak.toFixed(3), rms: +Math.sqrt(sum / d.length).toFixed(4), tail: +(lastLoud / 44100).toFixed(2), nan };
  }

  window.Sound = {
    play, unlock, setAmbience,
    get prefs() { return { ...prefs }; },
    get ready() { return !!ctx && ctx.state === "running"; },
    set(p) { Object.assign(prefs, p); prefs.sfx = Math.max(0, Math.min(1, +prefs.sfx)); prefs.amb = Math.max(0, Math.min(1, +prefs.amb)); save(); applyPrefs(); },
    onChange(f) { listeners.add(f); f(prefs); },
    names: Object.keys(SOUNDS), renderTest,
  };
})();
