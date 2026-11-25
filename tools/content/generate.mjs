// Unattended question generation with the Claude API (needs ANTHROPIC_API_KEY or an `ant auth login` profile).
// Runs offline, ahead of time: nothing here is called while anyone is playing.
//
//   node tools/content/generate.mjs ideas --category food --count 10     new question specs (rules, no answers yet)
//   node tools/content/generate.mjs answers <id> [<id>...]              the nine-stage answer build for drafted specs
//   node tools/content/generate.mjs refill [--days 60]                  keep at least N future days in reserve: ideas for the
//                                                                       thinnest categories, answers, then build.py all
// Then review with tools/content/cms.py. Nothing reaches players until build.py schedules it and a migration loads it.
// Format and rules: tools/content/SPEC.md and BRIEF.md (the same brief the first 90 days were written to).
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.join(HERE, "..", "..");
const QDIR = path.join(ROOT, "content", "questions");
const MODEL = process.env.CONTENT_MODEL || "claude-opus-5-5";
const BRIEF = fs.readFileSync(path.join(HERE, "BRIEF.md"), "utf8"), SPEC = fs.readFileSync(path.join(HERE, "SPEC.md"), "utf8");
const CATEGORIES = "general geography history science nature language entertainment music food technology sports everyday creative logic mythology literature maths people popculture arts".split(" ");

const Answer = z.object({ a: z.string(), al: z.array(z.string()), p: z.number(), tier: z.enum(["common", "uncommon", "obscure"]) });
const Answers = z.object({ answers: z.array(Answer) });
const Spec = z.object({
  id: z.string(), prompt: z.string(), hint: z.string(), title: z.string(), icon: z.string(), category: z.string(), style: z.string(), topic: z.string(),
  difficulty: z.number(), rules: z.object({ player: z.array(z.string()), accept: z.array(z.string()), exclude: z.array(z.string()), granularity: z.string(), synonyms: z.string(), ambiguous: z.array(z.string()) }),
  general: z.array(z.string()), notIn: z.array(z.string()), subcategories: z.array(z.string()),
});
const Ideas = z.object({ questions: z.array(Spec) });
const Verdicts = z.object({ drop: z.array(z.object({ a: z.string(), reason: z.string() })), fix: z.array(z.object({ a: z.string(), p: z.number() })) });

const norm = s => String(s).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/&/g, " and ").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

// One structured request. Streams (long answer lists), falls back server-side if the model declines, and checks why it stopped.
export async function ask(client, schema, system, user, { effort = "high", maxTokens = 64000 } = {}) {
  const stream = client.beta.messages.stream({
    model: MODEL, max_tokens: maxTokens, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
    output_config: { effort, format: zodOutputFormat(schema) },
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],      // the brief is the same every call: cached
    messages: [{ role: "user", content: user }],
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === "refusal") throw new Error("declined");
  if (msg.stop_reason === "max_tokens") throw new Error("ran out of room");
  const text = msg.content.filter(b => b.type === "text").map(b => b.text).join("");
  return { data: schema.parse(JSON.parse(text)), usage: msg.usage };
}

const SYSTEM = `${BRIEF}\n\n---\n${SPEC}\n\nReturn only the JSON asked for.`;
const existingPrompts = () => [
  ...fs.readFileSync(path.join(ROOT, "content", "existing_prompts.txt"), "utf8").split("\n").filter(Boolean),
  ...fs.readdirSync(QDIR).filter(f => f.endsWith(".json")).map(f => JSON.parse(fs.readFileSync(path.join(QDIR, f), "utf8")).prompt),
];

export async function ideas(client, category, count = 10) {
  const avoid = existingPrompts();
  const { data } = await ask(client, Ideas, SYSTEM, `Write ${count} new question specs in the category "${category}" (varied styles and difficulty, at most a third plain "Name a ..."). ` +
    `For each, list the subcategories a complete answer list must cover. Do not write answers yet. Avoid these existing prompts and near-copies of them:\n${JSON.stringify(avoid)}`, { effort: "high" });
  const out = [];
  for (const q of data.questions) {
    if (avoid.some(p => norm(p) === norm(q.prompt))) continue;
    let id = norm(q.id).replace(/ /g, "-") || norm(q.title).replace(/ /g, "-");
    while (fs.existsSync(path.join(QDIR, id + ".json"))) id += "-2";
    const spec = { ...q, id, answers: [], kb: null, status: "draft" };
    fs.writeFileSync(path.join(QDIR, id + ".json"), JSON.stringify(spec, null, 1)); out.push(id);
  }
  return out;
}

// The nine stages, each its own request so each gets the model's full attention; merged as they arrive.
const STAGES = [
  ["common", "the answers most players give first (20-40)"],
  ["uncommon", "moderately uncommon answers a knowledgeable player gives (40-100)"],
  ["obscure", "obscure but real answers specialists know (40-150)"],
  ["subcategories", "walk EVERY subcategory listed and add what is missing from each"],
  ["regional", "regional and cultural variants from around the world (Africa, Asia, Latin America, Europe, Oceania...)"],
  ["historical", "historical, traditional and specialist answers"],
  ["aliases", "alternative names, scientific names and regional names for answers ALREADY listed (return those answers with their al filled)"],
  ["gaps", "anything a specialist would say that is still missing"],
];
export async function answers(client, id) {
  const file = path.join(QDIR, id + ".json"), q = JSON.parse(fs.readFileSync(file, "utf8"));
  const byKey = new Map((q.answers || []).map(a => [norm(a.a), a])), alias = new Map();
  const add = list => { for (const a of list) {
    const k = norm(a.a); if (!k) continue;
    const owner = byKey.get(k) || alias.get(k);
    if (owner) { for (const n of a.al || []) if (!byKey.has(norm(n)) && !alias.has(norm(n))) { (owner.al ||= []).push(n); alias.set(norm(n), owner); } continue; }
    const row = { a: a.a, al: (a.al || []).filter(n => !byKey.has(norm(n)) && !alias.has(norm(n))), p: a.p, tier: a.tier, src: "ai" };
    byKey.set(k, row); row.al.forEach(n => alias.set(norm(n), row));
  } };
  const spec = JSON.stringify({ prompt: q.prompt, rules: q.rules, subcategories: q.subcategories || [], general: q.general, notIn: q.notIn });
  for (const [stage, what] of STAGES) {
    const have = [...byKey.values()].map(r => r.a);
    const { data } = await ask(client, Answers, SYSTEM, `Question spec: ${spec}\nAlready listed (${have.length}): ${JSON.stringify(have)}\n\nStage "${stage}": add ${what}. ` +
      `Only real things that satisfy the rules; when unsure an item is real, leave it out. Estimate p for each as the SPEC says.`, { effort: stage === "common" ? "medium" : "high" });
    add(data.answers);
  }
  // Stage 9, independent check: a fresh request that sees only the rules and the list, in chunks, and removes what fails.
  const rows = [...byKey.values()], dropped = [];
  for (let i = 0; i < rows.length; i += 150) {
    const chunk = rows.slice(i, i + 150).map(r => ({ a: r.a, p: r.p }));
    const { data } = await ask(client, Verdicts, "You are a strict fact-checker for a quiz game. You judge answer lists against a question's rules. Flag anything that does not exist, does not satisfy the rules, is too general, or duplicates another entry under a different name. Also correct share estimates that are clearly unrealistic.",
      `Rules: ${JSON.stringify(q.rules)}\nPrompt: ${q.prompt}\nAnswers: ${JSON.stringify(chunk)}\nReturn "drop" (with a reason) and "fix" (new p).`, { effort: "high", maxTokens: 16000 });
    for (const d of data.drop) { const k = norm(d.a); if (byKey.has(k)) { dropped.push(d); byKey.delete(k); } }
    for (const f of data.fix) { const r = byKey.get(norm(f.a)); if (r && f.p > 0 && f.p < 0.9) r.p = f.p; }
  }
  q.answers = [...byKey.values()].sort((a, b) => b.p - a.p);
  q.generation = { by: MODEL, stages: [...STAGES.map(s => s[0]), "verify"], date: new Date().toISOString().slice(0, 10), dropped: dropped.length };
  delete q.status; delete q.subcategories;
  fs.writeFileSync(file, JSON.stringify(q, null, 1));
  return { id, answers: q.answers.length, dropped: dropped.length };
}

export async function refill(client, wantDays = 60) {
  const build = (...a) => execFileSync("python3", [path.join(HERE, "build.py"), ...a], { encoding: "utf8" });
  build("report");
  const rep = JSON.parse(fs.readFileSync(path.join(ROOT, "content", "report", "quality.json"), "utf8")).questions;
  const sched = fs.existsSync(path.join(ROOT, "content", "schedule.json")) ? JSON.parse(fs.readFileSync(path.join(ROOT, "content", "schedule.json"), "utf8")).days : {};
  const today = Math.floor((Date.now() - Date.UTC(2026, 10, 24)) / 86400000) + 1;
  const used = new Set(Object.values(sched).flat()), future = Object.keys(sched).filter(d => +d > today).length;
  const spare = Object.entries(rep).filter(([i, r]) => r.status === "ready" && !used.has(i)).length;
  const reserveDays = future + Math.floor(spare / 5);
  console.log(`reserve: ${future} scheduled future days + ${spare} spare ready questions = about ${reserveDays} days`);
  if (reserveDays >= wantDays) return console.log("enough in reserve; nothing generated");
  const need = Math.ceil((wantDays - reserveDays) * 5 * 1.3);            // ~30% are expected to fail quality or duplicate checks
  const counts = Object.fromEntries(CATEGORIES.map(c => [c, Object.values(rep).filter(r => r.category === c && r.status === "ready").length]));
  const thinnest = CATEGORIES.slice().sort((a, b) => counts[a] - counts[b]);
  let made = 0;
  for (const cat of thinnest) {
    if (made >= need) break;
    const ids = await ideas(client, cat, 8);
    for (const id of ids) { try { console.log(await answers(client, id)); made++; } catch (e) { console.log(id, "failed:", e.message); } }
  }
  console.log(build("all"));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2), opt = k => { const i = rest.indexOf("--" + k); return i >= 0 ? rest[i + 1] : null; };
  const client = new Anthropic();
  try {
    if (cmd === "ideas") console.log(await ideas(client, opt("category") || "general", +(opt("count") || 10)));
    else if (cmd === "answers") for (const id of rest) console.log(await answers(client, id));
    else if (cmd === "refill") await refill(client, +(opt("days") || 60));
    else console.log("usage: ideas --category <c> --count <n> | answers <id>... | refill [--days n]");
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) console.error("No API credentials: set ANTHROPIC_API_KEY (or run `ant auth login`).");
    else if (e instanceof Anthropic.RateLimitError) console.error("Rate limited: try again later.");
    else throw e;
    process.exitCode = 1;
  }
}
