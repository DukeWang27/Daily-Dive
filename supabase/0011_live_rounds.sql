-- 0011: the round types go live. Applied after 0010 (which adds the scoring rules, private.x_*, and set_answers.pv).
--
-- private.store_dive now scores each question with its own round's rules (rounds.js; the same functions 0010 tested
-- against the game on thousands of cases), so a mixed day's dive is a normal dive: ranked, in streaks and history.
-- A question with no round type is scored exactly as before (its deepest answer), so ordinary days are unchanged.
-- The browser still sends only what was typed, what it counted as and, for a risk round, which choice was made; the
-- stake, the moment of the choice and every score come from the tables here.
--
-- Nothing already stored changes: existing dives keep their scores (no row is rewritten), and dive_rounds starts empty.
-- The experimental tables from 0010 (x_dives, x_guesses, x_rounds) stay as they were and are no longer called.

create table if not exists public.dive_rounds (
  dive_id bigint not null references public.dives (id) on delete cascade,
  round smallint not null check (round between 1 and 5),
  kind text not null check (kind in ('standard', 'wildcard', 'forbidden', 'target', 'risk', 'mines')),
  choice text check (choice in ('secure', 'continue', 'risk')),
  stake int, score int not null, outcome text,
  primary key (dive_id, round)
);
alter table public.dive_rounds enable row level security;   -- read only through the functions below

create or replace function private.store_dive(p_user uuid, p_day int, p_guesses jsonb, p_source text, p_ranked boolean, p_choices jsonb) returns bigint
language plpgsql security definer set search_path = public, private as $$
declare v_set int := private.day_set(p_day); v_dive bigint; g jsonb; r int; sl int; v_typed text; v_answer text; v_status text; v_share double precision; v_depth int; v_sight text;
  v_key text; v_pv boolean; v_mode jsonb; v_kind text; v_list jsonb; v_choice jsonb; v_first int; v_stake int; v_score int; v_out text;
  v_depths int[] := array[0, 0, 0, 0, 0]; v_total int; v_max int; v_dr int; v_da text;
begin
  if jsonb_typeof(p_guesses) <> 'array' or jsonb_array_length(p_guesses) > 15 then raise exception 'bad_guesses'; end if;
  if p_choices is not null and jsonb_typeof(p_choices) = 'null' then p_choices := null; end if;
  if p_choices is not null and (jsonb_typeof(p_choices) <> 'array' or jsonb_array_length(p_choices) > 5) then raise exception 'bad_choices'; end if;
  insert into public.dives (user_id, day, set_id, total, max_depth, depths, source, ranked) values (p_user, p_day, v_set, 0, 0, v_depths, p_source, p_ranked) returning id into v_dive;
  for g in select * from jsonb_array_elements(p_guesses) loop
    r := (g->>'round')::int; sl := (g->>'slot')::int; v_typed := left(coalesce(g->>'typed', ''), 60); v_answer := nullif(left(coalesce(g->>'answer', ''), 80), '');
    v_status := case when g->>'status' in ('ok', 'pending', 'miss') then g->>'status' else 'miss' end; v_share := null; v_depth := null;
    if r is null or sl is null or r not between 1 and 5 or sl not between 1 and 3 then raise exception 'bad_guesses'; end if;
    if exists (select 1 from public.dive_guesses where dive_id = v_dive and round = r and slot = sl) then raise exception 'bad_guesses'; end if;   -- three guesses a question, each used once
    v_mode := (select q->'mode' from public.answer_sets s, jsonb_array_elements(s.questions) with ordinality as t(q, i) where s.set_id = v_set and t.i = r);
    if v_status = 'ok' then
      if v_answer is not null then
        select share, depth into v_share, v_depth from public.set_answers where set_id = v_set and round = r and answer = v_answer;
        if v_depth is not null and not private.claim_ok(v_set, r, v_typed, v_answer) then v_depth := null; end if;   -- typed one thing, claimed another
        -- A banned answer earns nothing, however it was sent (the game never sends one as a guess).
        if v_depth is not null and private.x_kind(v_mode) = 'forbidden' and coalesce(v_mode->'forbid', '[]'::jsonb) ? v_answer then v_depth := null; end if;
      else   -- approved by review but not in the table yet: a fixed, modest depth
        v_key := (select q->>'key' from public.answer_sets s, jsonb_array_elements(s.questions) with ordinality as t(q, i) where s.set_id = v_set and t.i = r);
        if exists (select 1 from public.verified_answers where category = v_key and status = 'ok' and answer_key = btrim(regexp_replace(lower(v_typed), '[^a-z0-9]+', ' ', 'g'))) then v_share := 0.03; v_depth := 52; end if;
      end if;
      if v_depth is null then v_status := 'pending'; v_answer := null;                                           -- not an answer this day accepts: no depth
      elsif v_answer is not null and exists (select 1 from public.dive_guesses where dive_id = v_dive and round = r and answer = v_answer) then v_status := 'miss'; v_share := null; v_depth := null;   -- the same answer twice counts once
      end if;
    else v_answer := null;
    end if;
    v_sight := case when g->>'sight' in ('colossal', 'megalodon', 'coil') and v_depth >= 300 then g->>'sight' when g->>'sight' = 'bigfin' and v_depth >= 250 then 'bigfin' when g->>'sight' = 'giant' and v_depth >= 200 then 'giant' end;
    insert into public.dive_guesses (dive_id, round, slot, typed, answer, status, share, depth, sight) values (v_dive, r, sl, v_typed, v_answer, v_status, v_share, v_depth, v_sight);
  end loop;
  -- Each question scored with its own round's rules. With no round type this is its deepest answer, as before.
  for r in 1..5 loop
    v_mode := (select q->'mode' from public.answer_sets s, jsonb_array_elements(s.questions) with ordinality as t(q, i) where s.set_id = v_set and t.i = r);
    v_kind := private.x_kind(v_mode);
    -- An answer approved by review but not in the table is an estimate: it can't hit a target or set off a mine.
    select coalesce(jsonb_agg(jsonb_build_object('status', d.status, 'share', d.share, 'depth', d.depth, 'pv', coalesce(a.pv, d.answer is null)) order by d.slot), '[]'::jsonb)
      into v_list from public.dive_guesses d left join public.set_answers a on a.set_id = v_set and a.round = d.round and a.answer = d.answer where d.dive_id = v_dive and d.round = r;
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
    if v_kind = 'mines' and exists (select 1 from jsonb_array_elements(v_list) x where x->>'status' = 'ok' and private.x_mine_at(v_mode, (x->>'share')::float8, (x->>'pv')::boolean) >= 0) then v_out := 'mine'; end if;
    v_depths[r] := v_score;
    if v_kind <> 'standard' then
      insert into public.dive_rounds (dive_id, round, kind, choice, stake, score, outcome) values (v_dive, r, v_kind, v_choice->>'kind', v_stake, v_score, v_out);
    end if;
    -- The question's best answer: the one worth most in this round (for an ordinary question, the deepest; equal
    -- depths keep the rarer, then the earlier). An answer worth nothing here (a mine, far off a target) isn't marked.
    update public.dive_guesses d set is_best = true from (
      select x.slot from public.dive_guesses x left join public.set_answers a on a.set_id = v_set and a.round = x.round and a.answer = x.answer
      where x.dive_id = v_dive and x.round = r and x.status = 'ok'
        and private.x_value(v_mode, jsonb_build_object('status', x.status, 'share', x.share, 'depth', x.depth, 'pv', coalesce(a.pv, x.answer is null))) > 0
      order by private.x_value(v_mode, jsonb_build_object('status', x.status, 'share', x.share, 'depth', x.depth, 'pv', coalesce(a.pv, x.answer is null))) desc, x.share, x.slot limit 1) b
      where d.dive_id = v_dive and d.round = r and d.slot = b.slot;
  end loop;
  select coalesce(sum(x), 0) into v_total from unnest(v_depths) x;
  -- The deepest answer is an answer's real depth (a target round's score isn't a depth).
  select coalesce(max(depth), 0) into v_max from public.dive_guesses where dive_id = v_dive and is_best;
  select round, coalesce(answer, typed) into v_dr, v_da from public.dive_guesses where dive_id = v_dive and is_best order by depth desc, round limit 1;
  update public.dives set total = v_total, max_depth = v_max, depths = v_depths, deepest_round = v_dr, deepest_answer = v_da where id = v_dive;
  perform private.recount(p_user);
  return v_dive;
end $$;
-- The old call (no choices) is the same thing.
create or replace function private.store_dive(p_user uuid, p_day int, p_guesses jsonb, p_source text, p_ranked boolean) returns bigint
language sql security definer set search_path = public, private as $$ select private.store_dive(p_user, p_day, p_guesses, p_source, p_ranked, null::jsonb) $$;
revoke all on function private.store_dive(uuid, int, jsonb, text, boolean, jsonb) from public;
revoke all on function private.store_dive(uuid, int, jsonb, text, boolean) from public;

-- Hand in today's dive, with the risk choices made. Older pages that send no choices still work.
drop function if exists public.submit_dive(int, jsonb);
create or replace function public.submit_dive(p_day int, p_guesses jsonb, p_choices jsonb default null) returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v uuid := private.me(); v_dive bigint; was record; now_s record; fresh boolean := false;
begin
  select id into v_dive from public.dives where user_id = v and day = p_day;
  if v_dive is null then
    if not private.day_is_open(p_day) then raise exception 'day_closed'; end if;
    perform private.limit_rate('dive', 6, interval '1 hour');
    select current_streak, streak_last_day into was from public.player_stats where user_id = v;
    v_dive := private.store_dive(v, p_day, p_guesses, 'play', true, p_choices); fresh := true;
  end if;
  select * into now_s from public.player_stats where user_id = v;
  return (select jsonb_build_object('day', d.day, 'total', d.total, 'max_depth', d.max_depth, 'depths', d.depths, 'deepest_answer', d.deepest_answer, 'saved', fresh,
      'streak', private.live_streak(now_s.current_streak, now_s.streak_last_day), 'longest', now_s.longest_streak,
      'extended', fresh and now_s.streak_last_day = p_day and now_s.current_streak > 1 and was.streak_last_day = p_day - 1,
      'rounds', (select jsonb_agg(jsonb_build_object('round', x.round, 'kind', x.kind, 'choice', x.choice, 'stake', x.stake, 'score', x.score, 'outcome', x.outcome) order by x.round) from public.dive_rounds x where x.dive_id = d.id)) || private.rank_of(d.id)
    from public.dives d where d.id = v_dive);
exception when unique_violation then                    -- two devices at the same moment: the first one stands
  return public.submit_dive(p_day, p_guesses, p_choices);
end $$;
revoke all on function public.submit_dive(int, jsonb, jsonb) from public, anon;
grant execute on function public.submit_dive(int, jsonb, jsonb) to authenticated;

-- Guest days brought into an account carry their risk choices too ({ day, guesses, choices }).
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
      begin perform private.store_dive(v, n, d->'guesses', 'guest', private.day_is_open(n), d->'choices'); state := 'saved';
      exception when others then state := 'refused'; end;
    end if;
    res := res || jsonb_build_object('day', n, 'state', state);
  end loop;
  return res;
end $$;

-- Friends' round outcomes for a day (who hit the target closest, who risked what), behind the spoiler rule: only
-- once you've handed in your own dive for that day, or the day has closed.
create or replace function public.friends_rounds(p_day int) returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare v uuid := private.me();
begin
  if not private.can_see_day(v, p_day) then raise exception 'finish_first'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('username', p.username, 'total', d.total,
      'rounds', (select jsonb_agg(jsonb_build_object('round', x.round, 'kind', x.kind, 'choice', x.choice, 'score', x.score, 'outcome', x.outcome) order by x.round) from public.dive_rounds x where x.dive_id = d.id))
      order by d.total desc)
    from public.dives d join public.profiles p on p.id = d.user_id
    where d.day = p_day and (d.user_id = v or private.are_friends(v, d.user_id)) and not private.blocked_between(v, d.user_id)), '[]'::jsonb);
end $$;
revoke all on function public.friends_rounds(int) from public, anon;
grant execute on function public.friends_rounds(int) to authenticated;
