# Switching on accounts, friends and rankings

The game plays without any of this: everyone is a guest and progress stays on their device. This guide connects
it to a free Supabase project so players can make accounts, keep streaks across devices, add friends, appear in
daily rankings and explore each other's icebergs.

It takes about half an hour. Nothing here needs code beyond pasting two values into one line of `game.js`.

**Be clear about what has and hasn't been tested.** The database rules in `supabase/` were tested on a real
PostgreSQL database, and the game was tested against it through a local stand-in for Supabase's web service. No
real Supabase project was available, so Supabase's own sign-in service (sending emails, Google, real sessions) has
not been tried. Follow the steps, then run the short check at the end before telling anyone it's open.

## 1. Make the project

1. Sign up at supabase.com and create a project. Pick a region near your players. Save the database password
   somewhere safe; the game never needs it.

## 2. Load the database

Open **SQL Editor → New query**. For each file below, in this order, paste the whole file and press **Run**.
Each can be run again safely.

| Order | File | What it sets up |
|---|---|---|
| 1 | `supabase/0001_community.sql` | Anonymous play counts, the review queue |
| 2 | `supabase/0002_accounts.sql` | Players, usernames, dives, streaks, friends, rankings, and every rule about who may see what |
| 3 | `supabase/0003_answers_01_05.sql` | The rarity tables for question sets 1 to 5 |
| 4 | `supabase/0003_answers_06_10.sql` | Sets 6 to 10 |
| 5 | `supabase/0003_answers_11_15.sql` | Sets 11 to 15 |

The last three are large (100 to 230 KB each). If the editor struggles, anyone comfortable with a terminal can
load them with `psql` and the connection string from **Project Settings → Database** instead.

## 3. Tell Supabase where the game lives

**Authentication → URL Configuration**

- **Site URL**: your game's address, for example `https://your-game.vercel.app`
- **Redirect URLs**: add the same address. (Add `http://localhost:8000` too if you test on your own computer.)

Email links (confirming an address, resetting a password) send the player back to this address.

## 4. Email sign-in

Email and password sign-in is on by default. Two decisions:

- **Confirm email** (Authentication → Providers → Email). On: a new player must click a link in an email before
  their first sign-in; the game tells them to check their inbox. Off: they're in at once. On is safer against junk
  accounts.
- **Sending email.** Supabase's built-in sender only allows a handful of emails an hour and is meant for testing.
  Before real players arrive, connect your own sender under **Authentication → Emails → SMTP Settings** (Resend,
  Postmark and SendGrid all have free tiers). Without it, sign-ups and password resets will start failing as soon
  as a few people try at once.

## 5. Google sign-in (optional)

1. In Google Cloud Console create an **OAuth client ID** (type: Web application). Under *Authorised redirect
   URIs* add `https://YOUR-PROJECT.supabase.co/auth/v1/callback`.
2. In Supabase: **Authentication → Providers → Google**, switch it on and paste the client ID and secret.
3. In `game.js`, set `google: true` on the `BACKEND` line. The "Continue with Google" button is hidden until you do.

A Google sign-in has no username yet, so the game asks for one before anything else.

## 6. Connect the game

**Project Settings → API**: copy the **Project URL** and the **anon public** key into the `BACKEND` line near the
top of `game.js`:

```js
const BACKEND = { url: "https://YOUR-PROJECT.supabase.co", anonKey: "YOUR-ANON-KEY", google: false, verifyUrl: "" };
```

Commit and push; Vercel redeploys on its own.

The anon key is designed to be public: with it, a browser can do only what the rules in `0002_accounts.sql`
allow. **Never paste the `service_role` key into `game.js` or any file in this folder that the website serves.**
It bypasses every rule.

## 7. The launch date

The database and the game must agree on which day is day 1. Both are set to **24 November 2026**: `LAUNCH` in
`game.js`, and the `launch` row of the `game_config` table. If you change one, change the other (Table Editor →
`game_config`).

## 8. Check it works

Do this yourself, with two browsers (or one normal window and one private window):

1. Play a day as a guest. On the results screen, create an account and choose a username. In Supabase, **Table
   Editor → dives** should show one row with your total.
2. In the second browser create another account. Try to take the first username: it should be refused.
3. Find the first player under **Friends**, send a request, accept it in the first browser.
4. In the second browser, before playing: the friend should show as "Finished today · score hidden", and
   **Rankings** should say to finish your dive first.
5. Play the day in the second browser. Scores, rankings and **Explore** should all open.
6. Request a password reset and check the email arrives and the link lets you set a new password.

If any step fails, the browser's console (F12) shows the database's reply.

## How it is protected

- **Tables are closed.** Every table has row-level security on and no policies, so the public key cannot read or
  change a single row directly, signed in or not. The game uses about twenty functions, each of which checks who
  is asking.
- **Scores are worked out by the database.** The browser sends only what was typed and which accepted answer it
  counted as. Shares, depths, the best answer per question and the total come from the day's rarity table. A
  browser that claims a bigger number is ignored.
- **One dive per player per day**, enforced by the database, whatever device it comes from. Streaks are recounted
  from the dives themselves each time, so a refresh or a replay cannot push one up.
- **The spoiler rule lives in the database.** Another player's answers, scores and iceberg for a day are returned
  only to someone who has handed in their own dive for that day, or once the day has closed everywhere and can no
  longer be played. Before that, the functions return "locked", not hidden data. The same rule covers rankings,
  friends' scores, profiles and the counts of how many players gave each answer.
- **Rarity is fixed per day.** A day's rarity table is published once and scores never move afterwards, so
  everyone is ranked on the same scale whenever they play, and an old iceberg always looks the way it did.
- **Privacy.** Emails and account ids are never returned by any function. Dives, answers and calendars are only
  ever shown to accepted friends, and each can be switched off in Settings. A blocked player cannot find, view or
  send requests to the player who blocked them.
- **Usernames** are unique whatever the capitals (a database index, not just a check in the page), 3 to 20
  letters, numbers or underscores. Reserved and unsuitable names are refused, including look-alikes such as
  `Adm1n`. A name that is given up is held for 30 days.
- **Limits.** Friend requests (20 an hour), searches, dive submissions and imports are rate-limited per player.

## Days and time zones

A new day starts at each player's own midnight, as before. Across the world a given day is therefore "open" for
50 hours, from its first midnight (UTC+14) to its last (UTC−12). The database accepts a dive only while its day is
open, and keeps other players' answers for that day closed until it ends or you have dived. A streak counts as
alive until the end of the day after your last dive.

## Looking after it

- **Review queue:** Table Editor → `review_queue` (unknown answers players typed, most common first).
- **Unsuitable usernames:** add words to `banned_terms`, or names to `reserved_names`. To remove a player, delete
  them under **Authentication → Users**; their profile, dives and friendships go with them.
- **Adding days of questions:** follow "Adding more days" in the README, then run `python tools/seed_answers.py`
  and paste the new `0003_answers_*.sql` files. The number of sets updates itself.
- Free Supabase projects pause after a week without activity.

## What still needs doing before a public launch

1. **Try it on a real Supabase project** (section 8). Sign-in was only tested against an imitation.
2. **Email sending** (section 4) and, if wanted, **Google** (section 5).
3. **A privacy policy and a minimum age.** Accounts mean storing email addresses. The game is aimed partly at
   teenagers; in many places collecting personal details from under-13s (under 16 in parts of Europe) needs a
   parent's consent. Decide the age you allow, say so at sign-up, and publish a privacy policy. This is a legal
   question, not a technical one, and it is not handled in the code.
4. **The answer lists are still public.** Answers are judged in the browser, so each day's file of accepted
   answers and their rarity can be read by anyone who looks. The database stops score tampering and stops players
   seeing *each other's* answers early, but a determined player could look up rare answers in that file, or run
   past the timer, which is also kept in the browser. Closing this means judging guesses on the server, which is a
   larger change.
5. **Guest history is taken on trust.** Days played before signing up are scored by the database, but it cannot
   prove when they were played. They are marked as such, limited to the last 90 days, and days that had already
   closed do not enter their ranking.
6. **A bot check on sign-up.** Supabase can add a CAPTCHA (Authentication → Attack Protection). Worth switching on.
7. **Reporting.** There is blocking, but no way yet for a player to report a username to you.
8. **Scale.** Rankings are calculated when asked for. That is fine into the thousands of players a day; beyond
   that they should be stored when each dive arrives.

Not built yet, by design, and left room for: uploaded profile pictures (players choose one of the game's animals
instead), rankings by streak or all-time record, achievements, a creature collection, private groups.
