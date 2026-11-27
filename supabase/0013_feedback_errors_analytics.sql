-- 0013: playtest feedback, light play events, browser error reports and the owner's analytics views.
-- Safe to run again. Nothing here changes existing tables, scores, players or results.
--
-- Everything is write-only for players: no account needed, no table readable from the game, and every write goes
-- through a function with size checks and rate limits (per tester and overall), so a misbehaving page or a script
-- can't flood the database. Only the owner reads it (Supabase dashboard / SQL editor, or the private.* views below).
-- No names, emails or IP addresses are stored: a tester is the game's random device id.

create table if not exists public.tester_events (
  id bigint generated always as identity primary key,
  tester text not null check (tester ~ '^[a-zA-Z0-9-]{6,64}$'),
  build text not null default 'live' check (build ~ '^[a-z0-9-]{1,16}$'),     -- 'live', 'playtest', 'friends'
  kind text not null check (kind in ('open', 'start', 'question', 'finish', 'feedback', 'survey', 'share')),
  day int check (day between 1 and 100000),
  round int check (round between 0 and 10),
  qkey text check (char_length(qkey) <= 60),
  data jsonb not null default '{}'::jsonb check (pg_column_size(data) <= 2000),
  created_at timestamptz not null default now()
);
create index if not exists tester_events_kind on public.tester_events (kind, created_at);
create index if not exists tester_events_tester on public.tester_events (tester, created_at);
alter table public.tester_events enable row level security;      -- no policies: no direct reads or writes at all

create table if not exists public.client_errors (
  id bigint generated always as identity primary key,
  sig text not null,                                -- a hash of the message and place: the same error is one row a day
  on_day date not null default current_date,
  message text not null check (char_length(message) <= 300),
  place text not null default '' check (char_length(place) <= 200),
  ua text not null default '' check (char_length(ua) <= 160),
  build text not null default 'live' check (char_length(build) <= 16),
  count int not null default 1,
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  unique (sig, on_day)
);
alter table public.client_errors enable row level security;

create or replace function public.log_event(p_tester text, p_kind text, p_day int default null, p_round int default null,
  p_qkey text default null, p_data jsonb default '{}'::jsonb, p_build text default 'live')
returns void language plpgsql security definer set search_path = public as $$
begin
  -- Bad input or over a limit: dropped quietly (the game never waits on this or shows an error).
  if p_tester is null or p_tester !~ '^[a-zA-Z0-9-]{6,64}$' or p_build is null or p_build !~ '^[a-z0-9-]{1,16}$'
     or p_kind not in ('open', 'start', 'question', 'finish', 'feedback', 'survey', 'share')
     or pg_column_size(coalesce(p_data, '{}'::jsonb)) > 2000 or char_length(coalesce(p_qkey, '')) > 60 then return; end if;
  if (select count(*) from public.tester_events where tester = p_tester and created_at > now() - interval '1 hour') >= 300 then return; end if;
  if (select count(*) from public.tester_events where created_at > now() - interval '1 minute') >= 3000 then return; end if;
  insert into public.tester_events (tester, build, kind, day, round, qkey, data)
  values (p_tester, p_build, p_kind, case when p_day between 1 and 100000 then p_day end,
          case when p_round between 0 and 10 then p_round end, p_qkey, coalesce(p_data, '{}'::jsonb));
end $$;

create or replace function public.log_error(p_message text, p_place text default '', p_ua text default '', p_build text default 'live')
returns void language plpgsql security definer set search_path = public as $$
declare v_sig text;
begin
  if p_message is null or char_length(p_message) = 0 then return; end if;
  if (select count(*) from public.client_errors where on_day = current_date) >= 2000 then return; end if;   -- a flood stops here
  v_sig := md5(left(p_message, 300) || '|' || left(coalesce(p_place, ''), 200));
  insert into public.client_errors (sig, message, place, ua, build)
  values (v_sig, left(p_message, 300), left(coalesce(p_place, ''), 200), left(coalesce(p_ua, ''), 160), left(coalesce(p_build, 'live'), 16))
  on conflict (sig, on_day) do update set count = public.client_errors.count + 1, last_at = now()
    where public.client_errors.count < 100000;
end $$;

revoke all on public.tester_events, public.client_errors from anon, authenticated;
revoke all on function public.log_event(text, text, int, int, text, jsonb, text) from public;
revoke all on function public.log_error(text, text, text, text) from public;
grant execute on function public.log_event(text, text, int, int, text, jsonb, text) to anon, authenticated;
grant execute on function public.log_error(text, text, text, text) to anon, authenticated;

-- ---------- The owner's views (schema private: not reachable through the public API) ----------
create schema if not exists private;

-- Daily play: players who submitted any question, and who finished all five (anonymous play, from round_plays /
-- day_results, which the game has always written). These are real counts, nothing estimated.
create or replace view private.daily_activity as
select d.day, d.players_started, coalesce(f.players_finished, 0) as players_finished,
       round(100.0 * coalesce(f.players_finished, 0) / nullif(d.players_started, 0), 1) as finish_pct
from (select day, count(distinct player) as players_started from public.round_plays group by day) d
left join (select day, count(*) as players_finished from public.day_results group by day) f using (day)
order by d.day desc;

-- Retention for signed-in players: of the players whose first dive was on day N, how many came back on N+1 / N+7.
create or replace view private.retention as
with firsts as (select user_id, min(day) as first_day from public.dives group by user_id)
select f.first_day as cohort_day, count(*) as new_players,
       count(*) filter (where exists (select 1 from public.dives d where d.user_id = f.user_id and d.day = f.first_day + 1)) as back_next_day,
       count(*) filter (where exists (select 1 from public.dives d where d.user_id = f.user_id and d.day between f.first_day + 1 and f.first_day + 7)) as back_within_week
from firsts f group by f.first_day order by f.first_day desc;

-- Per question: plays, average depth, and how often nothing counted; answers waiting for review.
create or replace view private.question_health as
select p.day, p.round, count(*) as plays, round(avg(p.depth)) as avg_depth,
       round(100.0 * count(*) filter (where p.best is null) / count(*), 1) as nothing_counted_pct,
       (select count(*) from public.flags fl where fl.day = p.day and fl.round = p.round and fl.kind = 'unknown') as unknown_answers
from public.round_plays p group by p.day, p.round order by p.day desc, p.round;

-- Playtest feedback: each tester's latest tags per question (a tag tapped off again is gone), and the end surveys.
create or replace view private.playtest_feedback as
select distinct on (tester, day, round) tester, build, day, round, qkey, data->'tags' as tags, created_at
from public.tester_events where kind = 'feedback' order by tester, day, round, created_at desc;
create or replace view private.playtest_surveys as
select tester, build, day, data, created_at from public.tester_events where kind = 'survey' order by created_at desc;
-- Playtest engagement: who opened, started, finished, and what each question did (guesses, misses, waiting answers).
create or replace view private.playtest_funnel as
select build, day, count(distinct tester) filter (where kind = 'open') as opened,
       count(distinct tester) filter (where kind = 'start') as started,
       count(distinct tester) filter (where kind = 'finish') as finished,
       count(distinct tester) filter (where kind = 'survey') as surveyed
from public.tester_events group by build, day order by build, day;
create or replace view private.playtest_questions as
select build, day, round, qkey, count(*) as plays,
       round(avg((data->>'counted')::numeric), 2) as avg_counted,
       sum((data->>'invalid')::int) as invalid_answers, sum((data->>'pending')::int) as waiting_answers,
       round(avg((data->>'secs_left')::numeric)) as avg_seconds_left
from public.tester_events where kind = 'question' group by build, day, round, qkey order by build, day, round;

-- Housekeeping the owner can run (or schedule): keep 180 days of events and 60 of errors.
create or replace function private.prune_logs() returns void language sql security definer set search_path = public as $$
  delete from public.tester_events where created_at < now() - interval '180 days';
  delete from public.client_errors where on_day < current_date - 60;
$$;
