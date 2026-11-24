// Iceberg answer checking. Runs instantly in the browser, so typing is never held up by the network.
//
// Every answer lands in one of four states:
//   ok       recognised (exactly, by another name, as a plural, with a small typo, or with an extra describing word)
//   dup      the same answer as one already given this round ("automobile" after "car")
//   pending  plausible but not in today's list. Scores nothing for now; sent for review (see verify in game.js)
//   invalid  clearly not an answer: gibberish, too general ("mammal"), wrong category, wrong first letters
//
// The layers, in order: category rules -> known names -> describing word trimmed -> typo -> decisions cached
// from review -> plausibility. A production server can add more layers (shared verified-answer database,
// AI-assisted review, human moderation) without changing this interface; see README "Answer review".
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
  const typoAllowance = n => n <= 4 ? 0 : n <= 8 ? 1 : 2;

  // Words that make something not the real thing: "teddy bear" isn't a bear.
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
    for (const row of cat.answers) for (const name of row.al || []) put(normalize(name), row, true);
    // Plural forms of every name too, without overriding a real entry.
    for (const row of cat.answers) for (const name of [row.a, ...(row.al || [])]) { const n = normalize(name); for (const v of variants(n).slice(1)) put(v, row, true); }
    return {
      cat, index, byFirst,
      general: new Set((cat.general || []).map(normalize)),
      notIn: new Set((cat.notIn || []).map(normalize)),
      prefix: cat.prefix || "",
      cache: loadCache(cat.key),
    };
  }

  function lookup(n, P) {
    for (const v of variants(n)) { const hit = P.index.get(v); if (hit) return hit; }
    return null;
  }
  function typo(n, P) {
    const allow = typoAllowance(n.replace(/ /g, "").length);
    if (!allow) return null;
    const keys = P.byFirst.get(n[0]) || [];
    let best = allow + 1, found = [];
    for (const k of keys) {
      if (Math.abs(k.length - n.length) > allow) continue;
      const d = levenshtein(n, k, allow);
      if (d < best) { best = d; found = [P.index.get(k).row]; }
      else if (d === best && d <= allow) found.push(P.index.get(k).row);
    }
    const rows = [...new Set(found)];
    if (!rows.length) return null;
    if (rows.length === 1) return rows[0];
    rows.sort((a, b) => b.s - a.s);
    return rows[0].s >= rows[1].s * 3 ? rows[0] : "ambiguous"; // only guess when one reading is far more likely
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

    if (P.prefix && !n.replace(/ /g, "").startsWith(P.prefix)) return Object.assign(res, { status: "invalid", reason: `Doesn't start with ${P.prefix.toUpperCase()}` });
    if (P.general.has(n) || variants(n).some(v => P.general.has(v))) return Object.assign(res, { status: "invalid", reason: "Too general" });
    const hit = lookup(n, P);
    if (hit) return ok(hit.row, hit.alias ? "alias" : "exact");
    if (P.notIn.has(n) || variants(n).some(v => P.notIn.has(v))) return Object.assign(res, { status: "invalid", reason: "Doesn't fit this category" });

    // "red car", "baby elephant": a describing word doesn't make a new answer.
    const words = n.split(" ");
    for (let i = 1; i < Math.min(3, words.length); i++) {
      const rest = lookup(words.slice(i).join(" "), P);
      if (rest) {
        if (words.slice(0, i).some(w => NOT_REAL.has(w))) return Object.assign(res, { status: "invalid", reason: "Not the real thing" });
        return ok(rest.row, "trimmed");
      }
    }
    // Only guess a typo when what was typed isn't itself a real word.
    const t = n.split(" ").every(w => COMMON.has(w)) ? null : typo(n, P);
    if (t && t !== "ambiguous") return ok(t, "typo");

    const cached = P.cache.get(n);
    if (cached) {
      if (cached.status === "ok" && cached.row) { const row = P.cat.answers.find(r => r.a === cached.row); if (row) return ok(row, "review"); }
      if (cached.status === "ok") return Object.assign(res, { status: given && given.texts.has(n) ? "dup" : "ok", row: null, via: "review", verified: cached });
      if (cached.status === "invalid") return Object.assign(res, { status: "invalid", reason: cached.reason || "Reviewed: doesn't count" });
    }
    if (given && given.texts.has(n)) return Object.assign(res, { status: "dup" });
    if (n.split(" ").length > 5 || n.length > 44) return Object.assign(res, { status: "invalid", reason: "Too long to be one answer" });
    if (gibberish(n)) return Object.assign(res, { status: "invalid", reason: "Not a word we recognise" });
    return Object.assign(res, { status: "pending", reason: t === "ambiguous" ? "Could be more than one answer" : "Not in today's list yet" });
  }

  window.IcebergValidate = { normalize, variants, prepare, judge, remember, gibberish, setCommonWords };
})();
