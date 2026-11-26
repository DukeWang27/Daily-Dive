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

  let COMMON = new Set(), REAL = new Set(), KNOWN = new Set();
  const setKnownNames = names => { KNOWN = new Set(names); };
  const setCommonWords = text => { COMMON = new Set(String(text || "").split(" ")); };
  // A larger dictionary of real (rarer) English words, loaded in the background (realwords.txt). A real word is never
  // "corrected" into a different answer: "farrier" is not a typo of farmer. It goes for review instead.
  const setRealWords = text => { REAL = new Set(String(text || "").split(" ")); };
  const isWord = w => COMMON.has(w) || REAL.has(w);
  // Two spellings of one word (grey/gray, colour/color, centre/center, yoghurt/yogurt): an accepted variant, not a typo.
  const SPELL = [[/our\b/g, "or"], [/(is|ys)(e|ed|es|ing|ation)\b/g, "iz$2"], [/tre\b/g, "ter"], [/ll/g, "l"], [/ae/g, "e"], [/oe/g, "e"], [/ey\b/g, "ay"], [/gh/g, ""], [/ph/g, "f"], [/[\s-]/g, ""]];
  const spellingKey = w => SPELL.reduce((x, [re, to]) => x.replace(re, to), w);
  const sameSpelling = (a, b) => a === b || spellingKey(a) === spellingKey(b);

  function prepare(cat) {
    const index = new Map(), byFirst = new Map();
    // On a question with brands and models (granularity), a reference-list entry that is itself a known brand or
    // model ("G-Shock", "Ray-Ban Wayfarer") is not a separate answer: it counts as the thing it is. And an entry ending
    // in something the question excludes ("handbag" where bags don't count) is left out too.
    if (cat.products && !cat._gran) {
      const pp = prepProducts(cat.products), not = (cat.notIn || []).map(normalize);
      cat.answers = cat.answers.filter(r => { if (!r.pv) return true; const k = normalize(r.a);
        if (pp.models.has(k) || pp.brands.has(k) || [...pp.models.keys()].some(m => m.length > 4 && k.endsWith(m))) return false;
        return !not.some(x => x.length >= 3 && (k === x || compact(k).endsWith(compact(x)))); });
      cat._gran = true;
    }
    const put = (key, row, alias) => {
      if (index.has(key)) return;
      index.set(key, { row, alias });
      const f = key[0]; if (!byFirst.has(f)) byFirst.set(f, []); byFirst.get(f).push(key);
    };
    for (const row of cat.answers) put(normalize(row.a), row, false);
    // Other names of one or two letters ("pe", "b") are codes, not answers a player means; only a few are kept.
    const shortOk = new Set(["uk", "us", "nz", "uae", "usa"]);
    // Some lists store common misspellings as other names ("leging", "turqoise"). Those are spelling mistakes, not
    // other names: they are offered as a correction to confirm, never accepted silently.
    for (const row of cat.answers) for (const name of row.al || []) { const k = normalize(name), a = normalize(row.a);
      if (!(k.length >= 3 || shortOk.has(k) || k === a || cat.derive === "person")) continue;   // jobs: GP, RN, DJ are what people say
      // Forms of one word (clocks, knocked, boxes) are not misspellings either.
      const form = (x, y) => variants(x).includes(y) || variants(y).includes(x) || (x.startsWith(y) && /^(s|es|ed|d|ing|er|ers)$/.test(x.slice(y.length))) || (y.startsWith(x) && /^(s|es|ed|d|ing|er|ers)$/.test(y.slice(x.length)));
      const near = m => m !== k && !sameSpelling(k, m) && !form(k, m) && k.split(" ").length === m.split(" ").length && editCost(k, m, 2) <= 2;
      // Against a sibling name, only a classic slip counts (one letter dropped, or two swapped): two real spellings
      // that differ by a letter (galosh, golosh) are both kept.
      const slip = m => { for (let i = 0; i < m.length; i++) { if (m.slice(0, i) + m.slice(i + 1) === k) return true; if (i < m.length - 1 && m.slice(0, i) + m[i + 1] + m[i] + m.slice(i + 2) === k) return true; } return false; };
      const typo = k !== a && !COMMON.has(k) && !form(k, a) && [row.a, ...(row.al || [])].map(normalize).some(m => m === a ? near(m) : near(m) && slip(m));
      put(k, row, typo ? "typo" : true); }
    // Plural forms of every name too, without overriding a real entry.
    for (const row of cat.answers) for (const name of [row.a, ...(row.al || [])]) { const n = normalize(name); const base = index.get(n), kind = name === row.a ? "form" : base && base.row === row && base.alias === "typo" ? "typo" : true; for (const v of variants(n).slice(1)) put(v, row, kind); }
    const keys = [], joined = new Map();
    for (const [k, v] of index) { keys.push({ k, row: v.row, snd: sound(k) }); const c = compact(k); if (c !== k && !joined.has(c)) joined.set(c, v); }
    return {
      cat, index, byFirst, keys, joined,
      general: new Set((cat.general || []).map(normalize)),
      notIn: new Set((cat.notIn || []).map(normalize)),
      pattern: cat.pattern || (cat.prefix ? { type: "start", s: cat.prefix } : null),
      heads: headWords(cat),
      cache: loadCache(cat.key),
      // Occupation questions: the name of a field for the person in it ("accounting" for accountant), and short forms
      // that could mean several different answers ("PM").
      fields: new Map(Object.entries(cat.fields || {}).map(([k, v]) => [normalize(k), v])),
      ambiguous: new Map(Object.entries(cat.ambiguous || {}).map(([k, v]) => [normalize(k), v])),
      derive: cat.derive || null,
      products: cat.products ? prepProducts(cat.products) : null,
      granularity: cat.granularity || (cat.products ? "category" : null),
    };
  }

  // ---------- Layer 3c: brands, models and descriptions (answer granularity) ----------
  // A question says what one answer is (cat.granularity):
  //   "category" ("Name something you wear"): a brand or model counts as the kind of thing it is, and scores as that
  //     ("Rolex Submariner" is a watch). Extra detail is accepted and never earns extra rarity.
  //   "brand" ("Name a watch brand"): a model counts as its brand.
  //   "model" ("Name a luxury watch model"): a brand alone is asked to be made specific.
  // Description piled on a known answer ("my friend's scratched blue watch") is the answer it describes.
  function prepProducts(pr) {
    const brands = new Map(), models = new Map();
    for (const [name, b] of Object.entries(pr.brands || {})) for (const k of [name, ...(b.al || [])]) brands.set(normalize(k), { name, ...b });
    for (const [name, m] of Object.entries(pr.models || {})) for (const k of [name, ...(m.al || [])]) {
      const md = { name, ...m }; models.set(normalize(k), md);
      const br = pr.brands && pr.brands[m.brand]; for (const bk of [m.brand, ...((br && br.al) || [])]) models.set(normalize(bk + " " + k), md);
    }
    return { brands, models };
  }
  const CONNECT = /\b(with|that|which|who|from|for|in|on|at|made|bought|gave|got|i|my|his|her|their)\b/;
  function specific(n, P, res) {
    const G = P.products, words = n.split(" "), cap = s => s.replace(/^./, c => c.toUpperCase());
    const ok = (row, detail, note) => Object.assign(res, { status: "ok", row, via: "specific", detail, note });
    const asRow = name => { const h = lookup(normalize(name), P); return h ? h.row : null; };
    const thing = is => { if (P.notIn.has(normalize(is)) || variants(normalize(is)).some(v => P.notIn.has(v))) return { no: is }; const r = asRow(is); return r ? { row: r } : null; };
    if (G) {
      // A model, with or without its brand in front, in the plural too ("Air Jordans", "Stan Smiths").
      const m = variants(n).map(v => G.models.get(v)).find(Boolean);
      if (m) {
        if (P.granularity === "brand") { const r = asRow(m.brand); if (r) return ok(r, `${m.brand} ${m.name}`, "a model counts as its brand"); }
        const t = thing(m.is);
        if (t && t.no) return Object.assign(res, { status: "invalid", reason: `A ${m.brand} ${m.name} is a ${m.is}, and those don't count here` });
        if (t) return ok(t.row, m.name.startsWith(m.brand) ? m.name : `${m.brand} ${m.name}`, "brands and models count as the item they are");
      }
      // A brand, then a known kind of thing ("Cartier watch", "Hermès silk tie").
      // A brand's name typed with a slip ("Rollex", "Addidas"): one letter out, on names of five letters or more.
      const brandAt = k => G.brands.get(k) || (k.length >= 5 ? (() => { for (const [bk, bv] of G.brands) if (Math.abs(bk.length - k.length) <= 1 && bk[0] === k[0] && editCost(k, bk, 1) <= 1) return bv; return null; })() : null);
      for (let i = Math.min(4, words.length); i >= 1; i--) {
        const b = brandAt(words.slice(0, i).join(" ")); if (!b) continue;
        const rest = words.slice(i).join(" ");
        if (!rest) {
          if (P.granularity === "model") return Object.assign(res, { status: "ambiguous", reason: `${b.name} is a brand: name one particular model` });
          const rows = b.makes.map(thing).filter(x => x && x.row).map(x => x.row);
          if (rows.length === 1 && b.makes.length === 1) return ok(rows[0], b.name, "a brand counts as the thing it makes");
          if (rows.length) return Object.assign(res, { status: "ambiguous", reason: `${b.name} makes several things you can wear (${b.makes.slice(0, 3).join(", ")}). Type which one, e.g. ${b.name} ${b.makes[0]}` });
          continue;
        }
        const mm = G.models.get(rest); if (mm) return specific(rest, P, res);
        const r = lookup(rest, P) || describe(rest, P);
        if (r) return ok(r.row || r, `${b.name} ${rest}`, "brands count as the item they are");
        // A brand and a model we don't know ("Rolex Turbo Phantom X9"): counted as what the brand makes, if that's one
        // thing, without claiming the model exists. Never a separate, rarer answer.
        if (b.makes.length === 1 && P.granularity !== "model") { const t = thing(b.makes[0]); if (t && t.row) return ok(t.row, b.name, "counted as what the brand makes"); }
      }
    }
    if (P.cat.describe || G) { const r = describe(n, P); if (r) return ok(r, null, "extra description doesn't make a different answer"); }
    return null;
  }
  // The thing a description is about: the first clause, without possessives, ending in a known answer.
  function describe(n, P) {
    const clause = n.replace(/^(my|your|his|her|their|our|a|an|the)( \w+s)? /, "").split(CONNECT)[0].trim();
    const w = clause.split(" ");
    for (let k = Math.min(3, clause === n ? w.length - 1 : w.length); k >= 1; k--) { const h = lookup(w.slice(-k).join(" "), P); if (h) return h.row; }
    return null;
  }

  // ---------- Layer 3b: what people call a job, from what they call the work ----------
  // "Accounting" means accountant, "dentistry" dentist, "data science" data scientist, "investment banking" investment
  // banker. The rules only propose names; a name counts only if it is a real answer on the list. One match counts
  // (shown as "Counted as ..."); several (physics: physicist or physician?) are offered as a suggestion, never counted
  // silently. Only for questions that ask for a person (derive: "person").
  const PERSON_RULES = [
    [/ing$/, w => { const s = w.slice(0, -3); return [s + "er", s + "or", s + "ant", s + "ent", s + "e", s, s + "ist", s.replace(/(.)\1$/, "$1") + "er"]; }],
    [/ure$/, w => [w.slice(0, -3) + "urist", w.slice(0, -3) + "uralist"]],
    [/my$/, w => [w.slice(0, -1) + "ist", w.slice(0, -1) + "er"]],
    [/ology$/, w => [w.slice(0, -1) + "ist", w.slice(0, -1) + "ian"]],
    [/ics$/, w => [w.slice(0, -1) + "ist", w.slice(0, -3) + "ist", w.slice(0, -1) + "ian"]],
    [/ysis$/, w => [w.slice(0, -3) + "st"]],
    [/ment$/, w => [w.slice(0, -4) + "er", w.slice(0, -4) + "or"]],
    [/ence$/, w => [w.slice(0, -4) + "entist", w.slice(0, -2) + "t"]],
    [/ism$/, w => [w.slice(0, -3) + "ist"]],
    [/ry$/, w => [w.slice(0, -2), w.slice(0, -1) + "ist", w.slice(0, -2) + "er", w.slice(0, -1) + "er"]],
    [/ion$/, w => [w.slice(0, -3) + "or", w.slice(0, -3) + "er", w + "ist", w + "er", w.slice(0, -3) + "ian"]],
    [/(graphy|nomy|sophy|metry|apy|edy|macy|istry|ery)$/, w => [w.slice(0, -1) + "er", w.slice(0, -1) + "ist", w.slice(0, -1) + "ian"]],
    [/ia$/, w => [w.slice(0, -2) + "ist", w.slice(0, -1) + "n"]],
  ];
  const PERSONISH = /(er|or|ist|ian|ant|ent|man|woman|wright|smith|maker|keeper|herd|monger|eer|ier|yer|ee|ess|ster|naut|ive|ary|ard|ic|ogist|aut|ite|ward)s?$/;
  function derive(n, P, retried) {
    if (P.derive !== "person") return null;
    const found = [], add = row => { if (row && !found.includes(row)) found.push(row); };
    const t = n.replace(/^(an?|the|be an?|work in|working in|work as an?|in) /, "");
    const f = P.fields.get(t) || variants(t).map(v => P.fields.get(v)).find(Boolean);
    if (f) for (const name of f) { const h = lookup(normalize(name), P); if (h) add(h.row); }
    if (!found.length) {
      if (t !== n) { const h = lookup(t, P); if (h) return { rows: [h.row], sure: true }; }
      const words = t.split(" "), last = words.pop(), pre = words.length ? words.join(" ") + " " : "";
      // A single word for an activity ("running", "shopping") only leads to a job on the game's own list, not to every
      // title in a reference list (runner, shopper): with a word in front ("investment banking") the reference list counts.
      for (const [re, make] of PERSON_RULES) if (re.test(last)) for (const c of make(last)) { if (c.length < 3) continue; const h = lookup(pre + c, P); if (h && (pre || !h.row.pv || !/ing$/.test(last) || last.length >= 10)) add(h.row); }
    }
    if (!found.length && !retried) {
      // "Quant traiding", "investmant banking": a slip inside a longer name. Each word unknown to the question is
      // matched against the words its answers and fields use (one or two letters out, by length), then tried again.
      const vocab = P.vocab || (P.vocab = (() => { const v = new Set(); for (const k of P.index.keys()) k.split(" ").forEach(w => w.length >= 4 && v.add(w)); for (const k of P.fields.keys()) k.split(" ").forEach(w => w.length >= 4 && v.add(w)); return [...v]; })());
      const has = new Set(vocab);
      // Every word equally close is tried ("traiding": trading or training?), and only one that leads to an answer counts.
      const opts = t.split(" ").map(w => {
        if (w.length < 5 || has.has(w)) return [w];
        const room = w.length >= 8 ? 2 : 1.2, near = [];
        for (const v of vocab) { if (Math.abs(v.length - w.length) > 2 || v[0] !== w[0]) continue; const c = editCost(w, v, room); if (c <= room) near.push([c, v]); }
        near.sort((a, b) => a[0] - b[0]);
        return near.length ? near.filter(x => x[0] <= near[0][0] + 0.3).slice(0, 4).map(x => x[1]) : [w];
      });
      let combos = [[]];
      for (const o of opts) { combos = combos.flatMap(c => o.map(w => c.concat(w))); if (combos.length > 16) break; }
      const results = [];
      for (const c of combos.slice(0, 16)) {
        const fixed = c.join(" "); if (fixed === t) continue;
        const h = lookup(fixed, P); if (h) { if (!results.includes(h.row)) results.push(h.row); continue; }
        const again = derive(fixed, P, true); if (again) again.rows.forEach(r => { if (!results.includes(r)) results.push(r); });
      }
      if (results.length) return { rows: results, sure: results.length === 1, typo: true };
    }
    return found.length ? { rows: found, sure: found.length === 1 && !(f && f.length > 1) } : null;
  }

  // The question's own category words ("dog", "breed", "bird", "colour"): "Mexican Hairless Dog" names the same breed
  // as "Mexican Hairless", so a trailing (or leading) category word is dropped when what is left is a known answer.
  // It is never used to make a new answer, only to find one that is already listed.
  const HEAD_STOP = new Set(["name", "a", "an", "the", "of", "that", "which", "is", "are", "you", "your", "can", "with", "in", "on", "for", "to", "and", "or",
    "any", "one", "kind", "type", "sort", "something", "thing", "things", "people", "might", "would", "could", "has", "have", "from", "by", "at", "its", "it", "not"]);
  const HEAD_EXTRA = ["breed", "species", "colour", "color", "shade", "variety", "brand", "type", "kind", "animal", "plant", "flower", "tree", "fruit", "vegetable"];
  function headWords(cat) {
    const out = new Set(HEAD_EXTRA);
    for (const w of normalize(`${cat.prompt || ""} ${cat.title || ""}`).split(" ")) {
      if (w.length < 3 || HEAD_STOP.has(w)) continue;
      out.add(w); if (w.endsWith("s")) out.add(w.slice(0, -1)); else out.add(w + "s");
    }
    return out;
  }
  function headTrim(n, P) {
    const words = n.split(" ");
    if (words.length < 2 || !P.heads) return null;
    const tries = [];
    if (P.heads.has(words[words.length - 1])) tries.push(words.slice(0, -1));
    if (P.heads.has(words[0])) tries.push(words.slice(1));
    for (const t of tries) { const hit = lookup(t.join(" "), P); if (hit) return hit; }
    return null;
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
  function classicSlip(a, b) {
    if (a === b) return true;
    if (a.length === b.length) { const d = []; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d.push(i); return d.length === 2 && d[1] === d[0] + 1 && a[d[0]] === b[d[1]] && a[d[1]] === b[d[0]]; }
    const [lo, hi] = a.length < b.length ? [a, b] : [b, a];
    if (hi.length - lo.length !== 1) return false;
    for (let i = 0; i < hi.length; i++) if (hi.slice(0, i) + hi.slice(i + 1) === lo) return i > 0 && hi[i] === hi[i - 1] || i < hi.length - 1 && hi[i] === hi[i + 1];
    return false;
  }
  // Corrected without asking only for a small slip: in short names a swapped or doubled letter (Rhone is not Rhine),
  // otherwise about one letter, two in long names. Anything bigger is asked about first.
  const autoFor = L => L <= 5 ? 0.6 : L <= 9 ? 1.1 : 1.6;

  // Candidates come from this question's answers only. Ranked by a noisy-channel score: how likely this spelling is
  // for each answer (edit cost, sound) plus how likely a player is to mean that answer at all (its share).
  function correct(n, P) {
    const L = compact(n).length, allow = allowFor(L);
    if (!allow) return null;
    const snd = sound(n), firsts = new Set([n[0], n[1]]);
    const scored = new Map();   // row -> best { cost, key }
    // Only names that start with one of the first two letters typed, or sound the same, can be candidates (below), so
    // only those are scanned: a large list costs no more than a small one.
    if (!P.byChar) { P.byChar = new Map(); P.bySnd = new Map(); for (const info of P.keys) { for (const c of new Set([info.k[0], info.k[1]])) { if (!P.byChar.has(c)) P.byChar.set(c, []); P.byChar.get(c).push(info); } if (!P.bySnd.has(info.snd)) P.bySnd.set(info.snd, []); P.bySnd.get(info.snd).push(info); } }
    const pool = new Set([...(P.byChar.get(n[0]) || []), ...(P.byChar.get(n[1]) || []), ...(P.bySnd.get(snd) || [])]);
    for (const info of pool) {
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
    // A name that is itself a real thing somewhere in the game's lists (Slovenia, the Rhone, Enron) is never
    // corrected into a different answer: it is probably what the player meant, and simply doesn't fit here.
    if (KNOWN.has(n)) return { row: best.row, cost: +best.cost.toFixed(2), margin: 9, level: "low" };
    const realWord = n.split(" ").every(w => isWord(w)) && n.length > 2;
    // A correctly spelt real word is never turned into a different answer (it may be a real answer missing from the list).
    if (realWord && n.split(" ").some(w => w.length >= 4 || REAL.has(w))) return { row: best.row, cost: +best.cost.toFixed(2), margin: +margin.toFixed(2), level: "low" };
    // A real word one letter away that isn't on the list ("farier" -> farrier, not farmer) is the likelier meaning:
    // suggest nothing, and let review decide.
    if (best.cost > 1 && !n.includes(" ") && n.length >= 6 && REAL.size && nearWord(n, best.key)) return { row: best.row, cost: +best.cost.toFixed(2), margin: +margin.toFixed(2), level: "low" };
    const lenOk = L >= 0.6 * compact(best.key).length;
    // A question is only asked about an answer people commonly give, and only when what was typed starts the same way
    // or sounds the same: a suggestion must never hand the player an obscure answer they didn't already have in mind.
    const startsAlike = compact(best.key).slice(0, 2) === compact(n).slice(0, 2), soundsAlike = sound(best.key) === snd && snd.length >= 2;
    const askable = (best.row.s || 0) >= 0.001 && (startsAlike || soundsAlike || best.cost <= 1);
    let level = "low";
    // In a short name only a classic slip (two letters swapped, a letter doubled or dropped from a double) is corrected
    // without asking: "Rhone" sounds like "Rhin", and is a different river.
    const slipOnly = L > 5 || classicSlip(compact(n), compact(best.key));
    if (lenOk && margin >= 0.8 && best.cost <= autoFor(L) && !realWord && slipOnly) level = "high";
    // ...and never when much of the word would change (under about a third of its letters, more if it sounds the same).
    else if (lenOk && margin >= 0.5 && best.cost <= Math.min(allow, 0.3 * L + 0.4) + (soundsAlike ? 1.5 : 0) && askable) level = "medium";
    return { row: best.row, cost: +best.cost.toFixed(2), margin: +margin.toFixed(2), level };
  }
  // Is there a real word one edit from w (other than the candidate)? Checks the ~50 x length single edits, not the dictionary.
  function nearWord(w, except) {
    const abc = "abcdefghijklmnopqrstuvwxyz", seen = new Set([except]);
    const test = x => { if (seen.has(x)) return false; seen.add(x); return x.length >= 4 && REAL.has(x) && !COMMON.has(x); };   // a rare real word: an everyday word nearby (rake, safe) says nothing
    for (let i = 0; i <= w.length; i++) {
      if (i < w.length && test(w.slice(0, i) + w.slice(i + 1))) return true;
      if (i < w.length - 1 && test(w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2))) return true;
      for (const c of abc) { if (test(w.slice(0, i) + c + w.slice(i))) return true; if (i < w.length && c !== w[i] && test(w.slice(0, i) + c + w.slice(i + 1))) return true; }
    }
    return false;
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

    // Several answers in one ("Zune, Kin and Windows Phone", "Prada and Miu Miu"): one at a time. Only when the whole
    // thing isn't itself a name ("Marks and Spencer", "Tom and Jerry").
    if (/,|;|&| and | or /i.test(" " + String(text) + " ") && !lookup(n, P)) {
      const segs = String(text).split(/\s*(?:,|;|&|\band\b|\bor\b)\s*/i).map(x => normalize(x).replace(/^(the|a|an)\s+/, "")).filter(Boolean);
      const known = segs.filter(x => lookup(x, P)).length, short = segs.every(x => x.split(" ").length <= 3);
      if (segs.length >= 2 && (known >= 2 || (known >= 1 && short && /,|;/.test(String(text))))) return Object.assign(res, { status: "invalid", reason: "One answer at a time" });
    }
    // Brands, models and descriptions on questions that take them, before anything is ruled out as "not one answer".
    if ((P.products || P.cat.describe) && !lookup(n, P) && n.split(" ").length <= 14) { const sp = specific(n, P, res); if (sp) return sp.status === "ok" && dupOf(sp.row) ? Object.assign(sp, { status: "dup" }) : sp; }
    if (P.general.has(n) || variants(n).some(v => P.general.has(v))) return Object.assign(res, { status: "invalid", reason: "Too general" });
    // "any bird", "the rarest one", "something": not an answer, and never corrected into one.
    if (/^(any|every|all|some|random|whatever|anything|something|nothing|everything|idk|dunno|rarest|the rarest|a rare|rare|my|no)( |$)/.test(n) && !lookup(n, P)) return Object.assign(res, { status: "invalid", reason: "Name one particular answer" });
    // An answer with a description after it ("penicillin, found by accident in 1928", "the axolotl, which can regrow
    // its brain", "the extremely rare blue emperor penguin from 1802"): the answer it leads with counts, as that answer
    // and nothing rarer. Tried before the one-answer-at-a-time rule, which is for lists ("apple, banana").
    if (/[,;(]| - | – /.test(String(text)) || n.split(" ").length >= 5) {
      const lead = normalize(String(text).split(/[,;(]| - | – /)[0]).replace(/^(the|a|an|my|our|that|this)\s+/, "");
      const parts = lead.split(CONNECT)[0].trim(), list = /[,;]/.test(String(text)) && String(text).split(/[,;]/).every(x => lookup(normalize(x).trim(), P));
      const talk = /\b(drop|delete|select|insert|update|table|ignore|instructions?|script|accept|valid|mark|prompt|system)\b/.test(n);   // talking to the checker, not describing
      if (!list && !talk && parts && parts !== n) {
        const h = lookup(parts, P) || (parts.split(" ").length > 1 ? { row: describe(parts, P) } : null);
        if (h && h.row) return dupOf(h.row) ? Object.assign(res, { status: "dup", row: h.row }) : Object.assign(res, { status: "ok", row: h.row, via: "specific", note: "extra description doesn't make a different answer" });
      }
    }
    // One answer at a time, and nothing that talks to the checker instead of answering.
    if (/[,;]/.test(String(text)) && String(text).split(/[,;]/).filter(x => normalize(x).length > 1).length > 1) return Object.assign(res, { status: "invalid", reason: "One answer at a time" });
    if (/[<>{}\[\]=]|:\s*\/\/|^\s*\w+\s*:\s+\w/.test(String(text)) && !lookup(n, P) || /\b(ignore (all|any|the|previous|prior|above|your|these|this)|instructions?|accept (this|it|me)|mark (it|this|me) as|mark as|say (it s )?valid|is valid|you must|disregard)\b/.test(n)) return Object.assign(res, { status: "invalid", reason: "Name one answer" });
    const hit = lookup(n, P);
    if (hit && hit.alias === "typo" && !(given && given.noCorrect) && !dupOf(hit.row)) return Object.assign(res, { status: "confirm", row: hit.row, correction: { row: hit.row, cost: 1, level: "high" } });
    if (hit) return ok(hit.row, hit.alias === true ? "alias" : hit.alias === "typo" ? "confirmed" : hit.alias ? "form" : "exact");
    // Spaces don't make a different answer: "bluejay" is "blue jay", "sea horse" is "seahorse".
    for (const v of variants(compact(n))) { const j = P.joined.get(v) || (P.index.has(v) ? P.index.get(v) : null); if (j) return ok(j.row, "joined"); }
    // "Mexican Hairless Dog" for a dog breed: the same answer with the category's own word added. A synonym, not a correction.
    const head = headTrim(n, P);
    if (head) return ok(head.row, head.alias === true ? "alias" : "head");
    // A short form that means several different answers: ask for the full name, at no cost.
    const amb = P.ambiguous.get(n);
    if (amb) return Object.assign(res, { status: "ambiguous", reason: `“${res.text}” could mean ${amb.slice(0, -1).join(", ")} or ${amb[amb.length - 1]}. Type the full name` });
    // The work for the worker: "accounting" counts as accountant; an unclear one is offered, not counted.
    const dv = derive(n, P);
    if (dv && dv.sure) return ok(dv.rows[0], "field");
    if (dv) return Object.assign(res, { status: "confirm", row: dv.rows[0], correction: { row: dv.rows[0], cost: 1, level: "field", options: dv.rows } });
    // Word questions: anything that doesn't fit the letters can't be an answer (checked after known word forms,
    // so "clocks" still counts as clock for words ending in OCK).
    if (P.pattern) {
      const p = P.pattern.s, up = p.toUpperCase(), fits = w => P.pattern.type === "start" ? w.startsWith(p) : P.pattern.type === "end" ? w.endsWith(p) : w.includes(p);
      if (n.includes(" ")) return Object.assign(res, { status: "invalid", reason: "One word only" });
      if (!variants(n).some(fits)) return Object.assign(res, { status: "invalid", reason: P.pattern.type === "start" ? `Doesn't start with ${up}` : P.pattern.type === "end" ? `Doesn't end in ${up}` : `Doesn't have ${up} in it` });
    }
    if (P.notIn.has(n) || variants(n).some(v => P.notIn.has(v))) return Object.assign(res, { status: "invalid", reason: "Doesn't fit this category" });

    // A spelling mistake in the whole answer? It is never replaced silently: high or medium confidence, the player is
    // asked "Did you mean ...?" first (below, after describing words). Low: left as typed.
    const t = (given && given.noCorrect) ? null : correct(n, P);
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
    // A clear slip (high confidence, not itself a word) is corrected straight away and said so ("Accepted as: Porsche");
    // a plausible one is asked about first. Low: left as typed.
    if (t && t.level === "high" && !(given && given.texts.has(n))) return Object.assign(ok(t.row, "typo"), { correction: t });
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
    // Asking for a person (a job): one everyday word that isn't a word for a person ("banana", "happy", "table") can't be
    // the answer. Anything else unknown waits for review.
    if (P.derive === "person" && !n.includes(" ") && COMMON.has(n) && !PERSONISH.test(n)) return Object.assign(res, { status: "invalid", reason: "That isn't a job" });
    // Close to something on the list (a likely slip, even an unclear one): the game warns once before using a guess.
    return Object.assign(res, { status: "pending", reason: "Not in today's list yet", near: !!t });
  }

  // A question that names a shared reference list (cat.kb: "occupations") gets that list's answers added to its own:
  // every name not already on the question is added, marked provisional (its rarity is an estimate). The question's
  // own rows and estimates always win. Also brings the list's fields and ambiguous short forms.
  function mergeKb(cat, kb) {
    if (!kb || cat._kb) return cat;
    if (kb.brands || kb.models) { cat.products = kb; cat._kb = true; return cat; }   // a products list (brands and models)
    const have = new Set();
    for (const r of cat.answers) { have.add(normalize(r.a)); for (const x of r.al || []) have.add(normalize(x)); }
    const add = [];
    for (const r of kb.rows) {
      const k = normalize(r.a);
      if (have.has(k)) { const mine = cat.answers.find(x => normalize(x.a) === k); if (mine) for (const al of r.al || []) if (!have.has(normalize(al))) { (mine.al = mine.al || []).push(al); have.add(normalize(al)); } continue; }
      const al = (r.al || []).filter(x => !have.has(normalize(x)));
      add.push({ a: r.a, s: r.s, al, pv: r.pv ? 1 : undefined }); have.add(k); al.forEach(x => have.add(normalize(x)));
    }
    cat.answers = cat.answers.concat(add);
    cat.fields = Object.assign({}, kb.fields || {}, cat.fields || {});
    cat.ambiguous = Object.assign({}, kb.ambiguous || {}, cat.ambiguous || {});
    if (kb.derive) cat.derive = cat.derive || kb.derive;
    cat._kb = true;
    return cat;
  }

  // Which other categories know this answer (content/kb/lexicon.json), with spelling slips allowed: "terrodactyl" ->
  // pterodactyl, a dinosaur or other prehistoric animal. Only to explain; it never makes an answer count.
  let LEXP = null;
  function elsewhere(text, lex, skipLabel) {
    if (!lex) return null;
    if (!LEXP) {
      const rows = Object.keys(lex.names).map(k => ({ a: k, s: 0.01, ids: lex.names[k] }));
      LEXP = prepare({ key: "_lexicon", answers: rows, prompt: "", title: "" });
    }
    const n = normalize(text); if (!n || n.length < 3) return null;
    let row = null, fixed = false;
    const hit = lookup(n, LEXP); if (hit) row = hit.row;
    // A slip: only names that start with the same two letters or sound the same are compared, so this stays well
    // under a millisecond on a 28,000-name dictionary. One or two letters out, by length; the closest wins.
    if (!row && n.length >= 5) {
      // Buckets: first two letters; letters two and three (a silent first letter: "terrodactyl" for pterodactyl); sound.
      if (!LEXP.pre2) { LEXP.pre2 = new Map(); LEXP.snd2 = new Map(); const put = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
        for (const info of LEXP.keys) { put(LEXP.pre2, info.k.slice(0, 2), info); put(LEXP.pre2, "_" + info.k.slice(1, 3), info); put(LEXP.snd2, info.snd, info); } }
      const room = n.length >= 9 ? 2 : n.length >= 6 ? 1.5 : 1, snd = sound(n);
      let best = null, bc = room + 0.01;
      for (const info of [...(LEXP.pre2.get(n.slice(0, 2)) || []), ...(LEXP.pre2.get("_" + n.slice(0, 2)) || []), ...(LEXP.snd2.get(snd) || [])]) {
        if (Math.abs(info.k.length - n.length) > 2) continue;
        let c = editCost(n, info.k, room + 0.5); if (info.snd === snd && snd.length >= 3) c -= 0.5;
        if (c < bc) { bc = c; best = info.row; }
      }
      if (best && !KNOWN.has(n) && !n.split(" ").every(w => isWord(w))) { row = best; fixed = true; }   // a real word is meant as itself
    }
    if (!row) return null;
    const labels = row.ids.map(i => lex.labels[i]).filter(l => l !== skipLabel);
    return labels.length ? { name: row.a, labels, fixed } : null;
  }

  window.IcebergValidate = { setKnownNames, mergeKb, elsewhere, normalize, variants, prepare, judge, remember, gibberish, setCommonWords, setRealWords, editCost, sound, correct, sameSpelling };
})();
