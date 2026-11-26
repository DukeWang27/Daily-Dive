# Experimental gameplay: round types, themes, routes, chains

Branch: `experiments` (from `deep-life`). Playtest only. **Nothing here is live**, and nothing touches production
rankings, accounts or history: the playtest runs with no database at all.

## How to play it

Use the private playtest page and its **Day ▾** list:

| Days | What |
|---|---|
| 191 | Practice: Rarity target (4 questions, each a different kind of target) |
| 192 | Practice: Forbidden (4) |
| 193 | Practice: Risk and reward (3) |
| 194 | Practice: Wildcards (5) |
| 201–208 | Full expeditions: one of each round type, in a fixed shuffled order. 201 is unthemed; 202 Gaming, 203 Internet Archaeology, 204 Strange but True, 205 Things That No Longer Exist, 206 Science, 207 Sports, 208 The 2000s |
| 209 | Prototype: choose a route halfway (shipwreck, research station, cavern, trench) |
| 210 | Prototype: answer chain (country → native animal → another family) |

Replay and Notes work as before (notes are per question). Your old days are still there.

## Round types

Every round keeps three guesses, the melting-ice clock and the continuous descent: **the dive only goes down**. What
changes is what a good answer is, and so how far it takes you.

| Round | Goal | Distance earned | What you see |
|---|---|---|---|
| Rarity | the rarest verified answer | its depth, as now (0 to about 300 m; beyond only with evidence) | as now |
| Wildcard | the rarest, on a surprising prompt | as Rarity | a "Wildcard" label |
| Forbidden | the rarest, with the obvious answers banned | as Rarity | the banned answers as struck-through chips |
| Rarity target | an answer inside a popularity band | up to **250 m** inside the band; less the further out, measured in multiples (0.1% is as far below 1% as 10% is above it), nothing beyond about 18× out | a sonar strip of popularity with the band lit and a ping for each guess |
| Risk and reward | decide what your first answer is worth | Keep: its distance, question over. Play on: best of three. Risk: beat it later for **×1.5** that answer; miss and the question earns **0** | a choice card with the stakes written out |

Details that matter:

- **Rules before the clock.** Each non-rarity round opens with a short card (rule, band or banned list). The clock
  doesn't run until you press Start.
- **Forbidden answers** are matched after aliases and spelling, so "bananas", "aple" and other names for a banned answer
  are refused too. A banned answer costs no guess, under the same rule as other misses (three free, then they cost).
  The banned list is each question's most common answers by estimated share. With real history, it would be the real
  top answers.
- **Target types used:** a band ("1% to 3%"), "the most common answer", "as close as possible to 0.5%", and
  "uncommon but not obscure". Targets only score **measured** frequencies. An answer known only from a dataset (still
  being measured) earns nothing in a target round, and says so.
- **Risk** never moves you backwards. In a risk round your first answer is revealed but doesn't move you until you
  choose, so a failed risk simply never adds that distance. Earlier questions are untouched. If the first answer is
  worth nothing there is nothing to stake, so the choice isn't offered. One risk round a day.
  - **Expected value:** with ×1.5, risking pays only when you think you have a good chance (about half) of beating
    your first answer by a fair margin. It isn't automatically better than keeping it.
- **Rarity and depth stay separate.** The red Unfathomable annotation and the great encounters still depend only on
  the answer's own rarity. A target hit that earns 250 m isn't red unless the answer really is Unfathomable.

## Fairness

- **Comparable maximums.** Each round's ordinary maximum is close to the others: about 300 m for rarity types and
  250 m for a target. Only a successful risk goes beyond, and that is explicit.
- **The same day for everyone:**
  - Round order is shuffled per day with a fixed seed (`tools/playtest/experiments.py`), so every player gets the
    same order, objectives, bans and targets.
  - Scoring uses the question's fixed reference table.
  - **All frequencies in the playtest are estimates**, from the simulated sample or the hand-written tiers in
    `content/experiments/questions.json`. The results panel already labels them "Estimated".
- **Unverified answers** (pending review) earn nothing in any round, never the maximum. Dataset answers start below
  Unfathomable and can't score a target.
- **Before any of this is ranked:**
  - **Scoring on the server.** `dives`/`dive_guesses` would store each round's type and outcome, and the database
    function that scores a dive would apply the same rules as `rounds.js`. Today the server sums rarity depths only,
    so mixed rounds must not sync to the live account yet.
  - **Frozen reference tables** per day (target bands are only fair against a table that doesn't move during the
    day).
  - **A minimum sample** before target rounds use real counts.

## Themes, wildcards and question writing

- **12 new questions** with full answer lists (`content/experiments/questions.json`):
  - video games before Minecraft;
  - non-human game heroes;
  - shut-down websites;
  - things that went viral before 2015;
  - real events that sound made up;
  - animals that survive what would kill us;
  - inventions before 1900 you used this week;
  - 2000s gadgets;
  - student food;
  - characters who never speak;
  - words you only know from the internet;
  - animals lost in the last 500 years.
- They're written to be screenshot-worthy, and judged against curated lists, not a model's opinion.
- **Themes** name the day (on the home screen and each round's card) and pick its questions. Most days stay
  unthemed.
- **Still to come:** themes changing the environment and the creatures you meet.

## Prototypes (unranked)

- **Routes (day 209).**
  - Halfway down you choose one of four routes; the rest of the day uses that route's questions. The choice is saved,
    so a reload resumes it.
  - Not yet built: the camera travelling to a visible route, route-specific creatures and set pieces, and a fair way
    to compare scores across routes. Until those exist, routes stay out of the ranked daily, as you asked. The
    research also warns that routes split the crowd that rarity depends on.
- **Answer chains (day 210).**
  - The country you name decides the next question (its native animals). The animal you name decides the one after
    (another native animal, from a different family).
  - Built only from a curated table of verified relationships (5 countries, about 75 animals, each with its family),
    with no model-written answers.
  - Players can end up with different difficulty, so it stays a separate mode. The research recommends against the
    full form at scale (validation work, thin crowds); a shared-prompt "chain bonus" is the safer version.

## Social and sharing

- **Built:**
  - The share text marks each round's type (◎ target, ⊘ forbidden, ▲ risk, ✦ wildcard) and the risk outcome
    ("risk paid off" or "risk lost").
  - The share card's rows name the round type.
  - Both stay spoiler-free: no answers, no questions.
- **Designed, not built:** the friends comparison (who hit the target closest, the most creative forbidden answer,
  who risked what). It needs the server changes above. The spoiler gate must live in the database, like the
  existing friends' dives: a function that returns friends' round outcomes only to a player who has finished that
  day. Hiding them in the page isn't enough.

## Research

`content/review/mechanics-research.md` covers about 20 games: Wavelength, Hues and Cues, Fibbage/Guesspionage,
Pointless, Codenames, Just One, Can't Stop, Incan Gold, Balatro, Connections and others. Its sources are search
excerpts only; direct fetches were blocked.

What it says about this design:

- **Rarity Target:** the most original of the four, and closest to proven fun (Wavelength). Partial credit by
  distance (done here) and a clear dial (the sonar strip) are what make it work.
- **Risk and reward:** it assumed a failed stake cost nothing. Here it costs the whole question, and the stake is
  shown before you decide.
- **Forbidden Answers:** banning plurals and variants (done here) is the key rule.
- **Stacking every twist into one day** may be too much to read. This is why the practice days exist: judge each
  mechanic alone, then the full mix.

What to add next:

- "Sea mines": hidden banned answers that explode when found.
- A personal jackpot that rolls over between days.
- A post-game "Which sank deeper?" comparing two real answers.
- An "oxygen budget" of guesses for the whole day, for themed days.

## Tests

- `tests/rounds.cjs` (20 checks), all in a real browser on the playtest build:
  - target scoring;
  - forbidden answers and their variants;
  - all three risk outcomes, with the dive never going up;
  - the same order every load;
  - route and chain choices surviving a reload.
- `tests/answers/widen.cjs`: the widened answer lists.
- The existing suites were run again on this branch.
