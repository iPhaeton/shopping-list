-- A row per account, mirroring auth.users into a table the app can read.
--
-- auth.users is not directly readable by the anon/authenticated roles, and it is Supabase's
-- table rather than ours, so application columns belong here instead of on it.

create table public.users (
  id uuid primary key references auth.users on delete cascade,
  email text not null,
  created_at timestamptz not null default now()
);

alter table public.users enable row level security;

-- You can see and edit exactly your own row. There is deliberately no insert policy: rows are
-- minted by the trigger below, never by the client, so the app cannot forge one.
create policy "read own row" on public.users
  for select using (auth.uid() = id);

create policy "update own row" on public.users
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- `security definer` so the insert bypasses the policies above, which would otherwise reject it
-- (auth.uid() is not yet the new user during signup). `set search_path = ''` is the standard
-- hardening for a definer function, hence every name below is schema-qualified.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email)
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

-- `or update of email` keeps the mirrored address in sync if the account's email ever changes.
create trigger on_auth_user_created
  after insert or update of email on auth.users
  for each row execute function public.handle_new_user();
