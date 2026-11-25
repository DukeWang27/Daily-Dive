# Questions, answers and rarity

How the game's questions are made, how a typed answer is judged, and how rarity is measured. Internal: none of the
content folders described here are served to players.

## 1. What was there before (audit, 25 November 2026)

| | |
|---|---|
| Days prepared | 15 (days 1-15), then the same 15 repeat forever |
| Daily questions | 75, all unique; plus 29 race questions in a separate pool |
| Question styles | 60 "Name a <category>", 15 word patterns ("starts with SN") |
| Answers per question | mean 266, median 193, min 30 ("ends in UMP"), max 2,461 (animals) |
| Other names per question | mean 163 (largely from WordNet synonyms) |
| How they were made | Hand-written core lists + WordNet subtrees + hand rules (`tools/questions.py`, `tools/build_days.py`) |
| How a day is chosen | `((day - 1) % 15) + 1`, the same in the browser and the database (`private.day_set`) |
| Typo handling | Plain edit distance with a fixed allowance: none for 4 letters or fewer, 1 for 5-8, 2 for 9+; only answers starting with the same letter; ambiguous cases listed up to three answers |
| Unknown answers | Marked pending; an AI review endpoint existed (`api/verify.js`) but is **not configured in production**, so pending answers were never reviewed |
| Rarity | **Simulated**: each answer got a "recall" estimate (hand-set for the top answers, otherwise from word frequency), then 120,000 simulated players each picked up to three answers |
| Real submissions | Recorded per player per question (`round_plays`), shown on the results boards once enough real players exist |
| Daily vs race | The same answer checker (`validate.js`) and the same rarity method, separate question pools |

### Why legitimate answers were rejected or mis-scored
1. **Coverage.** Lists were only what WordNet and the hand lists knew. "Name a bird" had 621 answers; the IOC World
   Bird List recognises 11,227 species. A real but unlisted answer went to "pending" and, with no review service
   running, stayed there with no depth.
2. **A trimming bug that collapsed distinct answers.** The checker stripped leading words it didn't know, so
   "banded woodpecker" (a real species) counted as plain "woodpecker", "sweet potato" (misspelt "sweat potato") as
   "potato", "black bear" as "bear". In the benchmark below, 15.6% of correctly spelt valid answers became a different
   answer this way.

### Why autocorrect was unreliable
- **Short words got no help at all.** "rafe" (4 letters) had zero allowance, so it could never reach "raven".
- **Every mistake cost the same.** A keyboard slip (y for u), a sound-alike (f for v) and a random letter all cost 1.
- **First letter had to match**, so a first-letter typo was never fixed.
- **No sense of what sounds alike** ("vulchur", "nightengale") or of joined words ("bluejay").
- **Ambiguity was resolved by listing answers**, which reveals answers to the player.
- **No confidence levels:** it either silently replaced the word or did nothing.

## 2. How an answer is judged now

The browser judges instantly, with no network, through these layers (`validate.js`):

1. **Exact name** of an answer.
2. **Tidied form**: case, accents, punctuation, plurals, spaces ("bluejay" = "blue jay").
3. **Other names**: aliases, scientific names, regional names. One- and two-letter codes ("PE") are ignored.
4. **Spelling correction, using only this question's answers**:
   - Candidates are scored with a weighted Damerau-Levenshtein distance: keyboard neighbours and vowel swaps are
     cheap, a swapped pair costs 0.6, and a dropped or doubled letter 0.5.
   - A sound key (f/v, c/k/s, ph, -ture/-chur) bonus applies, and sound-alikes get extra room.
   - The allowance grows with length.
   - Candidates are ranked by a noisy-channel score: how likely the spelling is for each answer, plus how commonly
     players give it. Never by how well it would score.
   - Results come at three confidence levels:
     - **High**: corrected at once and marked "Spelling corrected: Raven".
     - **Medium**: one "Did you mean Raven?". Enter accepts, Escape keeps what was typed.
     - **Low**: nothing is guessed, and the answer goes on to the next layer unchanged.
   - Something already a known answer is never corrected, so an obscure answer is never swapped for a common one.
   - Anti-cheating rules:
     - Suggestions are only made after a guess is sent, never while typing.
     - Only one answer is ever offered.
     - It is only offered if it's an answer people commonly give (at least 0.1%).
     - It must start or sound like what was typed.
     - At most two offers are made per question.
     - The clock keeps running, so a suggestion buys no free thinking time.
     - In races the race clock is unchanged.
   - Placeholders ("any bird", "the rarest") are refused.
   - Describing words are trimmed only from a fixed list (baby, big, wild...). Anything else stays a distinct answer
     and goes to review.
5. **Datasets merged into the question at build time** (IOC birds, Wikidata, GeoNames: see section 4), so they are
   checked as fast as layer 1.
6. **AI review** (`api/verify.js`, server-side, key never in the game). It receives the exact question, its acceptance
   criteria, the player's other answers and the unknown answer, as JSON data, never as instructions. It returns:
   - valid / invalid / uncertain;
   - the canonical name and confidence;
   - duplicate-of;
   - evidence;
   - a reason for the player;
   - whether review is needed.

   Below 80% confidence the verdict is "uncertain", and the answer stays pending. Verdicts are cached per question
   and per rules version, so a bird accepted for "Name a bird" is not reused for "Name a bird native to Antarctica".
   Identical requests in flight share one call. The endpoint is rate-limited, and a timeout leaves the answer pending.
7. **Pending**: kept, shown as "Waiting for review", never silently rejected. A person settles it with
   `cms.py verdict`, and every change is kept in `verdict_history`.

A corrected or confirmed answer is sent to the server as the answer's own name, so the server's check (`claim_ok`)
matches exactly. What the player typed is kept to show beside it ("you typed “ravne”").

**Granularity.** Each question states it in `rules.granularity`.
- Species stay distinct ("raven" and "crow" are different).
- Breeds count as their animal for "Name an animal" but separately for "Name a dog breed".
- Brand names count as their object where the rules say so.
- Synonyms and regional names share one canonical answer and one rarity.

## 3. The questions: pipeline and reserve

```
generate (AI, offline)  ->  content/questions/<id>.json  ->  build.py report  ->  build.py schedule  ->  build.py days
   or written by hand                (SPEC.md format)         quality + duplicates      90-day calendar     day files + SQL
```

- **Format:** `tools/content/SPEC.md`.
  - Each question carries its own acceptance rules: what counts, what doesn't, granularity, synonyms and ambiguous
    cases.
  - Each also carries words too general to count, common wrong answers, and answers with other names, an estimated
    share and a tier.
- **Writing brief:** `tools/content/BRIEF.md`, used by people and by the generator. It sets:
  - the variety rules, with at most a third plain "Name a ...";
  - the nine answer stages: common, uncommon, obscure, every subcategory, regional and cultural, historical and
    specialist, other names, gaps, then an independent verification pass that deletes anything doubtful.
- **Generator:** `tools/content/generate.mjs`, using the Claude API. It runs the same nine stages as separate requests,
  plus a separate fact-checking request in chunks, which drops answers and corrects shares. `refill` keeps a reserve:
  1. it counts scheduled days plus spare ready questions;
  2. it writes new specs for the thinnest categories and builds their answers;
  3. it re-runs the build.

  It needs `ANTHROPIC_API_KEY`.
- **Quality report** (`build.py report`): every question gets a score and flags. Rejected or held for review when:
  - it has fewer than 40 answers;
  - it has under 15 obscure answers;
  - its shares don't add up;
  - its rules are missing;
  - it uses subjective or time-sensitive wording;
  - its prompt is too long;
  - too many of its answers are a single slip apart.
- **Duplicates:** prompt similarity, answer overlap (relative to both lists together) and topic tag, checked against
  every new question and the original 104. A real copy is held back. Siblings on one template ("an English word from
  Dutch / German") are kept but scheduled apart.
- **Scheduler** (`build.py schedule`):
  - Each day: five questions from at least four categories (a second from one category only if nothing else fits,
    and in a different style), at most two of any style, at least one easy and one harder question, the hardest fourth.
  - Topic cooldown: 45 days. Questions sharing over 20% of answers: 3 weeks apart. Same template: 10 days apart.
  - Days already published never change.
- **The initial reserve.** The first batch of questions was written in this session by Claude, following BRIEF.md and
  SPEC.md: 20 parallel writers, one subject area each. It was not produced by running `generate.mjs`, which needs an
  API key this environment doesn't have. Their output went through the same checks.
  - A second round repaired the 89 questions held for review (mostly answer lists where every rarer answer had one flat
    share estimate instead of graded ones) and added 35 new questions in thin categories (logic, maths, mythology,
    music, people and others).
  - **Result:** 515 questions written; 486 pass the quality check, 27 are held for review, 2 are near-duplicates.
    The schedule fills **all 90 days (days 16 to 105)**, 450 questions, with **36 good questions spare**.
  - All 90 days' database files were loaded into the test database (4 seconds; 79,860 scored answers, 126,861
    recognised spellings), re-running a day's file is safe, and a future day returns nothing to players.
  - **Bug found and fixed while building:** the day files carried each answer's raw estimated share while the server
    scores with the no-evidence caps, so 8,820 of 79,860 answers (11%) would have shown a different depth in the game
    from the score, 7,145 of them looking like Challenger Deep. The build now publishes the capped share and refuses to
    write any day where the game's depth and the server's differ (checked: 0 mismatches across all 90 days, the
    original 15 days and the 29 race sets).
  - Easy questions (difficulty 2) are the scarcest resource: the scheduler uses one a day and saves the rest.
  - Known pattern: categories rotate on a roughly 4-day cycle (20 categories, 5 a day). Questions never repeat;
    a regular player may notice the subject areas come round in turn.
  - Known limitation: many answer lists use a few share levels rather than a distinct estimate per answer (a median of
    18% of a question's answers share one estimate; 59 of the 450 scheduled questions have over half on one value), so
    before player data those answers score the same depth. Real answers take over after about 30 players a question.
- **Editorial direction (25 November 2026).** Questions now follow `tools/content/EDITORIAL.md`: a house voice (few
  prompts open "Name a"; a seeded lateral question most days), gates that reject before scores rank, and the
  "breadth is not depth" rule. The schedule opens with 14 curated days written and independently criticised under
  that framework (their questions carry `"set"` and `"plan"`), then continues from the earlier bank with its prompts
  in the house voice (`build.py voiced`) and bare categories rationed to one a day (`build.py is_plain`).
  Prepared days start the day after the last day already played when this went live (`days/index.json` `"static"`),
  not after the original 15, so the original bank's unplayed days were retired.
- **Where the content lives.** The repository is **public**, so upcoming questions, answers, the schedule and build
  output are git-ignored (`.gitignore`). They must be kept in a private store: a private repository or a storage
  bucket. The game never needs them as files: each day goes into the database (`content_days`) and is handed out by
  `day_content(day)` only once that day has begun somewhere in the world. `.vercelignore` keeps `content/`, `tools/`,
  `tests/` and `supabase/` off the website.
  - Trade-off: on the day itself, the day's answers reach the browser so judging is instant (as before).
- **Review tool:** `tools/content/cms.py`. Commands:
  - `status`, `upcoming`, `show <id>` (diagnostic with samples by rarity, sources, flags), `weak`;
  - `approve` / `reject` / `edit`, and `reschedule` (future days only);
  - `html` (an internal browsable report);
  - with `DATABASE_URL`: `pending`, `verdict`, and `stats <set> <round>` (real-player numbers with the Bayesian estimate).

## 4. Data sources

| Source | Licence | Used for | Status |
|---|---|---|---|
| IOC World Bird List 15.2 | CC BY 4.0 | All 11,227 bird species (English and scientific names, family, region, extinct flag), 482 group names | **Imported** (`content/kb/birds.json`) |
| GeoNames cities15000 | CC BY 4.0 | 34,244 cities with country and population | **Imported** |
| Wikidata | CC0 | Countries (with continent, landlocked, island), former countries, elements, dog/cat/horse breeds, cheeses, instruments, constellations, languages, volcanoes, dinosaurs | **Partly imported**: Wikidata's query service was in an outage and rate-limited to 1 query a minute; `tools/content/sources/wikidata.py` retries |
| WordNet (via the original tools) | WordNet licence (permissive) | Synonym groups for the original 15 days | Already in use |
| GBIF / Catalogue of Life | CC BY / CC0 | All animal and plant taxa, vernacular names | Not imported: huge, and vernacular names are patchy. Recommended next for animals and plants (download the backbone, filter by rank and English names) |
| eBird / Clements | Free use with attribution | Alternative bird taxonomy | Not needed alongside IOC |
| World Flora Online | CC BY | Plants | Not imported (next after GBIF) |
| MusicBrainz | CC0 core data | Bands, songs, genres | Not imported; fast-changing, so better for dated questions |
| TMDB | Free API with attribution; commercial use needs agreement | Films, characters | Not imported: licence |
| Open Food Facts | ODbL | Products | Not imported: brands, not dishes |

- **How datasets are used:** they are downloaded once and merged into a question's answers at build time, never
  called while anyone plays.
- **Starting rarity:** a dataset-only answer gets a cautious provisional prior (about 1 in 50,000, nudged by English
  word frequency) and is marked provisional.

## 5. Rarity

**What a share means:** of the players who answered a question, the fraction who gave this answer as one of their (up
to three) guesses. Each player counts once per answer. Shares add up to about 2.6, not 1. It is never the share of all
guesses.

### The old simulation, assessed
- The frequencies were derived from a model, not invented one by one, but the model's only input was a recall guess:
  hand-set for about 20 answers, otherwise word frequency.
- Word frequency measures how common a word is in text, not how readily it comes to mind for a given question.
- 30% of simulated players were set to prefer rare answers, which inflates the long tail.
- Answers not on the list got zero, and the list's composition shifted everyone else's shares.
- Most importantly, the 120,000 simulated players were **treated as evidence**: an answer could go beneath the iceberg
  if 3 "simulated players" gave it. 1,686 of 23,311 answers (7%) were marked rarer than 1 in 10,000 by simulation alone.

### The provisional estimate now
- **Questions written by AI:** each answer gets an estimated share, made in stages and checked by a separate pass,
  against stated anchors (top answer 25-50%, tenth 3-8%, specialist 0.01-0.05%).
- **Dataset-only answers:** the cautious prior above.
- **Shaping:** the top answer is trimmed at 60%, and the total must be plausible (1.6-3.6).
- **Status:** these are provisional estimates, and the game says "Sample data" or "rarity still being measured".

### Real players
`private.question_stats(set, round)` gives each answer's real count, the number of real players, and a Bayesian
estimate:

> posterior share = (x + k·prior) / (n + k), with k = 30 pseudo-players

- With 10 players the prior dominates; with 1,000 the real data does.
- An upper bound is reported, for "is it really that rare?".
- Bots and duplicates: one row per player per question; anonymous players are rate-limited (`rate_log`).
- **The daily game (Icebreaker) and Submarine Race are counted separately.** A race player's choices are made under a race clock, so
  they are not merged.

### Fair scores
- A day's rarity table (`set_answers`) is fixed before the day starts and never rewritten afterwards. Morning and
  evening players are scored by the same table, and history, rankings, friend comparisons and share cards never change.
- Real data improves future tables: `private.refresh_snapshot(set)` refuses any set already played. It also feeds
  re-runs of a question, the race pool, and calibration of the AI estimates against reality.

### Beneath the iceberg (Challenger Deep) now needs real players
- **The rule:** an answer goes deeper than 299 m only if real players back it, meaning the question has at least
  10,000 real players and at least 2 real players gave the answer (`game_config`: `evidence_players`, `evidence_min`).
- **Provisional answers** (dataset-only) stop at 250 m.
- **Applied:**
  - to the new days;
  - to the original tables not yet played (days 3-15) and to the race pool (`recap_legacy.py` + `0006` part 5);
  - **not** to days 1 and 2: they were played under the old rule and stay exactly as they were.
- **Consequence:** until a question has about 10,000 real players, nobody reaches Challenger Deep on it. The squid
  encounters still exist, but they need real rarity.
- **The thresholds are settings**, one line to change (see "Decisions for the owner").

### Approved answers that aren't in the table
- They score a fixed, modest 52 m (Midwater): never the maximum, never zero.
- They gain real rarity as players give them.

## 6. Benchmarks

Labelled set: `tests/answers/labeled.json`, 688 cases, built by `make_labeled.py`. It covers:
- common and obscure answers from the lists;
- other names;
- generated typos: transposition, missing, extra, keyboard, phonetic;
- 80 hand-written realistic misspellings, including "rafe" and "ravne";
- 80 **independent** answers from IOC and Wikidata that were not used to build the old lists;
- invalid cases: too general, wrong category, unrelated real words, gibberish and fragments, manipulation attempts.

Run with `node tests/answers/eval.cjs --engine=old|new --data=old|kb`.

| | Old checker, old lists | New checker, old lists | New checker, lists + datasets |
|---|---|---|---|
| Valid answers accepted at once | 79.6% | 83.1% | **97.1%** |
| ... with at most one confirmation | 79.6% | 84.9% | **98.9%** |
| Valid answers left pending | 10.9% | 14.9% | 0.7% |
| Valid answers turned into a different answer | 9.5% | 0.2% | 0.2% |
| Correctly spelt valid answers changed | 15.6% | 0% | **0%** |
| Real answers missing from the old lists, accepted | 0% | 0% | **100%** |
| Typos fixed automatically | 89.1% | 95.6% | 95.6% |
| Typos fixed with at most one confirmation | 89.1% | 99.0% | **99.0%** |
| Typos corrected to the wrong answer | 4.1% | 0.3% | 0.3% |
| Invalid answers accepted | 2.2% | 0.7% | 0.7% |
| Invalid answers offered a suggestion | 0% | 0.7% | 0.7% |
| Judging time, median / 95th percentile | 0.005 / 0.06 ms | 0.06 / 0.6 ms | 0.005 / 1.1 ms |

- The remaining invalid-accepted case is "bamboo" for "Name a tree", which the original list itself accepts.
- Judging takes about 1 ms even on the 11,904-answer bird question: no AI or network for any of these.

## 7. Operating costs (estimates)

Assumptions:
- 16 answers submitted per player per day (5 questions, about 3.2 submissions each, counting duplicates and slips).
- 3% of submissions reach the AI layer.
- Cache hits on repeated unknowns grow with players: 10% / 40% / 70% / 85%.
- About $0.010 per review on Claude Opus 5.5 at low effort ($4 / $20 per million tokens; about 800 tokens in and
  350 out). Claude Haiku 5.5 would be about $0.00026.

| Players a day | AI reviews a day | Opus 5.5 / month | Haiku 5.5 / month |
|---|---|---|---|
| 100 | ~43 | ~$13 | ~$0.35 |
| 1,000 | ~290 | ~$86 | ~$2.30 |
| 10,000 | ~1,440 | ~$430 | ~$11 |
| 100,000 | ~7,200 | ~$2,160 | ~$56 |

- **Content generation:** about $1.50 per question with Opus 5.5 at high effort (nine stages plus checking). That is
  about $650 for 450 questions, or about $290 a month to keep a reserve topped up. The Message Batches API halves it.
- **Database:** a day's content is 47 KB (median) to 106 KB. At 100,000 players a day that is about 150 GB a month of
  database egress (Supabase Pro needed). Moving day content to a cache or CDN in front of `day_content` removes most
  of that.
- **Graceful degradation:**
  - No AI service: answers stay pending, and the game plays normally.
  - No database: the browser keeps a copy of the day.
  - Datasets: never called live.

## 8. Decisions for the owner
1. **Where private content lives** (the repository is public): a private repository, or make this one private.
2. **The Challenger Deep evidence threshold:** 10,000 real players is honest but means no Challenger Deep for a long time.
   An alternative is a relative rule, such as "nobody else among at least 500 players gave it".
3. **AI review in production:** set `ANTHROPIC_API_KEY` (and `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` for the
   shared cache) on Vercel, and set `verifyUrl` in game.js.
4. **Applying `0006_content.sql` and the 90 days of content to the live database.**
