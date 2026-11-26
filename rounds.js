// Round types (experimental). Every question still has three guesses and the dive still only goes down; what changes
// is what a good answer is, and so how far it takes you. One place for the rules, the scoring and the words used.
//
//   standard   the rarest verified answer counts (the original game). Distance = the answer's depth (rarity).
//   wildcard   a surprising prompt; scored like standard.
//   forbidden  like standard, but the obvious answers are off limits (and so are their other names and spellings).
//   target     hit a band of popularity: e.g. an answer 1 to 3% of players give. Distance is for closeness, not rarity:
//              up to TARGET_MAX inside the band, less the further out (measured in multiples, so 0.1% is as far below
//              1% as 10% is above it). Scored only against measured frequencies, never a dataset's first guess.
//   risk       your first answer is revealed but doesn't move you yet. Secure it, play on as normal, or risk it: beat it
//              with a later guess and earn RISK_MULT times that guess; fail and the question earns nothing. Earlier
//              questions are never touched. Once a day (the day's one risk round).
//
// Each round's ordinary best is about the same (standard tops out near 300 m with evidence, 299 m without; target at
// TARGET_MAX), so no round type is worth far more than another, except a risk that comes off.
(function () {
  "use strict";
  const { depthOf } = window.Iceberg;
  const TARGET_MAX = 250, TARGET_FALLOFF = 1.25, RISK_MULT = 1.5;
  const KINDS = {
    standard: { label: "Rarity", rule: "The rarer your answer, the further down it takes you. Only your rarest counts." },
    wildcard: { label: "Wildcard", rule: "An odd one. The rarer your answer, the further down. Only your rarest counts." },
    forbidden: { label: "Forbidden", rule: "The obvious answers are off limits, and so are their other names. Rarest counts." },
    target: { label: "Rarity target", rule: "Not the rarest: hit the target. The closer your answer's popularity is to it, the further you go." },
    risk: { label: "Risk and reward", rule: "After your first answer, choose: keep it, play on, or risk it for ×1.5." },
  };
  const kind = cat => (cat && cat.mode && KINDS[cat.mode.type]) ? cat.mode.type : "standard";
  const pct = s => s >= 0.1 ? `${Math.round(s * 100)}%` : s >= 0.01 ? `${+(s * 100).toFixed(1)}%` : `${+(s * 100).toFixed(2)}%`;

  // ---------- Rarity target ----------
  // The band, as shares of players [lo, hi]. goal "common": the most common answer is the bullseye (lo = its share).
  // goal "closest": as close as possible to one figure (a narrow band round it).
  function band(cat) {
    const m = cat.mode || {};
    if (m.goal === "common") { const top = Math.max(...cat.answers.filter(a => !a.pv).map(a => a.s)); return { lo: top * 0.999, hi: 1, text: "the most common answer" }; }
    if (m.goal === "closest") return { lo: m.pct / 1.18, hi: m.pct * 1.18, text: `as close to ${pct(m.pct)} of players as you can` };
    return { lo: m.lo, hi: m.hi, text: `an answer ${pct(m.lo)} to ${pct(m.hi)} of players give` };
  }
  // How far outside the band, in powers of ten (0 inside it).
  const miss = (b, s) => s < b.lo ? Math.log10(b.lo / s) : s > b.hi ? Math.log10(s / b.hi) : 0;
  function targetValue(cat, g) {
    if (!g || g.status !== "ok" || g.measured === false) return 0;
    const row = g.name && cat.answers.find(a => a.a === g.name);
    if (!row || row.pv) return 0;                       // only measured frequencies count for a target
    return Math.round(TARGET_MAX * Math.max(0, 1 - miss(band(cat), g.share) / TARGET_FALLOFF));
  }

  // ---------- One guess, and a whole question ----------
  // The distance one verified answer is worth in this round, on its own.
  function value(cat, g) {
    if (!g || g.status !== "ok") return 0;
    return kind(cat) === "target" ? targetValue(cat, g) : depthOf(g.share);
  }
  // A question's distance using its first n guesses. final: the question is over (time, three guesses, or secured).
  function score(cat, r, n = r.guesses.length, final = !!r.done) {
    const list = r.guesses.slice(0, n), oks = list.map((g, i) => ({ g, i })).filter(x => x.g.status === "ok");
    const best = oks.reduce((m, x) => Math.max(m, value(cat, x.g)), 0);
    if (kind(cat) !== "risk") return best;
    const c = r.choice;
    if (!c) return final ? best : 0;                    // not decided yet: the first answer waits, nothing moves
    const first = oks.length ? value(cat, oks[0].g) : 0;
    if (c.kind === "secure") return c.stake;
    if (c.kind === "continue") return best;
    const later = oks.filter(x => x.i >= c.at).reduce((m, x) => Math.max(m, value(cat, x.g)), 0);
    return later > c.stake ? Math.round(RISK_MULT * later) : 0;   // won: ×1.5 the better answer; else nothing (yet, or at all)
  }
  // The best guess (the one that counts), for marking: highest value, the earlier on a tie.
  function best(cat, r) {
    let b = null, bv = -1;
    r.guesses.forEach(g => { if (g.status !== "ok") return; const v = value(cat, g); if (v > bv || (v === bv && kind(cat) !== "target" && b && g.share < b.share)) { b = g; bv = v; } });
    return b;
  }
  const isForbidden = (cat, row) => !!(row && cat.mode && cat.mode.type === "forbidden" && (cat.mode.forbid || []).includes(row.a));

  // ---------- Words ----------
  // What one answer did, in a sentence (the hint under the guesses). had: the question's distance before it.
  function verdict(cat, g, had, now) {
    const k = kind(cat), gain = now - had;
    if (k === "target") {
      const b = band(cat), row = g.name && cat.answers.find(a => a.a === g.name);
      if (!row || row.pv) return `${pct(g.share)} is only an estimate so far: target rounds score measured answers.`;
      const m = miss(b, g.share), f = Math.pow(10, m), where = m === 0 ? "on target" : `${f < 1.95 ? "a little" : `about ${Math.round(f)}×`} too ${g.share < b.lo ? "rare" : "common"}`;
      return `${pct(g.share)} of players: ${where}. Worth +${value(cat, g)} m${gain > 0 ? `, ${gain} m further down` : had ? `; your +${had} m still counts` : ""}.`;
    }
    return null;   // the game's own wording for rarity rounds
  }
  window.Rounds = { KINDS, kind, label: cat => KINDS[kind(cat)].label, rule: cat => (cat.mode && cat.mode.rule) || KINDS[kind(cat)].rule,
    band, miss, value, score, best, isForbidden, verdict, pct, TARGET_MAX, RISK_MULT };
})();
