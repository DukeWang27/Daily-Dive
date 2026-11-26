-- 0010 (PROTOTYPE, experiments branch): authoritative scoring for the experimental round types.
-- NOT applied to the live database. Tested only against the local test database (tests/db/rounds.cjs).
--
-- Today the server scores a dive by summing each question's best rarity depth (private.store_dive). That is right for
-- the live game and wrong for mixed days: a target round pays for closeness, a forbidden answer must earn nothing, a
-- mine spends a guess for nothing, and a risk round depends on a choice the player made. If the browser computed
-- those, anyone could send any total. So here the server takes only what was typed, which answer it was counted as,
-- and (for a risk round) which choice was made, and works out everything else itself, with the same rules as
-- rounds.js. tests/db/rounds.cjs checks that the two agree on thousands of cases.
--
-- Experimental dives live in their own tables (x_dives, x_guesses, x_rounds), never in public.dives: they can't enter
-- live rankings, streaks, profile totals or anyone's history, even by accident. Nothing here changes private.store_dive
-- or public.submit_dive, and no existing row is touched (one new column with a default; three new tables).

-- Which answers are only estimated (from a dataset, still being measured). Target rounds and mines need to know:
-- an estimate is never enough to hit a target or set off a mine.
alter table public.set_answers add column if not exists pv boolean not null default false;

create table if not exists public.x_dives (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  day int not null, set_id int not null references public.answer_sets,
  total int not null default 0, depths int[] not null default array[0, 0, 0, 0, 0],
  completed_at timestamptz not null default now(),
  unique (user_id, day)
);
create table if not exists public.x_guesses (
  dive_id bigint not null references public.x_dives (id) on delete cascade,
  round smallint not null check (round between 1 and 5), slot smallint not null check (slot between 1 and 3),
  typed text not null, answer text, status text not null check (status in ('ok', 'pending', 'miss')), share double precision, depth int,
  primary key (dive_id, round, slot)
);
-- Each question's outcome in an experimental dive: the kind of round, the risk choice, what it scored.
create table if not exists public.x_rounds (
  dive_id bigint not null references public.x_dives (id) on delete cascade,
  round smallint not null check (round between 1 and 5),
  kind text not null check (kind in ('standard', 'wildcard', 'forbidden', 'target', 'risk', 'mines')),
  choice text check (choice in ('secure', 'continue', 'risk')),
  stake int, score int not null, outcome text,       -- outcome: 'won' | 'lost' for a risk taken, 'mine' if one went off
  primary key (dive_id, round)
);
alter table public.x_dives enable row level security;   -- all three are read only through the functions below
alter table public.x_guesses enable row level security;
alter table public.x_rounds enable row level security;

-- ---------- The rules (mirror rounds.js exactly; Math.round(x) for x >= 0 is floor(x + 0.5)) ----------
create or replace function private.x_kind(p_mode jsonb) returns text language sql immutable as $$
  select case when p_mode->>'type' in ('wildcard', 'forbidden', 'target', 'risk', 'mines') then p_mode->>'type' else 'standard' end $$;
-- How far a share is outside a band, in powers of ten (0 inside it).
create or replace function private.x_miss(lo double precision, hi double precision, s double precision) returns double precision language sql immutable as $$
  select case when s < lo then log(lo / s) when s > hi then log(s / hi) else 0 end $$;
-- The target band. goal 'common' needs the most common measured share, stored in the mode as "top" when the day is built.
create or replace function private.x_band(p_mode jsonb, out lo double precision, out hi double precision) language sql immutable as $$
  select case p_mode->>'goal' when 'common' then (p_mode->>'top')::float8 * 0.999 when 'closest' then (p_mode->>'pct')::float8 / 1.18 else (p_mode->>'lo')::float8 end,
         case p_mode->>'goal' when 'common' then 1::float8 when 'closest' then (p_mode->>'pct')::float8 * 1.18 else (p_mode->>'hi')::float8 end $$;
-- Which mine (0-based) a measured answer sits in, or -1.
create or replace function private.x_mine_at(p_mode jsonb, p_share double precision, p_pv boolean) returns int language sql immutable as $$
  select coalesce((select (t.i - 1)::int from jsonb_array_elements(p_mode->'mines') with ordinality t(b, i)
                   where not p_pv and p_share >= (t.b->>'lo')::float8 and p_share <= (t.b->>'hi')::float8 order by t.i limit 1), -1) $$;
create or replace function private.x_skims(p_mode jsonb, p_share double precision, p_pv boolean) returns boolean language sql immutable as $$
  select not p_pv and private.x_mine_at(p_mode, p_share, p_pv) < 0 and exists (select 1 from jsonb_array_elements(p_mode->'mines') b
    where private.x_miss((b->>'lo')::float8, (b->>'hi')::float8, p_share) <= log(2::float8)) $$;
-- What one guess is worth in this round, on its own. g: { status, share, depth, pv }.
create or replace function private.x_value(p_mode jsonb, g jsonb) returns int language plpgsql immutable as $$
declare k text := private.x_kind(p_mode); s float8 := (g->>'share')::float8; d int := coalesce((g->>'depth')::int, 0); pv boolean := coalesce((g->>'pv')::boolean, false); b record;
begin
  if g->>'status' is distinct from 'ok' then return 0; end if;
  if k = 'target' then
    if pv then return 0; end if;
    select * into b from private.x_band(p_mode);
    return floor(250 * greatest(0, 1 - private.x_miss(b.lo, b.hi, s) / 1.25) + 0.5)::int;
  elsif k = 'mines' then
    if private.x_mine_at(p_mode, s, pv) >= 0 then return 0; end if;
    return case when private.x_skims(p_mode, s, pv) then floor(d * 1.25 + 0.5)::int else d end;
  end if;
  return d;
end $$;
-- A question's distance. p_guesses: the question's guesses in slot order (as above). p_choice: { kind, at } for a risk
-- round once decided (at: how many guesses had been made when it was), else null. p_final: the question is over.
create or replace function private.x_round_score(p_mode jsonb, p_guesses jsonb, p_choice jsonb, p_final boolean) returns int language plpgsql immutable as $$
declare best int := 0; first_v int; later int := 0; v int; g jsonb; i int := 0; c text := p_choice->>'kind'; at int := (p_choice->>'at')::int;
begin
  for g in select x from jsonb_array_elements(p_guesses) x loop
    if g->>'status' = 'ok' then
      v := private.x_value(p_mode, g); best := greatest(best, v);
      if first_v is null then first_v := v; end if;
      if at is not null and i >= at then later := greatest(later, v); end if;
    end if;
    i := i + 1;
  end loop;
  if private.x_kind(p_mode) <> 'risk' then return best; end if;
  if c is null then return case when p_final then best else 0 end; end if;
  if c = 'secure' then return floor(coalesce(first_v, 0) * 1.2 + 0.5)::int; end if;
  if c = 'continue' then return best; end if;
  return case when later > coalesce(first_v, 0) then first_v + floor(1.5 * (later - first_v) + 0.5)::int else 0 end;
end $$;

-- ---------- Storing an experimental dive ----------
-- p_guesses as for store_dive. p_choices: [{ "round": 3, "kind": "risk" }]. The stake and the moment of the choice are
-- not taken from the browser: the stake is what the first verified answer is worth, and the choice is taken to have
-- been made straight after it (the only moment the game offers it).
create or replace function private.store_dive_x(p_user uuid, p_day int, p_guesses jsonb, p_choices jsonb) returns bigint
language plpgsql security definer set search_path = public, private as $$
declare v_set int := private.day_set(p_day); v_dive bigint; g jsonb; r int; sl int; v_typed text; v_answer text; v_status text; v_share float8; v_depth int; v_pv boolean;
  v_mode jsonb; v_list jsonb; v_choice jsonb; v_kind text; v_first int; v_score int; v_stake int; v_depths int[] := array[0, 0, 0, 0, 0]; v_out text;
begin
  if jsonb_typeof(p_guesses) <> 'array' or jsonb_array_length(p_guesses) > 15 then raise exception 'bad_guesses'; end if;
  if p_choices is not null and (jsonb_typeof(p_choices) <> 'array' or jsonb_array_length(p_choices) > 5) then raise exception 'bad_choices'; end if;
  insert into public.x_dives (user_id, day, set_id) values (p_user, p_day, v_set) returning id into v_dive;
  for g in select * from jsonb_array_elements(p_guesses) loop
    r := (g->>'round')::int; sl := (g->>'slot')::int; v_typed := left(coalesce(g->>'typed', ''), 60); v_answer := nullif(left(coalesce(g->>'answer', ''), 80), '');
    v_status := case when g->>'status' in ('ok', 'pending', 'miss') then g->>'status' else 'miss' end; v_share := null; v_depth := null; v_pv := false;
    if r is null or sl is null or r not between 1 and 5 or sl not between 1 and 3 then raise exception 'bad_guesses'; end if;
    if exists (select 1 from public.x_guesses where dive_id = v_dive and round = r and slot = sl) then raise exception 'bad_guesses'; end if;
    v_mode := (select q->'mode' from public.answer_sets s, jsonb_array_elements(s.questions) with ordinality t(q, i) where s.set_id = v_set and t.i = r);
    if v_status = 'ok' and v_answer is not null then
      select share, depth, pv into v_share, v_depth, v_pv from public.set_answers where set_id = v_set and round = r and answer = v_answer;
      if v_depth is not null and not private.claim_ok(v_set, r, v_typed, v_answer) then v_depth := null; end if;
      -- A banned answer earns nothing, however it was sent (the game never sends one as a guess).
      if v_depth is not null and private.x_kind(v_mode) = 'forbidden' and coalesce(v_mode->'forbid', '[]'::jsonb) ? v_answer then v_depth := null; end if;
      if v_depth is null then v_status := 'pending'; v_answer := null;
      elsif exists (select 1 from public.x_guesses where dive_id = v_dive and round = r and answer = v_answer) then v_status := 'miss'; v_share := null; v_depth := null;
      end if;
    elsif v_status = 'ok' then v_status := 'pending';   -- answers still under review earn nothing in an experimental round
    else v_answer := null;
    end if;
    insert into public.x_guesses (dive_id, round, slot, typed, answer, status, share, depth) values (v_dive, r, sl, v_typed, v_answer, v_status, v_share, v_depth);
  end loop;
  -- Score each question with the round's own rules.
  for r in 1..5 loop
    v_mode := (select q->'mode' from public.answer_sets s, jsonb_array_elements(s.questions) with ordinality t(q, i) where s.set_id = v_set and t.i = r);
    v_kind := private.x_kind(v_mode);
    select coalesce(jsonb_agg(jsonb_build_object('status', d.status, 'share', d.share, 'depth', d.depth, 'pv', coalesce(a.pv, false)) order by d.slot), '[]'::jsonb)
      into v_list from public.x_guesses d left join public.set_answers a on a.set_id = v_set and a.round = d.round and a.answer = d.answer where d.dive_id = v_dive and d.round = r;
    v_choice := null; v_stake := null; v_out := null;
    if v_kind = 'risk' then
      select ord::int into v_first from jsonb_array_elements(v_list) with ordinality t(x, ord) where x->>'status' = 'ok' order by ord limit 1;
      v_choice := (select jsonb_build_object('kind', c->>'kind', 'at', v_first) from jsonb_array_elements(coalesce(p_choices, '[]'::jsonb)) c
                   where (c->>'round')::int = r and c->>'kind' in ('secure', 'continue', 'risk') limit 1);
      if v_first is null then v_choice := null; end if;
      if v_choice is not null then v_stake := private.x_value(v_mode, v_list->(v_first - 1)); end if;
      if v_stake = 0 then v_choice := jsonb_build_object('kind', 'continue', 'at', v_first); end if;   -- nothing to stake: it simply plays on
    end if;
    v_score := private.x_round_score(v_mode, v_list, v_choice, true);
    if v_choice->>'kind' = 'risk' then v_out := case when v_score > 0 then 'won' else 'lost' end; end if;
    if v_kind = 'mines' and exists (select 1 from jsonb_array_elements(v_list) x where x->>'status' = 'ok' and private.x_mine_at(v_mode, (x->>'share')::float8, (x->>'pv')::boolean) >= 0) then v_out := coalesce(v_out, 'mine'); end if;
    v_depths[r] := v_score;
    insert into public.x_rounds (dive_id, round, kind, choice, stake, score, outcome) values (v_dive, r, v_kind, v_choice->>'kind', v_stake, v_score, v_out);
  end loop;
  update public.x_dives set total = (select sum(x) from unnest(v_depths) x), depths = v_depths where id = v_dive;
  return v_dive;
end $$;

-- The game's call for an experimental day. One dive per player per day, like the live game; never ranked.
create or replace function public.submit_dive_x(p_day int, p_guesses jsonb, p_choices jsonb) returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v uuid := private.me(); v_dive bigint;
begin
  select id into v_dive from public.x_dives where user_id = v and day = p_day;
  if v_dive is null then
    if not private.day_is_open(p_day) then raise exception 'day_closed'; end if;
    perform private.limit_rate('dive_x', 6, interval '1 hour');
    v_dive := private.store_dive_x(v, p_day, p_guesses, p_choices);
  end if;
  return (select jsonb_build_object('day', d.day, 'total', d.total, 'depths', d.depths, 'ranked', false,
    'rounds', (select jsonb_agg(jsonb_build_object('round', x.round, 'kind', x.kind, 'choice', x.choice, 'score', x.score, 'outcome', x.outcome) order by x.round) from public.x_rounds x where x.dive_id = d.id))
    from public.x_dives d where d.id = v_dive);
end $$;

-- Friends' round outcomes for a day (who hit the target closest, who risked what), behind the same spoiler rule as
-- everything else: only once you've handed in your own dive for that day (here, your experimental one), or the day
-- has closed.
create or replace function public.friends_rounds(p_day int) returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare v uuid := private.me();
begin
  if now() < private.day_closes(p_day) and not exists (select 1 from public.x_dives where user_id = v and day = p_day) then raise exception 'finish_first'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('username', p.username, 'total', d.total,
      'rounds', (select jsonb_agg(jsonb_build_object('round', x.round, 'kind', x.kind, 'choice', x.choice, 'score', x.score, 'outcome', x.outcome) order by x.round) from public.x_rounds x where x.dive_id = d.id))
      order by d.total desc)
    from public.x_dives d join public.profiles p on p.id = d.user_id
    where d.day = p_day and (d.user_id = v or private.are_friends(v, d.user_id)) and not private.blocked_between(v, d.user_id)), '[]'::jsonb);
end $$;

revoke all on function private.store_dive_x(uuid, int, jsonb, jsonb) from public;
revoke all on function public.submit_dive_x(int, jsonb, jsonb) from public, anon;
revoke all on function public.friends_rounds(int) from public, anon;
grant execute on function public.submit_dive_x(int, jsonb, jsonb) to authenticated;
grant execute on function public.friends_rounds(int) to authenticated;
