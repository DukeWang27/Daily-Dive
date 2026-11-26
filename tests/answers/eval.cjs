// Answer-checking benchmark: runs a version of validate.js over tests/answers/labeled.json and reports the rates.
//   node tests/answers/eval.cjs [--engine=old|new] [--data=old|kb] [--json=out.json] [--show=kind]
// engine old = the validate.js before this work (kept in tests/answers/validate.v1.js); new = ./validate.js
// data old = the game's answer lists as shipped; kb = the same questions with the imported datasets merged in
// (tests/answers/fixtures, built by tools/content/kbmerge.py).
const fs = require('fs'), path = require('path');
const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const ENGINE = arg('engine', 'new'), DATA = arg('data', 'old'), ROOT = path.join(__dirname, '..', '..');
global.window = {}; global.localStorage = { getItem: () => null, setItem: () => {} };
require(ENGINE === 'old' ? './validate.v1.js' : '../../validate.js');
const V = window.IcebergValidate;
if (window.IcebergValidate.setRealWords) { try { window.IcebergValidate.setRealWords(require('fs').readFileSync(require('path').join(__dirname, '../../realwords.txt'), 'utf8')); } catch {} }

const words = JSON.parse(fs.readFileSync(path.join(ROOT, 'words.json'), 'utf8')); if (words.commonWords) V.setCommonWords(words.commonWords);
const cases = JSON.parse(fs.readFileSync(path.join(__dirname, 'labeled.json'), 'utf8'));
const cats = {}, prepared = {};
const catOf = c => {
  if (cats[c.q]) return cats[c.q];
  const fx = path.join(__dirname, 'fixtures', c.q + '.json');
  if (DATA === 'kb' && fs.existsSync(fx)) return (cats[c.q] = JSON.parse(fs.readFileSync(fx, 'utf8')));
  const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'days', c.day + '.json'), 'utf8'));
  return (cats[c.q] = d.questions.find(q => q.key === c.q));
};
const res = [], times = [];
for (const c of cases) {
  const cat = catOf(c); if (!cat) continue;
  const P = prepared[c.q] || (prepared[c.q] = V.prepare(cat));
  const t = process.hrtime.bigint(); const j = V.judge(c.text, P, null); times.push(Number(process.hrtime.bigint() - t) / 1e6);
  const want = c.answer ? (V.normalize(c.answer)) : null;
  const rowMatches = row => { if (!row || !want) return false; const keys = [row.a, ...(row.al || [])].map(V.normalize); return keys.includes(want) || V.variants(want).some(v => keys.includes(v)); };
  let out;
  if (!j) out = 'rejected';
  else if (j.status === 'ok' || j.status === 'dup') out = c.expect === 'ok' ? (rowMatches(j.row) ? (j.via === 'typo' ? 'corrected' : 'accepted') : 'wrong-answer') : 'accepted-invalid';
  else if (j.status === 'confirm') out = c.expect === 'ok' ? (rowMatches(j.row) ? 'confirm-right' : 'confirm-wrong') : 'confirm-on-invalid';
  else if (j.status === 'pending') out = 'pending';
  else out = 'rejected';
  res.push({ ...c, out, via: j && j.via, got: j && j.row ? j.row.a : null, status: j && j.status });
}
const pct = (n, d) => d ? +(100 * n / d).toFixed(1) : 0;
const valid = res.filter(r => r.expect === 'ok'), invalid = res.filter(r => r.expect === 'invalid');
const typos = valid.filter(r => /typo|misspelling/.test(r.kind)), notTypos = valid.filter(r => !/typo|misspelling/.test(r.kind));
const count = (list, ...outs) => list.filter(r => outs.includes(r.out)).length;
const s = times.slice().sort((a, b) => a - b), q = p => +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(3);
const report = {
  engine: ENGINE, data: DATA, cases: res.length,
  validAcceptedAtOnce: pct(count(valid, 'accepted', 'corrected'), valid.length),
  validAcceptedAfterOneConfirm: pct(count(valid, 'accepted', 'corrected', 'confirm-right'), valid.length),
  validLeftPending: pct(count(valid, 'pending'), valid.length),
  falseRejection: pct(count(valid, 'rejected'), valid.length),
  wrongAnswerGiven: pct(count(valid, 'wrong-answer', 'confirm-wrong'), valid.length),
  invalidAccepted: pct(count(invalid, 'accepted-invalid'), invalid.length),
  invalidOfferedASuggestion: pct(count(invalid, 'confirm-on-invalid'), invalid.length),
  typoFixedAutomatically: pct(count(typos, 'corrected', 'accepted'), typos.length),
  typoFixedWithConfirm: pct(count(typos, 'corrected', 'accepted', 'confirm-right'), typos.length),
  typoWronglyCorrected: pct(count(typos, 'wrong-answer', 'confirm-wrong'), typos.length),
  correctlySpelledChanged: pct(count(notTypos, 'wrong-answer', 'confirm-wrong'), notTypos.length),
  missingFromOldListAccepted: pct(count(valid.filter(r => r.kind === 'missing-from-old-list'), 'accepted', 'corrected'), valid.filter(r => r.kind === 'missing-from-old-list').length),
  latencyMs: { mean: +(times.reduce((a, b) => a + b, 0) / times.length).toFixed(3), p50: q(0.5), p95: q(0.95), max: q(1) },
  byKind: Object.fromEntries([...new Set(res.map(r => r.kind))].map(k => { const l = res.filter(r => r.kind === k); return [k, Object.fromEntries([...new Set(l.map(r => r.out))].map(o => [o, l.filter(r => r.out === o).length]))]; })),
};
console.log(JSON.stringify(report, null, 1));
const show = arg('show', ''); if (show) res.filter(r => r.kind === show || r.out === show).slice(0, 40).forEach(r => console.log(`  ${r.q}: "${r.text}" -> ${r.out} (${r.status} ${r.via || ''} ${r.got || ''}) want ${r.answer}`));
const out = arg('json', ''); if (out) fs.writeFileSync(out, JSON.stringify({ report, res }, null, 1));
