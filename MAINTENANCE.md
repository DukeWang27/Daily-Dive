# Running Deeple: the owner's handbook

Everything you need to keep the game running, in the order you're likely to need it. Other documents go deeper:
BACKEND.md (database setup and protections), CONTENT.md (how answers and rarity work), INTELLIGENCE.md (the answer
check and ranked play), LAUNCH.md (domain, email, costs).

Where things live: the game is static files on Vercel (deploys from the `main` branch of the GitHub repository); all
data is in Supabase (project `lrubyctrjrkzbbshlois`). Questions and answers are **in the database**, not in the code:
changing content never needs a code deploy.

## 1. Every day: nothing, unless GitHub emails you

Two scheduled jobs run on GitHub (Actions tab):

| Job | When | What it does | If it fails |
|---|---|---|---|
| Nightly backup (`backup.yml`) | 07:17 UTC | Encrypted dump of the whole database, kept 14 days | Check the secrets `SUPABASE_DB_URL` and `BACKUP_PASSPHRASE` |
| Daily health check (`health.yml`) | 08:41 UTC | Days of content left, answers waiting for review, browser errors, AI spending; prunes old logs | Read the run's summary: it names the problem |

The health check fails (and GitHub emails you) when fewer than **14 days** of prepared content remain, more than 200
browser errors were reported the day before, or the AI check has used 80% of its monthly budget. Running out of
content does not break the game (days without prepared content fall back to the original question rotation), but
the fallback questions are the old, weaker ones.

## 2. Every week (15 minutes)

1. **Answers waiting for review.** Players' unrecognised answers and disputes:
   `python3 tools/content/cms.py pending 50` (needs `DATABASE_URL` in your terminal, never in the game).
   Decide each one: `python3 tools/content/cms.py verdict <question> "<answer>" ok "Canonical name"` or `... invalid`.
   A verdict counts for everyone who typed it, now and later. Earlier scores are never rewritten.
2. **Which questions worked.** In the Supabase SQL editor:
   `select * from private.question_health limit 50;` (plays, average depth, how often nothing counted, unknown answers)
   and `select * from private.daily_activity limit 14;` (players who started and finished each day).
3. **Errors.** `select * from public.client_errors order by on_day desc, count desc limit 30;`

## 3. Replacing a bad question (no code change)

A question that hasn't been played yet can be swapped at any time:

```bash
python3 tools/content/cms.py reject <id> "why"
```
```bash
python3 tools/content/build.py all
```

Then run the new SQL for the affected days (content/build/sql/day_NNN.sql) in the Supabase SQL editor. The build
never changes days up to the day after tomorrow, so nobody mid-day sees a question change. A day already played is
never changed: its answers, scores and rarity snapshot stay exactly as players saw them.

To move specific questions onto a day: `python3 tools/content/cms.py reschedule <day> <id1> ... <id5>`, then build.

## 4. Adding more days

The question set is in `content/questions/` (private: git-ignored, keep your own copy; see section 9). New questions
follow `tools/content/QUESTION-METHOD.md` and `content/editorial/V3-DIRECTION.md`: every answer list checked (code for
wordplay, sources for facts), an independent challenge test, then `approved`. `content/editorial/final-set.json` lists
the questions the scheduler may use; add new ids there, then `python3 tools/content/build.py all` and load the SQL.
Aim to keep at least 30 days ahead.

## 5. The AI answer check (optional; off until you switch it on)

Without it, an answer the lists don't know is placed as "waiting for review" (scores nothing until you approve it, then
counts for everyone). With it, most of those are settled in a second or two.

To switch it on (you do this; never paste keys into chats, code or GitHub):
1. Anthropic Console (console.anthropic.com): create an API key, and under Billing set a **monthly spend limit** (e.g.
   $10). Prepaid credit is required; buy the smallest amount.
2. Vercel → the project → Settings → Environment Variables (Production only):
   `AI_PROVIDER=anthropic`, `ANTHROPIC_API_KEY=<the key>`, `SUPABASE_URL=https://lrubyctrjrkzbbshlois.supabase.co`,
   `SUPABASE_SERVICE_ROLE_KEY=<from Supabase → Settings → API>`, `ALLOWED_ORIGIN=https://www.deeplegame.com`.
   Optional: `AI_MODEL` (default `claude-haiku-5-5`).
3. Redeploy. Visit `https://www.deeplegame.com/api/verify`: it should say `{"enabled":true}`. The game checks this
   itself and turns the feature on; nothing else to change.

Safeguards (in the database, migration 0007): a hard monthly budget (`private.ai_config`, default $10), limits per day,
per player and per question, a permanent cache (an answer is never paid for twice), junk filtering before any call,
and an evidence rule (a brand-new answer is accepted only with a quoted source, and still goes to your review queue).
Estimated cost: about $0.15–$1.50 a month at 1,000 daily players (an estimate from assumed volumes, not a measurement); see INTELLIGENCE.md §5.

To switch it off: delete `AI_PROVIDER` in Vercel and redeploy. Nothing else changes.

## 6. Releasing a new version of the site

Work happens on the `experiments` branch. To release: open a pull request from `experiments` to `main`, read the
"Files changed", merge. Vercel deploys in about a minute. If a release includes a database migration
(`supabase/00NN_*.sql`), run it in the Supabase SQL editor **before** merging; every migration is safe to run twice and
none deletes player data.

## 7. Rolling back

- **Site:** Vercel → Deployments → pick the previous production deployment → "Promote to Production" (instant). Or
  revert the merge commit on GitHub.
- **Content for a day:** re-run that day's previous SQL file, or reschedule (section 3). Played days are never touched.
- **Database:** restore from the nightly backup (below) into a new Supabase project first, check it, then switch. Never
  restore over the live database without a fresh backup of it.

## 8. Backups and restoring

The nightly job keeps 14 days of encrypted dumps (Actions → Nightly backup → a run → Artifacts). To restore:

```bash
gpg --batch --passphrase "<passphrase>" -d deeple-YYYY-MM-DD.dump.gpg > backup.dump
```
```bash
pg_restore --no-owner --no-privileges -d "<target database url>" backup.dump
```

Do a practice restore into a scratch database every few months. Supabase's own daily backups (7 days) exist on paid
plans only.

## 9. Private files you must keep a copy of

The repository is public, so the question set and editorial work are git-ignored: `content/questions`,
`content/curated`, `content/editorial`, `content/build`, `content/research`, `content/kb/lexicon.json`. They are also in
the database (as published days), but the editable sources are only on the machine that built them. Keep a private
copy (a private GitHub repository or encrypted cloud folder).

## 10. Security checklist

- The game contains only Supabase's public "anon" key. The service-role key and AI keys live only in Vercel's
  environment variables and GitHub secrets. Never put them anywhere else.
- Players can't read other players' private data: row-level security on every table; anonymous logging tables are
  write-only through rate-limited functions (migration 0013).
- Scores are computed by the database from the answers, never taken from the browser.
- Supabase → Authentication: keep email confirmation on; Google sign-in stays off until you decide otherwise.
- Rotate the service-role key if you ever suspect it leaked (Supabase → Settings → API), then update Vercel.

## 11. Playtests with friends (no account needed)

The test build has a friends mode: the test days only, an optional one-tap verdict after each question and three short
questions at the end. Feedback arrives anonymously in the database:

```sql
select * from private.playtest_funnel;      -- opened / started / finished / surveyed, per day
select * from private.playtest_questions;   -- per question: plays, answers that counted, invalid, waiting
select * from private.playtest_feedback;    -- tags per question
select * from private.playtest_surveys;     -- the end-of-day answers
```

## 12. Costs to expect

Vercel Hobby and Supabase Free cover the game up to roughly a few thousand daily players. The first likely paid step
is Supabase Pro ($25/month) for more database size and daily backups. The AI check is capped by the budget you set.
LAUNCH.md has the full table.
