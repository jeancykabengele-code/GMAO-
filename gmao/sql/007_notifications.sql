-- Notifications persistantes destinées au Manager et au Chargé des opérations.
begin;

create table if not exists public.gmao_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.user_profiles(id) on delete cascade,
  actor_id uuid references public.user_profiles(id) on delete set null,
  site text,
  event_type text not null,
  resource text not null,
  resource_id uuid,
  title text not null,
  message text not null,
  severity text not null default 'info'
    check (severity in ('info', 'warning', 'critical')),
  dedupe_key text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists gmao_notifications_recipient_dedupe_uidx
  on public.gmao_notifications(recipient_id, dedupe_key)
  where dedupe_key is not null;

create index if not exists gmao_notifications_recipient_created_idx
  on public.gmao_notifications(recipient_id, created_at desc);

create index if not exists gmao_notifications_recipient_unread_idx
  on public.gmao_notifications(recipient_id, created_at desc)
  where read_at is null;

alter table public.gmao_notifications replica identity full;
alter table public.gmao_notifications enable row level security;
grant select, update on public.gmao_notifications to authenticated;

drop policy if exists gmao_notifications_select_own on public.gmao_notifications;
create policy gmao_notifications_select_own
on public.gmao_notifications
for select
to authenticated
using (recipient_id = auth.uid());

drop policy if exists gmao_notifications_update_own on public.gmao_notifications;
create policy gmao_notifications_update_own
on public.gmao_notifications
for update
to authenticated
using (recipient_id = auth.uid())
with check (recipient_id = auth.uid());

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'gmao_notifications'
     ) then
    alter publication supabase_realtime add table public.gmao_notifications;
  end if;
end
$$;

commit;
