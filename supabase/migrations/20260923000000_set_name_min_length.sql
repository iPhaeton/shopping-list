-- `set_name` accepted any non-empty name, including 1- and 2-character ones. Add a floor so the
-- database enforces the same minimum the client now gates on, rather than relying on the client
-- alone — a name shorter than 3 characters would otherwise be permanently unfindable by
-- `search_users_by_name`'s trigram index, which only accelerates 3+ character queries (see
-- ai/kb/entries/trigram-index-needs-three-characters.md). No backfill: every existing row already
-- clears 3 characters.
--
-- `create or replace`, not drop + recreate: the signature (`set_name(text) returns void`) is
-- unchanged, so the existing grants stay intact — see `20260920000000_session_revocation.sql` for
-- the same move on eight other functions. No `notify pgrst, 'reload schema'` for the same reason:
-- PostgREST's route for this function doesn't change.
create or replace function public.set_name(p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  trimmed text := trim(p_name);
begin
  if not public.session_still_valid() then
    raise exception using errcode = '42501', message = 'this device has been signed out';
  end if;

  if trimmed = '' then
    raise exception using errcode = '22023', message = 'please enter a name';
  end if;

  if char_length(trimmed) < 3 then
    raise exception using errcode = '22023', message = 'please enter at least 3 characters';
  end if;

  update public.users set name = trimmed where id = (select auth.uid());
exception
  when unique_violation then
    raise exception using errcode = '22023', message = 'that name is taken';
end;
$$;
