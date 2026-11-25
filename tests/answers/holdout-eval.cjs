// Holdout benchmark for the answer checker. The cases in holdout.json were written separately from the tuning set
// (labeled.json) and are never used to tune anything. Usage:
//   node tests/answers/holdout-eval.cjs [--engine=path/to/validate.js] [--ai=mock|anthropic|openai|gemini|deepseek] [--json=out.json] [--show]
// Without --ai it measures the deterministic checker alone. With --ai, every answer the checker leaves pending goes
// through api/_lib (the same code the server runs, minus the database), and real providers need their API key set.
const fs = require('fs'), path = require('path');
const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const ENGINE = path.resolve(arg('engine', path.join(__dirname, '../../validate.js'))), AI = arg('ai', ''), SHOW = process.argv.includes('--show');
global.window = {}; global.localStorage = { getItem: () => null, setItem: () => {} };
require(ENGINE); const V = window.IcebergValidate;
if (window.IcebergValidate.setRealWords) { try { window.IcebergValidate.setRealWords(require('fs').readFileSync(require('path').join(__dirname, '../../realwords.txt'), 'utf8')); } catch {} }

const words = JSON.parse(fs.readFileSync(path.join(__dirname, '../../words.json'), 'utf8')); if (words.commonWords && V.setCommonWords) V.setCommonWords(words.commonWords);
const cases = JSON.parse(fs.readFileSync(path.join(__dirname, 'holdout.json'), 'utf8'));
const cats = {}, prep = {};
const cat = c => { const k = c.day + c.q; if (!cats[k]) { cats[k] = JSON.parse(fs.readFileSync(path.join(arg('days', path.join(__dirname, '../../days')), c.day + '.json'), 'utf8')).questions.find(q => q.key === c.q); prep[k] = V.prepare(cats[k]); } return [cats[k], prep[k]]; };

(async () => {
  const ai = AI ? await import(path.join(__dirname, '../../api/_lib/check.mjs')) : null;
  const rows = [];
  for (const c of cases) {
    const [q, P] = cat(c), t0 = process.hrtime.bigint(), j = V.judge(c.text, P, null), ms = Number(process.hrtime.bigint() - t0) / 1e6;
    let out = !j ? 'invalid' : j.status === 'ok' ? 'ok' : j.status === 'confirm' ? 'confirm' : j.status === 'invalid' ? 'invalid' : 'pending';
    let row = j && j.row ? j.row.a : null, aiRes = null;
    if (ai && out === 'pending') {
      const cands = V.correct ? (P.keys || []).map(k => k.row.a).filter((a, i, s) => s.indexOf(a) === i) : [];
      aiRes = await ai.checkAnswer({ provider: AI, question: { key: q.key, prompt: q.prompt, rules: q.rules || [] }, answer: c.text, candidates: ai.nearest(c.text, cands, 5) });
      if (aiRes.status === 'ok') { out = aiRes.relationship === 'spelling' ? 'confirm' : 'ok'; row = aiRes.listed || null; }
      else if (aiRes.status === 'invalid') out = 'invalid';
    }
    rows.push({ ...c, out, row, ms, aiMs: aiRes && aiRes.ms, cost: aiRes && aiRes.cost, inTok: aiRes && aiRes.inTokens, outTok: aiRes && aiRes.outTokens, relationship: aiRes && aiRes.relationship });
  }
  const valid = rows.filter(r => r.expect === 'ok'), invalid = rows.filter(r => r.expect === 'invalid'), typos = rows.filter(r => r.expect === 'confirm');
  const pct = (a, b) => b ? +(100 * a / b).toFixed(1) : 0;
  // An answer missing from the list that ends up "accepted" as some other listed answer is a wrong merge, not a success.
  const rightRow = r => r.answer ? r.row === r.answer : !r.row;
  const m = {
    engine: path.relative(path.join(__dirname, '../..'), ENGINE), ai: AI || 'none', cases: rows.length,
    validAcceptedAtOnce: pct(valid.filter(r => r.out === 'ok' && rightRow(r)).length, valid.length),
    validAcceptedIncludingConfirm: pct(valid.filter(r => (r.out === 'ok' || r.out === 'confirm') && rightRow(r)).length, valid.length),
    validLeftPending: pct(valid.filter(r => r.out === 'pending').length, valid.length),
    falseRejection: pct(valid.filter(r => r.out === 'invalid').length, valid.length),
    invalidRejected: pct(invalid.filter(r => r.out === 'invalid').length, invalid.length),
    falseAcceptance: pct(invalid.filter(r => r.out === 'ok' || r.out === 'confirm').length, invalid.length),
    aliasRecognised: pct(rows.filter(r => ['alias', 'scientific', 'regional'].includes(r.kind) && r.out === 'ok' && rightRow(r)).length, rows.filter(r => ['alias', 'scientific', 'regional'].includes(r.kind)).length),
    wrongEntity: pct(rows.filter(r => r.expect === 'ok' && (r.out === 'ok' || r.out === 'confirm') && r.row && r.row !== r.answer).length, rows.filter(r => r.expect === 'ok').length),
    typoOfferedRightAnswer: pct(typos.filter(r => r.out === 'confirm' && rightRow(r)).length, typos.length),
    typoSilentlyChanged: pct(typos.filter(r => r.out === 'ok').length, typos.length),
    correctSpellingChanged: pct(rows.filter(r => ['common', 'obscure'].includes(r.kind) && r.out === 'confirm').length, rows.filter(r => ['common', 'obscure'].includes(r.kind)).length),
    missingValidAccepted: pct(rows.filter(r => r.kind === 'missing-valid' && r.out === 'ok').length, rows.filter(r => r.kind === 'missing-valid').length),
    shortCorrected: rows.filter(r => r.kind.startsWith('short') && r.out === 'confirm').map(r => r.text),
    latencyMs: (a => ({ p50: +a[Math.floor(a.length / 2)].toFixed(3), p95: +a[Math.floor(a.length * 0.95)].toFixed(3), max: +a[a.length - 1].toFixed(3) }))(rows.map(r => r.ms).sort((a, b) => a - b)),
  };
  const calls = rows.filter(r => r.aiMs != null);
  if (calls.length) {
    const s = calls.map(r => r.aiMs).sort((a, b) => a - b);
    Object.assign(m, { aiCalls: calls.length, aiMsMean: Math.round(s.reduce((a, b) => a + b, 0) / s.length), aiMsP50: s[Math.floor(s.length / 2)], aiMsP95: s[Math.floor(s.length * 0.95)],
      aiInTokensMean: Math.round(calls.reduce((a, r) => a + (r.inTok || 0), 0) / calls.length), aiOutTokensMean: Math.round(calls.reduce((a, r) => a + (r.outTok || 0), 0) / calls.length),
      aiCostPerCallUsd: +(calls.reduce((a, r) => a + (r.cost || 0), 0) / calls.length).toFixed(7) });
  }
  console.log(JSON.stringify(m, null, 1));
  if (SHOW) rows.filter(r => !(r.out === r.expect || (r.expect === 'ok' && r.out === 'ok' && rightRow(r)))).forEach(r => console.log(`  ${r.kind.padEnd(16)} ${r.q.padEnd(10)} ${JSON.stringify(r.text).padEnd(28)} expect ${r.expect} ${r.answer || ''} -> ${r.out} ${r.row || ''}`));
  const out = arg('json', ''); if (out) fs.writeFileSync(out, JSON.stringify({ metrics: m, rows }, null, 1));
})();
