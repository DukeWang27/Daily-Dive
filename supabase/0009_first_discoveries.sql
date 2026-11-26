-- PROTOTYPE, NOT APPLIED. For review before it goes anywhere near the live database.
--
-- 1. Encounters: dive_guesses.sight accepts the two inventions of The Unknown as well (megalodon, coil). Until this
--    is applied, the game simply doesn't send those two (game.js, guessesOf), so nothing fails to save.
-- 2. First recorded discoveries: the first player to give a verified answer that nobody had given before for that
--    question, wherever and whenever it is used. Worked out here, on the server, from guesses already stored: a client
--    cannot claim one. It changes no score and no depth.
--
-- What counts, and why (see EXPEDITION.md, "First recorded discoveries"):
--   - Keyed by the question (set_keys / the question's key), not the day: a question used again later keeps its history.
--   - By canonical answer: aliases, spellings and synonyms are folded into the listed answer first (dive_guesses.answer
--     is already the canonical name the answer counted as), so "aubergine" after "eggplant" is not a new find.
--   - Only answers that were NOT on the prepared list, and were later approved (verified_answers review_status
--     'confirmed' or 'auto' with relationship 'new'). Answers on the list were "recorded" before anyone played, so
--     being early is no advantage: the reward is for finding something the list missed.
--   - Only signed-in players (dives have a user); guests can't be credited, and one account is one claim.
--   - Credited to the earliest completed dive that gave it (dives.completed_at), not to whoever is checked first.
--   - Awarded only once the question has had at least 30 players that day, so a near-empty day can't be farmed.

alter table public.dive_guesses drop constraint if exists dive_guesses_sight_check;
alter table public.dive_guesses add constraint dive_guesses_sight_check check (sight in ('giant', 'bigfin', 'colossal', 'megalodon', 'coil'));

create table if not exists public.first_finds (
  question_key text not null,
  answer_key text not null,                          -- the canonical answer, normalised
  user_id uuid not null references auth.users on delete cascade,
  dive_id bigint references public.dives on delete set null,
  found_at timestamptz not null,
  awarded_at timestamptz not null default now(),
  primary key (question_key, answer_key)             -- one first, ever, per answer per question
);
alter table public.first_finds enable row level security;
create policy first_finds_read on public.first_finds for select using (true);   -- public: it's a record, like a ranking
-- No insert/update/delete policy: only the function below (security definer) writes.

-- Credit any new verified answers. Safe to run again (the primary key keeps the first; later runs insert nothing).
-- p_question_key / p_set / p_round tie a question key to where its guesses live. Run by a scheduled job, after review.
create or replace function private.award_first_finds(p_question_key text, p_set int, p_round int)
returns int language plpgsql security definer set search_path = public, private as $$
declare n int;
begin
  insert into public.first_finds (question_key, answer_key, user_id, dive_id, found_at)
  select distinct on (lower(g.answer)) p_question_key, lower(g.answer), d.user_id, d.id, d.completed_at
  from public.dive_guesses g
  join public.dives d on d.id = g.dive_id
  join public.verified_answers v on v.answer_key = lower(g.answer) and v.category = p_question_key
  where d.set_id = p_set and g.round = p_round and g.status = 'ok' and d.user_id is not null
    and v.relationship = 'new' and v.review_status in ('confirmed', 'auto')
    and not exists (select 1 from public.set_answers a where a.set_id = p_set and a.round = p_round and lower(a.answer) = lower(g.answer))
    and (select count(*) from public.dives x where x.set_id = p_set and x.day = d.day) >= 30
  order by lower(g.answer), d.completed_at, d.id
  on conflict (question_key, answer_key) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function private.award_first_finds(text, int, int) from public, anon, authenticated;
