# Krillion: editorial research for Deeple

Researched 2026-11-27. Purpose: learn editorial *principles* from a comparable daily rarity game. Nothing here is Krillion's question bank or answer data. Quotes are short and used only as evidence.

## Sources and confidence

| Tier | Source | How read |
|---|---|---|
| A (primary) | Official FAQ, https://krillion.io/faq | Fetched directly, full text |
| A (primary) | Official site UI text (how-to-play panel, tier blurbs, answer-sheet sort options, autocorrect prompt) in the public client bundle served at https://krillion.io/ | Fetched directly. `/api/` is disallowed in robots.txt and was not touched |
| B (press) | Fast Company, https://www.fastcompany.com/91647974/krillion-is-hooking-gen-z-and-gen-alpha-heres-what-you-need-to-know-about-the-viral-word-game ; Yahoo News UK, https://uk.news.yahoo.com/krillion-addictive-daily-game-challenging-135100285.html | Search-result excerpts only. The pages could not be opened from this session |
| B (community) | Her Campus St Andrews, https://www.hercampus.com/school/st-andrews/one-in-a-krillion-why-is-everyone-playing-krillion/ ; Trustpilot, https://www.trustpilot.com/review/krillion.io and https://au.trustpilot.com/review/krillion.io ; school papers (Tower Pulse, Knight Writers, Scot Scoop) | Search-result excerpts only |
| C (weak) | Fan remixes, SEO "answers today" and guide sites, TikTok discover pages | Excerpts only. Many contradict each other. Used only where flagged |

**Access limits (important):** only krillion.io was reachable from this session. Reddit is blocked for both search and fetch, and every other host (Product Hunt, GitHub fan repo, press sites) was refused by the network proxy. The official subreddit, which the FAQ points to as the feedback channel, could not be read, so this report has **no first-hand Reddit or Hacker News evidence**. No Hacker News thread turned up in search. Community findings below rest on press and review excerpts and should be treated as indicative, not exhaustive.

---

## 1. Stated methodology

### Answer sets: aggregate, then merge and clean
The FAQ says answer sets are built "by aggregating datasets (dictionaries, wiki pages, encyclopedias, whatever sources the question calls for), then merging and cleaning the result into one answer set." (https://krillion.io/faq). Some prompts have "thousands of accepted answers" (same page). So the model is a **closed, pre-built answer set per prompt**, not a live check. Answers outside the set score zero. A weak-tier guide puts it the same way: an unrecognised answer "does not prove it is incorrect outside the game" (https://unlimitedkrillion.org/how-to-play/, unofficial).

### Rarity: two methods, chosen by prompt type
- **Mechanical:** "Some prompts can be scored entirely mechanically against a familiarity database of how often a word or name actually turns up in what people read and write." (https://krillion.io/faq)
- **Assisted plus manual:** prompts that "can't be reduced to a number like that ... get a combination of LLM assistance and a manual pass." (same)
- **Evidence of the signals used:** the post-game answer sheet in the client offers sorts labelled "Linguabase familiarity", "IMDb votes · … snapshot", "Goodreads ratings", and live "players whose first accepted answer was this answer" counts (krillion.io client bundle, observed 2026-11-27). So the familiarity database appears to be Linguabase, a word-game vocabulary database (described at https://www.idea.org/?p=4523). Film and book prompts appear to use external popularity proxies. That last point is inferred from the UI labels, not stated.
- **Rarity is pre-assigned, not crowd-voted.** Fast Company says the back end "sometimes leverage[s] AI to help determine a player's score" (excerpt, URL above). Guides stress that tiers are not the percentage of players who gave an answer (see the excerpt from aiidelist.com in search results, page unreachable). Live player counts appear to be shown as context after play rather than used for scoring. **Unverified**: whether player data later feeds back into re-tiering.

### Tier structure (as shipped)
Six outcomes from the client: common (10), a "Too Clever" trap tier (15), solid (30), rare (60), deep cut (85) and the single designated gem (100). Blurbs include "The answer everyone blurts out." and, for the trap tier, "A famously 'obscure' pick. Everyone reaches for it." The FAQ defines that tier as "the go-to 'obscure' pick that isn't actually that obscure." The how-to panel warns: "the pick that feels clever? the school thought of it too." (krillion.io bundle and FAQ). This is the most distinctive editorial idea: **naming and punishing the predictable contrarian answer**. A low-tier aggregator says the tier was put to a player vote (https://www.tiktok.com/discover/krillion-wordle-too-clever). That is **unverified**, although the client does contain an `/api/announcements/vote` endpoint.

### The gem is picked for fun factor
The top answer "isn't chosen on rarity alone. Past a certain depth, rarity gets hard to disambiguate, so the gem is also picked for fun factor: the answer that's most satisfying to land on ... The gem should be something at least a few of you actually get." (https://krillion.io/faq). In other words, at the deep end the rarity signal turns to noise, so editorial taste takes over, and the top prize has to be *reachable*.

### Aliases and autocorrect, including the failure mode
The FAQ says "many of those answers have aliases because people use different names for the same thing. Autocorrect checks those aliases too, so being a letter or two off one of them can turn your guess into something you weren't expecting." Its own example is a fish whose alias sits one letter away from an unrelated pop-culture term, so a typo-tolerant match lands on an entity that "look[s] nothing alike." The developer says: "I try to catch and prevent these weird matches as much as possible." (https://krillion.io/faq). The client shows a "“typed” → “corrected”" panel with "submit again to confirm · or edit" (bundle). Fan feedback, from a GitHub remix seen only in search excerpts, adds two problems. A common first name autocorrected to a rare answer, giving a "free upgrade". And the confirmation step eats the 25-second clock. The remix's fix is to require a shared first letter, compare against the full answer, and accept only a unique best candidate (https://github.com/btyagi-code/krillion-update, unofficial, unverified).

### Missing answers
"Because I didn't find it, sorry. Sometimes I miss a source, which is usually why a fair answer is missing." (https://krillion.io/faq). The client has `/api/feedback` and a question-suggestion box ("got an idea for a question? tell us what to ask"). I found no evidence of retroactive re-scoring for a missed answer.

### Curation over volume
"right now the focus is on perfecting answer set curation and rarity selection. New packs come after that." (https://krillion.io/faq). Themed packs are labelled "BETA · Answers & scoring may have issues" (https://krillion.io/packs). The whole game is one developer: "No, just me." (FAQ).

---

## 2. Question formats and subjects

Krillion asks for one answer to an open "name a …" prompt, with a 25-second limit and seven prompts a day (bundle how-to; Yahoo excerpt). The styles below are paraphrased from coverage. They are not reproductions.

**Styles that work (from coverage):**
- **Big open category with a clear membership test.** Think "a country", "a kind of animal", "a film". Anyone can score, so it's accessible, and the long tail rewards depth. The classic illustration is the state prompt where "almost everyone types California or Texas" (krillion-unlimited.org excerpt, weak). This is where the fun of avoiding the obvious lives.
- **Category plus a formal constraint.** A food *with a double letter*, a river *over some length*. Third-party sample lists mention both shapes (same weak source). The constraint pushes lateral search rather than recall, which reads as "creative".
- **Everyday-observation prompts.** "Things you'd see on/at X" (one aired prompt was about information visible on a sports scoreboard, per https://minutecryptic.today/krillion-answers/2026-11-26-name-a-piece-of-information-you-can-see-on-a-sports-scoreboard). These need no expertise. You can solve them by picturing the scene, so they are good for casual players.
- **Fandom and pop-culture categories** (games, fantasy/sci-fi). Trendhunter-style coverage notes these offer "opportunities to showcase niche knowledge" (https://trendhunter.com/trends/daily-trivia-games, excerpt). They reward experts because the expert knows the deep catalogue.

**What sparks discussion:** comparing answers is the social core. A Her Campus interviewee likes "seeing how others answer, especially when their answers are ones she'd never have thought of" (Her Campus, excerpt). Students frame it as standing out: "you can get a score on how much more unique you are" (https://scotscoop.com/krillion-takes-a-dive-into-classroom-games/, excerpt). Classes run it as a shared daily event and a points contest (https://thetowerpulse.net/53245/arts-and-entertainment/diving-into-krillion-daily-trivia-craze-sweeping-school-hallways/ ; https://knightwriters.org/in-depth/2026/11/20/krillion-takes-over-the-classroom/). The post-game answer sheet with tiers and player counts fuels this.

**What frustrates or feels too specialised:**
- **Region-locked subjects.** Prompts built on one country's sports leagues, road signs, TV or geography. One Trustpilot reviewer says the questions are "exclusively based on the United States" (Trustpilot excerpt). Her Campus says it can feel like "a test of how much American television, geography and popular culture you happen to know" (excerpt).
- **Answers that "don't always make sense"** as valid or as tiered (Trustpilot excerpt). This is the closed-set problem: you are right but off-list, or your tier looks wrong.
- **No developer statement found** on specialised or niche prompts as such. The specialisation complaints in the evidence are almost all about *regional* knowledge.

**How familiarity, specificity and ambiguity are handled:**
- Familiarity is measured where it can be (word or name frequency, popularity proxies) and judged where it can't (LLM plus manual pass) (FAQ).
- Specificity: a guide says an answer must fall inside the prompt's stated boundary of group, date or definition (unlimitedkrillion.org, weak). Granularity across aliases, such as a species versus its common name, is handled by alias lists, and that is where the false-match bug comes from.
- Ambiguity: a rejected answer can be retried while the clock runs, but the clock isn't extended (unlimitedkrillion.org, weak). Autocorrect asks the player to confirm before it accepts a correction (bundle).

---

## 3. Community feedback themes

**Positive**
- *Social comparison and the reveal.* See the Her Campus and Scot Scoop quotes above. The fun is the surprise of other people's answers.
- *A small daily ritual.* "Unlike infinite-scroll apps, Krillion limits players to one game per day" (Tower Pulse excerpt). The 24-hour reset is likened to a daily crossword (Yahoo excerpt).
- *Inverted incentive.* Trying to avoid the obvious feels fresh. Coverage repeatedly compares it to the TV quiz *Pointless* (Yahoo excerpt; https://en.wikipedia.org/wiki/Pointless).
- *Losing is part of the hook.* One columnist: "what makes the game so particularly addictive for me is how terribly I suck at it" (search excerpt, attributed to a campus column; exact outlet **unverified**).
- *Growth.* The creator told Fast Company: "I have reached my best-case scenario 10x over" (Fast Company excerpt).

**Negative**
- *Inconsistent acceptance and spelling.* The Her Campus writer is "frustrated by the inconsistencies in the answers it accepts, particularly when it comes to minor spelling mistakes" and reports "the rejection of some perfectly valid responses, and the acceptance of some perfectly wrong ones" (excerpt).
- *US-centrism* (Trustpilot, Her Campus; see above). I found no official response.
- *Stress and timer pressure.* Trustpilot reviewers call it "stressful at times" (excerpt). The remix complaint that autocorrect confirmation eats the clock fits this.
- *Rarity feels arbitrary*, especially the trap tier. Some find it "arbitrary or punishing" (TikTok aggregator, weak).
- *Monetisation of extra play* ("dislike paying to play more than one game a day", AU Trustpilot excerpt). Small sample: about 5–6 reviews, mean around 2.5–2.9.
- *Reliability* (a review says the game "failed to load" after a full set of answers, Trustpilot excerpt).
- From the FAQ, players also complained about the random timer in the party mode. The developer kept it as intentional and invited redesign posts on the subreddit (https://krillion.io/faq). This shows a public, reasoned response to complaints.

---

## 4. Recommendations for Deeple

### Ten principles to adopt
1. **Answer set first, prompt second.** Commission a prompt only when you can name the sources that will define its full answer set: dictionary, encyclopedia list, authoritative registry. If you can't build the set, don't ship the prompt.
2. **Pick the rarity method per prompt and record it.** Use a frequency or familiarity measure where one exists. Use a proxy (votes, ratings, pageviews) or a human panel where it doesn't. Store which method was used so tiers can be audited.
3. **Editorial judgement at the deep end.** Below some depth, rarity data is noise. Choose the top-prize answer by hand for delight, and require that it be *gettable*: a real person could plausibly type it, and it is satisfying to reveal.
4. **Name the predictable contrarian answer.** Before launch, identify the "everyone thinks this is obscure" pick for every prompt and tier it honestly. Then explain it in-game in Deeple's own words, so it teaches the player and doesn't feel like a trap.
5. **Treat aliases as dangerous data.** Fuzzy-match only within a canonical answer's own spellings. Require the same first letter and a unique best candidate. Never let a typo jump to a *different entity* through someone else's alias. Run an automated collision check, where every alias at edit distance 1–2 from any other answer or alias is flagged for review.
6. **Confirm corrections without punishing time.** Show "you typed X, did you mean Y" and pause or refund the clock during confirmation.
7. **Prefer prompts with a crisp membership test.** A player should be able to decide alone whether an answer qualifies. Write any boundary (date, region, definition) into the prompt itself.
8. **Balance each daily set across access levels.** Every day should mix wide everyday or observational prompts (anyone can score), constrained lateral prompts (creative) and one deep-catalogue prompt (expert payoff), so nobody gets shut out.
9. **Run a global-fairness pass.** Check every prompt for knowledge that only one country has. Make the set region-neutral or label it clearly. Rotate regional subjects deliberately.
10. **Close the loop on missing answers, publicly.** Make "suggest a missing answer" one tap from the reveal. Review submissions daily, and say plainly when and whether a fixed answer gets re-scored. Also make the reveal sheet (full answers, tiers, why) a first-class social object, because it's what players talk about.

### Five things to avoid
1. **Shipping volume before curation.** Don't add packs or modes faster than answer sets can be audited. "Beta, scoring may have issues" spends player trust.
2. **Silent closed-set rejection.** Don't score a valid but off-list answer the same as nonsense with no explanation. Distinguish "not in our list (tell us)" from "doesn't fit".
3. **Opaque or unexplainable tiers.** If you can't say why an answer sits in a tier (the source, or an editorial call), players will call the scoring arbitrary.
4. **Region-locked or single-fandom prompts as daily staples.** They read as "a test of one country's TV" and cut out international players.
5. **Mechanics that add stress without depth.** Unlimited fuzzy matching, clocks that keep running through dialogs, and a paywall on the core daily habit all drew complaints with no editorial payoff.
