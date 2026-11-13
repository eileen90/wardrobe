-- Wardrobe accounts: run this once in the Supabase SQL Editor (it is safe to run again).
-- Each signed-in person can only read and write their own rows and pictures.

-- Pieces and looks: one row per record, keyed by the app's own ids.
--   data        the record as the app saves it (null once deleted)
--   updated_at  when it last changed, in ms, on the device that changed it: the newer one wins
--   deleted     true once it was removed
--   synced_at   set by the server on every accepted write; devices fetch what changed after it
create table if not exists public.items (
  user_id    uuid    not null default auth.uid() references auth.users (id) on delete cascade,
  id         text    not null,
  data       jsonb,
  updated_at bigint  not null,
  deleted    boolean not null default false,
  synced_at  timestamptz not null default clock_timestamp(),
  primary key (user_id, id)
);

create table if not exists public.looks (
  user_id    uuid    not null default auth.uid() references auth.users (id) on delete cascade,
  id         text    not null,
  data       jsonb,
  updated_at bigint  not null,
  deleted    boolean not null default false,
  synced_at  timestamptz not null default clock_timestamp(),
  primary key (user_id, id)
);

create index if not exists items_user_synced on public.items (user_id, synced_at, id);
create index if not exists looks_user_synced on public.looks (user_id, synced_at, id);

-- An older write never replaces a newer one, and every accepted write gets a fresh synced_at.
create or replace function public.wardrobe_stamp() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    return null; -- keep the newer row as it is
  end if;
  new.synced_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists items_stamp on public.items;
create trigger items_stamp before insert or update on public.items
  for each row execute function public.wardrobe_stamp();
drop trigger if exists looks_stamp on public.looks;
create trigger looks_stamp before insert or update on public.looks
  for each row execute function public.wardrobe_stamp();

-- Only signed-in people reach the tables at all, and the policies below narrow that to their own rows.
revoke all on public.items, public.looks from anon;
grant select, insert, update, delete on public.items, public.looks to authenticated;

alter table public.items enable row level security;
alter table public.looks enable row level security;

drop policy if exists "own items" on public.items;
create policy "own items" on public.items for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "own looks" on public.looks;
create policy "own looks" on public.looks for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Pictures: a private bucket, files at <user id>/<item id>/<raw|cut|thumb>.
insert into storage.buckets (id, name, public)
values ('pictures', 'pictures', false)
on conflict (id) do update set public = false;

drop policy if exists "own pictures: read" on storage.objects;
create policy "own pictures: read" on storage.objects for select to authenticated
  using (bucket_id = 'pictures' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "own pictures: add" on storage.objects;
create policy "own pictures: add" on storage.objects for insert to authenticated
  with check (bucket_id = 'pictures' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "own pictures: replace" on storage.objects;
create policy "own pictures: replace" on storage.objects for update to authenticated
  using (bucket_id = 'pictures' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'pictures' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "own pictures: remove" on storage.objects;
create policy "own pictures: remove" on storage.objects for delete to authenticated
  using (bucket_id = 'pictures' and (storage.foldername(name))[1] = (select auth.uid())::text);
