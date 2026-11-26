// Independent challenge test for the curated question set. The cases (content/curated/challenge/cases-*.json, private)
// were written by testers who saw only each question's wording and rules, never its answer list, so they measure what
// the list is missing as well as what it gets wrong. Each case is run through the game's own checker.
//   node tests/answers/curated-challenge.cjs [--show]      (needs the private content/curated folder)
// Per question: valid answers recognised (counted, or one correction to confirm), left pending, rejected; invalid
// ones accepted; forbidden ones refused. Valid answers left pending are the list's gaps.
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..', '..'), DIR = path.join(ROOT, 'content', 'curated', 'challenge'), SHOW = process.argv.includes('--show');
if (!fs.existsSync(DIR)) { console.log('no curated challenge cases here (private content)'); process.exit(0); }
global.window = {}; global.localStorage = { getItem: () => null, setItem: () => {} };
require('../../validate.js');
const V = window.IcebergValidate;
V.setRealWords(fs.readFileSync(path.join(ROOT, 'realwords.txt'), 'utf8'));
try { V.setKnownNames(Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'kb', 'lexicon.json'), 'utf8')).names)); } catch { }   // as the game does once loaded
V.setCommonWords(JSON.parse(fs.readFileSync(path.join(ROOT, 'words.json'), 'utf8')).commonWords);
const qs = JSON.parse(execFileSync('python3', ['-c', `
import sys, json, glob, os; sys.path.insert(0, ${JSON.stringify(path.join(ROOT, 'tools', 'playtest'))}); import curated
out = {}
for p in sorted(glob.glob(${JSON.stringify(path.join(ROOT, 'content', 'curated'))} + '/batch-*.json')):
    for q in json.load(open(p))['questions']: out[q['id']] = curated.question(q, os.path.basename(p)[:-5])
print(json.dumps(out))`], { maxBuffer: 1 << 28 }).toString());
const products = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'kb', 'products.json'), 'utf8'));
const rows = [], gaps = {};
let T = { valid: 0, rec: 0, pend: 0, rej: 0, inv: 0, fa: 0, forb: 0, forbOk: 0, amb: 0, ambOk: 0 };
for (const f of fs.readdirSync(DIR).filter(f => /^cases-.*\.json$/.test(f))) {
  for (const spec of JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')).questions) {
    const q = qs[spec.id]; if (!q) { console.log('unknown question', spec.id); continue; }
    const cat = JSON.parse(JSON.stringify(q));
    if (cat.kb && cat.kb.startsWith('products:')) V.mergeKb(cat, products[cat.kb.split(':')[1]]);
    const P = V.prepare(cat), t = { valid: 0, rec: 0, pend: 0, rej: 0, inv: 0, fa: 0, forb: 0, forbOk: 0 };
    for (const c of spec.cases) {
      const j = V.judge(c.text, P, null), st = j.status === 'confirm' ? 'ask' : j.status;
      const forbidden = j.row && cat.mode && cat.mode.type === 'forbidden' && (cat.mode.forbid || []).includes(j.row.a);
      if (c.expect === 'valid') { t.valid++; if (st === 'ok' || st === 'ask') t.rec++; else if (st === 'pending') { t.pend++; (gaps[spec.id] = gaps[spec.id] || []).push(c.text); } else t.rej++;
        if (SHOW || st === 'invalid') if (st !== 'ok' && st !== 'ask') console.log(`  ${spec.id}: valid "${c.text}" -> ${st}${j.reason ? ' [' + j.reason + ']' : ''}`); }
      else if (c.expect === 'invalid') { t.inv++; if (st === 'ok' && !forbidden) { t.fa++; console.log(`  ${spec.id}: INVALID ACCEPTED "${c.text}" -> ${j.row && j.row.a}${c.note ? '  (' + c.note + ')' : ''}`); } else if (st === 'ask') { T.sugg = (T.sugg || 0) + 1; if (SHOW) console.log(`  ${spec.id}: invalid "${c.text}" offered "${j.row && j.row.a}" as a suggestion (nothing counted unless the player says yes)`); } }
      else if (c.expect === 'forbidden') { t.forb++; if (forbidden || st === 'invalid') t.forbOk++; else console.log(`  ${spec.id}: forbidden "${c.text}" not refused -> ${st} ${j.row ? j.row.a : ''}`); }
      else if (c.expect === 'ambiguous') { T.amb++; if (st !== 'ok' || !j.row) T.ambOk++; }
    }
    rows.push({ id: spec.id, n: cat.answers.length, ...t });
    for (const k of Object.keys(t)) T[k] += t[k];
  }
}
const pct = (a, b) => b ? (100 * a / b).toFixed(0) + '%' : '-';
console.log('\nquestion                         answers  valid recognised  pending  rejected   invalid accepted  forbidden refused');
for (const r of rows.sort((a, b) => a.rec / a.valid - b.rec / b.valid)) console.log(`${r.id.padEnd(32)} ${String(r.n).padStart(6)}  ${pct(r.rec, r.valid).padStart(16)}  ${pct(r.pend, r.valid).padStart(7)}  ${pct(r.rej, r.valid).padStart(8)}   ${pct(r.fa, r.inv).padStart(16)}  ${pct(r.forbOk, r.forb).padStart(17)}`);
console.log(`\nALL: ${T.valid} valid cases: ${pct(T.rec, T.valid)} recognised, ${pct(T.pend, T.valid)} pending (gaps), ${pct(T.rej, T.valid)} rejected outright; ${T.inv} invalid: ${pct(T.fa, T.inv)} accepted; forbidden refused ${pct(T.forbOk, T.forb)}; invalid answers that got a "Did you mean" suggestion (not counted): ${T.sugg || 0}`);
fs.writeFileSync(path.join(DIR, 'gaps.json'), JSON.stringify(gaps, null, 1));
console.log('the valid answers left pending (each question\'s gaps) are in content/curated/challenge/gaps.json');
