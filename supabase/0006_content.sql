-- 0006: the content system. Additive and safe to run again. Run after 0005.
--   1. Day content served from the database, and only once that day has begun somewhere in the world
--      (upcoming questions and answers are never published in the game's public files).
--   2. Real player statistics for every question, with a Bayesian estimate that starts from the provisional prior and
--      moves to what players actually answered as evidence builds up.
--   3. Rarity snapshots: a day's table is fixed before it starts and never rewritten afterwards; real evidence flags.
--   4. Answer review: verdicts tied to the question (not just its category), with confidence, evidence and a history
--      so a mistaken approval or rejection can be corrected.
--   5. The no-simulated-evidence rule applied to tables not yet played (sets 3-15 and the race pool).
-- Nothing here changes a played day's scores, a stored dive, a streak, a friendship or an account.

-- ---------- 1. Day content ----------
create table if not exists public.content_days (
  day int primary key check (day >= 1),
  set_id int not null references public.answer_sets,
  payload jsonb not null,                         -- the day's five questions as the game reads them (prompts, rules, answers, shares)
  created_at timestamptz not null default now()
);
alter table public.content_days enable row level security;          -- no policies: reachable only through day_content()
revoke all on public.content_days from anon, authenticated;

create or replace function public.day_content(p_day int) returns jsonb language plpgsql stable security definer set search_path = public, private as $$
begin
  if p_day is null or p_day < 1 or p_day > private.latest_day() then return null; end if;   -- not yet open anywhere: nothing
  return (select payload from public.content_days where day = p_day);
end $$;
grant execute on function public.day_content(int) to anon, authenticated;

-- A day with prepared content uses its own question set; other days keep the original rotation.
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

-- ---------- 2. Real statistics ----------
alter table public.set_answers add column if not exists ev boolean not null default false;   -- rarity backed by real players
alter table public.set_answers add column if not exists n_real int not null default 0;       -- real players who gave it (at snapshot)
alter table public.set_answers add column if not exists prior double precision;              -- the provisional estimate it started from

insert into public.game_config values ('prior_strength', '30'), ('evidence_players', '10000'), ('evidence_min', '2'), ('provisional_cap', '250')
  on conflict (key) do nothing;

-- One question's real numbers. "Share" here always means: of the players who answered this question, the fraction who
-- gave this answer as one of their (up to three) guesses. Each player counts once per answer (round_plays has one row
-- per player per question). Bayesian smoothing: posterior = (x + k*prior) / (n + k), where k is the prior's weight in
-- pseudo-players. Early on the prior dominates; with thousands of players the real share takes over.
create or replace function private.question_stats(p_set int, p_round int)
returns table (answer text, prior double precision, players_gave int, players int, posterior double precision, upper95 double precision)
language sql stable security definer set search_path = public, private as $$
  with plays as (
    select rp.player, rp.answers from public.round_plays rp join public.days d on d.day = rp.day
    where d.set_id = p_set and rp.round = p_round
  ), n as (select count(*)::int as n from plays),
  k as (select value::double precision as k from public.game_config where key = 'prior_strength'),
  given as (select a as answer, count(distinct p.player)::int as x from plays p, unnest(p.answers) a group by a)
  select sa.answer, coalesce(sa.prior, sa.share), coalesce(g.x, 0), n.n,
         (coalesce(g.x, 0) + k.k * coalesce(sa.prior, sa.share)) / (n.n + k.k),
         -- a simple upper bound (normal approximation to the Beta posterior), for "is it really that rare?"
         least(1, (coalesce(g.x, 0) + k.k * coalesce(sa.prior, sa.share)) / (n.n + k.k)
           + 1.96 * sqrt(greatest(1e-12, ((coalesce(g.x, 0) + k.k * coalesce(sa.prior, sa.share)) / (n.n + k.k)) * (1 - (coalesce(g.x, 0) + k.k * coalesce(sa.prior, sa.share)) / (n.n + k.k)) / (n.n + k.k + 1))))
  from public.set_answers sa cross join n cross join k left join given g on g.answer = sa.answer
  where sa.set_id = p_set and sa.round = p_round
$$;
revoke all on function private.question_stats(int, int) from public, anon, authenticated;

-- The depth rule, with its two caps: no real evidence -> never beneath the iceberg; dataset-only -> never below 250 m.
create or replace function private.depth_for(p_share double precision, p_provisional boolean, p_ev boolean) returns int language sql immutable as $$
  select case when p_share >= 0.1 then 0 else
    least(greatest(1, floor(100 * log(0.1 / greatest(p_share, 1e-9)) + 0.5)::int),
          case when p_provisional then 250 else 100000 end,
          case when p_ev then 100000 else 299 end) end
$$;

-- ---------- 3. Snapshots ----------
-- Refresh an UNPLAYED set's table from real statistics gathered when the same question (same key) was asked before:
-- a re-run question, or the race pool. A set already assigned to a day that has opened is never touched.
create or replace function private.refresh_snapshot(p_set int) returns int language plpgsql security definer set search_path = public, private as $$
declare used boolean; q record; s record; changed int := 0; k double precision; need int; minx int;
begin
  select exists (select 1 from public.days d where d.set_id = p_set and d.day <= private.latest_day()) into used;
  if used then raise exception 'set % has already been played: its table is fixed', p_set; end if;
  select value::double precision into k from public.game_config where key = 'prior_strength';
  select value::int into need from public.game_config where key = 'evidence_players';
  select value::int into minx from public.game_config where key = 'evidence_min';
  for q in select t.i::int as round, t.q->>'key' as key from public.answer_sets a, jsonb_array_elements(a.questions) with ordinality as t(q, i) where a.set_id = p_set loop
    -- every earlier set that asked this same question, pooled
    for s in
      with plays as (
        select rp.player, rp.answers from public.round_plays rp join public.days d on d.day = rp.day
        join public.answer_sets a on a.set_id = d.set_id, jsonb_array_elements(a.questions) with ordinality as t(qq, i)
        where t.qq->>'key' = q.key and rp.round = t.i and d.set_id <> p_set and d.day <= private.latest_day()
      ), n as (select count(*)::int as n from plays),
      given as (select a as answer, count(distinct player)::int as x from plays, unnest(answers) a group by a)
      select sa.answer, sa.share, coalesce(sa.prior, sa.share) as prior, coalesce(g.x, 0) as x, n.n
      from public.set_answers sa cross join n left join given g on g.answer = sa.answer
      where sa.set_id = p_set and sa.round = q.round and n.n > 0
    loop
      update public.set_answers set prior = coalesce(prior, s.share),
        share = (s.x + k * s.prior) / (s.n + k), n_real = s.x,
        ev = (s.n >= need and s.x >= minx),
        depth = private.depth_for((s.x + k * s.prior) / (s.n + k), false, (s.n >= need and s.x >= minx))
      where set_id = p_set and round = q.round and answer = s.answer;
      changed := changed + 1;
    end loop;
  end loop;
  return changed;
end $$;
revoke all on function private.refresh_snapshot(int) from public, anon, authenticated;

-- ---------- 4. Answer review ----------
alter table public.verified_answers add column if not exists rules_hash text;          -- the rules the verdict was made under
alter table public.verified_answers add column if not exists confidence real;
alter table public.verified_answers add column if not exists evidence text;
alter table public.verified_answers add column if not exists review_status text not null default 'auto' check (review_status in ('auto', 'confirmed', 'overturned', 'pending'));
alter table public.verified_answers add column if not exists updated_at timestamptz not null default now();
create table if not exists public.verdict_history (                -- every change to a verdict, so a mistake can be traced and undone
  id bigint generated always as identity primary key,
  category text not null, answer_key text not null,
  old jsonb, new jsonb not null, changed_by text not null default 'admin', changed_at timestamptz not null default now()
);
alter table public.verdict_history enable row level security;
revoke all on public.verdict_history from anon, authenticated;

-- Correct a verdict (admin only, through the service role): keeps the old one in verdict_history. Scores already
-- recorded for a played day are not rewritten; the corrected verdict applies from the next time the answer is judged.
create or replace function private.set_verdict(p_category text, p_key text, p_status text, p_canonical text, p_reason text, p_by text default 'admin')
returns void language plpgsql security definer set search_path = public, private as $$
declare before jsonb;
begin
  select to_jsonb(v) into before from public.verified_answers v where category = p_category and answer_key = p_key;
  insert into public.verified_answers (category, answer_key, status, canonical, reason, source, review_status, updated_at)
    values (p_category, p_key, p_status, p_canonical, p_reason, 'human', case when before is null then 'confirmed' else 'overturned' end, now())
    on conflict (category, answer_key) do update set status = excluded.status, canonical = excluded.canonical, reason = excluded.reason,
      source = 'human', review_status = case when public.verified_answers.status = excluded.status then 'confirmed' else 'overturned' end, updated_at = now();
  insert into public.verdict_history (category, answer_key, old, new, changed_by)
    values (p_category, p_key, before, jsonb_build_object('status', p_status, 'canonical', p_canonical, 'reason', p_reason), p_by);
end $$;
revoke all on function private.set_verdict(text, text, text, text, text, text) from public, anon, authenticated;

-- ---------- 5. No simulated evidence on tables not yet played ----------
-- The original tables let an answer go beneath the iceberg on the strength of a simulated sample. Sets 1 and 2 were
-- played on days 1 and 2 under that rule and stay exactly as they were. Sets 3-15 (not yet played) and the race pool
-- (reused in every race) are capped at 299 m, the share floored to match: the same change tools/content/recap_legacy.py
-- makes to their files, so the game and the database agree.
update public.set_answers set share = greatest(share, 0.0001023), depth = 299
where depth >= 300 and not ev and (set_id between 3 and 15 or set_id >= 1001);
update public.set_answers set prior = share where prior is null;
