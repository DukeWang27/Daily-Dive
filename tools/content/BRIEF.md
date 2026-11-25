# Writing questions for the daily rarity game

You write questions and answer lists for a daily game. Each day players get five questions ("Name a bird",
"Name something you'd find in an abandoned hospital"). They give up to three answers each; the FEWER players who give an
answer, the DEEPER it sinks and the more it scores. So the game rewards real but uncommon knowledge. The game's worth
depends on (1) questions people enjoy and (2) answer lists broad enough that a player who knows an obscure but genuine
answer is recognised instead of rejected.

Read tools/content/SPEC.md (the file format) and content/existing_prompts.txt (already used: do NOT repeat these or
make near-copies of them).

## Good questions
- Interesting, varied, understandable at a glance, fair to people from any country.
- Mix of styles: category, constraint, scene, association, property, wordplay, then-and-now, role, fiction (see SPEC).
  At most a third of your questions may be plain "Name a <category>".
- A long tail of legitimate obscure answers MUST exist (a specialist should be able to go very deep).
- Defensible acceptance criteria: two careful judges must agree. Avoid taste ("Name something beautiful"), opinion,
  fast-changing facts without a date, single-country knowledge, and questions whose valid set is under 40.
- Player-facing wording states key restrictions briefly (e.g. "...that isn't a fish"); put the rest in rules.player.

## Building each answer list (do every stage, in order; do not stop after one list)
1. Common answers people say first. 2. Moderately uncommon ones. 3. Obscure but real ones.
4. Walk every subcategory (for "in a kitchen": appliances, utensils, cookware, ingredients, furniture, cleaning, storage,
   specialist tools...). 5. Regional and cultural variants from around the world. 6. Historical and specialist answers.
7. Alternative names for each answer (into "al", not separate answers). 8. Look for gaps: what would a specialist say
   that you haven't listed? Add it. 9. VERIFY: re-read the whole list as a strict judge against the rules; delete
   anything invented, doubtful, duplicated, too general, or outside the rules. When unsure an item is real, leave it out.
Aim for the broadest practical list: typically 150-500 answers for open questions, every member for closed sets.
Canonicalise: one entry per distinct thing; synonyms and regional names go in "al". Keep distinct things distinct
(raven and crow are different; poodle may be its own answer for "Name a dog breed" but counts as dog for "Name an animal").
Never pretend a list is complete: it is a recognition list, and unknown answers go to review in the game.

## Estimating p (share of players giving it)
Use the calibration in SPEC.md. Be realistic: most players give the obvious answers; obscure answers get tiny shares.
Shares across the whole list should add up to about 2.5-2.8. Don't inflate obscure answers.

## Finishing
Write one file per question to content/questions/<id>.json (choose a new id; if the file exists, pick another id).
Run: python3 tools/content/check.py content/questions/<your files> and fix every problem it reports.
Set generation: {"by": "claude-session-subagent", "stages": [...the nine stages...], "date": "2026-11-25"}.
Report back in under 150 words: how many questions written, ids, any you dropped and why. Don't paste answer lists.
