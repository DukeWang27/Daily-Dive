-- 0014: the server's answer check (private.claim_ok) also accepts a guess typed as the claimed answer's own name.
-- Two cases it missed:
--   - names that differ only by a leading "A"/"The" ("A Christmas Wish", "The Christmas Wish"): both reduce to one key,
--     which can point at only one of them, so the other never counted;
--   - names longer than the 60 characters a guess keeps ("Venice of the North (Amsterdam, Bruges, ...)"): the cut-off
--     text matched no key.
-- Everything else is unchanged. Safe to run again; changes no stored data.
create or replace function private.claim_ok(p_set int, p_round int, p_typed text, p_answer text) returns boolean language plpgsql stable security definer set search_path = public, private, extensions as $$
declare n text := private.norm(p_typed); a text := private.norm(p_answer); words text[]; c text; allow int;
begin
  if n = '' or p_answer is null then return false; end if;
  -- The answer's own name, as typed or cut at 60 characters (only for a claimed answer this question really has).
  if (n = a or (char_length(p_typed) >= 59 and char_length(n) >= 20 and left(a, char_length(n)) = n))
     and exists (select 1 from public.set_keys where set_id = p_set and round = p_round and answer = p_answer) then return true; end if;
  if exists (select 1 from public.set_keys where set_id = p_set and round = p_round and answer = p_answer and key = any (private.variants(n))) then return true; end if;
  words := string_to_array(n, ' ');
  for i in 2 .. least(3, coalesce(array_length(words, 1), 0)) loop
    c := array_to_string(words[i:], ' ');
    if exists (select 1 from public.set_keys where set_id = p_set and round = p_round and answer = p_answer and key = any (private.variants(c))) then return true; end if;
  end loop;
  allow := case when length(replace(n, ' ', '')) <= 4 then 0 when length(replace(n, ' ', '')) <= 8 then 1 else 2 end;
  if allow = 0 then return false; end if;
  return exists (select 1 from public.set_keys k where k.set_id = p_set and k.round = p_round and k.answer = p_answer and left(k.key, 1) = left(n, 1)
    and abs(length(k.key) - length(n)) <= allow and extensions.levenshtein(n, k.key) <= allow + case when length(k.key) = length(n) then 1 else 0 end);
end $$;
revoke all on function private.claim_ok(int, int, text, text) from public, anon, authenticated;
