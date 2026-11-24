-- Iceberg database. Paste this whole file into Supabase: Project → SQL Editor → New query → Run.
-- Safe to run again after an update.
-- It stores each anonymous player's (up to three) recognised answers per question and their deepest one, exposes
-- the counts and score spread the game reads, collects answers waiting for review, and keeps the shared list of
-- reviewed answers.
-- No names, emails or free text from players are shown to anyone: the board only displays answers from the
-- approved category lists, so junk typed into the database never appears in the game.

create table if not exists public.round_plays (
  id bigint generated always as identity primary key,
  day int not null check (day between 1 and 100000),
  round int not null check (round between 1 and 10),
  player text not null check (char_length(player) between 6 and 64),
  answers text[] not null default '{}',             -- the recognised answers this player gave: at most three
  best text,                                        -- the deepest of them (null if nothing counted)
  depth int not null default 0 check (depth between 0 and 1000),  -- that answer's depth in metres when it was given
  created_at timestamptz not null default now(),
  unique (day, round, player)                       -- one play per player per question
);
-- Upgrading from the timed version: add the new columns and the three-answer limit.
alter table public.round_plays add column if not exists best text;
alter table public.round_plays add column if not exists depth int not null default 0;
alter table public.round_plays drop column if exists excluded cascade;
alter table public.round_plays drop constraint if exists round_plays_answers_check;
alter table public.round_plays drop constraint if exists round_plays_three_answers;
alter table public.round_plays add constraint round_plays_three_answers check (cardinality(answers) <= 3) not valid;

-- One row per player per day: their total depth and the depth reached on each question. Used for rankings.
create table if not exists public.day_results (
  id bigint generated always as identity primary key,
  day int not null check (day between 1 and 100000),
  player text not null check (char_length(player) between 6 and 64),
  total int not null check (total between 0 and 5000),
  depths int[] not null default '{}' check (cardinality(depths) <= 10),
  created_at timestamptz not null default now(),
  unique (day, player)
);

create table if not exists public.flags (            -- the review queue: unknown answers and disputes
  id bigint generated always as identity primary key,
  day int not null,
  round int not null,
  player text not null,
  text text not null check (char_length(text) <= 80),
  created_at timestamptz not null default now()
);
-- kind: 'pending' (typed, not recognised), 'pending-dispute' (player says it counts), 'dispute' (player says a rejection is wrong)
alter table public.flags add column if not exists kind text not null default 'dispute' check (char_length(kind) <= 24);

-- Reviewed answers, shared by every player. Written only by the server (api/verify.js with the service role key)
-- or by you in the table editor. The public key can't read or write it.
create table if not exists public.verified_answers (
  category text not null check (char_length(category) <= 40),
  answer_key text not null check (char_length(answer_key) <= 80),   -- lower case, punctuation removed
  status text not null check (status in ('ok', 'invalid')),
  canonical text,                                                   -- the name duplicates collapse to
  reason text,
  source text not null default 'human',                             -- 'ai' or 'human'; a human row is never overwritten
  created_at timestamptz not null default now(),
  primary key (category, answer_key)
);
alter table public.verified_answers enable row level security;

-- What to review first: the unknown answers most players typed.
create or replace view public.review_queue as
  select day, round, lower(text) as answer, count(distinct player)::int as players, bool_or(kind like '%dispute') as disputed
  from public.flags group by day, round, lower(text) order by players desc;
revoke all on public.review_queue from anon;

alter table public.round_plays enable row level security;
alter table public.day_results enable row level security;
alter table public.flags enable row level security;

-- Anyone may add a play or a flag; nobody can read, change or delete the raw rows through the public key.
drop policy if exists "add plays" on public.round_plays;
create policy "add plays" on public.round_plays for insert to anon with check (true);
drop policy if exists "add results" on public.day_results;
create policy "add results" on public.day_results for insert to anon with check (true);
drop policy if exists "add flags" on public.flags;
create policy "add flags" on public.flags for insert to anon with check (true);

-- (Supabase grants this by default; stated here so the file also works on a plain PostgreSQL database.)
grant insert on public.round_plays, public.day_results, public.flags to anon;

-- Aggregates the game reads (views run as their owner, so they can count rows the public key can't see).
-- A share in the game is "players who gave this answer at least once" divided by "players who played the question",
-- so with up to three guesses each, the shares of all answers add up to more than 100%.
create or replace view public.round_players as
  select day, round, count(*)::int as n
  from public.round_plays
  group by day, round;

create or replace view public.answer_counts as
  select p.day, p.round, a as answer, count(distinct p.player)::int as n
  from public.round_plays p, unnest(p.answers) as a
  group by p.day, p.round, a;

-- How many players finished the day on each total. The game turns this into "deeper than X% of players".
create or replace view public.score_counts as
  select day, total, count(*)::int as n
  from public.day_results
  group by day, total;

-- Totals only: safe for anyone to read. The answer counts are not: they would tell someone who has not played
-- yet which answers are rare today. They are handed out by round_counts() below, and only for a question that
-- device has already finished.
revoke all on public.round_players, public.answer_counts from anon, authenticated;
grant select on public.score_counts to anon, authenticated;
grant insert on public.round_plays, public.day_results, public.flags to authenticated;
drop policy if exists "add plays (signed in)" on public.round_plays;
create policy "add plays (signed in)" on public.round_plays for insert to authenticated with check (true);
drop policy if exists "add results (signed in)" on public.day_results;
create policy "add results (signed in)" on public.day_results for insert to authenticated with check (true);
drop policy if exists "add flags (signed in)" on public.flags;
create policy "add flags (signed in)" on public.flags for insert to authenticated with check (true);

create or replace function public.round_counts(p_day int, p_round int, p_player text)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when exists (select 1 from public.round_plays where day = p_day and round = p_round and player = p_player)
    then jsonb_build_object(
      'players', coalesce((select n from public.round_players where day = p_day and round = p_round), 0),
      'counts', coalesce((select jsonb_object_agg(answer, n) from public.answer_counts where day = p_day and round = p_round), '{}'::jsonb))
    else jsonb_build_object('locked', true) end;
$$;
revoke all on function public.round_counts(int, int, text) from public;
grant execute on function public.round_counts(int, int, text) to anon, authenticated;
