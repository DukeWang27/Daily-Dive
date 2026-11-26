// Answer coverage: what players actually type, written independently of the answer lists (tests/answers/coverage/*.json),
// run through the game's own checker (validate.js) with the same reference lists the game loads.
// For each question it reports: valid answers accepted, asked about, left pending or rejected; invalid answers rejected
// or wrongly accepted; and the time each check takes. It fails if a valid answer is rejected outright, an invalid one
// is accepted, or a case's expectation isn't met.
//   node tests/answers/coverage.cjs [--show]
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..'), SHOW = process.argv.includes('--show');
global.window = {}; global.localStorage = { getItem: () => null, setItem: () => {} };
require('../../validate.js');
const V = window.IcebergValidate;
V.setRealWords(fs.readFileSync(path.join(ROOT, 'realwords.txt'), 'utf8'));
const words = JSON.parse(fs.readFileSync(path.join(ROOT, 'words.json'), 'utf8')); if (words.commonWords) V.setCommonWords(words.commonWords);
let fails = 0;
for (const f of fs.readdirSync(path.join(__dirname, 'coverage')).filter(f => f.endsWith('.json'))) {
  const spec = JSON.parse(fs.readFileSync(path.join(__dirname, 'coverage', f), 'utf8'));
  const day = JSON.parse(fs.readFileSync(path.join(ROOT, 'days', spec.question.day + '.json'), 'utf8'));
  const cat = JSON.parse(JSON.stringify(day.questions.find(q => q.key === spec.question.key)));
  if (spec.question.kb) V.mergeKb(cat, JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'kb', spec.question.kb + '.json'), 'utf8')));
  const t0 = process.hrtime.bigint(), P = V.prepare(cat), prepMs = Number(process.hrtime.bigint() - t0) / 1e6;
  const tally = {}, bad = [], times = [];
  const bump = (tier, k) => { tally[tier] = tally[tier] || { n: 0 }; tally[tier].n++; tally[tier][k] = (tally[tier][k] || 0) + 1; };
  for (const c of spec.cases) {
    const t = process.hrtime.bigint(); const j = V.judge(c.text, P, null); times.push(Number(process.hrtime.bigint() - t) / 1e6);
    const got = j.status === 'confirm' ? 'ask' : j.status, name = j.row ? j.row.a : '';
    const asOk = !c.as || (j.row && [j.row.a, ...(j.row.al || [])].map(V.normalize).includes(V.normalize(c.as)));
    let pass;
    if (c.expect === 'invalid_or_pending') pass = got !== 'ok' && got !== 'ask';
    else if (c.expect === 'ok') pass = got === 'ok' && asOk;
    else pass = got === c.expect && asOk;
    bump(c.tier, got);
    if (!pass) bad.push(`${c.tier.padEnd(12)} "${c.text}" -> ${got}${name ? ` (${name})` : ''}${j.reason ? ` [${j.reason}]` : ''}  want ${c.expect}${c.as ? ` as ${c.as}` : ''}`);
    else if (SHOW) console.log(`ok  ${c.tier.padEnd(12)} "${c.text}" -> ${got} ${name}`);
  }
  const valid = spec.cases.filter(c => c.expect !== 'invalid_or_pending'), inv = spec.cases.filter(c => c.expect === 'invalid_or_pending');
  const res = spec.cases.map(c => { const j = V.judge(c.text, P, null); return { c, s: j.status }; });
  const pct = (a, b) => b ? (100 * a / b).toFixed(1) + '%' : '-';
  const acc = res.filter(x => x.c.expect !== 'invalid_or_pending' && (x.s === 'ok' || x.s === 'confirm' || x.s === 'ambiguous')).length;
  const rej = res.filter(x => x.c.expect !== 'invalid_or_pending' && x.s === 'invalid').length, pend = res.filter(x => x.c.expect !== 'invalid_or_pending' && x.s === 'pending').length;
  const fa = res.filter(x => x.c.expect === 'invalid_or_pending' && (x.s === 'ok' || x.s === 'confirm')).length;
  const al = res.filter(x => ['abbreviation', 'mapping', 'field'].includes(x.c.tier) && x.s === 'ok').length, alN = res.filter(x => ['abbreviation', 'mapping', 'field'].includes(x.c.tier)).length;
  times.sort((a, b) => a - b);
  console.log(`\n${f}: ${cat.answers.length} answers, ${spec.cases.length} cases (prepare ${prepMs.toFixed(0)} ms)`);
  console.log(`  valid recognised (counted, asked or clarified): ${pct(acc, valid.length)}   false rejection: ${pct(rej, valid.length)}   left pending: ${pct(pend, valid.length)}`);
  console.log(`  other names and fields counted: ${pct(al, alN)}   invalid rejected: ${pct(inv.length - fa, inv.length)}   false acceptance: ${pct(fa, inv.length)}`);
  console.log(`  check time: median ${times[times.length >> 1].toFixed(2)} ms, worst ${times[times.length - 1].toFixed(1)} ms`);
  for (const [k, v] of Object.entries(tally)) console.log(`  ${k.padEnd(12)} ${JSON.stringify(v)}`);
  if (bad.length) { console.log(`  ${bad.length} not as expected:`); bad.forEach(b => console.log('   ' + b)); }
  fails += bad.length;
}
console.log(`\n${fails ? fails + ' cases not as expected' : 'all cases as expected'}`); process.exit(fails ? 1 : 0);
