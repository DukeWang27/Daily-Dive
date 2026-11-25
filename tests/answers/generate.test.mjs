// The generator's flow with a stand-in model (no key, no network): stages merge, other names attach to the right answer,
// the independent check removes what it flags, and the result passes tools/content/check.py.
import fs from "node:fs"; import path from "node:path"; import { execFileSync } from "node:child_process";
import { answers } from "../../tools/content/generate.mjs";
const R = []; let fails = 0; const ok = (n, c, x = "") => { R.push(`${c ? "PASS" : "FAIL"}  ${n}${x ? "  [" + x + "]" : ""}`); if (!c) fails++; };
const id = "zz-test-generated", file = path.join("content", "questions", id + ".json");
fs.writeFileSync(file, JSON.stringify({ id, prompt: "Name something you'd find in a lighthouse", hint: "Anything really found in or on one.", title: "Lighthouse", icon: "building",
  category: "everyday", style: "scene", topic: "lighthouse", difficulty: 2, rules: { player: ["Objects and fixtures only."], accept: ["objects", "fixtures"], exclude: ["people"], granularity: "Distinct objects count separately.", synonyms: "Regional names are one answer.", ambiguous: [] },
  general: ["thing"], notIn: ["keeper"], subcategories: ["optics", "machinery"], answers: [] }));
let n = 0; const calls = [];
const pool = Array.from({ length: 60 }, (_, i) => ({ a: "item" + i, al: [], p: i < 10 ? 0.2 - i * 0.015 : 0.0005, tier: i < 10 ? "common" : "obscure" }));
const client = { beta: { messages: { stream: params => { calls.push(params); const stage = n++; return { finalMessage: async () => {
  const user = params.messages[0].content;
  let body;
  if (/fact-checker/.test(params.system[0].text)) body = { drop: [{ a: "item59", reason: "not real" }], fix: [{ a: "item0", p: 0.35 }] };
  else if (/Stage "aliases"/.test(user)) body = { answers: [{ a: "item1", al: ["item one", "item0"], p: 0.1, tier: "common" }] };
  else body = { answers: pool.slice(stage * 8, stage * 8 + 8).concat(stage === 1 ? [{ a: "Item0", al: [], p: 0.1, tier: "common" }] : []) };
  return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(body) }], usage: {} }; } }; } } } };
const res = await answers(client, id);
const q = JSON.parse(fs.readFileSync(file, "utf8"));
ok("nine stages: eight building requests and a separate checking request", calls.length === 9, String(calls.length));
ok("every request carries the brief as a cached system prompt, with fallbacks on", calls.every(c => c.system[0].cache_control && c.fallbacks === "default"));
ok("a repeated answer in a later stage is merged, not duplicated", q.answers.filter(a => a.a.toLowerCase() === "item0").length === 1);
ok("other names attach to their answer; a name that is already an answer isn't taken as an alias", (q.answers.find(a => a.a === "item1").al || []).includes("item one") && !(q.answers.find(a => a.a === "item1").al || []).includes("item0"));
ok("the independent check removes what it flags and corrects estimates", !q.answers.some(a => a.a === "item59") && q.answers.find(a => a.a === "item0").p === 0.35 && res.dropped === 1);
ok("the generation record lists all nine stages", q.generation.stages.length === 9 && q.generation.stages.at(-1) === "verify");
let check = ""; try { check = execFileSync("python3", ["tools/content/check.py", file], { encoding: "utf8" }); } catch (e) { check = e.stdout; }
ok("the file passes the format check", /0 problems/.test(check), check.trim().split("\n").slice(-2).join(" / "));
fs.unlinkSync(file);
console.log(R.join("\n")); console.log(`\n${R.length - fails} passed, ${fails} failed`); process.exit(fails ? 1 : 0);
