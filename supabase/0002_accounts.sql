-- Accounts, usernames, saved dives, streaks, friends, rankings and the rules about who may see what.
-- Paste this whole file into Supabase: Project → SQL Editor → New query → Run. Run 0001 first. Safe to run again.
--
-- How it is protected:
--   * Every table below has row-level security switched on and NO policies, so the public key (signed in or not)
--     cannot read or write a single row directly.
--   * The game talks to the database only through the functions in this file. Each one checks who is asking
--     (auth.uid()) and decides what that player may see. Nothing is hidden by the page alone.
--   * Scores are worked out here, from the answers a player sends and the day's fixed rarity table. The numbers a
--     browser claims are never stored.
--   * Helper functions live in a schema called "private", which the web API does not expose.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Settings and the calendar
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.game_config (key text primary key, value text not null);
insert into public.game_config values ('launch', '2026-11-24'), ('set_count', '15') on conflict (key) do nothing;
alter table public.game_config enable row level security;

-- Days change at each player's own midnight, as in the game. So across the world a day is "open" from the moment
-- it starts in the earliest time zone (UTC+14) until it ends in the last one (UTC-12): 50 hours. A dive can only be
-- handed in while its day is open, and other players' answers for a day are protected for as long as it is open.
create or replace function private.launch_ts() returns timestamptz language sql stable set search_path = public as
  $$ select ((select value from public.game_config where key = 'launch')::date)::timestamp at time zone 'UTC' $$;
create or replace function private.day_opens(n int) returns timestamptz language sql stable set search_path = public, private as
  $$ select private.launch_ts() + (n - 1) * interval '1 day' - interval '14 hours' $$;
create or replace function private.day_closes(n int) returns timestamptz language sql stable set search_path = public, private as
  $$ select private.launch_ts() + n * interval '1 day' + interval '12 hours' $$;
create or replace function private.day_is_open(n int) returns boolean language sql stable set search_path = public, private as
  $$ select n >= 1 and now() >= private.day_opens(n) and now() < private.day_closes(n) $$;
create or replace function private.latest_day() returns int language sql stable set search_path = public, private as
  $$ select greatest(1, floor(extract(epoch from (now() + interval '14 hours' - private.launch_ts())) / 86400)::int + 1) $$;
create or replace function private.oldest_open_day() returns int language sql stable set search_path = public, private as
  $$ select greatest(1, floor(extract(epoch from (now() - interval '12 hours' - private.launch_ts())) / 86400)::int + 1) $$;

-- ---------------------------------------------------------------------------------------------------------------
-- The rarity tables: each set of five questions, and how deep every accepted answer sits.
-- These are fixed when a set is published (files 0003...). A day's scores never move afterwards.
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.answer_sets (
  set_id int primary key,
  questions jsonb not null                           -- [{ "key": "animals", "title": "Animals" }, ...] in order
);
create table if not exists public.set_answers (
  set_id int not null references public.answer_sets on delete cascade,
  round smallint not null check (round between 1 and 5),
  answer text not null,
  share double precision not null,                   -- the fraction of players expected to give it
  depth int not null,                                -- metres: the score it earns
  primary key (set_id, round, answer)
);
-- Every spelling the game recognises for each answer (its name, other names, plural forms), so the database can
-- check that what a player typed really is the answer their browser says it is.
create table if not exists public.set_keys (
  set_id int not null references public.answer_sets on delete cascade,
  round smallint not null,
  key text not null,
  answer text not null,
  primary key (set_id, round, key)
);
create index if not exists set_keys_answer on public.set_keys (set_id, round, answer);
alter table public.set_keys enable row level security;
create schema if not exists extensions;
create extension if not exists unaccent with schema extensions;
create extension if not exists fuzzystrmatch with schema extensions;

-- The game's own rules (validate.js): how a typed answer is tidied up, and its plural forms.
create or replace function private.norm(t text) returns text language sql immutable set search_path = public, private, extensions as $$
  select regexp_replace(btrim(regexp_replace(replace(replace(replace(lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(t, ''))), '&', ' and '), '''', ''), '’', ''), '[^a-z0-9]+', ' ', 'g')), '^(a|an|the|some) ', '')
$$;
create or replace function private.variants(w text) returns text[] language plpgsql immutable set search_path = public, private as $$
declare head text; last text; out text[] := array[w]; irr jsonb := '{"mice":"mouse","geese":"goose","oxen":"ox","teeth":"tooth","people":"person","feet":"foot","children":"child","wolves":"wolf","knives":"knife","leaves":"leaf","cacti":"cactus","octopi":"octopus","fungi":"fungus","dice":"die"}';
begin
  last := substring(w from '([a-z0-9]+)$'); if last is null then return out; end if;
  head := left(w, length(w) - length(last));
  if last like '%ies' and length(last) > 4 then out := out || (head || left(last, -3) || 'y'); end if;
  if last like '%ives' then out := out || (head || left(last, -4) || 'ife'); end if;
  if last like '%ves' then out := out || (head || left(last, -3) || 'f'); end if;
  if last ~ '(s|x|z|ch|sh|o)es$' then out := out || (head || left(last, -2)); end if;
  if last like '%s' and last !~ '(ss|us|is)$' then out := out || (head || left(last, -1)); end if;
  if irr ? last then out := out || (head || (irr ->> last)); end if;
  return out;
end $$;
-- Could what was typed be this answer? The same ways the game accepts it: an exact name or other name, a plural, an
-- extra describing word in front ("baby kangaroo"), or a small typo. If not, the guess is treated as unrecognised.
create or replace function private.claim_ok(p_set int, p_round int, p_typed text, p_answer text) returns boolean language plpgsql stable security definer set search_path = public, private, extensions as $$
declare n text := private.norm(p_typed); words text[]; c text; allow int;
begin
  if n = '' or p_answer is null then return false; end if;
  if exists (select 1 from public.set_keys where set_id = p_set and round = p_round and answer = p_answer and key = any (private.variants(n))) then return true; end if;
  words := string_to_array(n, ' ');
  for i in 2 .. least(3, coalesce(array_length(words, 1), 0)) loop
    c := array_to_string(words[i:], ' ');
    if exists (select 1 from public.set_keys where set_id = p_set and round = p_round and answer = p_answer and key = any (private.variants(c))) then return true; end if;
  end loop;
  allow := case when length(replace(n, ' ', '')) <= 4 then 0 when length(replace(n, ' ', '')) <= 8 then 1 else 2 end;
  if allow = 0 then return false; end if;
  -- (A swapped pair of letters counts as one mistake in the game, two here: so allow one more when the lengths match.)
  return exists (select 1 from public.set_keys k where k.set_id = p_set and k.round = p_round and k.answer = p_answer and left(k.key, 1) = left(n, 1)
    and abs(length(k.key) - length(n)) <= allow and extensions.levenshtein(n, k.key) <= allow + case when length(k.key) = length(n) then 1 else 0 end);
end $$;

create table if not exists public.days (              -- which set a day used, fixed the first time the day is touched
  day int primary key check (day >= 1),
  set_id int not null references public.answer_sets
);
alter table public.answer_sets enable row level security;
alter table public.set_answers enable row level security;
alter table public.days enable row level security;

create or replace function private.day_set(n int) returns int language plpgsql security definer set search_path = public, private as $$
declare v int;
begin
  select set_id into v from public.days where day = n;
  if v is null then
    -- A day with prepared content (0006_content.sql) uses its own question set; other days keep the original rotation.
    if to_regclass('public.content_days') is not null then execute 'select set_id from public.content_days where day = $1' into v using n; end if;
    v := coalesce(v, ((n - 1) % (select value::int from public.game_config where key = 'set_count')) + 1);
    insert into public.days values (n, v) on conflict (day) do nothing;
    select set_id into v from public.days where day = n;
  end if;
  return v;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Players
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null check (username ~ '^[A-Za-z][A-Za-z0-9_]{2,19}$'),
  avatar text not null default 'dumbo' check (avatar ~ '^[a-z]{2,16}$'),
  created_at timestamptz not null default now(),
  username_changed_at timestamptz,
  -- Privacy. Friends only ever means accepted friends; nothing here is shown to strangers except a name in a ranking.
  searchable boolean not null default true,          -- can be found by username
  ranked boolean not null default true,              -- appears in the global ranking
  share_dives boolean not null default true,         -- friends may explore my completed icebergs
  share_answers boolean not null default true,       -- ... and see the answers themselves (off: depths only)
  share_calendar boolean not null default true       -- friends may see my activity calendar
);
create unique index if not exists profiles_username_key on public.profiles (lower(username));  -- unique whatever the capitals
alter table public.profiles enable row level security;

create table if not exists public.player_stats (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  current_streak int not null default 0, streak_last_day int not null default 0, longest_streak int not null default 0,
  total_dives int not null default 0, first_day int, sum_total bigint not null default 0,
  best_total int not null default 0, best_total_day int,
  best_depth int not null default 0, best_depth_day int, best_depth_answer text
);
alter table public.player_stats enable row level security;

create table if not exists public.reserved_names (name text primary key);
insert into public.reserved_names values ('admin'), ('administrator'), ('moderator'), ('mod'), ('support'), ('staff'), ('system'), ('official'),
  ('iceberg'), ('oddfish'), ('brinicle'), ('dropstone'), ('hadal'), ('thirddive'), ('help'), ('root'), ('owner'), ('team'), ('dev'), ('developer'),
  ('anonymous'), ('guest'), ('player'), ('you'), ('me'), ('null'), ('undefined'), ('everyone'), ('nobody'), ('deleted'), ('security'), ('abuse'), ('info'), ('contact')
  on conflict do nothing;
-- Basic moderation. "anywhere" terms are refused wherever they appear; the rest only as the whole name, because
-- they also sit inside ordinary words. Add to this list in the table editor.
create table if not exists public.banned_terms (term text primary key, anywhere boolean not null default true);
insert into public.banned_terms values ('fuck', true), ('shit', true), ('cunt', true), ('bitch', true), ('nigg', true), ('fagg', true), ('hitler', true), ('nazi', true),
  ('whore', true), ('slut', true), ('porn', true), ('rapist', true), ('pussy', true), ('retard', true), ('kike', true), ('tranny', true), ('penis', true), ('vagina', true),
  ('pedo', true), ('kkk', true), ('sex', false), ('dick', false), ('cock', false), ('rape', false), ('fag', false), ('anal', false), ('cum', false), ('tit', false), ('ass', false)
  on conflict do nothing;
-- A name someone has just given up (by changing it or deleting their account) is kept aside for 30 days, so nobody
-- can grab it and pass themselves off as that player.
create table if not exists public.username_holds (name text primary key, user_id uuid, until timestamptz not null);
alter table public.reserved_names enable row level security;
alter table public.banned_terms enable row level security;
alter table public.username_holds enable row level security;

-- Why a username can't be used, or null if it can.
create or replace function private.username_problem(p_name text, p_user uuid) returns text language plpgsql stable security definer set search_path = public, private as $$
declare low text := lower(coalesce(p_name, '')); plain text;
begin
  if p_name is null or p_name !~ '^[A-Za-z][A-Za-z0-9_]{2,19}$' then return 'format'; end if;
  plain := translate(replace(low, '_', ''), '013457', 'oieast');           -- so "4dm1n" reads as "admin"
  if exists (select 1 from public.reserved_names where name in (low, plain, replace(low, '_', ''))) then return 'reserved'; end if;
  if exists (select 1 from public.banned_terms where (anywhere and (position(term in plain) > 0 or position(term in low) > 0)) or (not anywhere and term in (plain, low))) then return 'unsuitable'; end if;
  if exists (select 1 from public.profiles where lower(username) = low and id is distinct from p_user) then return 'taken'; end if;
  if exists (select 1 from public.username_holds where name = low and until > now() and (user_id is null or user_id is distinct from p_user)) then return 'taken'; end if;
  return null;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Dives: one finished day by one player, with every guess exactly as it was scored.
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.dives (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  day int not null check (day >= 1),
  set_id int not null references public.answer_sets,
  total int not null, max_depth int not null,
  depths int[] not null,                             -- the five questions' best depths, in order
  deepest_round smallint, deepest_answer text,
  source text not null default 'play' check (source in ('play', 'guest')),   -- 'guest': played before signing in, handed in later
  ranked boolean not null default true,              -- counts in the global ranking for its day
  completed_at timestamptz not null default now(),
  unique (user_id, day)                              -- one dive per player per day, on any number of devices
);
create index if not exists dives_ranking on public.dives (day, total desc, max_depth desc, completed_at, id);
create table if not exists public.dive_guesses (
  dive_id bigint not null references public.dives on delete cascade,
  round smallint not null check (round between 1 and 5),
  slot smallint not null check (slot between 1 and 3),
  typed text not null check (char_length(typed) <= 60),
  answer text,                                       -- the accepted answer it counted as (null if it did not count)
  status text not null check (status in ('ok', 'pending', 'miss')),
  share double precision, depth int,                 -- copied from the rarity table when the dive was scored: they never change
  is_best boolean not null default false,
  sight text check (sight in ('giant', 'bigfin', 'colossal')),
  primary key (dive_id, round, slot)
);
alter table public.dives enable row level security;
alter table public.dive_guesses enable row level security;

-- Streaks and records, recounted from the dives themselves every time one is added. Nothing is incremented, so a
-- refresh, a second device or a replay cannot push a streak up.
create or replace function private.recount(p_user uuid) returns void language plpgsql security definer set search_path = public, private as $$
declare s record; cur_n int := 0; cur_hi int := 0; longest int := 0; bt record; bd record;
begin
  select count(*)::int n, min(day) first_day, coalesce(sum(total), 0) sum_total into s from public.dives where user_id = p_user;
  with runs as (select day, day - row_number() over (order by day) as g from public.dives where user_id = p_user),
       islands as (select count(*)::int n, max(day) hi from runs group by g)
  select coalesce(max(n), 0), coalesce((select n from islands order by hi desc limit 1), 0), coalesce(max(hi), 0) into longest, cur_n, cur_hi from islands;
  select total, day into bt from public.dives where user_id = p_user order by total desc, day limit 1;
  select max_depth, day, deepest_answer into bd from public.dives where user_id = p_user order by max_depth desc, day limit 1;
  insert into public.player_stats as ps (user_id, current_streak, streak_last_day, longest_streak, total_dives, first_day, sum_total, best_total, best_total_day, best_depth, best_depth_day, best_depth_answer)
  values (p_user, cur_n, cur_hi, longest, s.n, s.first_day, s.sum_total, coalesce(bt.total, 0), bt.day, coalesce(bd.max_depth, 0), bd.day, bd.deepest_answer)
  on conflict (user_id) do update set current_streak = excluded.current_streak, streak_last_day = excluded.streak_last_day, longest_streak = excluded.longest_streak,
    total_dives = excluded.total_dives, first_day = excluded.first_day, sum_total = excluded.sum_total, best_total = excluded.best_total, best_total_day = excluded.best_total_day,
    best_depth = excluded.best_depth, best_depth_day = excluded.best_depth_day, best_depth_answer = excluded.best_depth_answer;
end $$;
-- A streak still counts as alive on the day after its last dive (the player has until their midnight to extend it).
create or replace function private.live_streak(p_streak int, p_last int) returns int language sql stable set search_path = public, private as
  $$ select case when p_last >= private.oldest_open_day() - 1 then p_streak else 0 end $$;

-- Score one day's guesses and store them. The browser sends only what was typed and which accepted answer it
-- counted as; shares, depths, the best answer and the total all come from the rarity table here.
create or replace function private.store_dive(p_user uuid, p_day int, p_guesses jsonb, p_source text, p_ranked boolean) returns bigint
language plpgsql security definer set search_path = public, private as $$
declare v_set int := private.day_set(p_day); v_dive bigint; g jsonb; r int; sl int; v_typed text; v_answer text; v_status text; v_share double precision; v_depth int; v_sight text;
  v_key text; v_depths int[] := array[0, 0, 0, 0, 0]; v_total int; v_max int; v_dr int; v_da text;
begin
  if jsonb_typeof(p_guesses) <> 'array' or jsonb_array_length(p_guesses) > 15 then raise exception 'bad_guesses'; end if;
  insert into public.dives (user_id, day, set_id, total, max_depth, depths, source, ranked) values (p_user, p_day, v_set, 0, 0, v_depths, p_source, p_ranked) returning id into v_dive;
  for g in select * from jsonb_array_elements(p_guesses) loop
    r := (g->>'round')::int; sl := (g->>'slot')::int; v_typed := left(coalesce(g->>'typed', ''), 60); v_answer := nullif(left(coalesce(g->>'answer', ''), 80), '');
    v_status := case when g->>'status' in ('ok', 'pending', 'miss') then g->>'status' else 'miss' end; v_share := null; v_depth := null;
    if r is null or sl is null or r not between 1 and 5 or sl not between 1 and 3 then raise exception 'bad_guesses'; end if;
    if exists (select 1 from public.dive_guesses where dive_id = v_dive and round = r and slot = sl) then raise exception 'bad_guesses'; end if;   -- three guesses a question, each used once
    if v_status = 'ok' then
      if v_answer is not null then
        select share, depth into v_share, v_depth from public.set_answers where set_id = v_set and round = r and answer = v_answer;
        if v_depth is not null and not private.claim_ok(v_set, r, v_typed, v_answer) then v_depth := null; end if;   -- typed one thing, claimed another
      else   -- approved by review but not in the table yet: a fixed, modest depth
        v_key := (select q->>'key' from public.answer_sets s, jsonb_array_elements(s.questions) with ordinality as t(q, i) where s.set_id = v_set and t.i = r);
        if exists (select 1 from public.verified_answers where category = v_key and status = 'ok' and answer_key = btrim(regexp_replace(lower(v_typed), '[^a-z0-9]+', ' ', 'g'))) then v_share := 0.03; v_depth := 52; end if;
      end if;
      if v_depth is null then v_status := 'pending'; v_answer := null;                                           -- not an answer this day accepts: no depth
      elsif v_answer is not null and exists (select 1 from public.dive_guesses where dive_id = v_dive and round = r and answer = v_answer) then v_status := 'miss'; v_share := null; v_depth := null;   -- the same answer twice counts once
      end if;
    else v_answer := null;
    end if;
    v_sight := case when g->>'sight' = 'colossal' and v_depth >= 300 then 'colossal' when g->>'sight' = 'bigfin' and v_depth >= 250 then 'bigfin' when g->>'sight' = 'giant' and v_depth >= 200 then 'giant' end;
    insert into public.dive_guesses (dive_id, round, slot, typed, answer, status, share, depth, sight) values (v_dive, r, sl, v_typed, v_answer, v_status, v_share, v_depth, v_sight);
  end loop;
  -- The deepest answer of each question counts; equal depths keep the earlier guess.
  update public.dive_guesses d set is_best = true from (select distinct on (round) round, slot from public.dive_guesses where dive_id = v_dive and status = 'ok' order by round, share, slot) b
    where d.dive_id = v_dive and d.round = b.round and d.slot = b.slot;
  select coalesce(array_agg(coalesce(b.depth, 0) order by q.r), v_depths) into v_depths from generate_series(1, 5) q(r) left join public.dive_guesses b on b.dive_id = v_dive and b.round = q.r and b.is_best;
  select coalesce(sum(x), 0), coalesce(max(x), 0) into v_total, v_max from unnest(v_depths) x;
  select round, coalesce(answer, typed) into v_dr, v_da from public.dive_guesses where dive_id = v_dive and is_best order by depth desc, round limit 1;
  update public.dives set total = v_total, max_depth = v_max, depths = v_depths, deepest_round = v_dr, deepest_answer = v_da where id = v_dive;
  perform private.recount(p_user);
  return v_dive;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Friends and blocks
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.friendships (
  a uuid not null references public.profiles (id) on delete cascade,
  b uuid not null references public.profiles (id) on delete cascade,
  status text not null check (status in ('pending', 'accepted')),
  requested_by uuid not null,
  created_at timestamptz not null default now(), responded_at timestamptz,
  primary key (a, b), check (a < b)                  -- one row per pair, whoever asked
);
create index if not exists friendships_b on public.friendships (b);
create table if not exists public.blocks (
  blocker uuid not null references public.profiles (id) on delete cascade,
  blocked uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked)
);
create table if not exists public.rate_log (user_id uuid not null, action text not null, at timestamptz not null default now());
create index if not exists rate_log_lookup on public.rate_log (user_id, action, at);
alter table public.friendships enable row level security;
alter table public.blocks enable row level security;
alter table public.rate_log enable row level security;

create or replace function private.are_friends(x uuid, y uuid) returns boolean language sql stable security definer set search_path = public as
  $$ select exists (select 1 from public.friendships where a = least(x, y) and b = greatest(x, y) and status = 'accepted') $$;
create or replace function private.blocked_between(x uuid, y uuid) returns boolean language sql stable security definer set search_path = public as
  $$ select exists (select 1 from public.blocks where (blocker = x and blocked = y) or (blocker = y and blocked = x)) $$;
-- Too many of one action in a short time stops with an error the game shows as "slow down".
create or replace function private.limit_rate(p_action text, p_max int, p_per interval) returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.rate_log where user_id = auth.uid() and action = p_action and at < now() - p_per;
  if (select count(*) from public.rate_log where user_id = auth.uid() and action = p_action) >= p_max then raise exception 'rate_limited'; end if;
  insert into public.rate_log (user_id, action) values (auth.uid(), p_action);
end $$;
create or replace function private.me() returns uuid language plpgsql stable security definer set search_path = public as $$
declare v uuid := auth.uid();
begin
  if v is null then raise exception 'not_signed_in'; end if;
  if not exists (select 1 from public.profiles where id = v) then raise exception 'no_profile'; end if;
  return v;
end $$;
create or replace function private.find_user(p_username text) returns uuid language sql stable security definer set search_path = public as
  $$ select id from public.profiles where lower(username) = lower(p_username) $$;
-- The spoiler rule, in one place. A player may see other people's answers for a day once they have handed in
-- their own dive for it, or once the day has closed everywhere and can no longer be played.
create or replace function private.can_see_day(p_viewer uuid, p_day int) returns boolean language sql stable security definer set search_path = public, private as
  $$ select now() >= private.day_closes(p_day) or (p_viewer is not null and exists (select 1 from public.dives where user_id = p_viewer and day = p_day)) $$;
create or replace function private.relation(p_me uuid, p_other uuid) returns text language sql stable security definer set search_path = public as $$
  select case when p_me = p_other then 'self'
    else coalesce((select case when status = 'accepted' then 'friend' when requested_by = p_me then 'requested' else 'incoming' end
                   from public.friendships where a = least(p_me, p_other) and b = greatest(p_me, p_other)), 'none') end $$;
-- Where a dive stands among the ranked dives of its day. Order: total depth, then the deepest single answer,
-- then who finished first. Every place is distinct.
create or replace function private.rank_of(p_dive bigint) returns jsonb language sql stable security definer set search_path = public as $$
  with me as (select * from public.dives where id = p_dive),
       field as (select d.* from public.dives d join public.profiles p on p.id = d.user_id, me where d.day = me.day and ((d.ranked and p.ranked) or d.id = me.id))
  select jsonb_build_object('players', (select count(*) from field),
    'rank', (select count(*) + 1 from field f, me where (f.total, f.max_depth) > (me.total, me.max_depth) or ((f.total, f.max_depth) = (me.total, me.max_depth) and (f.completed_at, f.id) < (me.completed_at, me.id))),
    'ranked', (select me.ranked and (select ranked from public.profiles where id = me.user_id) from me)) $$;

-- ===============================================================================================================
-- What the game may call
-- ===============================================================================================================

-- Is this username free? (Anyone may ask; it says nothing about who has it.)
create or replace function public.username_check(p_username text) returns jsonb language sql stable security definer set search_path = public, private as
  $$ select jsonb_build_object('ok', private.username_problem(p_username, auth.uid()) is null, 'reason', private.username_problem(p_username, auth.uid())) $$;

-- Choose a username: the step that turns a signed-in person into a player.
create or replace function public.claim_profile(p_username text, p_avatar text default 'dumbo') returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v uuid := auth.uid(); why text;
begin
  if v is null then raise exception 'not_signed_in'; end if;
  if exists (select 1 from public.profiles where id = v) then raise exception 'already_has_profile'; end if;
  why := private.username_problem(p_username, v);
  if why is not null then raise exception 'username_%', why; end if;
  insert into public.profiles (id, username, avatar) values (v, p_username, case when p_avatar ~ '^[a-z]{2,16}$' then p_avatar else 'dumbo' end);
  insert into public.player_stats (user_id) values (v);
  delete from public.username_holds where name = lower(p_username);
  return public.me();
exception when unique_violation then raise exception 'username_taken';
end $$;

-- Everything about the signed-in player that their own screens need. Null until a username is chosen.
create or replace function public.me() returns jsonb language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object('username', p.username, 'avatar', p.avatar, 'since', p.created_at, 'username_changed_at', p.username_changed_at,
    'settings', jsonb_build_object('searchable', p.searchable, 'ranked', p.ranked, 'share_dives', p.share_dives, 'share_answers', p.share_answers, 'share_calendar', p.share_calendar),
    'stats', jsonb_build_object('streak', private.live_streak(s.current_streak, s.streak_last_day), 'streak_raw', s.current_streak, 'streak_last_day', s.streak_last_day, 'longest', s.longest_streak, 'dives', s.total_dives, 'first_day', s.first_day,
      'average', case when s.total_dives > 0 then round(s.sum_total::numeric / s.total_dives) else 0 end, 'best_total', s.best_total, 'best_total_day', s.best_total_day,
      'best_depth', s.best_depth, 'best_depth_day', s.best_depth_day, 'best_depth_answer', s.best_depth_answer),
    'requests', (select count(*) from public.friendships f where (f.a = p.id or f.b = p.id) and f.status = 'pending' and f.requested_by <> p.id),
    'latest_day', private.latest_day())
  from public.profiles p join public.player_stats s on s.user_id = p.id where p.id = auth.uid() $$;

create or replace function public.update_settings(p jsonb) returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v uuid := private.me();
begin
  update public.profiles set
    searchable = coalesce((p->>'searchable')::boolean, searchable), ranked = coalesce((p->>'ranked')::boolean, ranked),
    share_dives = coalesce((p->>'share_dives')::boolean, share_dives), share_answers = coalesce((p->>'share_answers')::boolean, share_answers),
    share_calendar = coalesce((p->>'share_calendar')::boolean, share_calendar),
    avatar = case when p->>'avatar' ~ '^[a-z]{2,16}$' then p->>'avatar' else avatar end
  where id = v;
  return public.me();
end $$;

-- A new username: at most once every 14 days, and the old one is kept aside for 30.
create or replace function public.change_username(p_username text) returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v uuid := private.me(); why text; old record;
begin
  select username, username_changed_at into old from public.profiles where id = v;
  if lower(old.username) = lower(p_username) then          -- only the capitals change: always allowed
    update public.profiles set username = p_username where id = v; return public.me();
  end if;
  if old.username_changed_at > now() - interval '14 days' then raise exception 'username_too_soon'; end if;
  why := private.username_problem(p_username, v);
  if why is not null then raise exception 'username_%', why; end if;
  insert into public.username_holds values (lower(old.username), v, now() + interval '30 days') on conflict (name) do update set user_id = excluded.user_id, until = excluded.until;
  update public.profiles set username = p_username, username_changed_at = now() where id = v;
  delete from public.username_holds where name = lower(p_username);
  return public.me();
exception when unique_violation then raise exception 'username_taken';
end $$;

-- Delete the account and everything attached to it: profile, dives, friendships. It cannot be undone.
create or replace function public.delete_account() returns void language plpgsql security definer set search_path = public, private as $$
declare v uuid := auth.uid();
begin
  if v is null then raise exception 'not_signed_in'; end if;
  insert into public.username_holds select lower(username), null, now() + interval '30 days' from public.profiles where id = v on conflict (name) do update set user_id = null, until = excluded.until;
  delete from public.rate_log where user_id = v;
  delete from auth.users where id = v;                   -- the profile and all it owns go with it
end $$;

-- Hand in today's dive. One per day, whichever device it comes from; a second attempt returns the first.
create or replace function public.submit_dive(p_day int, p_guesses jsonb) returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v uuid := private.me(); v_dive bigint; was record; now_s record; fresh boolean := false;
begin
  select id into v_dive from public.dives where user_id = v and day = p_day;
  if v_dive is null then
    if not private.day_is_open(p_day) then raise exception 'day_closed'; end if;
    perform private.limit_rate('dive', 6, interval '1 hour');
    select current_streak, streak_last_day into was from public.player_stats where user_id = v;
    v_dive := private.store_dive(v, p_day, p_guesses, 'play', true); fresh := true;
  end if;
  select * into now_s from public.player_stats where user_id = v;
  return (select jsonb_build_object('day', d.day, 'total', d.total, 'max_depth', d.max_depth, 'depths', d.depths, 'deepest_answer', d.deepest_answer, 'saved', fresh,
      'streak', private.live_streak(now_s.current_streak, now_s.streak_last_day), 'longest', now_s.longest_streak,
      'extended', fresh and now_s.streak_last_day = p_day and now_s.current_streak > 1 and was.streak_last_day = p_day - 1) || private.rank_of(d.id)
    from public.dives d where d.id = v_dive);
exception when unique_violation then                    -- two devices at the same moment: the first one stands
  return public.submit_dive(p_day, p_guesses);
end $$;

-- Bring in days played as a guest on this device. Days already on the account are left alone, so nothing is
-- counted twice. Days that have closed are kept as history but do not enter that day's ranking after the fact.
create or replace function public.import_dives(p_dives jsonb) returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v uuid := private.me(); d jsonb; n int; res jsonb := '[]'::jsonb; state text; earliest int;
begin
  if jsonb_typeof(p_dives) <> 'array' or jsonb_array_length(p_dives) > 90 then raise exception 'bad_dives'; end if;
  perform private.limit_rate('import', 5, interval '1 day');
  earliest := greatest(1, private.latest_day() - 90);
  for d in select * from jsonb_array_elements(p_dives) loop
    n := (d->>'day')::int;
    if n is null or n < earliest or n > private.latest_day() then state := 'refused';
    elsif exists (select 1 from public.dives where user_id = v and day = n) then state := 'kept';
    else
      begin perform private.store_dive(v, n, d->'guesses', 'guest', private.day_is_open(n)); state := 'saved';
      exception when others then state := 'refused'; end;
    end if;
    res := res || jsonb_build_object('day', n, 'state', state);
  end loop;
  return res;
end $$;

-- My own history, for the calendar and for restoring progress on a new device.
create or replace function public.my_dives(p_from int default 1, p_to int default 100000) returns jsonb language sql stable security definer set search_path = public, private as $$
  select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'set', d.set_id, 'total', d.total, 'max_depth', d.max_depth, 'depths', d.depths, 'deepest_round', d.deepest_round,
      'deepest_answer', d.deepest_answer, 'source', d.source) || private.rank_of(d.id) order by d.day), '[]'::jsonb)
  from public.dives d where d.user_id = private.me() and d.day between p_from and p_to $$;

-- One finished dive, guess by guess: mine, or a friend's if they allow it and the spoiler rule is met.
create or replace function public.get_dive(p_username text, p_day int) returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare v uuid := private.me(); o public.profiles; d public.dives; own boolean; names boolean;
begin
  select * into o from public.profiles where lower(username) = lower(p_username);
  if o.id is null or private.blocked_between(v, o.id) then raise exception 'not_found'; end if;
  own := o.id = v;
  if not own and not private.are_friends(v, o.id) then raise exception 'friends_only'; end if;
  if not own and not o.share_dives then raise exception 'private'; end if;
  if not own and not private.can_see_day(v, p_day) then raise exception 'locked'; end if;   -- finish your own dive first
  select * into d from public.dives where user_id = o.id and day = p_day;
  if d.id is null then raise exception 'no_dive'; end if;
  names := own or o.share_answers;
  return jsonb_build_object('username', o.username, 'avatar', o.avatar, 'own', own, 'day', d.day, 'set', d.set_id, 'total', d.total, 'max_depth', d.max_depth, 'depths', d.depths,
    'answers_hidden', not names, 'source', d.source,
    'guesses', (select coalesce(jsonb_agg(jsonb_build_object('round', g.round, 'slot', g.slot, 'status', g.status, 'share', g.share, 'depth', g.depth, 'best', g.is_best, 'sight', g.sight,
        'answer', case when names then g.answer end, 'typed', case when names then g.typed end) order by g.round, g.slot), '[]'::jsonb) from public.dive_guesses g where g.dive_id = d.id))
    || private.rank_of(d.id);
end $$;

-- Someone's profile, as much of it as the person asking may see.
create or replace function public.profile_of(p_username text) returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare v uuid := private.me(); o public.profiles; s public.player_stats; rel text; close boolean; cal jsonb := null;
begin
  select * into o from public.profiles where lower(username) = lower(p_username);
  if o.id is null or private.blocked_between(v, o.id) then raise exception 'not_found'; end if;
  select * into s from public.player_stats where user_id = o.id;
  rel := private.relation(v, o.id); close := rel in ('self', 'friend');
  if rel = 'self' or (rel = 'friend' and o.share_calendar) then
    select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'total', d.total, 'max_depth', d.max_depth,
        'deepest_answer', case when (rel = 'self' or o.share_answers) and private.can_see_day(v, d.day) then d.deepest_answer end) || private.rank_of(d.id) order by d.day), '[]'::jsonb)
      into cal from public.dives d where d.user_id = o.id and d.day > private.latest_day() - 371;
  end if;
  return jsonb_build_object('username', o.username, 'avatar', o.avatar, 'since', o.created_at, 'relation', rel, 'latest_day', private.latest_day(),
    'can_explore', rel = 'self' or (rel = 'friend' and o.share_dives),
    'stats', jsonb_build_object('streak', private.live_streak(s.current_streak, s.streak_last_day), 'longest', s.longest_streak, 'dives', s.total_dives, 'first_day', s.first_day)
      || case when close then jsonb_build_object('average', case when s.total_dives > 0 then round(s.sum_total::numeric / s.total_dives) else 0 end,
           'best_total', s.best_total, 'best_total_day', s.best_total_day, 'best_depth', s.best_depth, 'best_depth_day', s.best_depth_day,
           'best_depth_answer', case when (rel = 'self' or o.share_answers) and private.can_see_day(v, s.best_depth_day) then s.best_depth_answer end) else '{}'::jsonb end,
    'calendar', cal,
    'friends', case when rel = 'self' then (select count(*) from public.friendships f where (f.a = o.id or f.b = o.id) and f.status = 'accepted') end);
end $$;

-- Find players by the start of their username.
create or replace function public.search_users(p_query text) returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v uuid := private.me(); q text := lower(btrim(coalesce(p_query, '')));
begin
  if q !~ '^[a-z0-9_]{2,20}$' then return '[]'::jsonb; end if;
  perform private.limit_rate('search', 40, interval '1 minute');
  return (select coalesce(jsonb_agg(jsonb_build_object('username', username, 'avatar', avatar, 'relation', private.relation(v, id)) order by lower(username) = q desc, lower(username)), '[]'::jsonb)
    from (select * from public.profiles p where lower(p.username) like replace(replace(q, '\', '\\'), '_', '\_') || '%' and p.id <> v and p.searchable and not private.blocked_between(v, p.id)
          order by lower(p.username) = q desc, lower(p.username) limit 8) t);
end $$;

-- Ask to be friends. If they have already asked me, this accepts. A blocked request looks exactly like a sent one.
create or replace function public.friend_request(p_username text) returns text language plpgsql security definer set search_path = public, private as $$
declare v uuid := private.me(); o uuid := private.find_user(p_username); f public.friendships;
begin
  if o is null then raise exception 'not_found'; end if;
  if o = v then raise exception 'yourself'; end if;
  perform private.limit_rate('friend_request', 20, interval '1 hour');
  if exists (select 1 from public.blocks where blocker = v and blocked = o) then raise exception 'you_blocked_them'; end if;
  if exists (select 1 from public.blocks where blocker = o and blocked = v) then return 'requested'; end if;
  select * into f from public.friendships where a = least(v, o) and b = greatest(v, o);
  if f.status = 'accepted' then return 'friend'; end if;
  if f.status = 'pending' and f.requested_by = v then return 'requested'; end if;
  if f.status = 'pending' then update public.friendships set status = 'accepted', responded_at = now() where a = f.a and b = f.b; return 'friend'; end if;
  if (select count(*) from public.friendships where requested_by = v and status = 'pending') >= 50 then raise exception 'too_many_requests'; end if;
  if (select count(*) from public.friendships where (a = v or b = v) and status = 'accepted') >= 200 then raise exception 'too_many_friends'; end if;
  insert into public.friendships (a, b, status, requested_by) values (least(v, o), greatest(v, o), 'pending', v);
  return 'requested';
end $$;
create or replace function public.friend_respond(p_username text, p_accept boolean) returns text language plpgsql security definer set search_path = public, private as $$
declare v uuid := private.me(); o uuid := private.find_user(p_username);
begin
  if o is null or not exists (select 1 from public.friendships where a = least(v, o) and b = greatest(v, o) and status = 'pending' and requested_by = o) then raise exception 'no_request'; end if;
  if p_accept then update public.friendships set status = 'accepted', responded_at = now() where a = least(v, o) and b = greatest(v, o); return 'friend'; end if;
  delete from public.friendships where a = least(v, o) and b = greatest(v, o); return 'none';
end $$;
-- Withdraw a request I sent, or end a friendship. Either side can do either.
create or replace function public.friend_remove(p_username text) returns text language plpgsql security definer set search_path = public, private as $$
declare v uuid := private.me(); o uuid := private.find_user(p_username);
begin
  if o is null then raise exception 'not_found'; end if;
  delete from public.friendships where a = least(v, o) and b = greatest(v, o) and (status = 'accepted' or requested_by = v);
  return 'none';
end $$;
-- Block: ends any friendship or request, and from then on neither can find, view or ask the other.
create or replace function public.block_user(p_username text, p_block boolean default true) returns text language plpgsql security definer set search_path = public, private as $$
declare v uuid := private.me(); o uuid := private.find_user(p_username);
begin
  if o is null or o = v then raise exception 'not_found'; end if;
  if p_block then
    delete from public.friendships where a = least(v, o) and b = greatest(v, o);
    insert into public.blocks (blocker, blocked) values (v, o) on conflict do nothing; return 'blocked';
  end if;
  delete from public.blocks where blocker = v and blocked = o; return 'none';
end $$;

-- My friends, with who has dived on the given day. Their scores for that day come only once I may see them.
create or replace function public.friends(p_day int) returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare v uuid := private.me(); open_to_me boolean := private.can_see_day(v, p_day);
begin
  return jsonb_build_object('day', p_day, 'unlocked', open_to_me,
    'me', (select jsonb_build_object('total', total, 'max_depth', max_depth) from public.dives where user_id = v and day = p_day),
    'friends', (select coalesce(jsonb_agg(jsonb_build_object('username', p.username, 'avatar', p.avatar, 'streak', private.live_streak(s.current_streak, s.streak_last_day), 'done', d.id is not null,
          'total', case when open_to_me then d.total end, 'max_depth', case when open_to_me then d.max_depth end, 'can_explore', p.share_dives) order by d.total desc nulls last, lower(p.username)), '[]'::jsonb)
        from public.friendships f join public.profiles p on p.id = case when f.a = v then f.b else f.a end join public.player_stats s on s.user_id = p.id
          left join public.dives d on d.user_id = p.id and d.day = p_day
        where (f.a = v or f.b = v) and f.status = 'accepted'),
    'incoming', (select coalesce(jsonb_agg(jsonb_build_object('username', p.username, 'avatar', p.avatar) order by f.created_at), '[]'::jsonb)
        from public.friendships f join public.profiles p on p.id = f.requested_by where (f.a = v or f.b = v) and f.status = 'pending' and f.requested_by <> v),
    'outgoing', (select coalesce(jsonb_agg(jsonb_build_object('username', p.username, 'avatar', p.avatar) order by f.created_at), '[]'::jsonb)
        from public.friendships f join public.profiles p on p.id = case when f.a = v then f.b else f.a end where (f.a = v or f.b = v) and f.status = 'pending' and f.requested_by = v),
    'blocked', (select coalesce(jsonb_agg(p.username order by lower(p.username)), '[]'::jsonb) from public.blocks b join public.profiles p on p.id = b.blocked where b.blocker = v));
end $$;

-- A day's ranking: everyone ranked ('global') or me and my friends ('friends'). Locked until I may see the day.
-- Signed-out visitors may read the global ranking of days that have closed.
create or replace function public.leaderboard(p_day int, p_scope text default 'global', p_limit int default 50, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare v uuid := auth.uid(); res jsonb;
begin
  if v is not null and not exists (select 1 from public.profiles where id = v) then v := null; end if;
  if p_scope = 'friends' and v is null then raise exception 'not_signed_in'; end if;
  if not private.can_see_day(v, p_day) then
    return jsonb_build_object('day', p_day, 'scope', p_scope, 'locked', true, 'closes_at', private.day_closes(p_day),
      'players', case when p_scope = 'global' then (select count(*) from public.dives d join public.profiles p on p.id = d.user_id where d.day = p_day and d.ranked and p.ranked) end);
  end if;
  with field as (
    select d.*, p.username, p.avatar from public.dives d join public.profiles p on p.id = d.user_id
    where d.day = p_day and case when p_scope = 'friends' then d.user_id = v or private.are_friends(v, d.user_id) else d.ranked and p.ranked end),
  placed as (select f.*, row_number() over (order by total desc, max_depth desc, completed_at, id) as place, count(*) over () as n from field f)
  select jsonb_build_object('day', p_day, 'scope', p_scope, 'locked', false, 'players', coalesce((select max(n) from placed), 0),
    'me', (select jsonb_build_object('rank', place, 'total', total, 'max_depth', max_depth, 'top', ceil(100.0 * place / n)) from placed where user_id = v),
    'rows', (select coalesce(jsonb_agg(jsonb_build_object('rank', place, 'username', username, 'avatar', avatar, 'total', total, 'max_depth', max_depth, 'me', user_id = v,
        'friend', v is not null and user_id <> v and private.are_friends(v, user_id)) order by place), '[]'::jsonb)
      from (select * from placed where v is null or not private.blocked_between(v, user_id) order by place limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0)) t))
  into res;
  return res;
end $$;

-- The few numbers the end-of-day screen shows.
create or replace function public.day_summary(p_day int) returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare v uuid := private.me(); d public.dives;
begin
  select * into d from public.dives where user_id = v and day = p_day;
  if d.id is null then return jsonb_build_object('done', false); end if;
  return jsonb_build_object('done', true, 'total', d.total, 'max_depth', d.max_depth)
    || private.rank_of(d.id)
    || (select jsonb_build_object('friends', count(*), 'friends_done', count(fd.id), 'friends_beaten', count(fd.id) filter (where (fd.total, fd.max_depth) < (d.total, d.max_depth)), 'friends_level', count(fd.id) filter (where (fd.total, fd.max_depth) = (d.total, d.max_depth)))
        from public.friendships f left join public.dives fd on fd.user_id = case when f.a = v then f.b else f.a end and fd.day = p_day
        where (f.a = v or f.b = v) and f.status = 'accepted');
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Who may call what. Nothing is callable unless it is listed here.
-- ---------------------------------------------------------------------------------------------------------------
-- (Supabase lets the public key run any new function by default, so that is taken away first.)
revoke all on all functions in schema public from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
revoke all on all tables in schema public from anon, authenticated;
-- 0006_content.sql's day_content, if it exists yet: the blanket revoke above would otherwise remove it on a re-run.
do $$ begin if to_regprocedure('public.day_content(int)') is not null then grant execute on function public.day_content(int) to anon, authenticated; end if; end $$;

grant insert on public.round_plays, public.day_results, public.flags to anon, authenticated;
grant select on public.score_counts to anon, authenticated;
grant execute on function public.round_counts(int, int, text), public.username_check(text), public.leaderboard(int, text, int, int) to anon, authenticated;
grant execute on function public.claim_profile(text, text), public.me(), public.update_settings(jsonb), public.change_username(text), public.delete_account(),
  public.submit_dive(int, jsonb), public.import_dives(jsonb), public.my_dives(int, int), public.get_dive(text, int), public.profile_of(text), public.search_users(text),
  public.friend_request(text), public.friend_respond(text, boolean), public.friend_remove(text), public.block_user(text, boolean), public.friends(int), public.day_summary(int)
  to authenticated;
