// Regression tests: other names for the same answer score as that answer, spelling corrections are always asked first,
// and a second name for something already found is a duplicate. Usage: node tests/answers/synonyms.cjs
const fs = require('fs'), path = require('path'), ROOT = path.join(__dirname, '..', '..');
global.window = {}; global.localStorage = { getItem: () => null, setItem: () => {} };
require('../../validate.js'); const V = window.IcebergValidate;
if (window.IcebergValidate.setRealWords) { try { window.IcebergValidate.setRealWords(require('fs').readFileSync(require('path').join(__dirname, '../../realwords.txt'), 'utf8')); } catch {} }

const q = (day, key) => V.prepare(JSON.parse(fs.readFileSync(path.join(ROOT, 'days', day + '.json'), 'utf8')).questions.find(x => x.key === key));
let pass = 0, fail = 0;
const t = (name, cond, got) => { if (cond) pass++; else { fail++; console.log('FAIL  ' + name + '  [' + JSON.stringify(got) + ']'); } };
const dogs = q(2, 'dogbreeds'), birds = q(1, 'birds'), colours = q(2, 'colours');
const is = (P, text, status, answer, given) => { const j = V.judge(text, P, given || null); t(`${text} -> ${status} ${answer || ''}`, j && j.status === status && (!answer || (j.row && j.row.a === answer)), j && [j.status, j.row && j.row.a, j.via]); return j; };
// Synonyms: accepted at once, as the same answer.
for (const s of ['Xoloitzcuintli', 'xolo', 'Mexican Hairless', 'Mexican Hairless Dog', 'mexican hairless dogs']) is(dogs, s, 'ok', 'xoloitzcuintli');
is(dogs, 'golden retriever dog', 'ok', 'golden retriever');
is(dogs, 'Dalmatian breed', 'ok', 'dalmatian');
is(birds, 'blue jay bird', 'ok', 'blue jay');
is(colours, 'gray', 'ok', 'grey');
// A category word never makes an unrelated word an answer.
t('"sheep dog" is not counted as sheep', (V.judge('sheep dog', dogs, null) || {}).status !== 'ok' || V.judge('sheep dog', dogs, null).row.a !== 'sheep');
// Spelling mistakes: offered, never swapped in.
// A clear slip of a listed answer is either corrected on the spot (shown to the player as corrected) or asked about;
// never accepted as a different answer, never rejected.
for (const [P, s, a] of [[colours, 'Burgandy', 'burgundy'], [colours, 'Burgudny', 'burgundy'], [colours, 'Burgndy', 'burgundy'], [birds, 'Ravne', 'raven'], [birds, 'Ravn', 'raven'], [birds, 'Rafe', 'raven'], [birds, 'Hummingbrid', 'hummingbird']]) {
  const j = V.judge(s, P, null);
  t(`${s} -> ${a} (corrected or asked)`, j && j.row && j.row.a === a && (j.status === 'confirm' || (j.status === 'ok' && j.via === 'typo')), j && [j.status, j.row && j.row.a, j.via]);
}
// Case and punctuation are not corrections.
is(colours, '  BURGUNDY! ', 'ok', 'burgundy');
// The same answer under another name is a duplicate, not a new discovery.
const xolo = dogs.cat.answers.find(r => r.a === 'xoloitzcuintli');
is(dogs, 'Mexican Hairless Dog', 'dup', 'xoloitzcuintli', { rows: new Map([['xoloitzcuintli', { name: 'xoloitzcuintli', typed: 'xolo' }]]), texts: new Set() });
// Names of one answer share its depth: they all point at the same row, so the same share.
t('every name of Xoloitzcuintli has one rarity', ['xolo', 'Mexican Hairless Dog'].every(s => V.judge(s, dogs, null).row === xolo));
console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
