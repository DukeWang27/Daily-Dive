-- 0013 checks, as the anonymous role: events and errors go in through the functions only, with limits.
set role anon;
select public.log_event('tester-abc123', 'open', 501, null, null, '{}', 'friends');
select public.log_event('tester-abc123', 'feedback', 501, 1, 'c-x', '{"tags":["fun"]}', 'friends');
select public.log_event('tester-abc123', 'feedback', 501, 1, 'c-x', '{"tags":["fun","confusing"]}', 'friends');
select public.log_event('bad id!', 'open', 1, null, null, '{}', 'friends');           -- dropped: bad tester id
select public.log_event('tester-abc123', 'drop table', 1, null, null, '{}', 'live');  -- dropped: unknown kind
select public.log_error('TypeError: x is undefined', 'game.js:10', 'UA', 'live');
select public.log_error('TypeError: x is undefined', 'game.js:10', 'UA', 'live');
do $$ begin perform count(*) from public.tester_events; raise exception 'anon could read events'; exception when insufficient_privilege then null; end $$;
do $$ begin insert into public.client_errors (sig, message) values ('x', 'y'); raise exception 'anon could write directly'; exception when insufficient_privilege then null; end $$;
reset role;
do $$ begin
  if (select count(*) from public.tester_events) <> 3 then raise exception 'expected 3 events, got %', (select count(*) from public.tester_events); end if;
  if (select count from public.client_errors) <> 2 then raise exception 'error not merged'; end if;
  if (select tags::text from private.playtest_feedback) <> '["fun", "confusing"]' then raise exception 'latest feedback wrong'; end if;
  if (select opened from private.playtest_funnel where day = 501) <> 1 then raise exception 'funnel wrong'; end if;
end $$;
-- rate limit: 300 per tester per hour
set role anon;
select count(*) from (select public.log_event('tester-flood1', 'question', 501, 1, 'c-x', '{}', 'friends') from generate_series(1, 400)) s;
reset role;
do $$ begin if (select count(*) from public.tester_events where tester = 'tester-flood1') <> 300 then raise exception 'rate limit failed'; end if; end $$;
select 'logs ok';
