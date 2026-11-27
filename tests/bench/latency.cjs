// Latency of each answer-check layer, measured, not estimated: median and 95th percentile.
//   1. local matching in the browser's checker (validate.js) on real question lists, small to very large;
//   2. alias / exact hits only; 3. fuzzy (slips) only;
//   4. database: the server's answer lookup and claim check (local PostgreSQL, tests/db/setup.sh);
//   5. the verified-answer cache lookup (same database);
//   6. structured lookups over the network: Wikidata (SPARQL) and Wikipedia page text, as an evidence step would.
// AI verification can't be measured here without an API key; its timing is reported separately when one is set.
//   node tests/bench/latency.cjs
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..', '..');
global.window = {}; global.localStorage = { getItem: () => null, setItem: () => {} };
require('../../validate.js'); const V = window.IcebergValidate;
V.setRealWords(fs.readFileSync(path.join(ROOT, 'realwords.txt'), 'utf8'));
const w = JSON.parse(fs.readFileSync(path.join(ROOT, 'words.json'), 'utf8')); if (w.commonWords) V.setCommonWords(w.commonWords);
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const fmt = a => `median ${pct(a, .5).toFixed(2)} ms, p95 ${pct(a, .95).toFixed(2)} ms (n=${a.length})`;
const now = () => Number(process.hrtime.bigint()) / 1e6;
const out = {};
const qs = JSON.parse(execFileSync('python3', ['-c', `
import sys, json, glob, os; sys.path.insert(0, ${JSON.stringify(path.join(ROOT, 'tools', 'playtest'))}); import curated
out = {}
for p in sorted(glob.glob(${JSON.stringify(path.join(ROOT, 'content', 'curated'))} + '/batch-*.json')):
    for q in json.load(open(p))['questions']: out[q['id']] = curated.question(q, os.path.basename(p)[:-5])
print(json.dumps(out))`], { maxBuffer: 1 << 28 }).toString());
const cases = []; for (const f of ['niche-cases.json', 'niche-cases-new.json']) { const p = path.join(ROOT, 'content', 'curated', 'challenge', f); if (fs.existsSync(p)) cases.push(...JSON.parse(fs.readFileSync(p, 'utf8')).cases); }
const all = [], exact = [], fuzzy = [], big = [];
for (const c of cases) { const cat = qs[c.id]; if (!cat) continue; const P = V.prepare(cat); V.judge('warmup', P, null);
  for (const t of [...c.valid, ...c.invalid]) {
    const t0 = now(); const j = V.judge(t, P, null); const ms = now() - t0; all.push(ms);
    if (cat.answers.length > 1500) big.push(ms);
    if (j.via === 'exact' || j.via === 'alias' || j.via === 'form') exact.push(ms); else if (j.via === 'typo' || j.status === 'confirm') fuzzy.push(ms);
  }
  // slips: one letter changed in a valid answer
  for (const t of c.valid.slice(0, 10)) { const s = t.length > 4 ? t.slice(0, 2) + t[3] + t[2] + t.slice(4) : t; const t0 = now(); V.judge(s, P, null); fuzzy.push(now() - t0); }
}
out.local_all = fmt(all); out.local_exact_alias = fmt(exact); out.local_fuzzy = fmt(fuzzy); out.local_lists_over_1500 = fmt(big);
console.log('local matching (validate.js), every test answer:   ', out.local_all);
console.log('  exact / alias hits:                                ', out.local_exact_alias);
console.log('  slips (fuzzy, context-aware):                      ', out.local_fuzzy);
console.log('  on lists over 1,500 answers:                       ', out.local_lists_over_1500);
(async () => {
  try {
    const { Client } = require('../node_modules/pg'); const db = new Client({ host: '/var/run/postgresql', user: 'postgres', database: process.env.ICEBERG_TEST_DB || 'icetest' }); await db.connect();
    const [{ set_id: sid } = {}] = (await db.query(`select set_id, count(*) n from public.set_answers group by set_id order by n desc limit 1`)).rows;
    const rows = (await db.query(`select round, answer from public.set_answers where set_id = $1 limit 400`, [sid])).rows;
    const look = [], claim = [], cache = [];
    for (const r of rows) { let t0 = now(); await db.query(`select share, depth from public.set_answers where set_id = $1 and round = $2 and answer = $3`, [sid, r.round, r.answer]); look.push(now() - t0);
      t0 = now(); await db.query(`select private.claim_ok($1, $2, $3, $3)`, [sid, r.round, r.answer]); claim.push(now() - t0);
      t0 = now(); await db.query(`select status, canonical from public.verified_answers where category = $1 and answer_key = $2`, ['k' + r.round, r.answer.toLowerCase()]); cache.push(now() - t0); }
    out.db_lookup = fmt(look); out.db_claim = fmt(claim); out.cache = fmt(cache);
    console.log('database answer lookup (local PostgreSQL):          ', out.db_lookup);
    console.log('database claim check (typed vs counted-as):         ', out.db_claim);
    console.log('verified-answer cache lookup:                       ', out.cache);
    await db.end();
  } catch (e) { console.log('database: skipped (' + e.message + ')'); }
  const UA = { 'User-Agent': 'content-research-bot/1.0 (+https://www.mediawiki.org/wiki/API:Etiquette)', 'Api-User-Agent': 'content-research-bot/1.0' };
  const wd = [], wp = [];
  const items = ['Lil Mosey', 'Blueberry Faygo', 'Klefki', 'Disco Stu', 'Navy Grog', 'Rolex Submariner', 'Quantitative analysis (finance)', 'Postel\'s law', 'Shadowgate 64', 'Bovonto', 'Hayward Field', 'Kite Man'];
  for (const t of items) {
    let t0 = now(); try { await fetch('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(`SELECT ?i ?d WHERE { ?a schema:about ?i; schema:isPartOf <https://en.wikipedia.org/>; schema:name "${t.replace(/"/g, '')}"@en . OPTIONAL { ?i schema:description ?d FILTER(LANG(?d)='en') } }`), { headers: { ...UA, Accept: 'application/sparql-results+json' } }).then(r => r.text()); wd.push(now() - t0); } catch { }
    t0 = now(); try { await fetch('https://en.wikipedia.org/wiki/' + encodeURIComponent(t.replace(/ /g, '_')) + '?action=raw', { headers: UA }).then(r => r.text()); wp.push(now() - t0); } catch { }
  }
  if (wd.length) { out.wikidata = fmt(wd); console.log('structured lookup: Wikidata entity + description:    ', out.wikidata); }
  if (wp.length) { out.wikipedia = fmt(wp); console.log('evidence lookup: Wikipedia page text:               ', out.wikipedia); }
  fs.mkdirSync(path.join(ROOT, 'content', 'research'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'content', 'research', 'latency.json'), JSON.stringify({ measured: new Date().toISOString(), note: 'this machine (cloud container); network figures include the egress proxy', ...out }, null, 1));
})();
