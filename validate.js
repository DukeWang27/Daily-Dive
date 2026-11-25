// Iceberg answer checking. Runs instantly in the browser, so typing is never held up by the network.
//
// Every guess lands in one of four states:
//   ok       recognised (exactly, by another name, as a plural, with a small typo, or with an extra describing word)
//   dup      the same answer as an earlier guess on this question ("automobile" after "car"). Never uses a guess
//   pending  plausible but not in today's list. Has no depth until it is reviewed (see reviewGuess in game.js)
//   invalid  clearly not an answer: gibberish, too general ("mammal"), wrong category, wrong first letters
//
// The layers, in order (CONTENT.md, "How an answer is judged"):
//   1 exact name   2 tidied form (case, accents, punctuation, plurals, spaces: "bluejay" is "blue jay")
//   3 other names (aliases, scientific names, regional names)   4 context-aware spelling correction, with a confidence:
//     high -> corrected at once (and shown as corrected); medium -> one "Did you mean ...?" for the player to confirm;
//     low -> no guess at all, the answer goes on unchanged   5 decisions cached from review   6 plausibility -> pending.
// Corrections only ever pick among this question's own answers, ranked by how likely the player meant each one
// (how close the spelling is, how it sounds, and how commonly people give it), never by how well it would score.
// A word that is already a known answer is never corrected, so an obscure answer is never swapped for a common one.
(function () {
  "use strict";

  function normalize(s) {
    return String(s).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
      .replace(/&/g, " and ").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim().replace(/^(a|an|the|some) /, "");
  }
  // Plural and possessive forms a word might be typed in. The first entry is always the word itself.
  function variants(w) {
    const out = [w];
    const m = w.match(/^(.*?)([a-z0-9]+)$/); if (!m) return out;
    const [, head, last] = m;
    const add = s => { const v = head + s; if (!out.includes(v)) out.push(v); };
    if (last.endsWith("ies") && last.length > 4) add(last.slice(0, -3) + "y");
    if (last.endsWith("ives")) add(last.slice(0, -4) + "ife");
    if (last.endsWith("ves")) add(last.slice(0, -3) + "f");
    if (/(s|x|z|ch|sh|o)es$/.test(last)) add(last.slice(0, -2));
    if (last.endsWith("s") && !/(ss|us|is)$/.test(last)) add(last.slice(0, -1));
    const irregular = { mice: "mouse", geese: "goose", oxen: "ox", teeth: "tooth", people: "person", feet: "foot", children: "child",
      wolves: "wolf", knives: "knife", leaves: "leaf", cacti: "cactus", octopi: "octopus", fungi: "fungus", dice: "die" };
    if (irregular[last]) add(irregular[last]);
    return out;
  }
  // Edit distance where a swapped pair of letters ("lepoard") counts as one mistake. Gives up early past `cap`.
  function levenshtein(a, b, cap) {
    if (Math.abs(a.length - b.length) > cap) return cap + 1;
    let pp = null, prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i]; let rowBest = i;
      for (let j = 1; j <= b.length; j++) {
        let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (pp && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, pp[j - 2] + 1);
        cur[j] = v; if (v < rowBest) rowBest = v;
      }
      if (rowBest > cap) return cap + 1;
      pp = prev; prev = cur;
    }
    return prev[b.length];
  }

  // Words that make something not the real thing: "teddy bear" isn't a bear.
  // Words that only describe ("a baby elephant", "a big red bus") and never name a different thing. Anything else in
  // front of a known answer may well be a different answer ("banded woodpecker" is its own species, "sweet potato"
  // isn't a potato for a vegetable question), so it is not trimmed: it goes to review instead.
  const DESCRIBE = new Set(["baby", "babies", "little", "big", "small", "large", "tiny", "huge", "giant", "cute", "wild", "pet", "young", "old", "fat",
    "male", "female", "my", "your", "angry", "happy", "sleepy", "fluffy", "hairy", "fast", "slow", "dead", "live", "living", "new", "used", "broken",
    "dirty", "clean", "empty", "full", "wooden", "metal", "plastic", "electric", "pink", "purple", "orange", "yellow", "green", "blue", "red", "black", "white", "brown", "grey", "gray"]);
  const NOT_REAL = new Set(["teddy", "toy", "stuffed", "plush", "plastic", "fake", "cartoon", "robot", "robotic", "lego", "paper", "chocolate", "gummy", "inflatable", "pretend", "imaginary"]);

  let COMMON = new Set();
  const setCommonWords = text => { COMMON = new Set(String(text || "").split(" ")); };

  function prepare(cat) {
    const index = new Map(), byFirst = new Map();
    const put = (key, row, alias) => {
      if (index.has(key)) return;
      index.set(key, { row, alias });
      const f = key[0]; if (!byFirst.has(f)) byFirst.set(f, []); byFirst.get(f).push(key);
    };
    for (const row of cat.answers) put(normalize(row.a), row, false);
    // Other names of one or two letters ("pe", "b") are codes, not answers a player means; only a few are kept.
    const shortOk = new Set(["uk", "us", "nz", "uae", "usa"]);
    for (const row of cat.answers) for (const name of row.al || []) { const k = normalize(name); if (k.length >= 3 || shortOk.has(k) || k === normalize(row.a)) put(k, row, true); }
    // Plural forms of every name too, without overriding a real entry.
    for (const row of cat.answers) for (const name of [row.a, ...(row.al || [])]) { const n = normalize(name); for (const v of variants(n).slice(1)) put(v, row, true); }
    const keys = [], joined = new Map();
    for (const [k, v] of index) { keys.push({ k, row: v.row, snd: sound(k) }); const c = compact(k); if (c !== k && !joined.has(c)) joined.set(c, v); }
    return {
      cat, index, byFirst, keys, joined,
      general: new Set((cat.general || []).map(normalize)),
      notIn: new Set((cat.notIn || []).map(normalize)),
      pattern: cat.pattern || (cat.prefix ? { type: "start", s: cat.prefix } : null),
      cache: loadCache(cat.key),
    };
  }

  function lookup(n, P) {
    for (const v of variants(n)) { const hit = P.index.get(v); if (hit) return hit; }
    return null;
  }
  // ---------- Layer 4: spelling correction ----------
  // Keys next to each other on a keyboard, and letters that sound alike: swapping one for the other is a cheap mistake.
  const ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"], NEAR = new Set();
  ROWS.forEach((row, y) => [...row].forEach((c, x) => { for (const [dy, dx] of [[0, -1], [0, 1], [-1, 0], [-1, 1], [1, -1], [1, 0]]) { const r = ROWS[y + dy]; if (r && r[x + dx]) NEAR.add(c + r[x + dx]); } }));
  for (const pair of ["fv", "vf", "sz", "zs", "ck", "kc", "cs", "sc", "iy", "yi", "gj", "jg", "mn", "nm", "bp", "pb", "dt", "td"]) NEAR.add(pair);
  const VOWEL = /[aeiouy]/;
  const subCost = (x, y) => x === y ? 0 : VOWEL.test(x) && VOWEL.test(y) ? (NEAR.has(x + y) ? 0.5 : 0.7) : NEAR.has(x + y) ? 0.6 : 1;
  // Weighted Damerau-Levenshtein (optimal string alignment): a swapped pair costs 0.6, a doubled or dropped double
  // letter 0.5. Gives up early once the cost passes `cap`.
  function editCost(a, b, cap) {
    if (Math.abs(a.length - b.length) > cap + 0.01) return cap + 1;
    let pp = null, prev = new Array(b.length + 1); prev[0] = 0;
    for (let j = 1; j <= b.length; j++) prev[j] = prev[j - 1] + (j > 1 && b[j - 1] === b[j - 2] ? 0.5 : 1);
    for (let i = 1; i <= a.length; i++) {
      const cur = new Array(b.length + 1); cur[0] = prev[0] + (i > 1 && a[i - 1] === a[i - 2] ? 0.5 : 1); let best = cur[0];
      for (let j = 1; j <= b.length; j++) {
        const del = prev[j] + (i > 1 && a[i - 1] === a[i - 2] ? 0.5 : 1), ins = cur[j - 1] + (j > 1 && b[j - 1] === b[j - 2] ? 0.5 : 1);
        let v = Math.min(del, ins, prev[j - 1] + subCost(a[i - 1], b[j - 1]));
        if (pp && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, pp[j - 2] + 0.6);
        cur[j] = v; if (v < best) best = v;
      }
      if (best > cap + 0.01) return cap + 1;
      pp = prev; prev = cur;
    }
    return prev[b.length];
  }
  // A rough sound key: how a word is said, not spelt (raven ~ rafen, peacock ~ peekok).
  function sound(w) {
    let s = w.replace(/[^a-z]/g, "").replace(/ture/g, "chur").replace(/tch/g, "ch").replace(/ph/g, "f").replace(/ck/g, "k").replace(/c(?=[eiy])/g, "s").replace(/[cq]/g, "k").replace(/x/g, "ks")
      .replace(/z/g, "s").replace(/v/g, "f").replace(/y/g, "i").replace(/gh/g, "g").replace(/wr/g, "r").replace(/kn/g, "n").replace(/(.)\1+/g, "$1");
    return s ? (s[0] + s.slice(1).replace(/[aeiouhw]/g, "")).replace(/(.)\1+/g, "$1") : "";
  }
  const compact = k => k.replace(/ /g, "");
  // How far a spelling may be from an answer, by length (letters only): short words need far more care, since one
  // letter can make a different word ("crow", "craw", "cow").
  const allowFor = L => L <= 3 ? 0 : L <= 4 ? 1.6 : L <= 6 ? 2 : L <= 9 ? 2.6 : 3.2;
  const autoFor = L => L <= 4 ? 1 : L <= 6 ? 1 : L <= 9 ? 1.6 : 2.2;

  // Candidates come from this question's answers only. Ranked by a noisy-channel score: how likely this spelling is
  // for each answer (edit cost, sound) plus how likely a player is to mean that answer at all (its share).
  function correct(n, P) {
    const L = compact(n).length, allow = allowFor(L);
    if (!allow) return null;
    const snd = sound(n), firsts = new Set([n[0], n[1]]);
    const scored = new Map();   // row -> best { cost, key }
    for (const info of P.keys) {
      // Spelt as it sounds ("vulchur", "nightengale"): a sound-alike gets more room, as long as the sound key says enough.
      const alike = info.snd === snd && snd.length >= 3, room = alike ? allow + 1.5 : allow;
      const d = Math.abs(info.k.length - n.length);
      if (d > room) continue;
      if (!firsts.has(info.k[0]) && !firsts.has(info.k[1]) && !alike) continue;   // keeps it fast on large lists
      let c = editCost(n, info.k, room);
      if (c > room) continue;
      if (info.snd === snd) c -= 0.4;                // sounds the same: more likely the same word
      const prev = scored.get(info.row);
      if (!prev || c < prev.cost) scored.set(info.row, { cost: c, key: info.k });
    }
    if (!scored.size) return null;
    const ranked = [...scored].map(([row, x]) => ({ row, cost: x.cost, key: x.key, ll: -2 * x.cost + 0.25 * Math.log10(Math.max(row.s || 1e-6, 1e-6)) }))
      .sort((a, b) => b.ll - a.ll);
    const best = ranked[0], second = ranked[1];
    const margin = second ? best.ll - second.ll : 9;
    // Confidence. High: close, clearly ahead of any other answer, and what was typed isn't itself an English word.
    // Medium: plausible and ahead, worth one question to the player. Anything else: low, and nothing is guessed.
    const realWord = n.split(" ").every(w => COMMON.has(w)) && n.length > 2;
    const lenOk = L >= 0.6 * compact(best.key).length;
    // A question is only asked about an answer people commonly give, and only when what was typed starts the same way
    // or sounds the same: a suggestion must never hand the player an obscure answer they didn't already have in mind.
    const startsAlike = compact(best.key).slice(0, 2) === compact(n).slice(0, 2), soundsAlike = sound(best.key) === snd && snd.length >= 2;
    const askable = (best.row.s || 0) >= 0.001 && (startsAlike || soundsAlike || best.cost <= 1);
    let level = "low";
    if (lenOk && margin >= 0.8 && best.cost <= autoFor(L) && !realWord) level = "high";
    // ...and never when much of the word would change (under about a third of its letters, more if it sounds the same).
    else if (lenOk && margin >= 0.5 && best.cost <= Math.min(allow, 0.3 * L + 0.4) + (soundsAlike ? 1.5 : 0) && askable) level = "medium";
    return { row: best.row, cost: +best.cost.toFixed(2), margin: +margin.toFixed(2), level };
  }
  function gibberish(n) {
    const letters = n.replace(/[^a-z]/g, "");
    if (letters.length < 2) return true;
    if (/(.)\1\1/.test(letters)) return true;
    if (/[^aeiouy\s]{5,}/.test(n)) return true;
    if (n.split(" ").some(w => w.length > 3 && !/[aeiouy]/.test(w))) return true;
    if (n.split(" ").some(w => w.length > 22)) return true;
    if (n.split(" ").length > 5) return true;
    if (/(qwer|wert|asdf|sdfg|zxcv|xcvb|hjkl|uiop|jkl;)/.test(letters)) return true;
    return false;
  }

  // Decisions that came back from review are cached per category, so the same answer is judged the same way next time.
  function loadCache(key) {
    try { return new Map(Object.entries(JSON.parse(localStorage.getItem("iceberg:verdicts:" + key) || "{}"))); } catch { return new Map(); }
  }
  function remember(P, text, verdict) {
    P.cache.set(normalize(text), verdict);
    try { localStorage.setItem("iceberg:verdicts:" + P.cat.key, JSON.stringify(Object.fromEntries(P.cache))); } catch { /* private mode */ }
  }

  // given: { rows: Map(row.a -> entry), texts: Set(normalized pending/invalid texts) }
  function judge(text, P, given) {
    const n = normalize(text);
    if (!n) return null;
    const res = { text: String(text).trim(), key: n };
    const dupOf = row => given && given.rows.has(row.a);
    const ok = (row, via) => Object.assign(res, dupOf(row) ? { status: "dup", row, via } : { status: "ok", row, via });

    if (P.general.has(n) || variants(n).some(v => P.general.has(v))) return Object.assign(res, { status: "invalid", reason: "Too general" });
    // "any bird", "the rarest one", "something": not an answer, and never corrected into one.
    if (/^(any|every|all|some|random|whatever|anything|something|nothing|everything|idk|dunno|rarest|the rarest|a rare|rare|my|no)( |$)/.test(n)) return Object.assign(res, { status: "invalid", reason: "Name one particular answer" });
    const hit = lookup(n, P);
    if (hit) return ok(hit.row, hit.alias ? "alias" : "exact");
    // Spaces don't make a different answer: "bluejay" is "blue jay", "sea horse" is "seahorse".
    for (const v of variants(compact(n))) { const j = P.joined.get(v) || (P.index.has(v) ? P.index.get(v) : null); if (j) return ok(j.row, "joined"); }
    // Word questions: anything that doesn't fit the letters can't be an answer (checked after known word forms,
    // so "clocks" still counts as clock for words ending in OCK).
    if (P.pattern) {
      const p = P.pattern.s, up = p.toUpperCase(), fits = w => P.pattern.type === "start" ? w.startsWith(p) : P.pattern.type === "end" ? w.endsWith(p) : w.includes(p);
      if (n.includes(" ")) return Object.assign(res, { status: "invalid", reason: "One word only" });
      if (!variants(n).some(fits)) return Object.assign(res, { status: "invalid", reason: P.pattern.type === "start" ? `Doesn't start with ${up}` : P.pattern.type === "end" ? `Doesn't end in ${up}` : `Doesn't have ${up} in it` });
    }
    if (P.notIn.has(n) || variants(n).some(v => P.notIn.has(v))) return Object.assign(res, { status: "invalid", reason: "Doesn't fit this category" });

    // A spelling mistake in the whole answer? High confidence: corrected now. Medium: the player is asked once. Low: left as typed.
    const t = (given && given.noCorrect) ? null : correct(n, P);
    if (t && t.level === "high") return Object.assign(ok(t.row, "typo"), { correction: t });
    // "baby elephant", "big red bus": describing words in front of a known answer don't make a new answer.
    const words = n.split(" ");
    for (let i = 1; i < Math.min(3, words.length); i++) {
      const front = words.slice(0, i);
      if (front.some(w => NOT_REAL.has(w)) && lookup(words.slice(i).join(" "), P)) return Object.assign(res, { status: "invalid", reason: "Not the real thing" });
      if (!front.every(w => DESCRIBE.has(w))) continue;
      // Colours only count as describing when the rest is a thing, not when together they name something else
      // ("red fox", "blue whale" are their own answers; those are found earlier as exact names when known).
      const rest = lookup(words.slice(i).join(" "), P);
      if (rest && P.cat.trimColours !== false) return ok(rest.row, "trimmed");
    }
    if (t && t.level === "medium" && !(given && given.texts.has(n))) return Object.assign(res, { status: "confirm", row: t.row, correction: t });
    const cached = P.cache.get(n);
    if (cached) {
      if (cached.status === "ok" && cached.row) { const row = P.cat.answers.find(r => r.a === cached.row); if (row) return ok(row, "review"); }
      if (cached.status === "ok") return Object.assign(res, { status: given && given.texts.has(n) ? "dup" : "ok", row: null, via: "review", verified: cached });
      if (cached.status === "invalid") return Object.assign(res, { status: "invalid", reason: cached.reason || "Reviewed: doesn't count" });
    }
    if (given && given.texts.has(n)) return Object.assign(res, { status: "dup" });
    if (n.split(" ").length > 5 || n.length > 44) return Object.assign(res, { status: "invalid", reason: "Too long to be one answer" });
    if (gibberish(n)) return Object.assign(res, { status: "invalid", reason: "Not a word we recognise" });
    return Object.assign(res, { status: "pending", reason: "Not in today's list yet" });
  }

  window.IcebergValidate = { normalize, variants, prepare, judge, remember, gibberish, setCommonWords, editCost, sound, correct };
})();
