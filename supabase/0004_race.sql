-- The submarine race: live races between players, run entirely by the database.
-- Paste into Supabase after 0002 (SQL Editor → New query → Run), then 0005_race_answers.sql. Safe to run again.
--
-- What the database decides, so no browser can bend it:
--   when each question starts and ends (one shared deadline for everyone), which questions a race uses, how many
--   guesses each player has (three a question), whether a typed answer is real, how deep it goes, each player's
--   distance (the deepest answer per question, added up), who wins, and when everyone may see everyone's answers.
-- During a question, other racers' distances are shared (so their submarines can move) but never their answers.
-- Races never touch the daily game: different questions, different tables, no effect on streaks or rankings.
--
-- There is no background job: the race moves on whenever any racer asks for its state (every second or so while
-- playing), using the database clock.

create table if not exists public.race_pool (
  qid int primary key references public.answer_sets on delete cascade,
  key text not null, title text not null, active boolean not null default true
);
create table if not exists public.races (
  id bigint generated always as identity primary key,
  code text not null unique check (code ~ '^[A-Z2-9]{6}$'),
  kind text not null check (kind in ('private', 'public', 'practice')),
  host uuid references public.profiles (id) on delete set null,
  status text not null default 'lobby' check (status in ('lobby', 'question', 'between', 'finished', 'closed')),
  match_no int not null default 1,
  q_count smallint not null default 10 check (q_count in (5, 10, 15)),
  seconds smallint not null default 30 check (seconds in (20, 30, 45)),
  max_players smallint not null default 8 check (max_players between 2 and 8),
  questions int[] not null default '{}',
  round smallint not null default 0,
  round_start timestamptz, round_end timestamptz, between_until timestamptz, lobby_until timestamptz,
  created_at timestamptz not null default now(), touched_at timestamptz not null default now()
);
create index if not exists races_open_public on public.races (kind, status) where status = 'lobby';
create table if not exists public.race_players (
  race_id bigint not null references public.races on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  seat smallint not null,                            -- 0..7: lane and colour, kept for the whole race
  joined_at timestamptz not null default now(), left_at timestamptz,
  ready boolean not null default false,
  done_round smallint not null default 0,            -- the last round this player finished early
  last_seen timestamptz not null default now(),
  primary key (race_id, user_id)
);
create table if not exists public.race_guesses (
  race_id bigint not null references public.races on delete cascade,
  match_no int not null, round smallint not null, user_id uuid not null references public.profiles (id) on delete cascade,
  slot smallint not null check (slot between 1 and 3),
  typed text not null check (char_length(typed) <= 60), answer text,
  status text not null check (status in ('ok', 'pending')),
  share double precision, depth int, at timestamptz not null default now(),
  primary key (race_id, match_no, round, user_id, slot)
);
create table if not exists public.race_results (
  race_id bigint not null references public.races on delete cascade,
  match_no int not null, user_id uuid not null references public.profiles (id) on delete cascade,
  place smallint not null, racers smallint not null, distance int not null, deepest int not null, rounds_won smallint not null,
  kind text not null, finished_at timestamptz not null default now(),
  primary key (race_id, match_no, user_id)
);
create table if not exists public.race_invites (
  race_id bigint not null references public.races on delete cascade,
  from_user uuid not null references public.profiles (id) on delete cascade,
  to_user uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (race_id, to_user)
);
alter table public.race_pool enable row level security;
alter table public.races enable row level security;
alter table public.race_players enable row level security;
alter table public.race_guesses enable row level security;
alter table public.race_results enable row level security;
alter table public.race_invites enable row level security;

-- How long things take, in one place.
create or replace function private.race_t(k text) returns interval language sql immutable as $$
  select case k when 'countdown' then interval '4 seconds' when 'between' then interval '7 seconds' when 'grace' then interval '1.5 seconds'
    when 'lobby_wait' then interval '15 seconds' when 'away' then interval '20 seconds' when 'abandon' then interval '90 seconds' end $$;

create or replace function private.race_code() returns text language plpgsql volatile as $$
declare alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; c text;
begin
  loop
    c := ''; for i in 1..6 loop c := c || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1); end loop;
    exit when not exists (select 1 from public.races where code = c);
  end loop;
  return c;
end $$;

-- A racer's best answer on each question so far, added up: their distance.
create or replace function private.race_distance(p_race bigint, p_match int, p_user uuid) returns int language sql stable as $$
  select coalesce(sum(best), 0)::int from (select max(depth) best from public.race_guesses where race_id = p_race and match_no = p_match and user_id = p_user and status = 'ok' group by round) b $$;

-- Pick the questions: ones this group hasn't had in this room's last race, in random order.
create or replace function private.race_pick(p_race bigint, p_n int) returns int[] language sql volatile as $$
  select array_agg(qid) from (select qid from public.race_pool where active and qid <> all (coalesce((select questions from public.races where id = p_race), '{}'))
    order by random() limit p_n) q $$;

create or replace function private.race_begin(r public.races) returns void language plpgsql as $$
declare qs int[] := private.race_pick(r.id, r.q_count);
begin
  if coalesce(array_length(qs, 1), 0) < r.q_count then qs := (select array_agg(qid order by random()) from (select qid from public.race_pool where active order by random() limit r.q_count) x); end if;
  update public.races set status = 'question', questions = qs, round = 1, round_start = now() + private.race_t('countdown'),
    round_end = now() + private.race_t('countdown') + make_interval(secs => r.seconds), between_until = null, lobby_until = null, touched_at = now() where id = r.id;
  update public.race_players set done_round = 0 where race_id = r.id;
end $$;

-- Move the race along if it is time. Called on every request, under a row lock so two racers can't both advance it.
create or replace function private.race_tick(p_race bigint) returns void language plpgsql security definer set search_path = public, private as $$
declare r public.races; n_active int; n_waiting int; n_ready int; done_all boolean;
begin
  select * into r from public.races where id = p_race for update;
  if r.id is null or r.status in ('closed') then return; end if;
  -- Everyone gone for a while: the race is over.
  if not exists (select 1 from public.race_players where race_id = r.id and left_at is null and last_seen > now() - private.race_t('abandon')) then
    update public.races set status = 'closed', touched_at = now() where id = r.id; return;
  end if;
  select count(*) filter (where left_at is null), count(*) filter (where left_at is null and last_seen > now() - private.race_t('away')),
         count(*) filter (where left_at is null and (ready or user_id = r.host)) into n_active, n_waiting, n_ready from public.race_players where race_id = r.id;
  if r.status = 'lobby' then
    if r.kind = 'public' then
      -- Quick races start on their own: 15 seconds after a second racer arrives, or as soon as the room is full.
      if n_waiting >= 2 and r.lobby_until is null then update public.races set lobby_until = now() + private.race_t('lobby_wait') where id = r.id;
      elsif n_waiting < 2 and r.lobby_until is not null then update public.races set lobby_until = null where id = r.id;
      elsif n_waiting >= 2 and (now() >= r.lobby_until or n_waiting >= r.max_players) then perform private.race_begin(r);
      end if;
    end if;
    return;
  end if;
  if r.status = 'question' then
    -- The question closes at its deadline, or early once every racer who is still here has used three guesses or
    -- finished. A racer who has dropped out doesn't hold everyone up.
    select bool_and(p.done_round >= r.round or (select count(*) from public.race_guesses g where g.race_id = r.id and g.match_no = r.match_no and g.round = r.round and g.user_id = p.user_id) >= 3)
      into done_all from public.race_players p where p.race_id = r.id and p.left_at is null and p.last_seen > now() - private.race_t('away');
    if now() >= r.round_end or (coalesce(done_all, true) and now() >= r.round_start) then
      update public.races set status = 'between', round_end = least(r.round_end, now()), between_until = now() + private.race_t('between'), touched_at = now() where id = r.id;
    end if;
    return;
  end if;
  if r.status = 'between' and now() >= r.between_until then
    if r.round < array_length(r.questions, 1) then
      update public.races set status = 'question', round = r.round + 1, round_start = now() + interval '1 second', round_end = now() + interval '1 second' + make_interval(secs => r.seconds), between_until = null, touched_at = now() where id = r.id;
    else
      perform private.race_finish(r);
    end if;
  end if;
end $$;

-- Final places: distance, then the deepest single answer, then questions won, then whoever reached their distance first.
create or replace function private.race_finish(r public.races) returns void language plpgsql security definer set search_path = public, private as $$
begin
  update public.races set status = 'finished', touched_at = now() where id = r.id;
  with per as (
    select p.user_id, private.race_distance(r.id, r.match_no, p.user_id) dist,
      coalesce((select max(depth) from public.race_guesses g where g.race_id = r.id and g.match_no = r.match_no and g.user_id = p.user_id and g.status = 'ok'), 0) deepest,
      (select count(*) from (select g.round, max(g.depth) d from public.race_guesses g where g.race_id = r.id and g.match_no = r.match_no and g.user_id = p.user_id and g.status = 'ok' group by g.round) mine
         where mine.d > 0 and mine.d >= (select max(depth) from public.race_guesses o where o.race_id = r.id and o.match_no = r.match_no and o.round = mine.round and o.status = 'ok')) won,
      coalesce((select max(at) from public.race_guesses g where g.race_id = r.id and g.match_no = r.match_no and g.user_id = p.user_id), p.joined_at) last_at
    from public.race_players p where p.race_id = r.id and (p.left_at is null or exists (select 1 from public.race_guesses g where g.race_id = r.id and g.match_no = r.match_no and g.user_id = p.user_id))),
  placed as (select *, row_number() over (order by dist desc, deepest desc, won desc, last_at) place, count(*) over () n from per)
  insert into public.race_results (race_id, match_no, user_id, place, racers, distance, deepest, rounds_won, kind)
  select r.id, r.match_no, user_id, place, n, dist, deepest, won, r.kind from placed
  on conflict (race_id, match_no, user_id) do nothing;
end $$;

create or replace function private.race_member(p_race bigint) returns uuid language plpgsql security definer set search_path = public, private as $$
declare v uuid := private.me();
begin
  if not exists (select 1 from public.race_players where race_id = p_race and user_id = v and left_at is null) then raise exception 'not_in_race'; end if;
  return v;
end $$;

-- Everything a racer's screen needs, as of now. Only ever their own answers during a question; everyone's once it closes.
create or replace function public.race_state(p_race bigint) returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v uuid := private.race_member(p_race); r public.races; open_round int;
begin
  update public.race_players set last_seen = now() where race_id = p_race and user_id = v;
  perform private.race_tick(p_race);
  select * into r from public.races where id = p_race;
  -- Answers are shared for every question that has closed: all of them between questions and at the end, all but the current one during a question.
  open_round := case when r.status = 'question' then r.round else 0 end;
  return jsonb_build_object('id', r.id, 'code', r.code, 'kind', r.kind, 'status', r.status, 'match', r.match_no, 'host', (select username from public.profiles where id = r.host), 'me', (select username from public.profiles where id = v),
    'q_count', r.q_count, 'seconds', r.seconds, 'max_players', r.max_players, 'round', r.round,
    'qid', case when r.round > 0 and r.status <> 'lobby' then r.questions[r.round] end,
    'questions', case when r.status = 'finished' then to_jsonb(r.questions) when r.round > 1 then to_jsonb(r.questions[1:r.round - 1]) else '[]'::jsonb end,
    'now', now(), 'round_start', r.round_start, 'round_end', r.round_end, 'between_until', r.between_until, 'lobby_until', r.lobby_until,
    'players', (select coalesce(jsonb_agg(jsonb_build_object('username', pr.username, 'avatar', pr.avatar, 'seat', p.seat, 'ready', p.ready or p.user_id = r.host, 'host', p.user_id = r.host,
        'here', p.last_seen > now() - private.race_t('away'), 'me', p.user_id = v, 'friend', private.are_friends(v, p.user_id),
        'distance', private.race_distance(r.id, r.match_no, p.user_id),
        'used', (select count(*) from public.race_guesses g where g.race_id = r.id and g.match_no = r.match_no and g.round = r.round and g.user_id = p.user_id),
        'done', p.done_round >= r.round and r.round > 0,
        -- Unfathomable finds (one answer 300 m or deeper): a count only, never the answer, so everyone can see a
        -- racer go beneath the iceberg the moment it happens.
        'finds', (select count(*) from public.race_guesses g where g.race_id = r.id and g.match_no = r.match_no and g.user_id = p.user_id and g.status = 'ok' and g.depth >= 300),
        'wins', (select count(*) from public.race_results x where x.race_id = r.id and x.user_id = p.user_id and x.place = 1)) order by p.seat), '[]'::jsonb)
      from public.race_players p join public.profiles pr on pr.id = p.user_id where p.race_id = r.id and p.left_at is null),
    'mine', (select coalesce(jsonb_agg(jsonb_build_object('round', g.round, 'slot', g.slot, 'typed', g.typed, 'answer', g.answer, 'status', g.status, 'share', g.share, 'depth', g.depth) order by g.round, g.slot), '[]'::jsonb)
      from public.race_guesses g where g.race_id = r.id and g.match_no = r.match_no and g.user_id = v),
    'revealed', (select coalesce(jsonb_agg(jsonb_build_object('round', g.round, 'username', pr.username, 'slot', g.slot, 'answer', g.answer, 'typed', g.typed, 'status', g.status, 'share', g.share, 'depth', g.depth) order by g.round, pr.username, g.slot), '[]'::jsonb)
      from public.race_guesses g join public.profiles pr on pr.id = g.user_id
      where g.race_id = r.id and g.match_no = r.match_no and g.round <> open_round and g.round <= r.round and g.user_id <> v and not private.blocked_between(v, g.user_id)),
    'results', case when r.status = 'finished' then (select coalesce(jsonb_agg(jsonb_build_object('username', pr.username, 'avatar', pr.avatar, 'place', x.place, 'distance', x.distance, 'deepest', x.deepest, 'rounds_won', x.rounds_won) order by x.place), '[]'::jsonb)
      from public.race_results x join public.profiles pr on pr.id = x.user_id where x.race_id = r.id and x.match_no = r.match_no) end);
end $$;

-- Start a private race (or a practice one, alone) and be its host.
create or replace function public.race_create(p_kind text default 'private', p_questions int default 10, p_seconds int default 30, p_max int default 8) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare v uuid := private.me(); rid bigint;
begin
  if p_kind not in ('private', 'practice') then raise exception 'bad_kind'; end if;
  perform private.limit_rate('race_create', 20, interval '1 hour');
  insert into public.races (code, kind, host, q_count, seconds, max_players) values (private.race_code(), p_kind, v,
    case when p_questions in (5, 10, 15) then p_questions else 10 end, case when p_seconds in (20, 30, 45) then p_seconds else 30 end,
    case when p_kind = 'practice' then 2 else least(8, greatest(2, p_max)) end) returning id into rid;
  insert into public.race_players (race_id, user_id, seat, ready) values (rid, v, 0, true);
  if p_kind = 'practice' then perform private.race_begin((select r from public.races r where id = rid)); end if;
  return public.race_state(rid);
end $$;

-- Quick race: join a public lobby that is waiting, or open one.
create or replace function public.race_quick() returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v uuid := private.me(); rid bigint;
begin
  perform private.limit_rate('race_join', 60, interval '1 hour');
  select r.id into rid from public.races r where r.kind = 'public' and r.status = 'lobby' and r.created_at > now() - interval '15 minutes'
    and (select count(*) from public.race_players p where p.race_id = r.id and p.left_at is null) < r.max_players
    and not exists (select 1 from public.race_players p where p.race_id = r.id and p.left_at is null and private.blocked_between(v, p.user_id))
    order by r.created_at limit 1 for update skip locked;
  if rid is null then insert into public.races (code, kind, host, q_count, seconds, max_players) values (private.race_code(), 'public', v, 10, 30, 8) returning id into rid; end if;
  return public.race_join((select code from public.races where id = rid));
end $$;

-- Join by code, or come back to a race you're already in after losing the connection.
create or replace function public.race_join(p_code text) returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v uuid := private.me(); r public.races; seat int;
begin
  select * into r from public.races where code = upper(btrim(p_code)) for update;
  if r.id is null or r.status = 'closed' then raise exception 'race_not_found'; end if;
  if exists (select 1 from public.race_players where race_id = r.id and user_id = v and left_at is null) then return public.race_state(r.id); end if;
  if r.status <> 'lobby' then raise exception 'race_started'; end if;
  if r.kind = 'practice' then raise exception 'race_not_found'; end if;
  if (select count(*) from public.race_players where race_id = r.id and left_at is null) >= r.max_players then raise exception 'race_full'; end if;
  if exists (select 1 from public.race_players p where p.race_id = r.id and p.left_at is null and private.blocked_between(v, p.user_id)) then raise exception 'race_not_found'; end if;
  select min(s) into seat from generate_series(0, 7) s where s not in (select x.seat from public.race_players x where x.race_id = r.id and x.left_at is null);
  insert into public.race_players (race_id, user_id, seat) values (r.id, v, seat)
    on conflict (race_id, user_id) do update set left_at = null, seat = excluded.seat, ready = false, joined_at = now(), last_seen = now();
  if r.host is null or not exists (select 1 from public.race_players where race_id = r.id and user_id = r.host and left_at is null) then update public.races set host = v where id = r.id; end if;
  delete from public.race_invites where race_id = r.id and to_user = v;
  update public.races set touched_at = now() where id = r.id;
  return public.race_state(r.id);
end $$;

create or replace function public.race_leave(p_race bigint) returns void language plpgsql security definer set search_path = public, private as $$
declare v uuid := private.me(); r public.races; heir uuid;
begin
  select * into r from public.races where id = p_race for update;
  update public.race_players set left_at = now(), ready = false where race_id = p_race and user_id = v and left_at is null;
  if r.host = v then   -- the host passes to whoever has been here longest
    select user_id into heir from public.race_players where race_id = p_race and left_at is null order by joined_at limit 1;
    update public.races set host = heir where id = p_race;
  end if;
  if not exists (select 1 from public.race_players where race_id = p_race and left_at is null) then update public.races set status = 'closed' where id = p_race; end if;
end $$;

create or replace function public.race_ready(p_race bigint, p_ready boolean) returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v uuid := private.race_member(p_race);
begin
  update public.race_players set ready = p_ready, last_seen = now() where race_id = p_race and user_id = v;
  return public.race_state(p_race);
end $$;

create or replace function public.race_settings(p_race bigint, p_questions int, p_seconds int, p_max int) returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v uuid := private.race_member(p_race); r public.races;
begin
  select * into r from public.races where id = p_race for update;
  if r.host <> v then raise exception 'not_host'; end if;
  if r.status <> 'lobby' or r.kind <> 'private' then raise exception 'race_started'; end if;
  update public.races set q_count = case when p_questions in (5, 10, 15) then p_questions else q_count end,
    seconds = case when p_seconds in (20, 30, 45) then p_seconds else seconds end,
    max_players = greatest((select count(*) from public.race_players where race_id = p_race and left_at is null), least(8, greatest(2, coalesce(p_max, max_players)))) where id = p_race;
  update public.race_players set ready = false where race_id = p_race and user_id <> v;   -- the deal changed: everyone confirms again
  return public.race_state(p_race);
end $$;

create or replace function public.race_start(p_race bigint) returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v uuid := private.race_member(p_race); r public.races;
begin
  select * into r from public.races where id = p_race for update;
  if r.host <> v then raise exception 'not_host'; end if;
  if r.status <> 'lobby' then raise exception 'race_started'; end if;
  if (select count(*) from public.race_players where race_id = p_race and left_at is null) < 2 then raise exception 'need_two'; end if;
  if exists (select 1 from public.race_players where race_id = p_race and left_at is null and not ready and user_id <> v) then raise exception 'not_ready'; end if;
  perform private.race_begin(r);
  return public.race_state(p_race);
end $$;

-- One guess. Returns this racer's result at once: the answer's rarity, depth and how far the submarine moves.
create or replace function public.race_guess(p_race bigint, p_round int, p_typed text, p_answer text) returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v uuid := private.race_member(p_race); r public.races; qid int; used int; v_answer text := nullif(left(coalesce(p_answer, ''), 80), ''); v_share double precision; v_depth int; v_status text := 'pending';
  before int; after int; slot int;
begin
  perform private.race_tick(p_race);
  select * into r from public.races where id = p_race;
  if r.status <> 'question' or r.round <> p_round then raise exception 'round_closed'; end if;
  if now() < r.round_start then raise exception 'not_yet'; end if;
  if now() > r.round_end + private.race_t('grace') then raise exception 'round_closed'; end if;   -- a little allowance for the network, the same for everyone
  if (select done_round from public.race_players where race_id = p_race and user_id = v) >= r.round then raise exception 'round_closed'; end if;
  qid := r.questions[r.round];
  perform pg_advisory_xact_lock(hashtextextended(p_race::text || ':' || v::text, 0));   -- one guess at a time per racer, even from two tabs
  select count(*) into used from public.race_guesses where race_id = p_race and match_no = r.match_no and round = r.round and user_id = v;
  if used >= 3 then raise exception 'no_guesses_left'; end if;
  if v_answer is not null then
    select share, depth into v_share, v_depth from public.set_answers where set_id = qid and round = 1 and answer = v_answer;
    if v_depth is not null and private.claim_ok(qid, 1, p_typed, v_answer) then v_status := 'ok'; else v_answer := null; v_share := null; v_depth := null; end if;
    if v_status = 'ok' and exists (select 1 from public.race_guesses where race_id = p_race and match_no = r.match_no and round = r.round and user_id = v and answer = v_answer) then
      return jsonb_build_object('status', 'dup', 'answer', v_answer);                                 -- the same answer again: free, like the daily game
    end if;
  end if;
  before := private.race_distance(p_race, r.match_no, v);
  slot := used + 1;
  insert into public.race_guesses (race_id, match_no, round, user_id, slot, typed, answer, status, share, depth) values (p_race, r.match_no, r.round, v, slot, left(coalesce(p_typed, ''), 60), v_answer, v_status, v_share, v_depth);
  after := private.race_distance(p_race, r.match_no, v);
  update public.race_players set last_seen = now() where race_id = p_race and user_id = v;
  return jsonb_build_object('status', v_status, 'slot', slot, 'answer', v_answer, 'share', v_share, 'depth', v_depth, 'distance', after, 'moved', after - before, 'left', 3 - slot);
end $$;

-- Done with this question before the clock runs out.
create or replace function public.race_done(p_race bigint) returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v uuid := private.race_member(p_race);
begin
  update public.race_players p set done_round = r.round from public.races r where p.race_id = p_race and p.user_id = v and r.id = p_race and r.status = 'question';
  return public.race_state(p_race);
end $$;

-- After a race: same group, new questions. Back to the lobby with everyone unready (a quick race starts on its own).
create or replace function public.race_rematch(p_race bigint) returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v uuid := private.race_member(p_race); r public.races;
begin
  select * into r from public.races where id = p_race for update;
  if r.status = 'finished' then
    update public.races set status = 'lobby', match_no = match_no + 1, round = 0, round_start = null, round_end = null, between_until = null, lobby_until = null, touched_at = now(),
      host = case when kind = 'public' then host else coalesce((select user_id from public.race_players where race_id = p_race and user_id = r.host and left_at is null), v) end where id = p_race;
    update public.race_players set ready = (user_id = v), done_round = 0 where race_id = p_race;
    if r.kind = 'practice' then perform private.race_begin((select x from public.races x where id = p_race)); end if;
  end if;
  update public.race_players set ready = true where race_id = p_race and user_id = v;
  return public.race_state(p_race);
end $$;

create or replace function public.race_invite(p_race bigint, p_username text) returns text language plpgsql security definer set search_path = public, private as $$
declare v uuid := private.race_member(p_race); o uuid := private.find_user(p_username);
begin
  if o is null or not private.are_friends(v, o) then raise exception 'friends_only'; end if;
  perform private.limit_rate('race_invite', 40, interval '1 hour');
  insert into public.race_invites (race_id, from_user, to_user) values (p_race, v, o) on conflict (race_id, to_user) do update set created_at = now(), from_user = excluded.from_user;
  return 'invited';
end $$;
-- Invitations waiting for me (from friends, to races still in their lobby).
create or replace function public.race_invites() returns jsonb language sql security definer set search_path = public, private as $$
  select coalesce(jsonb_agg(jsonb_build_object('code', r.code, 'from', p.username, 'avatar', p.avatar, 'players', (select count(*) from public.race_players x where x.race_id = r.id and x.left_at is null), 'at', i.created_at) order by i.created_at desc), '[]'::jsonb)
  from public.race_invites i join public.races r on r.id = i.race_id join public.profiles p on p.id = i.from_user
  where i.to_user = private.me() and r.status = 'lobby' and i.created_at > now() - interval '2 hours' and private.are_friends(i.to_user, i.from_user) $$;

-- How many racers are waiting in quick-race lobbies right now (shown before you join).
create or replace function public.race_waiting() returns int language sql security definer set search_path = public, private as $$
  select count(*)::int from public.race_players p join public.races r on r.id = p.race_id
  where r.kind = 'public' and r.status = 'lobby' and p.left_at is null and p.last_seen > now() - private.race_t('away') $$;

-- One racer's full expedition from a finished race, for exploring it on the iceberg. Only racers from that race may ask.
create or replace function public.race_expedition(p_race bigint, p_match int, p_username text) returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare v uuid := private.me(); o uuid := private.find_user(p_username); r public.races;
begin
  select * into r from public.races where id = p_race;
  if r.id is null or o is null or private.blocked_between(v, o) then raise exception 'not_found'; end if;
  if not exists (select 1 from public.race_results where race_id = p_race and match_no = p_match and user_id = v) then raise exception 'not_in_race'; end if;
  if not exists (select 1 from public.race_results where race_id = p_race and match_no = p_match and user_id = o) then raise exception 'not_found'; end if;
  return jsonb_build_object('username', p_username, 'avatar', (select avatar from public.profiles where id = o), 'questions', to_jsonb(r.questions),
    'result', (select jsonb_build_object('place', place, 'racers', racers, 'distance', distance, 'deepest', deepest, 'rounds_won', rounds_won) from public.race_results where race_id = p_race and match_no = p_match and user_id = o),
    'guesses', (select coalesce(jsonb_agg(jsonb_build_object('round', g.round, 'slot', g.slot, 'answer', g.answer, 'typed', g.typed, 'status', g.status, 'share', g.share, 'depth', g.depth) order by g.round, g.slot), '[]'::jsonb)
      from public.race_guesses g where g.race_id = p_race and g.match_no = p_match and g.user_id = o));
end $$;

-- Race record for a profile: kept apart from the daily game's numbers.
create or replace function public.race_record(p_username text) returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare v uuid := private.me(); o uuid := private.find_user(p_username);
begin
  if o is null or private.blocked_between(v, o) then raise exception 'not_found'; end if;
  return (select jsonb_build_object('races', count(*), 'wins', count(*) filter (where place = 1 and racers > 1), 'best', coalesce(max(distance), 0), 'deepest', coalesce(max(deepest), 0))
    from public.race_results where user_id = o and kind <> 'practice');
end $$;

revoke all on all functions in schema public from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
revoke all on public.race_pool, public.races, public.race_players, public.race_guesses, public.race_results, public.race_invites from anon, authenticated;
-- (0002's grants are repeated here because the revoke above covers every function.)
-- 0006_content.sql's day_content, if it exists yet: the blanket revoke above would otherwise remove it on a re-run.
do $$ begin if to_regprocedure('public.day_content(int)') is not null then grant execute on function public.day_content(int) to anon, authenticated; end if; end $$;

grant execute on function public.round_counts(int, int, text), public.username_check(text), public.leaderboard(int, text, int, int) to anon, authenticated;
grant execute on function public.claim_profile(text, text), public.me(), public.update_settings(jsonb), public.change_username(text), public.delete_account(),
  public.submit_dive(int, jsonb), public.import_dives(jsonb), public.my_dives(int, int), public.get_dive(text, int), public.profile_of(text), public.search_users(text),
  public.friend_request(text), public.friend_respond(text, boolean), public.friend_remove(text), public.block_user(text, boolean), public.friends(int), public.day_summary(int),
  public.race_state(bigint), public.race_create(text, int, int, int), public.race_quick(), public.race_join(text), public.race_leave(bigint), public.race_ready(bigint, boolean),
  public.race_settings(bigint, int, int, int), public.race_start(bigint), public.race_guess(bigint, int, text, text), public.race_done(bigint), public.race_rematch(bigint),
  public.race_invite(bigint, text), public.race_invites(), public.race_waiting(), public.race_expedition(bigint, int, text), public.race_record(text)
  to authenticated;
