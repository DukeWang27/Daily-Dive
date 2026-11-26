# The expedition: one continuous dive a day

Status: on the `deep-life` branch and in the private playtest build. **Not live.** Nothing here has been deployed to the
public site or applied to the live database.

## The rule

The day is one descent. Where you are is your **running total**: every finished question's score, plus the best
verified answer so far in the question you're on. Nothing ever takes you back up.

```
dive depth = sum of finished questions' scores + current question's best verified answer (game.js: diveBefore, diveOf)
```

Best of three is unchanged. Within a question, only an answer that beats that question's best moves you, and only by
the difference. A question that starts at 300 m: first guess +100 m takes you to 400 m; second guess +270 m takes you
a further 170 m to 570 m; third guess +50 m leaves you at 570 m. It still gets its own rarity reveal, at your position.
The question scored 270 m, not 420.

The scoring formula itself is untouched: an answer's depth is `100 × log10(0.10 / share)` metres, 300 m and more only
with evidence (iceberg.js, `depthOf`). The day's score is still the sum of the five best answers. So existing results,
rankings, streaks and the server's scoring all keep meaning exactly what they meant; only the picture changed.

Four things are kept apart everywhere (annotations, slots, results, end screen, share card, journal):

| What | Example | Where it shows |
|---|---|---|
| Rarity of one answer | 0.013% of players, *Exceptional* | annotation, slot, results list |
| Distance it earned | +290 m | annotation, slot, results list, end rows |
| Where the dive is | 596 m, *Midnight Zone* | depth gauge, header, results label, end screen |
| Deepest discovery | the single rarest answer of the day | end screen ("rarest answer"), journal record |

To stop rarity and place ever being confused, the rarity tiers were renamed to rarity words (keys unchanged, so saved
results and colours are untouched): Common, Uncommon, Rare, Very rare, Exceptional, **Unfathomable** (the red one).
The ocean's regions have their own names. This is a creative change: please review it.

## Regions

Set by the running total, never by one answer:

| Region | From | What's there |
|---|---|---|
| Surface Waters | 0 m | the iceberg (down to about 340 m), seabirds, seals, cod, capelin, krill, moon jellies |
| Twilight Zone | 300 m | the last light in slanting shafts; lanternfish, siphonophores, barreleye, armhook squid, Greenland shark |
| Midnight Zone | 600 m | blue sparks in the water; viperfish, anglerfish, fangtooth, Atolla jellyfish |
| The Abyss | 1,000 m | the abyssal plain rises in from the sides at about 1,235 m: a wreck, a lost submarine, sea pens; dumbo octopus |
| The Trenches | 1,300 m | trench walls; a research station with lit windows, hydrothermal vents with live smoke, silt; snailfish, amphipods |
| The Unknown | 1,500 m | a cavern that shouldn't be there: violet-red water, red motes drifting up, ruins with glowing marks, a standing stone, a glow below |

Real totals so far (4 finished dives on the live database) ran from about 560 to 900 m, so a typical day ends in the
Midnight Zone. The Unknown needs more than 1,500 m: five answers at the very bottom of the rarity scale (299 m each)
add to 1,495 m, so it takes at least one Unfathomable answer (which needs player evidence) or several near it. Hard, not impossible.

The world is painted once (iceberg.js, `paintExpedition`): the sea's colour by depth, the rock of the plain, trench and
cavern, and the set pieces. Lights fixed in the world (station windows, vent glow, glyphs) are drawn on the light layer
so they show through the dark, some blinking. Each region has its own particles (snow thinning, blue sparks, silt, red
motes rising) and its own sound (Midnight twinkles; trench creaks and groans; in The Unknown, a faint beating chord
and, rarely, a very low call).

## Animals and encounters

Every resident now lives at a believable running depth (wildlife.js, `zone`). New, drawn and animated live:
**barreleye** (clear head, green tube eyes looking up, sculling fins, turns now and then), **fangtooth** (tail beat
quickening with each surge), **Atolla jellyfish** (pulsing red crown; its "alarm", a spot of blue light running round
the rim), **hadal amphipods** (a swarm that hops), and the vents' smoke.

Great encounters need both the answer's own rarity and the dive's region:

| Encounter | Answer needs | Dive needs |
|---|---|---|
| Giant squid | +200 m | 300 m (Twilight) |
| Bigfin squid | +250 m | 600 m (Midnight) |
| Colossal squid | Unfathomable (+300 m, with evidence) | — |
| Megalodon (fiction) | any answer that takes you down | 1,500 m (The Unknown) |
| The Coil (fiction) | +200 m | 1,700 m |

The two inventions are labelled as such in the journal ("not a real animal"). The serpent was first called
"Leviathan", but Krillion already uses that name (its 150-day streak creature), so it was renamed. **The ranked
division "Leviathan" has the same clash and should be renamed before ranked play goes live.**

**Colossal squid**:
- **Timing.** It now sets off about 2.4 s before you land, already rising and moving, so it is beside the answer as you
  arrive. Before, it set off 1.1 s before landing and was still arriving after the reveal. The descent for an
  Unfathomable answer is shorter too (2.4–3.6 s, down from 3.8–5.2 s).
- **Animation.** Each arm has a third, quicker wave that coils and uncoils the tips, and the fins ripple with two waves.
- **Drawing cost** (`tests/beneath.cjs`, limit unchanged at 12 ms): 7.4 ms a frame on the desktop scene, previously
  12.4–15.3 ms, which failed. The phone scene draws in 4.1 ms. Four things were fixed:
  - Only the area it covers is cleared and copied each frame, not the whole screen twice.
  - Overlapping discs along each arm are shaded once instead of three or four times.
  - The body outline is worked out once per pixel rather than twice.
  - Copies to the screen are cut to that area.

## Saving and resuming

Everything is derived from the saved game (guesses, time left, finished questions), never from the camera. A reload,
another screen or the next question puts you back where the saved guesses say you are (iceberg.js `enter/restore/carry`
take the running depth). The region, the light, the animals around you and the sound follow from that. Encounters
already met are kept per question (`r.guests`, `r.seen`). A great animal that was passing when you reloaded does not
pass again.

Signed-in players: finished dives already sync to the account (`handIn`). The account stores each guess's depth and
the day's total, which *is* the dive depth, so friends' dives, history and the viewer rebuild the same descent. A dive
in progress is kept on the device only, as before; resuming a half-played day on a second device is not supported
(it wasn't before either).

**Database note.** `dive_guesses.sight` only accepts giant, bigfin and colossal. Until `supabase/0009` is applied, the
game does not send the two new encounters (they stay in the device's record), so saving can't fail.

## The field journal

`journal.js`, built from the dives you've already played. It can't drift from your results or be edited to cheat, and
nothing in it can be bought.
- **Grouping.** Animals are grouped by region.
- **Entries.** An animal is recorded at the running depth where each question's best answer left you, plus any great
  encounter that answer brought.
- **Each entry shows:**
  - the picture (animated when opened);
  - the real habitat, real depth range and a true fact;
  - the date it was first recorded, and the dive depth and answer that found it;
  - how many times you've met it.
- **Locked entries** are silhouettes. They hint at where (a region), never how. The inventions show only "No record.
  Only rumours."
- **Personal records:** your deepest dive, and separately your rarest answer.

For registered players the journal is as permanent as their dive history. It rebuilds from whatever days are on the
device, so a full cross-device journal needs the full history downloaded on sign-in. Check that this happens before
relying on it.

## First recorded discoveries (prototype, not applied)

`supabase/0009_first_discoveries.sql` (applies cleanly to the local test database; **not** applied live).
- **What counts:** the first signed-in player to give a verified answer nobody had given before for that question,
  ever.
- **How it's decided:** on the server, from guesses already stored. A client can't claim one, and it changes no
  score.
- **Guards:**
  - **The question, not the day.** Firsts are keyed by the question, so reuse keeps its history.
  - **Canonical answers.** Aliases, spellings and synonyms fold into the listed answer first.
  - **Only answers missing from the prepared list.** Answers on the list were "recorded" before anyone played, so
    being first to play gives no advantage; what's rewarded is finding what the list missed.
  - **Verified first.** The answer must pass the existing review (`verified_answers`).
  - **Earliest dive wins.** Credit goes to the earliest completed dive, not to whoever's guess is checked first.
  - **Enough players.** Only on days with at least 30 players.
  - **Accounts only.** Guests can't be credited.
- **Still needed before it can go live:**
  - a scheduled job to run it after review;
  - a place on the profile and results to show it ("First recorded in Deeple");
  - your decision on the 30-player threshold;
  - the AI review layer switched on (without it, new answers wait for a person).

## Differentiation: research and recommendation

Full report: `content/review/differentiation-research.md`. Only krillion.io could be fetched from here. Facts about
the other games come from search excerpts and are marked unverified there.

The most important finding: **Knowtilus (a mobile game) already sells "a submarine descends through five pixel-art
ocean zones (Sunlight to Hadal) and you collect deep-sea discoveries"**, with chests, jewels and paid extra dives.
**Krillion gives out creatures for streaks** ("dive buddies", including a Leviathan). So the descent and the journal
make Deeple better, but they are not what makes it different. Don't lead with them. What no reviewed rarity game has:
anything community-wide or collaborative, or "first discovery" records. Deeple's real advantage is its live player
counts and its verified-answer pipeline.

Worth pursuing, in order:
1. **Verified first discoveries.** This prototype, shown in the journal, worded "first recorded in Deeple".
2. **An overnight "sounding" report.** How your answers' rarity settled once everyone had played, with the dive
   profile share card. It's cheap, brings players back the next day, and uses data only Deeple has.
3. **A community seafloor survey.** Every distinct answer given today, revealed when the day closes. Community goals
   only once there are enough players to reach them.

Later: a tethered buddy dive with a friend, seasonal migrations, secret encounters, and an optional rarity prediction
on one question.

Avoid:
- Chests, currencies or paid dives.
- A third real-time mode.
- Anything that needs a big player count to feel alive.
- Krill wording.

## Tests

- `tests/expedition.cjs` (new): best answer first, second or third; a common answer after a very rare one; all five
  questions; reload mid-question (guesses, time and depth kept, camera at your depth); the camera never goes up while
  answering; the end total; the share text; the viewer rebuilding the dive; the region boundaries; tier and region
  names never shared.
- `tests/beneath.cjs`, `tests/carry.cjs`, `tests/journal.cjs` and `tests/matrix.cjs`: updated where they encoded the
  old rules (a common answer travelling back up, "Challenger Deep", great squid by answer depth alone).
