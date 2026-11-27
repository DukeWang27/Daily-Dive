# Deeple answer intelligence and ranked play

How the game decides what a player meant, what it costs, and how ranked 1v1 works. Written 2026-11-25 for the
`deep-life` branch. Nothing here is live until it is deployed; the live state at the time of writing is listed under
"Production audit".

## 1. What Krillion documents (and what it doesn't)

Source: the official FAQ, https://krillion.io/faq, read directly. Full notes with quotes: `content/review/krillion-research.md` (private).

- Answer sets are built by "aggregating datasets (dictionaries, wiki pages, encyclopedias, whatever sources the question calls for), then merging and cleaning".
- Rarity: "Some prompts can be scored entirely mechanically against a familiarity database… Others… get a combination of LLM assistance and a manual pass." Live player counts are not mentioned.
- Missing answers are sourcing misses ("I didn't find it, sorry").
- Autocorrect checks aliases too and is "generous"; their own example (sea donkey vs sea monkey) shows how fuzzy matching across aliases misfires.
- Some questions have "thousands of accepted answers".
- Not documented: how questions are written, whether corrections are confirmed, disputes, or AI-generated lists.

What we took from it, as our own design: merge many sources per question; use familiarity as the prior and real players as the truth; treat aliases as both a recall tool and a false-match risk; fix missing answers at the source, plus a live, budgeted check whose results are kept for good.

## 2. Audit of the previous system (evidence)

| Area | Before this update | Evidence |
|---|---|---|
| Questions and scheduling | Days 1–3 ship as files; days 4–93 are served from `content_days` through `day_content()`, locked until each day opens | `game.js dayContent`, `supabase/0006_content.sql`; live: 90 content days |
| Accepted answers | Per-question lists (`answers[].a`, `.al`, `.s`); server copy in `set_answers` (86,490 rows live) | live query |
| Alternative names on the server | 143,969 `set_keys` rows over 122 answer sets (names, other names, plural forms) | live query |
| Canonical identity | The list row's name; no cross-question identity | `validate.js prepare` |
| Normalisation, fuzzy, phonetic | Present in the browser (`validate.js`): normalise, plurals, joined words, keyboard/phonetic edit cost | code |
| Corrections | High-confidence typos were replaced silently (fixed in the previous update: now always confirmed) | `tests/answers/holdout-eval.cjs` |
| Misspellings stored as "aliases" | Several lists store misspellings ("leging", "turqoise") as other names, so they were accepted silently | holdout set; fixed |
| AI validation | Code existed (`api/verify.js`) but is **off in production**: `BACKEND.verifyUrl` is empty, so unknown answers just wait as "pending" | `game.js` line 15 |
| Verdict cache | Table exists with 0 rows | live query |
| Genuine submissions | Recorded: 54 question plays, 2 dives, 8 day results, 6 flags | live query |
| Rarity | Estimates from the question build (and 120,000 simulated players for days 1–3); real counts replace the board after 30 players | `iceberg.js`, `game.js` |

## 3. The layered answer check

1. **Exact** list name → accepted at once.
2. **Normalisation** (case, punctuation, accents, spacing, plurals, "Grey/gray"-type spellings) → accepted at once.
3. **Other names** (aliases, regional, scientific, historical, abbreviations; the question's own category word, "Mexican Hairless Dog" → Xoloitzcuintli) → accepted at once, scored exactly as the listed answer, shown as the player wrote it with "Also known as".
4. **Spelling** (keyboard/phonetic edit cost, ranked by the current question's answers and their popularity, ambiguity margin, stricter for short words) → **always asked**: "Did you mean Burgundy?" in the ice panel. Never silent, one suggestion only, nothing about rarity until confirmed. A correctly spelt real word (dictionary check, `realwords.txt`) is never "corrected" into a different answer.
5. **Knowledge datasets**: merged into each question's list at build time (`tools/content/kbmerge.py`, `aliases.py`), so most real answers are already known.
6. **AI review** (`api/verify.js`, `api/_lib/check.mjs`) for what's left: one small request, strict JSON, rules enforced in code.
7. **Pending review**: anything unresolved waits for a person; it is never rejected just because nothing could check it.

Anti-abuse in the browser: three spelling questions per question at most; the clock keeps running; duplicates under another name are free but score nothing extra.

## 4. Canonical identities and the alias pool

`tools/content/aliases.py` builds one reusable pool from:
- `content/kb/synonyms.json`: hand-checked groups (regional, scientific, historical, abbreviations). Loose groups are never applied automatically.
- Wikidata extracts (countries, breeds, instruments, languages…): label plus up to five plain-English aliases, never another entity's own name.
- IOC World Bird List: scientific names.

A group is applied to a question only if that question really draws on the source (3+ answers in it) and exactly one listed answer carries one of the group's names as its own name. Two listed answers in one group means the list treats them as different, so nothing is added. Applied: 960 names to days 1–3 (files), 3,440 to days 4–93 (`content/build`, with `content/build/sql/aliases.sql` ready for the database, **not yet applied**).

The server table `entity_aliases` (0007) stores confirmed alternative names by domain for reuse.

## 5. AI validation

**Recommended provider and model: Anthropic `claude-haiku-5-5`** (thinking off, low effort, JSON schema output). It ties with OpenAI `gpt-6-luna` as the cheapest verified option ($0.10 in / $0.50 out per 1M tokens). Reasons for Anthropic: hard spend limits on the account, structured output, and it is the provider the code already used. **This is provisional until the benchmark below is run with real keys**: if `gpt-6-luna` scores better on the holdout, switch with one environment variable.

| Model | $ / check | Source |
|---|---|---|
| Claude Haiku 5.5 | $0.000065 | anthropic.com/pricing |
| OpenAI gpt-6-luna | $0.000065 | platform.openai.com/docs/pricing |
| Gemini 3.1 Flash-Lite | $0.000178 | ai.google.dev/gemini-api/docs/pricing |
| DeepSeek Flash (peak) | $0.000177 | api-docs.deepseek.com/quick_start/pricing |

(350 input + 60 output tokens per check; prices read 2026-11-25. Google's free tier uses data to improve products; don't use it for player text.)

What the model receives: the question, its rule, the answer (cleaned, max 40 characters), up to five nearby listed answers. What it returns: `{status, relationship, canonical, confidence}`. Decisions in code: alias/spelling must name a candidate we sent; alias ≥0.85 → accepted as that answer; spelling ≥0.8 → the player is asked; new valid ≥0.9 → scores the fixed provisional depth and waits for a person (`review_status = pending`); invalid ≥0.9 → rejected; otherwise pending. The model never sets a rarity or touches a player record.

### Permanent caching
Every verdict is stored in `verified_answers` (question key, answer key, rules hash, relationship, canonical, confidence, validator version, review status, hit count). The same answer to the same question under the same rules is never paid for twice; identical requests in flight share one call; a person's decision (`confirmed`/`overturned`) can't be overwritten by a later automatic verdict.

### Budget and abuse controls (`supabase/0007_intelligence.sql`, enforced in the database)
- Monthly cap **$10** (`private.ai_config`), reserved *before* each call with a row lock: tested with 20 simultaneous requests against room for 3, and exactly 3 got through.
- 1,500 paid checks a day, 30 per player, 400 per question (all configurable).
- Alerts at 50 / 80 / 100 % (`private.ai_alerts`, optional webhook `AI_ALERT_WEBHOOK`).
- Unsettled reservations are charged in full after 10 minutes.
- Junk, lists and instruction-like text are rejected before any call; 6-second timeout; one retry at most.
- With the budget spent or the provider down, answers stay pending and the game carries on.

### Cost projections (production checks only)
Assumptions: 12 Icebreaker submissions per player per day (max 15 guesses), plus 3 race submissions; $0.00008 per paid call (Haiku 5.5 including its larger token counts); 5% retries; cache hit rate rising with players (30% at 100, 60% at 1,000, 80% at 10,000).

| Daily players | 1% need AI | 3% | 5% | 10% |
|---|---|---|---|---|
| 100 | $0.03/mo | $0.08 | $0.13 | $0.26 |
| 500 | $0.09 | $0.28 | $0.47 | $0.95 |
| 1,000 | $0.15 | $0.45 | $0.76 | $1.51 |
| 5,000 | $0.47 | $1.42 | $2.36 | $4.72 |
| 10,000 | $0.76 | $2.27 | $3.78 | $7.56 |

A $5–$10 budget covers the realistic early range many times over. At 5,000+ players and 10% the daily limit (1,500) binds first; raise it in `private.ai_config` rather than the money cap. Not included above: offline question writing and answer research (one-off, done in development), Supabase and Vercel hosting (current free/hobby tiers), and external datasets (all downloaded once, free licences).

### Setup (needs the owner)
1. Create an account at https://console.anthropic.com (separate from a Claude subscription; the subscription does not pay for API calls). Add a payment method and buy prepaid credits (start with $5). Under Limits, set a monthly spend limit of $10.
2. Create an API key (Settings → API keys). Never paste it into the game files, GitHub, chat or an artifact.
3. In Vercel → the project → Settings → Environment Variables (Production only), add: `AI_PROVIDER=anthropic`, `ANTHROPIC_API_KEY=<key>`, `SUPABASE_URL=https://lrubyctrjrkzbbshlois.supabase.co`, `SUPABASE_SERVICE_ROLE_KEY=<service role key from Supabase → Settings → API>`, `ALLOWED_ORIGIN=https://www.deeplegame.com`.
4. Apply `supabase/0007_intelligence.sql` to the database.
5. Redeploy. The game asks `/api/verify` whether the check is configured and switches it on by itself (`{"enabled":true}` when it is); no code change.
6. Run the benchmark (next section) before switching it on for players.

### Benchmark
`node tests/answers/holdout-eval.cjs --ai=<provider>` runs the 218-case holdout (written separately from the tuning set, never used to tune) through the real checker and then the AI layer, and reports acceptance, false acceptance/rejection, alias recognition, wrong merges, unnecessary corrections, latency (mean/median/p95), tokens and cost per call. It needs the provider's key in the environment. Real-model results have **not** been measured yet (no keys here); the mock provider exists only to test the plumbing.

## 6. Rarity

- **Provisional estimate** (every answer at publication): from the question build's familiarity priors; answers added from datasets start very rare but are capped; nothing reaches Challenger Deep without real evidence.
- **Observed frequency**: real players' answers (`round_plays`), shown once 30 players have answered a question; the published table stays fixed for the day so everyone is scored alike (snapshots are never rewritten).
- **Uncertainty**: below 30 players the board says "Estimated"; Challenger Deep needs evidence from real players (0006: 10,000-player evidence rule; 299 m cap otherwise).
- **AI-approved new answers** get a fixed modest depth (52 m, Midwater), never "maximum rarity for being missing", and are never rejected for having no rarity.
- Transition: as real counts grow, the next tables for reused questions are built from observed shares blended with the prior (Bayesian, `IMAGINARY_PLAYERS = 200` weight), then the prior fades out.

## 7. Ranked 1v1 (`supabase/0008_ranked.sql`, `ranked.js`, `race.js`)

- **Format**: 2 players, 5 questions, 20 seconds, three guesses a question, deepest answer per question counts. Kept consistent with the race's three guesses (one guess felt too luck-driven for a rated mode).
- **Matchmaking**: one queue; the rating window starts at ±100 and widens 20 points a second up to ±600; one matchmaker at a time (advisory lock), stale entries drop after 12 seconds; a refresh during a match returns you to it. No bots.
- **Elo**: start 1,000; K = 40 for the first 10 matches (placement), then 32; draws = 0.5; floor 100. Settled once per match by the database (history keyed by match and player) the moment the race finishes.
- **Divisions** (configurable, `ranked.js`): Reef < 800, Kelp 800, Current 950 (start), Twilight 1100, Trench 1250, Hadal 1400, Leviathan 1550. Pixel-art insignia are drawn on canvas, not images or emojis.
- **Integrity**: forfeit = leaving before the last question closes; abandoned matches don't count; if pending answers could change the winner, the result waits up to 3 minutes, then the match counts as no contest; the same pair is rated at most 3 times per 24 hours; ranked questions come from their own pool (race questions with 120+ answers, never daily ones) avoiding repeats within a week; no rematches; ratings are readable, never writable, by players.
- **Not yet built**: realtime push (polling every ~1–2 s carries it), an account-age requirement for ranked, and reporting tools for suspected collusion.
- **Pool size**: 14 ranked-eligible questions live today; enough to test, too few for public play without repeats. Grow it before launch.

## 8. Tests

| Suite | What | Result (2026-11-25) |
|---|---|---|
| `tests/answers/holdout-eval.cjs` | 218 independent cases | see report |
| `tests/answers/synonyms.cjs` | aliases, confirmations, duplicates | 20/20 |
| `tests/answers/verify.test.mjs` | endpoint: cache, budget, dedupe, junk | 6/6 |
| `tests/db/ranked.cjs` | queue, Elo, settle-once, forfeit, pending, win-trading | 23/23 |
| `tests/ranked-ui.cjs` | two real browsers play a full ranked match | 7/7 |
| `tests/db/race.cjs` | existing race rules | 57/57 |
