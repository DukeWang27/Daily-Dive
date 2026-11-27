// Independent challenge test for the editorial v2 questions (EDITORIAL-V2 step 9). The cases
// (content/curated/challenge/v2-cases.json, private) were written by testers who saw only each question's wording,
// rules and granularity, never its answer list, and labelled independently:
//   { cases: [ { id, tests: [ { text, label: "valid" | "invalid" | "ambiguous", kind, as? } ] } ] }
//   kinds: obvious, moderate, specialist, extreme (valid, by obscurity); phrasing, slang, misspelling, brand (valid,
//   other forms: alias recognition); ambiguous; plausible_invalid, fabricated, adversarial (invalid).
// Each case runs through the game's own checker (validate.js) against the list the playtest gets (curated.py).
// Measures per question and overall: valid acceptance, invalid rejection, alias recognition, false positives
// (invalid accepted, including a "Did you mean" that offers a wrong answer), false negatives (valid rejected outright),
// pending (valid left for review: the hybrid check's job), and latency (median, p95).
// Writes content/curated/challenge/v2-results.json for the review dashboard.
//   node tests/answers/v2-challenge.cjs [--show]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..', '..'), F = path.join(ROOT, 'content', 'curated', 'challenge', 'v2-cases.json'), SHOW = process.argv.includes('--show');
if (!fs.existsSync(F)) { console.log('no v2 challenge cases here (private content)'); process.exit(0); }
global.window = {}; global.localStorage = { getItem: () => null, setItem: () => {} };
require('../../validate.js'); const V = window.IcebergValidate;
V.setRealWords(fs.readFileSync(path.join(ROOT, 'realwords.txt'), 'utf8'));
const w = JSON.parse(fs.readFileSync(path.join(ROOT, 'words.json'), 'utf8')); if (w.commonWords) V.setCommonWords(w.commonWords);
const qs = JSON.parse(execFileSync('python3', ['-c', `
import sys, json, glob, os; sys.path.insert(0, ${JSON.stringify(path.join(ROOT, 'tools', 'playtest'))}); import curated
out = {}
for p in sorted(glob.glob(${JSON.stringify(path.join(ROOT, 'content', 'curated'))} + '/batch-*.json')):
    for q in json.load(open(p))['questions']:
        if q.get('verdict') == 'proposed-v2': out[q['id']] = curated.question(q, os.path.basename(p)[:-5])
print(json.dumps(out))`], { maxBuffer: 1 << 28 }).toString());
const kbFor = cat => { if (!cat.kb) return; const [f, part] = cat.kb.split(':'); const kb = JSON.parse(fs.readFileSync(path.join(ROOT, 'kb', f + '.json'), 'utf8')); V.mergeKb(cat, part ? kb[part] : kb); };
const now = () => Number(process.hrtime.bigint()) / 1e6, pct = (a, b) => b ? Math.round(100 * a / b) + '%' : '-';
const q95 = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(.95 * s.length))] : 0; };
const ALIAS = new Set(['phrasing', 'slang', 'misspelling', 'brand']), INV = new Set(['plausible_invalid', 'fabricated', 'adversarial']);
const cases = JSON.parse(fs.readFileSync(F, 'utf8')).cases, results = {}, times = [];
const T = { valid: 0, accepted: 0, pending: 0, rejected: 0, invalid: 0, wrong: 0, alias_n: 0, alias_ok: 0, amb: 0 };
console.log('question'.padEnd(30), 'valid found  pending  rejected | alias forms | invalid accepted');
for (const c of cases) {
  const cat = qs[c.id]; if (!cat) { console.log(c.id.padEnd(30), 'no such question'); continue; }
  kbFor(cat); const P = V.prepare(cat); V.judge('warmup', P, null);
  const R = { valid: 0, recognised: 0, pending: 0, rejected: 0, invalid: 0, wrong: 0, alias_n: 0, alias_ok: 0, missing: [], wrongs: [], rejectedValid: [] };
  for (const t of c.tests) {
    const t0 = now(), j = V.judge(t.text, P, null); times.push(now() - t0);
    const st = j.status, hit = st === 'ok' || st === 'confirm' || st === 'ambiguous';
    if (t.label === 'valid') {
      R.valid++; if (hit) R.recognised++; else if (st === 'pending') { R.pending++; R.missing.push(t.text); } else { R.rejected++; R.rejectedValid.push(t.text); }
      if (ALIAS.has(t.kind)) { R.alias_n++; if (hit) R.alias_ok++; }
    } else if (t.label === 'invalid') { R.invalid++; if (st === 'ok' || st === 'confirm') { R.wrong++; R.wrongs.push(`${t.text} -> ${j.row ? j.row.a : '?'}`); } }
    else T.amb++;
  }
  results[c.id] = R;
  for (const k of ['valid', 'pending', 'rejected', 'invalid', 'wrong', 'alias_n', 'alias_ok']) T[k] += R[k]; T.accepted += R.recognised;
  console.log(c.id.padEnd(30), `${pct(R.recognised, R.valid).padStart(5)} ${pct(R.pending, R.valid).padStart(8)} ${pct(R.rejected, R.valid).padStart(9)} | ${pct(R.alias_ok, R.alias_n).padStart(11)} | ${pct(R.wrong, R.invalid)}`);
  if (SHOW) { if (R.missing.length) console.log('   pending (valid):', R.missing.join(' | ')); if (R.rejectedValid.length) console.log('   REJECTED (valid):', R.rejectedValid.join(' | ')); if (R.wrongs.length) console.log('   wrong accepted:', R.wrongs.join(' | ')); }
}
times.sort((a, b) => a - b);
console.log(`\nALL ${Object.keys(results).length} questions: ${T.valid} valid answers: ${pct(T.accepted, T.valid)} recognised, ${pct(T.pending, T.valid)} left pending (hybrid check / review), ${pct(T.rejected, T.valid)} rejected outright (false negatives)`);
console.log(`other forms (phrasings, slang, misspellings, brands): ${pct(T.alias_ok, T.alias_n)} recognised; ${T.invalid} invalid answers: ${pct(T.invalid - T.wrong, T.invalid)} rejected, ${pct(T.wrong, T.invalid)} accepted (false positives); ${T.amb} ambiguous cases not scored`);
console.log(`check time: median ${times[times.length >> 1].toFixed(2)} ms, p95 ${q95(times).toFixed(2)} ms`);
fs.writeFileSync(path.join(ROOT, 'content', 'curated', 'challenge', 'v2-results.json'), JSON.stringify(results));
