// The niche-answer test (tools/content/QUESTION-METHOD.md): obscure but correct answers, and plausible wrong ones,
// written by a tester who saw only each question's wording and rules (content/curated/challenge/niche-cases.json,
// private). Each is run through the game's own checker against the list as the game gets it, and against the
// hand-written list alone (before the reference sources were added), so the difference is measured.
//   node tests/answers/niche.cjs [--show]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..', '..'), F = path.join(ROOT, 'content', 'curated', 'challenge', process.argv.find(a => a.endsWith('.json')) || 'niche-cases.json');
if (!fs.existsSync(F)) { console.log('no niche cases here (private content)'); process.exit(0); }
global.window = {}; global.localStorage = { getItem: () => null, setItem: () => {} };
require('../../validate.js'); const V = window.IcebergValidate;
V.setRealWords(fs.readFileSync(path.join(ROOT, 'realwords.txt'), 'utf8'));
const words = JSON.parse(fs.readFileSync(path.join(ROOT, 'words.json'), 'utf8')); if (words.commonWords) V.setCommonWords(words.commonWords);
const load = noWiki => JSON.parse(execFileSync('python3', ['-c', `
import sys, json, glob, os; sys.path.insert(0, ${JSON.stringify(path.join(ROOT, 'tools', 'playtest'))}); import curated
out = {}
for p in sorted(glob.glob(${JSON.stringify(path.join(ROOT, 'content', 'curated'))} + '/batch-*.json')):
    for q in json.load(open(p))['questions']: out[q['id']] = curated.question(q, os.path.basename(p)[:-5])
print(json.dumps(out))`], { env: { ...process.env, ...(noWiki ? { CURATED_NO_WIKI: '1' } : {}) }, maxBuffer: 1 << 28 }).toString());
const kbFor = cat => { if (!cat.kb) return; const [f, part] = cat.kb.split(':'); const kb = JSON.parse(fs.readFileSync(path.join(ROOT, 'kb', f + '.json'), 'utf8')); V.mergeKb(cat, part ? kb[part] : kb); };
const cases = JSON.parse(fs.readFileSync(F, 'utf8')).cases, SHOW = process.argv.includes('--show');
const run = qs => { const rows = []; for (const c of cases) { const cat = qs[c.id]; if (!cat) continue; kbFor(cat); const P = V.prepare(cat);
  const ok = c.valid.map(t => V.judge(t, P, null).status), bad = c.invalid.map(t => V.judge(t, P, null).status);
  rows.push({ id: c.id, n: ok.length, rec: ok.filter(s => s === 'ok' || s === 'confirm' || s === 'ambiguous').length, inv: bad.length, acc: bad.filter(s => s === 'ok' || s === 'confirm').length,
    miss: c.valid.filter((t, i) => !['ok', 'confirm', 'ambiguous'].includes(ok[i])), wrong: c.invalid.filter((t, i) => ['ok', 'confirm'].includes(bad[i])) }); } return rows; };
const before = run(load(true)), after = run(load(false));
const pct = (a, b) => b ? Math.round(100 * a / b) + '%' : '-';
console.log('question'.padEnd(32), 'obscure valid recognised: before -> after', '  wrong accepted: before -> after');
let tb = 0, ta = 0, tn = 0, ib = 0, ia = 0, inn = 0, pass = 0;
after.forEach((r, i) => { const b = before[i]; tb += b.rec; ta += r.rec; tn += r.n; ib += b.acc; ia += r.acc; inn += r.inv; const ok = r.rec / r.n >= 0.9 && r.acc / r.inv <= 0.05 + 1e-9; if (ok) pass++;
  console.log(r.id.padEnd(32), `${pct(b.rec, b.n).padStart(5)} -> ${pct(r.rec, r.n).padStart(5)}`.padEnd(42), `${pct(b.acc, b.inv)} -> ${pct(r.acc, r.inv)}`, ok ? '' : '  below the bar');
  if (SHOW) { if (r.miss.length) console.log('   still missing:', r.miss.join(' | ')); if (r.wrong.length) console.log('   wrong accepted:', r.wrong.join(' | ')); } });
console.log(`\nALL ${after.length} questions, ${tn} obscure valid answers: recognised ${pct(tb, tn)} before -> ${pct(ta, tn)} after; ${inn} wrong answers accepted ${pct(ib, inn)} -> ${pct(ia, inn)}`);
console.log(`${pass} of ${after.length} questions meet the bar (90% of obscure answers recognised, at most 5% wrong accepted)`);
