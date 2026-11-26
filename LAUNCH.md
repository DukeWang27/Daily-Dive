# Launch setup: what you do, what I do

Checked on 26 Nov 2026. Where a fact comes from reading the live services, it says so.

**Read-only checks.** Supabase settings, its database, the live site's headers and domain registries were all read
only. Nothing was changed, bought or switched on.

## What exists today (read from the live services)

| | Status |
|---|---|
| **Hosting** | Vercel. Live at `https://iceberg-eight-silk.vercel.app` (HTTPS, HSTS on). Deploys from GitHub `DukeWang27/Daily-Dive`, branch `main`. |
| **Supabase project** | "Daily Dive" (`lrubyctrjrkzbbshlois`), us-east-1, Postgres 17, healthy, **Free plan**. |
| **Database** | 55 MB used of the 500 MB free. 4 accounts, 4 dives, 92 round plays. Launch day 24 Nov 2026; 90 days of questions scheduled (to day 93). Row-level security is on for every table. |
| **Backups** | **None you can download.** The backup list is empty and point-in-time recovery is off. That is normal for the Free plan. |
| **Auth** | Email + password. Sign-up open. Email confirmation is off (accounts work at once). Password minimum 6. No captcha. Anonymous sign-ins off: guests play on their device and hand their days in when they make an account. Google off (postponed, as you asked). |
| **Email** | **No custom SMTP.** Supabase's built-in sender only delivers to members of your Supabase team, about 2 emails an hour. So **"Forgot password" does not work for the public today.** |
| **AI answer checking** | **Off.** The game's checking address is empty and no provider is set. Unknown answers go to "pending" and wait for review. Nothing is billed. |
| **Analytics** | **None.** No analytics, no error monitoring. |
| **Privacy page** | `privacy.html` exists. It must be updated when analytics is added. |
| **Domain** | None (only the vercel.app address). |

## What you need to do

Most urgent first. **(R)** = required before a public launch; **(O)** = optional.

### 1. Buy a domain (R): about $10–11 a year

Availability checked in the registries' own records (RDAP), 26 Nov 2026:

| Name | Available? | Price per year | Notes |
|---|---|---|---|
| **deeplegame.com** | yes | about $10.50 ( renews the same) | **My pick.** Says what it is, a .com, under budget every year. |
| **deepledaily.com** | yes | about $10.50 | Good for a daily game; a little long. |
| getdeeple.com / trydeeple.com | yes | about $10.50 | Fine, but read like an app download. |
| deepleplay.com | yes | about $10.50 | Awkward to say. |
| deepledive.com | yes | about $10.50 | Repeats itself. |
| deeple.games | yes | ~$8 first year, then **~$27** | Over budget from year 2. |
| deeple.gg / deeple.io | not confirmed | $30+ | Over budget. |
| deeple.fun | couldn't check | ~$2 first year, then **~$31** | Over budget from year 2. |
| deeple.co | couldn't check | usually ~$25–30 | Over budget. |
| deeple.com / deeple.net | **taken** | | |
| playdeeple.com | **taken** | | |

Before you pay, check the price your registrar shows: .com wholesale prices were due to rise slightly in November.

**Where to buy:** [Cloudflare Registrar](https://dash.cloudflare.com/?to=/:account/domains/register). It sells at cost and renews at the same price. It also gives you free email forwarding (step 4) and free DNS. Porkbun or Vercel's own domain shop are fine too. Vercel's is the simplest (DNS is set up automatically), but usually costs a little more.

**Steps (Cloudflare):**
1. Create a free Cloudflare account.
2. Go to Domain Registration → Register Domains.
3. Search for `deeplegame.com`, buy one year, and turn on auto-renew.
4. Leave WHOIS privacy on (it's free).

**No credentials needed by me.** Tell me which name you bought.

### 2. Point the domain at Vercel (R): free

1. In [Vercel → your project → Settings → Domains](https://vercel.com/dashboard), add `deeplegame.com` and
   `www.deeplegame.com`. Choose to redirect `www` to the bare name.
2. Vercel shows the exact DNS records. Usually:
   - `A @ 76.76.21.21`
   - `CNAME www cname.vercel-dns.com`
3. Add them in Cloudflare → your domain → DNS. **Set the proxy status to "DNS only" (grey cloud).** Vercel handles HTTPS.
4. Wait for Vercel to show "Valid configuration". HTTPS is issued automatically within minutes.

**Supabase must then accept sign-ins from the new address:**
- Go to [Supabase → Authentication → URL Configuration](https://supabase.com/dashboard/project/lrubyctrjrkzbbshlois/auth/url-configuration).
- Set **Site URL** to `https://deeplegame.com`.
- Add `https://deeplegame.com/**` to the Redirect URLs.
- **Keep the old vercel.app entries** until we've checked the new domain works.
- I can make this change for you if you say so.

**Check:** I'll load the site on the new domain, sign in, and confirm the HTTPS certificate and redirects.

**Hosting account:** no new account needed. GitHub is already connected, and no environment variables are needed for the game itself.

**One thing to know:** Vercel's free **Hobby** plan is for non-commercial use. Deeple with no ads or payments fits. If you ever add ads or payments, Pro is $20 a month.

### 3. Email for sign-in messages (R if we keep "Forgot password"): free

Without this, password-reset emails never reach players. Options:
- **(a)** set up custom SMTP, which I recommend; or
- **(b)** I hide "Forgot password" for launch and players use a strong password. If they lose it, they lose their account.

**For (a), use [Resend](https://resend.com):** free for 3,000 emails a month and 100 a day.
1. Sign up.
2. Go to Domains → Add `deeplegame.com`.
3. Add the DNS records it lists (SPF, DKIM) in Cloudflare and wait for "Verified".
4. Go to API Keys → create one with "Sending access" only.
5. In [Supabase → Authentication → Emails → SMTP Settings](https://supabase.com/dashboard/project/lrubyctrjrkzbbshlois/auth/smtp), enable custom SMTP with:
   - host `smtp.resend.com`, port `465`;
   - user `resend`;
   - password = the API key, **pasted straight into Supabase, never into chat**;
   - sender `Deeple <no-reply@deeplegame.com>`.
6. In Authentication → Rate Limits, set emails per hour to about 30.

**Check:** trigger "Forgot password" for a test account and confirm the email arrives and the link opens the game.

### 4. A support address (R): free

Reddit players will want somewhere to write.
1. In Cloudflare → your domain → **Email → Email Routing**, enable it.
2. Add `support@deeplegame.com`, forwarding to your own inbox.

I'll put the address on the privacy page and in the game's feedback link.

### 5. Database backups (R): free with a small script, or $25 a month

The Free plan gives you no downloadable backups. I've written a nightly backup that runs on GitHub (free):
`.github/workflows/backup.yml`. It runs `pg_dump` and keeps 14 days of encrypted copies. It needs two secrets that **you** add in [GitHub → Daily-Dive → Settings → Secrets and variables → Actions](https://github.com/DukeWang27/Daily-Dive/settings/secrets/actions):
- `SUPABASE_DB_URL`:
  - Get it from Supabase → Project Settings → Database → Connection string → "Session pooler" URI.
  - Fill in your database password.
  - Never paste it into chat.
- `BACKUP_PASSPHRASE`: any long random phrase. Write it down somewhere safe; you need it to restore.

**Check:** run the workflow once by hand (Actions → Nightly backup → Run workflow). I'll confirm a backup file appears.

The alternative is Supabase **Pro** ($25 a month): daily backups, no pausing, more room. Not needed for testing the market.

### 6. Search and sharing (R for Reddit, free)

- **Google Search Console** ([search.google.com/search-console](https://search.google.com/search-console)):
  1. Add a "Domain" property for `deeplegame.com`.
  2. Add the TXT record it gives you in Cloudflare DNS.
  3. Submit `https://deeplegame.com/sitemap.xml`. I'm adding the sitemap.
- **Reddit:**
  - Use an account with some history: brand-new accounts get filtered.
  - Read each subreddit's self-promotion rules first. Good fits: r/WebGames, r/playmygame, r/indiegames, and r/dailygames (check it exists and allows posts).
  - Post once per subreddit and answer every comment.
- **Social handles:** register `deeplegame` (or close) on X, Instagram and Bluesky so nobody else takes them. No posting needed yet.
- **Daily-game directories:** submit once the domain is live. I'll list the ones worth it, with their submission pages, in the final report.

### 7. AI answer checking (O, not needed for launch)

Today, unknown answers wait as "pending" and you approve them in the review tool. That costs nothing. If you later want automatic checking:
1. Create an [Anthropic Console](https://console.anthropic.com) account, add billing, and set a **monthly spend limit** (Settings → Limits). $5 is plenty to start.
2. Create an API key and put it **only** in [Vercel → Project → Settings → Environment Variables](https://vercel.com/dashboard) as `ANTHROPIC_API_KEY` (Production only). Also add:
   - `AI_PROVIDER=anthropic`;
   - `SUPABASE_URL`;
   - `SUPABASE_SERVICE_ROLE_KEY` (from Supabase → Project Settings → API; this one is secret too);
   - `ALLOWED_ORIGIN=https://deeplegame.com`.
3. Tell me, and I switch the game's checking address on.

The game's own budget caps (monthly, daily, per player, per question) stop calls before your Anthropic limit is reached. Every verdict is cached, so the same answer is never paid for twice. See the cost section below.

### 8. Analytics (R: you want real numbers; free)

**Nothing for you to set up.** I'm building first-party analytics into the existing Supabase database:
- no cookies, no third-party script;
- works for guests, using a random device id kept on the device;
- a private founder dashboard only your account can open.

It needs one database change on production, which **I'll ask before applying**.

### Not needed now
- Google sign-in (postponed).
- A custom auth domain (a Supabase paid add-on).
- Supabase Realtime: the races use it lightly; the daily game doesn't.
- Supabase Storage.
- A second hosting account.

## Running costs

### What I assumed

- **First visit:** about 0.5 MB (game code 250 KB compressed, fonts, word lists, the day's questions).
- **Returning visit:** about 0.1 MB.
- **Database work:** about 30 small requests per player a day.
- **AI checking:** if on, about 2% of answers are new and not cached; 15 answers per player a day; about $0.001 per check on a small model. The share of new answers falls as the cache fills.

### Monthly cost at each size

| | 100 players a day | 1,000 a day | 10,000 a day |
|---|---|---|---|
| Vercel Hobby | free (≈1.5 GB of 100 GB) | free (≈15 GB) | ≈150 GB: **over Hobby's 100 GB**. Pro $20, or put Cloudflare's free CDN in front |
| Supabase | free | free (≈3 GB egress of 5) | **Pro $25** (egress ≈30 GB, 50k-user limit fine) |
| Email (Resend) | free | free | free (resets only) |
| AI checking, if on | <$0.10 | ≈$1 | ≈$10, capped by the budget you set |
| Analytics (first-party) | free | free | free (inside Supabase) |
| Domain | ≈$0.90 | ≈$0.90 | ≈$0.90 |
| **Total** | **≈$1** | **≈$1–2** | **≈$45–55** |

### Surprises to guard against

- **A Reddit spike.** 20,000 visitors in a day is about 10 GB from Vercel (fine) and about 2 GB from Supabase. A big spike can use up Supabase's monthly 5 GB of egress. On the Free plan that means **restrictions, not a bill**: Free never charges you.
- **Pausing.** Supabase pauses Free projects after 7 days with no activity. Not an issue while people play.
- **AI spend.** Capped twice: by the game's own budget and by your Anthropic limit. With the key unset, it costs nothing.
- **Abuse.** Rate limits are already in the database (dives per hour, friend requests, and so on). I'm adding limits for analytics events and answer reports. Turning on Cloudflare Turnstile at sign-up is a later option.
