# Deeple editorial method, v2: entertainment first

Replaces the dataset-first approach (QUESTION-METHOD.md, Nov 27), which produced technically complete but often dull
questions ("a dish named after a person") and subjective categories sold as objective ("a US one-hit wonder", where
the hidden rule was membership of an incomplete Wikipedia list). Sources still matter, but they come at step 7, not 1.

## The process

1. **Brainstorm for fun.** Write prompts you'd want to answer with friends. No looking at datasets yet.
2. **Would ordinary people enjoy it?** Picture a casual player, a fan, and a know-it-all. All three should want to
   play. Kill anything that feels like homework, a school worksheet, or an encyclopedia index.
3. **Obvious answers.** Write 5 that most people would say in seconds. If you can't, it isn't accessible.
4. **Clever answers.** Write 5 that make someone go "oh, nice". These are what the game is about.
5. **Satisfying rare answers.** Write 5 that would make a player tell a friend. Obscure strings that nobody would
   ever be pleased to find don't count.
6. **Boundaries.** Can a stranger judge any answer the same way you would, from a one-line rule the player sees?
   If the category depends on taste ("a classic", "known as", "iconic"), either define it objectively (a chart, a
   date, a list the player can check) or drop it.
7. **Sources.** Only now: which datasets, lists, dictionaries or official records cover the valid answers, including
   the obscure ones? Several sources merged beat one convenient list. Where no source can cover the space, plan for
   the hybrid validator (deterministic rules + evidence lookup + AI check + review), or drop the question.
8. **Build and clean the answer set.** Merge sources; canonical names; generous aliases (spellings, abbreviations,
   brand/product forms, regional names, plurals); explicit granularity (what is one answer).
9. **Independent challenge.** A tester who never sees the list writes obvious, clever, specialist and very obscure
   valid answers, natural phrasings, slang, misspellings, brands/products, ambiguous cases, plausible wrong answers,
   fabrications and adversarial inputs. Fix what fails; re-test.
10. **Familiarity.** Pick the right evidence for the category (see RARITY-V2.md). Bands, not false precision.
11. **Playtest.** Play it timed and untimed. Record fun / boring / too specialised / confusing / missing answer /
    wrong rarity.
12. **Editorial approval** by the owner. Investment already made is never a reason to approve.

## The rubric (score 1-5 each; weights in brackets)

| Criterion | What a 5 looks like | Weight |
|---|---|---|
| Immediate accessibility | almost anyone has an answer within 5 seconds | 3 |
| Entertainment value | people smile or argue about it; you'd ask it at a party | 3 |
| Creative thinking | lateral routes to answers, not just recall of a list | 2 |
| Answer diversity | many different *kinds* of good answers, not one long homogeneous list | 2 |
| Room for obscure knowledge | experts have satisfying deep cuts | 2 |
| Cultural relevance | connects to things people actually know and care about now or nostalgically | 2 |
| Surprise factor | the prompt or its best answers are unexpected | 1 |
| Social discussion | "what did you put?" | 1 |
| Factual clarity | the rule is objective and visible to the player | 3 (gate) |
| Validation feasibility | answers can be recognised reliably (list, rule or hybrid validator) | 3 (gate) |
| Rarity estimation quality | we can rank familiarity credibly | 1 |

**Gates:** factual clarity and validation feasibility must each be >= 3, or the question is rejected however fun.
**Size is not a criterion.** 100 excellent answers beat 10,000 technical ones. Small sets suit target and mines rounds.
**Automatic rejections:** children's vocabulary drills; exam questions; random encyclopedia categories; artificially
complicated trivia; a question that exists only because a list exists; topics almost nobody cares about outside the
game; anything whose rule depends on taste or media labels ("known as", "iconic", "famous", "classic").
**The ideal:** easy to answer, hard to answer exceptionally well.

## The daily balance (a guide, not a template)

1. One accessible everyday / general question.
2. One pop culture, entertainment or nostalgia question.
3. One creative or wordplay question.
4. One rotating specialist subject (sport, science, geography, tech, business, history).
5. One surprising wildcard.

No two questions in a day lean on the same niche (one gaming question a day at most, one music, one sport). No
day should be miserable for someone who doesn't know Pokémon, Taylor Swift or American sports.

## Editorial direction

More: internet culture, nostalgia, video games, film and TV, music, brands, sport, everyday life, wordplay, business
and tech, surprising general knowledge, unusual connections. History, geography and science when the prompt is
genuinely interesting. Never a specialised academic quiz.
