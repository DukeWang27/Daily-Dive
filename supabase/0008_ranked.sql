-- Ranked 1v1 for the submarine race: a matchmaking queue, Elo ratings, rank history and a ranked leaderboard.
-- Paste into Supabase after 0007 (SQL Editor -> New query -> Run). Safe to run again. Changes no existing data.
--
-- The format: two players, five questions, 20 seconds each, three guesses a question, the deepest answer on each
-- question counts (the race's own rules, unchanged). Everything is decided here, never in a browser: who is matched,
-- the questions, the clock, every depth, the winner and the rating change.
--
-- Fairness rules:
--   - Ratings change only through a finished ranked match, once (rating_history has one row per player per match).
--   - A player who leaves a ranked match loses it (a forfeit). If both leave, or the race is abandoned, nobody's
--     rating changes.
--   - An answer still waiting for review can't decide a match: if pending answers could change the winner, the result
--     waits up to three minutes for review; if they still could, the match counts as no contest (no rating change).
--   - The same two players are rated against each other at most three times in 24 hours (stops win-trading).
--   - Ranked questions come from their own pool (race_pool.ranked), never from upcoming daily questions, and a player
--     doesn't meet a question again within a week where the pool allows.
--   - No bots: every ranked opponent is a real signed-in player.

alter table public.races drop constraint if exists races_kind_check;
alter table public.races add constraint races_kind_check check (kind in ('private', 'public', 'practice', 'ranked'));
alter table public.race_pool add column if not exists ranked boolean not null default false;
-- Ranked uses the questions with the widest answer lists (and so the most reliable checking).
update public.race_pool p set ranked = true where active and (select count(*) from public.set_answers a where a.set_id = p.qid) >= 120 and not ranked;

create table if not exists public.ratings (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  elo int not null default 1000, peak int not null default 1000,
  played int not null default 0, wins int not null default 0, losses int not null default 0, draws int not null default 0,
  streak int not null default 0, best_streak int not null default 0,       -- current and longest run of wins
  updated_at timestamptz not null default now()
);
create table if not exists public.rating_history (
  race_id bigint not null references public.races on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  opponent uuid references public.profiles (id) on delete set null,
  result text not null check (result in ('win', 'loss', 'draw', 'void')),
  reason text,                                                           -- forfeit, unresolved, repeat_pair, abandoned
  before int not null, after int not null, delta int not null,
  my_distance int, their_distance int, at timestamptz not null default now(),
  primary key (race_id, user_id)
);
create index if not exists rating_history_user on public.rating_history (user_id, at desc);
create table if not exists public.ranked_queue (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  elo int not null, joined_at timestamptz not null default now(), last_seen timestamptz not null default now()
);
alter table public.ratings enable row level security;
alter table public.rating_history enable row level security;
alter table public.ranked_queue enable row level security;
-- Ratings are public (they're on the leaderboard); history and the queue are read only through the functions below.
drop policy if exists "ratings are public" on public.ratings;
create policy "ratings are public" on public.ratings for select using (true);
grant select on public.ratings to anon, authenticated;

-- Elo. K is larger for a player's first ten matches (placement), so new players find their level quickly.
create or replace function private.k_factor(p_played int) returns int language sql immutable as $$ select case when p_played < 10 then 40 else 32 end $$;
create or replace function private.elo_delta(p_me int, p_them int, p_score numeric, p_k int) returns int language sql immutable as $$
  select round(p_k * (p_score - 1 / (1 + power(10::numeric, (p_them - p_me) / 400.0))))::int $$;

-- Settle a finished ranked match, once. Returns the outcome, or 'waiting' while pending answers could still change it.
create or replace function private.ranked_settle(p_race bigint) returns text language plpgsql security definer set search_path = public, private as $$
declare r public.races; a record; b record; ra public.ratings; rb public.ratings; sa numeric; why text; ka int; kb int; da int := 0; db int := 0; uncertain boolean := false; pa int; pb int;
begin
  select * into r from public.races where id = p_race for update;
  if r.id is null or r.kind <> 'ranked' then return 'not_ranked'; end if;
  if exists (select 1 from public.rating_history where race_id = p_race) then return 'settled'; end if;
  if r.status not in ('finished', 'closed') then return 'playing'; end if;
  select p.user_id, p.left_at, private.race_distance(r.id, r.match_no, p.user_id) dist,
         coalesce((select max(depth) from public.race_guesses g where g.race_id = r.id and g.match_no = r.match_no and g.user_id = p.user_id and g.status = 'ok'), 0) deepest
    into a from public.race_players p where p.race_id = r.id order by p.seat limit 1;
  select p.user_id, p.left_at, private.race_distance(r.id, r.match_no, p.user_id) dist,
         coalesce((select max(depth) from public.race_guesses g where g.race_id = r.id and g.match_no = r.match_no and g.user_id = p.user_id and g.status = 'ok'), 0) deepest
    into b from public.race_players p where p.race_id = r.id and p.user_id <> a.user_id order by p.seat limit 1;
  if b.user_id is null then return 'no_opponent'; end if;
  insert into public.ratings (user_id) values (a.user_id), (b.user_id) on conflict do nothing;
  select * into ra from public.ratings where user_id = a.user_id for update;
  select * into rb from public.ratings where user_id = b.user_id for update;

  -- Leaving counts only while the match is being played (before the last question closed); leaving the results doesn't.
  a.left_at := case when a.left_at < coalesce(r.round_end, now()) then a.left_at end; b.left_at := case when b.left_at < coalesce(r.round_end, now()) then b.left_at end;
  if r.status = 'closed' and a.left_at is null and b.left_at is null then sa := null; why := 'abandoned';            -- everyone vanished: no contest
  elsif a.left_at is not null and b.left_at is not null then sa := null; why := 'abandoned';
  elsif a.left_at is not null then sa := 0; why := 'forfeit';
  elsif b.left_at is not null then sa := 1; why := 'forfeit';
  else
    -- Could answers still waiting for review change the winner? Each pending question could at most add up to 299 m.
    pa := (select count(distinct round) from public.race_guesses g where g.race_id = r.id and g.match_no = r.match_no and g.user_id = a.user_id and g.status = 'pending');
    pb := (select count(distinct round) from public.race_guesses g where g.race_id = r.id and g.match_no = r.match_no and g.user_id = b.user_id and g.status = 'pending');
    uncertain := (a.dist <= b.dist and pa > 0 and a.dist + 299 * pa >= b.dist) or (b.dist <= a.dist and pb > 0 and b.dist + 299 * pb >= a.dist);
    if uncertain and now() < coalesce(r.round_end, r.touched_at) + interval '3 minutes' then return 'waiting'; end if;
    if uncertain then sa := null; why := 'unresolved';
    elsif a.dist > b.dist or (a.dist = b.dist and a.deepest > b.deepest) then sa := 1;
    elsif b.dist > a.dist or (a.dist = b.dist and b.deepest > a.deepest) then sa := 0;
    else sa := 0.5; end if;
  end if;
  -- Win-trading guard: the same pair is rated at most three times a day.
  if sa is not null and (select count(*) from public.rating_history h where h.user_id = a.user_id and h.opponent = b.user_id and h.result <> 'void' and h.at > now() - interval '24 hours') >= 3 then
    sa := null; why := 'repeat_pair'; end if;
  if sa is not null then
    ka := private.k_factor(ra.played); kb := private.k_factor(rb.played);
    da := private.elo_delta(ra.elo, rb.elo, sa, ka); db := private.elo_delta(rb.elo, ra.elo, 1 - sa, kb);
  end if;
  insert into public.rating_history (race_id, user_id, opponent, result, reason, before, after, delta, my_distance, their_distance) values
    (r.id, a.user_id, b.user_id, case when sa is null then 'void' when sa = 1 then 'win' when sa = 0 then 'loss' else 'draw' end, why, ra.elo, greatest(100, ra.elo + da), greatest(100, ra.elo + da) - ra.elo, a.dist, b.dist),
    (r.id, b.user_id, a.user_id, case when sa is null then 'void' when sa = 0 then 'win' when sa = 1 then 'loss' else 'draw' end, why, rb.elo, greatest(100, rb.elo + db), greatest(100, rb.elo + db) - rb.elo, b.dist, a.dist);
  if sa is not null then
    update public.ratings set elo = greatest(100, elo + da), peak = greatest(peak, elo + da), played = played + 1,
      wins = wins + (sa = 1)::int, losses = losses + (sa = 0)::int, draws = draws + (sa = 0.5)::int,
      streak = case when sa = 1 then streak + 1 else 0 end, best_streak = greatest(best_streak, case when sa = 1 then streak + 1 else 0 end), updated_at = now() where user_id = a.user_id;
    update public.ratings set elo = greatest(100, elo + db), peak = greatest(peak, elo + db), played = played + 1,
      wins = wins + (sa = 0)::int, losses = losses + (sa = 1)::int, draws = draws + (sa = 0.5)::int,
      streak = case when sa = 0 then streak + 1 else 0 end, best_streak = greatest(best_streak, case when sa = 0 then streak + 1 else 0 end), updated_at = now() where user_id = b.user_id;
  end if;
  return coalesce(why, 'rated');
end $$;
revoke all on function private.ranked_settle(bigint) from public, anon, authenticated;

-- Ranked questions: the ranked pool, avoiding questions either player met in the last week where possible.
create or replace function private.ranked_pick(p_a uuid, p_b uuid, p_n int) returns int[] language sql volatile set search_path = public, private as $$
  with seen as (select unnest(r.questions) qid from public.races r join public.race_players p on p.race_id = r.id
                where p.user_id in (p_a, p_b) and r.created_at > now() - interval '7 days'),
  fresh as (select qid from public.race_pool where active and ranked and qid not in (select qid from seen) order by random() limit p_n),
  fill as (select qid from public.race_pool where active and ranked and qid not in (select qid from fresh) order by random() limit greatest(0, p_n - (select count(*) from fresh)))
  select array_agg(qid) from (select qid from fresh union all select qid from fill) q $$;

-- Look for an opponent (call every two seconds or so while searching). One queue for everyone; the acceptable rating
-- gap starts at 100 and widens by 20 points a second of waiting, up to 600, so a small player base still finds games.
create or replace function public.ranked_find() returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v uuid := private.me(); me public.ranked_queue; o public.ranked_queue; rid bigint; mine int; waited numeric; win int; qs int[];
begin
  if v is null or not exists (select 1 from public.profiles where id = v) then raise exception 'sign_in_required'; end if;
  -- Already in a ranked match that is still running: go back to it (a refresh or a dropped connection).
  select r.id into rid from public.races r join public.race_players p on p.race_id = r.id
    where p.user_id = v and p.left_at is null and r.kind = 'ranked' and r.status in ('question', 'between') order by r.created_at desc limit 1;
  if rid is not null then return jsonb_build_object('status', 'matched', 'race', public.race_state(rid)); end if;
  perform pg_advisory_xact_lock(hashtext('ranked_queue'));          -- one matchmaker at a time: nobody is matched twice
  delete from public.ranked_queue where last_seen < now() - interval '12 seconds';
  mine := coalesce((select elo from public.ratings where user_id = v), 1000);
  insert into public.ranked_queue (user_id, elo) values (v, mine) on conflict (user_id) do update set last_seen = now(), elo = excluded.elo;
  select * into me from public.ranked_queue where user_id = v;
  waited := extract(epoch from now() - me.joined_at); win := least(600, 100 + (20 * waited)::int);
  select q.* into o from public.ranked_queue q
    where q.user_id <> v and abs(q.elo - me.elo) <= greatest(win, least(600, 100 + (20 * extract(epoch from now() - q.joined_at))::int))
      and not private.blocked_between(v, q.user_id)
      and (select count(*) from public.rating_history h where h.user_id = v and h.opponent = q.user_id and h.result <> 'void' and h.at > now() - interval '24 hours') < 3
    order by abs(q.elo - me.elo), q.joined_at limit 1;
  if o.user_id is null then
    return jsonb_build_object('status', 'searching', 'waited', round(waited), 'range', win, 'elo', mine, 'searching', (select count(*) from public.ranked_queue));
  end if;
  qs := private.ranked_pick(v, o.user_id, 5);
  if coalesce(array_length(qs, 1), 0) < 5 then return jsonb_build_object('status', 'searching', 'waited', round(waited), 'range', win, 'elo', mine, 'note', 'pool'); end if;
  insert into public.races (code, kind, host, q_count, seconds, max_players, status, questions, round, round_start, round_end)
    values (private.race_code(), 'ranked', null, 5, 20, 2, 'question', qs, 1, now() + interval '6 seconds', now() + interval '26 seconds') returning id into rid;
  insert into public.race_players (race_id, user_id, seat, ready) values (rid, o.user_id, 0, true), (rid, v, 1, true);
  delete from public.ranked_queue where user_id in (v, o.user_id);
  return jsonb_build_object('status', 'matched', 'race', public.race_state(rid));
end $$;

create or replace function public.ranked_cancel() returns void language sql security definer set search_path = public, private as $$
  delete from public.ranked_queue where user_id = private.me() $$;

-- The result of a ranked match, settling it if it's due. Both players see the same thing.
create or replace function public.ranked_result(p_race bigint) returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v uuid := private.race_member(p_race); outcome text;
begin
  perform private.race_tick(p_race);
  outcome := private.ranked_settle(p_race);
  return jsonb_build_object('outcome', outcome, 'players', (select coalesce(jsonb_agg(jsonb_build_object('username', pr.username, 'me', h.user_id = v, 'result', h.result, 'reason', h.reason,
      'before', h.before, 'after', h.after, 'delta', h.delta, 'distance', h.my_distance) order by h.user_id = v desc), '[]'::jsonb)
    from public.rating_history h join public.profiles pr on pr.id = h.user_id where h.race_id = p_race));
end $$;

-- A player's competitive record: rating, peak, results, streaks, the last 20 matches and their rating over time.
create or replace function public.ranked_profile(p_username text default null) returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare u uuid := coalesce(private.find_user(p_username), private.me()); r public.ratings;
begin
  if u is null then return null; end if;
  select * into r from public.ratings where user_id = u;
  return jsonb_build_object('username', (select username from public.profiles where id = u), 'elo', coalesce(r.elo, 1000), 'peak', coalesce(r.peak, 1000),
    'played', coalesce(r.played, 0), 'wins', coalesce(r.wins, 0), 'losses', coalesce(r.losses, 0), 'draws', coalesce(r.draws, 0),
    'streak', coalesce(r.streak, 0), 'best_streak', coalesce(r.best_streak, 0), 'placement_left', greatest(0, 10 - coalesce(r.played, 0)),
    'recent', (select coalesce(jsonb_agg(x order by x.at desc), '[]'::jsonb) from (select h.at, h.result, h.reason, h.delta, h.after, h.my_distance, h.their_distance,
        (select username from public.profiles where id = h.opponent) opponent from public.rating_history h where h.user_id = u order by h.at desc limit 20) x),
    'history', (select coalesce(jsonb_agg(jsonb_build_array(extract(epoch from h.at)::bigint, h.after) order by h.at), '[]'::jsonb) from public.rating_history h where h.user_id = u and h.result <> 'void'));
end $$;

-- The ranked leaderboard, separate from the daily one. Players appear after their ten placement matches.
create or replace function public.ranked_board(p_limit int default 50, p_offset int default 0) returns jsonb language sql stable security definer set search_path = public, private as $$
  select coalesce(jsonb_agg(x order by x.elo desc, x.wins desc), '[]'::jsonb) from (
    select pr.username, pr.avatar, r.elo, r.peak, r.played, r.wins, r.losses, r.draws, rank() over (order by r.elo desc) place, r.user_id = private.me() me
    from public.ratings r join public.profiles pr on pr.id = r.user_id where r.played >= 10
    order by r.elo desc, r.wins desc limit least(100, greatest(1, p_limit)) offset greatest(0, p_offset)) x $$;

-- Ranked matches are settled the moment they finish (the client also asks, through ranked_result, in case review is pending).
create or replace function private.ranked_on_finish() returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  if new.kind = 'ranked' and new.status in ('finished', 'closed') and old.status is distinct from new.status then perform private.ranked_settle(new.id); end if;
  return new;
end $$;
drop trigger if exists ranked_on_finish on public.races;
create trigger ranked_on_finish after update of status on public.races for each row execute function private.ranked_on_finish();

-- A ranked match is never replayed with a rematch: queue again instead.
create or replace function public.race_rematch(p_race bigint) returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v uuid := private.race_member(p_race); r public.races;
begin
  select * into r from public.races where id = p_race for update;
  if r.kind = 'ranked' then raise exception 'ranked_no_rematch'; end if;
  if r.status = 'finished' then
    update public.races set status = 'lobby', match_no = match_no + 1, round = 0, round_start = null, round_end = null, between_until = null, lobby_until = null, touched_at = now(),
      host = case when kind = 'public' then host else coalesce((select user_id from public.race_players where race_id = p_race and user_id = r.host and left_at is null), v) end where id = p_race;
    update public.race_players set ready = (user_id = v), done_round = 0 where race_id = p_race;
    if r.kind = 'practice' then perform private.race_begin((select x from public.races x where id = p_race)); end if;
  end if;
  update public.race_players set ready = true where race_id = p_race and user_id = v;
  return public.race_state(p_race);
end $$;

revoke all on function public.ranked_find(), public.ranked_cancel(), public.ranked_result(bigint) from public, anon;
grant execute on function public.ranked_find(), public.ranked_cancel(), public.ranked_result(bigint), public.ranked_profile(text), public.ranked_board(int, int) to authenticated;
grant execute on function public.ranked_profile(text), public.ranked_board(int, int) to anon;
