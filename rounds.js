// Round types (experimental). Every question still has three guesses and the dive still only goes down; what changes
// is what a good answer is, and so how far it takes you. One place for the rules, the scoring and the words used.
//
//   standard   the rarest verified answer counts (the original game). Distance = the answer's depth (rarity).
//   wildcard   a surprising prompt; scored like standard.
//   forbidden  like standard, but the obvious answers are off limits (and so are their other names and spellings).
//   target     hit a band of popularity: e.g. an answer 1 to 3% of players give. Distance is for closeness, not rarity:
//              up to TARGET_MAX inside the band, less the further out (measured in multiples, so 0.1% is as far below
//              1% as 10% is above it). Scored only against measured frequencies, never a dataset's first guess.
//   risk       your first answer is revealed but doesn't move you yet. Three choices (tuned in tools/sim/risk.py):
//              keep it   +KEEP_BONUS (20%) on top, question over;
//              play on   ordinary best of three;
//              risk it   beat it with a later guess: the stake plus RISK_MULT (1.5×) the gain over it; fail and the
//                        question earns nothing. Earlier questions are never touched. At most once a day.
//
// Each round's ordinary best is about the same (standard tops out near 300 m with evidence, 299 m without; target at
// TARGET_MAX), so no round type is worth far more than another, except a risk that comes off.
(function () {
  "use strict";
  const { depthOf } = window.Iceberg;
  const TARGET_MAX = 250, TARGET_FALLOFF = 1.25, RISK_MULT = 1.5, KEEP_BONUS = 0.2;
  const KINDS = {
    standard: { label: "Rarity", rule: "The rarer your answer, the further down it takes you. Only your rarest counts." },
    wildcard: { label: "Wildcard", rule: "An odd one. The rarer your answer, the further down. Only your rarest counts." },
    forbidden: { label: "Forbidden", rule: "The obvious answers are off limits, and so are their other names. Rarest counts." },
    target: { label: "Rarity target", rule: "Not the rarest: hit the target. The closer your answer's popularity is to it, the further you go." },
    mines: { label: "Sea mines", rule: "Two bands of popularity are mined. An answer inside one blows up: no distance, and that guess is spent. Pass close by a mine for a 25% bonus." },
    risk: { label: "Risk and reward", rule: "After your first answer: keep it with a 20% bonus, play on, or risk it to beat it for 1.5× the gain." },
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

  // ---------- Sea mines ----------
  // Marked bands of popularity, shown on the sonar before the clock starts. Nothing is hidden: you know where the mines
  // are, and the question is only how popular you think your answer is. Only measured answers can set one off (an
  // estimate isn't good enough to blow up a guess); answers within 2× of a mine, either side, earn MINE_BONUS more.
  const MINE_BONUS = 0.25, MINE_NEAR = Math.log10(2);
  const rowOf = (cat, g) => g && g.name && cat.answers.find(a => a.a === g.name);
  function mineAt(cat, g) {
    if (kind(cat) !== "mines" || !g || g.status !== "ok") return -1;
    const row = rowOf(cat, g); if (!row || row.pv) return -1;
    return (cat.mode.mines || []).findIndex(b => g.share >= b.lo && g.share <= b.hi);
  }
  function skims(cat, g) {
    if (kind(cat) !== "mines" || !g || g.status !== "ok" || mineAt(cat, g) >= 0) return -1;
    const row = rowOf(cat, g); if (!row || row.pv) return -1;
    return (cat.mode.mines || []).findIndex(b => miss(b, g.share) <= MINE_NEAR);
  }

  // ---------- One guess, and a whole question ----------
  // The distance one verified answer is worth in this round, on its own.
  function value(cat, g) {
    if (!g || g.status !== "ok") return 0;
    const k = kind(cat);
    if (k === "target") return targetValue(cat, g);
    if (k === "mines") { if (mineAt(cat, g) >= 0) return 0; const d = depthOf(g.share); return skims(cat, g) >= 0 ? Math.round(d * (1 + MINE_BONUS)) : d; }
    return depthOf(g.share);
  }
  const keepValue = stake => Math.round(stake * (1 + KEEP_BONUS));
  const riskValue = (stake, later) => stake + Math.round(RISK_MULT * (later - stake));
  // A question's distance using its first n guesses. final: the question is over (time, three guesses, or secured).
  function score(cat, r, n = r.guesses.length, final = !!r.done) {
    const list = r.guesses.slice(0, n), oks = list.map((g, i) => ({ g, i })).filter(x => x.g.status === "ok");
    const best = oks.reduce((m, x) => Math.max(m, value(cat, x.g)), 0);
    if (kind(cat) !== "risk") return best;
    const c = r.choice;
    if (!c) return final ? best : 0;                    // not decided yet: the first answer waits, nothing moves
    const first = oks.length ? value(cat, oks[0].g) : 0;
    if (c.kind === "secure") return keepValue(c.stake);
    if (c.kind === "continue") return best;
    const later = oks.filter(x => x.i >= c.at).reduce((m, x) => Math.max(m, value(cat, x.g)), 0);
    return later > c.stake ? riskValue(c.stake, later) : 0;   // won: the stake plus 1.5× the gain; else nothing (yet, or at all)
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
    if (k === "mines") {
      const i = mineAt(cat, g), j = skims(cat, g), b = i >= 0 ? cat.mode.mines[i] : j >= 0 ? cat.mode.mines[j] : null;
      if (i >= 0) return `Mine! ${pct(g.share)} of players: inside the ${pct(b.lo)} to ${pct(b.hi)} minefield. No distance, and that guess is spent.${had ? ` Your +${had} m still counts.` : ""}`;
      if (j >= 0) return `${pct(g.share)} of players: close past the ${pct(b.lo)} to ${pct(b.hi)} mine. +25% for nerve: +${value(cat, g)} m${gain > 0 ? `, ${gain} m further down` : had ? `; your +${had} m still counts` : ""}.`;
    }
    return null;   // the game's own wording for rarity rounds
  }
  window.Rounds = { KINDS, kind, label: cat => KINDS[kind(cat)].label, rule: cat => (cat.mode && cat.mode.rule) || KINDS[kind(cat)].rule,
    band, miss, value, score, best, isForbidden, verdict, pct, TARGET_MAX, RISK_MULT, KEEP_BONUS, keepValue, riskValue, mineAt, skims, MINE_BONUS };
})();
