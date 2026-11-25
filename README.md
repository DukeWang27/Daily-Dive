# Iceberg

**Three guesses. How deep can you go?**

A daily guessing game. Five questions a day, three guesses each, 20 seconds a question. Every guess is revealed on the iceberg at once:
the fewer players who share your answer, the deeper it sits. Only your deepest answer per question counts, and a
later, shallower guess never takes it away. Your score is depth in metres, added up over the five questions.

Two ways to play, side by side in the header: **Daily Dive** (the five questions above, the same for everyone each
day) and **Submarine Race** (live races against other players). Everything else, from the dive log, friends,
rankings and settings to sign-in and How to play, is in the menu at the top right. The title screen keeps to the essentials: the name,
the premise in two lines, Play, and today's status (day, streak, time to the next dive). The six depth zones and the
full rules are in How to play.

There are 15 days of questions in the bank (75 questions). Everyone gets the same five on the same day, a new set
appears at each player's local midnight, and after day 15 the calendar starts again from day 1 until more are added.

## The rules in full

- **Depth.** An answer that 1 in 10 players (or more) give sits above the water at 0 m. Every 10 times rarer is
  100 m deeper: 1 in 100 is 100 m, 1 in 1,000 is 200 m, 1 in 10,000 is 300 m.
- **Zones.** The Tip (above water), Shallows (to 50 m), Midwater (50 to 100 m), The Deep (100 to 200 m),
  The Abyss (200 to 299 m), and **Unfathomable**, beneath the iceberg itself (300 m and deeper).
- **Beneath the iceberg.** The iceberg holds everything down to 1 in 10,000 players. An answer rarer than that
  leaves the ice: the camera takes a long, slow descent past the iceberg's tip into the dark open water below, the
  answer is annotated in red, and the colossal squid comes up out of the dark beside it. It only counts as
  Unfathomable with evidence: at least 3 players in the rarity table's sample (today 120,000 simulated players per
  question) must have given it. Anything rarer than the sample can show stops at 299 m, at the very bottom of the
  iceberg, because "nobody in 120,000 said it" can't be told apart from noise. Unknown answers, answers waiting for
  review and answers approved by review never get there. About 1 in 8 accepted answers can reach it, almost always
  obscure ones; most players will never see it.
- **Score.** The depth of your deepest recognised answer on each question. The day's total is the five added up.
- **What uses a guess.** A recognised answer, or an unknown answer you choose to send for review.
- **What doesn't.** Repeating an earlier answer (including by another name). Answers that don't count, for the first
  three per question; after that each one uses a guess, so the box can't be used to fish for hints.
- **Time.** Each question has 20 seconds of thinking time, shared by its three guesses and shown as a melting
  icicle beside the answer box. The clock only runs while you can type: it stops for every reveal and camera move.
  It is measured against the real clock, so reloading or leaving the page never hands time back. When it runs out
  the question ends and your deepest answer so far counts. Change `QUESTION_SECONDS` at the top of `game.js` to
  try other lengths (0 turns the timer off).
- **Finishing early.** After any guess you can finish the question with what you have. The button shows the depth
  you keep and how many guesses go unused.
- **Shares.** A share is the fraction of players who gave that answer at least once in their three guesses, so the
  shares of all answers add up to more than 100%.

## What works today, and what needs a server

| Works now, with no server | Needs the free database (Supabase, see `BACKEND.md`) | Needs the review function (`api/verify.js`) |
|---|---|---|
| The whole game: guessing, the timer, the per-guess dive, wildlife, sound, results, share card and text | Accounts: sign-in, usernames, progress on any device | Unknown answers checked while you play |
| Instant answer checking: about 20,000 answers and 12,000 other names across the 75 questions | Friends, daily rankings, exploring and comparing friends' icebergs | An approved answer getting its depth during the same question |
| A dive log on the device: streak, records and a year calendar | Real player counts in place of sample statistics | A shared list of reviewed answers so every player gets the same verdict |
| Reopening any earlier dive played on the device | A shared queue of unknown answers and disputes for you to review | |
| A game in progress survives a reload | | |

Until the database is connected, every share and player count is **sample data** and the game labels it that way,
on the results screen and on the share card. No ranking, friend or other player is ever shown without real data.
(Adding `?demo` to the address shows the social screens filled with invented players, each screen labelled
"Demonstration data". It is for looking at the design and is never offered on the live game.)

## Files

| File | What it is |
|---|---|
| `index.html` | The page: layout and styling for every screen |
| `game.js` | Game flow: guesses, scoring, results, disputes, saving progress, streaks. Settings are at the top |
| `validate.js` | Answer checking (see "How answers are judged") |
| `brand.js` | **The game's name**, mark, tagline and search text, in one place (see "The name") |
| `brand.html` | A review page showing the five candidate names in the game's style, with what was checked about each |
| `iceberg.js` | The artwork, the depth scale, and the full-screen scene players explore (camera, markers, annotations, depth gauge) |
| `icetimer.js` | The melting-icicle timer's artwork |
| `account.js` | Sign-in and every question the game asks the database |
| `social.js` | Dive log and calendar, friends, rankings, settings and sign-in screens |
| `viewer.js` | Exploring a finished dive, replay, and comparing two dives |
| `demo.js` | Invented, labelled players for previewing the social screens (`?demo`) |
| `race.js` | **The submarine race**: the ocean scene, camera, lobbies, live questions, round summaries and results |
| `subs.js` | The racers' pixel-art submarines (eight colours, three hull designs), built from parts |
| `race/1001.json` … | The race's own question pool (29 questions, separate from the daily bank), and `race/index.json` |
| `vendor/supabase.js` | Supabase's browser library (MIT), only loaded when a database is configured |
| `BACKEND.md` | **How to switch on accounts, friends and rankings**, and what is and isn't protected |
| `supabase/` | The database: `0001` play counts, `0002` accounts and all access rules, `0003` the rarity tables, `0004` the race, `0005` the race's rarity tables |
| `tools/seed_answers.py` | Turns the day files into the `0003` rarity tables |
| `tools/race_questions.py`, `tools/build_race.py` | The race question pool, and the builder that writes `race/` and `0005` |
| `tools/sounds.html` | Every sound on one board with buttons, for listening to them |
| `wildlife.js` | The animals: one entry per species, how each is drawn and moves, and the rare encounters |
| `colossal.js` | The colossal squid, drawn and lit pixel by pixel every frame (mantle, fins, eye and light organs, eight hooked arms, two clubbed tentacles) |
| `tools/colossal.html` | The squid enlarged, in reference light or in the dark with a light you move, for judging the artwork |
| `tools/wildlife.html` | Every animal on one sheet, enlarged, for checking the artwork |
| `share.js` | The share card image and the plain-text share |
| `audio.js` | All sound, made live in the browser. No audio files |
| `sea.js` | The animated sea behind the home and results screens |
| `icons.js` | Category icons (one custom style, no emoji) |
| `days/1.json` … `days/15.json` | One file per day: that day's five questions with answers, other names, rules and sample shares. `days/0.json` is a fixed set used only by the tests |
| `days/index.json`, `words.json` | How many days exist, and a list of common English words used by the typo checker |
| `tools/questions.py` | **The question bank and the calendar.** Every question, its rules and word lists, and which five appear on which day |
| `tools/build_days.py` | Turns the question bank into the `days/` files |
| `tools/build_categories.py` | Word lists for the first five questions, and helpers the builder shares |
| `api/verify.js`, `package.json` | The answer review function (optional) |
| `tests/` | Automated play-through checks |
| `screenshots/` | What each screen looks like |
| `backup-timed/` | The earlier timed version (20-second rounds), kept for reference. Not linked from the game |

## Run it on your computer

Any static web server works:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000. Opening `index.html` directly as a file won't load the question files.

Handy while testing: add `?reset` to the address to clear today's game on this device and play again, and `?fast`
to speed the camera up. There is no practice mode for players; for testing or recording, add `?practice` and Play
starts an uncounted dive with today's questions even after the day is done.
To preview another day's questions, use `?test&day=7` (any number from 1 to 15).

## Put it online (Vercel)

1. Push this folder to a GitHub repository.
2. On vercel.com, sign in with GitHub, choose **Add New → Project**, pick the repository, leave the settings as they are and click **Deploy**.
3. You get a link like `iceberg-yourname.vercel.app` to send to friends.

Vercel's free Hobby plan is for personal, non-commercial use, which is fine for testing with friends. Before adding
ads or paid features, move to Vercel Pro or a host whose free plan allows commercial use.

Any other static host (Netlify, Cloudflare Pages, GitHub Pages) also works for the game itself. Only
`api/verify.js` is written for Vercel's function format.

## Accounts, friends and rankings

Setting these up is covered step by step in **`BACKEND.md`**, along with what is protected and what still needs
doing before a public launch. In short:

- **Guests first.** Nobody has to sign in to play. After a guest's first dive the results screen offers, once and
  quietly, to save it to an account. Days already played on the device move across, and a day is never counted twice.
- **Accounts.** Email and password (any address, Gmail included; Google sign-in is postponed), password reset, a unique username, one of the game's animals
  as a picture, privacy switches, account deletion.
- **Dive log.** Streak, longest streak, total expeditions, average, personal record, deepest discovery, and a
  year calendar: one square a day, brighter for a deeper day, ringed in pale green for an answer in the Abyss.
  Choosing a day shows its details and reopens that iceberg.
- **Friends.** Find by username, request, accept or decline, remove, block. The list shows who has finished today
  and, once you have too, who is ahead and by how much.
- **Rankings.** Each day's ranking of everyone with an account, and of you and your friends. Ordered by total
  depth; equal totals are split by the deepest single answer, then by who finished first.
- **Exploring a friend's iceberg.** Their finished day on the real scene: the whole dive at once, then question by
  question, guess by guess, with the original annotations; or a replay. **Compare** puts both players' deepest
  answers on one iceberg, yours solid and theirs hollow.
- **No spoilers.** Other players' answers, scores and icebergs for a day stay closed until you have handed in your
  own dive for it. The database enforces this, not the page.

How scoring works with a database: every answer's share and depth come from that day's **rarity table**, which is
fixed when the day is published and loaded into the database by the `0003_answers_*.sql` files. An answer is worth
the same to everyone whenever they play, and a finished iceberg never shifts. The results panel shows today's real
counts once 30 players have answered a question; until then it shows the sample figures, labelled.

## Answer review (optional)

With only three guesses, wrongly rejecting a real answer matters. `api/verify.js` is a small server function that
judges unknown answers with Claude and remembers its verdicts.

1. Do the Supabase steps above (the function stores verdicts in the `verified_answers` table).
2. In Vercel, open **Project → Settings → Environment Variables** and add:
   - `ANTHROPIC_API_KEY`: a key from console.anthropic.com
   - `SUPABASE_URL`: your project URL
   - `SUPABASE_SERVICE_KEY`: the **service_role** key from Supabase's API settings
   - optional `VERIFY_MODEL`: which Claude model judges answers. The default is `claude-opus-5-5`. A smaller model
     such as `claude-haiku-5-5` costs far less and is worth trying for a task this simple
   - optional `ALLOWED_ORIGIN`: your site's address, so other sites can't call the function
3. Set `verifyUrl: "/api/verify"` in the `BACKEND` line of `game.js`, then commit and push.

These keys live only in Vercel's settings. Never put them in `game.js` or any file in this folder: everything here is
sent to players' browsers.

What happens to an answer the game doesn't know:

- The first Enter only warns: "isn't on today's list", or "Did you mean snake, snack or sneak?" for an unclear typo.
  Nothing is used yet, so a slip can be fixed.
- A second Enter sends it. It takes one of the three slots and shows as pending, with no depth and no rarity.
- Without the review function it stays pending and is saved for you to review later.
- With it, the function checks the shared list first, then asks Claude. Approved: the answer is revealed on the
  iceberg at 52 m (Midwater), never the maximum, until enough real players have given it for a count-based depth.
  Rejected, or the same as an earlier guess: the slot stays used and shows the reason.
- Verdicts are remembered, so the next player (and the same player on a later day) gets an instant answer. A pending
  guess that is approved later updates that question's score the next time the game is opened, as long as that
  day's game hasn't been finished yet.

You can overrule any verdict by editing its row in `verified_answers` and setting `source` to `human`.

Before a public launch, add a rate limit in front of the function (Vercel's firewall can do this), because each new
answer costs a small amount.

**Tested so far:** the game's side (sending, pending slots, approved, rejected and same-as verdicts, remembered
verdicts, a dead service) against a stand-in service; the function's logic against a stand-in for Claude; the
database setup on PostgreSQL 16, as a fresh install and as an upgrade.
**Not tested:** a real call to Claude, or a real Supabase project. No keys were available while building this.

## How answers are judged

Checking happens in the browser in a few milliseconds, in this order:

1. **Category rules.** Too-general words ("mammal", "vehicle"), known wrong answers ("boat" for wheels) and, in the
   word questions, words that don't fit the letters don't count.
2. **Known names.** The answer list plus other names for the same thing: synonyms (car, auto, automobile), regional
   names (pram, stroller), breeds and varieties (poodle counts as dog, Granny Smith as apple), models (Mustang counts
   as Ford) and word forms in word questions (snapped counts as snap).
3. **Describing words.** "Red car" is car. "Teddy bear" is not a bear.
4. **Typos.** One wrong letter in a 5 to 8 letter word, two in longer ones, including swapped letters. A clear typo
   is corrected and the game says so ("Counted as snorkel"). An unclear one asks which answer was meant. A real
   English word is never "corrected" into something else, so "house" does not become "horse".
5. **Reviewed answers** remembered from earlier.
6. Otherwise: obvious gibberish doesn't count, anything plausible can be sent for review.

Capitals, accents, punctuation, "a/the" and plurals never matter. The limit on how many vehicle makes could score
is gone: it existed to stop answer farming in the timed game, and three guesses make it unnecessary.

The lists come from hand-written core lists, the WordNet dictionary (for example every bird, tool or instrument it
knows) and, for word questions, two English dictionaries. Each question's rules are shown to players under "How
answers are judged" on the results screen. Word questions ("ends in OCK") accept one word only, fold plurals and verb
forms into the base word, and don't accept names of people, places or brands.

## How the daily questions work

- `LAUNCH` at the top of `game.js` is the date of Daily #1 (24 November 2026). The game counts days from there using
  each player's own clock, so a new day starts at their midnight.
- Day N loads `days/N.json`. After the last file the game loops back to `days/1.json`; the "Daily #" number keeps
  counting, and each day's statistics are filed under that number.
- Within a day the order is mixed, and the word question never comes first.
- An unfinished game from yesterday is not carried over: the new day starts fresh.

### Adding more days

Open `tools/questions.py`. Each question is one `add(...)` block: its key, title, icon, the question, a hint, the
rules players see, and where its answers come from (a hand-written list, a dictionary category, or a letter pattern).
The calendar is the `DAYS` list at the bottom: one row of five keys per day.

1. Write five new questions with new keys (a key is never reused: saved verdicts and statistics are filed under it).
2. Add their keys as a new row in `DAYS`.
3. Rebuild and push:

```bash
pip install nltk wordfreq english-words numpy
python3 tools/build_days.py
```

The first run downloads the WordNet dictionary. A full rebuild takes about two minutes; to rebuild only the days
containing certain questions, name them: `python3 tools/build_days.py birds qu`.

What makes a good question: wide enough for at least 40 or 50 answers, narrow enough that not everything is rare
("Name a bird" works better than "Name an animal"), and with a few answers nearly everyone thinks of. For each
question, `top` lists how readily the most typical answers come to mind; that drives the sample statistics until
real players replace them. Icons come from `icons.js`; word questions use `letters:QU` style icons automatically.

A small list of rude words (`HIDE` in `build_days.py`) are still accepted where they are real answers, but are never
shown on the "most common" or "rarest" boards.

## Sample data

`tools/build_days.py` simulates 120,000 players of the three-guess game per question to produce the sample shares.
Each simulated player can think of some answers (the obvious ones more often), takes one to three guesses, and picks
in one of three styles: the obvious answers, any of them, or the rarest they know. A share is the fraction who gave
an answer at least once, shown as counts out of 50,000. The most common answers come out around 10 to 30% and the
shares add up to about 2.7 guesses per player.

## The scene

While you play, the scene fills the whole window. The question, the box and the three guesses float over the water
(to the left on a wide screen; question at the top and box at the bottom on a phone). After the third guess a
results panel slides in from the right (from below on a phone) and the iceberg moves aside for it.

Each answer gets a marker on the ice at its exact depth, and an annotation drawn out from it by a thin line: the
answer, the share of players, the depth, how rare that is, then the guess number and player count in small print.
There is no card behind it. The depth gauge down the right edge is fixed to the water, and its reading follows the
camera. One colour, a pale "living light" green, is kept for things you have earned: your deepest answer, an answer
in the Abyss, a rare animal.

### Moving through it

Ordinary things are quick; only real discoveries take their time. One set of timings and curves is used
everywhere (`--ease-out`, `--t-move` and friends at the top of `index.html`; the camera's in `iceberg.js`):

- **A guess** starts moving within a few hundredths of a second and lands in about three quarters of one. Typing
  the next guess and pressing Enter while the last is still travelling is fine: the reveal finishes quickly and the
  new guess goes in by itself.
- **After the third guess** the results follow about 0.4 s after the answer lands (0.8 s for a rare one, 1.4 s for
  one beneath the iceberg, so the find gets its moment). Enter brings them at once.
- **Next question** starts the moment it is pressed: the results slide away, the answers fade, and the camera rises
  back to the iceberg's tip while the next question comes in, in about 0.8 s. The box takes typing straight away;
  the clock starts only once the camera has arrived. From beneath the iceberg the dark closes in and lifts again
  just under the surface instead of making you watch the whole climb.
- **Skipping:** during a long reveal (the descent beneath the iceberg above all), a tap on the water or Enter,
  Space or Escape brings it to its end in about a quarter of a second. Not in races, where everyone shares one clock.
- **Waiting for something** (the day's questions on a slow connection, signing in) is always shown where it
  happens: the button says what it is doing, with three small rising bubbles, and can't be pressed twice.
- **Reduced motion:** camera journeys become cuts and nothing slides.

What used to make it feel slow, and was fixed at the source (measured with `tests/perf.cjs`): a fixed 1.9 s wait
(3 s after a rare answer) before the results; a zoom-out and 1.35 s push-in before every question; the audio
engine and the scene being built in the same tap as Play (now prepared while the home screen is idle); and a live
blur behind the results panel and answer box that the browser had to redo on every frame of the moving water
(results ran at about 38 frames a second; now 60).

### Wildlife

Every animal is a real species, drawn by code as pixel art at the same pixel size as the iceberg, so there is
nothing to license. Each keeps to its own depth, and they stay in the world rather than on the screen: travel down
and back up and you pass the same ones.

| Game depth | Who lives there |
|---|---|
| Sky and Shallows (to about 60 m) | little auks, a harp seal, capelin and polar cod in shoals, Arctic krill, moon jellies |
| Midwater (about 45 to 150 m) | glacier lanternfish with lit bellies, Arctic comb jellies, a lion's mane jellyfish, a siphonophore, armhook squid |
| The Deep (about 110 to 250 m) | humpback anglerfish, Sloane's viperfish, dumbo octopuses, a Greenland shark far off |
| The Abyss (below 190 m) | hadal snailfish, flashes of glowing plankton |

The game's depths are its own scale, not real metres, and the cast is drawn from cold and deep water worldwide
rather than one real place (the colossal squid, for one, is Antarctic). Each entry in `wildlife.js` records the
animal's real range.

**Encounters.** Three animals are not residents. They come only when an answer reaches a set depth, once per
question, and pass behind the iceberg while the annotation notes it:

| An answer at | Rarer than | Brings |
|---|---|---|
| 200 m or deeper | 1 in 1,000 players | a giant squid |
| 250 m or deeper | about 1 in 3,000 | a bigfin squid |
| 300 m or deeper | 1 in 10,000 | a colossal squid |

The depths are the `min` values in the `ENCOUNTERS` list in `wildlife.js`.

**Keeping it calm.** Animals steer round the annotation, fade if they pass behind it or under the controls, and
slow down while an answer is being revealed. Players who have asked their device for reduced motion get the animals
as a still picture. The settings panel (speaker button) has a **Calmer water** switch that halves the number of
animals and lights, and the game switches to it by itself if drawing turns out to be slow on a device.

**Adding an animal.** Add one `define({ ... })` entry to `wildlife.js`: its name, where it really lives, its depth
band (`zone`), how many share a wide screen (`n`), and three small functions: `make` (where it starts), `step` (how
it moves) and `draw`. Open `tools/wildlife.html` to see it enlarged.

**Sightings.** The game quietly records which animals each player has seen (in the browser, under
`iceberg:sightings`), lists a few on the results panel, and shows a count at the end of the day. There is no
collection screen yet; `Wildlife.species()` and that record are what one would be built from.

## Submarine race

A live race against other players, separate from the daily game. Open it from **Submarine race** on the home
screen. It needs the database and an account (so everyone in a race is a real person); there are no bots.

- **How it plays.** Everyone gets the same question at the same moment, with three guesses each and one clock for
  all (20, 30 or 45 seconds). Each racer's submarine descends from the iceberg's waterline. Only your rarest answer
  on each question counts, and the submarine moves by the *improvement* only: 30 m, then a 180 m answer moves you
  150 m more, then a 420 m answer 240 m more, to 420 m in all. A shallower guess doesn't move you. Deepest at the
  end wins (ties: deepest single answer, then questions won, then whoever got there first).
- **The ocean.** Past the iceberg into twilight water, the cliffs (from about 750 m), the canyons (1,300 m), the
  abyssal plain (2,100 m) and the trench (3,100 m), with the daily game's animals along the way. The camera follows
  your own submarine down and never zooms out to fit everyone: other racers show with their name and depth, as a
  marker at the edge of the water when they are out of view, and on the race map at the side. You get a note when
  you pass someone and when you enter a new region. A very rare answer brings a large animal past your submarine.
- **Ways in.** *Quick race* matches you with whoever is waiting (2 to 8 players; it starts by itself 15 seconds
  after a second racer arrives, and shows how many are waiting). *Race with friends* makes a private room with a
  six-letter code and an invite link; the host picks Sprint (5), Standard (10) or Expedition (15) questions, the
  time per question and the number of racers, invites friends, and starts once everyone is ready. *Warm up
  alone* is a 5-question race on your own that isn't counted.
- **Between questions** everyone's deepest answer is shown for a few seconds. **Results** show the winner, places,
  distances, deepest answers and questions won, a table of everyone's best answer per question, **Explore** (each
  racer's expedition opens in the dive viewer), rematch, play again, leave and add friend.
- **Fairness.** The database runs the race: the clock, which question is live, the three-guess limit, the scoring,
  and who may see what. Nobody's answers are sent to anyone else until the question has closed, and a guess after
  the deadline (plus 1.5 seconds for the network) is refused. Answers are judged in the browser for speed and
  checked again by the database (the same check the daily game now uses).
- **Unfathomable in a race.** One answer of 300 m or deeper is an Unfathomable find, as in the daily game; a big
  total built from ordinary answers is not. The finder's submarine lights up red, the colossal squid rises beside it
  (lit only by the submarines' lamps), and every other racer immediately sees a note and the red light round that
  submarine, but not the answer. None of it pauses or slows the clock.
- **Kept apart.** Race questions come from their own pool (`race/`, ids 1001 and up), and races never touch daily
  scores, streaks, rankings or calendars. A profile shows a separate race record (races, wins, furthest).
- **Connections.** Each browser asks the database for the race every second, and a Supabase Realtime broadcast
  nudges everyone to ask at once when something changes. Submarines glide between updates. Reloading or losing
  the connection puts you back into the race you were in; a racer who has gone quiet for 20 seconds is shown faded
  and stops holding up the question; if the host leaves, the longest-waiting racer becomes host; a race with
  nobody left closes after 90 seconds.

## The name

**Recommended: Nero Deep** (see `BRAND.md` for the research and the identity). Until that is approved, the game is still called Iceberg. Everything that names it (header, home page, browser tab and icon, search-engine
text, share card, share message) reads from `brand.js`, so renaming is one line: change `DEFAULT` at the top of
that file to another entry, or add an entry of your own.

To see a name in the real game without changing anything, add `?brand=` and its key to the address:
`?brand=nerodeep`, `meteordeep`, `fathomfive`, `trieste`, `sirenadeep` (this round's finalists), or the earlier
`mariana`, `marianadeep`, `isobath`, `oddfish`, `brinicle`, `dropstone`, `thirddive`, `hadal`. Each name has its own
link preview image in `og/` (redraw them with `node tools/og.cjs`). Saved progress uses a fixed internal key, so renaming never loses anyone's streak.

## Sound

All sound is generated by `audio.js`, so there is nothing to license. It starts on the player's first tap or key
press, as browsers require. The speaker button in the header has a mute switch and separate sliders for effects and
ambience; the choices are remembered on the device. The game is fully playable muted or in a browser with no audio.
The underwater ambience follows the camera: open and airy near the surface, a low hum in the deep. A rare encounter
has its own quiet cue: two slow, falling calls from far off. Beneath the iceberg the ordinary ambience fades out and a very low, slowly beating resonance takes over, with a
distant sonar pulse now and then; the descent, the red answer and the colossal squid each have their own sound (no
animal calls or monster noises: pressure, moving water, a struck bell, sonar). The race adds its own sounds: racers arriving and
leaving, ready, the countdown and start, the engine pushing the submarine deeper (bigger for a bigger gain), passing
or being passed, a new region, the question closing, the standings, and the finish. `tools/sounds.html` plays every
sound from buttons. They were checked by measurement (level, length, no clipping), not yet by ear.

## Sharing

The end screen draws a 1200 × 1500 image of your iceberg with the five depths marked, and offers it as a PNG (on
phones, through the share sheet where the browser supports it). The text version is one bar per question. Both show
depths and zones only, never answers or questions.

## Tests

Nine sets of checks, all run against the real code:

- **`tests/home.cjs`** checks the title screen and navigation at five screen sizes: 127 checks. Everything on one
  screen without scrolling, no frame round the iceberg, its tip clear of the words, both modes in the header, no
  Practice Dive in view (but `?practice` still works), How to play (all six zones, Escape closes it), the menu and
  where each item goes, the race landing and its fleet, switching modes, the modes stepping aside during a
  question, reduced motion, and no "null" or "undefined" anywhere.

- **`tests/matrix.cjs`** plays the game in a real browser: 255 checks. Three rarer answers in a row, the
  rarest first, duplicates, typos, invalid and pending answers, review verdicts, finishing early, all five
  questions, reloading at every stage, sound on, off and unavailable, seven screen sizes, the calendar of days,
  wildlife by depth, encounters, annotations, reduced motion, frame times, trial names, and the timer.
- **`tests/db/run.cjs`** checks the database rules on a real PostgreSQL database: 90 checks. Usernames, direct
  table access, server-side scoring and the server's answer check, one dive a day, streaks, guest progress, friends,
  blocking, the spoiler rule, privacy, rankings and ties, deleting an account. Needs PostgreSQL installed;
  `sh tests/db/setup.sh` builds a throwaway database first.
- **`tests/db/race.cjs`** checks the race's database rules: 57 checks. Matching, codes, seats, the host, ready
  states, settings, the clock, the three-guess limit, late guesses, scoring by improvement, answer secrecy,
  disconnects, results, rematches, invitations, and that races leave the daily game alone.
- **`tests/social.cjs`** runs the account and social screens in a real browser against that database: 100 checks.
  Signing up, guest progress, friends, what is hidden before diving (including requests made by hand), rankings,
  exploring and comparing dives, best-of-three scoring end to end, the calendar, privacy, a second device,
  blocking, a Gmail sign-up, the account screens (no Google offered anywhere), and a check that no screen shows
  placeholder text such as "null", "undefined" or "NaN", deleting an account.
- **`tests/beneath.cjs`** checks the region beneath the iceberg in a real browser, on a desktop and a phone: 52
  checks. The evidence rule and the depth scale, every daily answer that can reach it, an ordinary answer, a rare one
  near the bottom of the iceberg, then an Unfathomable one: the descent past the tip, the iceberg out of view, the
  red annotation, gauge and guess row, the colossal squid (its size, colour and drawing time), the results, the share
  card and text, and exploring the dive again.
- **`tests/flow.cjs`** times the game's moments in a real browser, with tight limits: 21 checks. Typing ahead, the
  third guess to the results, the next question and when its clock starts, pressing Next twice, a guess sent while
  the camera is still rising, running out of time, a whole dive, animation loops and memory over repeated questions,
  cutting short the descent beneath the iceberg and the quick way back up, reduced motion on a phone, a reload.
- **`tests/perf.cjs`** is a measuring tool rather than a pass/fail suite: it plays questions and reports how long
  each moment takes, frame times, long main-thread tasks and memory, optionally with a slower CPU (`--cpu=4`), a
  slow connection (`--net=slow`), a phone screen, a slow server (`--api` with `GATEWAY_DELAY=600`) or signed in
  (`--auth`).
- **`tests/race-ui.cjs`** runs races in several browsers at once against that database: 53 checks. A private race
  from link to rematch (desktop and phone), a three-player quick race that starts by itself, a player who closes
  the tab mid-race, a reload mid-race, simultaneous guesses, the same guess sent twice at once, answer secrecy,
  explore, leaving, the race record, warming up alone, the camera, and layout. To keep it short it shortens the fixed
  pauses (countdown, break between questions, quick-race wait) in the test database only.

The browser suites talk to `tests/gateway.cjs`, a local stand-in for Supabase's web service: the database rules
are real, the sign-in service is imitated, and Realtime is switched off (polling carries the race). Instructions
are at the top of each file.

## Known limits of this test version

- The bank holds 15 days. After that the questions repeat until more are added.
- Each day's file sits on the site, so a determined player could read the answers, or open a future day early. The
  real version should hand out each day's questions from the server and judge guesses there.
- The new questions' answer lists were built from a dictionary and hand-written lists and spot-checked, not played
  by real people yet. Expect some answers that should count but don't: they show as pending, and the review queue
  (or the dispute button) is how you find and fix them.
- Guests are anonymous random IDs, so a guest could clear their browser data to replay. Players with accounts get
  one dive a day, scored by the database. `BACKEND.md` lists what remains open (above all: the answer files are
  public, and the timer is kept in the browser).
- Accounts were tested against a local database and an imitation of Supabase's sign-in service, and the main
  flows once against the real Supabase project. The race has only been tested locally: it is not on the live
  database yet, and Supabase Realtime and real network delays have not been tried.
- A few questions are very wide ("Name an animal", "Name a part of the human body"): almost any unusual answer
  reaches the Abyss. Narrower questions make for better days.
- Sound was checked by measurement, not by ear, and phone layouts in a desktop browser at phone sizes, not on real
  phones. Worth a quick check on an iPhone and an Android phone with the keyboard open.
- The artwork, animals included, is drawn by code. A pixel artist could replace it without touching the game logic.
- The animals were checked as still pictures and by measuring frame times in a test browser, not judged in motion
  by a person, and not on a real Chromebook or phone. If it stutters on school laptops, turn on Calmer water by
  default (`store.get("fx", "full")` in `game.js`).
- The name research checked .com addresses with the registry, but not social-media handles, trademark registers or
  prices. See `brand.html` for exactly what was and was not confirmed.
