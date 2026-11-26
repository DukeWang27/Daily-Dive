-- Answer intelligence: the permanent answer-check cache, shared alternative names, and hard limits on AI spending.
-- Paste into Supabase after 0006 (SQL Editor -> New query -> Run). Safe to run again. Changes no player data.
--
-- Only the review function (api/verify.js, running on the server with the service-role key) may call the functions
-- here. Players' keys (anon / authenticated) can read none of these tables and call none of these functions.
--
-- 1. verified_answers (from 0001) becomes the permanent record of every checked answer: what it was judged to be, for
--    which question and which version of that question's rules, by which checker, and whether a person has confirmed it.
--    A decision is reused only for the same question and the same rules, so a different question never inherits it.
-- 2. entity_aliases: other names for an answer that have been confirmed (by a dataset, a person, or the AI checker and
--    then a person), shared by every question about the same kind of thing ("dog breeds").
-- 3. AI budget: a monthly spending cap, daily and per-player request limits, enforced here with a row lock so two
--    requests at once can't both slip under the cap. Estimated cost is reserved before a call and settled after it.

-- 1. The verdict cache. (0006 already added rules_hash, confidence, evidence, review_status and updated_at, with the
--    review states auto / confirmed / overturned / pending and a function for a person to decide: private.review_answer.)
alter table public.verified_answers add column if not exists rules_hash text;
alter table public.verified_answers add column if not exists relationship text;                  -- exact, alias, spelling, new
alter table public.verified_answers add column if not exists confidence real;
alter table public.verified_answers add column if not exists evidence text;
alter table public.verified_answers add column if not exists validator text;                     -- provider/model@prompt-version
alter table public.verified_answers add column if not exists review_status text not null default 'auto';
alter table public.verified_answers add column if not exists hits int not null default 0;        -- how often the cache saved a call
alter table public.verified_answers add column if not exists updated_at timestamptz not null default now();
-- "uncertain" verdicts are stored too, so the same unclear answer doesn't cost a second call; they score nothing.
do $$ begin
  alter table public.verified_answers drop constraint if exists verified_answers_status_check;
  alter table public.verified_answers add constraint verified_answers_status_check check (status in ('ok', 'invalid', 'uncertain'));
end $$;
-- A person's decision always wins: once confirmed or overturned, no later automatic verdict can overwrite it.
create or replace function private.va_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and old.review_status in ('confirmed', 'overturned') and new.source = 'ai' then return old; end if;
  new.updated_at := now(); return new;
end $$;
drop trigger if exists va_guard on public.verified_answers;
create trigger va_guard before insert or update on public.verified_answers for each row execute function private.va_guard();

-- 2. Shared alternative names.
create table if not exists public.entity_aliases (
  domain text not null check (char_length(domain) <= 40),          -- the kind of thing: dog_breeds, birds, colours ...
  alias_key text not null check (char_length(alias_key) <= 80),    -- normalised: lower case, punctuation removed
  canonical text not null check (char_length(canonical) <= 80),
  kind text not null default 'alias' check (kind in ('alias', 'regional', 'scientific', 'historical', 'abbreviation', 'spelling')),
  source text not null default 'dataset',                          -- dataset name, 'human', or 'ai'
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  primary key (domain, alias_key)
);
alter table public.entity_aliases enable row level security;   -- no policies: players can't read or write it

-- 3. AI budget and limits.
create table if not exists private.ai_config (key text primary key, value numeric not null);
insert into private.ai_config (key, value) values
  ('month_budget_usd', 10),        -- the hard monthly cap
  ('day_requests', 1500),          -- at most this many paid checks a day, all players together
  ('player_day_requests', 30),     -- per player (signed-in id, or the anonymous id plus network address)
  ('question_day_requests', 400)   -- per question per day, so one question can't eat the month
on conflict (key) do nothing;
create table if not exists private.ai_month (month date primary key, spent_micros bigint not null default 0, reserved_micros bigint not null default 0, alerted smallint not null default 0);
create table if not exists private.ai_day (day date primary key, requests int not null default 0);
create table if not exists private.ai_player_day (day date not null, player text not null, requests int not null default 0, primary key (day, player));
create table if not exists private.ai_question_day (day date not null, question text not null, requests int not null default 0, primary key (day, question));
create table if not exists private.ai_calls (
  id bigint generated always as identity primary key, at timestamptz not null default now(),
  player text, question text, answer_key text, provider text, model text,
  reserved_micros int not null, cost_micros int, in_tokens int, out_tokens int, ms int, outcome text
);
create index if not exists ai_calls_at on private.ai_calls (at);
create table if not exists private.ai_alerts (month date not null, level smallint not null, at timestamptz not null default now(), primary key (month, level));

-- Reserve the most a call could cost. Refuses when the month, the day, the player or the question has run out. Returns
-- the reservation id to settle afterwards, and the alert level just crossed (50, 80 or 100 percent), if any.
create or replace function public.ai_reserve(p_player text, p_question text, p_answer_key text, p_provider text, p_model text, p_max_micros int)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare m date := date_trunc('month', now() at time zone 'UTC')::date; d date := (now() at time zone 'UTC')::date;
  cap bigint := (select value * 1000000 from private.ai_config where key = 'month_budget_usd')::bigint; mo private.ai_month; used numeric; lvl smallint := 0; rid bigint;
begin
  if p_max_micros is null or p_max_micros <= 0 or p_max_micros > 100000 then raise exception 'bad_estimate'; end if;
  insert into private.ai_month (month) values (m) on conflict do nothing;
  select * into mo from private.ai_month where month = m for update;                          -- one reservation at a time
  if mo.spent_micros + mo.reserved_micros + p_max_micros > cap then return jsonb_build_object('ok', false, 'reason', 'month_budget'); end if;
  insert into private.ai_day (day) values (d) on conflict do nothing;
  if (select requests from private.ai_day where day = d) >= (select value from private.ai_config where key = 'day_requests') then return jsonb_build_object('ok', false, 'reason', 'day_limit'); end if;
  insert into private.ai_player_day (day, player) values (d, left(coalesce(p_player, '?'), 80)) on conflict do nothing;
  if (select requests from private.ai_player_day where day = d and player = left(coalesce(p_player, '?'), 80)) >= (select value from private.ai_config where key = 'player_day_requests') then
    return jsonb_build_object('ok', false, 'reason', 'player_limit'); end if;
  insert into private.ai_question_day (day, question) values (d, left(coalesce(p_question, '?'), 80)) on conflict do nothing;
  if (select requests from private.ai_question_day where day = d and question = left(coalesce(p_question, '?'), 80)) >= (select value from private.ai_config where key = 'question_day_requests') then
    return jsonb_build_object('ok', false, 'reason', 'question_limit'); end if;
  update private.ai_month set reserved_micros = reserved_micros + p_max_micros where month = m;
  update private.ai_day set requests = requests + 1 where day = d;
  update private.ai_player_day set requests = requests + 1 where day = d and player = left(coalesce(p_player, '?'), 80);
  update private.ai_question_day set requests = requests + 1 where day = d and question = left(coalesce(p_question, '?'), 80);
  insert into private.ai_calls (player, question, answer_key, provider, model, reserved_micros) values (left(p_player, 80), left(p_question, 80), left(p_answer_key, 80), left(p_provider, 20), left(p_model, 60), p_max_micros) returning id into rid;
  used := (mo.spent_micros + mo.reserved_micros + p_max_micros)::numeric / cap;
  lvl := case when used >= 1 then 100 when used >= 0.8 then 80 when used >= 0.5 then 50 else 0 end;
  if lvl > mo.alerted then update private.ai_month set alerted = lvl where month = m; insert into private.ai_alerts (month, level) values (m, lvl) on conflict do nothing; else lvl := 0; end if;
  return jsonb_build_object('ok', true, 'id', rid, 'alert', lvl);
end $$;

-- Settle a reservation with what the call really cost (0 when it failed before reaching the provider).
create or replace function public.ai_settle(p_id bigint, p_cost_micros int, p_in int, p_out int, p_ms int, p_outcome text)
returns void language plpgsql security definer set search_path = public, private as $$
declare c private.ai_calls; m date := date_trunc('month', now() at time zone 'UTC')::date;
begin
  select * into c from private.ai_calls where id = p_id for update;
  if c.id is null or c.cost_micros is not null then return; end if;                              -- settled once only
  update private.ai_calls set cost_micros = greatest(0, coalesce(p_cost_micros, c.reserved_micros)), in_tokens = p_in, out_tokens = p_out, ms = p_ms, outcome = left(p_outcome, 40) where id = p_id;
  update private.ai_month set reserved_micros = greatest(0, reserved_micros - c.reserved_micros),
    spent_micros = spent_micros + greatest(0, coalesce(p_cost_micros, c.reserved_micros)) where month = date_trunc('month', c.at at time zone 'UTC')::date;
end $$;

-- Reservations a crashed function never settled are charged in full after ten minutes (the safe direction).
create or replace function public.ai_sweep() returns int language plpgsql security definer set search_path = public, private as $$
declare n int := 0; c record;
begin
  for c in select id from private.ai_calls where cost_micros is null and at < now() - interval '10 minutes' loop
    perform public.ai_settle(c.id, null, null, null, null, 'unsettled'); n := n + 1; end loop;
  return n;
end $$;

-- For the owner: this month's spending, today's use and recent alerts.
create or replace function public.ai_status() returns jsonb language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object(
    'budget_usd', (select value from private.ai_config where key = 'month_budget_usd'),
    'spent_usd', coalesce((select spent_micros from private.ai_month where month = date_trunc('month', now() at time zone 'UTC')::date), 0) / 1e6,
    'reserved_usd', coalesce((select reserved_micros from private.ai_month where month = date_trunc('month', now() at time zone 'UTC')::date), 0) / 1e6,
    'requests_today', coalesce((select requests from private.ai_day where day = (now() at time zone 'UTC')::date), 0),
    'cache_hits_total', (select coalesce(sum(hits), 0) from public.verified_answers),
    'alerts', (select coalesce(jsonb_agg(jsonb_build_object('month', month, 'level', level, 'at', at) order by at desc), '[]') from private.ai_alerts)) $$;

-- Cache bookkeeping for the review function.
create or replace function public.va_hit(p_category text, p_keys text[]) returns void language sql security definer set search_path = public as $$
  update public.verified_answers set hits = hits + 1 where category = p_category and answer_key = any (p_keys) $$;

revoke all on function public.ai_reserve(text, text, text, text, text, int), public.ai_settle(bigint, int, int, int, int, text), public.ai_sweep(), public.ai_status(), public.va_hit(text, text[]) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.ai_reserve(text, text, text, text, text, int), public.ai_settle(bigint, int, int, int, int, text), public.ai_sweep(), public.ai_status(), public.va_hit(text, text[]) to service_role;
    grant select, insert, update on public.verified_answers, public.entity_aliases to service_role;
  end if;
end $$;
