// Widened answer lists (tools/playtest/build.py + tools/content/kbmerge.py): "Name a kind of X" questions accept every X
// the datasets know, misspellings of them get "Did you mean", famous listed answers keep their estimates, and a
// dataset answer never starts Unfathomable. Judged with the game's own validator, no browser needed.
// Usage: node tests/answers/widen.cjs
const fs = require('fs'), vm = require('vm'), os = require('os'), path = require('path'), { execFileSync } = require('child_process');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('PASS  ' + name); } else { fail++; console.log('FAIL  ' + name + (extra ? '  [' + extra + ']' : '')); } };
const ROOT = path.join(__dirname, '..', '..'), out = fs.mkdtempSync(path.join(os.tmpdir(), 'widen-'));
execFileSync('python3', [path.join(ROOT, 'tools/playtest/build.py'), out]);
const ctx = { window: {}, console }; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'validate.js'), 'utf8'), ctx);
const V = ctx.window.IcebergValidate;
V.setCommonWords(JSON.parse(fs.readFileSync(path.join(ROOT, 'words.json'))).commonWords); V.setRealWords(fs.readFileSync(path.join(ROOT, 'realwords.txt'), 'utf8'));
const question = (day, key) => JSON.parse(fs.readFileSync(path.join(out, 'pt', day + '.json'))).questions.find(q => q.key === key);
const judge = (q, t) => V.judge(t, V.prepare(q), { rows: new Map(), texts: new Set() });

const cheese = question(2, 'cheese');
ok('the cheese question knows far more cheeses than its hand-made list', cheese.answers.length > 800, cheese.answers.length);
for (const t of ['Sbrinz', 'Castelmagno', 'Époisses', 'Stinking Bishop']) { const j = judge(cheese, t); ok(`"${t}" counts`, j && j.status === 'ok', j && j.status); }
const typo = judge(cheese, 'castelmango');
ok('"castelmango" is offered as Castelmagno, never silently changed', typo && typo.status === 'confirm' && /castelmagno/i.test(typo.row.a), typo && typo.status);
const brie = judge(cheese, 'brie');
ok('a famous listed cheese keeps its estimate (not marked as still being measured)', brie.status === 'ok' && !brie.row.pv && brie.row.s > 0.05, JSON.stringify(brie.row && { s: brie.row.s, pv: brie.row.pv }));
ok('nothing that is not a cheese is accepted', judge(cheese, 'banana').status !== 'ok');
const all = fs.readdirSync(path.join(out, 'pt')).filter(f => /^\d+\.json$/.test(f)).flatMap(f => JSON.parse(fs.readFileSync(path.join(out, 'pt', f))).questions);
const pv = all.flatMap(q => q.answers.filter(a => a.pv));
ok('dataset answers are marked "still being measured" and never start Unfathomable (rarer than 1 in 10,000 needs players)', pv.length > 1000 && pv.every(a => a.s >= 1e-5 && a.s <= 3e-3), `${pv.length} dataset answers; min share ${Math.min(...pv.map(a => a.s))}`);
const cov = JSON.parse(fs.readFileSync(path.join(out, 'pt', 'coverage.json')));
ok('coverage report lists each widened question', cov.length >= 6 && cov.every(c => c.after >= c.before), cov.length);
fs.rmSync(out, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
