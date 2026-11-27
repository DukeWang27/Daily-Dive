# How a Deeple question is made

The game rewards the rarest correct answer. That only works if every correct answer, however obscure, is on the
question's list. So a question is designed around a list that already exists, not written first and listed later.

## The three tests (all must pass)

1. **Anyone can start.** Most players can name two or three answers within seconds. The top answers are things
   everyone knows (for "a dog breed": labrador, poodle). Test: an independent writer lists the first 10 answers
   that come to mind; most must be on the list as common.
2. **There's a deep tail.** Hundreds of valid answers (ideally 300+), most of which few players would think of, so
   going deep is a real choice. Small closed sets (the 7 continents) are allowed only for special round types.
3. **A reference source enumerates it.** A Wikidata class, a Wikipedia "List of ..." page (or a set of them), a
   standard dataset (O*NET jobs, the IOC bird list, ISO countries, the periodic table) or a dictionary. The source
   must contain the obscure answers, not just the famous ones. If no source lists the valid answers, the question
   is rejected however clever it is: "a famous heist" fails; "a country that no longer exists" passes.

## What makes it interesting (not just "Name a fruit")

- **A twist on a big set:** a familiar category with one sharp condition that a source can apply
  (a capital that isn't its country's biggest city; an element named after a place; a film based on a video game).
- **Everyday knowledge, wide tail:** brands people use, foods, places, games, characters, internet things.
  Players should feel "oh, I know a weird one".
- **No judgement words** ("famous", "popular", "best") unless the source defines them ("has an English Wikipedia
  article" is a definition; "famous" isn't).
- **No disputed facts** as the condition (who invented the telephone).
- **One answer = one thing.** Granularity is decided up front (brand or model; species or breed; city or country).

## The answer list (built, not written)

1. Gather every entry from the sources (tools/content/wikilists.py: Wikipedia list pages + Wikidata queries).
2. Merge with any hand-written list; collect other names (Wikidata alternative labels, redirects, short forms,
   scientific names, former names).
3. Check each new entry against the rules (an AI pass, one decision per entry, recorded; arguable ones go to the
   owner's review, never straight into the game).
4. Rarity: hand-written tiers where we have them; otherwise a first estimate from how widely known the thing is
   (Wikipedia language editions, page views), marked as an estimate until real players give real numbers.

## The niche-answer test (before a question can go live)

An independent writer, who hasn't seen the list, writes 30 obscure but correct answers and 15 plausible wrong ones.
At least 90% of the obscure correct answers must be recognised, and at most 5% of the wrong ones accepted.
Questions that fail go back to step 1 (better sources) or are dropped.
