# Editorial framework

How questions are written, judged and combined. It contains no questions or answers: those live in the private
content store. `BRIEF.md` (how to build an answer list) and `SPEC.md` (the file format) still apply; this sits above
them and decides *which* questions are worth building at all.

## 1. What a good question is for this game

The game is five questions, three guesses each, and an answer scores by how few **real players** gave it. So the
question is not a quiz with one right answer; it's a space to search. A good question:

- **has an obvious first answer** most people find in five seconds,
- **has a path to better ones**: the second and third guesses should feel like digging, not luck,
- **has a deep, legitimate tail** a specialist, a reader, a gamer or someone from another country can reach,
- **is fair to check**: two careful judges would agree on almost every answer,
- **is worth talking about afterwards** ("you said *what*?", "how did nobody else think of that?").

The test we apply to every candidate: *imagine three friends playing it. Do they get a first answer, then think,
then find something surprising, and want to compare?* If not, it isn't one of ours, however clever it sounds.

## 2. The house voice

A curious friend asking you something across a table: never a worksheet, never a quiz show host.

- Short. Readable in two seconds under a melting clock. Twelve words is a hard ceiling; under nine is the aim.
- Plain words. No "which of the following", no "identify", no stacked qualifiers.
- **Vary the shape.** At most four in ten prompts may start "Name a". Others ask ("What do people put on toast?"),
  describe ("Something sticky"), or **seed** (below).
- **The seed.** For lateral and connection questions, open with one example that shows the leap, then ask for
  another: *"You can catch a cold. What else can you catch?"* The seed itself never counts. It makes an unusual
  question understandable in one reading, and it is the most recognisable thing about our questions. Use it on
  roughly one question a day, not more, or it becomes a tic.
- Humour comes from the subject (things people talk to; what ends up at the bottom of a bag), never from jokes in the
  wording.
- Restrictions a player needs to know go in the prompt in a few words ("...but isn't a bird"); everything else goes in
  the rules shown on request.

## 3. Formats and the daily mix

| Format | What it rewards | Starting share | Validation route |
|---|---|---|---|
| A. Lateral | seeing an everyday thing from a new angle | ~20% | curated sense list (idioms, collocations) + review |
| G. Unexpected connection | linking two worlds (sport and speech, food and colour) | ~10% | dataset or etymology source |
| B. Interesting general knowledge | broad knowledge with a twist | ~20% | dataset or reference list |
| C. Rewards obscure knowledge | depth: specialists go very deep | ~15% | dataset (Wikidata, IOC, Ethnologue...) |
| D. Human and relatable | shared everyday life; best compared with friends | ~15% | curated list; unknown answers wait for review or crowd agreement |
| E. Culture | film, music, TV, games, books, across eras and countries | ~15% | databases (Wikidata, MusicBrainz) |
| F. Wordplay | vocabulary and spelling | inside A/G/C | **deterministic**: a dictionary checks it exactly |
| T. Traditional category | a plain "Name a ..." | ~5% | dataset |

A day is **curated, not templated**: usually an accessible opener, something lateral or connective, a knowledge
question with a twist, something human or cultural, and one that lets a specialist go very deep. The scheduler
enforces only the floors (one accessible question, one deep one, no repeated format or subject area in a day,
nothing that shares answers or wording with the last few weeks); the editor chooses the order.

**Ocean questions** (deep-sea animals, ships, things that live for centuries) are the house flavour: about one every
other day, never forced.

## 4. The pipeline: easy to propose, hard to approve

1. **Generate** many more candidates than needed, across formats (`generate.mjs ideas`, or writers following `BRIEF.md`).
2. **Screen** (editor, minutes per candidate). Reject on sight: generic category without a twist; a near-copy of
   something already used (`build.py` finds these) or of another game's well-known prompts; opinion questions
   ("something beautiful"); fewer than ~40 legitimate answers; one dominant answer; a prompt over twelve words.
3. **Explore answers** (`generate.mjs answers`, nine stages in `BRIEF.md`): common, uncommon, obscure, creative but
   legitimate, other names, ambiguities, exploits.
4. **Criticise independently.** A separate reviewer (person or model) who did not write the question tries to break
   it: boring, ambiguous, unfair, culture-bound, exploitable, too like another day's question.
5. **Revise** the fixable ones. A good idea with weak wording is rewritten, not dropped.
6. **Validation gate** (below). Fails here are rejected however fun the question is.
7. **Select** the strongest against the scores in section 5.
8. **Compose days** (`build.py schedule`), then a human looks at each week as a whole.

## 5. Judging a question: gates, then scores

**Gates (any failure rejects or sends back):**

- G1 *Answer pool*: at least ~40 legitimate answers, with at least ~15 that very few people will think of.
- G2 *Checkable*: there is a named validation route (dictionary, dataset, reference list, curated list with review).
  If validity would rest on a model's opinion, the question fails.
- G3 *Unambiguous*: the rules settle the edge cases two judges would argue about.
- G4 *Not exploitable*: typing a random obscure word can't easily be valid (open "anything" questions fail).
- G5 *Fair*: doesn't depend on one country, generation or franchise; nothing offensive or distressing.
- G6 *Readable*: twelve words or fewer, understood in one reading.

**Scores (1-5 each), used to rank what passes:** entertainment, originality, accessibility of the first answer,
depth of the tail, the path between them (three-guess fit), memorability, discussion value. A question needs at
least 4 on entertainment *and* on three-guess fit; high averages don't rescue a dull question.

Each decision is written down with its reason (`cms.py approve|reject <id> "<reason>"`).

## 6. Breadth is not depth (the rule the first review taught us)

Rarity scoring plus a huge answer list rewards typing *any plausible obscure entry* rather than having a good idea:
if every insect species is valid, "caddisfly" scores like a genuine insight. Every question is checked for this:

- **Notability, not existence.** Named things (songs, bands, animals, people) must have a Wikipedia article or a
  chart entry, not merely appear in a database of millions.
- **Group the long tail when its members are interchangeable.** If any illness, any insect or any plastic item would
  do, they count as one answer. Keep separate answers only where telling them apart takes knowledge or wit.
- **Common words for word puzzles.** Wordplay answers must be in the ~30,000 commonest words, so the challenge is
  finding a surprising word, not a legal one.
- **Group synonyms in fixed lists** for everyday actions ("stir", "stirring", "mix" are one answer), decided in
  advance, never by a model at play time.
- **Rules never contradict the prompt.** If the prompt doesn't exclude something, it's valid. A player must never
  give the obvious answer and be told it didn't count.
- **English-first.** Wordplay and British/American questions need near-native English; keep them to about one a
  day while the game is English-only.

## 7. Validation by format

- **Deterministic (wordplay):** the dictionary decides. Fully automatic, no review needed.
- **Dataset-backed (knowledge, culture):** listed answers plus a dataset. Unknown answers go to the AI check only for
  *facts* ("was the Royal Game of Ur a board game over 100 years old?"), with a confidence floor, and to review below it.
- **Curated (lateral, connections):** a list of accepted senses compiled from dictionaries of idioms and
  collocations. Unknown answers go to review, never auto-accepted by a model.
- **Human/relatable:** a curated list. An unknown answer is *pending* (no depth, no penalty). It becomes valid when
  review accepts it or when enough unrelated players give it independently; either way it can never jump straight to
  great depth on one person's say-so.
- Rarity is separate from validity everywhere: a newly accepted answer gets a provisional depth with the caps in
  `CONTENT.md`, then real player counts take over.

## 8. Learning from players

Signals per question, read with care rather than as targets: share of players with at least one valid answer;
guesses used; time to first answer; pending and dispute rates; autocorrect rate; how concentrated answers are
(the share of the top three); how many distinct valid answers appear; whether players finish the day.

- A long time to answer is not bad on its own; good questions make people think.
- A very high completion rate is not proof of fun.
- The most useful single signal is **answer spread**: many distinct valid answers with a long tail means the question
  works as a rarity question. A question where three answers take 80% of players is a bad fit, however popular.
- Optional feedback: after the day (never after each question), one tap on any question: "great question" or
  "unfair". Counts only; no free text in the first version.
