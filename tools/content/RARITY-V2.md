# Rarity and validation, v2

## 1. Two separate questions

- **Validation:** does this answer satisfy the question? (lists, aliases, rules, evidence, AI, people)
- **Rarity:** how familiar is this answer to the people playing? (evidence of familiarity, then real players)

An answer missing from our list is *never* scored as maximally rare because it was missing. Once validated, it gets
a canonical identity and a rarity from the cold-start policy below, and is stored for review.

## 2. Where a rarity comes from, by stage

| Stage | Source | Shown to players as |
|---|---|---|
| Before anyone plays | the **reference estimate** for the category (below), in **bands** | "Estimated: uncommon" (band label), never a fake % |
| Once ~30 players answered | observed counts blended with the estimate (Bayesian, already built: 0006/0009) | "Estimated" until enough players |
| Once enough players | **observed share** | real %, "x of N players" |

Observed community popularity and estimated reference familiarity are stored separately (set_answers.share = the
reference; answer_counts = observed) and never relabelled as each other.

## 3. Reference familiarity by category

No single number fits everything. Wikipedia page views measure interest in a *page*, not the chance someone *says*
it under a given prompt (a famous war gets views; few people name it for "a war with an odd name").

| Category type | Primary evidence | Secondary | Notes |
|---|---|---|---|
| English words (wordplay prompts) | corpus word frequency (SUBTLEX-US / wordfreq, open licences) | dictionary flags (common vs rare) | strong signal: everyday words are said far more |
| Names of people, places, things | Wikipedia page views (12 months) + language editions (Wikidata sitelinks) | Google Books Ngram (licence: free to use the data; heavy to download) | interest proxy only: always banded |
| Songs, artists | chart history (peak, weeks), streaming counts where public | page views | a #1 hit is "common"; a #80 single "rare" |
| Video games, films, shows | page views + editions | sales / box office / ratings where public | |
| Brands, products | page views + editions | market presence (editorial) | |
| Creative / subjective prompts | editorial bands set by the writer, checked by a second editor | AI estimate as a tiebreak | widest bands; real players take over fastest |
| Closed small sets (countries, elements) | page views + editions | observed submissions | target / mines rounds suit these |

Every estimate is converted to one of **five bands** (Surface, Shallows, Midwater, Deep, Abyss) rather than a
precise %, because the evidence doesn't justify precision. Past the Abyss band, exact rarity can't be told apart
without players, so nothing goes "beneath the iceberg" (Challenger Deep) without real-player evidence (already the
rule since 0009).

## 4. Cold-start policy for an answer validated during play

1. It joins the question's list as **provisional**, with the band of its reference evidence if any (looked up the
   same way as the rest of the list), otherwise the **Deep** band (a fixed, published default: rare, not maximal).
2. For **ranked** play everyone in the same daily challenge is scored against the **same reference**: the band table
   frozen when the day began (a scoring snapshot). Answers validated later in the day score their frozen-default
   band for everyone; they never re-score earlier players and never earn more than an answer already on the list.
3. Pending answers score 0 provisionally and are marked "pending". When resolved, an unranked dive updates; a
   ranked dive updates only within the day's settlement window (until the day closes everywhere), after which
   scores are final. Corrections after that follow the correction policy (a logged, announced fix; never silent).
4. A pending answer still uses one of the three guesses: pending never creates extra attempts.

## 5. The legendary find (editorial, not competitive)

Competitive score stays pure rarity. Separately, each question can mark a few **editorial discoveries**: legitimate,
unexpected, recognisable to some, clever in context, worth telling a friend about. Finding one unlocks a creature /
journal entry (the discovery system that already exists), with no effect on the score or ranking. Players see:
"Rare find" (score) and, separately, "Discovery: you found the Axolotl" (achievement). Prototype in the playtest
before anything changes live.

## 6. Validation layers, cheapest first

1. exact canonical match → 2. aliases → 3. normalisation (case, accents, punctuation, plurals, "the") →
4. context-aware fuzzy matching (asks before correcting to a dataset entry) → 5. verified-answer cache (per question
and rule version) → 6. deterministic question rules (dictionary + letter rules for word prompts) → 7. structured
lookup (Wikipedia summary / Wikidata) → 8. AI check with that evidence (api/verify.js v2) → 9. a person.

Measured latency (27 Nov 2026, this machine): local matching median <0.01 ms, p95 0.7 ms (fuzzy p95 1.9 ms;
lists over 1,500 answers p95 2.2 ms); database lookup median 0.10 ms, p95 0.15 ms; cache lookup median 0.10 ms;
Wikipedia summary fetch median 98 ms, p95 134 ms; Wikidata lookup median 300 ms, p95 6.9 s (too slow to block on,
fine in the background). AI call: not measured (no key); third-party figures put a short Claude Haiku 5.5 verdict
around 0.5-1 s without thinking.
