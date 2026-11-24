// The game's sound. Everything is synthesised live with the Web Audio API: no files to download, nothing to license.
//
// The palette: ice, water, sonar and pressure. Four ingredients make almost every sound:
//   glass   a crystalline FM tone (a sine bent by a second sine whose depth fades), cold and clear
//   ping    a sonar ping: one pure tone and its echoes coming back off the ice
//   water   bubbles (tiny rising chirps) and the rush of moving water (filtered noise)
//   depth   low swells and a darkening filter: the deeper you are, the darker every sound becomes
// They run through an underwater room (a long, dark reverb with a soft early reflection) and a gentle limiter.
//
// Signal path:  voices -> sfx bus -> depth filter ─┐
//                              reverb ─────────────┼─> master (mute) -> limiter -> speakers
//               ambience -> amb bus ───────────────┘
// The AudioContext starts on the first tap or key press (browsers block sound before that). Everything fails
// silently: with audio unavailable or muted, the game behaves exactly the same.
//
// I can't listen to audio. These sounds were designed from their structure and checked by measuring them
// (level, length, no clipping); tools/sounds.html plays each one so a person can judge how they actually sound.
(function () {
  "use strict";
  const KEY = "iceberg:audio";
  const prefs = Object.assign({ muted: false, sfx: 0.8, amb: 0.55 }, (() => { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; } })());
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* private mode */ } };

  let ctx = null, out = null;
  const listeners = new Set();
  let seed = 1; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;   // repeatable, so offline tests are stable

  // ---------- The room ----------
  // An underwater space: a short early reflection, then a long tail that loses its top end fast, with the two
  // channels different so it feels wide.
  function makeImpulse(c, seconds) {
    const rate = c.sampleRate, len = Math.floor(rate * seconds), buf = c.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch); let lp = 0, s = 9 + ch * 31;
      const r = () => (s = (s * 16807) % 2147483647) / 2147483647 * 2 - 1;
      for (let i = 0; i < len; i++) {
        const t = i / len, k = 0.06 + 0.9 * Math.pow(t, 0.6);         // darker as it fades
        lp += (r() - lp) * (1 - k);
        const early = i > rate * (0.019 + ch * 0.007) && i < rate * (0.03 + ch * 0.007) ? 1.8 : 0;   // one soft wall
        d[i] = (lp * Math.pow(1 - t, 2.8) + early * r() * 0.12) * (i < rate * 0.008 ? i / (rate * 0.008) : 1);
      }
    }
    return buf;
  }
  function makeNoise(c, seconds, kind) {
    const len = Math.floor(c.sampleRate * seconds), buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    let b = 0, p0 = 0, p1 = 0, p2 = 0;
    for (let i = 0; i < len; i++) {
      const w = rnd() * 2 - 1;
      if (kind === "brown") { b = (b + 0.02 * w) / 1.02; d[i] = b * 3.5; }
      else if (kind === "pink") { p0 = 0.997 * p0 + 0.029591 * w; p1 = 0.985 * p1 + 0.032534 * w; p2 = 0.95 * p2 + 0.048056 * w; d[i] = (p0 + p1 + p2 + 0.05 * w) * 2.2; }
      else d[i] = w;
    }
    const fade = Math.floor(c.sampleRate * 0.05); for (let i = 0; i < fade; i++) { const k = i / fade; d[len - fade + i] = d[len - fade + i] * (1 - k) + d[i] * k; }   // loops without a click
    return buf;
  }
  // A graph (buses, room, limiter) for any context: the live one, or an offline one used by the self-test.
  function buildGraph(c) {
    seed = 1;
    const g = {
      c, master: c.createGain(), sfx: c.createGain(), amb: c.createGain(), dark: c.createBiquadFilter(), verb: c.createConvolver(), verbIn: c.createGain(),
      lim: c.createDynamicsCompressor(), white: makeNoise(c, 2, "white"), pink: makeNoise(c, 4, "pink"), brown: makeNoise(c, 6, "brown"),
    };
    g.verb.buffer = makeImpulse(c, 3.6);
    g.verbIn.gain.value = 0.8;
    g.dark.type = "lowpass"; g.dark.frequency.value = 18000; g.dark.Q.value = 0.5;   // follows depth (setAmbience)
    g.lim.threshold.value = -12; g.lim.knee.value = 8; g.lim.ratio.value = 6; g.lim.attack.value = 0.003; g.lim.release.value = 0.2;
    g.sfx.connect(g.dark); g.dark.connect(g.master); g.amb.connect(g.master); g.verbIn.connect(g.verb); g.verb.connect(g.master);
    g.master.connect(g.lim); g.lim.connect(c.destination);
    return g;
  }
  function env(param, t, peak, attack, decay) {
    param.cancelScheduledValues(t); param.setValueAtTime(0.0001, t);
    param.linearRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    param.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }
  // Route a voice: dry to the sfx bus (or another), a share to the room, optionally panned.
  function route(g, node, { wet = 0.2, pan = 0, dest } = {}) {
    let last = node;
    if (pan && g.c.createStereoPanner) { const p = g.c.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); last.connect(p); last = p; }
    last.connect(dest || g.sfx);
    if (wet) { const w = g.c.createGain(); w.gain.value = wet; last.connect(w); w.connect(g.verbIn); }
  }

  // ---------- Ingredients ----------
  // A plain tone with an envelope and optional pitch glide and filter.
  function tone(g, { type = "sine", f, f0, glide = 0.02, t, gain = 0.2, attack = 0.004, decay = 0.3, wet = 0.2, lp, pan = 0, dest }) {
    const c = g.c, o = c.createOscillator(), a = c.createGain(); let last = a;
    o.type = type;
    if (f0) { o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f, t + glide); } else o.frequency.setValueAtTime(f, t);
    o.connect(a);
    if (lp) { const fl = c.createBiquadFilter(); fl.type = "lowpass"; fl.frequency.value = lp; fl.Q.value = 0.4; a.connect(fl); last = fl; }
    route(g, last, { wet, pan, dest });
    env(a.gain, t, gain, attack, decay);
    o.start(t); o.stop(t + attack + decay + 0.05);
  }
  // Glass: an FM tone. The modulator's depth starts high (a bright, struck edge) and falls away (a pure ringing
  // body), which is what makes it sound like ice or crystal rather than a beep.
  function glass(g, { f, t, gain = 0.12, decay = 1.2, ratio = 3.5, index = 2.2, wet = 0.35, pan = 0, detune = 0 }) {
    const c = g.c, car = c.createOscillator(), mod = c.createOscillator(), mg = c.createGain(), a = c.createGain();
    const fr = f * Math.pow(2, detune / 1200);
    car.frequency.value = fr; mod.frequency.value = fr * ratio;
    mg.gain.setValueAtTime(fr * index, t); mg.gain.exponentialRampToValueAtTime(fr * 0.02, t + Math.min(decay, 0.5));
    mod.connect(mg); mg.connect(car.frequency); car.connect(a);
    route(g, a, { wet, pan });
    env(a.gain, t, gain, 0.002, decay);
    car.start(t); mod.start(t); car.stop(t + decay + 0.1); mod.stop(t + decay + 0.1);
    // A faint octave above for sparkle.
    tone(g, { f: fr * 2.01, t, gain: gain * 0.18, attack: 0.002, decay: decay * 0.35, wet: wet * 0.8, pan });
  }
  // A sonar ping: a pure tone with a slight downward bend, and its echoes returning darker and quieter.
  function ping(g, { f, t, gain = 0.09, decay = 0.7, echoes = 2, gap = 0.28, wet = 0.5, pan = 0 }) {
    for (let i = 0; i <= echoes; i++) {
      tone(g, { f, f0: f * 1.015, glide: 0.06, t: t + i * gap, gain: gain * Math.pow(0.38, i), attack: 0.004, decay: decay * (1 + i * 0.3), wet: wet + i * 0.15, lp: i ? 2400 / i : undefined, pan: pan * (i % 2 ? -1 : 1) });
    }
  }
  // Bubbles: each a tiny sine that rises quickly in pitch, the way a real bubble's resonance does as it shrinks.
  function bubbles(g, { t, n = 4, spread = 0.25, lo = 500, hi = 1400, gain = 0.03, wet = 0.3, pan = 0 }) {
    for (let i = 0; i < n; i++) {
      const f = lo + rnd() * (hi - lo), at = t + rnd() * spread;
      tone(g, { f: f * 1.9, f0: f, glide: 0.025 + rnd() * 0.02, t: at, gain: gain * (0.5 + rnd() * 0.5), attack: 0.002, decay: 0.045 + rnd() * 0.03, wet, pan: pan + (rnd() - 0.5) * 0.6 });
    }
  }
  // Moving water: noise through a sweeping filter, with an optional pan sweep (something passing by).
  function wash(g, { t, dur, gain = 0.06, type = "lowpass", sweep = [800, 200], q = 0.7, attack, wet = 0.4, kind = "brown", pan, dest }) {
    const c = g.c, s = c.createBufferSource(), fl = c.createBiquadFilter(), a = c.createGain(); let last = a;
    s.buffer = g[kind]; s.loop = true;
    fl.type = type; fl.Q.value = q; fl.frequency.setValueAtTime(sweep[0], t); fl.frequency.exponentialRampToValueAtTime(sweep[1], t + dur);
    s.connect(fl); fl.connect(a);
    if (pan && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.setValueAtTime(pan[0], t); p.pan.linearRampToValueAtTime(pan[1], t + dur); a.connect(p); last = p; }
    last.connect(dest || g.sfx);
    if (wet) { const w = c.createGain(); w.gain.value = wet; last.connect(w); w.connect(g.verbIn); }
    env(a.gain, t, gain, attack != null ? attack : dur * 0.4, Math.max(0.05, dur * 0.6));
    s.start(t, rnd() * 1.5); s.stop(t + dur + 0.1);
  }
  // A short, crisp transient: the "tick" at the front of a committed action.
  const tick = (g, t, gain = 0.05, f = 6500) => wash(g, { t, dur: 0.018, gain, type: "bandpass", sweep: [f, f * 0.8], q: 1.4, attack: 0.0008, wet: 0.05, kind: "white" });
  // A low swell you feel more than hear.
  const swell = (g, t, { f = 42, gain = 0.15, rise = 0.6, decay = 1.6, wet = 0.3 } = {}) => tone(g, { f, f0: f * 0.8, glide: rise, t, gain, attack: rise, decay, wet, lp: 220 });
  const note = n => 440 * Math.pow(2, (n - 69) / 12); // MIDI note -> Hz
  // How rare an answer is, in four steps the ear can tell apart.
  const tierOf = m => m >= 200 ? 3 : m >= 100 ? 2 : m >= 50 ? 1 : 0;

  // ---------- The sound set ----------
  // Every sound is a function of (graph, startTime, options), so the self-test can render any of them offline.
  const SOUNDS = {
    hover(g, t) { wash(g, { t, dur: 0.03, gain: 0.01, type: "highpass", sweep: [5200, 6000], attack: 0.004, wet: 0, kind: "white" }); },
    click(g, t) { tick(g, t, 0.035, 4200); glass(g, { f: note(86), t, gain: 0.035, decay: 0.12, index: 1.2, wet: 0.08 }); },

    // Committing a guess: a crisp tick, a short crystal note (a step higher for each guess), a soft resonance
    // underneath and a couple of bubbles. Small random detune so it never sounds machine-identical.
    submit(g, t, o = {}) {
      const step = Math.min(2, o.step || 0), f = note([81, 84, 88][step]), dt = (rnd() - 0.5) * 14;
      tick(g, t, 0.05);
      glass(g, { f, t: t + 0.004, gain: 0.11, decay: 0.42, ratio: 3.01, index: 1.8, wet: 0.22, detune: dt });
      tone(g, { f: 98, f0: 130, glide: 0.09, t, gain: 0.08, attack: 0.004, decay: 0.24, wet: 0.25, lp: 400 });
      bubbles(g, { t: t + 0.03, n: 2, lo: 700, hi: 1300, gain: 0.018, spread: 0.12 });
    },
    // The last guess of a question: the same, with a low double pulse to say "that's all three".
    final(g, t) {
      SOUNDS.submit(g, t, { step: 2 });
      tone(g, { f: 58, f0: 76, glide: 0.08, t: t + 0.03, gain: 0.15, attack: 0.004, decay: 0.24, wet: 0.2, lp: 300 });
      tone(g, { f: 58, f0: 72, glide: 0.08, t: t + 0.26, gain: 0.1, attack: 0.004, decay: 0.3, wet: 0.25, lp: 300 });
    },
    pending(g, t) { glass(g, { f: note(76), t, gain: 0.06, decay: 0.3, index: 0.8, wet: 0.25 }); glass(g, { f: note(76), t: t + 0.16, gain: 0.035, decay: 0.3, index: 0.6, wet: 0.35 }); },
    duplicate(g, t) { glass(g, { f: note(81), t, gain: 0.06, decay: 0.16, index: 1, wet: 0.12 }); glass(g, { f: note(76), t: t + 0.08, gain: 0.05, decay: 0.2, index: 0.8, wet: 0.12 }); },
    // Not counted: a dull knock against ice. Never a buzzer.
    invalid(g, t) { tone(g, { f: 120, f0: 210, glide: 0.07, t, gain: 0.16, attack: 0.002, decay: 0.13, wet: 0.06, lp: 600 }); wash(g, { t, dur: 0.06, gain: 0.03, sweep: [900, 300], attack: 0.002, wet: 0, kind: "white" }); },

    start(g, t) {
      wash(g, { t, dur: 1.3, gain: 0.05, sweep: [250, 2200], attack: 0.6, wet: 0.5 });
      bubbles(g, { t: t + 0.2, n: 7, spread: 0.7, lo: 400, hi: 1100, gain: 0.02 });
      [69, 74, 76, 81, 86].forEach((n, i) => glass(g, { f: note(n), t: t + 0.15 + i * 0.08, gain: 0.045, decay: 1.6, index: 1.4, wet: 0.55, pan: (i - 2) * 0.15 }));
    },
    // A new question: one sonar ping and its echo off the ice.
    question(g, t) { ping(g, { f: note(84), t, gain: 0.085, decay: 0.9, echoes: 2, gap: 0.32 }); swell(g, t, { f: 55, gain: 0.05, rise: 0.15, decay: 0.6 }); },
    // The camera sets off: water rushing past and a bubble trail. Down sinks and darkens; up lifts and brightens.
    travel(g, t, o = {}) {
      const dur = Math.max(0.5, Math.min(2.4, o.seconds || 1)), down = (o.dir || 1) > 0;
      wash(g, { t, dur: dur + 0.25, gain: 0.055, sweep: down ? [1300, 180] : [260, 1500], attack: dur * 0.3, wet: 0.45 });
      tone(g, { f: down ? 42 : 64, f0: down ? 60 : 46, glide: dur, t, gain: 0.06, attack: dur * 0.4, decay: dur * 0.8, wet: 0.2, lp: 200 });
      bubbles(g, { t: t + 0.05, n: Math.round(3 + dur * 3), spread: dur * 0.8, lo: down ? 350 : 600, hi: down ? 900 : 1500, gain: 0.016 });
    },
    // The answer arrives. Four steps of rarity, each fuller than the last; the rarest is held for "rare" below.
    //   common      a light crystal tick                       uncommon  two notes with more ring
    //   rare        a lower sonar ping under a ringing fifth    exceptional  see "rare"
    reveal(g, t, o = {}) {
      const m = o.m != null ? o.m : Math.round((o.depth || 0) * 260), k = tierOf(m);
      if (k === 0) { glass(g, { f: note(88), t, gain: 0.07, decay: 0.5, index: 1.4, wet: 0.3 }); return; }
      if (k === 1) { glass(g, { f: note(81), t, gain: 0.08, decay: 0.9, wet: 0.38 }); glass(g, { f: note(88), t: t + 0.07, gain: 0.05, decay: 0.8, wet: 0.42 }); return; }
      if (k === 2) { ping(g, { f: note(72), t, gain: 0.07, decay: 1.1, echoes: 2, gap: 0.3, wet: 0.55 }); glass(g, { f: note(76), t: t + 0.02, gain: 0.06, decay: 1.6, index: 1.6, wet: 0.5, pan: -0.15 }); glass(g, { f: note(83), t: t + 0.09, gain: 0.05, decay: 1.6, index: 1.4, wet: 0.5, pan: 0.15 }); swell(g, t, { f: 49, gain: 0.07, rise: 0.08, decay: 0.8 }); return; }
      SOUNDS.rare(g, t - 0.9, { lead: 0.9 });
    },
    // Deeper than your last best: a small rising figure on top of the reveal. Bigger for bigger finds.
    deeper(g, t, o = {}) {
      const m = o.m != null ? o.m : Math.round((o.depth || 0) * 260), k = tierOf(m), root = [84, 81, 76, 72][k];
      [0, 7, 12].slice(0, 2 + (k >= 1)).forEach((s, i) => glass(g, { f: note(root + s), t: t + i * 0.09, gain: 0.06, decay: 1 + k * 0.4, index: 1.3, wet: 0.45, pan: (i - 1) * 0.2 }));
      if (k >= 2) bubbles(g, { t: t + 0.1, n: 5, spread: 0.4, lo: 600, hi: 1600, gain: 0.015 });
    },
    // Not deeper this time: a soft, settling "thup" of water. Deliberately not a wrong-answer sound.
    neutral(g, t) { tone(g, { f: 150, f0: 210, glide: 0.08, t, gain: 0.07, attack: 0.004, decay: 0.22, wet: 0.3, lp: 700 }); bubbles(g, { t: t + 0.04, n: 2, lo: 500, hi: 800, gain: 0.012 }); },
    // An exceptional find: pressure building from below (o.lead seconds, timed to the camera), then a cold
    // shimmer that slowly beats. Under three seconds in all.
    rare(g, t, o = {}) {
      const lead = Math.max(0.6, Math.min(2.6, o.lead || 1.15));
      swell(g, t, { f: 36, gain: 0.17, rise: lead * 0.9, decay: 1.8, wet: 0.35 });
      wash(g, { t, dur: lead + 0.3, gain: 0.05, sweep: [110, 700], attack: lead * 0.85, wet: 0.55 });
      ping(g, { f: note(64), t: t + lead, gain: 0.07, decay: 1.4, echoes: 2, gap: 0.36, wet: 0.6 });
      [76, 83, 88, 95].forEach((n, i) => { glass(g, { f: note(n), t: t + lead + 0.04 + i * 0.05, gain: 0.04, decay: 2.2, index: 1.1, wet: 0.7, pan: (i % 2 ? 0.3 : -0.3), detune: -6 }); glass(g, { f: note(n), t: t + lead + 0.06 + i * 0.05, gain: 0.03, decay: 2.2, index: 0.9, wet: 0.7, pan: (i % 2 ? -0.3 : 0.3), detune: 6 }); });
    },
    // Something very large passing in the distance. No animal calls: displaced water, pressure and a change in the room.
    //   giant     a long sweep of moving water from one side to the other
    //   bigfin    almost nothing: a high, faint shimmer hanging in the dark
    //   colossal  a deep pressure swell and a slow, heavy pass of water
    encounter(g, t, o = {}) {
      const kind = o.kind || "giant", side = rnd() < 0.5 ? -1 : 1;
      if (kind === "bigfin") {
        [93, 93.1, 100].forEach((n, i) => tone(g, { f: note(n), t: t + i * 0.4, gain: 0.012, attack: 1.2, decay: 2.6, wet: 0.9, pan: (i - 1) * 0.5 }));
        swell(g, t, { f: 46, gain: 0.05, rise: 1.4, decay: 2 });
        return;
      }
      const big = kind === "colossal";
      wash(g, { t, dur: big ? 4 : 3, gain: big ? 0.07 : 0.05, sweep: big ? [180, 90] : [500, 160], attack: big ? 1.8 : 1.2, wet: 0.7, pan: [side * 0.8, -side * 0.8] });
      swell(g, t + 0.3, { f: big ? 31 : 40, gain: big ? 0.16 : 0.09, rise: big ? 1.6 : 1, decay: big ? 3 : 2 });
      bubbles(g, { t: t + (big ? 1.6 : 1.1), n: big ? 9 : 5, spread: 1.4, lo: 250, hi: 700, gain: 0.012, pan: -side * 0.4 });
      ping(g, { f: note(big ? 60 : 67), t: t + (big ? 2.2 : 1.6), gain: 0.025, decay: 1.6, echoes: 1, gap: 0.5, wet: 0.85 });
    },

    // The ice timer: one dry crack at ten seconds, a falling drop on each of the last five, a soft dissolve at zero.
    crack(g, t) {
      tick(g, t, 0.06, 3400); tick(g, t + 0.075, 0.04, 5200);
      glass(g, { f: 1900, t, gain: 0.02, decay: 0.08, index: 4, ratio: 2.3, wet: 0.25 });
    },
    // A water drop: a quick upward chirp (that is what a real drop sounds like), brighter as the time runs out.
    drip(g, t, o = {}) {
      const k = o.step || 0, f = 950 + k * 60;
      tone(g, { f: f * 2.1, f0: f, glide: 0.035, t, gain: 0.08 + k * 0.01, attack: 0.002, decay: 0.09, wet: 0.45 });
      tone(g, { f: f * 0.5, t: t + 0.01, gain: 0.012, attack: 0.003, decay: 0.12, wet: 0.5, lp: 900 });
    },
    melt(g, t) {
      wash(g, { t, dur: 1.1, gain: 0.04, sweep: [2200, 240], attack: 0.05, wet: 0.6, kind: "pink" });
      bubbles(g, { t: t + 0.05, n: 8, spread: 0.6, lo: 350, hi: 1000, gain: 0.02 });
      glass(g, { f: note(67), t: t + 0.4, gain: 0.03, decay: 1.6, index: 0.8, wet: 0.7 });
    },
    round(g, t) { glass(g, { f: note(79), t, gain: 0.06, decay: 1.2, wet: 0.45 }); glass(g, { f: note(86), t: t + 0.13, gain: 0.06, decay: 1.5, wet: 0.5 }); },
    day(g, t) {
      [72, 76, 79, 84, 86, 91].forEach((n, i) => glass(g, { f: note(n), t: t + i * 0.11, gain: 0.055, decay: 2, index: 1.5, wet: 0.55, pan: (i - 2.5) * 0.1 }));
      wash(g, { t, dur: 1.6, gain: 0.03, sweep: [400, 2400], attack: 0.8, wet: 0.6 });
    },
    // The calendar square for today filling in.
    fill(g, t) { glass(g, { f: note(88), t, gain: 0.05, decay: 0.6, wet: 0.4 }); glass(g, { f: note(95), t: t + 0.09, gain: 0.04, decay: 0.8, wet: 0.45 }); },

    // ----- The race -----
    // Someone joins the lobby / someone is ready / the countdown / the start.
    join(g, t) { ping(g, { f: note(79), t, gain: 0.05, decay: 0.5, echoes: 1, gap: 0.18 }); ping(g, { f: note(86), t: t + 0.12, gain: 0.04, decay: 0.6, echoes: 1, gap: 0.18 }); },
    leave(g, t) { ping(g, { f: note(81), t, gain: 0.04, decay: 0.5, echoes: 1, gap: 0.18 }); ping(g, { f: note(74), t: t + 0.12, gain: 0.035, decay: 0.6, echoes: 1, gap: 0.18 }); },
    ready(g, t) { tick(g, t, 0.03, 5000); glass(g, { f: note(91), t, gain: 0.05, decay: 0.35, index: 1.2, wet: 0.25 }); },
    count(g, t, o = {}) { ping(g, { f: note(o.last ? 84 : 77), t, gain: o.last ? 0.08 : 0.06, decay: 0.5, echoes: 1, gap: 0.2, wet: 0.35 }); },
    // Engines on: a low motor winding up through the water, then settling. Once per race, never a drone.
    go(g, t) {
      tone(g, { type: "triangle", f: 96, f0: 40, glide: 0.8, t, gain: 0.07, attack: 0.3, decay: 1, wet: 0.25, lp: 420 });
      tone(g, { type: "triangle", f: 144, f0: 60, glide: 0.8, t, gain: 0.03, attack: 0.35, decay: 0.9, wet: 0.25, lp: 520 });
      wash(g, { t: t + 0.1, dur: 1.2, gain: 0.04, sweep: [300, 1100], attack: 0.5, wet: 0.35 });
      bubbles(g, { t: t + 0.35, n: 8, spread: 0.8, lo: 400, hi: 1200, gain: 0.018 });
      ping(g, { f: note(88), t: t + 0.05, gain: 0.05, decay: 0.7, echoes: 1, gap: 0.22 });
    },
    // The submarine pushes down. Size (0..1) follows how far: a short nudge for a few metres, a full thrust and
    // a long bubble trail for an exceptional answer.
    thrust(g, t, o = {}) {
      const k = Math.max(0, Math.min(1, o.size != null ? o.size : 0.5)), dur = 0.4 + k * 1.3;
      tone(g, { type: "triangle", f: 70 + k * 30, f0: 52, glide: dur * 0.5, t, gain: 0.04 + k * 0.05, attack: dur * 0.25, decay: dur * 0.8, wet: 0.2, lp: 380 });
      wash(g, { t, dur, gain: 0.035 + k * 0.045, sweep: [500 + k * 600, 160], attack: dur * 0.2, wet: 0.4 });
      bubbles(g, { t: t + 0.05, n: Math.round(3 + k * 9), spread: dur * 0.9, lo: 380, hi: 1300, gain: 0.016 + k * 0.006 });
      if (k > 0.75) swell(g, t, { f: 38, gain: 0.08 + k * 0.05, rise: dur * 0.5, decay: 1.4 });
    },
    // Passing someone: a quick upward glass glide. Being passed: the same, falling, quieter.
    overtake(g, t, o = {}) {
      const up = o.dir !== -1;
      tone(g, { f: up ? 1760 : 880, f0: up ? 880 : 1760, glide: 0.18, t, gain: up ? 0.035 : 0.02, attack: 0.01, decay: 0.3, wet: 0.45, pan: up ? 0.2 : -0.2 });
      if (up) glass(g, { f: note(93), t: t + 0.16, gain: 0.035, decay: 0.6, wet: 0.5 });
    },
    // Crossing into a new region (twilight, the deep, the abyss, the trench): a low bell and a change of room.
    zone(g, t, o = {}) { const k = o.level || 1; swell(g, t, { f: 55 - k * 6, gain: 0.06, rise: 0.4, decay: 1.6 }); ping(g, { f: note(67 - k * 3), t: t + 0.1, gain: 0.05, decay: 1.4, echoes: 2, gap: 0.42, wet: 0.7 }); },
    // The question closes: everyone's answers come up.
    reveal_all(g, t) { [0, 1, 2].forEach(i => ping(g, { f: note(76 + i * 5), t: t + i * 0.1, gain: 0.04, decay: 0.6, echoes: 1, gap: 0.2, pan: (i - 1) * 0.4 })); },
    standings(g, t, o = {}) { const n = Math.max(2, Math.min(8, o.n || 4)); for (let i = 0; i < n; i++) glass(g, { f: note(76 + [0, 2, 4, 7, 9, 12, 14, 16][i]), t: t + i * 0.06, gain: 0.03, decay: 0.7, index: 1, wet: 0.45, pan: (i / (n - 1) - 0.5) * 0.8 }); },
    win(g, t) {
      swell(g, t, { f: 41, gain: 0.1, rise: 0.4, decay: 2 });
      [60, 67, 72, 76, 79, 84, 88].forEach((n, i) => glass(g, { f: note(n), t: t + 0.2 + i * 0.07, gain: 0.05, decay: 2.4, index: 1.3, wet: 0.6, pan: (i - 3) * 0.12 }));
      bubbles(g, { t: t + 0.4, n: 10, spread: 1.2, lo: 500, hi: 1600, gain: 0.015 });
    },
    lose(g, t) { [72, 76, 79].forEach((n, i) => glass(g, { f: note(n), t: t + i * 0.12, gain: 0.04, decay: 1.4, index: 0.9, wet: 0.55 })); },
    rematch(g, t) { ping(g, { f: note(81), t, gain: 0.05, decay: 0.6, echoes: 1, gap: 0.2 }); bubbles(g, { t: t + 0.1, n: 4, spread: 0.3, gain: 0.015 }); },
  };

  // ---------- Ambience: one continuous bed that follows depth ----------
  // Near the surface: a slow wash of waves, a little air, the odd bubble. Going down, the wash darkens and fades,
  // a low hum grows and the whole bed is filtered darker. In the deep: near-silence, the hum, faraway pings and
  // the occasional groan of pressure. Every change is gradual, and going back up reverses it.
  function buildAmbience(g) {
    const c = g.c, A = { level: c.createGain(), tone: c.createBiquadFilter() };
    A.level.gain.value = 0; A.tone.type = "lowpass"; A.tone.frequency.value = 9000; A.tone.Q.value = 0.4;
    A.tone.connect(A.level); A.level.connect(g.amb);
    const src = (buf, f, type, q, gain) => { const s = c.createBufferSource(); s.buffer = buf; s.loop = true; const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const a = c.createGain(); a.gain.value = gain; s.connect(fl); fl.connect(a); a.connect(A.tone); s.start(0, rnd() * 2); return { fl, a }; };
    A.waves = src(g.brown, 1100, "lowpass", 0.3, 0.32);
    const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = 0.085; lg.gain.value = 0.14; lfo.connect(lg); lg.connect(A.waves.a.gain); lfo.start();
    A.air = src(g.pink, 2600, "bandpass", 0.6, 0.014);
    A.mid = src(g.pink, 380, "bandpass", 0.9, 0.0);          // the muffled body of water, strongest at mid depth
    A.droneGain = c.createGain(); A.droneGain.gain.value = 0; A.droneGain.connect(A.tone);
    A.droneFilter = c.createBiquadFilter(); A.droneFilter.type = "lowpass"; A.droneFilter.frequency.value = 400; A.droneFilter.connect(A.droneGain);
    A.oscs = [[48, "sine", 0.5], [48.3, "sine", 0.45], [72.2, "sine", 0.12], [96.4, "triangle", 0.05]].map(([f, type, amp]) => {
      const o = c.createOscillator(), a = c.createGain(); o.type = type; o.frequency.value = f; a.gain.value = amp; o.connect(a); a.connect(A.droneFilter); o.start(); return o;
    });
    const vs = c.createGain(); vs.gain.value = 0.3; A.droneGain.connect(vs); vs.connect(g.verbIn);
    return A;
  }
  function applyDepth(A, c, d, level) {
    const t = c.currentTime, k = 0.6;
    A.waves.a.gain.setTargetAtTime(0.32 * Math.pow(1 - d, 1.8), t, k);
    A.waves.fl.frequency.setTargetAtTime(1100 - d * 900, t, k);
    A.air.a.gain.setTargetAtTime(0.014 * Math.max(0, 1 - d * 3.5), t, k);
    A.mid.a.gain.setTargetAtTime(0.05 * Math.sin(Math.PI * Math.min(1, d * 1.4)), t, k);
    A.droneGain.gain.setTargetAtTime(0.3 * Math.min(1, d * 1.3), t, k);
    A.droneFilter.frequency.setTargetAtTime(420 - d * 300, t, k);
    A.tone.frequency.setTargetAtTime(9000 * Math.pow(1 - d, 2.2) + 500, t, k);   // the deeper, the darker the whole bed
    A.oscs.forEach((o, i) => o.detune.setTargetAtTime(-d * 250 + (i === 1 ? 10 : 0), t, 1.5));
    A.level.gain.setTargetAtTime(level, t, 0.8);
  }

  // ---------- Live engine ----------
  let A = null, ambMode = "off", ambDepth = 0, lastSubmit = 0, lastHover = 0, lastThrust = 0, eventTimer = 0;
  const AMB_LEVEL = { off: 0, home: 0.8, play: 0.9, race: 0.9, end: 0.8 };

  function ensure() {
    if (ctx) return ctx.state === "running";
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return false;
      ctx = new AC({ latencyHint: "interactive" });
      out = buildGraph(ctx); seed = (Date.now() % 100000) + 7;
      applyPrefs();
      A = buildAmbience(out);
      setAmbience(ambMode, ambDepth);
      eventTimer = setInterval(ambientEvent, 1000);
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
    out.sfx.gain.setTargetAtTime(prefs.sfx * prefs.sfx * 1.1, t, 0.03); // squared: sliders feel even to the ear
    out.amb.gain.setTargetAtTime(prefs.amb * prefs.amb * 0.9, t, 0.1);
    listeners.forEach(f => f(prefs));
  }
  function play(name, o = {}) {
    if (!ctx || ctx.state !== "running" || prefs.muted || !prefs.sfx || !SOUNDS[name]) return;
    const now = ctx.currentTime;
    if (name === "hover") { if (now - lastHover < 0.08) return; lastHover = now; }
    if (name === "submit" || name === "final") { if (now - lastSubmit < 0.05) return; lastSubmit = now; } // a double tap is one sound
    if (name === "thrust") { if (now - lastThrust < 0.25) return; lastThrust = now; }
    try { SOUNDS[name](out, now + 0.005, o); } catch { /* never let sound break the game */ }
  }
  function setAmbience(mode, depth) {
    ambMode = mode; if (depth != null) ambDepth = Math.max(0, Math.min(1, depth));
    const d = mode === "play" || mode === "race" ? ambDepth : 0;
    if (A && ctx) {
      applyDepth(A, ctx, d, AMB_LEVEL[mode] ?? 0);
      out.dark.frequency.setTargetAtTime(18000 * Math.pow(1 - d, 1.6) + 3500, ctx.currentTime, 0.6);   // effects darken a little in the deep too
    }
  }
  // Sparse things heard in the water, by depth: bubbles near the surface, faraway pings and pressure groans deep down.
  function ambientEvent() {
    if (!ctx || ctx.state !== "running" || prefs.muted || !prefs.amb || (ambMode !== "play" && ambMode !== "race")) return;
    const d = ambDepth, t = ctx.currentTime, g = { ...out, sfx: out.amb };
    try {
      if (d < 0.35 && rnd() < 0.08) bubbles(g, { t, n: 3 + Math.floor(rnd() * 4), spread: 0.6, lo: 500, hi: 1300, gain: 0.012, wet: 0.5, pan: rnd() - 0.5 });
      else if (d > 0.4 && d < 0.85 && rnd() < 0.04) wash(g, { t, dur: 2.5, gain: 0.02, type: "bandpass", sweep: [140, 90], q: 3, attack: 1, wet: 0.8, pan: [rnd() - 0.5, rnd() - 0.5], dest: out.amb });
      else if (d >= 0.6 && rnd() < 0.09) tone(g, { f: note(88 - Math.floor(rnd() * 3) * 5), t, gain: 0.018, attack: 0.01, decay: 1.6, wet: 0.95, pan: rnd() - 0.5, dest: out.amb });
    } catch { /* ignore */ }
  }

  // ---------- Self-test: render a sound offline and measure it (used by the automated tests) ----------
  async function renderTest(name, o = {}, seconds = 4) {
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const c = new OAC(2, Math.floor(44100 * seconds), 44100), g = buildGraph(c);
    g.master.gain.value = 1; g.sfx.gain.value = 0.7; g.amb.gain.value = 0;
    SOUNDS[name](g, 0.01, o);
    const buf = await c.startRendering(), d = buf.getChannelData(0);
    let peak = 0, sum = 0, nan = false, lastLoud = 0, cross = 0, prev = 0, loudN = 0;
    for (let i = 0; i < d.length; i++) {
      const v = Math.abs(d[i]); if (Number.isNaN(d[i])) nan = true; if (v > peak) peak = v; sum += v * v; if (v > 0.001) lastLoud = i;
      if (v > 0.003) { loudN++; if ((d[i] > 0) !== (prev > 0)) cross++; } prev = d[i];
    }
    // brightness: zero crossings per second while sounding, a rough stand-in for how high the energy sits
    return { name, peak: +peak.toFixed(3), rms: +Math.sqrt(sum / d.length).toFixed(4), tail: +(lastLoud / 44100).toFixed(2), bright: loudN ? Math.round(cross / (loudN / 44100) / 2) : 0, nan };
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
