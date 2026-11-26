# Experimental gameplay: round types, themes, routes, chains

Branch: `experiments` (from `deep-life`). Playtest only. **Nothing here is live**, and nothing touches production
rankings, accounts or history: the playtest runs with no database at all.

## How to play it

Use the private playtest page and its **Day ▾** list:

| Days | What |
|---|---|
| 211–224 | **The rotating daily mix**: two weeks of it (see below) |
| 195 | Practice: Sea mines (3) |
| 225 | Prototype: the Deep Signal (community rollover) |
| 226–227 | Prototype: short chains (country → invention, animal → where it lives) |
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
| Risk and reward | decide what your first answer is worth | Keep: its distance **+20%**, question over. Play on: best of three. Risk: beat it later and the **gain over it counts ×1.5**; miss and the question earns **0** | a choice card with the stakes written out |
| Sea mines | the rarest, avoiding two marked popularity bands | as Rarity, except: inside a mine, **0** and the guess is spent; within 2× of a mine, **+25%** | the mines on the sonar strip, and bobbing in the water; they burst quietly when hit |

Details that matter:

- **Rules before the clock, then out of the way.** The first two times you meet a kind of round it opens with a short
  card (rule, band or banned list) and the clock waits for Start. After that the card is skipped: the rule sits in one
  line under the question, with a **?** that brings the full card back (the clock waits while it's open).
- **Forbidden answers** are matched after aliases and spelling, so "bananas", "aple" and other names for a banned answer
  are refused too. A banned answer costs no guess, under the same rule as other misses (three free, then they cost).
  The banned list is each question's most common answers by estimated share. With real history, it would be the real
  top answers.
- **Target types used:** a band ("1% to 3%"), "the most common answer", "as close as possible to 0.5%", and
  "uncommon but not obscure". Targets only score **measured** frequencies. An answer known only from a dataset (still
  being measured) earns nothing in a target round, and says so.
- **Risk** never moves you backwards. In a risk round your first answer is revealed but doesn't move you until you
  choose, so a failed risk simply never adds that distance. Earlier questions are untouched. If the first answer is
  worth nothing there is nothing to stake, so the choice isn't offered. At most one risk round a day.
  - **Why it changed.** The first version (keep = the answer, risk = ×1.5 the better answer) made Keep the best choice
    only 7% of the time in simulation, and Play on was nearly always as good, so there was no real decision.
    `tools/sim/risk.py` plays thousands of questions with players of different skill, using the real answer tables,
    and compared five designs.
  - **Now:** Keep pays **+20%** and ends the question; Risk pays the stake plus **1.5× the gain over it**. In the
    simulation each choice is the best one for a real share of situations (about 38% keep, 27% play on, 35% risk),
    and which one depends on the stake and how well you know the topic: low stakes favour risk, middling ones play on,
    big ones keep. The average day's distance barely moves (+177 m a question against +175 m before).
  - Also looked at and set aside: losing only half on a failed risk (risk became almost always right), ×2 (play on
    nearly vanished), deciding after the second guess (one guess left makes risk nearly always wrong), and pay by the
    risked answer's rarity (hard to explain in one line).
- **Sea mines** are fully visible: two bands of popularity, marked on the sonar before you start (one among familiar
  answers, one in the rare water you aim for). Only measured answers set one off, never an estimate. The skill is
  judging how popular your answer is; the bonus for passing close by makes a near miss worth trying.
- **Rarity and depth stay separate.** The red Unfathomable annotation and the great encounters still depend only on
  the answer's own rarity. A target hit that earns 250 m isn't red unless the answer really is Unfathomable.

## The rotating daily mix

- Each day: **two rarity rounds, a target, a forbidden and one special**. Some days swap the target or the forbidden
  for a third rarity round, so the shape isn't always the same.
- **The special rotates**: risk, wildcard, sea mines, then risk again. Never the same special two days running.
- **The first question is always an ordinary rarity round**, to settle in; the rest are shuffled.
- Everything follows from the day number (a fixed seed in `tools/playtest/experiments.py`), so everyone gets the same
  mix, order, bans, bands and mines. No question repeats within the fortnight.
- In production this would live in the day scheduler (`tools/content`), not the playtest builder.

## Routes, now places you travel to

- Choosing a route slides its place in from the side as you go down, with the water streaming past:
  - **the shipwreck**: a hull on its side, ribs showing where it broke, rust running down, the mast still up, life
    moving in, an anchor and a split crate;
  - **the research station**: modules on a rock shelf with lit windows, a dome, pipes, a turning fan, a tower with a
    blinking beacon and a cable rising out of sight;
  - **the cavern**: walls closing to a narrow way through, teeth of rock, glowing life in the cracks;
  - **the trench**: sheer walls narrowing, vast columns of rock in the distance, the water getting darker.
- Each has its own sounds: the wreck groaning and ticking, the station's hum and beeps, dripping in the cavern, and a
  low, rare call in the trench.
- **Kept:** the dive's depth carries on as before, and routes stay unranked.
- **Not done:** the camera itself doesn't move sideways. The sea is painted only as wide as the screen needs, so a
  real sideways move would show its edge. The place slides in instead. A true sideways journey needs a wider sea; worth
  it only if routes stay.

## Short chains

- **Day 226:** name a country, then something invented there. 12 countries, about 110 inventions.
- **Day 227:** name a wild animal, then a country where it lives in the wild. 22 animals.
- **Only uncontested facts** are listed. Where countries dispute a first (the telephone, the radio, the light bulb, the
  World Wide Web), it's left out.
- **If your first answer has no checked list** (Liechtenstein, the axolotl), the second question falls back to a
  general one and says why. How often that happens is part of the test: the rarity incentive pushes people towards
  answers the table may not cover.
- Unranked, like routes.

## The Deep Signal (community rollover), prototype

- **What it is:** some days carry a community challenge: find a *verified* answer rarer than a threshold (here
  0.05% of players).
- **Fair to everyone, whenever they play:** it is checked once, when the day closes, against everyone's final answers.
  Playing early or late makes no difference.
- **If anyone finds one:** the whole community unlocks something (here: the Lantern Reef, a glowing reef in the
  Midnight Zone, for everyone who dived that day). Finders get a mark in their field journal.
- **If nobody does:** it rolls over and the prize grows. After three rollovers the threshold doubles, so it can't stay
  locked for long.
- **Frequency:** about once a week, so it stays an event, not a chore.
- **No effect on depth or rankings.** No money, no entry, no wager, no countdown pressure.
- **Cheating:**
  - only verified answers count (review happens before anything is announced);
  - a minimum of 2,000 players that day;
  - one account each;
  - scored on the server.
  - Many accounts agreeing to give the same odd answer defeats itself, because it stops being rare.
- **In the playtest:** the home line and the end-of-day panel are real. The overnight check is a button marked
  "Simulate", and no real players are counted.

## Server-side scoring (prototype, local database only)

- **The problem:** the live server scores a dive by adding up each question's best rarity depth. That's right for
  today's game and wrong for mixed days:
  - a target pays for closeness;
  - a banned answer must earn nothing;
  - a mine spends a guess;
  - a risk depends on a choice.
  If the browser worked these out, anyone could send any total.
- **`supabase/0010_round_types.sql`:** the database applies the same rules as `rounds.js`. It takes only:
  - what was typed;
  - which accepted answer it was counted as;
  - which risk choice was made.
  Everything else is worked out on the server. In particular, the stake comes from the server, and a banned answer
  sent as a guess earns nothing.
- **Kept apart:** experimental dives are stored in their own tables, never in `dives`, so they cannot reach live
  rankings, streaks or history.
- **Friends' round outcomes** (who hit the target closest, who risked what) are behind the same spoiler rule as
  everything else.
- **Tests:** `tests/db/rounds.cjs` checks that the database and `rounds.js` agree on 4,000 generated questions (edge
  cases on purpose), and runs a whole dive as a player.
- **Not applied to the live database.**

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
  - **Scoring on the server.** Prototyped in `0010` (above) and tested locally. It isn't live, so mixed rounds must
    not sync to the live account yet.
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

Still to try: a post-game "Which sank deeper?" comparing two real answers, and an "oxygen budget" of guesses for the
whole day on themed days.

## Tests

- `tests/rounds.cjs` (33 checks), all in a real browser on the playtest build. Besides the list below, it covers sea
  mines, short chains, the daily mix, the shortened intros and the Deep Signal.
  - target scoring;
  - forbidden answers and their variants;
  - all three risk outcomes, with the dive never going up;
  - the same order every load;
  - route and chain choices surviving a reload.
- `tests/db/rounds.cjs` (14 checks): server scoring, on the local test database.
- `tests/answers/widen.cjs`: the widened answer lists.
- The existing suites were run again on this branch.
