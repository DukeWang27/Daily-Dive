# Question file format (content/questions/<id>.json)

One file per question. This is the source the build reads; players never see these files directly.

```json
{
  "id": "abandoned-hospital",              // lowercase-hyphenated, unique forever (stats are filed under it)
  "prompt": "Name something you'd find in an abandoned hospital",
  "hint": "Anything you could really find there, from equipment to graffiti.",   // one line, under 90 characters
  "title": "Abandoned hospital",           // 1-3 words, for lists
  "icon": "building",                      // one of the icon names in icons.js
  "category": "everyday",                  // see CATEGORIES below
  "style": "scene",                        // see STYLES below
  "topic": "hospital",                     // the semantic family: questions with the same topic are near-duplicates
  "difficulty": 2,                         // 1 easy ... 5 hard (how hard to think of a RARE valid answer)
  "rules": {
    "player": ["Any object, fixture or substance you could find there.", "People and feelings don't count."],  // shown to players, max 3, short
    "accept": ["equipment, furniture, fixtures, supplies, debris, signs", "objects left behind by visitors (graffiti, litter)"],
    "exclude": ["people, ghosts or other supernatural things", "abstract nouns (fear, silence)"],
    "granularity": "Brand names count as their object. Different objects count separately even if related (scalpel, forceps).",
    "synonyms": "Regional names are one answer (gurney = stretcher = trolley).",
    "ambiguous": ["'bed' and 'hospital bed' are one answer"]
  },
  "general": ["thing", "stuff", "object", "equipment"],     // too general to count
  "notIn": ["ghost", "zombie", "doctor", "patient"],        // common wrong answers (rejected with a reason)
  "answers": [
    { "a": "wheelchair", "al": ["wheel chair"], "p": 0.21, "tier": "common", "src": "ai" },
    { "a": "stretcher", "al": ["gurney", "trolley"], "p": 0.12, "tier": "common", "src": "ai" },
    { "a": "sphygmomanometer", "al": ["blood pressure cuff"], "p": 0.0006, "tier": "obscure", "src": "ai" }
  ],
  "kb": null,                               // or { "domain": "birds", "filter": "all" }: answers also come from a dataset
  "generation": { "by": "...", "stages": ["common", "uncommon", "obscure", "subcategories", "regional", "historical", "aliases", "gaps", "verify"], "date": "2026-11-25" }
}
```

## Fields in an answer
- `a` the canonical answer, lowercase unless a proper noun (proper nouns keep capitals: "Bolivia", "Darth Vader").
- `al` other names for the SAME thing: synonyms, regional names, abbreviations, scientific names, common misspellings that
  are standard variants (e.g. "colour"/"color" is handled automatically; don't list plurals, case or accents: those are automatic).
- `p` estimated share of players (0..1) who would give this answer as one of their three guesses. NOT a share of all guesses.
  Calibration: the top answer to a broad question is usually 0.25-0.50; the 10th most common about 0.03-0.08; things a
  well-read person knows but rarely says 0.001-0.005; specialist knowledge 0.0001-0.0005; truly obscure 0.00002-0.0001.
  Shares across all answers add up to roughly 2.5-2.8 (each player gives up to three).
- `tier` common | uncommon | obscure (your judgement, used for coverage checks).
- `src` ai | dataset:<name> | player | review.

## CATEGORIES
general, geography, history, science, nature, language, entertainment, music, food, technology, sports, everyday,
creative, logic, mythology, literature, maths, people, popculture, arts

## STYLES
category ("Name a bird"), constraint ("Name a country with no coastline"), scene ("Name something in an abandoned
hospital"), association ("Name something that is red"), property ("Name an animal that hibernates"), wordplay
("Name a word that is both a noun and a verb"), then-and-now ("Name something common 100 years ago, rare today"),
role ("Name a job done underwater"), fiction ("Name a fictional character who wears a mask")

## A question is ready only when
- the prompt is clear, grammatical, short, and a newcomer understands it with no explanation;
- there are at least 40 valid answers (a closed set smaller than 40 is too small for a rarity game), with a real long
  tail of legitimate obscure answers;
- the rules let two careful judges agree on any answer (not a matter of taste);
- it doesn't depend on fast-changing facts without a date, on one country's culture, or on spelling tricks;
- it isn't a near-copy of another question (same topic + same answer pool).
