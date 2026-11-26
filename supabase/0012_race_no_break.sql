-- 0012: no break between race questions. When a question closes (time is up, or every racer still here has used
-- their three guesses), the next question starts at once; after the last one, the results. The players' deepest
-- answers for the question just closed are shown above their submarines as the next one begins (race.js).
-- Only private.race_tick changes. A race already sitting in a break (status 'between') still moves on as before.
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
      -- Straight on to the next question (no break between questions); after the last one, the results.
      if r.round < array_length(r.questions, 1) then
        update public.races set status = 'question', round = r.round + 1, round_start = now(), round_end = now() + make_interval(secs => r.seconds), between_until = null, touched_at = now() where id = r.id;
      else
        update public.races set round_end = least(r.round_end, now()) where id = r.id;
        perform private.race_finish(r);
      end if;
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
