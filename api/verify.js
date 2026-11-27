// Answer review endpoint (a Vercel serverless function). Layer 6 of the answer check: the game calls it only for an
// answer its own lists, aliases and spelling rules could not settle, and only when this endpoint is switched on.
//
//   POST { question: { key, prompt, rules: [string] }, answer: string, candidates: [string], player: string }
//   ->   { status: "ok" | "invalid" | "pending", relationship: "alias" | "spelling" | "new" | null, canonical, cached }
//
// Order of work, cheapest first:
//   1. reject junk without any call (too long, empty, instructions, lists);
//   2. the permanent cache (verified_answers): the same answer to the same question under the same rules is never
//      paid for twice, whoever typed it;
//   3. identical requests already in flight share one call;
//   4. a budget reservation in the database (monthly cap, daily, per-player and per-question limits; atomic);
//   5. one small model call (api/_lib/check.mjs), settled against the budget with its real token counts;
//   6. the verdict is stored for good. A new answer the model accepts is stored as review_status "pending" so a person
//      can confirm it; until then it scores the game's fixed provisional depth (never a rarity the model chose).
// With the budget spent, the key missing, or the provider down, the answer simply stays pending: the game goes on.
//
// Server environment variables (never in the game's files, GitHub or any artifact):
//   AI_PROVIDER                anthropic | openai | gemini | deepseek | mock   (unset = endpoint answers "pending")
//   AI_MODEL                   optional; defaults per provider (claude-haiku-5-5, gpt-6-luna, ...)
//   ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY / DEEPSEEK_API_KEY   the one for the chosen provider
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   for the cache and the budget (required in production)
//   AI_ALERT_WEBHOOK           optional; receives { level, spent_usd, budget_usd } at 50, 80 and 100% of the budget
//   ALLOWED_ORIGIN             optional; the game's address, for the browser's cross-origin check
import { createHash } from "node:crypto";
import { checkAnswer, cleanAnswer, keyOf, looksLikeInstructions, maxCostMicros, costMicros, DEFAULT_MODEL, PROMPT_VERSION } from "./_lib/check.mjs";

const PROVIDER = process.env.AI_PROVIDER || "", MODEL = process.env.AI_MODEL || DEFAULT_MODEL[PROVIDER] || "";
const SB = process.env.SUPABASE_URL, SKEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hash = x => createHash("sha256").update(JSON.stringify(x)).digest("hex").slice(0, 16);
const inflight = new Map();

async function sb(path, body, method = "POST") {
  if (!SB || !SKEY) return null;
  const r = await fetch(`${SB}/rest/v1/${path}`, { method, headers: { apikey: SKEY, Authorization: `Bearer ${SKEY}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=representation" },
    body: body === undefined ? undefined : JSON.stringify(body) });
  if (!r.ok) throw new Error(`db ${r.status}`);
  const t = await r.text(); return t ? JSON.parse(t) : null;
}
const rpc = (fn, args) => sb(`rpc/${fn}`, args);

export async function review(body, ip = "?") {
  const q = body && body.question, key = String(q && q.key || "").slice(0, 40);
  const answer = cleanAnswer(body && body.answer), akey = keyOf(answer).slice(0, 80);
  if (!key || !/^[a-z0-9-]+$/.test(key) || !q.prompt) return { code: 400, json: { error: "Send a question and an answer." } };
  if (!akey || akey.length < 2 || String(body.answer || "").length > 60 || looksLikeInstructions(answer)) return { code: 200, json: { status: "invalid", relationship: "none", reason: "Name one answer" } };
  const rules = (Array.isArray(q.rules) ? q.rules : []).map(r => String(r).slice(0, 160)).slice(0, 4);
  const candidates = (Array.isArray(body.candidates) ? body.candidates : []).map(c => String(c).slice(0, 60)).slice(0, 5);
  const rulesHash = hash([q.prompt, rules]), player = String(body.player || "").replace(/[^a-zA-Z0-9-]/g, "").slice(0, 40) + "|" + hash(ip).slice(0, 8);

  // 2. The permanent cache.
  try {
    const rows = await sb(`verified_answers?category=eq.${encodeURIComponent(key)}&answer_key=eq.${encodeURIComponent(akey)}&select=status,canonical,relationship,review_status,rules_hash`, undefined, "GET");
    const row = rows && rows[0];
    if (row && (row.rules_hash === rulesHash || ["confirmed", "overturned"].includes(row.review_status))) {
      rpc("va_hit", { p_category: key, p_keys: [akey] }).catch(() => {});
      if (row.status === "uncertain" && row.review_status !== "confirmed") return { code: 200, json: { status: "pending", cached: true } };
      return { code: 200, json: { status: row.status === "ok" ? "ok" : "invalid", relationship: row.relationship, canonical: row.canonical, cached: true } };
    }
  } catch { /* the cache is an optimisation: carry on without it */ }
  if (!PROVIDER) return { code: 200, json: { status: "pending", reason: "Review is off" } };

  // 3. One call for identical questions in flight.
  const flight = `${key}|${akey}|${rulesHash}`;
  if (inflight.has(flight)) return inflight.get(flight);
  const p = (async () => {
    // 4. Reserve the most this call could cost; refused means the answer waits for a person.
    let res = null;
    if (SB && SKEY) {
      try { res = await rpc("ai_reserve", { p_player: player, p_question: key, p_answer_key: akey, p_provider: PROVIDER, p_model: MODEL, p_max_micros: maxCostMicros(MODEL) }); }
      catch { return { code: 200, json: { status: "pending", reason: "Review is busy" } }; }
      if (!res || !res.ok) return { code: 200, json: { status: "pending", reason: res && res.reason === "player_limit" ? "Too many checks today" : "Review is resting" } };
      if (res.alert && process.env.AI_ALERT_WEBHOOK) rpc("ai_status", {}).then(s => fetch(process.env.AI_ALERT_WEBHOOK, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level: res.alert, spent_usd: s && s.spent_usd, budget_usd: s && s.budget_usd }) })).catch(() => {});
    } else if (PROVIDER !== "mock") return { code: 200, json: { status: "pending", reason: "Review has no budget configured" } };
    // 5. The call.
    const v = await checkAnswer({ provider: PROVIDER, model: MODEL, question: { prompt: q.prompt, rules }, answer, candidates });
    if (res) rpc("ai_settle", { p_id: res.id, p_cost_micros: v.error ? costMicros(MODEL, v.inTokens, v.outTokens) : Math.round(v.cost * 1e6), p_in: v.inTokens, p_out: v.outTokens, p_ms: v.ms, p_outcome: v.error ? "error" : v.status }).catch(() => {});
    // 6. Remember it. Model-accepted new answers wait for a person (review_status pending) but already score provisionally.
    if (!v.error) {
      const status = v.status === "ok" ? "ok" : v.status === "invalid" ? "invalid" : "uncertain";
      sb("verified_answers?on_conflict=category,answer_key", [{ category: key, answer_key: akey, status, canonical: v.canonical || null, relationship: v.relationship, confidence: v.confidence,
        rules_hash: rulesHash, source: "ai", validator: `${PROVIDER}/${MODEL}@${PROMPT_VERSION}/${v.method}`, review_status: v.review || status === "uncertain" ? "pending" : "auto",
        evidence: JSON.stringify({ quote: v.evidence && v.evidence.quote || null, url: v.evidence && v.evidence.url || null, explanation: v.explanation || null, aliases: v.aliases || [] }) }]).catch(() => {});
    }
    return { code: 200, json: { status: v.status, relationship: v.relationship, canonical: v.canonical, review: !!v.review, method: v.method, rule_version: PROMPT_VERSION, cached: false } };
  })();
  inflight.set(flight, p);
  try { return await p; } finally { inflight.delete(flight); }
}

export default async function handler(req, res) {
  const origin = process.env.ALLOWED_ORIGIN || "*";
  res.setHeader("Access-Control-Allow-Origin", origin); res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS"); res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  let body; try { body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body; } catch { return res.status(400).json({ error: "Bad request." }); }
  if (JSON.stringify(body || {}).length > 2000) return res.status(413).json({ error: "Too long." });
  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "?").split(",")[0].trim();
  try { const out = await review(body, ip); return res.status(out.code).json(out.json); }
  catch { return res.status(200).json({ status: "pending" }); }   // never an error the game has to handle: the answer just waits
}
